import { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import { getLexicon } from './lib/lexicon-client';
import { initTTS } from './lib/tts';
import {
  CEFR_LABEL,
  type CefrLevel,
  type LexiconStatus,
  type TextHit,
  type WordEntry,
} from './shared/lexicon-contract';
import { UpdateToast } from './features/pwa/UpdateToast';
import { PdfViewer } from './features/reader/PdfViewer';
import { BottomSheet } from './features/dictionary/BottomSheet';

type AppTab = 'reader' | 'diagnostic';

export default function App() {
  const [status, setStatus] = useState<LexiconStatus>({ state: 'idle' });
  const [activeTab, setActiveTab] = useState<AppTab>('reader');

  // Dictionary Bottom Sheet State (Task 4)
  const [isSheetOpen, setIsSheetOpen] = useState<boolean>(false);
  const [sheetLemma, setSheetLemma] = useState<string | null>(null);
  const [sheetCefr, setSheetCefr] = useState<CefrLevel | null>(null);
  const [sheetEntry, setSheetEntry] = useState<WordEntry | null>(null);
  const [isSheetLoading, setIsSheetLoading] = useState<boolean>(false);

  // Diagnostic tester state
  const [testText, setTestText] = useState(
    'This is an accurate and compre-\nhensive analysis of an inevitable, subtle, and ubi-\nquitous phenomenon.'
  );
  const [hits, setHits] = useState<TextHit[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    let unmounted = false;
    // Preload speech synthesis voices on startup (Rule 8)
    initTTS();

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
    setIsSheetOpen(false);
    setSheetEntry(null);
    setSheetLemma(null);
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
            onWordTap={(lemma, cefr) => {
              // 1. Immediately open bottom sheet (instant zero-lag UI feedback)
              setIsSheetOpen(true);
              setSheetLemma(lemma);
              setSheetCefr(cefr);
              setSheetEntry(null);
              setIsSheetLoading(true);
            }}
            onWordSelect={(entry) => {
              // 2. Populate full definition once SQLite query resolves
              setSheetEntry(entry);
              setIsSheetLoading(false);
            }}
            activeLemma={sheetLemma}
          />
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
                  Detected Words ({hits.length}) — tap to view definition & pronunciation:
                </span>
                <div className="flex flex-wrap gap-2">
                  {hits.map((hit, idx) => {
                    const cefrLevel = hit.cefr as CefrLevel;
                    const levelClass =
                      cefrLevel === 3
                        ? 'bg-cefr-b1 text-amber-950 dark:text-amber-100'
                        : cefrLevel === 4
                          ? 'bg-cefr-b2 text-orange-950 dark:text-orange-100'
                          : cefrLevel === 5
                            ? 'bg-cefr-c1 text-rose-950 dark:text-rose-100'
                            : 'bg-cefr-c2 text-purple-950 dark:text-purple-100';
                    return (
                      <button
                        key={`${hit.lemma}-${idx}`}
                        type="button"
                        onClick={async () => {
                          setIsSheetOpen(true);
                          setSheetLemma(hit.lemma);
                          setSheetCefr(hit.cefr);
                          setSheetEntry(null);
                          setIsSheetLoading(true);
                          try {
                            const lexicon = getLexicon();
                            const entry = await lexicon.getTranslation(hit.lemma);
                            setSheetEntry(entry);
                          } finally {
                            setIsSheetLoading(false);
                          }
                        }}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold shadow-xs flex items-center gap-1.5 transition active:scale-95 ${levelClass}`}
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
          </section>
        </main>
      )}

      {/* Dictionary Bottom Sheet (Task 4) */}
      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => {
          setIsSheetOpen(false);
          setSheetLemma(null);
          setSheetEntry(null);
        }}
        entry={sheetEntry}
        isLoading={isSheetLoading}
        fallbackLemma={sheetLemma}
        fallbackCefr={sheetCefr}
      />

      <UpdateToast />
    </div>
  );
}
