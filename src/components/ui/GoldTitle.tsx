import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

// The display title of a screen or a moment: Cinzel in a gold gradient with a
// bronze edge beneath it, arriving with a short rise. One treatment for every
// page head, dialog head and wizard step, so the app has a single voice for
// "this is where you are" (docs/visual-overhaul-plan.md 2.2 and 6).
export function GoldTitle({
  children,
  as: Tag = "h1",
  size = "text-2xl sm:text-3xl",
  className,
  animate = true,
}: {
  children: React.ReactNode;
  as?: "h1" | "h2" | "h3" | "p" | "span";
  size?: string;
  className?: string;
  // Off for titles that are already on screen when their surroundings change.
  animate?: boolean;
}) {
  return <Tag className={cn("gold-title font-display", size, animate && "animate-fade-up", className)}>{children}</Tag>;
}

// Eight copies stepping back in bronze: the extrusion under the gradient face
// (the battle announce, "Rolls and Effects" mockup 5a). Farthest first, so the
// nearest paints last. The bronze is a lightness ramp that each tone scales.
const DEPTHS = Array.from({ length: 8 }, (_, index) => {
  const step = 8 - index;
  const grey = Math.round(28 + (1 - step / 8) * 44);
  return { x: `${(step * 1.1).toFixed(1)}px`, y: `${(step * 1.5).toFixed(1)}px`, grey };
});

const BRONZE: Record<ExtrudedTone, [number, number, number]> = {
  gold: [1.5, 1.12, 0.5],
  ember: [1.6, 0.7, 0.4],
  dawn: [1.5, 1.05, 0.85],
  plain: [1.05, 1.02, 1.0],
};

export type ExtrudedTone = "gold" | "ember" | "dawn" | "plain";

// The carved title: the face is gradient-clipped text, the layers behind it
// repeat the same words so they wrap exactly as the face does. The layers are
// decoration and hidden from a reader; low effects keeps only the nearest one
// (src/app/styles/motion-app.css).
export function ExtrudedTitle({
  children,
  tone = "gold",
  as: Tag = "h2",
  className,
}: {
  children: string;
  tone?: ExtrudedTone;
  as?: "h1" | "h2" | "p";
  className?: string;
}) {
  const [r, g, b] = BRONZE[tone];
  return (
    <Tag className={cn("announce-title font-display", className)} data-tone={tone}>
      {DEPTHS.map((depth) => (
        <span
          key={depth.x}
          aria-hidden="true"
          className="announce-depth"
          style={
            {
              color: `rgb(${Math.min(255, Math.round(depth.grey * r))},${Math.min(255, Math.round(depth.grey * g))},${Math.min(255, Math.round(depth.grey * b))})`,
              translate: `${depth.x} ${depth.y}`,
            } as CSSProperties
          }
        >
          {children}
        </span>
      ))}
      <span className="announce-face">{children}</span>
    </Tag>
  );
}
