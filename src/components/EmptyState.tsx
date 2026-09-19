import { cn } from "@/lib/cn";

// The one empty state (docs/visual-overhaul-plan.md 8c.3). Before this the app
// had three that never matched on one screen: an illustrated plate, an icon
// chip in a card, and an 11 px grey italic sentence. Every list now says
// "nothing here yet" the same way: a small painted vignette, the sentence it
// always said, and an action where one makes sense.
const ART = {
  chest: "/assets/ui/empty-chest.webp",
  scrolls: "/assets/ui/empty-scroll-rack.webp",
  board: "/assets/ui/empty-notice-board.webp",
  map: "/assets/ui/empty-map-table.webp",
} as const;

export type EmptyArt = keyof typeof ART;

export function EmptyState({
  art = "board",
  title,
  hint,
  action,
  size = "md",
  className,
}: {
  art?: EmptyArt;
  // The sentence the list has always shown when it is empty.
  title: string;
  hint?: string;
  action?: React.ReactNode;
  // "sm" for a side panel 20rem wide, "md" for a page section.
  size?: "sm" | "md";
  className?: string;
}) {
  const small = size === "sm";
  return (
    <div className={cn("flex animate-fade-up flex-col items-center text-center", small ? "gap-1.5 px-2 py-4" : "gap-2 px-4 py-8", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ART[art]}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn("object-contain opacity-90 drop-shadow-[0_6px_14px_rgba(4,2,12,0.55)]", small ? "h-16 w-20" : "h-24 w-32")}
      />
      <p className={cn("font-serif text-stone-300", small ? "text-xs leading-5" : "text-sm leading-6")}>{title}</p>
      {hint ? <p className={cn("reveal max-w-prose text-stone-500", small ? "text-[11px] leading-4" : "text-xs leading-5")}>{hint}</p> : null}
      {action ? <div className="reveal mt-1">{action}</div> : null}
    </div>
  );
}
