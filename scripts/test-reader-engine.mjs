import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

console.log('--- Testing Reader Engine (Reconstruction & Highlights) ---');

// Mock TextItems from sample.pdf Page 1
const mockItems = [
  { str: "E-Dic Reader - Sample Document", hasEOL: false },
  { str: "", hasEOL: true },
  { str: "This is an accurate and compre-", hasEOL: true },
  { str: "hensive analysis of an inevitable, subtle, and ubi-", hasEOL: true },
  { str: "quitous phenomenon in modern literature.", hasEOL: true },
  { str: "We should acknowledge that meticulous scrutiny can mitigate", hasEOL: true },
  { str: "apparent and profound ambiguities.", hasEOL: false },
];

function reconstructPageText(items) {
  let recon = '';
  const map = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item?.str !== 'string') continue;

    const str = item.str;
    const hasEOL = Boolean(item.hasEOL);

    // Find next non-empty text item
    let nextItem = null;
    for (let k = i + 1; k < items.length; k++) {
      if (typeof items[k]?.str === 'string' && items[k].str.length > 0) {
        nextItem = items[k];
        break;
      }
    }

    const isHyphenBreak =
      (str.endsWith('-') || str.endsWith('\u2010')) &&
      (hasEOL || !str.endsWith(' -')) &&
      nextItem &&
      typeof nextItem?.str === 'string';

    if (isHyphenBreak) {
      const stemLen = str.length - 1;
      for (let c = 0; c < stemLen; c++) {
        map.push({ itemIndex: i, charOffset: c });
        recon += str[c];
      }
    } else {
      for (let c = 0; c < str.length; c++) {
        map.push({ itemIndex: i, charOffset: c });
        recon += str[c];
      }

      if (hasEOL) {
        map.push({ itemIndex: i, charOffset: str.length });
        recon += '\n';
      } else {
        if (str.length > 0 && !str.endsWith(' ') && nextItem && !nextItem.str.startsWith(' ')) {
          map.push({ itemIndex: i, charOffset: str.length });
          recon += ' ';
        }
      }
    }
  }

  return { text: recon, map };
}

const { text: recon, map } = reconstructPageText(mockItems);
console.log('Reconstructed Page Text:\n', recon);
assert.ok(recon.includes('comprehensive'), 'Must join comprehensive');
assert.ok(recon.includes('ubiquitous'), 'Must join ubiquitous');
assert.strictEqual(recon.length, map.length, 'Recon string and char map must have identical length');

// Check NLP + DB on reconstructed text
const nlp = winkNLP(model);
const its = nlp.its;
const doc = nlp.readDoc(recon);

let cursor = 0;
const candidates = [];
const uniqueLemmas = new Set();

doc.tokens().each((t) => {
  const spaces = t.out(its.precedingSpaces);
  const val = t.out(its.value);
  cursor += spaces.length;
  const start = cursor;
  cursor += val.length;
  const end = cursor;

  if (t.out(its.type) === 'word' && !t.out(its.stopWordFlag)) {
    const rawLemma = t.out(its.lemma);
    const lemma = rawLemma.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
    if (lemma && lemma.length >= 2 && !/\d/.test(lemma)) {
      candidates.push({ start, end, lemma });
      uniqueLemmas.add(lemma);
    }
  }
});

const db = new DatabaseSync('public/db/dictionary.sqlite');
const allLemmas = Array.from(uniqueLemmas);
const placeholders = allLemmas.map(() => '?').join(',');
const sql = `SELECT lemma, cefr_level FROM words WHERE lemma IN (${placeholders}) AND cefr_level >= 3;`;
const rows = db.prepare(sql).all(...allLemmas);
const lemmaToCefr = new Map(rows.map(r => [r.lemma, r.cefr_level]));

const triplets = [];
const matchedLemmas = [];

for (const cand of candidates) {
  const cefr = lemmaToCefr.get(cand.lemma);
  if (cefr !== undefined) {
    triplets.push(cand.start, cand.end, cefr);
    matchedLemmas.push(cand.lemma);
  }
}

const hits = new Uint32Array(triplets);
console.log(`Detected ${matchedLemmas.length} vocabulary words at CEFR >= B1:`, matchedLemmas);
assert.ok(matchedLemmas.includes('comprehensive'), 'comprehensive must be found');
assert.ok(matchedLemmas.includes('ubiquitous'), 'ubiquitous must be found');

// Verify hit triplet unpack
for (let i = 0; i < matchedLemmas.length; i++) {
  const start = hits[i * 3];
  const end = hits[i * 3 + 1];
  const cefr = hits[i * 3 + 2];
  const lemma = matchedLemmas[i];
  const slice = recon.slice(start, end);
  console.log(`- Hit ${i}: [${start}, ${end}] cefr=${cefr} lemma="${lemma}" slice="${slice}"`);
  assert.ok(slice.toLowerCase().includes(lemma.slice(0, 4)), 'Slice should match lemma stem');
}

console.log('✔ All Reader Engine verification tests passed successfully!');
db.close();
