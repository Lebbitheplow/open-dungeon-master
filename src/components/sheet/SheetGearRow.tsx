"use client";

import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { isWornGear, itemStatus } from "@/components/sheet/sheet-state";
import { armorChangeMinutes } from "@/lib/dm/don-doff";
import { matchArmor } from "@/lib/srd/armor";
import { matchMagicItem } from "@/lib/srd/magic-items";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";

// One wearable item on the character sheet: its charges, whether it is
// attuning or cursed, and the wear and attune toggles with the engine's
// reasons on them (who may, when, and what the clock is charged). Split from
// CharacterSheetDialog.tsx, which posts the change.
export function SheetGearRow({
  sheet,
  item,
  worn,
  inCombat,
  myTurn,
  dead,
  busy,
  onGear,
}: {
  sheet: CharacterSheet;
  item: EquipmentItem;
  worn: boolean;
  inCombat: boolean;
  myTurn: boolean;
  dead: boolean;
  busy: boolean;
  onGear: (change: { equipped?: boolean; attuned?: boolean }) => void;
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
    <div className="flex items-center gap-2 text-xs text-stone-300">
      <GameIcon icon={{ kind: "item", key: item.name, family: "item-gear" }} size="size-6" />
      <span className="min-w-0 grow truncate">{item.name}</span>
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
  );
}
