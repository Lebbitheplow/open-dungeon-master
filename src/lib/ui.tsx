import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// The original Open Dungeon visual vocabulary, shared by every multiplayer
// surface: light-gold primary buttons with dark text, amber-glow pixel-art
// tiles, amber-200 icon chips, stone-950 inputs with amber-300 focus.

export const PIXEL_ICONS = {
  chats: "/sidebar-icons/chats.png",
  characters: "/sidebar-icons/characters.png",
  story: "/sidebar-icons/story.png",
  images: "/sidebar-icons/images.png",
  textModel: "/sidebar-icons/text-model.png",
  localData: "/sidebar-icons/local-data.png",
  support: "/sidebar-icons/support.png",
} as const;

export const ui = {
  // Buttons
  btnPrimary:
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-200 px-4 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50",
  btnSecondary:
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-stone-700 px-3 text-sm text-stone-300 hover:bg-stone-900 disabled:opacity-50",
  btnSmall:
    "inline-flex items-center gap-1.5 rounded-lg border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-900 disabled:opacity-50",
  // Fields
  input:
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300",
  // Surfaces
  card: "rounded-lg border border-stone-800 bg-stone-950/70",
  cardHover:
    "rounded-lg border border-stone-800 bg-stone-950/70 transition hover:border-amber-800/60 hover:bg-stone-900/70",
  dialog:
    "rounded-xl border border-stone-700 bg-[#130d09] p-5 shadow-xl",
} as const;

// 48px pixel-art tile with the amber glow, as in the original sidebar.
export function PixelTile({
  src,
  size = "size-12",
  className,
}: {
  src: string;
  size?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-200/15 bg-stone-950 shadow-[0_0_16px_rgba(251,191,36,0.1)]",
        size,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" />
    </span>
  );
}

// Small amber icon chip, as in the original empty states and panel titles.
export function IconChip({
  icon: Icon,
  size = "size-7",
  iconSize = "size-4",
  className,
}: {
  icon: LucideIcon;
  size?: string;
  iconSize?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border border-amber-200/20 bg-amber-200/10",
        size,
        className,
      )}
    >
      <Icon className={cn("text-amber-200", iconSize)} aria-hidden="true" />
    </span>
  );
}
