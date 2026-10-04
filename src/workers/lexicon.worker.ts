/**
 * Lexicon worker — hosts wink-nlp AND wa-sqlite (OPFSCoopSyncVFS) in ONE dedicated
 * module worker. Handles streamed OPFS dictionary download, NLP lemmatization,
 * batch CEFR covering index queries, transferable Uint32Array hits, and on-tap lookups.
 */
import * as Comlink from 'comlink';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import * as SQLite from 'wa-sqlite';
import moduleFactory from 'wa-sqlite/dist/wa-sqlite.mjs';
import { OPFSCoopSyncVFS } from 'wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import waSqliteWasmUrl from 'wa-sqlite/dist/wa-sqlite.wasm?url';
import {
  CEFR,
  type AnalyzePageRequest,
  type AnalyzePageResult,
  type AnalyzePageTextResult,
  type CefrLevel,
  type LexiconApi,
  type LexiconStatus,
  type TextHit,
  type WordEntry,
} from '../shared/lexicon-contract';

// ─── Module-scoped Worker State ─────────────────────────────────────────────

let sqlite3: any = null;
let db: number | null = null;
let vfs: any = null;
let lookupStmt: number | null = null;

let nlpInstance: ReturnType<typeof winkNLP> | null = null;
let its: any = null;

const MAX_LRU_PAGES = 5;
const lruCache = new Map<string, AnalyzePageResult>();

function getLruCache(key: string): AnalyzePageResult | null {
  const item = lruCache.get(key);
  if (!item) return null;
  // Refresh LRU position
  lruCache.delete(key);
  lruCache.set(key, item);
  return item;
}

function putLruCache(key: string, result: AnalyzePageResult): void {
  if (lruCache.has(key)) {
    lruCache.delete(key);
  } else if (lruCache.size >= MAX_LRU_PAGES) {
    const oldestKey = lruCache.keys().next().value;
    if (oldestKey) lruCache.delete(oldestKey);
  }
  lruCache.set(key, result);
}

// ─── Hyphen Joining & Coordinate Mapping ───────────────────────────────────

/**
 * Reconstructs text across line-break hyphens (`deve-\nlopment` -> `development`)
 * while building a character index map: `reconCharIndex -> originalCharIndex`.
 */
