"use client";

import { ChevronDown, ChevronUp, Clock, ListRestart, Plus, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useState } from "react";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { cn } from "@/lib/cn";
import { ENTRY_NAME_MAX, MAX_INITIATIVE, MIN_INITIATIVE } from "@/lib/dm/initiative-edit";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { TokenFace, type FaceLookup } from "@/app/campaigns/[campaignId]/BoardChrome";

// The DM's hands on the turn order: reorder it, insert a slot for somebody
// the engine has no stat block for, delay, remove, hand the turn to a
// player, and step back when somebody clicked too fast.
//
// Stepping back moves the pointer and the round counter and nothing else. It
// does not give hit points back or un-tick a condition, because undoing what
// happened is what the audit trail is for, and a rewind that pretended
// otherwise would be worse than no rewind at all.

// Tap targets a thumb can hit on a phone (U:UD10): the icons stay small, the
// buttons around them do not.
const ROW_ICON =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-stone-500 hover:text-stone-200 disabled:opacity-40 motion-nudge";
const HEAD_ICON =
  "inline-flex size-9 items-center justify-center rounded-md border border-stone-700 text-stone-400 hover:text-stone-200 disabled:opacity-40 motion-press";

const KIND_LABELS: Record<string, string> = {
  pc: "Player",
  enemy: "Enemy",
  npc: "Yours",
};

