"use client";

import { useState, type CSSProperties } from "react";
import { Dices } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAP_THEMES, type GeneratedMap, type MapTheme } from "@/lib/battlemap/generate";
import { Chip, FinePrint, mapInput } from "@/app/campaigns/[campaignId]/mapUi";
import { dieSpins, forgeGenerate, freshSeed, readHint } from "@/app/workshop/maps/forge";
import { THEME_LABELS } from "@/app/workshop/maps/types";

// The Roll tool's options (N on the rail): the forge's hint and theme, cut
// down to the column, rolling the whole field of the map that is open. The
// size stays the map's own. The new ground goes to the server as "return to
// this terrain", the same request undo sends, so it is checked like any other
// paint and it lands in the history: undo puts the old field back.

export function MapRollPanel({
  width,
  height,
  genre,
  busy,
  onRoll,
}: {
  width: number;
  height: number;
  genre: string | null | undefined;
  busy?: boolean;
  onRoll: (generated: GeneratedMap, seed: number) => Promise<unknown> | void;
}) {
  const [hint, setHint] = useState("");
  const [theme, setTheme] = useState<MapTheme | "">("");
  const [rolling, setRolling] = useState(false);
  // Counts rolls so the die starts each one from upright.
  const [rolls, setRolls] = useState(0);
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const read = hint.trim() ? readHint(hint, genre) : null;

  async function roll() {
    const seed = freshSeed();
    setRolling(true);
    setRolls((count) => count + 1);
    try {
      await onRoll(forgeGenerate({ seed, width, height, hint, theme, ambient: "" }, genre), seed);
      setLastSeed(seed);
    } finally {
      setRolling(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">What the place is like</span>
        <input
          value={hint}
          maxLength={200}
          onChange={(event) => setHint(event.target.value)}
          placeholder="a flooded crypt, torchlit"
          className={mapInput}
        />
      </label>
      {read?.themeWord && !theme ? (
        <FinePrint>
          &ldquo;{read.themeWord}&rdquo; reads as {THEME_LABELS[read.theme].toLowerCase()}.
        </FinePrint>
      ) : null}
      <div className="space-y-1">
        <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Or say outright</span>
        <div className="grid grid-cols-2 gap-1">
          {MAP_THEMES.map((option) => (
            <Chip key={option} active={theme === option} onClick={() => setTheme(theme === option ? "" : option)}>
              {THEME_LABELS[option]}
            </Chip>
          ))}
        </div>
      </div>
      <button
        type="button"
        disabled={busy || rolling}
        onClick={() => void roll()}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 text-amber-950 disabled:opacity-50 motion-magnet"
      >
        <Dices
          key={rolls}
          className={cn("size-4", rolling ? "map-die-spin" : rolls > 0 && "map-die-roll")}
          style={{ "--map-spins": dieSpins(width, height) } as CSSProperties}
        />
        <span className="font-display text-[12px] font-semibold uppercase tracking-[0.14em]">{rolling ? "Rolling" : "Roll the field"}</span>
      </button>
      <FinePrint>
        {lastSeed !== null ? `Seed ${lastSeed}. ` : ""}
        The whole field, {width} by {height}, from one seed. Everything placed on ground that turns to rock is dropped, and
        undo puts the old field back.
      </FinePrint>
    </div>
  );
}
