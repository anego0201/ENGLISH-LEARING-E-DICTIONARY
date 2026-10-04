/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />
/// <reference types="vite-plugin-pwa/info" />

/** Injected by vite.config.ts from public/db/dictionary.manifest.json. */
declare const __DICTIONARY__: {
  /** Content hash of dictionary.sqlite — the OPFS file name suffix. */
  readonly version: string;
  readonly schemaVersion: number;
  readonly bytes: number;
  /** Relative to BASE_URL, e.g. "db/dictionary.sqlite". */
  readonly url: string;
};

declare const __DEV__: boolean;
