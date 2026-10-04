import { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import { getLexicon } from './lib/lexicon-client';
import {
  CEFR_LABEL,
  type CefrLevel,
  type LexiconStatus,
  type TextHit,
  type WordEntry,
} from './shared/lexicon-contract';
import { UpdateToast } from './features/pwa/UpdateToast';
import { PdfViewer } from './features/reader/PdfViewer';

type AppTab = 'reader' | 'diagnostic';

export default function App() {
  const [status, setStatus] = useState<LexiconStatus>({ state: 'idle' });
  const [activeTab, setActiveTab] = useState<AppTab>('reader');

  // Selected word translation state (prep for Task 4 Bottom Sheet)
  const [selectedWord, setSelectedWord] = useState<WordEntry | null>(null);

  // Diagnostic tester state
  const [testText, setTestText] = useState(
    'This is an accurate and compre-\nhensive analysis of an inevitable, subtle, and ubi-\nquitous phenomenon.'
  );
  const [hits, setHits] = useState<TextHit[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
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

  const handleDiagnosticAnalyze = async () => {
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

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      {/* App Header */}
      <header className="chrome sticky top-0 z-30 flex items-center justify-between border-b border-hairline bg-surface/85 px-safe px-4 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8 rounded-lg" />
          <h1 className="text-base font-semibold tracking-tight">E-Dic Reader</h1>

          {/* View Tab Switcher */}
          <div className="ml-2 hidden rounded-xl bg-canvas p-0.5 sm:flex">
            <button
              type="button"
              onClick={() => setActiveTab('reader')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                activeTab === 'reader'
                  ? 'bg-surface font-semibold shadow-xs text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              PDF Reader
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('diagnostic')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                activeTab === 'diagnostic'
                  ? 'bg-surface font-semibold shadow-xs text-ink'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Diagnostic
            </button>
          </div>
        </div>

        {/* Database Status Badge */}
        <div className="flex items-center gap-2">
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
              DB Error
            </span>
          )}
          {status.state === 'idle' && (
            <span className="text-xs text-ink-muted">Booting...</span>
          )}
        </div>
      </header>

      {/* Main View Area */}
      {activeTab === 'reader' ? (
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <PdfViewer
            onWordSelect={(entry) => setSelectedWord(entry)}
            activeLemma={selectedWord?.lemma}
          />

          {/* Word Detail Card (Simulates Bottom Sheet on Tap - Prep for Task 4) */}
          {selectedWord && (
            <div className="chrome fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-md rounded-2xl border border-hairline bg-surface/95 p-4 shadow-xl backdrop-blur-xl animate-sheet-in">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-lg font-bold capitalize text-ink">
                      {selectedWord.lemma}
                    </h3>
                    {selectedWord.ipa && (
                      <span className="text-xs font-mono text-ink-muted">
                        /{selectedWord.ipa}/
                      </span>
                    )}
                  </div>
                  <span className="mt-1 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-bold text-accent">
                    CEFR {CEFR_LABEL[selectedWord.cefr]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedWord(null)}
                  className="tap flex size-7 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-muted hover:text-ink active:scale-95"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink text-pretty">
                {selectedWord.meaning}
              </p>
              <div className="mt-2 border-t border-hairline pt-2 text-[10px] text-ink-muted">
                Tip: Full gesture-dismissible Bottom Sheet & TTS will land in Task 4.
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Diagnostic Panel */
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-start gap-6 px-safe px-4 py-8">
          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold tracking-tight">Lexicon Diagnostic</h2>
            <p className="text-xs text-ink-muted">
              Test tokenization, hyphen joining, and SQLite covering queries directly.
            </p>
          </div>

          <section className="w-full rounded-2xl border border-hairline bg-surface p-5 shadow-sm space-y-4 text-left">
            <div className="space-y-1.5">
              <label htmlFor="diagInput" className="text-xs font-medium text-ink-muted">
                Input Text:
              </label>
              <textarea
                id="diagInput"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-hairline bg-canvas p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent font-sans"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleDiagnosticAnalyze}
                disabled={status.state !== 'ready' || analyzing}
                className="tap chrome rounded-xl bg-accent px-4 py-2 text-sm font-medium text-accent-ink shadow-sm transition hover:opacity-90 active:scale-98 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing in Worker...' : 'Analyze Text with Worker'}
              </button>
              {elapsed !== null && (
                <span className="text-xs text-ink-muted">Processed in {elapsed} ms</span>
              )}
            </div>

            {hits.length > 0 && (
              <div className="space-y-2 border-t border-hairline pt-3">
                <span className="text-xs font-semibold text-ink-muted">
                  Detected Words ({hits.length}):
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
                      <span
                        key={`${hit.lemma}-${idx}`}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold shadow-xs flex items-center gap-1.5 ${levelClass}`}
                      >
                        <span>{hit.lemma}</span>
                        <span className="rounded bg-black/20 dark:bg-white/20 px-1 py-0.2 text-[10px]">
                          {CEFR_LABEL[cefrLevel]}
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      <UpdateToast />
    </div>
  );
}
