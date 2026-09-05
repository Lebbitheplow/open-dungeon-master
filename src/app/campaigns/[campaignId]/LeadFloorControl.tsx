"use client";

import { Check, Loader2, Megaphone } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Who may speak right now, from the lead's desk. The same route the DM
// console's FloorControl and the composer banners call, with the one thing
// neither of them offers: choosing who gets the spotlight. The banners
// above the composer only ever release; the console only opens and holds.
//
// The floor_changed event is the source of truth for what shows here. A
// click that the server refuses (a fight running, no character picked)
// leaves the floor where it was, so the refusal is surfaced inline rather
// than trusted to be noticed by its absence.

type FloorRequest =
  | { set: "open" | "hold" }
  | { set: "spotlight"; characterIds: string[]; prompt: string }
  | Record<string, never>;

const chip = "rounded-md border px-2 py-1 text-xs disabled:opacity-40";
const chipOn = "border-amber-700 bg-amber-950/50 text-amber-100";
const chipOff = "border-stone-700 text-stone-400 hover:text-stone-200";

function modeLabel(floor: Floor): string {
  switch (floor.mode) {
    case "open":
      return "Open: anyone may act.";
    case "hold":
      return "Held: nobody acts until you open it.";
    case "spotlight":
      return "Spotlight: only the named players may act.";
    case "initiative":
      return "The initiative order has the floor while the fight runs.";
  }
}

export function LeadFloorControl({
  campaignId,
  floor,
  sheets,
  encounter,
}: {
  campaignId: string;
  floor: Floor;
  sheets: CharacterSheet[];
  encounter?: PublicEncounter | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Character ids, which is what the route takes; it resolves them to the
  // players behind them and drops companions itself.
  const [picked, setPicked] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");

  // Companions have no player to wait on, so they cannot hold the floor.
  const players = sheets.filter((sheet) => !sheet.isCompanion);
  const spotlighted =
    floor.mode === "spotlight"
      ? players.filter((sheet) => floor.userIds.includes(sheet.userId))
      : [];

  async function post(body: FloorRequest): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/floor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The floor did not change.");
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

  async function spotlight() {
    if (await post({ set: "spotlight", characterIds: picked, prompt: prompt.trim() })) {
      setPicked([]);
      setPrompt("");
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  return (
    <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-stone-400">
        <Megaphone className="size-3.5" /> The floor
      </p>
      <p className="text-xs text-stone-300">{modeLabel(floor)}</p>

      {floor.mode === "initiative" ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[11px] text-stone-500">
            Round {floor.round}
            {encounter?.orderReady && encounter.order.length ? (
              <>
                {" · "}
                {encounter.order.map((entry, index) => (
                  <span
                    key={entry.id}
                    className={
                      index === encounter.turnIndex ? "font-medium text-stone-200" : undefined
                    }
                  >
                    {index > 0 ? " > " : ""}
                    {entry.name}
                  </span>
                ))}
              </>
            ) : (
              <> · {floor.currentName}&apos;s turn</>
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => post({})}
            title="Skip the current player's turn"
            className={cn(chip, chipOff)}
          >
            Skip turn
          </button>
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy || floor.mode === "open"}
              onClick={() => post({ set: "open" })}
              title="Let anyone act"
              className={cn(chip, floor.mode === "open" ? chipOn : chipOff)}
            >
              Open floor
            </button>
            <button
              type="button"
              disabled={busy || floor.mode === "hold"}
              onClick={() => post({ set: "hold" })}
              title="Hold every response while the table talks it over"
              className={cn(chip, floor.mode === "hold" ? chipOn : chipOff)}
            >
              Hold for talk
            </button>
          </div>

          {floor.mode === "hold" && floor.next.mode === "spotlight" ? (
            <p className="mt-1.5 text-[11px] text-stone-500">
              On release: spotlight on{" "}
              {players
                .filter(
                  (sheet) =>
                    floor.next.mode === "spotlight" && floor.next.userIds.includes(sheet.userId),
                )
                .map((sheet) => sheet.name)
                .join(", ") || "someone"}
              .
            </p>
          ) : null}

          {floor.mode === "spotlight" ? (
            <div className="mt-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-2.5 py-2">
              {floor.prompt ? (
                <p className="mb-1 text-[11px] italic text-amber-200/80">{floor.prompt}</p>
              ) : null}
              <ul className="space-y-0.5 text-xs">
                {spotlighted.map((sheet) => {
                  const answered = floor.respondedUserIds.includes(sheet.userId);
                  return (
                    <li
                      key={sheet.id}
                      className={cn(
                        "flex items-center gap-1.5",
                        answered ? "text-stone-500" : "text-amber-200",
                      )}
                    >
                      {answered ? (
                        <Check className="size-3 text-emerald-400" />
                      ) : (
                        <span className="inline-block size-3 text-center text-[10px] leading-3">
                          ...
                        </span>
                      )}
                      {sheet.name}
                      <span className="text-[10px] text-stone-600">
                        {answered ? "answered" : "waiting"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => post({})}
                title="Open the floor now; whatever has been answered goes to the DM"
                className={cn(chip, chipOff, "mt-1.5")}
              >
                Release
              </button>
            </div>
          ) : null}

          <p className="mb-1 mt-3 text-[11px] font-medium text-stone-500">Give the floor</p>
          <div className="flex flex-wrap gap-1.5">
            {players.length ? (
              players.map((sheet) => {
                const on = picked.includes(sheet.id);
                return (
                  <button
                    key={sheet.id}
                    type="button"
                    disabled={busy}
                    onClick={() => togglePick(sheet.id)}
                    aria-pressed={on}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] disabled:opacity-40",
                      on ? chipOn : chipOff,
                    )}
                  >
                    {sheet.portrait ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sheet.portrait.url}
                        alt=""
                        className="size-5 rounded-full border border-stone-800 object-cover"
                      />
                    ) : (
                      <span className="flex size-5 items-center justify-center rounded-full bg-stone-800 text-[10px] font-medium text-stone-300">
                        {sheet.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {sheet.name}
                  </button>
                );
              })
            ) : (
              <span className="text-[11px] text-stone-600">No player characters yet.</span>
            )}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={300}
              placeholder="What are you asking them? (optional)"
              className="min-w-0 flex-1 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600"
            />
            <button
              type="button"
              disabled={busy || !picked.length}
              onClick={spotlight}
              title="Only the picked players may act until each has answered or you release"
              className={cn(chip, chipOff, "flex shrink-0 items-center gap-1")}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null}
              Spotlight
            </button>
          </div>
        </>
      )}

      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
