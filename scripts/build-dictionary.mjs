#!/usr/bin/env node
/**
 * Dictionary build pipeline — raw CSV/JSON → indexed, read-only SQLite for wa-sqlite + OPFS.
 *
 *   node scripts/build-dictionary.mjs [--input data/raw/dictionary.csv] [--out public/db]
 *
 * Designed for high memory efficiency with large (50,000+ rows) datasets via streaming I/O
 * and chunked batch transactions.
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
 * Uses Node's built-in `node:sqlite` (Node ≥ 22.13) — zero external native build dependencies.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';

const SCHEMA_VERSION = 1;
const PAGE_SIZE = 4096; // matches OPFS sync-access-handle I/O granularity used by wa-sqlite
const BATCH_SIZE = 5000; // SQLite transaction commit chunk size for optimal RAM & speed
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

// ─── CLI & Input Resolution ──────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    out: { type: 'string', short: 'o', default: 'public/db' },
  },
});

let inputFile = args.input;
if (!inputFile) {
  if (existsSync('data/raw/dictionary.csv')) {
    inputFile = 'data/raw/dictionary.csv';
  } else if (existsSync('data/raw/dictionary.sample.csv')) {
    inputFile = 'data/raw/dictionary.sample.csv';
  } else {
    fail('Missing --input <file.csv|file.json> and no default dictionary file found in data/raw/');
  }
}

// ─── Normalization Helpers ───────────────────────────────────────────────────

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

/** RFC 4180 line parser with quote tracking for multi-line field detection. */
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
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
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return { fields, inQuotes };
}

// ─── Stream-Based Normalizer ─────────────────────────────────────────────────

async function streamRecords(file) {
  const ext = path.extname(file).toLowerCase();
  const byLemma = new Map();
  const rejected = [];
  let merged = 0;
  let totalProcessed = 0;

  if (ext === '.csv') {
    const fileStream = createReadStream(file, { encoding: 'utf8' });
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let headerCols = null;
    let lineBuffer = '';
    let lineNum = 0;

    for await (const rawLine of rl) {
      lineNum++;
      // Handle potential multi-line quoted fields
      const current = lineBuffer ? `${lineBuffer}\n${rawLine}` : rawLine;
      const { fields, inQuotes } = parseCsvLine(current);

      if (inQuotes) {
        lineBuffer = current;
        continue;
      }
      lineBuffer = '';

      if (!fields || fields.length === 0 || fields.every((f) => f.trim() === '')) {
        continue;
      }

      if (!headerCols) {
        // Strip BOM from first header cell if present
        if (fields[0]) fields[0] = fields[0].replace(/^\uFEFF/, '');
        headerCols = resolveColumns(fields);
        continue;
      }

      totalProcessed++;
      const rawLemma = fields[headerCols.lemma];
      const rawCefr = fields[headerCols.cefr_level];
      const rawMeaning = fields[headerCols.meaning];
      const rawIpa = headerCols.ipa === -1 ? null : fields[headerCols.ipa];

      const lemma = normalizeLemma(rawLemma);
      const cefr = parseCefr(rawCefr);
      const meaning = normalizeText(rawMeaning);
      const ipa = normalizeIpa(rawIpa);

      if (!lemma || !meaning || cefr === null) {
        rejected.push({
          line: lineNum,
          reason: !lemma ? 'empty lemma' : !meaning ? 'empty meaning' : `bad CEFR "${rawCefr}"`,
        });
        continue;
      }

      const existing = byLemma.get(lemma);
      if (!existing) {
        byLemma.set(lemma, { lemma, cefr, meanings: [meaning], ipa });
      } else {
        merged++;
        existing.cefr = Math.min(existing.cefr, cefr);
        if (!existing.meanings.includes(meaning)) existing.meanings.push(meaning);
        existing.ipa ??= ipa;
      }
    }
  } else if (ext === '.json') {
    const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    const data = JSON.parse(text);
    if (!Array.isArray(data) || data.length === 0) fail('JSON input must be a non-empty array');
    const keys = Object.keys(data[0]);
    const cols = resolveColumns(keys);

    for (let i = 0; i < data.length; i++) {
      totalProcessed++;
      const obj = data[i];
      const lemma = normalizeLemma(obj[keys[cols.lemma]]);
      const cefr = parseCefr(obj[keys[cols.cefr_level]]);
      const meaning = normalizeText(obj[keys[cols.meaning]]);
      const ipa = cols.ipa === -1 ? null : normalizeIpa(obj[keys[cols.ipa]]);

      if (!lemma || !meaning || cefr === null) {
        rejected.push({
          line: i + 1,
          reason: !lemma ? 'empty lemma' : !meaning ? 'empty meaning' : `bad CEFR "${obj[keys[cols.cefr_level]]}"`,
        });
        continue;
      }

      const existing = byLemma.get(lemma);
      if (!existing) {
        byLemma.set(lemma, { lemma, cefr, meanings: [meaning], ipa });
      } else {
        merged++;
        existing.cefr = Math.min(existing.cefr, cefr);
        if (!existing.meanings.includes(meaning)) existing.meanings.push(meaning);
        existing.ipa ??= ipa;
      }
    }
  } else {
    fail(`Unsupported input extension "${ext}" (expected .csv or .json)`);
  }

  // Sort by lemma to ensure page locality in SQLite B-Tree on OPFS
  const records = [...byLemma.values()]
    .map((e) => ({ lemma: e.lemma, cefr: e.cefr, meaning: e.meanings.join('; '), ipa: e.ipa }))
    .sort((a, b) => (a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0));

  return { records, rejected, merged, totalProcessed };
}

// ─── Database Generator ──────────────────────────────────────────────────────

function buildDatabase(file, records) {
  const db = new DatabaseSync(file);
  try {
    // Configure PRAGMAs for high-speed batch insertion without memory ballooning
    db.exec(`
      PRAGMA page_size = ${PAGE_SIZE};
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA cache_size = -32000;
    `);
    db.exec(SCHEMA_SQL);

    const insert = db.prepare('INSERT INTO words (lemma, cefr_level, meaning, ipa) VALUES (?, ?, ?, ?)');

    // Chunked batch transactions (committing every BATCH_SIZE rows)
    db.exec('BEGIN');
    let count = 0;
    for (const r of records) {
      insert.run(r.lemma, r.cefr, r.meaning, r.ipa);
      count++;
      if (count % BATCH_SIZE === 0) {
        db.exec('COMMIT');
        db.exec('BEGIN');
      }
    }
    db.exec('COMMIT');

    // Build index after bulk insertion for maximal performance
    db.exec(INDEX_SQL);
    db.exec('ANALYZE'); // sqlite_stat1 → planner statistics shipped inside the file
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

    // Rollback-journal mode: read-only OPFS database must not expect an external -wal file
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

// ─── Main Execution ──────────────────────────────────────────────────────────

async function main() {
  const inputPath = path.resolve(inputFile);
  const outDir = path.resolve(args.out);
  const dbPath = path.join(outDir, 'dictionary.sqlite');
  const tmpPath = `${dbPath}.tmp`;
  const manifestPath = path.join(outDir, 'dictionary.manifest.json');

  const t0 = performance.now();
  console.log(`Reading and streaming dictionary from ${inputPath}...`);
  const { records, rejected, merged, totalProcessed } = await streamRecords(inputPath);
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
  console.log(`✔ dictionary.sqlite  ${records.length} words (${totalProcessed} processed)  ${(bytes / 1024).toFixed(1)} KiB  v${manifest.version}  (${ms} ms)`);
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
