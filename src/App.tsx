import { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import { getLexicon } from './lib/lexicon-client';
import { CEFR_LABEL, type CefrLevel, type LexiconStatus, type TextHit, type WordEntry } from './shared/lexicon-contract';
import { UpdateToast } from './features/pwa/UpdateToast';

export default function App() {
  const [status, setStatus] = useState<LexiconStatus>({ state: 'idle' });
  const [testText, setTestText] = useState(
    'This is an accurate and compre-\nhensive analysis of an inevitable, subtle, and ubi-\nquitous phenomenon.'
  );
  const [hits, setHits] = useState<TextHit[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedWord, setSelectedWord] = useState<WordEntry | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    let unmounted = false;
    const lexicon = getLexicon();

    lexicon
      .init(
        Comlink.proxy((newStatus: LexiconStatus) => {
          if (!unmounted) setStatus(newStatus);
        })
      )
      .catch((err) => {
        if (!unmounted) {
          setStatus({ state: 'error', message: err?.message || String(err) });
        }
      });

    return () => {
      unmounted = true;
    };
  }, []);

  const handleAnalyze = async () => {
    if (status.state !== 'ready' || analyzing) return;
    setAnalyzing(true);
    setSelectedWord(null);
    try {
      const lexicon = getLexicon();
      const res = await lexicon.analyzePageText(testText, 3); // minLevel B1 = 3
      setHits(res.hits);
      setElapsed(res.elapsedMs);
    } catch (err) {
      console.error('analyzePageText error:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleWordClick = async (lemma: string) => {
    try {
      const lexicon = getLexicon();
      const entry = await lexicon.getTranslation(lemma);
      setSelectedWord(entry);
    } catch (err) {
      console.error('getTranslation error:', err);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="chrome sticky top-0 z-10 flex items-center justify-between border-b border-hairline bg-surface/80 px-safe pt-safe pb-2 backdrop-blur-xl px-4">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8 rounded-lg" />
          <h1 className="text-lg font-semibold tracking-tight">E-Dic Reader</h1>
        </div>
        <div>
          {status.state === 'ready' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              DB Ready ({status.wordCount} words)
            </span>
          )}
          {status.state === 'installing' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              <span className="size-1.5 rounded-full bg-accent animate-ping" />
              Installing {Math.round((status.receivedBytes / status.totalBytes) * 100)}%
            </span>
          )}
          {status.state === 'needs-network' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              Needs network
            </span>
          )}
          {status.state === 'error' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
              Error
            </span>
          )}
          {status.state === 'idle' && (
            <span className="text-xs text-ink-muted">Booting...</span>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-start gap-6 px-safe px-4 py-8 max-w-xl mx-auto w-full">
        {status.state === 'installing' && (
          <div className="w-full rounded-2xl border border-hairline bg-surface p-4 shadow-sm space-y-2">
            <div className="flex justify-between text-xs text-ink-muted">
              <span>Streaming dictionary to OPFS...</span>
              <span>{(status.receivedBytes / 1024).toFixed(1)} / {(status.totalBytes / 1024).toFixed(1)} KiB</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-hairline">
              <div
                className="h-full bg-accent transition-all duration-200"
                style={{ width: `${(status.receivedBytes / status.totalBytes) * 100}%` }}
              />
            </div>
          </div>
        )}

        {status.state === 'needs-network' && (
          <div className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-700 dark:text-amber-300">
            <strong>First launch requires internet:</strong> Please connect to the network once so the offline dictionary can be saved into your device storage.
          </div>
        )}

        {status.state === 'error' && (
          <div className="w-full rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-700 dark:text-rose-300">
            <strong>Worker error:</strong> {status.message}
          </div>
        )}

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-balance">Task 2: Lexicon Web Worker</h2>
          <p className="text-ink-muted text-sm text-pretty">
            Hosts wa-sqlite (OPFS) and wink-nlp off the main thread. Test lemmatization, hyphen join, and dictionary lookup below.
          </p>
        </div>

        {/* Interactive Worker Test Card */}
        <section className="w-full rounded-2xl border border-hairline bg-surface p-5 shadow-sm space-y-4 text-left">
          <h3 className="text-sm font-semibold tracking-wide uppercase text-ink-muted">Worker Verification Test</h3>

          <div className="space-y-1.5">
            <label htmlFor="testInput" className="text-xs font-medium text-ink-muted">
              Input Text (supports hyphenated line breaks like <code className="bg-canvas px-1 py-0.5 rounded text-accent">deve-\nlopment</code>):
            </label>
            <textarea
              id="testInput"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-hairline bg-canvas p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-sans"
            />
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={status.state !== 'ready' || analyzing}
              className="tap chrome rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-sm transition hover:opacity-90 active:scale-98 disabled:opacity-50 disabled:pointer-events-none"
            >
              {analyzing ? 'Analyzing in Worker...' : 'Analyze Text with Worker'}
            </button>
            {elapsed !== null && (
              <span className="text-xs text-ink-muted">Processed in {elapsed} ms</span>
            )}
          </div>

          {/* Matched Hits */}
          {hits.length > 0 && (
            <div className="space-y-2 border-t border-hairline pt-3">
              <span className="text-xs font-semibold text-ink-muted">
                Detected CEFR Words ({hits.length}):
              </span>
              <div className="flex flex-wrap gap-2">
                {hits.map((hit, idx) => {
                  const cefrLevel = hit.cefr as CefrLevel;
                  const levelClass =
                    cefrLevel === 3
                      ? 'bg-cefr-b1'
                      : cefrLevel === 4
                        ? 'bg-cefr-b2'
                        : cefrLevel === 5
                          ? 'bg-cefr-c1'
                          : 'bg-cefr-c2';
                  return (
                    <button
                      key={`${hit.lemma}-${idx}`}
                      type="button"
                      onClick={() => handleWordClick(hit.lemma)}
                      className={`chrome rounded-lg px-2.5 py-1 text-xs font-semibold shadow-xs flex items-center gap-1.5 ${levelClass} hover:ring-2 hover:ring-accent transition`}
                    >
                      <span>{hit.lemma}</span>
                      <span className="rounded bg-black/20 dark:bg-white/20 px-1 py-0.2 text-[10px]">
                        {CEFR_LABEL[cefrLevel]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Word Detail Card (Simulates Bottom Sheet on Tap) */}
          {selectedWord && (
            <div className="rounded-xl border border-accent/30 bg-accent/5 p-3.5 space-y-1.5 animate-sheet-in">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <h4 className="text-base font-bold capitalize">{selectedWord.lemma}</h4>
                  {selectedWord.ipa && (
                    <span className="text-xs font-mono text-ink-muted">/{selectedWord.ipa}/</span>
                  )}
                </div>
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-ink">
                  {CEFR_LABEL[selectedWord.cefr]}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-pretty text-ink">
                {selectedWord.meaning}
              </p>
            </div>
          )}
        </section>

        <p className="text-xs text-ink-muted">
          Dictionary v{__DICTIONARY__.version.slice(0, 7)} · wa-sqlite OPFSCoopSyncVFS · wink-nlp
        </p>
      </main>

      <UpdateToast />
    </div>
  );
}
