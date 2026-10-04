/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Dictionary manifest produced by `npm run build:dict`.
 * Injected as the compile-time constant `__DICTIONARY__` so the lexicon worker knows
 * which OPFS version to expect WITHOUT a network round-trip (critical when offline).
 */
function loadDictionaryManifest() {
  const file = fileURLToPath(new URL('./public/db/dictionary.manifest.json', import.meta.url));
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as {
      schemaVersion: number;
      version: string;
      file: string;
      bytes: number;
      sha256: string;
      wordCount: number;
    };
  } catch {
    throw new Error(
      'public/db/dictionary.manifest.json not found — run `npm run build:dict` first.',
    );
  }
}

const MiB = 1024 * 1024;

export default defineConfig(({ command }) => {
  const dictionary = loadDictionaryManifest();

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'generateSW',
        // 'prompt': never swap the SW under a reading user — UpdateToast asks first.
        registerType: 'prompt',
        injectRegister: false, // registered from React via virtual:pwa-register/react
        // Icons + apple-touch-icon + <link> tags generated from public/favicon.svg.
        pwaAssets: { config: true, overrideManifestIcons: true, includeHtmlHeadLinks: true },
        manifest: {
          id: '/',
          name: 'E-Dic Reader',
          short_name: 'E-Dic',
          description: 'Offline English PDF reader that highlights difficult words by CEFR level.',
          lang: 'en',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          orientation: 'any',
          theme_color: '#0b1020',
          background_color: '#0b1020',
          categories: ['education', 'books'],
        },
        workbox: {
          // Rule #2 — default is 2 MiB, which would SILENTLY drop the wink model chunk
          // (~3 MB), wa-sqlite.wasm and the pdf.js worker from the offline cache.
          maximumFileSizeToCacheInBytes: 8 * MiB,
          globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest,wasm,bcmap,pfb,ttf,icc}'],
          // The dictionary lives in OPFS (streamed once by the worker). Precaching it too
          // would store it twice and force a full re-download on every SW update.
          globIgnores: ['**/db/*.sqlite', '**/db/*.manifest.json', '**/node_modules/**'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/db\//, /^\/pdfjs\//],
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
        },
        devOptions: {
          enabled: false, // test the SW with `npm run build && npm run preview`
          type: 'module',
        },
      }),
    ],

    define: {
      __DICTIONARY__: JSON.stringify({
        version: dictionary.version,
        schemaVersion: dictionary.schemaVersion,
        bytes: dictionary.bytes,
        url: `db/${dictionary.file}`,
      }),
      __DEV__: JSON.stringify(command === 'serve'),
    },

    worker: {
      // Module workers: needed for code-splitting the wink model + wa-sqlite inside the worker.
      format: 'es',
    },

    optimizeDeps: {
      // wa-sqlite resolves its .wasm via import.meta.url — pre-bundling breaks that path.
      exclude: ['wa-sqlite'],
    },

    build: {
      target: 'safari17',
      // Chunks above this are expected (wink model, pdf.js) and are precached explicitly.
      chunkSizeWarningLimit: 3500,
      assetsInlineLimit: (file) => (/\.(wasm|bcmap|pfb|ttf|icc)$/.test(file) ? false : undefined),
    },

    server: {
      host: true, // reachable from an iPhone on the same LAN
    },
  };
});
