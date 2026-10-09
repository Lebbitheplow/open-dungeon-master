"use client";

import { BookOpen, Check, Hourglass, Lock, Star } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import { contentSlug, describeContentEntry, spellSummary } from "@/lib/help";
import { replayAnimation } from "@/lib/motion/replay";

// The spell book: one tab per spell level (cantrips first), every spell a
// tile that says at a glance whether it is ready, waiting for a long rest,
// granted for free, only written in a wizard's book, or merely available.
// Drawn by the session sheet, the character page and the builder, so a
// player reads the same picture while choosing spells and while playing.

export type SpellTileState =
  // Ready to cast: a cantrip, a known spell, a prepared spell.
  | "ready"
  // Chosen, becomes ready after the next long rest.
  | "pending"
  // Always prepared by the subclass; never counts, never removed.
  | "granted"
  // Written in a wizard's spellbook but not prepared.
  | "inBook"
  // On the class list, not chosen.
  | "available";

export type SpellTile = {
  name: string;
  // 0 for a cantrip; null when the level is unknown (homebrew).
  level: number | null;
  state: SpellTileState;
  // Shown as a star: a good pick for someone new to the class.
  suggested?: boolean;
  // The world's name for it, when a pack reskins the spell.
  label?: string;
  data?: Record<string, unknown>;
  slug?: string;
  homebrew?: boolean;
  // The book the spell is from, when it is not the SRD ("Deep Magic 5e"):
  // leads the state line, the way "homebrew" does (issue #116).
  source?: string;
  // Replaces the state line under the name ("New" for a level-up pick).
  note?: string;
  // Why this spell cannot be chosen right now ("Full", a third caster's
  // school). The tile dims and says so before anyone taps it; a tap still
  // reaches onTile, so the picker can explain at length, and the tile
  // shakes no.
  blocked?: string;
};

export type SpellCounter = { label: string; value: number; max?: number | null; extra?: string };

const STATE_TEXT: Record<SpellTileState, string> = {
  ready: "Ready",
  pending: "At long rest",
  granted: "Always prepared",
  inBook: "In spellbook",
  available: "Available",
};

const RANK: Record<SpellTileState, number> = { granted: 0, ready: 1, pending: 2, inBook: 3, available: 4 };
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
const noSubscribe = () => () => {};
const levelKey = (level: number | null) => (level === null ? "other" : String(level));
const levelLabel = (key: string) =>
  key === "0"
    ? "Cantrips"
    : key === "other"
      ? "Other spells (level unknown)"
      : `Level ${ROMAN[Number(key)] ?? key} spells`;
// Spell levels read as roman numerals, the way a spell book would number
// its chapters; cantrips and homebrew with no known level keep a word.
const tabLabel = (key: string) =>
  key === "0" ? "Cantrips" : key === "other" ? "Other" : (ROMAN[Number(key)] ?? key);

