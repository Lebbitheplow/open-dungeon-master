import { cn } from "@/lib/cn";

// Loading indicator for the "DM is working" status: a d20 whose body tumbles
// while the number in its face cross-fades through a set of values, so it reads
// as a die mid-roll landing on a new face rather than a flat picture spinning.
// Sized and colored by className like the lucide icons it sits beside
// (e.g. `size-5 text-amber-600`); the outline and numbers use currentColor.
const FACE_NUMBERS = [20, 7, 13, 2, 18, 11];

export function D20Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-4", className)}
      aria-hidden="true"
      focusable="false"
    >
      {/* Die body: the only part that tumbles, so the numbers stay legible. */}
      <g
        className="animate-d20-roll"
        style={{ transformOrigin: "center", transformBox: "fill-box" }}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M12 2 L20.66 7 L20.66 17 L12 22 L3.34 17 L3.34 7 Z" />
        <path
          d="M12 6 L17 15 L7 15 Z"
          fill="currentColor"
          fillOpacity={0.12}
        />
        <path d="M12 6 L12 2 M12 6 L20.66 7 M12 6 L3.34 7 M17 15 L20.66 17 M7 15 L3.34 17 M17 15 L12 22 M7 15 L12 22" />
      </g>
      {/* Face numbers: static position, cross-faded one at a time. */}
      <g
        fill="currentColor"
        fontSize={6}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {FACE_NUMBERS.map((n, i) => (
          <text
            key={n}
            x={12}
            y={12.6}
            className="animate-d20-face"
            style={{ animationDelay: `calc(${i} * -0.4s)` }}
          >
            {n}
          </text>
        ))}
      </g>
    </svg>
  );
}
