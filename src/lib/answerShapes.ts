/**
 * Kahoot-style tile color per choice index — shared by host and player.
 * Colors are chosen to avoid a pure red/green pair (the classic
 * red-green colorblindness confusion) and each hits at least a 4.5:1
 * contrast ratio against white text (WCAG AA for normal text).
 */
export const ANSWER_TILE_COLORS = ["#2e3192", "#a34a00", "#00694b", "#8a3d68"] as const;
