import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// The arcane-night visual vocabulary, shared by every surface: gold-foil
// primary buttons with press states, glassy panels over indigo night,
// glowing gold focus rings, and pixel-art tiles framed in gold.

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
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 px-4 font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-amber-950 shadow-[0_1px_0_rgba(253,247,231,0.6)_inset,0_2px_8px_rgba(4,2,12,0.5)] transition-all duration-150 ease-snap hover:-translate-y-px hover:shadow-[0_1px_0_rgba(253,247,231,0.6)_inset,0_4px_16px_rgba(212,171,58,0.35)] active:translate-y-0 active:scale-[0.98] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none",
  btnSecondary:
    "inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-500/25 bg-stone-900/50 px-3 font-display text-[13px] uppercase tracking-[0.12em] text-stone-200 shadow-[0_1px_0_rgba(233,230,244,0.06)_inset,0_2px_6px_rgba(4,2,12,0.4)] transition-all duration-150 ease-snap hover:border-amber-500/50 hover:bg-stone-800/70 hover:text-amber-100 hover:shadow-glow-gold active:scale-[0.98] disabled:opacity-50",
  btnSmall:
    "inline-flex items-center gap-1.5 rounded-lg border border-stone-600/60 bg-stone-900/50 px-3 py-1.5 text-sm text-stone-300 shadow-[0_1px_0_rgba(233,230,244,0.05)_inset] transition-all duration-150 ease-snap hover:border-amber-500/40 hover:bg-stone-800/70 hover:text-amber-100 active:scale-[0.97] disabled:opacity-50",
  // Fields
  input:
    "w-full rounded-lg border border-stone-700/70 bg-stone-950/80 px-3 py-2 text-sm text-stone-100 shadow-[0_2px_6px_rgba(4,2,12,0.45)_inset] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-stone-500 focus:border-amber-400/70 focus:shadow-[0_0_0_3px_rgba(212,171,58,0.12),0_2px_6px_rgba(4,2,12,0.45)_inset]",
  // Surfaces
  card: "panel rounded-xl",
  cardHover:
    "panel ornate rounded-xl transition-all duration-200 ease-snap hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-[0_1px_0_rgba(233,230,244,0.08)_inset,0_8px_28px_rgba(4,2,12,0.55),0_0_24px_rgba(212,171,58,0.12)]",
  dialog: "panel rounded-xl p-5",
} as const;

// 48px pixel-art tile with the gold glow, framed on indigo night.
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
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-400/25 bg-stone-950 shadow-glow-gold",
        size,
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="size-full object-cover" />
    </span>
  );
}

// Small gold icon chip for empty states and panel titles.
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
        "flex shrink-0 items-center justify-center rounded-xl border border-amber-300/25 bg-amber-300/10 shadow-glow-gold",
        size,
        className,
      )}
    >
      <Icon className={cn("text-amber-200", iconSize)} aria-hidden="true" />
    </span>
  );
}

// Round user/character portrait with graceful fallback sizes; keeps avatar
// sizing consistent instead of magic numbers per screen.
export const AVATAR_SIZES = {
  chat: "size-6",
  menu: "size-8",
  lobby: "size-12",
  party: "size-12",
  sheet: "size-14",
  profile: "size-24",
} as const;
