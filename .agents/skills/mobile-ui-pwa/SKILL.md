---
name: mobile-ui-pwa
description: >-
  Mobile UI & PWA Expert for the E-Dic Reader project. Use this skill whenever a task
  touches React components, Tailwind CSS v4 styling, the dictionary Bottom Sheet, touch
  gestures, iOS Safari quirks (zoom, callouts, safe areas, standalone mode), Text-to-Speech,
  the web app manifest, icons, or the vite-plugin-pwa / Workbox service worker.
---

# Mobile UI & PWA Expert

Goal: feels like a native iOS app, works 100% offline after the first load.

## Hard constraints

1. **Mobile-first, touch-first.** Every interactive element ≥ **44×44 CSS px**
   (`min-block-size`/`min-inline-size` or the `tap` utility in `src/index.css`).
   Design at 375 px width first; enhance upward with container/media queries.
2. **Bottom Sheet** for the dictionary: GPU-only animation (`translate`/`opacity`),
   drag-to-dismiss with `touch-action: pan-x` on the grabber area (vertical drag handled by us),
   snap points, backdrop tap closes, `Escape` closes, focus moves into the sheet and returns
   on close, respects `prefers-reduced-motion`, padded by `env(safe-area-inset-bottom)`.
   Use `<dialog>` semantics or `role="dialog"` + `aria-modal`.
3. **iOS behaviors to neutralize** (never via `user-scalable=no` — iOS ignores it):
   - Double-tap zoom → `touch-action: manipulation` on the app shell.
   - Long-press callout on chrome → `-webkit-touch-callout: none` (chrome only).
   - Tap flash → `-webkit-tap-highlight-color: transparent`.
   - Rubber-band behind sheets → `overscroll-behavior: contain` on scroll containers.
   - Input auto-zoom → form controls use `font-size >= 16px`.
   - NEVER `user-select: none` on readable text.
4. **Layout units:** `dvh`/`svh` (never `vh`), `env(safe-area-inset-*)` with
   `viewport-fit=cover`, logical properties, `rem` font sizes.
5. **Theming:** tokens live in `src/index.css` `@theme` (Tailwind v4 CSS-first — there is
   NO `tailwind.config.js`). `color-scheme: light dark` + `light-dark()` for dark mode.
   No CDN fonts — system stack only (SF Pro on iOS, zero bytes).
6. **TTS:** `speechSynthesis.speak()` synchronously inside the tap handler; pick an
   `en-US`/`en-GB` voice preloaded via `voiceschanged`; cancel any utterance before a new one.

## PWA / Service Worker rules

- `vite-plugin-pwa` with `strategies: 'generateSW'`, `registerType: 'prompt'` — the SW never
  swaps under a reading user; `src/features/pwa/UpdateToast.tsx` asks to reload.
- `workbox.maximumFileSizeToCacheInBytes = 8 MiB`; `globPatterns` must include
  `js,mjs,css,html,svg,png,webmanifest,wasm,bcmap,pfb,ttf,icc`.
- `.sqlite` is **excluded** from precache (it lives in OPFS — see data-nlp-engineer skill).
- No runtime requests to third-party origins. If a new asset type is added, extend
  `globPatterns` AND verify it appears in `dist/sw.js` precache manifest.
- Icons are generated from `public/favicon.svg` by `pwa-assets.config.ts`
  (`pwaAssets` option) — do not hand-maintain PNGs.

## Validation checklist

- [ ] `npm run build && npm run preview` → DevTools → Application → Service Worker active,
      Cache Storage lists wasm/worker/model chunks; toggle **Offline** → full reload works.
- [ ] Lighthouse PWA installability passes; manifest icons resolve.
- [ ] iPhone (real device or Simulator): Add to Home Screen → launches standalone, status bar
      readable, no content under the notch/home indicator, double-tap does not zoom.
