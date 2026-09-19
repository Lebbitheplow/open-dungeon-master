import { cn } from "@/lib/cn";

// A painted scroll that unrolls to show text: two turned rollers and a length
// of parchment between them that grows from nothing, so the lower roller
// travels down as it opens and the words arrive once there is paper to hold
// them (docs/visual-overhaul-plan.md 8b.4). The art is three painted parts
// under public/assets/ui; the text is ordinary DOM on top, never baked in, so
// it stays selectable, translatable and readable by a screen reader.
//
// The unroll animates grid-template-rows from 0fr to 1fr, which needs no
// measured height. Under reduced motion the scroll is simply open.
export function Scroll({
  children,
  className,
  tone = "light",
  brass = false,
}: {
  children: React.ReactNode;
  className?: string;
  // "dark" is the aged parchment, for a grim find.
  tone?: "light" | "dark";
  brass?: boolean;
}) {
  const roller = brass ? "/assets/ui/scroll-roller-brass.webp" : "/assets/ui/scroll-roller.webp";
  return (
    <div className={cn("kit-scroll", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={roller} alt="" className="kit-scroll-roller" draggable={false} />
      <div className="kit-scroll-length">
        <div className={cn("kit-scroll-paper", tone === "dark" && "kit-scroll-paper-dark")}>
          <div className="kit-scroll-text">{children}</div>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={roller} alt="" className="kit-scroll-roller kit-scroll-roller-foot" draggable={false} />
    </div>
  );
}
