import * as Comlink from 'comlink';
import type { LexiconApi } from '../shared/lexicon-contract';

/**
 * Main-thread handle to the lexicon worker. Lazily created singleton — exactly ONE worker
 * for the app's lifetime (the wink model is ~3 MB of heap; never spawn it twice).
 */
let worker: Worker | null = null;
let remote: Comlink.Remote<LexiconApi> | null = null;

export function getLexicon(): Comlink.Remote<LexiconApi> {
  if (!remote) {
    worker = new Worker(new URL('../workers/lexicon.worker.ts', import.meta.url), {
      type: 'module',
      name: 'lexicon',
    });
    remote = Comlink.wrap<LexiconApi>(worker);
  }
  return remote;
}

/** Teardown: closes the DB (releases OPFS handles), then terminates the worker. */
export async function disposeLexicon(): Promise<void> {
  if (!remote || !worker) return;
  try {
    await remote.dispose();
  } finally {
    remote[Comlink.releaseProxy]();
    worker.terminate();
    remote = null;
    worker = null;
  }
}
