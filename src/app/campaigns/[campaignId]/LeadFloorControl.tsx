"use client";

import { Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { SectionHead } from "@/components/ui/SectionHead";
import { Switch } from "@/components/ui/Switch";
import { PanelError, kitButtonClass, panelField } from "./PanelKit";
import { SequenceEditor } from "./SequenceEditor";
import { fitSequence, type PlanSequence } from "@/lib/dm/plan-order";
import type { Floor } from "@/lib/db/campaigns";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import { extraTurnTag, litOrderRows, orderRowKey } from "@/lib/battlemap/initiative-rows";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { heroFell } from "@/lib/characters/fallen-logic";

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

// The kit's small button (ui.btnSmall through PanelKit); the mode in force wears gold.
const chip = kitButtonClass("small", "disabled:opacity-40");
const chipOn = "border-amber-500/60 bg-amber-400/10 text-amber-100 disabled:opacity-100";
const chipOff = "";

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
  aiNarrates = false,
  coordinating = false,
}: {
  campaignId: string;
  floor: Floor;
  sheets: CharacterSheet[];
  encounter?: PublicEncounter | null;
  // Coordinate actions (issue 254) is offered at a table the AI narrates,
  // outside a fight, when no plan is being drafted already.
  aiNarrates?: boolean;
  coordinating?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Character ids, which is what the route takes; it resolves them to the
  // players behind them and drops companions itself.
  const [picked, setPicked] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  // Coordinate actions: the characters in the plan (companions too, who act
  // in it without holding it up), the whole party when none are picked.
  const [planned, setPlanned] = useState<string[]>([]);
  const [planPrompt, setPlanPrompt] = useState("");
  // The order they act in (issue 292), when the lead sets one: steps of
  // character ids, kept to whoever is in the plan as the picks change.
  const [inOrder, setInOrder] = useState(false);
  const [orderDraft, setOrderDraft] = useState<PlanSequence>([]);
  const participants = planned.length
    ? planned.flatMap((id) => sheets.filter((sheet) => sheet.id === id))
    : sheets;
  const planSequence = fitSequence(orderDraft, participants.map((sheet) => sheet.id));

  // Companions have no player to wait on, so they cannot hold the floor,
  // and nor can a hero who fell (issue 655): the lead is neither offered
  // them nor shown them as waited on.
  const players = sheets.filter((sheet) => !sheet.isCompanion && !heroFell(sheet));
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

  async function coordinate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/coordination`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          characterIds: planned,
          prompt: planPrompt.trim(),
          sequence: inOrder && planSequence.length > 1 ? planSequence : null,
        }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "The plan did not open.");
        return;
      }
      setPlanned([]);
      setPlanPrompt("");
      setInOrder(false);
      setOrderDraft([]);
    } catch {
      setError("Could not reach the table.");
    } finally {
      setBusy(false);
    }
  }

    function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  return (
    <div className="panel mb-3 rounded-lg p-3">
      <SectionHead title="The floor" glyph="rest-initiative" />
      <p className="text-xs text-stone-300">{modeLabel(floor)}</p>

      {floor.mode === "initiative" ? (
        <div className="reveal mt-2 space-y-1.5">
          <p className="text-xs text-stone-500">
            Round {floor.round}
            {encounter?.orderReady && encounter.order.length ? (
              <>
                {" · "}
                {encounter.order.map((entry, index, order) => (
                  // Keyed by position: a thief's second round-1 turn repeats the id.
                  <span
                    key={orderRowKey(entry, index)}
                    title={extraTurnTag(entry)?.title}
                    className={cn(
                      "transition-colors duration-200",
                      litOrderRows(order, encounter.turnIndex, encounter.acting, encounter.enemiesUp).includes(index) ? "font-medium text-amber-200" : undefined,
                    )}
                  >
                    {index > 0 ? " > " : ""}
                    {entry.name}
                    {entry.reflex ? <sup className="motion-pop ml-0.5 text-[9px] text-amber-300">{extraTurnTag(entry)?.short}</sup> : null}
                  </span>
                ))}
              </>
            ) : (
              <> · {floor.currentName}&apos;s turn</>
            )}
          </p>
          <button
            type="button"
            disabled={busy} aria-busy={busy}
            onClick={() => post({})}
            title="Skip the current player's turn"
            className={cn(chip, chipOff)}
          >
            Skip turn
          </button>
        </div>
      ) : (
        <>
          <div data-pill-group="" role="group" aria-label="Floor mode" className="mt-2 flex flex-wrap gap-1.5">
            <button data-on={floor.mode === "open" ? "" : undefined}
              type="button"
              disabled={busy || floor.mode === "open"}
              onClick={() => post({ set: "open" })}
              title="Let anyone act"
              className={cn(chip, floor.mode === "open" ? chipOn : chipOff)}
            >
              Open floor
            </button>
            <button data-on={floor.mode === "hold" ? "" : undefined}
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
            <p className="reveal mt-1.5 text-xs text-stone-500">
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
            <div className="panel ornate reveal mt-2 rounded-lg border-amber-500/40 px-2.5 py-2">
              {floor.prompt ? (
                <p className="reveal mb-1 font-serif text-xs italic text-amber-200/80">{floor.prompt}</p>
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
                      <span className="text-[11px] text-stone-500">
                        {answered ? "answered" : "waiting"}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={busy} aria-busy={busy}
                onClick={() => post({})}
                title="Open the floor now; whatever has been answered goes to the GM"
                className={cn(chip, chipOff, "mt-1.5")}
              >
                Release
              </button>
            </div>
          ) : null}

          <SectionHead title="Give the floor" glyph="tab-party" level="h4" className="mt-3" aside={picked.length ? `${picked.length} picked` : null} />
          <div className="flex flex-wrap gap-1.5">
            {players.length ? (
              players.map((sheet) => {
                const on = picked.includes(sheet.id);
                return (
                  <button
                    key={sheet.id}
                    type="button"
                    disabled={busy} aria-busy={busy}
                    onClick={() => togglePick(sheet.id)}
                    aria-pressed={on}
                    data-on={on ? "" : undefined}
                    className="pk-pill pk-tap motion-press py-0.5 pl-0.5"
                  >
                    {sheet.portrait ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={sheet.portrait.url}
                        alt=""
                        className="size-6 rounded-full border border-amber-500/30 object-cover"
                      />
                    ) : (
                      <span className="flex size-6 items-center justify-center rounded-full bg-stone-800 text-[10px] font-medium text-stone-300">
                        {sheet.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {sheet.name}
                  </button>
                );
              })
            ) : (
              <span className="text-xs text-stone-500">No player characters yet.</span>
            )}
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={300}
              placeholder="What are you asking them? (optional)"
              aria-label="What are you asking them? (optional)"
              className={cn(panelField, "w-auto min-w-0 flex-1")}
            />
            <button
              type="button"
              disabled={busy || !picked.length}
              onClick={spotlight}
              title="Only the picked players may act until each has answered or you release"
              className={kitButtonClass("primary", "shrink-0")}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Spotlight
            </button>
          </div>
        </>
      )}

      {aiNarrates && floor.mode !== "initiative" && !coordinating ? (
        <div className="mt-3" data-coordinate-open>
          <SectionHead
            title="Coordinate actions"
            glyph="tab-party"
            level="h4"
            aside={planned.length ? `${planned.length} picked` : "whole party"}
          />
          <p className="mb-1.5 text-xs text-stone-500">
            Each player stages what their characters do in the same moment, edits it until ready or passes, and the GM
            resolves the whole plan as one beat. Companions join without holding it up. Set an order when one move has to
            come before another.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sheets.map((sheet) => {
              const on = planned.includes(sheet.id);
              return (
                <button
                  key={sheet.id}
                  type="button"
                  disabled={busy}
                  onClick={() => setPlanned((prev) => (prev.includes(sheet.id) ? prev.filter((id) => id !== sheet.id) : [...prev, sheet.id]))}
                  aria-pressed={on}
                  data-on={on ? "" : undefined}
                  className="pk-pill pk-tap motion-press py-0.5"
                >
                  {sheet.name}
                  {sheet.isCompanion ? <span className="text-[10px] text-stone-500"> companion</span> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-stone-300">
            <span>In order{inOrder ? "" : ": off, everyone acts at once"}</span>
            <Switch
              on={inOrder}
              onChange={(on) => {
                setInOrder(on);
                if (on && !orderDraft.length) {
                  setOrderDraft(participants.map((sheet) => [sheet.id]));
                }
              }}
              label="Set the order they act in"
            />
          </div>
          {inOrder && participants.length > 1 ? (
            <div className="reveal mt-1.5" data-coordinate-order>
              <SequenceEditor
                items={participants.map((sheet) => ({ id: sheet.id, name: sheet.name, companion: Boolean(sheet.isCompanion) }))}
                sequence={planSequence}
                onChange={setOrderDraft}
                disabled={busy}
                label="The order the characters act in"
              />
            </div>
          ) : null}
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={planPrompt}
              onChange={(event) => setPlanPrompt(event.target.value)}
              maxLength={300}
              placeholder="The moment you are planning (optional)"
              aria-label="The moment you are planning (optional)"
              className={cn(panelField, "w-auto min-w-0 flex-1")}
            />
            <button
              type="button"
              disabled={busy || !sheets.some((sheet) => !sheet.isCompanion)}
              onClick={() => void coordinate()}
              title="Open a shared plan; nothing reaches the GM until the players are ready"
              className={kitButtonClass("primary", "shrink-0")}
              data-coordinate-start
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Coordinate
            </button>
          </div>
        </div>
      ) : coordinating ? (
        // The plan itself is drawn above the composer for every seat; on a
        // phone that is the Table view, not this panel.
        <p className="motion-pop mt-3 rounded-md border border-amber-500/30 bg-amber-950/20 px-2.5 py-1.5 text-xs text-amber-100/90" data-coordinating-note>
          The party is coordinating. The plan, with Resolve now and Set aside, is above the box where everyone types.
        </p>
      ) : null}

      {error ? <PanelError className="mt-1.5">{error}</PanelError> : null}
    </div>
  );
}
