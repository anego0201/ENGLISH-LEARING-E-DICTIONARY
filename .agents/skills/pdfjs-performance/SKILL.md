---
name: pdfjs-performance
description: >-
  PDF.js Performance Specialist for the E-Dic Reader project. Use this skill whenever a
  task touches pdf.js (pdfjs-dist) — loading documents, rendering pages to canvas, the
  text layer, word-highlight overlays, page navigation/virtualization, zoom, devicePixelRatio,
  or memory cleanup of pages on iOS Safari.
---

# PDF.js Performance Specialist

Goal: buttery page rendering on iPhone without ever tripping iOS Safari's memory killer.

## Hard constraints

1. **Never process the whole PDF.** Only the **current page** is rendered + text-extracted.
   Optionally pre-render **current + 1** (next page). Never loop over `numPages` for
   rendering or `getTextContent()`.
2. **Sliding window of ≤ 2 live pages.** Any page whose index is **≥ 2 away** from the
   current page is destroyed immediately (canvas, text layer, highlight overlay, listeners).
3. **Retina alignment.** Canvas backing store = CSS size × effective pixel ratio; the text
   layer and highlight overlay use the **same viewport** (CSS px) as the canvas's CSS box.
4. **Pixel-area cap.** `effectiveRatio = min(devicePixelRatio, sqrt(MAX_CANVAS_PIXELS / (cssW * cssH)))`
   with `MAX_CANVAS_PIXELS = 16_777_216` (iOS hard limit — beyond it the canvas renders blank).
5. **No span surgery.** pdf.js text-layer spans are never wrapped, split, or restyled per word.
   Highlights live in a separate overlay (see AGENTS.md rule 4).

## Page lifecycle (implement exactly this state machine)

```
idle → loading(page proxy) → rendering(RenderTask) → ready → destroyed
                ↑ cancel on navigation ↓
```

Teardown for a page slot, in this order:
1. `renderTask?.cancel()`; abort any pending `getTextContent` consumer (AbortController).
2. `textLayer?.cancel()`; remove text-layer + overlay children (`replaceChildren()`).
3. `canvas.width = 0; canvas.height = 0;` (releases Safari's GPU backing store), then remove node.
4. `page.cleanup()` (frees pdf.js page-level resources); drop the `PDFPageProxy` reference.
5. On document close: `await loadingTask.destroy()` / `pdfDocument.destroy()`.

Rapid page flips: debounce rendering ~100–150 ms and **cancel in-flight render tasks**
(`RenderingCancelledException` is expected — swallow it, never surface it).

## Required `getDocument` options (offline-first)

```ts
getDocument({
  data,                                    // ArrayBuffer from the user's file (or url for OPFS blob)
  cMapUrl: `${BASE}pdfjs/cmaps/`, cMapPacked: true,
  standardFontDataUrl: `${BASE}pdfjs/standard_fonts/`,
  iccUrl: `${BASE}pdfjs/iccs/`,
  wasmUrl: `${BASE}pdfjs/wasm/`,
  isEvalSupported: false, enableXfa: false,
})
```
Worker: `GlobalWorkerOptions.workerSrc = workerUrl` where
`import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` (precached by Workbox).

## Verify before coding

pdfjs-dist here is **6.x** — newer than model training data. Before using any API
(`page.render` params, `TextLayer`, `getTextContent` item shape, option names), confirm in
`node_modules/pdfjs-dist/types/src/display/api.d.ts` and `.../text_layer.d.ts`.

## Validation checklist

- [ ] Safari Web Inspector → Timelines → Memory stays flat while flipping 50+ pages.
- [ ] `document.querySelectorAll('canvas').length <= 2` at all times.
- [ ] Text selection rectangle matches glyphs at DPR 2 and 3 and after zoom.
- [ ] Fast swipe through 10 pages produces no console errors except swallowed cancellations.
