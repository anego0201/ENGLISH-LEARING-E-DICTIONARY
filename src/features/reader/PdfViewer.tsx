/**
 * Core PDF Viewer component with sliding window virtualization,
 * page navigation, zoom scaling, CEFR level filtering, and touch gestures.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfDocument } from './pdf-init';
import { PdfPage } from './PdfPage';
import { CEFR, type CefrLevel, type WordEntry } from '../../shared/lexicon-contract';
import { getLexicon } from '../../lib/lexicon-client';

interface PdfViewerProps {
  initialSource?: string | ArrayBuffer;
  onWordSelect?: (entry: WordEntry | null) => void;
  activeLemma?: string | null;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  initialSource,
  onWordSelect,
  activeLemma,
}) => {
  const [docSource, setDocSource] = useState<string | ArrayBuffer | null>(
    initialSource || `${import.meta.env.BASE_URL}samples/sample.pdf`
  );
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.1);
  const [minCefr, setMinCefr] = useState<CefrLevel>(CEFR.B1);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string>('sample');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Load PDF document
  useEffect(() => {
    if (!docSource) return;

    let isCancelled = false;
    let loadingTask: any = null;

    async function load() {
      setLoading(true);
      setLoadError(null);

      try {
        loadingTask = loadPdfDocument(docSource!);
        const doc = await loadingTask.promise;
        if (isCancelled) {
          doc.destroy();
          return;
        }

        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setCurrentPage(1);
        setDocId(typeof docSource === 'string' ? docSource : `doc-${Date.now()}`);
        setLoading(false);
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Failed to load PDF document:', err);
          setLoadError(err?.message || 'Failed to load PDF document');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      isCancelled = true;
      if (loadingTask) {
        try {
          loadingTask.destroy();
        } catch {
          // Swallow destroy error
        }
      }
    };
  }, [docSource]);

  // Handle local file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        setDocSource(reader.result);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // Page navigation
  const goToPrev = () => {
    setCurrentPage((p) => Math.max(1, p - 1));
  };

  const goToNext = () => {
    setCurrentPage((p) => Math.min(numPages, p + 1));
  };

  // Zoom controls
  const zoomIn = () => setScale((s) => Math.min(2.5, Math.round((s + 0.15) * 100) / 100));
  const zoomOut = () => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100));
  const zoomReset = () => setScale(1.1);

  // Touch swipe gestures
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const diffX = endX - touchStartXRef.current;
    const diffY = endY - touchStartYRef.current;

    // Detect horizontal swipe (horizontal movement > 50px and larger than vertical)
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX < 0) {
        goToNext();
      } else {
        goToPrev();
      }
    }

    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  // Word tap lookup
  const handleWordTap = async (lemma: string, _cefr: CefrLevel) => {
    try {
      const lexicon = getLexicon();
      const entry = await lexicon.getTranslation(lemma);
      console.log(`[Task 3 Reader] Tapped word "${lemma}":`, entry);
      onWordSelect?.(entry);
    } catch (err) {
      console.error('Error fetching word translation:', err);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* Reader Toolbar */}
      <div className="chrome sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface/90 px-safe px-3 py-2 backdrop-blur-md">
        {/* Page navigation */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goToPrev}
            disabled={currentPage <= 1 || loading}
            aria-label="Previous Page"
            className="tap flex items-center justify-center rounded-xl bg-canvas px-3 py-1.5 text-sm font-semibold transition active:scale-95 disabled:opacity-40"
          >
            ←
          </button>
          <span className="min-w-20 text-center text-xs font-medium text-ink">
            {loading ? 'Loading...' : `Page ${currentPage} / ${numPages || 1}`}
          </span>
          <button
            type="button"
            onClick={goToNext}
            disabled={currentPage >= numPages || loading}
            aria-label="Next Page"
            className="tap flex items-center justify-center rounded-xl bg-canvas px-3 py-1.5 text-sm font-semibold transition active:scale-95 disabled:opacity-40"
          >
            →
          </button>
        </div>

        {/* CEFR Level Filter */}
        <div className="flex items-center gap-1 text-xs">
          <span className="hidden text-ink-muted sm:inline">Highlight:</span>
          {(
            [
              { label: 'B1+', level: CEFR.B1, color: 'bg-cefr-b1' },
              { label: 'B2+', level: CEFR.B2, color: 'bg-cefr-b2' },
              { label: 'C1+', level: CEFR.C1, color: 'bg-cefr-c1' },
              { label: 'C2', level: CEFR.C2, color: 'bg-cefr-c2' },
            ] as const
          ).map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setMinCefr(item.level)}
              className={`chrome rounded-lg px-2.5 py-1 font-semibold transition ${
                minCefr === item.level
                  ? `${item.color} ring-2 ring-accent scale-105 shadow-xs`
                  : 'bg-canvas text-ink-muted opacity-70 hover:opacity-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Zoom & Document Actions */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={zoomOut}
            title="Zoom Out"
            className="tap flex size-8 items-center justify-center rounded-lg bg-canvas text-xs font-bold transition hover:bg-surface-raised active:scale-95"
          >
            −
          </button>
          <button
            type="button"
            onClick={zoomReset}
            title="Reset Zoom"
            className="tap flex px-2 py-1 items-center justify-center rounded-lg bg-canvas text-xs font-medium transition hover:bg-surface-raised"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            title="Zoom In"
            className="tap flex size-8 items-center justify-center rounded-lg bg-canvas text-xs font-bold transition hover:bg-surface-raised active:scale-95"
          >
            +
          </button>

          {/* Open Local PDF Button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="tap rounded-xl bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink shadow-sm transition hover:opacity-90 active:scale-95"
          >
            Open PDF
          </button>
        </div>
      </div>

      {/* Reader Scrollable Viewport */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="flex flex-1 items-start justify-center overflow-auto p-4 sm:p-6"
      >
        {loading && (
          <div className="flex h-96 flex-col items-center justify-center gap-3 text-ink-muted">
            <div className="size-8 rounded-full border-3 border-accent border-t-transparent animate-spin" />
            <span className="text-sm">Loading document...</span>
          </div>
        )}

        {loadError && (
          <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5 text-center text-sm text-rose-700 dark:text-rose-300">
            <p className="font-semibold">Unable to display PDF</p>
            <p className="mt-1 text-xs opacity-90">{loadError}</p>
            <button
              type="button"
              onClick={() => setDocSource(`${import.meta.env.BASE_URL}samples/sample.pdf`)}
              className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink"
            >
              Reload Sample PDF
            </button>
          </div>
        )}

        {/* VIRTUALIZATION SLIDING WINDOW (Rule 1 & Rule 2):
            Only mounts the active page (pages >= 2 away are completely unmounted and destroyed) */}
        {!loading && !loadError && pdfDoc && (
          <div className="flex flex-col items-center gap-6">
            <PdfPage
              key={`page-${currentPage}-${docId}`}
              pdfDocument={pdfDoc}
              pageNumber={currentPage}
              scale={scale}
              docId={docId}
              minCefrLevel={minCefr}
              onWordTap={handleWordTap}
              activeLemma={activeLemma}
            />
          </div>
        )}
      </div>
    </div>
  );
};
