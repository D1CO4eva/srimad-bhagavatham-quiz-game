import type { CSSProperties } from "react";

const COLORS = ["#2e3192", "#a34a00", "#00694b", "#8a3d68", "#ffcc00"];
const PIECE_COUNT = 60;
// Irrational multiplier so `frac(i * GOLDEN_RATIO)` spreads pieces evenly
// without repeating — deliberately not Math.random(), which the
// render/hooks purity rule (React Compiler) disallows calling during render.
const GOLDEN_RATIO = 0.618033988749895;

function frac(n: number): number {
  return n - Math.floor(n);
}

type Piece = { left: number; delayMs: number; durationMs: number; color: string; rotate: number; drift: number };

function pieceAt(i: number): Piece {
  return {
    left: frac(i * GOLDEN_RATIO) * 100,
    delayMs: frac(i * GOLDEN_RATIO * 2.7) * 400,
    durationMs: 2600 + frac(i * GOLDEN_RATIO * 1.9) * 1400,
    color: COLORS[i % COLORS.length],
    rotate: 180 + frac(i * GOLDEN_RATIO * 3.3) * 540,
    drift: (frac(i * GOLDEN_RATIO * 4.1) - 0.5) * 160,
  };
}

const PIECES = Array.from({ length: PIECE_COUNT }, (_, i) => pieceAt(i));

/**
 * A one-shot confetti burst — plain <span> pieces animated via CSS
 * (@keyframes confetti-fall in globals.css), no canvas or external library.
 * Mount-and-forget: pieces fall past the viewport once; a fresh mount (e.g.
 * navigating to a new podium screen) is what replays it.
 */
export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden>
      {PIECES.map((piece, i) => (
        <span
          key={i}
          className="absolute top-[-5%] h-2.5 w-1.5 rounded-sm"
          style={
            {
              left: `${piece.left}%`,
              backgroundColor: piece.color,
              animation: `confetti-fall ${piece.durationMs}ms ease-in ${piece.delayMs}ms forwards`,
              "--confetti-drift": `${piece.drift}px`,
              "--confetti-rotate": `${piece.rotate}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
