"use client";

import { Dices, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { GameIcon } from "@/components/ui/GameIcon";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { defensesView, hitDiceRows, stateTags, type StateTag } from "@/components/sheet/sheet-state";

// The character's state the engine keeps beside the conditions, as chips
// that pop in one after another (motion-pop, the sheet's own stagger): the
// death track, exhaustion with what each level does, concentration, a
// readied action and its trigger, Inspiration. Each chip's tooltip is the
// rule it stands for.

const TONE: Record<StateTag["tone"], string> = {
  harm: "border-red-800/60 bg-red-950/40 text-red-200",
  ward: "border-sky-800/60 bg-sky-950/40 text-sky-200",
  bless: "border-amber-700/60 bg-amber-950/40 text-amber-200",
  neutral: "border-stone-700/60 bg-stone-900/60 text-stone-300",
};

const GLYPH: Record<StateTag["id"], string> = {
  exhaustion: "rest-exhaustion",
  concentration: "rest-spell-slot",
  dying: "rest-death-save",
  stable: "rest-death-save",
  dead: "rest-death-save",
  readied: "rest-initiative",
  inspiration: "rest-inspiration",
  incapacitated: "rest-death-save",
};

export function StateTags({ sheet, className }: { sheet: CharacterSheet; className?: string }) {
  const tags = stateTags(sheet);
  if (!tags.length) return null;
  return (
    <div className={cn("stagger-pop flex flex-wrap gap-1.5", className)} aria-label="Combat state">
      {tags.map((tag, index) => (
        <Tooltip key={tag.id} content={tag.note}>
          <span
            // Keyed by what it says, so a changed count (a death save, a
            // level of exhaustion) pops in as new instead of cutting.
            key={tag.label}
            className={cn("motion-pop inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", TONE[tag.tone], tag.id === "dying" && "death-beat")}
            style={{ animationDelay: `${index * 45}ms` } as CSSProperties}
            tabIndex={0}
          >
            <GameIcon icon={{ kind: "glyph", key: GLYPH[tag.id] }} size="size-4" />
            {tag.label}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

// Resistances and immunities the engine applies to damage (pcResistances,
// pcImmunities): race, features, rage, spells, worn magic items.
export function DefensesLine({ sheet }: { sheet: CharacterSheet }) {
  const { resist, immune } = defensesView(sheet);
  if (!resist && !immune) return null;
  return (
    <p className="reveal mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-300">
      {resist ? (
        <span>
          <span className="text-stone-500">Resists </span>
          {resist}
        </span>
      ) : null}
      {immune ? (
        <span>
          <span className="text-stone-500">Immune to </span>
          {immune}
        </span>
      ) : null}
    </p>
  );
}

// Every hit die pool (a multiclass character keeps one per class), and,
// for the sheet's owner inside the short-rest window the DM's take_rest
// opened, the control that spends one: the server rolls it, adds CON and
// heals (POST /sheet/hit-dice). Outside the window there is nothing to press.
export function HitDiceSpend({
  sheet,
  mine,
  inCombat,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  inCombat: boolean;
}) {
  const rows = hitDiceRows(sheet);
  const left = rows.reduce((sum, row) => sum + row.left, 0);
  const [windowOpen, setWindowOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; tone: "ok" | "refused" } | null>(null);
  const asks = mine && !inCombat;
  const open = asks && windowOpen;

  // Bumped after a refusal, to ask the window again.
  const [asked, setAsked] = useState(0);
  const check = useCallback(() => setAsked((count) => count + 1), []);

  // Asked when the sheet opens and whenever the dice change (a spend, a rest).
  useEffect(() => {
    if (!asks) return;
    let live = true;
    fetch(`/api/campaigns/${sheet.campaignId}/sheet/hit-dice?characterId=${encodeURIComponent(sheet.id)}`)
      .then((response): Promise<{ open?: boolean }> | { open?: boolean } =>
        response.ok ? (response.json() as Promise<{ open?: boolean }>) : {},
      )
      .then((data) => {
        if (live) setWindowOpen(Boolean(data.open));
      })
      .catch(() => {
        if (live) setWindowOpen(false);
      });
    return () => {
      live = false;
    };
  }, [asks, sheet.campaignId, sheet.id, left, asked]);

  async function spend() {
    setBusy(true);
    setSaid(null);
    try {
      const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet/hit-dice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // This sheet's dice, not the selected character's: a player fielding
        // several may have another one open.
        body: JSON.stringify({ dice: 1, characterId: sheet.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; healed?: number; hp?: string };
      if (!response.ok) {
        // The route's own sentence (not resting, a fight on, none left).
        setSaid({ text: data.error ?? "The hit die was not spent.", tone: "refused" });
        check();
        return;
      }
      setSaid({
        text: typeof data.healed === "number" ? `Rolled: ${data.healed} hit points back${data.hp ? ` (now ${data.hp})` : ""}.` : "Hit die spent.",
        tone: "ok",
      });
    } catch {
      setSaid({ text: "The spend did not reach the server.", tone: "refused" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {rows.map((row, index) => (
          <span
            key={`${row.label}-${row.die}`}
            className="motion-pop inline-flex items-center gap-1 rounded-lg border border-stone-800 px-2 py-0.5 font-mono text-[11px] text-stone-300"
            style={{ animationDelay: `${index * 45}ms` }}
            title={`${row.label}: ${row.left} of ${row.total} ${row.die} left`}
          >
            <GameIcon icon={{ kind: "glyph", key: `die-${row.die}` }} size="size-4" />
            {rows.length > 1 ? <span className="capitalize text-stone-500">{row.label}</span> : null}
            {row.left}/{row.total}
            {row.die}
          </span>
        ))}
        {open ? (
          <button
            type="button"
            onClick={() => void spend()}
            disabled={busy || left <= 0}
            className={cn(ui.btnSmall, "hit-dice-spend motion-pop min-h-8")}
            title={left > 0 ? "Roll one hit die, add your Constitution, and heal that much." : "No hit dice left until a long rest."}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Dices className="size-3.5" />}
            Spend a hit die
          </button>
        ) : null}
      </div>
      {said ? (
        <p
          key={said.text}
          role={said.tone === "refused" ? "alert" : "status"}
          className={cn("animate-fade-up text-[11px]", said.tone === "refused" ? "text-amber-300" : "text-emerald-300")}
        >
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
