/**
 * PDF.js setup and document loader configured strictly for offline-first PWA.
 * Uses local precached workers, cmaps, standard fonts, ICC profiles, and wasm decoders.
 */
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Set dedicated worker source (precached by Workbox)
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export function getDocumentOptions(source: string | ArrayBuffer | Uint8Array): any {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;

  const isData = typeof source !== 'string';

  return {
    ...(isData ? { data: source } : { url: source }),
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    iccUrl: `${base}pdfjs/iccs/`,
    wasmUrl: `${base}pdfjs/wasm/`,
    isEvalSupported: false,
    enableXfa: false,
  };
}

export function loadPdfDocument(source: string | ArrayBuffer | Uint8Array): pdfjsLib.PDFDocumentLoadingTask {
  const options = getDocumentOptions(source);
  return pdfjsLib.getDocument(options);
}

export { pdfjsLib };
