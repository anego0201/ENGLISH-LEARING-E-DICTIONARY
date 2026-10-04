import { UpdateToast } from './features/pwa/UpdateToast';

/**
 * App shell (scaffold). The reader (pdf.js), highlight overlay and dictionary Bottom Sheet
 * are mounted here in later tasks.
 */
export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="chrome sticky top-0 z-10 flex items-center gap-2 border-b border-hairline bg-canvas/80 px-safe pt-safe pb-2 backdrop-blur-xl">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-8 rounded-lg" />
        <h1 className="flex-1 text-lg font-semibold tracking-tight">E-Dic Reader</h1>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-safe py-10 text-center">
        <div className="relative">
          <div className="absolute inset-0 -z-10 rounded-full bg-accent/25 blur-3xl" aria-hidden />
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-24 rounded-3xl shadow-xl" />
        </div>
        <div className="max-w-xs space-y-2">
          <h2 className="text-2xl font-bold tracking-tight text-balance">Read English, offline.</h2>
          <p className="text-ink-muted text-pretty">
            Open a PDF and difficult words are highlighted by CEFR level. Tap any word for its
            meaning and pronunciation.
          </p>
        </div>
        <ul className="chrome flex flex-wrap justify-center gap-2 text-xs font-semibold" aria-label="Highlight levels">
          <li className="rounded-full bg-cefr-b1 px-3 py-1">B1</li>
          <li className="rounded-full bg-cefr-b2 px-3 py-1">B2</li>
          <li className="rounded-full bg-cefr-c1 px-3 py-1">C1</li>
          <li className="rounded-full bg-cefr-c2 px-3 py-1">C2</li>
        </ul>
        <p className="text-xs text-ink-muted">
          Dictionary v{__DICTIONARY__.version.slice(0, 7)} · reader coming in the next task
        </p>
      </main>

      <UpdateToast />
    </div>
  );
}