export function SpellBook({
  tiles,
  maxLevel,
  counters = [],
  onTile,
  canToggle,
  busy = false,
  header,
  footer,
  notice,
  emptyText = "No spells yet.",
}: {
  tiles: SpellTile[];
  // Tabs run from cantrips to this level even when a level is still empty,
  // so a player sees where their next spells will go.
  maxLevel: number;
  counters?: SpellCounter[];
  onTile?: (tile: SpellTile) => void;
  // Which tiles respond to a tap; all but granted ones by default.
  canToggle?: (tile: SpellTile) => boolean;
  busy?: boolean;
  header?: ReactNode;
  footer?: ReactNode;
  // A word from the picker about the last tap (why it was refused), shown
  // beside the level heading right above the tiles, where the eye already
  // is, instead of a line pushed in above the book.
  notice?: ReactNode;
  emptyText?: string;
}) {
  const [filter, setFilter] = useState("");
  const needle = filter.trim().toLowerCase();
  // The tab strip says which tab is chosen only once mounted. The travelling
  // pill (src/lib/motion/pill.ts) decorates every tablist that has a chosen
  // tab as soon as the page loads, and a pill appended to server-rendered
  // markup before React hydrates it is a hydration mismatch (the builder
  // renders this book on the server, inside a hidden step).
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);

  const byLevel = useMemo(() => {
    const map = new Map<string, SpellTile[]>();
    for (let level = 0; level <= maxLevel; level += 1) {
      map.set(String(level), []);
    }
    for (const tile of tiles) {
      const key = levelKey(tile.level);
      map.set(key, [...(map.get(key) ?? []), tile]);
    }
    // Cantrips only earn a tab when there are any.
    if (!map.get("0")?.length) {
      map.delete("0");
    }
    return map;
  }, [tiles, maxLevel]);

  const keys = [...byLevel.keys()].sort((a, b) =>
    a === "other" ? 1 : b === "other" ? -1 : Number(a) - Number(b),
  );
  const chosenIn = (key: string) =>
    (byLevel.get(key) ?? []).filter((tile) => tile.state !== "available" && tile.state !== "inBook").length;
  const firstUseful = keys.find((key) => key !== "0" && (byLevel.get(key) ?? []).length) ?? keys[0];
  const [tab, setTab] = useState<string | null>(null);
  const active = tab && byLevel.has(tab) ? tab : (firstUseful ?? "0");

  const shown = needle
    ? keys.flatMap((key) =>
        (byLevel.get(key) ?? []).filter((tile) =>
          (tile.label ?? tile.name).toLowerCase().includes(needle),
        ),
      )
    : (byLevel.get(active) ?? []);
  // Chosen first, then what is left to choose, alphabetical inside each.
  // The order is taken when a page of tiles opens (a tab, a search, a new
  // list) and kept while the player taps, so a tile stays under the finger
  // that chose it. Re-sorting on every tap sent a chosen spell leaping to
  // the front and the list jumping, and the tap looked lost (issue 66).
  const byRank = (a: SpellTile, b: SpellTile) =>
    RANK[a.state] - RANK[b.state] || (a.label ?? a.name).localeCompare(b.label ?? b.name);
  const pageKey = `${needle ? `?${needle}` : active}|${shown
    .map((tile) => tile.name)
    .sort()
    .join("|")}`;
  const [page, setPage] = useState<{ key: string; order: string[] }>({ key: "", order: [] });
  if (page.key !== pageKey) {
    setPage({ key: pageKey, order: [...shown].sort(byRank).map((tile) => tile.name) });
  }
  const position = new Map(page.order.map((name, index) => [name, index]));
  const ordered =
    page.key === pageKey
      ? [...shown].sort((a, b) => (position.get(a.name) ?? 0) - (position.get(b.name) ?? 0))
      : [...shown].sort(byRank);
  const presentStates = new Set(tiles.map((tile) => tile.state));
  const toggles = (tile: SpellTile) =>
    Boolean(onTile) && (canToggle ? canToggle(tile) : tile.state !== "granted");

  return (
    <div className="spellbook">
      {counters.length || header ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          {counters.map((counter) => {
            const full = counter.max !== undefined && counter.max !== null && counter.value >= counter.max;
            return (
              <span
                key={counter.label}
                data-full={full ? "true" : undefined}
                className={cn(
                  "rounded-full border px-2.5 py-0.5",
                  full
                    ? "border-stone-700 text-stone-400"
                    : "border-amber-500/50 bg-amber-400/10 text-amber-200",
                )}
              >
                {counter.label}{" "}
                <span className="font-mono">
                  {counter.value}
                  {counter.max !== undefined && counter.max !== null ? `/${counter.max}` : ""}
                </span>
                {counter.extra ? <span className="text-sky-300"> {counter.extra}</span> : null}
              </span>
            );
          })}
          {header}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Spell level" className="flex flex-wrap gap-1">
          {keys.map((key) => {
            const count = chosenIn(key);
            const selected = !needle && key === active;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mounted && selected}
                title={levelLabel(key)}
                onClick={() => {
                  setTab(key);
                  setFilter("");
                }}
                className={cn(
                  "relative min-w-9 rounded-lg border px-2.5 py-1 font-display text-xs tracking-wide transition-colors",
                  selected
                    ? "border-amber-400/70 bg-amber-400/15 text-amber-100 shadow-[0_0_12px_rgba(212,171,58,0.2)]"
                    : "border-stone-700/70 text-stone-400 hover:border-amber-500/40 hover:text-stone-200",
                )}
              >
                {tabLabel(key)}
                {count ? (
                  <span className="ml-1 rounded-full bg-amber-400/20 px-1.5 font-mono text-[10px] text-amber-200">
                    {count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Find a spell..."
          aria-label="Find a spell"
          className="ml-auto w-36 rounded-md border border-stone-700/70 bg-stone-950 px-2 py-1 text-xs text-stone-200 outline-none focus:border-amber-400/60"
        />
      </div>

      {/* One line, always: a note that wrapped on a phone pushed the tiles
          down under the finger, the very jump issue 66 was about. The whole
          note is its tooltip; the full counter shakes with the tile. */}
      <p className="mt-2 mb-1.5 flex h-4 min-w-0 items-center gap-2">
        <span className="eyebrow shrink-0 text-[10px] leading-4 text-stone-500">
          {needle ? `Matching "${filter.trim()}"` : levelLabel(active)}
        </span>
        {notice ? (
          <span
            role="status"
            title={typeof notice === "string" ? notice : undefined}
            className="reveal min-w-0 truncate text-xs leading-4 text-amber-300"
          >
            {notice}
          </span>
        ) : null}
      </p>
      {ordered.length ? (
        // Columns follow the room the book is drawn in, not the window: the
        // level-up dialog is narrow on a wide screen, and four columns there
        // cut "Absorb Elements" to "Absorb Eleme".
        <div className="@container">
        <ul className="grid grid-cols-2 gap-1.5 @lg:grid-cols-3 @3xl:grid-cols-4">
          {ordered.map((tile) => {
            const clickable = toggles(tile) && !busy;
            const facts = tile.data ? spellSummary(tile.data) : undefined;
            const summary = tile.source ? [facts, tile.source].filter(Boolean).join(" · ") : facts;
            return (
              <li
                key={tile.name}
                className="spell-tile"
                data-state={tile.state}
                data-blocked={tile.blocked ? "true" : undefined}
              >
                <button
                  type="button"
                  disabled={!clickable}
                  aria-pressed={tile.state !== "available" && tile.state !== "inBook"}
                  onClick={(event) => {
                    if (tile.blocked) {
                      const shake = "shake-x var(--dur-beat) var(--ease-snap) both";
                      replayAnimation(event.currentTarget.closest("li"), shake);
                      event.currentTarget
                        .closest(".spellbook")
                        ?.querySelectorAll<HTMLElement>("[data-full]")
                        .forEach((pill) => replayAnimation(pill, shake));
                    }
                    onTile?.(tile);
                  }}
                  title={tile.blocked ?? tile.note ?? STATE_TEXT[tile.state]}
                  className="flex w-full min-w-0 items-center gap-2 text-left disabled:cursor-default"
                >
                  <span className="relative shrink-0">
                    <GameIcon icon={{ kind: "spell", key: tile.name }} size="size-9" />
                    <StateMark state={tile.state} />
                  </span>
                  <span className="min-w-0">
                    <span className="line-clamp-2 text-xs leading-tight [overflow-wrap:anywhere]" title={tile.label ?? tile.name}>
                      {tile.label ?? tile.name}
                      {tile.suggested ? (
                        <Star className="ml-1 inline size-3 fill-amber-300 text-amber-300" aria-label="suggested" />
                      ) : null}
                    </span>
                    <span className="spell-tile-state block truncate text-[10px]">
                      {tile.homebrew ? "homebrew · " : tile.source ? `${tile.source} · ` : ""}
                      {tile.blocked ?? tile.note ?? STATE_TEXT[tile.state]}
                    </span>
                  </span>
                </button>
                <InfoButton
                  label={tile.label ?? tile.name}
                  meta={summary}
                  text={tile.data ? describeContentEntry(tile.data) : undefined}
                  reference={
                    tile.homebrew
                      ? undefined
                      : { kind: "spells", slug: tile.slug ?? contentSlug(tile.name), name: tile.name }
                  }
                  className="absolute right-1 top-1"
                />
              </li>
            );
          })}
        </ul>
        </div>
      ) : (
        <p className="py-2 text-xs text-stone-500">{needle ? "No spell matches." : emptyText}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-stone-500">
        {(["ready", "pending", "granted", "inBook", "available"] as SpellTileState[])
          .filter((state) => presentStates.has(state))
          .map((state) => (
            <span key={state} className="flex items-center gap-1">
              <span className="spell-tile-dot" data-state={state} aria-hidden="true" />
              {STATE_TEXT[state]}
            </span>
          ))}
        {tiles.some((tile) => tile.suggested) ? (
          <span className="flex items-center gap-1">
            <Star className="size-3 fill-amber-300 text-amber-300" aria-hidden="true" /> Suggested
          </span>
        ) : null}
      </div>
      {footer}
    </div>
  );
}

function StateMark({ state }: { state: SpellTileState }) {
  const icon =
    state === "ready" ? (
      <Check className="size-2.5" />
    ) : state === "pending" ? (
      <Hourglass className="size-2.5" />
    ) : state === "granted" ? (
      <Lock className="size-2.5" />
    ) : state === "inBook" ? (
      <BookOpen className="size-2.5" />
    ) : null;
  return icon ? (
    <span className="spell-tile-mark" data-state={state} aria-hidden="true">
      {icon}
    </span>
  ) : null;
}
