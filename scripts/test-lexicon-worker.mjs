import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

console.log('--- Testing Lexicon Worker Logic ---');

// 1. Test joinHyphens
function joinHyphens(text) {
  let recon = '';
  const map = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if ((ch === '-' || ch === '\u2010') && i + 1 < len) {
      let nlLen = 0;
      if (text[i + 1] === '\n') {
        nlLen = 1;
      } else if (text[i + 1] === '\r' && i + 2 < len && text[i + 2] === '\n') {
        nlLen = 2;
      }

      if (nlLen > 0) {
        i += 1 + nlLen;
        continue;
      }
    }

    map.push(i);
    recon += ch;
    i++;
  }

  return { recon, map };
}

// Test hyphenated word at line break with words present in dictionary.sample.csv
const testText = 'This is an accurate and compre-\r\nhensive analysis of an inevitable, subtle, and ubi-\nquitous phenomenon.';
const { recon, map } = joinHyphens(testText);

console.log('Original length:', testText.length);
console.log('Recon length:', recon.length);
assert.ok(recon.includes('comprehensive'), 'Should join compre-\\r\\nhensive into comprehensive');
assert.ok(recon.includes('ubiquitous'), 'Should join ubi-\\nquitous into ubiquitous');

// 2. Test NLP lemmatization and offsets
const nlp = winkNLP(model);
const its = nlp.its;
const doc = nlp.readDoc(recon);

let cursor = 0;
const candidates = [];
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
      candidates.push({ reconStart: start, reconEnd: end, lemma });
    }
  }
});

console.log('Extracted candidates count:', candidates.length);
const compCandidate = candidates.find(c => c.lemma === 'comprehensive');
assert.ok(compCandidate, 'Candidate "comprehensive" must be extracted');

// Check coordinate mapping back to original text
const origStart = map[compCandidate.reconStart];
const origEnd = map[compCandidate.reconEnd - 1] + 1;
const originalSlice = testText.slice(origStart, origEnd);
console.log('Original slice for "comprehensive":', JSON.stringify(originalSlice));
assert.strictEqual(originalSlice, 'compre-\r\nhensive', 'Offsets must map back to exact original text');

// 3. Test SQLite queries with sample dictionary
const db = new DatabaseSync('public/db/dictionary.sqlite');
const uniqueLemmas = Array.from(new Set(candidates.map(c => c.lemma)));
console.log('Unique lemmas:', uniqueLemmas);

const placeholders = uniqueLemmas.map(() => '?').join(',');
const batchStmt = db.prepare(`SELECT lemma, cefr_level FROM words WHERE lemma IN (${placeholders}) AND cefr_level >= ?`);
const matches = batchStmt.all(...uniqueLemmas, 3); // minLevel = B1 (3)
console.log('Batch matches (CEFR >= B1):', matches);

assert.ok(matches.length >= 3, 'Should find accurate, comprehensive, inevitable, subtle, ubiquitous');
const compMatch = matches.find(m => m.lemma === 'comprehensive');
assert.ok(compMatch, 'comprehensive must be found in sample dictionary');

// 4. Test Single word on-tap lookup
const lookupStmt = db.prepare('SELECT lemma, cefr_level, meaning, ipa FROM words WHERE lemma = ? LIMIT 1');
const compEntry = lookupStmt.get('comprehensive');
console.log('Lookup result for "comprehensive":', compEntry);
assert.strictEqual(compEntry.lemma, 'comprehensive');
assert.strictEqual(compEntry.cefr_level, 4); // B2 = 4
assert.ok(compEntry.meaning.includes('toàn diện'));
assert.ok(compEntry.ipa);

// 5. Test packing into Uint32Array [start, end, cefr] triplets
const triplets = [];
const lemmaMap = new Map(matches.map(m => [m.lemma, m.cefr_level]));
for (const cand of candidates) {
  const cefr = lemmaMap.get(cand.lemma);
  if (cefr !== undefined) {
    const s = map[cand.reconStart];
    const e = map[cand.reconEnd - 1] + 1;
    triplets.push(s, e, cefr);
  }
}

const hitsBuffer = new Uint32Array(triplets);
assert.strictEqual(hitsBuffer.length % 3, 0, 'Triplets array length must be multiple of 3');
console.log(`Uint32Array packed ${hitsBuffer.length / 3} hits successfully (${hitsBuffer.byteLength} bytes)`);

console.log('✔ All Lexicon Worker verification tests passed successfully!');
db.close();
