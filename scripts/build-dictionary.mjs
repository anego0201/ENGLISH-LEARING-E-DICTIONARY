#!/usr/bin/env node
/**
 * Dictionary build pipeline — raw CSV/JSON → indexed, read-only SQLite for wa-sqlite + OPFS.
 *
 *   node scripts/build-dictionary.mjs --input data/raw/dictionary.sample.csv [--out public/db]
 *
 * Input columns (case-insensitive, aliases accepted):
 *   lemma      | word | headword
 *   cefr_level | cefr | level          A1 … C2 (or 1 … 6)
 *   meaning    | definition | translation
 *   ipa        | pronunciation | phonetic   (optional, slashes are stripped)
 *
 * Outputs:
 *   <out>/dictionary.sqlite         page_size 4096, rollback journal, VACUUMed, ANALYZEd
 *   <out>/dictionary.manifest.json  { version (content hash), bytes, sha256, … } → injected
 *                                   into the app as __DICTIONARY__ by vite.config.ts
 *
 * Uses Node's built-in `node:sqlite` (Node ≥ 22.13) — no native addons to compile.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const SCHEMA_VERSION = 1;
const PAGE_SIZE = 4096; // matches OPFS sync-access-handle I/O granularity used by wa-sqlite
const CEFR_TO_INT = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
const INT_TO_CEFR = Object.fromEntries(Object.entries(CEFR_TO_INT).map(([k, v]) => [v, k]));

const COLUMN_ALIASES = {
  lemma: ['lemma', 'word', 'headword'],
  cefr_level: ['cefr_level', 'cefr', 'level'],
  meaning: ['meaning', 'definition', 'translation'],
  ipa: ['ipa', 'pronunciation', 'phonetic'],
};

const SCHEMA_SQL = `
  CREATE TABLE words (
    id         INTEGER PRIMARY KEY,
    lemma      TEXT    NOT NULL,
    cefr_level INTEGER NOT NULL CHECK (cefr_level BETWEEN 1 AND 6),
    meaning    TEXT    NOT NULL,
    ipa        TEXT
  ) STRICT;
`;
// Created AFTER the bulk insert (much faster than maintaining it row by row).
// Covering index: the per-page hot path (lemma → cefr_level) never touches table rows,
// so SQLite reads only a handful of small index pages from OPFS.
const INDEX_SQL = `CREATE INDEX words_lemma_cefr ON words (lemma, cefr_level);`;

/** Query plans the runtime depends on. The build fails if SQLite would not use the index. */
const PLAN_ASSERTIONS = [
  {
    name: 'hot path (per-page batch level lookup)',
    sql: 'SELECT lemma, cefr_level FROM words WHERE lemma IN (?, ?, ?) AND cefr_level >= ?',
    params: ['a', 'b', 'c', 3],
    expect: /USING COVERING INDEX words_lemma_cefr/,
  },
  {
    name: 'cold path (single word on tap)',
    sql: 'SELECT lemma, cefr_level, meaning, ipa FROM words WHERE lemma = ?',
    params: ['a'],
    expect: /USING (COVERING )?INDEX words_lemma_cefr/,
  },
];

// ─── CLI ────────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    out: { type: 'string', short: 'o', default: 'public/db' },
  },
});

if (!args.input) {
  fail('Missing --input <file.csv|file.json>');
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, embedded newlines). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) fail('CSV parse error: unterminated quoted field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function resolveColumns(headerKeys) {
  const normalized = headerKeys.map((h) => String(h).trim().toLowerCase());
  const map = {};
  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = normalized.findIndex((h) => aliases.includes(h));
    if (index === -1 && canonical !== 'ipa') {
      fail(`Input is missing required column "${canonical}" (aliases: ${aliases.join(', ')})`);
    }
    map[canonical] = index;
  }
  return map;
}

async function loadRawRecords(file) {
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, ''); // strip BOM
  const ext = path.extname(file).toLowerCase();

  if (ext === '.json') {
    const data = JSON.parse(text);
    if (!Array.isArray(data) || data.length === 0) fail('JSON input must be a non-empty array');
    const keys = Object.keys(data[0]);
    const cols = resolveColumns(keys);
    return data.map((obj, i) => ({
      line: i + 1,
      lemma: obj[keys[cols.lemma]],
      cefr: obj[keys[cols.cefr_level]],
      meaning: obj[keys[cols.meaning]],
      ipa: cols.ipa === -1 ? null : obj[keys[cols.ipa]],
    }));
  }

  if (ext === '.csv') {
    const [header, ...rows] = parseCsv(text);
    if (!header) fail('CSV input is empty');
    const cols = resolveColumns(header);
    return rows.map((r, i) => ({
      line: i + 2,
      lemma: r[cols.lemma],
      cefr: r[cols.cefr_level],
      meaning: r[cols.meaning],
      ipa: cols.ipa === -1 ? null : r[cols.ipa],
    }));
  }

  fail(`Unsupported input extension "${ext}" (expected .csv or .json)`);
}

// ─── Normalization ──────────────────────────────────────────────────────────

/** MUST stay in sync with the worker's lemma normalization (NFC + trim + lowercase). */
const normalizeLemma = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeText = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const normalizeIpa = (s) => normalizeText(s).replace(/^[/[]+|[/\]]+$/g, '').trim() || null;

