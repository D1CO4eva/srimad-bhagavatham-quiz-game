/**
 * Visible glyph for an answer tile, matching ANSWER_SHAPES's labels. Shape
 * (not just tile color) distinguishes options so the choice is legible for
 * colorblind players too — previously only an aria-label carried the shape.
 */
export function AnswerShapeIcon({
  label,
  className = "h-6 w-6",
}: {
  label: "Triangle" | "Diamond" | "Circle" | "Square";
  className?: string;
}) {
  const common = { className, "aria-hidden": true as const, viewBox: "0 0 24 24", fill: "white" };
  switch (label) {
    case "Triangle":
      return (
        <svg {...common}>
          <polygon points="12,3 21,20 3,20" />
        </svg>
      );
    case "Diamond":
      return (
        <svg {...common}>
          <polygon points="12,2 22,12 12,22 2,12" />
        </svg>
      );
    case "Circle":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.5" />
        </svg>
      );
    case "Square":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      );
  }
}
