"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { changeWears, gearWornState, isWornGear, itemStatus } from "@/components/sheet/sheet-state";
import { armorChangeMinutes } from "@/lib/dm/don-doff";
import { matchArmor } from "@/lib/srd/armor";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { swapQuestion, wearConflict, type WearConflict } from "@/lib/srd/wear-slots";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// One wearable item on the character sheet: its charges, whether it is
// attuning or cursed, and the wear and attune toggles with the engine's
// reasons on them (who may, when, and what the clock is charged). Split from
// CharacterSheetDialog.tsx, which posts the change. Putting it on where its
// kind is already worn (a second cloak) asks first, with the swap and, for
// the DM and the party lead, the SRD's exception of wearing both (issue 412).
export function SheetGearRow({
  sheet,
  item,
  worn,
  idle = null,
  inCombat,
  myTurn,
  dead,
  busy,
  onGear,
  conflict = null,
  canLayer = false,
  onSwap,
  onLayer,
  onDismiss,
}: {
  sheet: CharacterSheet;
  item: EquipmentItem;
  worn: boolean;
  // Worn, but its place is full and its magic does not count: "one cloak at
  // a time" (src/lib/srd/wear-slots.ts).
  idle?: string | null;
  inCombat: boolean;
  myTurn: boolean;
  dead: boolean;
  busy: boolean;
  onGear: (change: { equipped?: boolean; attuned?: boolean }) => void;
  // The question asked before a swap, while it is open on this row.
  conflict?: WearConflict | null;
  canLayer?: boolean;
  onSwap?: () => void;
  onLayer?: () => void;
  onDismiss?: () => void;
}) {
  // Magic gear works only while worn, so every row here can
  // be put on; only body armor is barred in a fight.
  const isArmor = matchArmor(item.name) !== null;
  const isShield = matchArmor(item.name)?.category === "shield";
  const armorLocked = inCombat && isArmor && !isShield;
  // A shield takes the action, on the character's own turn.
  const shieldLocked = inCombat && isShield && !myTurn;
  const status = itemStatus(sheet, item);
  // Only an item that asks for attunement offers it; plain
  // armor and "+1" gear work without one, and the server
  // refuses the rest (srd/magic-items.ts attunementProblem).
  // One already attuned keeps the control so it can end.
  const def = matchMagicItem(item.name, item.slug);
  const attunable =
    Boolean(item.attuned) ||
    Boolean(item.gear?.magic?.requiresAttunement) ||
    Boolean(def?.requiresAttunement);
  return (
    <>
    <div data-gear-row={item.name} className="flex items-center gap-2 text-xs text-stone-300">
      <GameIcon icon={{ kind: "item", key: item.name, family: "item-gear" }} size="size-6" />
      <span className="min-w-0 grow truncate">{item.name}</span>
      {idle ? (
        <span className="motion-pop shrink-0 rounded-full border border-stone-700 px-1.5 text-[10px] text-stone-400" title={`Worn, but a character wears ${idle} at a time, so its magic does not count.`}>
          not in effect
        </span>
      ) : item.layered && worn ? (
        <span className="motion-pop shrink-0 rounded-full border border-amber-800/60 px-1.5 text-[10px] text-amber-300" title="Worn beside another of its kind, on the DM's say.">
          beside another
        </span>
      ) : null}
      {status.charges ? (
        <span key={status.charges} className="motion-pop shrink-0 font-mono text-[10px] text-sky-300">
          {status.charges}
        </span>
      ) : null}
      {status.attuning ? (
        <span className="motion-pop shrink-0 rounded-full border border-sky-800/60 px-1.5 text-[10px] text-sky-300" title="Attuning takes a short rest; the next rest completes it.">
          attunes at the next rest
        </span>
      ) : null}
      {status.cursed ? (
        <span className="motion-pop shrink-0 rounded-full border border-red-800/60 px-1.5 text-[10px] text-red-300" title={status.attuneRefusal ?? "Cursed"}>
          cursed
        </span>
      ) : null}
      {/* Only what is worn or wielded offers it: a wand is held, a potion carried. */}
      {isWornGear(item) ? (
      <button
        type="button"
        disabled={busy || armorLocked || shieldLocked || dead}
        aria-busy={busy}
        title={
          dead
            ? `${sheet.name} is dead and cannot change what they wear or are attuned to.`
            : !inCombat
              ? // What the route will charge the clock (don-doff.ts), before the press.
                armorChangeMinutes(sheet.equipment, { [item.name]: { equipped: !worn } }).lines.join(" ") || undefined
              : !isArmor
                ? undefined
                : isShield
                  ? shieldLocked
                    ? "A shield takes your action, on your own turn; it is not your turn."
                    : "A shield takes your action, on your own turn"
                  : "Armor takes minutes to change, so not during a fight"
        }
        onClick={() => onGear({ equipped: !worn })}
        className={cn(
          "motion-press rounded border px-1.5 py-0.5",
          worn
            ? "border-amber-700/70 bg-amber-950/40 text-amber-200"
            : "border-stone-700 text-stone-400",
        )}
      >
        {worn ? "worn" : "wear"}
      </button>
      ) : null}
      {attunable ? (
      <button
        type="button"
        disabled={busy || inCombat || dead || Boolean(status.attuneRefusal)}
        // The engine's refusal (attunementRefusal: a curse,
        // the three-item cap, who may attune).
        title={
          inCombat
            ? "Attuning to an item, or ending it, takes a short rest, so not during a fight."
            : (status.attuneRefusal ??
              // Ending it on purpose moves the clock an hour (don-doff.ts).
              (item.attuned
                ? armorChangeMinutes(sheet.equipment, { [item.name]: { attuned: false } }).lines.join(" ")
                : undefined))
        }
        onClick={() => onGear({ attuned: !(item.attuned || item.attuning) })}
        className={cn(
          "motion-press rounded border px-1.5 py-0.5 disabled:opacity-40",
          item.attuned
            ? "border-sky-800/70 bg-sky-950/40 text-sky-200"
            : "border-stone-700 text-stone-400",
        )}
      >
        {item.attuned ? "attuned" : item.attuning ? "cancel" : "attune"}
      </button>
      ) : null}
    </div>
    {conflict ? (
      <div role="group" aria-label={`Wear ${item.name}?`} className="reveal ml-8 space-y-1.5 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-100">
        <p>{swapQuestion(conflict)}</p>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" disabled={busy} onClick={onSwap} className="motion-press rounded border border-amber-700/70 bg-amber-950/40 px-1.5 py-0.5 text-amber-200 disabled:opacity-40">
            Take off {conflict.wearing.join(" and ")}, wear {item.name}
          </button>
          {canLayer ? (
            <button type="button" disabled={busy} onClick={onLayer} title="The SRD's exception, the DM's call: a circlet under a helmet, two cloaks layered." className="motion-press rounded border border-stone-600 px-1.5 py-0.5 text-stone-200 disabled:opacity-40">
              Wear both (DM&apos;s call)
            </button>
          ) : null}
          <button type="button" onClick={onDismiss} className="motion-press rounded border border-stone-700 px-1.5 py-0.5 text-stone-400">
            Keep as is
          </button>
        </div>
      </div>
    ) : null}
    </>
  );
}

