/**
 * Reconstructs continuous page text from pdf.js getTextContent() items,
 * joins line-break hyphens, and computes exact DOM Range ClientRects
 * for non-destructive highlight overlays.
 */
import type { CefrLevel, TextHit } from '../../shared/lexicon-contract';

export interface CharNodeOffset {
  itemIndex: number;
  charOffset: number;
}

export interface ReconstructedTextResult {
  text: string;
  map: CharNodeOffset[];
}

export interface HighlightRect {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  cefr: CefrLevel;
  lemma: string;
}

/**
 * Rebuilds page text from pdf.js TextItem objects while joining line-break hyphens
 * and building a character-to-item mapping table.
 */
export function reconstructPageText(items: any[]): ReconstructedTextResult {
  let recon = '';
  const map: CharNodeOffset[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item?.str !== 'string') continue;

    const str = item.str;
    const hasEOL = Boolean(item.hasEOL);

    // Locate the next non-empty text item
    let nextItem: any = null;
    for (let k = i + 1; k < items.length; k++) {
      if (typeof items[k]?.str === 'string' && items[k].str.length > 0) {
        nextItem = items[k];
        break;
      }
    }

    // Detect hyphenated line break: item ends with hyphen, followed by next item
    const isHyphenBreak =
      (str.endsWith('-') || str.endsWith('\u2010')) &&
      (hasEOL || !str.endsWith(' -')) &&
      nextItem &&
      typeof nextItem?.str === 'string';

    if (isHyphenBreak) {
      // Exclude the hyphen character from the reconstructed word, joining directly to the next item
      const stemLen = str.length - 1;
      for (let c = 0; c < stemLen; c++) {
        map.push({ itemIndex: i, charOffset: c });
        recon += str[c];
      }
    } else {
      for (let c = 0; c < str.length; c++) {
        map.push({ itemIndex: i, charOffset: c });
        recon += str[c];
      }

      if (hasEOL) {
        map.push({ itemIndex: i, charOffset: str.length });
        recon += '\n';
      } else {
        // If not at end-of-line and no trailing space, separate from next non-empty item
        if (str.length > 0 && !str.endsWith(' ') && nextItem && !nextItem.str.startsWith(' ')) {
          map.push({ itemIndex: i, charOffset: str.length });
          recon += ' ';
        }
      }
    }
  }

  return { text: recon, map };
}

/**
 * Maps worker hits into exact sub-pixel client rects via DOM Range.
 * Zero DOM mutations on pdf.js spans; handles multi-line / hyphenated wraps automatically.
 * Supports both transferable Uint32Array triplets [start, end, cefr] and TextHit[].
 */
export function computeHighlightRects(
  hits: Uint32Array | TextHit[],
  map: CharNodeOffset[],
  textDivs: HTMLElement[],
  container: HTMLElement,
  lemmas?: string[]
): HighlightRect[] {
  if (hits.length === 0 || textDivs.length === 0 || map.length === 0) {
    return [];
  }

  const containerRect = container.getBoundingClientRect();
  const rects: HighlightRect[] = [];

  const isTypedArray = hits instanceof Uint32Array;
  const count = isTypedArray ? (lemmas?.length ?? Math.floor(hits.length / 3)) : hits.length;

  for (let hitIdx = 0; hitIdx < count; hitIdx++) {
    let start: number;
    let end: number;
    let cefr: CefrLevel;
    let lemma: string;

    if (isTypedArray) {
      start = hits[hitIdx * 3];
      end = hits[hitIdx * 3 + 1];
      cefr = hits[hitIdx * 3 + 2] as CefrLevel;
      lemma = lemmas?.[hitIdx] || '';
    } else {
      const hit = hits[hitIdx];
      start = hit.start;
      end = hit.end;
      cefr = hit.cefr;
      lemma = hit.lemma;
    }

    if (start >= map.length || end <= start) continue;

    const startEntry = map[start];
    const endEntry = map[Math.min(end - 1, map.length - 1)];

    if (!startEntry || !endEntry) continue;

    // For words spanning across multiple text spans (e.g. line-break hyphens),
    // compute separate DOM ranges per span to avoid Safari WebKit cross-element bounding glitches.
    const startItemIdx = startEntry.itemIndex;
    const endItemIdx = endEntry.itemIndex;

    for (let itemIdx = startItemIdx; itemIdx <= endItemIdx; itemIdx++) {
      const div = textDivs[itemIdx];
      if (!div) continue;

      const textNode = div.firstChild || div;
      const maxLen = textNode.textContent?.length ?? 0;
      if (maxLen === 0) continue;

      const charStart = itemIdx === startItemIdx ? Math.min(startEntry.charOffset, maxLen) : 0;
      const charEnd =
        itemIdx === endItemIdx ? Math.min(endEntry.charOffset + 1, maxLen) : maxLen;

      if (charEnd <= charStart) continue;

      try {
        const range = document.createRange();
        range.setStart(textNode, charStart);
        range.setEnd(textNode, charEnd);

        const clientRects = range.getClientRects();
        for (let rIdx = 0; rIdx < clientRects.length; rIdx++) {
          const r = clientRects[rIdx];
          if (r.width <= 0 || r.height <= 0) continue;

          // Convert client viewport coordinates to page container coordinates
          const left = r.left - containerRect.left;
          const top = r.top - containerRect.top;

          rects.push({
            id: `hit-${hitIdx}-${itemIdx}-${rIdx}`,
            left,
            top,
            width: r.width,
            height: r.height,
            cefr,
            lemma,
          });
        }
      } catch {
        // Range calculation errors (e.g. detached node) are safely ignored
      }
    }
  }

  return rects;
}