function parseCefr(value) {
  const v = String(value ?? '').trim().toUpperCase();
  if (v in CEFR_TO_INT) return CEFR_TO_INT[v];
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : null;
}

function normalizeRecords(raw) {
  const byLemma = new Map();
  const rejected = [];
  let merged = 0;

  for (const r of raw) {
    const lemma = normalizeLemma(r.lemma);
    const cefr = parseCefr(r.cefr);
    const meaning = normalizeText(r.meaning);
    const ipa = normalizeIpa(r.ipa);

    if (!lemma || !meaning || cefr === null) {
      rejected.push({ line: r.line, reason: !lemma ? 'empty lemma' : !meaning ? 'empty meaning' : `bad CEFR "${r.cefr}"` });
      continue;
    }

    const existing = byLemma.get(lemma);
    if (!existing) {
      byLemma.set(lemma, { lemma, cefr, meanings: [meaning], ipa });
      continue;
    }
    // Duplicate lemma: keep the LOWEST level (when a learner first meets the word),
    // merge distinct meanings, keep the first non-empty IPA.
    merged++;
    existing.cefr = Math.min(existing.cefr, cefr);
    if (!existing.meanings.includes(meaning)) existing.meanings.push(meaning);
    existing.ipa ??= ipa;
  }

  // Insert in lemma order → rowids follow lemma order → better page locality on OPFS reads.
  const records = [...byLemma.values()]
    .map((e) => ({ lemma: e.lemma, cefr: e.cefr, meaning: e.meanings.join('; '), ipa: e.ipa }))
    .sort((a, b) => (a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0));

  return { records, rejected, merged };
}

// ─── Build ──────────────────────────────────────────────────────────────────

function buildDatabase(file, records) {
  const db = new DatabaseSync(file);
  try {
    db.exec(`PRAGMA page_size = ${PAGE_SIZE}; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;`);
    db.exec(SCHEMA_SQL);

    const insert = db.prepare('INSERT INTO words (lemma, cefr_level, meaning, ipa) VALUES (?, ?, ?, ?)');
    db.exec('BEGIN');
    for (const r of records) insert.run(r.lemma, r.cefr, r.meaning, r.ipa);
    db.exec('COMMIT');

    db.exec(INDEX_SQL);
    db.exec('ANALYZE'); // sqlite_stat1 → planner statistics shipped inside the file
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    // Ship in rollback-journal mode: a read-only OPFS database must not expect a -wal file.
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('VACUUM');

    const integrity = db.prepare('PRAGMA integrity_check').get();
    if (Object.values(integrity)[0] !== 'ok') fail(`integrity_check failed: ${JSON.stringify(integrity)}`);

    const plans = PLAN_ASSERTIONS.map((a) => {
      const detail = db
        .prepare(`EXPLAIN QUERY PLAN ${a.sql}`)
        .all(...a.params)
        .map((row) => row.detail)
        .join(' | ');
      if (!a.expect.test(detail)) fail(`Query plan regression for ${a.name}:\n  ${detail}`);
      return { name: a.name, detail };
    });

    const levelCounts = Object.fromEntries(
      db
        .prepare('SELECT cefr_level, COUNT(*) AS n FROM words GROUP BY cefr_level ORDER BY cefr_level')
        .all()
        .map((row) => [INT_TO_CEFR[row.cefr_level], row.n]),
    );

    return { plans, levelCounts };
  } finally {
    db.close();
  }
}

async function main() {
  const inputPath = path.resolve(args.input);
  const outDir = path.resolve(args.out);
  const dbPath = path.join(outDir, 'dictionary.sqlite');
  const tmpPath = `${dbPath}.tmp`;
  const manifestPath = path.join(outDir, 'dictionary.manifest.json');

  const t0 = performance.now();
  const raw = await loadRawRecords(inputPath);
  const { records, rejected, merged } = normalizeRecords(raw);
  if (records.length === 0) fail('No valid records after normalization');

  await mkdir(outDir, { recursive: true });
  await rm(tmpPath, { force: true });
  const { plans, levelCounts } = buildDatabase(tmpPath, records);
  await rename(tmpPath, dbPath); // atomic replace — never leaves a half-written DB in public/

  const bytes = (await stat(dbPath)).size;
  const sha256 = createHash('sha256').update(await readFile(dbPath)).digest('hex');
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    version: sha256.slice(0, 16), // content-addressed: changes iff the DB bytes change
    file: 'dictionary.sqlite',
    bytes,
    sha256,
    pageSize: PAGE_SIZE,
    wordCount: records.length,
    levels: levelCounts,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const ms = (performance.now() - t0).toFixed(0);
  console.log(`✔ dictionary.sqlite  ${records.length} words  ${(bytes / 1024).toFixed(1)} KiB  v${manifest.version}  (${ms} ms)`);
  console.log(`  levels: ${Object.entries(levelCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (merged) console.log(`  merged ${merged} duplicate lemma row(s)`);
  if (rejected.length) {
    console.warn(`  ⚠ rejected ${rejected.length} row(s):`);
    for (const r of rejected.slice(0, 20)) console.warn(`    line ${r.line}: ${r.reason}`);
    if (rejected.length > 20) console.warn(`    … and ${rejected.length - 20} more`);
  }
  for (const p of plans) console.log(`  plan ✔ ${p.name}: ${p.detail}`);
}

function fail(message) {
  console.error(`✖ build-dictionary: ${message}`);
  process.exit(1);
}

await main();
