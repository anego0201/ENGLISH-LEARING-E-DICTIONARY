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
    const nextItem = items[i + 1];

    // Detect hyphenated line break: item ends with hyphen, has end-of-line flag, and is followed by next item
    const isHyphenBreak =
      (str.endsWith('-') || str.endsWith('\u2010')) && hasEOL && nextItem && typeof nextItem?.str === 'string';

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
      }
    }
  }

  return { text: recon, map };
}

/**
 * Maps worker hits [start, end] into exact sub-pixel client rects via DOM Range.
 * Zero DOM mutations on pdf.js spans; handles multi-line wraps automatically.
 */
export function computeHighlightRects(
  hits: TextHit[],
  map: CharNodeOffset[],
  textDivs: HTMLElement[],
  container: HTMLElement
): HighlightRect[] {
  if (hits.length === 0 || textDivs.length === 0 || map.length === 0) {
    return [];
  }

  const containerRect = container.getBoundingClientRect();
  const rects: HighlightRect[] = [];

  for (let hitIdx = 0; hitIdx < hits.length; hitIdx++) {
    const hit = hits[hitIdx];
    if (hit.start >= map.length || hit.end <= hit.start) continue;

    const startEntry = map[hit.start];
    const endEntry = map[Math.min(hit.end - 1, map.length - 1)];

    if (!startEntry || !endEntry) continue;

    const startDiv = textDivs[startEntry.itemIndex];
    const endDiv = textDivs[endEntry.itemIndex];

    if (!startDiv || !endDiv) continue;

    // Find the text node inside the span (pdf.js textDivs contain a Text node child)
    const startNode = startDiv.firstChild || startDiv;
    const endNode = endDiv.firstChild || endDiv;

    const startMax = startNode.textContent?.length ?? 0;
    const endMax = endNode.textContent?.length ?? 0;

    const startOffset = Math.min(Math.max(0, startEntry.charOffset), startMax);
    const endOffset = Math.min(Math.max(0, endEntry.charOffset + 1), endMax);

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const clientRects = range.getClientRects();
      for (let rIdx = 0; rIdx < clientRects.length; rIdx++) {
        const r = clientRects[rIdx];
        if (r.width <= 0 || r.height <= 0) continue;

        // Convert client viewport coordinates to page container coordinates
        const left = r.left - containerRect.left;
        const top = r.top - containerRect.top;

        rects.push({
          id: `hit-${hitIdx}-${rIdx}`,
          left,
          top,
          width: r.width,
          height: r.height,
          cefr: hit.cefr,
          lemma: hit.lemma,
        });
      }
    } catch {
      // Range calculation errors (e.g. detached node) are safely ignored
    }
  }

  return rects;
}
