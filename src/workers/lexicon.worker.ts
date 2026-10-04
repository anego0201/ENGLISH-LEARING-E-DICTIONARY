/**
 * Lexicon worker — hosts wink-nlp AND wa-sqlite (OPFSCoopSyncVFS) in ONE dedicated
 * module worker. Scaffold only: the implementation lands in the data/NLP task
 * (see .agents/skills/data-nlp-engineer/SKILL.md for the required design).
 */
import * as Comlink from 'comlink';
import type {
  AnalyzePageRequest,
  AnalyzePageResult,
  LexiconApi,
  LexiconStatus,
  WordEntry,
} from '../shared/lexicon-contract';

const notImplemented = (what: string) =>
  new Error(`lexicon.worker: ${what} is not implemented yet (scaffold)`);

const api: LexiconApi = {
  async init(onStatus: (status: LexiconStatus) => void): Promise<LexiconStatus> {
    const status: LexiconStatus = { state: 'idle' };
    onStatus(status);
    return status;
  },
  async analyzePage(_req: AnalyzePageRequest): Promise<AnalyzePageResult> {
    throw notImplemented('analyzePage');
  },
  async lookup(_lemma: string): Promise<WordEntry | null> {
    throw notImplemented('lookup');
  },
  async dispose(): Promise<void> {},
};

Comlink.expose(api);
