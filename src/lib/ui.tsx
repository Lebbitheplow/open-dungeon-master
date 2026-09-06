import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  avatarPlaceholder,
  characterPlaceholder,
  monsterPlaceholder,
  type CharacterLook,
} from "@/lib/placeholders";

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
  // Small icon action pinned to a card or message. Fades in on hover for mouse
  // users and stays visible on touch (see .reveal-on-hover in globals.css).
  // The padding keeps the tap target reachable on a phone; add a negative
  // margin at call sites where the surrounding row is tight.
  iconAction:
    "reveal-on-hover rounded-md p-1.5 text-stone-600 hover:text-amber-200 focus-visible:text-amber-200",
  // Fields
  input:
    "w-full rounded-lg border border-stone-700/70 bg-stone-950/80 px-3 py-2 text-sm text-stone-100 shadow-[0_2px_6px_rgba(4,2,12,0.45)_inset] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-stone-500 focus:border-amber-400/70 focus:shadow-[0_0_0_3px_rgba(212,171,58,0.12),0_2px_6px_rgba(4,2,12,0.45)_inset]",
  // Surfaces
  card: "panel rounded-xl",
  cardHover:
    "panel ornate rounded-xl transition-all duration-200 ease-snap hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-[0_1px_0_rgba(233,230,244,0.08)_inset,0_8px_28px_rgba(4,2,12,0.55),0_0_24px_rgba(212,171,58,0.12)]",
  dialog: "panel rounded-xl p-5",
  // Quick-action tile: a square-ish panel that lifts on hover (QuickTile).
  tile: "panel ornate flex flex-col items-center justify-center gap-2 rounded-xl p-4 text-center",
  tileHover:
    "transition-all duration-200 ease-snap hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-[0_1px_0_rgba(233,230,244,0.08)_inset,0_8px_28px_rgba(4,2,12,0.55),0_0_24px_rgba(212,171,58,0.12)] active:translate-y-0 active:scale-[0.98]",
  // Small caps label that heads a section or sits in a Ribbon.
  sectionEyebrow: "eyebrow text-[10px] text-amber-400/80",
  // Icon rail cells: icon over a tiny eyebrow label. Active gets the gold
  // glow the session tab rail uses; the ember variant marks the party lead.
  railCell:
    "relative flex min-w-[3.25rem] flex-col items-center gap-1 rounded-lg px-2 py-2 text-stone-500 transition-all duration-150 ease-snap hover:bg-stone-900/60 hover:text-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
  railCellActive:
    "bg-amber-400/10 text-amber-300 shadow-[0_1px_0_rgba(244,224,166,0.15)_inset,0_0_16px_rgba(212,171,58,0.12)] hover:bg-amber-400/10 hover:text-amber-300",
  railCellActiveEmber:
    "bg-ember-500/10 text-ember-300 shadow-[0_1px_0_rgba(255,190,143,0.15)_inset,0_0_16px_rgba(224,112,58,0.18)] hover:bg-ember-500/10 hover:text-ember-300",
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

// A monster's picture when nobody has painted one: the placeholder plate for
// its SRD creature type (scripts/placeholder-set.mjs renders one per type),
// or the genre's boss plate when its challenge rating says it is the
// centrepiece of a fight. Anything unrecognised draws the monstrosity plate,
// which promises least. The rules live in src/lib/placeholders.ts.
export function monsterThumbnail(
  type: string | null | undefined,
  options: { cr?: number | null; genre?: string | null; seed?: string | null } = {},
): string {
  return monsterPlaceholder(type, options);
}

// The thumbnail at list-row size, framed like every other tile. `type` is
// the creature type off the stat block or the bestiary entry; `cr` and
// `genre` only matter for the boss and genre plates, and `seed` (a slug or
// a name) keeps a monster on the same plate where a genre offers two.
export function MonsterTile({
  type,
  cr,
  genre,
  seed,
  art,
  size = "size-9",
  className,
}: {
  type: string | null | undefined;
  cr?: number | null;
  genre?: string | null;
  seed?: string | null;
  // A picture of this monster in particular (a world pack's own art, from
  // BestiaryEntry.art), which beats any plate.
  art?: string | null;
  size?: string;
  className?: string;
}) {
  return (
    <PixelTile
      src={art || monsterThumbnail(type, { cr, genre, seed })}
      size={size}
      className={className}
    />
  );
}

// A player's face: their uploaded avatar, or the sigil their user id hashes
// to, so somebody who never chose one still looks like themselves everywhere.
export function UserAvatar({
  url,
  userId,
  size = "size-12",
  className,
}: {
  url?: string | null;
  userId: string | null | undefined;
  size?: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url || avatarPlaceholder(userId)}
      alt=""
      loading="lazy"
      className={cn(
        "shrink-0 rounded-full border border-amber-500/30 bg-stone-950 object-cover",
        size,
        className,
      )}
    />
  );
}

// A character's picture: their own portrait when somebody has painted one,
// and otherwise the plate their class, race or setting resolves to. Square
// by default because that is how a sheet shows a face; pass rounded-full for
// the party rail and the cast list.
//
// `look` is whatever the caller knows - a sheet has all four fields, a lobby
// row may have only a name - and src/lib/placeholders.ts narrows from there.
export function CharacterPortrait({
  url,
  fallback,
  look,
  alt = "",
  size = "size-12",
  rounded = "rounded-lg",
  className,
}: {
  url?: string | null;
  // What to draw before the generic plate: a world pack's picture for the
  // character's class or race (usePackArt in src/lib/worlds/use-pack-art.ts).
  fallback?: string | null;
  look?: CharacterLook;
  alt?: string;
  size?: string;
  rounded?: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url || fallback || characterPlaceholder(look ?? {})}
      alt={alt}
      loading="lazy"
      className={cn(
        "shrink-0 border border-amber-400/25 bg-stone-950 object-cover",
        size,
        rounded,
        className,
      )}
    />
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
