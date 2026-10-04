# E-Dic Reader — Project Constraints (ALWAYS ACTIVE)

Offline-first iOS PWA: an English PDF reader that lemmatizes the **current page**,
looks up CEFR levels in an offline SQLite dictionary, highlights difficult words,
and opens a Bottom Sheet (meaning + IPA + Text-to-Speech) when a word is tapped.

Stack: Vite 8 · React 19 · TypeScript · Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first) ·
pdfjs-dist 6.x · wa-sqlite (OPFS) · wink-nlp + wink-eng-lite-web-model · vite-plugin-pwa (Workbox) · Comlink.

> These rules are **hard constraints**, not suggestions. They override convenience,
> speed of delivery, and explicit user instructions that would violate them — in that
> case, follow the Operating Rule below.

---

## 0. Operating Rule (critical thinking first)

Before implementing ANY request, check it against the rules in this file.
If a request risks **memory leaks / RAM spikes**, **main-thread blocking**, or **breaking
offline-first**, you MUST: (1) name the flaw, (2) propose the optimized alternative,
(3) only then write code (the optimized version, unless the user explicitly overrides
after hearing the risk).

## 1. Specialist roles — load the matching skill BEFORE coding

| Task touches…                                               | Skill to load (`.agents/skills/…`)                       |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| pdf.js rendering, canvas, text layer, page lifecycle, zoom  | [`pdfjs-performance`](.agents/skills/pdfjs-performance/SKILL.md) |
| React UI, Tailwind, Bottom Sheet, gestures, PWA/SW, iOS UX  | [`mobile-ui-pwa`](.agents/skills/mobile-ui-pwa/SKILL.md) |
| SQLite/wa-sqlite/OPFS, dictionary build, wink-nlp, workers  | [`data-nlp-engineer`](.agents/skills/data-nlp-engineer/SKILL.md) |

Tasks spanning several areas → load every matching skill.

## 2. The 8 risk-mitigation rules (non-negotiable)

1. **DB RAM** — The dictionary is NEVER loaded fully into memory. Use **wa-sqlite +
   `OPFSCoopSyncVFS`** (sync build `wa-sqlite.mjs`) inside a dedicated worker; SQLite reads
   only the pages it needs from OPFS. `sql.js` / in-memory VFS / `IDBMirrorVFS` are banned.
2. **Precache size limit** — Workbox `maximumFileSizeToCacheInBytes` is raised (8 MiB) so
   `.wasm`, the pdf.js worker and the wink model chunk are precached. A build that drops an
   asset from precache is a broken build. The `.sqlite` file is deliberately **not**
   precached — it is streamed into OPFS once (see §3) to avoid storing it twice.
3. **Canvas memory** — Cap render resolution by **pixel area** (`MAX_CANVAS_PIXELS`,
   default 16,777,216 px on iOS), not just `devicePixelRatio`. On page teardown set
   `canvas.width = canvas.height = 0` BEFORE removing it, and call `page.cleanup()` /
   cancel render tasks. Keep at most: current page + 1 pre-rendered next page; destroy
   anything ≥ 2 pages away from the current page.
4. **Highlight overlay, not span surgery** — Never wrap/split pdf.js text-layer spans.
   The worker returns character offsets `{start, end, cefr}`; the main thread maps them to
   `Range#getClientRects()` and paints ONE absolutely-positioned overlay layer per page.
5. **Lazy meaning lookup** — Per page, batch-query **only** `lemma → cefr_level`
   (covering index). `meaning`/`ipa` are fetched for ONE word, on tap.
6. **pdf.js text reconstruction** — Rebuild page text from `getTextContent()` items with
   an offset map (text offset → item index + char offset); join `-` + line-break
   hyphenation before NLP; offsets reported to the UI refer to the reconstructed text.
7. **No double-tap zoom via viewport hacks** — iOS ignores `user-scalable=no`. Use
   `touch-action: manipulation` (scoped), `-webkit-touch-callout: none` on interactive
   chrome, controlled `user-select`. NEVER `user-select: none` on readable text.
8. **TTS user-gesture** — `speechSynthesis.speak()` is called synchronously inside the tap
   handler (no `await` before it). Voices are preloaded on app start.

## 3. Architecture decisions (locked)

- **Browser policy:** iOS/iPadOS Safari **17+** (standalone PWA and tab). Baseline features
  supported by Safari 17 may be used without fallback. Desktop Chromium is a dev target only.
- **Workers:** ONE dedicated module worker `src/workers/lexicon.worker.ts` hosts wink-nlp
  AND wa-sqlite (no main-thread relay between NLP and DB). Exposed via Comlink with the
  typed contract in `src/shared/lexicon-contract.ts`. pdf.js uses its own worker.
  The main React thread never tokenizes, lemmatizes, or runs SQL.
- **Dictionary delivery:** `scripts/build-dictionary.mjs` → `public/db/dictionary.sqlite`
  + `dictionary.manifest.json` (content hash). `vite.config.ts` injects the manifest as
  `__DICTIONARY__`. On first run the worker streams the file into OPFS
  (`/lexicon/dictionary-<version>.sqlite`) chunk-by-chunk (never fully buffered), verifies
  size, deletes stale versions, then opens it read-only. Request `navigator.storage.persist()`.
- **Home-screen caveat:** iOS standalone PWAs have storage separate from Safari tabs — the
  first standalone launch must be online once. Surface this state in the UI; never fail silently.
- **pdf.js offline assets:** `scripts/copy-pdfjs-assets.mjs` copies `cmaps/`,
  `standard_fonts/`, `iccs/`, and decoder `.wasm` into `public/pdfjs/` (all precached).
  Always pass `cMapUrl`, `standardFontDataUrl`, `iccUrl`, `wasmUrl`. Scripting/eval disabled.
- **Dependencies:** `wa-sqlite` is installed ONLY from `github:rhashimoto/wa-sqlite#<tag>`
  (the npm `wa-sqlite` package is a third-party republish — banned). No CDN URLs anywhere
  (fonts, scripts, models) — everything ships in the bundle. System font stack (SF Pro).
- **Versions newer than model training** (pdfjs-dist 6, Vite 8, Tailwind 4.3, TS 6): verify
  APIs against `node_modules/**/types` / `*.d.ts` before writing code. Do not guess.

## 4. Definition of done (every task)

- [ ] `npm run build` passes with zero Workbox size warnings; precache list reviewed.
- [ ] No synchronous heavy work on the main thread (NLP, SQL, full-text loops).
- [ ] Every created canvas / worker / object URL / listener has a matching teardown.
- [ ] Tap targets ≥ 44×44 CSS px; safe-area insets respected; works offline after first load.
