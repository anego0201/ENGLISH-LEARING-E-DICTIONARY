---
name: data-nlp-engineer
description: >-
  Web Data & NLP Engineer for the E-Dic Reader project. Use this skill whenever a task
  touches the offline dictionary (schema, scripts/build-dictionary.mjs, SQLite queries,
  indexes), wa-sqlite / OPFS storage, wink-nlp tokenization or lemmatization, the
  lexicon Web Worker, Comlink messaging, or any heavy data processing.
---

# Web Data & NLP Engineer

Goal: hundreds of words per page analysed and looked up in < 50 ms, zero main-thread jank,
zero RAM growth with dictionary size.

## Hard constraints

1. **Worker-only.** Tokenizing, lemmatizing, and SQL run ONLY in
   `src/workers/lexicon.worker.ts` (dedicated module worker, Comlink-exposed, typed by
   `src/shared/lexicon-contract.ts`). Main thread sends page text; receives offsets.
2. **wa-sqlite + OPFSCoopSyncVFS** (sync build `wa-sqlite/dist/wa-sqlite.mjs` +
   `wa-sqlite.wasm?url`). No COOP/COEP needed (no SharedArrayBuffer). Open read-only:
   `PRAGMA query_only=1; PRAGMA cache_size=-2048` (≈2 MiB page cache cap).
3. **Streamed OPFS install.** `fetch(__DICTIONARY__.url)` → `response.body` reader →
   `FileSystemSyncAccessHandle.write(chunk, { at })` per chunk → `flush()` → verify
   `getSize() === __DICTIONARY__.bytes` → atomic switch (write to `*.partial`, then move/rename
   or write a `current` marker) → delete stale versions. Never `await res.arrayBuffer()`.
4. **Transfer, don't clone, big payloads.** Use Comlink `transfer()` for ArrayBuffers; send
   compact results (`Uint32Array` of `[start, end, cefr]` triplets) rather than object arrays
   when hit counts are large.

## Schema (owned by `scripts/build-dictionary.mjs`, schemaVersion = `PRAGMA user_version`)

```sql
CREATE TABLE words (
  id         INTEGER PRIMARY KEY,                 -- rowid; rows inserted in lemma order
  lemma      TEXT    NOT NULL,                    -- NFC, trimmed, lowercase; unique by construction
  cefr_level INTEGER NOT NULL CHECK (cefr_level BETWEEN 1 AND 6),  -- A1=1 … C2=6
  meaning    TEXT    NOT NULL,
  ipa        TEXT                                 -- stored WITHOUT surrounding slashes
) STRICT;
CREATE INDEX words_lemma_cefr ON words (lemma, cefr_level);  -- covering index for hot path
```

Query patterns (the build script asserts these plans — keep them):

| Path | SQL | Plan must say |
| --- | --- | --- |
| Hot (per page) | `SELECT lemma, cefr_level FROM words WHERE lemma IN (?, …) AND cefr_level >= ?` | `USING COVERING INDEX words_lemma_cefr` |
| Cold (on tap)  | `SELECT lemma, cefr_level, meaning, ipa FROM words WHERE lemma = ?` | `USING INDEX words_lemma_cefr` |

- Deduplicate lemmas in the worker before querying; chunk `IN` lists at ≤ 500 params.
- Prepare statements once per connection; `reset` + rebind, never re-prepare per page.
- Cache the page result keyed by `(docId, pageIndex)` (LRU, ≤ 5 pages).

## NLP rules (wink-nlp + wink-eng-lite-web-model)

- Load the model once in the worker (`winkNLP(model)`), ~3 MB — never in the main bundle.
- Use `its.lemma`, `its.type` (skip punctuation, numbers, URLs, emails), `its.normal`;
  lowercase the lemma to match the DB normalization (NFC + lowercase).
- Input is the reconstructed page text (AGENTS.md rule 6); output offsets map 1:1 to it
  (use token `its.span`/precedingSpaces bookkeeping — verify against wink-nlp types).
- Skip stop-words and A1–A2 (configurable threshold) before hitting SQL.

## Validation checklist

- [ ] `npm run build:dict` prints both query plans with COVERING/INDEX usage and
      `integrity_check = ok`.
- [ ] Performance panel: no main-thread task > 50 ms when a page is analysed.
- [ ] Worker heap stable across 50 page turns; OPFS contains exactly one dictionary version.
