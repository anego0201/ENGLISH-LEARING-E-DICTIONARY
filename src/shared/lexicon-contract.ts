/**
 * Typed contract between the main thread and `src/workers/lexicon.worker.ts` (Comlink).
 * The worker hosts BOTH wink-nlp and wa-sqlite; the main thread never tokenizes or runs SQL.
 */

/** CEFR levels stored as integers in SQLite (compact, index-friendly). */
export const CEFR = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 } as const;
export type CefrLevel = (typeof CEFR)[keyof typeof CEFR];
export const CEFR_LABEL: Record<CefrLevel, keyof typeof CEFR> = {
  1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2', 5: 'C1', 6: 'C2',
};

/** Lifecycle of the OPFS dictionary install (surfaced in the UI — never fail silently). */
export type LexiconStatus =
  | { state: 'idle' }
  | { state: 'installing'; receivedBytes: number; totalBytes: number }
  | { state: 'ready'; version: string; wordCount: number }
  /** iOS standalone first launch while offline: storage is separate from Safari. */
  | { state: 'needs-network' }
  | { state: 'error'; message: string };

export interface AnalyzePageRequest {
  docId: string;
  pageIndex: number;
  /** Reconstructed page text (hyphenation joined) — offsets below refer to this string. */
  text: string;
  /** Only words at or above this level are returned (default B1). */
  minLevel: CefrLevel;
}

/**
 * Hits are packed as a flat Uint32Array of [start, end, cefr] triplets — transferable,
 * no per-object structured-clone cost for hundreds of words.
 */
export interface AnalyzePageResult {
  docId: string;
  pageIndex: number;
  hits: Uint32Array;
  /** Lemma for each hit (same order as triplets) — needed for the on-tap lookup. */
  lemmas: string[];
  elapsedMs: number;
}

export interface WordEntry {
  lemma: string;
  cefr: CefrLevel;
  meaning: string;
  ipa: string | null;
}

/** Convenience hit format for direct raw text analysis. */
export interface TextHit {
  start: number;
  end: number;
  cefr: CefrLevel;
  lemma: string;
}

export interface AnalyzePageTextResult {
  hits: TextHit[];
  elapsedMs: number;
}

export interface LexiconApi {
  /** Idempotent: installs the DB into OPFS if needed, then opens it read-only. */
  init(onStatus: (status: LexiconStatus) => void): Promise<LexiconStatus>;
  /** Hot path: lemmatize + batch lemma→level lookup (covering index). */
  analyzePage(req: AnalyzePageRequest): Promise<AnalyzePageResult>;
  /** Convenience method: analyzes raw text (handles line hyphens) and returns word objects. */
  analyzePageText(text: string, userCefrLevel?: CefrLevel): Promise<AnalyzePageTextResult>;
  /** Cold path: meaning + IPA for ONE word, on tap. */
  lookup(lemma: string): Promise<WordEntry | null>;
  /** Alias for lookup (meaning + IPA for ONE word, on tap). */
  getTranslation(lemma: string): Promise<WordEntry | null>;
  /** Close the DB and release OPFS access handles. */
  dispose(): Promise<void>;
}