export function joinHyphens(text: string): { recon: string; map: number[] } {
  let recon = '';
  const map: number[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    // Check for hyphen (ASCII or unicode hyphen \u2010) followed by a line break
    if ((ch === '-' || ch === '\u2010') && i + 1 < len) {
      let nlLen = 0;
      if (text[i + 1] === '\n') {
        nlLen = 1;
      } else if (text[i + 1] === '\r' && i + 2 < len && text[i + 2] === '\n') {
        nlLen = 2;
      }

      if (nlLen > 0) {
        // Skip the hyphen and the newline characters
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

// ─── OPFS Streamed Installer ────────────────────────────────────────────────

async function ensureDictionaryInstalled(
  onStatus: (status: LexiconStatus) => void
): Promise<{ ok: boolean; status: LexiconStatus }> {
  if (typeof navigator?.storage?.getDirectory !== 'function') {
    const status: LexiconStatus = {
      state: 'error',
      message: 'OPFS (Origin Private File System) is not supported in this environment.',
    };
    onStatus(status);
    return { ok: false, status };
  }

  // Best effort persistence request on iOS Safari / WebKit
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Ignore persistence rejection
  }

  const root = await navigator.storage.getDirectory();
  const lexiconDir = await root.getDirectoryHandle('lexicon', { create: true });
  const targetFileName = `dictionary-${__DICTIONARY__.version}.sqlite`;

  // 1. Check if the exact version already exists with the correct size
  let alreadyInstalled = false;
  try {
    const existingFileHandle = await lexiconDir.getFileHandle(targetFileName);
    const existingFile = await existingFileHandle.getFile();
    if (existingFile.size === __DICTIONARY__.bytes) {
      alreadyInstalled = true;
    }
  } catch {
    alreadyInstalled = false;
  }

  if (alreadyInstalled) {
    return { ok: true, status: { state: 'idle' } };
  }

  // 2. Stream chunk-by-chunk from public folder
  onStatus({
    state: 'installing',
    receivedBytes: 0,
    totalBytes: __DICTIONARY__.bytes,
  });

  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const dictUrl = `${base}${__DICTIONARY__.url}`;

  let response: Response;
  try {
    response = await fetch(dictUrl);
  } catch {
    if (!navigator.onLine) {
      const status: LexiconStatus = { state: 'needs-network' };
      onStatus(status);
      return { ok: false, status };
    }
    throw new Error('Network error while downloading dictionary');
  }

  if (!response.ok) {
    if (!navigator.onLine || response.status === 503 || response.status === 504) {
      const status: LexiconStatus = { state: 'needs-network' };
      onStatus(status);
      return { ok: false, status };
    }
    throw new Error(`Failed to fetch dictionary: HTTP ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body stream is not available');
  }

  const partialFileName = `${targetFileName}.partial`;
  const partialHandle = await lexiconDir.getFileHandle(partialFileName, { create: true });
  const accessHandle = await partialHandle.createSyncAccessHandle();

  try {
    accessHandle.truncate(0);
    const reader = response.body.getReader();
    let offset = 0;
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        accessHandle.write(value, { at: offset });
        offset += value.byteLength;
        receivedBytes += value.byteLength;
        onStatus({
          state: 'installing',
          receivedBytes,
          totalBytes: __DICTIONARY__.bytes,
        });
      }
    }

    accessHandle.flush();
    const finalSize = accessHandle.getSize();
    if (finalSize !== __DICTIONARY__.bytes) {
      throw new Error(
        `Dictionary size mismatch: expected ${__DICTIONARY__.bytes} bytes, received ${finalSize} bytes`
      );
    }
  } finally {
    accessHandle.close();
  }

  // 3. Atomic rename/swap to final destination
  if (typeof (partialHandle as any).move === 'function') {
    await (partialHandle as any).move(targetFileName);
  } else {
    const targetHandle = await lexiconDir.getFileHandle(targetFileName, { create: true });
    const targetAccess = await targetHandle.createSyncAccessHandle();
    const sourceAccess = await partialHandle.createSyncAccessHandle();
    try {
      targetAccess.truncate(0);
      const buffer = new Uint8Array(65536);
      let pos = 0;
      while (pos < __DICTIONARY__.bytes) {
        const bytesRead = sourceAccess.read(buffer, { at: pos });
        if (bytesRead === 0) break;
        targetAccess.write(buffer.subarray(0, bytesRead), { at: pos });
        pos += bytesRead;
      }
      targetAccess.flush();
    } finally {
      sourceAccess.close();
      targetAccess.close();
    }
    await lexiconDir.removeEntry(partialFileName).catch(() => {});
  }

  // 4. Delete stale versions in OPFS
  try {
    // @ts-ignore
    for await (const [name] of lexiconDir.entries()) {
      if (name.startsWith('dictionary-') && name !== targetFileName && !name.endsWith('.partial')) {
        await lexiconDir.removeEntry(name).catch(() => {});
      }
    }
  } catch {
    // Ignore cleanup errors
  }

  return { ok: true, status: { state: 'idle' } };
}

// ─── Lexicon API Implementation ─────────────────────────────────────────────

const api: LexiconApi = {
  async init(onStatus: (status: LexiconStatus) => void): Promise<LexiconStatus> {
    try {
      // 1. Ensure dictionary file exists in OPFS
      const installResult = await ensureDictionaryInstalled(onStatus);
      if (!installResult.ok) {
        return installResult.status;
      }

      // 2. Initialize wa-sqlite and OPFSCoopSyncVFS if not already done
      if (!sqlite3 || db === null) {
        const module = await moduleFactory({
          locateFile: () => waSqliteWasmUrl,
        });
        sqlite3 = SQLite.Factory(module);
        vfs = await OPFSCoopSyncVFS.create('opfs-vfs', module);
        sqlite3.vfs_register(vfs, true);

        const opfsDbPath = `/lexicon/dictionary-${__DICTIONARY__.version}.sqlite`;
        db = await sqlite3.open_v2(opfsDbPath);

        // Enforce read-only access and cap SQLite page cache to 2 MiB
        await sqlite3.exec(db, 'PRAGMA query_only = 1; PRAGMA cache_size = -2048;');

        // Pre-prepare reusable statement for cold-path single word lookup
        for await (const stmt of sqlite3.statements(
          db,
          'SELECT lemma, cefr_level, meaning, ipa FROM words WHERE lemma = ? LIMIT 1;',
          { unscoped: true }
        )) {
          lookupStmt = stmt;
          break;
        }
      }

      // 3. Initialize wink-nlp once
      if (!nlpInstance) {
        nlpInstance = winkNLP(model);
        its = nlpInstance.its;
      }

      // 4. Query word count
      let wordCount = 0;
      await sqlite3.exec(db, 'SELECT COUNT(*) FROM words;', (row: any[]) => {
        wordCount = Number(row[0]);
      });

      const readyStatus: LexiconStatus = {
        state: 'ready',
        version: __DICTIONARY__.version,
        wordCount,
      };
      onStatus(readyStatus);
      return readyStatus;
    } catch (err: any) {
      const errorStatus: LexiconStatus = {
        state: 'error',
        message: err?.message || String(err),
      };
      onStatus(errorStatus);
      return errorStatus;
    }
  },

  async analyzePage(req: AnalyzePageRequest): Promise<AnalyzePageResult> {
    const cacheKey = `${req.docId}:${req.pageIndex}:${req.minLevel}`;
    const cached = getLruCache(cacheKey);
    if (cached) {
      // Return a copy of hits so transferring the buffer doesn't neuter the cached copy
      return Comlink.transfer(
        {
          ...cached,
          hits: new Uint32Array(cached.hits),
        },
        [cached.hits.buffer]
      );
    }

    if (!nlpInstance || !sqlite3 || db === null) {
      throw new Error('Lexicon worker is not initialized. Call init() first.');
    }

    const t0 = performance.now();
    const doc = nlpInstance.readDoc(req.text);
    let cursor = 0;

    interface TokenCandidate {
      start: number;
      end: number;
      lemma: string;
    }

    const candidates: TokenCandidate[] = [];
    const uniqueLemmas = new Set<string>();

    doc.tokens().each((t: any) => {
      const spaces = t.out(its.precedingSpaces);
      const val = t.out(its.value);
      cursor += spaces.length;
      const start = cursor;
      cursor += val.length;
      const end = cursor;

      if (t.out(its.type) === 'word' && !t.out(its.stopWordFlag)) {
        const rawLemma = t.out(its.lemma);
        const lemma = rawLemma
          .normalize('NFC')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase();

        if (lemma && lemma.length >= 2 && !/\d/.test(lemma)) {
          candidates.push({ start, end, lemma });
          uniqueLemmas.add(lemma);
        }
      }
    });

    const lemmaToCefr = new Map<string, CefrLevel>();

    if (uniqueLemmas.size > 0) {
      const allLemmas = Array.from(uniqueLemmas);
      const CHUNK_SIZE = 500;

      for (let i = 0; i < allLemmas.length; i += CHUNK_SIZE) {
        const chunk = allLemmas.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const sql = `SELECT lemma, cefr_level FROM words WHERE lemma IN (${placeholders}) AND cefr_level >= ?;`;

        for await (const stmt of sqlite3.statements(db, sql)) {
          for (let j = 0; j < chunk.length; j++) {
            sqlite3.bind_text(stmt, j + 1, chunk[j]);
          }
          sqlite3.bind_int(stmt, chunk.length + 1, req.minLevel);

          while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
            const l = sqlite3.column_text(stmt, 0);
            const c = sqlite3.column_int(stmt, 1) as CefrLevel;
            lemmaToCefr.set(l, c);
          }
        }
      }
    }

    const triplets: number[] = [];
    const matchedLemmas: string[] = [];

    for (const cand of candidates) {
      const cefr = lemmaToCefr.get(cand.lemma);
      if (cefr !== undefined && cefr >= req.minLevel) {
        triplets.push(cand.start, cand.end, cefr);
        matchedLemmas.push(cand.lemma);
      }
    }

    const hits = new Uint32Array(triplets);
    const elapsedMs = Math.round(performance.now() - t0);

    const result: AnalyzePageResult = {
      docId: req.docId,
      pageIndex: req.pageIndex,
      hits,
      lemmas: matchedLemmas,
      elapsedMs,
    };

    // Store in LRU cache with an independent buffer
    putLruCache(cacheKey, {
      ...result,
      hits: new Uint32Array(hits),
    });

    return Comlink.transfer(result, [result.hits.buffer]);
  },

  async analyzePageText(
    text: string,
    userCefrLevel: CefrLevel = CEFR.B1
  ): Promise<AnalyzePageTextResult> {
    if (!nlpInstance || !sqlite3 || db === null) {
      throw new Error('Lexicon worker is not initialized. Call init() first.');
    }

    const t0 = performance.now();

    // 1. Rebuild text across hyphenated line breaks and build character offset map
    const { recon, map } = joinHyphens(text);

    // 2. Lemmatize reconstructed text with wink-nlp
    const doc = nlpInstance.readDoc(recon);
    let cursor = 0;

    interface ReconCandidate {
      reconStart: number;
      reconEnd: number;
      lemma: string;
    }

    const candidates: ReconCandidate[] = [];
    const uniqueLemmas = new Set<string>();

    doc.tokens().each((t: any) => {
      const spaces = t.out(its.precedingSpaces);
      const val = t.out(its.value);
      cursor += spaces.length;
      const start = cursor;
      cursor += val.length;
      const end = cursor;

      if (t.out(its.type) === 'word' && !t.out(its.stopWordFlag)) {
        const rawLemma = t.out(its.lemma);
        const lemma = rawLemma
          .normalize('NFC')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase();

        if (lemma && lemma.length >= 2 && !/\d/.test(lemma)) {
          candidates.push({ reconStart: start, reconEnd: end, lemma });
          uniqueLemmas.add(lemma);
        }
      }
    });

    // 3. Batch query covering index in SQLite
    const lemmaToCefr = new Map<string, CefrLevel>();

    if (uniqueLemmas.size > 0) {
      const allLemmas = Array.from(uniqueLemmas);
      const CHUNK_SIZE = 500;

      for (let i = 0; i < allLemmas.length; i += CHUNK_SIZE) {
        const chunk = allLemmas.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        const sql = `SELECT lemma, cefr_level FROM words WHERE lemma IN (${placeholders}) AND cefr_level >= ?;`;

        for await (const stmt of sqlite3.statements(db, sql)) {
          for (let j = 0; j < chunk.length; j++) {
            sqlite3.bind_text(stmt, j + 1, chunk[j]);
          }
          sqlite3.bind_int(stmt, chunk.length + 1, userCefrLevel);

          while ((await sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
            const l = sqlite3.column_text(stmt, 0);
            const c = sqlite3.column_int(stmt, 1) as CefrLevel;
            lemmaToCefr.set(l, c);
          }
        }
      }
    }

    // 4. Map hits back to original text character coordinates
    const hits: TextHit[] = [];

    for (const cand of candidates) {
      const cefr = lemmaToCefr.get(cand.lemma);
      if (cefr !== undefined && cefr >= userCefrLevel) {
        const origStart = map[cand.reconStart];
        const origEnd = map[cand.reconEnd - 1] + 1;
        hits.push({
          start: origStart,
          end: origEnd,
          cefr,
          lemma: cand.lemma,
        });
      }
    }

    const elapsedMs = Math.round(performance.now() - t0);
    return { hits, elapsedMs };
  },

  async lookup(lemma: string): Promise<WordEntry | null> {
    if (!db || !lookupStmt || !sqlite3) {
      throw new Error('Lexicon worker is not initialized. Call init() first.');
    }

    const normalized = lemma.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

    await sqlite3.reset(lookupStmt);
    await sqlite3.clear_bindings(lookupStmt);
    sqlite3.bind_text(lookupStmt, 1, normalized);

    const stepResult = await sqlite3.step(lookupStmt);
    if (stepResult === SQLite.SQLITE_ROW) {
      const resLemma = sqlite3.column_text(lookupStmt, 0);
      const resCefr = sqlite3.column_int(lookupStmt, 1) as CefrLevel;
      const resMeaning = sqlite3.column_text(lookupStmt, 2);
      const resIpa = sqlite3.column_text(lookupStmt, 3) || null;

      await sqlite3.reset(lookupStmt);

      return {
        lemma: resLemma,
        cefr: resCefr,
        meaning: resMeaning,
        ipa: resIpa,
      };
    }

    await sqlite3.reset(lookupStmt);
    return null;
  },

  async getTranslation(lemma: string): Promise<WordEntry | null> {
    return this.lookup(lemma);
  },

  async dispose(): Promise<void> {
    lruCache.clear();

    if (lookupStmt && sqlite3) {
      try {
        await sqlite3.finalize(lookupStmt);
      } catch {
        // Ignore finalize error
      }
      lookupStmt = null;
    }

    if (db !== null && sqlite3) {
      try {
        await sqlite3.close(db);
      } catch {
        // Ignore close error
      }
      db = null;
    }

    if (vfs) {
      try {
        await vfs.close?.();
      } catch {
        // Ignore VFS close error
      }
      vfs = null;
    }

    sqlite3 = null;
    nlpInstance = null;
    its = null;
  },
};

Comlink.expose(api);
