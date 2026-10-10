"use client";

import { ArrowLeft, ChevronDown, Loader2, X } from "lucide-react";
import { memo, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";
import { HandCardFace, HandPreviewRows, typeLabel, typeTone } from "@/app/campaigns/[campaignId]/HandCardFace";
import type { HandCard } from "@/lib/battlemap/hand";
import { previewRows, type HandAim } from "@/lib/battlemap/hand-play";
import {
  deriveMonsterHand,
  monsterInvoke,
  monsterSentence,
  takesManyTargets,
  type MonsterAdvantage,
} from "@/lib/battlemap/monster-hand";
import { describeAdjudicationResult, type ResultLine } from "@/lib/dm/catalog-result";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { replayAnimation } from "@/lib/motion/replay";
import { effectiveAcFor } from "@/lib/srd";
import type { PublicEncounter } from "@/lib/db/encounter-view";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The DM's hand (issue #108): the monsters' turns as cards, above the
// message box where the players' Hand sits. The enemies the pointer walked
// past lead the roster (src/lib/dm/enemies-due.ts); any living enemy can be
// picked, as the console lets the DM correct anything. A played card is the
// console's own invoke call (monster-hand.ts), so the engine's rules hold.

const COLLAPSED_KEY = "odm:monster-hand-collapsed";
const STORE_EVENT = "odm-monster-hand-store";

function subscribeStore(callback: () => void) {
  window.addEventListener(STORE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(STORE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(on: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, on ? "1" : "0");
  } catch {
    // Storage can be denied; the choice then lasts as long as the page.
  }
  window.dispatchEvent(new Event(STORE_EVENT));
}

type PartyChip = HandAim & { note: string };

const ADVANTAGE: Array<[MonsterAdvantage, string]> = [
  ["none", "Straight"],
  ["advantage", "Advantage"],
  ["disadvantage", "Disadvantage"],
];

function MonsterHandInner({
  campaignId,
  sheets,
  encounter,
  leaving,
}: {
  campaignId: string;
  sheets: CharacterSheet[];
  encounter: PublicEncounter;
  // The fight is over and the mount is about to go: the fan folds away.
  leaving?: boolean;
}) {
  const due = useMemo(() => encounter.enemiesDue ?? [], [encounter.enemiesDue]);
  const dueIds = useMemo(() => new Set(due.map((entry) => entry.id)), [due]);
  // The living enemies with actions to play, the due ones first, in the
  // order they are owed.
  const roster = useMemo(() => {
    const living = encounter.enemies.filter((enemy) => enemy.status === "alive" && enemy.actions);
    const byId = new Map(living.map((enemy) => [enemy.id, enemy]));
    const first = due.flatMap((entry) => (byId.has(entry.id) ? [byId.get(entry.id)!] : []));
    return [...first, ...living.filter((enemy) => !dueIds.has(enemy.id))];
  }, [encounter.enemies, due, dueIds]);

  const [enemyId, setEnemyId] = useState<string | null>(null);
  const selected =
    roster.find((enemy) => enemy.id === enemyId) ??
    roster.find((enemy) => dueIds.has(enemy.id) && !enemy.actions?.acted) ??
    roster[0] ??
    null;
  const cards = selected ? deriveMonsterHand(selected) : [];

  // The party as targets. Their armour class is known to the DM, so the
  // preview's odds are real ones; the chip kind "enemy" is the preview's
  // word for "a target whose AC we know", not a judgement.
  const party = useMemo<PartyChip[]>(
    () =>
      sheets
        .filter((sheet) => !sheet.deathSaves?.dead)
        .map((sheet) => {
          const ac = effectiveAcFor(sheet);
          return {
            id: sheet.id,
            name: sheet.name,
            kind: "enemy" as const,
            ac,
            conditions: sheet.conditions,
            note: `${sheet.currentHp}/${effectiveMaxHp(sheet)} hp · AC ${ac}`,
          };
        }),
    [sheets],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [advantage, setAdvantage] = useState<MonsterAdvantage>("none");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [lines, setLines] = useState<ResultLine[]>([]);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const collapsed = useSyncExternalStore(subscribeStore, readCollapsed, () => false);

  const picked = cards.find((card) => card.id === pickedId && !card.disabled) ?? null;
  const many = picked ? takesManyTargets(picked) : false;
  const aimed = party.filter((chip) => targetIds.includes(chip.id));
  const aim = aimed[0] ?? null;
  const defaultAim = aim ?? party[0] ?? null;
  const conditions = selected?.conditions ?? EMPTY;
  // Cheap enough to work out each render; the compiler memoizes what it can.
  const rows = picked ? previewRows(picked, picked.target === "none" ? null : defaultAim, conditions) : [];
  const sentence = picked && selected ? monsterSentence(selected.name, picked, aimed.map((chip) => chip.name)) : "";
  const needsTarget = Boolean(picked && picked.target !== "none");
  const ready = Boolean(picked) && (!needsTarget || aimed.length > 0);

  function say(text: string) {
    setNotice(text);
    replayAnimation(noticeRef.current, "shake-x var(--dur-beat) var(--ease-snap) both");
  }

  function clearAim() {
    setPickedId(null);
    setTargetIds([]);
    setAdvantage("none");
  }

  function pick(card: HandCard) {
    if (card.disabled) {
      say(card.disabled);
      return;
    }
    setNotice("");
    setTargetIds([]);
    setAdvantage("none");
    setPickedId((current) => (current === card.id ? null : card.id));
  }

  function toggleTarget(id: string) {
    setTargetIds((current) => {
      if (!many) {
        return current[0] === id ? [] : [id];
      }
      return current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
    });
  }

  async function commit() {
    if (!picked || !selected || sending) {
      return;
    }
    const call = monsterInvoke(picked, targetIds, advantage);
    if (!call) {
      say(many ? "Pick everyone caught in it." : "Pick a target.");
      return;
    }
    setSending(true);
    setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(call),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; result?: unknown };
      if (!response.ok) {
        // The engine's own reason; the card stays raised to try another way.
        say(data.error || "The engine would not take that.");
        return;
      }
      setLines(describeAdjudicationResult(data.result));
      clearAim();
    } catch {
      say("Could not reach the table.");
    } finally {
      setSending(false);
    }
  }

  // The initiative panel's two buttons, here too: the hand is where the DM
  // is looking while the enemies are due.
  async function handOn(play: boolean) {
    if (busy) {
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/initiative`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "enemies", play }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        say(data.error ?? "The order would not take that.");
      } else {
        clearAim();
      }
    } catch {
      say("Could not reach the table.");
    } finally {
      setBusy(false);
    }
  }

  if (!roster.length || !selected) {
    return null;
  }

  const current = encounter.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  const middle = (cards.length - 1) / 2;
  const step = cards.length > 1 ? Math.min(4.4, 13 / (cards.length - 1)) : 0;

  return (
    <section
      className="hand"
      data-tour="monster-hand"
      aria-label="The monsters' hand"
      onKeyDown={(event) => {
        if (event.key === "Escape" && picked) {
          event.stopPropagation();
          clearAim();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          key={due.length ? "due" : "free"}
          className="hand-label min-w-0 break-words font-display text-[11px] uppercase tracking-[0.22em] text-red-200/90"
        >
          {due.length ? "Enemy turns" : "The monsters"}
        </span>
        <span className="hidden text-[11px] text-stone-500 sm:inline">
          {due.length
            ? `Before ${current?.name ?? "the next turn"}: play each one, then hand on the turn.`
            : "Play a monster's action as a card; the engine rolls it."}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {due.length ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handOn(true)}
                className="min-h-9 rounded-md border border-red-800 bg-red-950/50 px-2.5 py-1 text-xs text-red-100 disabled:opacity-40 motion-press sm:min-h-7"
              >
                Play the rest for me
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handOn(false)}
                className="min-h-9 rounded-md border border-amber-700 bg-amber-950/50 px-2.5 py-1 text-xs text-amber-100 disabled:opacity-40 motion-press sm:min-h-7"
              >
                Hand on the turn
              </button>
            </>
          ) : null}
          <Tooltip content={collapsed ? "Show the monsters' cards" : "Put the cards away. The console still has every action."}>
            <button
              type="button"
              onClick={() => {
                clearAim();
                writeCollapsed(!collapsed);
              }}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Show the monsters' cards" : "Hide the monsters' cards"}
              className="flex size-9 items-center justify-center rounded-lg text-stone-500 hover:text-amber-200 sm:size-7"
            >
              <ChevronDown className={cn("chevron-turn size-4", collapsed && "rotate-180")} />
            </button>
          </Tooltip>
        </span>
      </div>

      {collapsed ? null : (
        <>
          {/* Whose cards: the due enemies first, each with its hit points
              and whether it has acted this round. */}
          <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label="Which monster">
            {roster.map((enemy, index) => {
              const isDue = dueIds.has(enemy.id);
              const acted = Boolean(enemy.actions?.acted);
              return (
                <button
                  key={enemy.id}
                  type="button"
                  style={{ "--i": index } as CSSProperties}
                  aria-pressed={enemy.id === selected.id}
                  onClick={() => {
                    setEnemyId(enemy.id);
                    clearAim();
                  }}
                  className={cn(ui.btnSmall, "hand-target min-h-11 flex-col items-start gap-0 px-3 py-1 text-left sm:min-h-9")}
                >
                  <span className={cn("text-[13px] leading-tight text-stone-200", acted && "text-stone-500 line-through")}>
                    {isDue ? <span className="mr-1 inline-block size-1.5 rounded-full bg-red-400 align-middle" aria-label="due" /> : null}
                    {enemy.name}
                  </span>
                  <span className="font-mono text-[10px] leading-tight text-stone-500">
                    {enemy.currentHp !== undefined ? `${enemy.currentHp}/${enemy.maxHp} hp` : enemy.health}
                    {enemy.ac !== undefined ? ` · AC ${enemy.ac}` : ""}
                    {acted ? " · acted" : ""}
                  </span>
                </button>
              );
            })}
          </div>

          <div
            key={selected.id}
            className="hand-fan"
            data-aiming={picked ? "true" : undefined}
            data-folding={leaving ? "true" : undefined}
            role="group"
            aria-label={`${selected.name}'s cards`}
          >
            {cards.map((card, index) => (
              <HandCardFace
                key={card.id}
                card={card}
                index={index}
                offset={index - middle}
                step={step}
                picked={picked?.id === card.id}
                attached={false}
                played={false}
                aim={card.target === "none" ? null : defaultAim}
                conditions={conditions}
                onPick={pick}
              />
            ))}
          </div>

          {selected.actions?.manual?.length ? (
            <p className="mt-1 truncate text-xs text-stone-400" title={selected.actions.manual.join(", ")}>
              By hand: {selected.actions.manual.join(", ")}
            </p>
          ) : null}

          {picked ? (
            <div className="hand-aim mt-1 rounded-xl border border-red-500/30 bg-stone-950/80 p-2.5 shadow-elev-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="hand-type-chip" style={{ "--chip-tone": typeTone(picked.type) } as CSSProperties}>
                  {typeLabel(picked.type)}
                </span>
                <span className="min-w-0 truncate font-display text-sm font-semibold text-amber-100">
                  {selected.name} · {picked.name}
                </span>
                <span className="ml-auto min-w-0 truncate text-xs text-stone-400">
                  {!needsTarget ? "Ready when you are." : aimed.length ? `Lined up on ${aimed.map((chip) => chip.name).join(", ")}.` : many ? "Pick everyone caught in it." : "Pick a target."}
                </span>
              </div>

              {needsTarget ? (
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Targets">
                  {party.length ? (
                    party.map((chip, index) => (
                      <button
                        key={chip.id}
                        type="button"
                        style={{ "--i": index } as CSSProperties}
                        aria-pressed={targetIds.includes(chip.id)}
                        onClick={() => toggleTarget(chip.id)}
                        className={cn(ui.btnSmall, "hand-target min-h-11 flex-col items-start gap-0 px-3 py-1 text-left sm:min-h-9")}
                      >
                        <span className="text-[13px] leading-tight text-stone-200">{chip.name}</span>
                        <span className="font-mono text-[10px] leading-tight text-stone-500">{chip.note}</span>
                      </button>
                    ))
                  ) : (
                    <span className="text-xs text-stone-500">Nobody is standing to be attacked.</span>
                  )}
                </div>
              ) : null}

              {picked.intent.card === "monster" && picked.intent.action === "attack" ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5" data-pill-group="">
                  <span className="text-[11px] uppercase tracking-wider text-stone-500">Roll</span>
                  {ADVANTAGE.map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      data-on={advantage === value ? "" : undefined}
                      aria-pressed={advantage === value}
                      onClick={() => setAdvantage(value)}
                      className={cn(
                        "hand-option inline-flex min-h-9 items-center rounded-full border px-3 text-xs sm:min-h-8",
                        advantage === value
                          ? "border-ember-400/70 bg-ember-500/20 text-orange-100"
                          : "border-stone-600 text-stone-300 hover:border-amber-500/60",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="hand-rows-box mt-2">
                <HandPreviewRows rows={rows} />
              </div>
              {sentence ? <p className="mt-2 text-xs italic text-stone-300">{sentence}</p> : null}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={clearAim} className={cn(ui.btnSmall, "min-h-9")}>
                  <ArrowLeft className="size-3.5" /> Back
                </button>
                <button
                  type="button"
                  disabled={!ready || sending}
                  aria-busy={sending}
                  onClick={() => void commit()}
                  className={cn(ui.btnPrimary, "ml-auto min-h-9")}
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                  {picked.intent.card === "monster" && picked.intent.action === "flee" ? "Let it flee" : `Play ${picked.name}`}
                </button>
              </div>
            </div>
          ) : null}

          {lines.length ? (
            <div role="status" className="live-in mt-1 rounded-lg border border-amber-500/30 bg-stone-950/80 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="gold-title font-display text-[11px] uppercase tracking-[0.18em]">{selected.name}</p>
                <button
                  type="button"
                  onClick={() => setLines([])}
                  aria-label="Dismiss the result"
                  className="motion-press flex size-7 items-center justify-center rounded-md text-stone-500 hover:text-amber-200"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <ul className="stagger mt-1 space-y-0.5">
                {lines.map((line, index) => (
                  <li
                    key={`${index}-${line.text}`}
                    className={cn(line.tone === "bad" ? "text-ember-300" : line.tone === "good" ? "text-emerald-300" : "text-stone-200")}
                  >
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <p ref={noticeRef} role="status" className={cn("mt-1 text-xs text-amber-300", notice ? "" : "hidden")}>
        {notice}
      </p>
    </section>
  );
}

const EMPTY: string[] = [];

// Memoized like the composer it sits in.
export const MonsterHand = memo(MonsterHandInner);