export function DmInitiativePanel({
  campaignId,
  encounter,
  faceOf,
}: {
  campaignId: string;
  encounter: PublicEncounter;
  // The pictures to try for an entry, best first. A row shows a face, not a
  // letter, wherever the caller knows one (docs/visual-overhaul-plan.md 5.1).
  faceOf?: FaceLookup;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [initiative, setInitiative] = useState(12);

  async function send(body: unknown) {
    if (busy) {
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/initiative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "The order would not take that.");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the table.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!encounter.orderReady) {
    return (
      <div className="mt-2 space-y-1 text-[11px] text-stone-500">
        <p>
          Every player has been asked for initiative; the order locks once the last roll is in. The monsters have
          already rolled.
        </p>
        {encounter.staged?.length ? (
          <p className="reveal text-stone-400">
            In so far: {encounter.staged.map((entry) => `${entry.name} ${entry.initiative}`).join(", ")}
          </p>
        ) : null}
        {error ? <p className="text-red-300">{error}</p> : null}
      </div>
    );
  }

  const current = encounter.order[encounter.turnIndex];
  const due = encounter.enemiesDue ?? [];

  return (
    <section className="mt-2 space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <p className="mr-auto text-xs font-medium uppercase tracking-wide text-stone-500">
          The order
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ op: "step", direction: "back" })}
          aria-label="Back a turn"
          title="Back a turn"
          className={HEAD_ICON}
        >
          <SkipBack className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ op: "step", direction: "forward" })}
          aria-label="On a turn"
          title="On a turn"
          className={HEAD_ICON}
        >
          <SkipForward className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (
              await appConfirm("Clear the order and have everyone roll again?", {
                title: "Reset initiative",
                actionLabel: "Roll again",
                tone: "plain",
              })
            ) {
              void send({ op: "reset" });
            }
          }}
          aria-label="Reset initiative"
          title="Reset initiative"
          className={HEAD_ICON}
        >
          <ListRestart className="size-3.5" />
        </button>
      </div>
      {due.length ? (
        // The enemies the pointer walked past, held for the DM to play before
        // the next player's turn (src/lib/dm/enemies-due.ts).
        <div className="reveal space-y-1.5 rounded-md border border-red-900/60 bg-red-950/30 px-2 py-1.5">
          <p className="text-xs text-red-100">
            Enemy turns before {current?.name ?? "the next player"}:{" "}
            {due.map((enemy, index) => (
              <span key={enemy.id} className={cn("transition-colors duration-[260ms]", enemy.acted && "text-stone-500 line-through")}>
                {index ? ", " : ""}
                {enemy.name}
              </span>
            ))}
          </p>
          <p className="text-[11px] text-stone-400">
            Play them with the cards above the message box (or from the console), then hand on the
            turn. The players wait until you do.
          </p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "enemies", play: true })}
              className="min-h-9 rounded-md border border-red-800 bg-red-950/50 px-3 py-1 text-xs text-red-100 disabled:opacity-40 motion-press"
            >
              Play the rest for me
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "enemies", play: false })}
              className="min-h-9 rounded-md border border-amber-700 bg-amber-950/50 px-3 py-1 text-xs text-amber-100 disabled:opacity-40 motion-press"
            >
              Done, hand on the turn
            </button>
          </div>
        </div>
      ) : encounter.companionTurn ? (
        <div className="reveal flex flex-wrap items-center gap-1.5 rounded-md border border-sky-900/60 bg-sky-950/30 px-2 py-1.5">
          <p className="mr-auto text-xs text-sky-100">
            {encounter.companionTurn.name} is an AI companion: run their turn from the console, or
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ op: "companion" })}
            className="min-h-9 rounded-md border border-sky-800 bg-sky-950/50 px-3 py-1 text-xs text-sky-100 disabled:opacity-40 motion-press"
          >
            Play their turn
          </button>
        </div>
      ) : null}
      <ol className="space-y-1">
        {encounter.order.map((entry, index) => (
          <li
            key={`${entry.id}-${index}`}
            className={cn(
              // The turn passes as a glow that moves, not one that blinks.
              "flex flex-wrap items-center gap-1 rounded-md border px-2 py-1 transition-[color,background-color,border-color,box-shadow] duration-[260ms] ease-settle",
              index === encounter.turnIndex
                ? "border-amber-700 bg-amber-950/40 shadow-glow-gold"
                : "border-stone-800",
            )}
          >
            <span className="w-6 shrink-0 text-right font-mono text-[10px] text-stone-500">
              {entry.initiative ?? ""}
            </span>
            <TokenFace
              candidates={faceOf?.(entry) ?? []}
              name={entry.name}
              enemy={entry.kind === "enemy"}
              className={cn(
                "size-6 rounded-full border",
                index === encounter.turnIndex ? "border-amber-500" : "border-stone-700",
                entry.hidden && "opacity-60",
              )}
            />
            <button
              type="button"
              disabled={busy || entry.kind !== "pc" || index === encounter.turnIndex}
              onClick={() => void send({ op: "goto", id: entry.id })}
              title={entry.kind === "pc" ? "Give them the turn" : "The turn rests on players only"}
              className={cn(
                "min-h-9 min-w-0 flex-1 truncate text-left text-xs disabled:cursor-default",
                index === encounter.turnIndex ? "text-amber-100" : "text-stone-300",
                entry.kind === "pc" && index !== encounter.turnIndex && "hover:text-amber-200",
              )}
            >
              {entry.name}
              <span className="ml-1.5 text-[10px] text-stone-600">
                {KIND_LABELS[entry.kind] ?? entry.kind}
                {entry.hidden ? " · hidden" : ""}
                {entry.reflex ? (
                  <span className="motion-pop ml-1 text-amber-300" title="Thief's Reflexes: a second turn in the first round">
                    · 2nd turn
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "move", id: entry.id, direction: "up" })}
              aria-label={`Move ${entry.name} up the order`}
              title="Up the order"
              className={ROW_ICON}
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "move", id: entry.id, direction: "down" })}
              aria-label={`Move ${entry.name} down the order`}
              title="Down the order"
              className={ROW_ICON}
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "delay", id: entry.id })}
              aria-label={`Delay ${entry.name} to the bottom of the round`}
              title="Delay to the bottom of the round"
              className={ROW_ICON}
            >
              <Clock className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (await appConfirm(`Take ${entry.name} out of the order? They get no more turns in this fight.`, { actionLabel: "Take out" })) {
                  void send({ op: "remove", id: entry.id });
                }
              }}
              aria-label={`Take ${entry.name} out of the order`}
              title="Out of the order"
              className={cn(ROW_ICON, "hover:text-red-300")}
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      {adding ? (
        <div className="reveal flex flex-wrap items-center gap-1">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={ENTRY_NAME_MAX}
            placeholder="Captain Vell"
            className="min-h-9 min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600 motion-input"
          />
          <NumberStepper
            value={initiative}
            min={MIN_INITIATIVE}
            max={MAX_INITIATIVE}
            onChange={setInitiative}
            label="Initiative"
            size="sm"
          />
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => {
              void send({ op: "insert", name: name.trim(), initiative }).then((ok) => {
                if (ok) {
                  setName("");
                  setAdding(false);
                }
              });
            }}
            className="min-h-9 rounded-md border border-amber-700 bg-amber-950/50 px-3 py-1 text-xs text-amber-100 disabled:opacity-40 motion-press"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="min-h-9 rounded-md border border-stone-700 px-3 py-1 text-xs text-stone-400 hover:text-stone-200 motion-press"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex min-h-9 items-center gap-1 rounded-md border border-stone-700 px-3 py-1 text-xs text-stone-400 hover:text-stone-200 motion-press"
        >
          <Plus className="size-3.5" />
          A slot of your own
        </button>
      )}
      <p className="text-[11px] leading-4 text-stone-600">
        Stepping back moves the turn, not the world: hit points and conditions stay where
        the fight left them.
      </p>
      {error ? <p role="alert" className="motion-shake text-[11px] text-red-400">{error}</p> : null}
    </section>
  );
}
