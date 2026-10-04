/**
 * Non-destructive Highlight Overlay component.
 * Renders absolute-positioned interactive boxes over words identified by CEFR level.
 */
import React from 'react';
import type { CefrLevel } from '../../shared/lexicon-contract';
import type { HighlightRect } from './text-reconstruction';

interface HighlightOverlayProps {
  rects: HighlightRect[];
  onWordTap: (lemma: string, cefr: CefrLevel) => void;
  activeLemma?: string | null;
}

function getCefrBadgeClass(level: CefrLevel): string {
  switch (level) {
    case 3:
      return 'bg-cefr-b1 hover:ring-2 hover:ring-amber-400';
    case 4:
      return 'bg-cefr-b2 hover:ring-2 hover:ring-orange-500';
    case 5:
      return 'bg-cefr-c1 hover:ring-2 hover:ring-rose-500';
    case 6:
      return 'bg-cefr-c2 hover:ring-2 hover:ring-purple-600';
    default:
      return 'bg-cefr-b1';
  }
}

export const HighlightOverlay: React.FC<HighlightOverlayProps> = ({
  rects,
  onWordTap,
  activeLemma,
}) => {
  if (rects.length === 0) return null;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-10 overflow-hidden"
      aria-hidden="true"
    >
      {rects.map((r) => {
        const isActive = activeLemma === r.lemma;
        const colorClass = getCefrBadgeClass(r.cefr);

        return (
          <button
            key={r.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onWordTap(r.lemma, r.cefr);
            }}
            title={`${r.lemma} (CEFR ${r.cefr})`}
            style={{
              left: `${r.left}px`,
              top: `${r.top}px`,
              width: `${r.width}px`,
              height: `${r.height}px`,
            }}
            className={`absolute pointer-events-auto rounded-[2px] transition-all duration-150 focus:outline-none ${colorClass} ${
              isActive ? 'ring-2 ring-accent scale-[1.03] shadow-sm' : 'active:opacity-75'
            }`}
          />
        );
      })}
    </div>
  );
};
