#!/usr/bin/env node
/**
 * Copies the pdf.js runtime assets that pdf.js fetches lazily at render time into
 * public/pdfjs/ so Workbox precaches them. Without these, PDFs that rely on CMaps,
 * non-embedded standard fonts, ICC profiles, or JPX/JBIG2 images fail OFFLINE.
 *
 * Deliberately NOT copied:
 *   - quickjs-eval.*            PDF JavaScript scripting is disabled (security + size)
 *   - *_nowasm_fallback.js      iOS 17+ always has WebAssembly; saves ~600 KB of precache
 *
 * Runs automatically via the `predev` / `prebuild` npm hooks. Output is git-ignored.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');

const DIRECTORIES = ['cmaps', 'standard_fonts', 'iccs'];
const WASM_KEEP = /\.wasm$|^LICENSE/;

await rm(dest, { recursive: true, force: true });
await mkdir(path.join(dest, 'wasm'), { recursive: true });

for (const dir of DIRECTORIES) {
  await cp(path.join(src, dir), path.join(dest, dir), { recursive: true });
}

const wasmFiles = (await readdir(path.join(src, 'wasm'))).filter(
  (f) => WASM_KEEP.test(f) && !f.startsWith('quickjs'),
);
for (const file of wasmFiles) {
  await cp(path.join(src, 'wasm', file), path.join(dest, 'wasm', file));
}

console.log(`✔ pdf.js assets → public/pdfjs (${DIRECTORIES.join(', ')}, wasm: ${wasmFiles.filter((f) => f.endsWith('.wasm')).join(', ')})`);
