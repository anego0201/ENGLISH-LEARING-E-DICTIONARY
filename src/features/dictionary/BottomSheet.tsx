/**
 * Apple HIG-inspired Dictionary Bottom Sheet with iOS drag-to-dismiss gesture,
 * CEFR badges, IPA pronunciation, shimmer loading state, and synchronous Rule 8 TTS.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  CEFR_LABEL,
  type CefrLevel,
  type WordEntry,
} from '../../shared/lexicon-contract';
import { isTTSSupported, speakWord, stopSpeech } from '../../lib/tts';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  entry: WordEntry | null;
  isLoading?: boolean;
  fallbackLemma?: string | null;
  fallbackCefr?: CefrLevel | null;
}

function getCefrBadgeClass(level: CefrLevel): string {
  switch (level) {
    case 1:
    case 2:
      return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 3:
      return 'bg-cefr-b1 text-amber-900 dark:text-amber-200 border-amber-500/30';
    case 4:
      return 'bg-cefr-b2 text-orange-950 dark:text-orange-200 border-orange-500/30';
    case 5:
      return 'bg-cefr-c1 text-rose-950 dark:text-rose-200 border-rose-500/30';
    case 6:
      return 'bg-cefr-c2 text-purple-950 dark:text-purple-200 border-purple-500/30';
    default:
      return 'bg-accent/20 text-accent border-accent/30';
  }
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  entry,
  isLoading = false,
  fallbackLemma,
  fallbackCefr,
}) => {
  const [dragOffset, setDragOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);

  const startYRef = useRef<number>(0);
  const currentYRef = useRef<number>(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const lemma = entry?.lemma || fallbackLemma || '';
  const cefr = entry?.cefr || fallbackCefr || null;

  // Accessibility: Save and restore focus, listen to Escape key
  useEffect(() => {
    if (!isOpen) {
      previousFocusRef.current?.focus?.();
      return;
    }

    previousFocusRef.current = document.activeElement as HTMLElement;
    sheetRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      stopSpeech();
      setIsSpeaking(false);
    };
  }, [isOpen, onClose]);

  const handleDismiss = () => {
    setDragOffset(0);
    setIsDragging(false);
    onClose();
  };

  if (!isOpen) return null;

  // Touch Drag-to-Dismiss handlers (touch-action: pan-x on grabber area)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      startYRef.current = e.touches[0].clientY;
      currentYRef.current = e.touches[0].clientY;
      setIsDragging(true);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startYRef.current;
    currentYRef.current = currentY;

    // Only allow dragging downwards
    if (deltaY > 0) {
      setDragOffset(deltaY);
    } else {
      // Elastic resistance when dragging upwards
      setDragOffset(deltaY * 0.15);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);

    // Dismiss if pulled down by more than 75px
    if (dragOffset > 75) {
      handleDismiss();
    } else {
      // Snap back to 0
      setDragOffset(0);
    }
  };

  // Rule 8: Synchronous speech invocation inside click handler
  const handleSpeakClick = () => {
    if (!lemma) return;

    setIsSpeaking(true);
    const spoken = speakWord(lemma, {
      onEnd: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });

    if (!spoken) {
      setIsSpeaking(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-visibility duration-200 ${
        isOpen ? 'pointer-events-auto' : 'pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      {/* Backdrop overlay */}
      <div
        onClick={handleDismiss}
        className={`fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-250 ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Floating Bottom Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bottomsheet-lemma"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: `translate3d(0, ${Math.max(0, dragOffset)}px, 0)`,
          transition: isDragging ? 'none' : 'transform 320ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        className={`chrome relative z-50 w-full max-w-lg rounded-t-[1.5rem] border-t border-hairline bg-surface/95 px-5 pt-2 pb-safe shadow-sheet backdrop-blur-2xl transition-all duration-300 dark:bg-surface-raised/95 ${
          isOpen ? 'animate-sheet-in' : 'translate-y-full'
        }`}
      >
        {/* Grabber Handle & Drag Zone */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="flex cursor-grab flex-col items-center py-2 active:cursor-grabbing"
          style={{ touchAction: 'pan-x' }}
        >
          <div className="h-1.5 w-12 rounded-full bg-ink-muted/30 transition-colors hover:bg-ink-muted/50" />
        </div>

        {/* Sheet Top Bar: Word Header + Actions */}
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2
                id="bottomsheet-lemma"
                className="truncate text-2xl font-bold tracking-tight text-ink capitalize"
              >
                {lemma || 'Loading...'}
              </h2>

              {/* CEFR Level Badge */}
              {cefr && (
                <span
                  className={`inline-flex items-center rounded-lg border px-2.5 py-0.5 text-xs font-bold tracking-wide shadow-2xs ${getCefrBadgeClass(
                    cefr
                  )}`}
                >
                  CEFR {CEFR_LABEL[cefr]}
                </span>
              )}
            </div>

            {/* IPA Pronunciation */}
            {isLoading ? (
              <div className="h-4 w-28 rounded bg-ink-muted/15 animate-pulse" />
            ) : entry?.ipa ? (
              <p className="font-mono text-sm tracking-wide text-ink-muted">
                /{entry.ipa}/
              </p>
            ) : null}
          </div>

          {/* Right Action Icons: TTS Speaker Button & Close Button */}
          <div className="flex items-center gap-1.5">
            {isTTSSupported() && (
              <button
                type="button"
                onClick={handleSpeakClick}
                disabled={!lemma}
                aria-label={`Listen to pronunciation for ${lemma}`}
                title="Listen to pronunciation"
                className={`tap flex size-11 items-center justify-center rounded-full transition-all duration-200 active:scale-90 ${
                  isSpeaking
                    ? 'bg-accent text-accent-ink shadow-md scale-105'
                    : 'bg-canvas text-accent hover:bg-accent/15 border border-hairline'
                }`}
              >
                {/* Speaker Audio Icon SVG */}
                <svg
                  className={`size-5 transition-transform ${isSpeaking ? 'scale-110' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  {isSpeaking && <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />}
                </svg>
              </button>
            )}

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close word details"
              className="tap flex size-11 items-center justify-center rounded-full bg-canvas text-ink-muted transition-colors hover:text-ink active:scale-90 border border-hairline"
            >
              <svg
                className="size-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Vietnamese Meaning Content Body */}
        <div className="mt-4 border-t border-hairline pt-3.5 pb-2">
          {isLoading ? (
            <div className="space-y-2 py-1">
              <div className="h-4 w-3/4 rounded bg-ink-muted/15 animate-pulse" />
              <div className="h-4 w-1/2 rounded bg-ink-muted/15 animate-pulse" />
            </div>
          ) : entry?.meaning ? (
            <div className="rounded-xl bg-canvas/60 p-3.5 border border-hairline/60">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted block mb-1">
                Vietnamese Meaning
              </span>
              <p className="text-base leading-relaxed font-normal text-ink text-pretty">
                {entry.meaning}
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-canvas/40 p-3.5 text-center text-xs text-ink-muted">
              Definition not found in offline dictionary.
            </div>
          )}
        </div>

        {/* Footer Subtext */}
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted/80">
          <span>Swipe down to dismiss</span>
          <span>Offline SQLite Dictionary</span>
        </div>
      </div>
    </div>
  );
};
