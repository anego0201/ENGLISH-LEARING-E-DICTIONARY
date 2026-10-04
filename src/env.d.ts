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

declare module 'wa-sqlite/dist/wa-sqlite.mjs' {
  export default function moduleFactory(options?: Record<string, unknown>): Promise<any>;
}

declare module 'wa-sqlite/src/examples/OPFSCoopSyncVFS.js' {
  export class OPFSCoopSyncVFS {
    static create(name: string, module: any): Promise<any>;
  }
}

declare module 'wa-sqlite/dist/wa-sqlite.wasm?url' {
  const url: string;
  export default url;
}

interface FileSystemSyncAccessHandle {
  close(): void;
  flush(): void;
  getSize(): number;
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(newSize: number): void;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
  move?(newEntryName: string): Promise<void>;
}
