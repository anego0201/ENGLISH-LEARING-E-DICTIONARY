/**
 * Single PDF Page component.
 * Handles Retina rendering, pixel-area cap, textLayer synchronization,
 * worker-driven CEFR highlight overlay, and strict canvas memory cleanup.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { CefrLevel } from '../../shared/lexicon-contract';
import { getLexicon } from '../../lib/lexicon-client';
import {
  computeHighlightRects,
  reconstructPageText,
  type HighlightRect,
} from './text-reconstruction';
import { HighlightOverlay } from './HighlightOverlay';

const MAX_CANVAS_PIXELS = 16_777_216; // iOS Safari limit

export interface PdfPageProps {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  docId: string;
  minCefrLevel: CefrLevel;
  onWordTap: (lemma: string, cefr: CefrLevel) => void;
  activeLemma?: string | null;
  className?: string;
}

export const PdfPage: React.FC<PdfPageProps> = ({
  pdfDocument,
  pageNumber,
  scale,
  docId: _docId,
  minCefrLevel,
  onWordTap,
  activeLemma,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    let currentRenderTask: any = null;
    let currentTextLayer: any = null;
    let currentPage: PDFPageProxy | null = null;

    const canvasNode = canvasRef.current;
    const textLayerNode = textLayerRef.current;

    async function renderPage() {
      setIsRendering(true);
      setHighlightRects([]);

      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (isCancelled) {
          page.cleanup();
          return;
        }
        currentPage = page;

        // 1. Calculate CSS viewport and Retina pixel scale with area cap
        const viewport = page.getViewport({ scale });
        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        setPageSize({ width: cssW, height: cssH });

        const dpr = window.devicePixelRatio || 1;
        const maxRatio = Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH));
        const effectiveRatio = Math.min(dpr, maxRatio);

        const pageContainer = containerRef.current;
        if (!canvasNode || !textLayerNode || !pageContainer) return;

        // Configure canvas dimensions
        canvasNode.width = Math.floor(cssW * effectiveRatio);
        canvasNode.height = Math.floor(cssH * effectiveRatio);
        canvasNode.style.width = `${cssW}px`;
        canvasNode.style.height = `${cssH}px`;

        // Configure text layer container
        textLayerNode.style.width = `${cssW}px`;
        textLayerNode.style.height = `${cssH}px`;
        textLayerNode.replaceChildren();

        // 2. Render Canvas (visual PDF)
        const scaledViewport = page.getViewport({ scale: scale * effectiveRatio });
        currentRenderTask = page.render({
          canvas: canvasNode,
          viewport: scaledViewport,
        });

        await currentRenderTask.promise;
        if (isCancelled) return;

        // 3. Render TextLayer (selectable, aligned DOM spans)
        const textContent = await page.getTextContent();
        if (isCancelled) return;

        currentTextLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerNode,
          viewport,
        });

        await currentTextLayer.render();
        if (isCancelled) return;

        // 4. NLP analysis & non-destructive highlight projection
        const { text: reconstructedText, map } = reconstructPageText(textContent.items);
        if (!reconstructedText.trim()) {
          setIsRendering(false);
          return;
        }

        const lexicon = getLexicon();
        const analysis = await lexicon.analyzePageText(reconstructedText, minCefrLevel);
        if (isCancelled) return;

        // Compute subpixel DOM Range rects aligned to text glyphs
        const rects = computeHighlightRects(
          analysis.hits,
          map,
          currentTextLayer.textDivs,
          pageContainer
        );

        if (!isCancelled) {
          setHighlightRects(rects);
          setIsRendering(false);
        }
      } catch (err: any) {
        // RenderingCancelledException is expected during rapid navigation/teardown
        if (err?.name !== 'RenderingCancelledException' && !isCancelled) {
          console.error(`Error rendering page ${pageNumber}:`, err);
          setIsRendering(false);
        }
      }
    }

    renderPage();

    // STRICT TEARDOWN (Rule 3 & Rule 6): Destroy canvas memory before removal
    return () => {
      isCancelled = true;

      // 1. Cancel in-flight render task
      if (currentRenderTask) {
        try {
          currentRenderTask.cancel();
        } catch {
          // Swallow cancellation errors
        }
        currentRenderTask = null;
      }

      // 2. Cancel in-flight text layer rendering
      if (currentTextLayer) {
        try {
          currentTextLayer.cancel();
        } catch {
          // Swallow text layer errors
        }
        currentTextLayer = null;
      }

      // 3. Clear text layer DOM
      if (textLayerNode) {
        textLayerNode.replaceChildren();
      }

      // 4. Force iOS Safari GPU memory garbage collection
      if (canvasNode) {
        canvasNode.width = 0;
        canvasNode.height = 0;
      }

      // 5. Release internal page bitmaps/fonts
      if (currentPage) {
        try {
          currentPage.cleanup();
        } catch {
          // Swallow cleanup errors
        }
        currentPage = null;
      }
    };
  }, [pdfDocument, pageNumber, scale, minCefrLevel]);

  return (
    <div
      ref={containerRef}
      style={{
        width: pageSize ? `${pageSize.width}px` : undefined,
        height: pageSize ? `${pageSize.height}px` : undefined,
      }}
      className={`relative mx-auto select-none bg-white shadow-md transition-shadow dark:bg-zinc-900 ${className}`}
    >
      {/* Visual PDF Canvas */}
      <canvas ref={canvasRef} className="block" />

      {/* Synchronized Transparent Text Layer */}
      <div ref={textLayerRef} className="textLayer" />

      {/* Non-destructive CEFR Highlight Overlay */}
      <HighlightOverlay
        rects={highlightRects}
        onWordTap={onWordTap}
        activeLemma={activeLemma}
      />

      {/* Loading Skeleton */}
      {isRendering && !pageSize && (
        <div className="flex h-[600px] w-[400px] items-center justify-center bg-surface">
          <div className="size-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      )}
    </div>
  );
};