type GearChange = { equipped?: boolean; attuned?: boolean };
type GearAsk = Record<string, GearChange & { layered?: boolean }>;

// The swap question open on one row: what was asked, and what fills its place.
export type PendingWear = { name: string; conflict: WearConflict; change: GearChange };

// Every wearable row of a sheet. A press that would put a row on where its
// kind is already worn opens the question instead of posting; the server
// refuses the same change with the same conflict (src/lib/dm/usage-rules.ts
// gearPatch), which opens it too. The swap takes the others off and puts
// this one on in one request; "wear both" is the DM's and the lead's.
export function SheetGearRows({
  sheet,
  items,
  armor,
  corrects,
  inCombat,
  myTurn,
  dead,
  busy,
  pending,
  onPending,
  onGear,
}: {
  sheet: CharacterSheet;
  items: EquipmentItem[];
  armor: { armorName: string | null; shieldName: string | null };
  corrects: boolean;
  inCombat: boolean;
  myTurn: boolean;
  dead: boolean;
  busy: boolean;
  pending: PendingWear | null;
  onPending: (pending: PendingWear | null) => void;
  onGear: (gear: GearAsk) => void;
}) {
  return items.map((item) => {
    const state = gearWornState(item, sheet.equipment, armor);
    const open = pending?.name === item.name ? pending : null;
    return (
      <SheetGearRow
        key={item.name}
        sheet={sheet}
        item={item}
        worn={state.worn}
        idle={state.idle}
        inCombat={inCombat}
        myTurn={myTurn}
        dead={dead}
        busy={busy}
        onGear={(change) => {
          const conflict = changeWears(item, sheet.equipment, change) ? wearConflict(item, sheet.equipment) : null;
          onPending(conflict ? { name: item.name, conflict, change } : null);
          if (!conflict) {
            onGear({ [item.name]: change });
          }
        }}
        conflict={open?.conflict ?? null}
        canLayer={corrects}
        onSwap={() => {
          if (!open) return;
          onPending(null);
          const off = Object.fromEntries(open.conflict.wearing.map((name) => [name, { equipped: false }]));
          onGear({ ...off, [item.name]: { ...open.change, equipped: true } });
        }}
        onLayer={() => {
          if (!open) return;
          onPending(null);
          onGear({ [item.name]: { ...open.change, equipped: true, layered: true } });
        }}
        onDismiss={() => onPending(null)}
      />
    );
  });
}
