"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Heart, Shield, UserRound, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { ABILITIES } from "@/lib/schemas/sheet";
import { computeSheetDerived, formatModifier, SRD_SKILLS } from "@/lib/srd";

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Full read-only character sheet, opened by selecting any party member.
// Notes stay private to the sheet's owner.
export function CharacterSheetDialog({
  sheet,
  mine,
  isLead,
  onAdjust,
  onClose,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  isLead: boolean;
  onAdjust?: () => void;
  onClose: () => void;
}) {
  const derived = computeSheetDerived(sheet);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(34rem,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              {sheet.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sheet.portrait.url}
                  alt={sheet.name}
                  className="size-14 rounded-lg border border-stone-700 object-cover"
                />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-lg border border-stone-700 bg-stone-900">
                  <UserRound className="size-6 text-stone-600" />
                </div>
              )}
              <div>
                <Dialog.Title className="font-display text-xl tracking-wide text-amber-50">
                  {sheet.name}
                </Dialog.Title>
                <p className="text-xs text-stone-400">
                  Level {sheet.level} {titleCase(sheet.race)} {titleCase(sheet.class)}
                  {sheet.subclass ? ` (${titleCase(sheet.subclass)})` : ""}
                  {sheet.background ? ` · ${titleCase(sheet.background)}` : ""}
                  {sheet.alignment ? ` · ${sheet.alignment}` : ""}
                </p>
              </div>
            </div>
            <Dialog.Close className="text-stone-500 hover:text-stone-300">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-300">
            <span className="flex items-center gap-1">
              <Heart className="size-4 text-red-400" />
              {sheet.currentHp}
              {sheet.tempHp ? `+${sheet.tempHp}` : ""}/{sheet.maxHp} HP
            </span>
            <span className="flex items-center gap-1">
              <Shield className="size-4 text-stone-400" /> AC {sheet.ac}
            </span>
            <span>Speed {sheet.speed} ft</span>
            <span>Init {formatModifier(derived.initiative)}</span>
            <span>PP {derived.passivePerception}</span>
            <span>PB {formatModifier(derived.proficiencyBonus)}</span>
            <span>{sheet.gold} gp</span>
            <span>
              {sheet.xp} XP · Hit dice {sheet.hitDice.total - sheet.hitDice.spent}/
              {sheet.hitDice.total}
              {sheet.hitDice.die}
            </span>
          </div>

          {sheet.conditions.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {sheet.conditions.map((condition) => (
                <span
                  key={condition}
                  className="rounded-full bg-red-950 px-2 py-0.5 text-xs text-red-300"
                >
                  {condition}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            {ABILITIES.map((ability) => (
              <div key={ability} className="rounded-lg border border-stone-800 p-2">
                <p className="text-xs uppercase text-stone-500">{ability}</p>
                <p className="text-lg text-stone-100">{sheet.abilities[ability]}</p>
                <p className="text-xs text-stone-400">
                  {formatModifier(derived.abilityMods[ability])}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Saving throws
              </h3>
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs text-stone-300">
                {ABILITIES.map((ability) => (
                  <span
                    key={ability}
                    className={cn(
                      sheet.proficiencies.saves.includes(ability) && "text-amber-200",
                    )}
                  >
                    {ability.toUpperCase()} {formatModifier(derived.saves[ability])}
                  </span>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Skills
              </h3>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-stone-300">
                {SRD_SKILLS.map((skill) => (
                  <span
                    key={skill.id}
                    className={cn(
                      sheet.proficiencies.skills.includes(skill.id) && "text-amber-200",
                    )}
                  >
                    {skill.name} {formatModifier(derived.skills[skill.id])}
                  </span>
                ))}
              </div>
            </section>
          </div>

          {sheet.spellcasting ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Spellcasting ({sheet.spellcasting.ability.toUpperCase()}
                {derived.spellSaveDc ? ` · DC ${derived.spellSaveDc}` : ""}
                {derived.spellAttack !== null
                  ? ` · ${formatModifier(derived.spellAttack)} to hit`
                  : ""}
                )
              </h3>
              {Object.keys(sheet.spellcasting.slots).length ? (
                <p className="text-xs text-stone-400">
                  Slots:{" "}
                  {Object.entries(sheet.spellcasting.slots)
                    .map(
                      ([slotLevel, slot]) => `L${slotLevel} ${slot.max - slot.used}/${slot.max}`,
                    )
                    .join(" · ")}
                </p>
              ) : null}
              {[...sheet.spellcasting.known, ...sheet.spellcasting.prepared].length ? (
                <p className="mt-1 text-xs text-stone-300">
                  {[...new Set([...sheet.spellcasting.known, ...sheet.spellcasting.prepared])].join(
                    ", ",
                  )}
                </p>
              ) : null}
            </section>
          ) : null}

          {sheet.equipment.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Equipment
              </h3>
              <p className="text-xs text-stone-300">
                {sheet.equipment
                  .map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name))
                  .join(", ")}
              </p>
            </section>
          ) : null}

          {sheet.feats.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Feats
              </h3>
              <p className="text-xs text-stone-300">{sheet.feats.join(", ")}</p>
            </section>
          ) : null}

          {sheet.backstory ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Backstory
              </h3>
              <p className="whitespace-pre-wrap text-xs text-stone-300">{sheet.backstory}</p>
            </section>
          ) : null}

          {mine && sheet.notes ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Notes (only you see these)
              </h3>
              <p className="whitespace-pre-wrap text-xs text-stone-300">{sheet.notes}</p>
            </section>
          ) : null}

          {isLead && onAdjust ? (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onAdjust}
                className={ui.btnSmall}
                title="Party lead: correct this character's stats, items, and spells"
              >
                <Wrench className="size-3.5" /> Adjust
              </button>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
