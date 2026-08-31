"use client";

import { ChevronDown, ChevronUp, Clock, ListRestart, Plus, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ENTRY_NAME_MAX, MAX_INITIATIVE, MIN_INITIATIVE } from "@/lib/dm/initiative-edit";
import type { PublicEncounter } from "@/lib/db/encounter-view";

// The DM's hands on the turn order: reorder it, insert a slot for somebody
// the engine has no stat block for, delay, remove, hand the turn to a
// player, and step back when somebody clicked too fast.
//
// Stepping back moves the pointer and the round counter and nothing else. It
// does not give hit points back or un-tick a condition, because undoing what
// happened is what the audit trail is for, and a rewind that pretended
// otherwise would be worse than no rewind at all.

const KIND_LABELS: Record<string, string> = {
  pc: "Player",
  enemy: "Enemy",
  npc: "Yours",
};

export function DmInitiativePanel({
  campaignId,
  encounter,
}: {
  campaignId: string;
  encounter: PublicEncounter;
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
      <p className="mt-2 text-[11px] text-stone-500">
        The order locks once every initiative is in. The monsters have already rolled.
      </p>
    );
  }

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
          className="rounded-md border border-stone-700 p-1 text-stone-400 hover:text-stone-200 disabled:opacity-40"
        >
          <SkipBack className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ op: "step", direction: "forward" })}
          aria-label="On a turn"
          title="On a turn"
          className="rounded-md border border-stone-700 p-1 text-stone-400 hover:text-stone-200 disabled:opacity-40"
        >
          <SkipForward className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Clear the order and have everyone roll again?")) {
              void send({ op: "reset" });
            }
          }}
          aria-label="Reset initiative"
          title="Reset initiative"
          className="rounded-md border border-stone-700 p-1 text-stone-400 hover:text-stone-200 disabled:opacity-40"
        >
          <ListRestart className="size-3.5" />
        </button>
      </div>
      <ol className="space-y-1">
        {encounter.order.map((entry, index) => (
          <li
            key={`${entry.id}-${index}`}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-1",
              index === encounter.turnIndex
                ? "border-amber-700 bg-amber-950/40"
                : "border-stone-800",
            )}
          >
            <span className="w-8 shrink-0 text-right font-mono text-[10px] text-stone-500">
              {entry.initiative ?? ""}
            </span>
            <button
              type="button"
              disabled={busy || entry.kind !== "pc" || index === encounter.turnIndex}
              onClick={() => void send({ op: "goto", id: entry.id })}
              title={entry.kind === "pc" ? "Give them the turn" : "The turn rests on players only"}
              className={cn(
                "min-w-0 flex-1 truncate text-left text-xs disabled:cursor-default",
                index === encounter.turnIndex ? "text-amber-100" : "text-stone-300",
                entry.kind === "pc" && index !== encounter.turnIndex && "hover:text-amber-200",
              )}
            >
              {entry.name}
              <span className="ml-1.5 text-[10px] text-stone-600">
                {KIND_LABELS[entry.kind] ?? entry.kind}
                {entry.hidden ? " · hidden" : ""}
              </span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "move", id: entry.id, direction: "up" })}
              aria-label={`Move ${entry.name} up the order`}
              title="Up the order"
              className="rounded p-0.5 text-stone-500 hover:text-stone-200 disabled:opacity-40"
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "move", id: entry.id, direction: "down" })}
              aria-label={`Move ${entry.name} down the order`}
              title="Down the order"
              className="rounded p-0.5 text-stone-500 hover:text-stone-200 disabled:opacity-40"
            >
              <ChevronDown className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "delay", id: entry.id })}
              aria-label={`Delay ${entry.name} to the bottom of the round`}
              title="Delay to the bottom of the round"
              className="rounded p-0.5 text-stone-500 hover:text-stone-200 disabled:opacity-40"
            >
              <Clock className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void send({ op: "remove", id: entry.id })}
              aria-label={`Take ${entry.name} out of the order`}
              title="Out of the order"
              className="rounded p-0.5 text-stone-500 hover:text-red-300 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
      {adding ? (
        <div className="flex flex-wrap items-center gap-1">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={ENTRY_NAME_MAX}
            placeholder="Captain Vell"
            className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 placeholder:text-stone-600"
          />
          <input
            type="number"
            value={initiative}
            min={MIN_INITIATIVE}
            max={MAX_INITIATIVE}
            onChange={(event) => setInitiative(Number(event.target.value))}
            className="w-16 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200"
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
            className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:text-stone-200"
        >
          <Plus className="size-3.5" />
          A slot of your own
        </button>
      )}
      <p className="text-[11px] leading-4 text-stone-600">
        Stepping back moves the turn, not the world: hit points and conditions stay where
        the fight left them.
      </p>
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </section>
  );
}
