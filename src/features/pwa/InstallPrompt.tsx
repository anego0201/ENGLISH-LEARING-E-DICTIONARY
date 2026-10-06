/**
 * iOS Add-to-Home-Screen (A2HS) Prompt component.
 * Appears ONLY when running in mobile iOS/iPadOS Safari and NOT already in standalone mode.
 * Provides clear visual instructions with the Apple Share icon to install offline.
 */
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'e_dic_a2hs_dismissed';
const DISMISS_DAYS = 7;

export function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // 1. Detect if already running in standalone mode (installed PWA)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;

    if (isStandalone) {
      return;
    }

    // 2. Detect iOS / iPadOS Safari (including iPadOS 13+ desktop-class user agent)
    const ua = window.navigator.userAgent;
    const isIos =
      /iphone|ipad|ipod/i.test(ua) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

    // Only target WebKit/Safari (exclude Chrome/Firefox on iOS if desirable, or show for iOS webkit)
    const isSafari =
      /safari/i.test(ua) && !/crios|fxios|opios|edgios/i.test(ua);

    if (!isIos || !isSafari) {
      return;
    }

    // 3. Check dismissal cool-down in localStorage
    try {
      const dismissedTimestamp = localStorage.getItem(STORAGE_KEY);
      if (dismissedTimestamp) {
        const elapsedDays =
          (Date.now() - parseInt(dismissedTimestamp, 10)) / (1000 * 60 * 60 * 24);
        if (elapsedDays < DISMISS_DAYS) {
          return;
        }
      }
    } catch {
      // Ignore storage errors in private browsing
    }

    // Show prompt after a short delay for smooth onboarding
    const timer = setTimeout(() => {
      setShowPrompt(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
      // Ignore storage errors
    }
  };

  if (!showPrompt) return null;

  return (
    <aside
      aria-label="Install App"
      className="chrome pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-safe"
    >
      <div className="pointer-events-auto mx-4 flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-hairline bg-surface/95 p-3.5 shadow-2xl backdrop-blur-2xl transition-all duration-300 animate-sheet-in dark:bg-surface-raised/95">
        <div className="flex items-center gap-3">
          {/* Apple Share Icon Box */}
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/25">
            <svg
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          </div>

          {/* Instructions */}
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-ink">
              Install for Offline Reading
            </p>
            <p className="text-[11px] text-ink-muted leading-tight">
              Tap the Share button below and select{' '}
              <span className="font-semibold text-ink">"Add to Home Screen"</span>.
            </p>
          </div>
        </div>

        {/* Dismiss Button */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss installation prompt"
          className="tap flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-ink-muted hover:text-ink active:scale-95 transition-transform"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
