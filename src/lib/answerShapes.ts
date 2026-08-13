/**
 * Kahoot-style shape/color per choice index — shared by host (labels) and
 * player (blind taps). Colors are chosen to avoid a pure red/green pair
 * (the classic red-green colorblindness confusion) and each hits at least
 * a 4.5:1 contrast ratio against white text/icons (WCAG AA for normal text).
 */
export const ANSWER_SHAPES = [
  { label: "Triangle", color: "#2e3192" },
  { label: "Diamond", color: "#a34a00" },
  { label: "Circle", color: "#00694b" },
  { label: "Square", color: "#8a3d68" },
] as const;
