"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Heart, Minus, Plus, PawPrint, Shield, UserRound, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { ABILITIES } from "@/lib/schemas/sheet";
import { acBreakdownFor, computeSheetDerived, formatModifier, SRD_SKILLS } from "@/lib/srd";
import { ATTUNEMENT_SLOTS, matchArmor } from "@/lib/srd/armor";
import { matchMagicItem, magicItemRiders } from "@/lib/srd/magic-items";
import { RESOURCE_DEFS } from "@/lib/srd/class-resources";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton, InfoChipList } from "@/components/ui/InfoDialog";
import { contentSlug, describeFeature } from "@/lib/help";

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const RESOURCE_NAMES = new Map(RESOURCE_DEFS.map((def) => [def.id, def.displayName]));
// Every resource already carries a line explaining what spending it does; it
// was written for the DM model and reads just as well for the player.
const RESOURCE_HELP = new Map(RESOURCE_DEFS.map((def) => [def.id, def.guidance]));

const stepButton =
  "flex items-center justify-center rounded border border-stone-700 p-0.5 text-stone-300 hover:bg-stone-800 disabled:opacity-40";

// Full character sheet, opened by selecting any party member. Read-only,
// except the owner may adjust the spent side of counters their class
// actually has (spell slots, hit dice, resource pools) and which gear they
// wear or are attuned to, via /sheet/usage. Notes stay private to the
// sheet's owner.
export function CharacterSheetDialog({
  sheet,
  mine,
  isLead,
  inCombat = false,
  onAdjust,
  onClose,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  isLead: boolean;
  // 5e timing: resources only come back at rests, so during an active
  // encounter the recover steppers lock (the server refuses too); spending
  // stays available for bookkeeping.
  inCombat?: boolean;
  onAdjust?: () => void;
  onClose: () => void;
}) {
  const derived = computeSheetDerived(sheet);
  const armor = acBreakdownFor(sheet);
  const attunedCount = sheet.equipment.filter((item) => item.attuned).length;
  // Only gear worth a toggle: armor and shields can be worn, and anything
  // whose name declares a magic bonus can be attuned.
  const wearable = sheet.equipment.filter(
    (item) =>
      matchArmor(item.name) !== null ||
      /\+[123]\b/.test(item.name) ||
      matchMagicItem(item.name) !== null,
  );
  const magic = magicItemRiders(sheet.equipment);
  const anyEquipped = sheet.equipment.some((item) => item.equipped);
  const [busy, setBusy] = useState(false);

  // Fire-and-forget: the sheet_updated SSE event refreshes the sheet prop,
  // so the new counts render without local reconciliation.
  async function adjustUsage(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${sheet.campaignId}/sheet/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

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
                <ImageLightbox
                  src={sheet.portrait.url}
                  alt={sheet.name}
                  caption={sheet.name}
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
                  Level {sheet.level} {titleCase(sheet.race)}{" "}
                  {(sheet.classes?.length ?? 0) > 1
                    ? (sheet.classes ?? [])
                        .map((entry) => `${titleCase(entry.id)} ${entry.level}`)
                        .join(" / ")
                    : `${titleCase(sheet.class)}${sheet.subclass ? ` (${titleCase(sheet.subclass)})` : ""}`}
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
            <span
              className="flex items-center gap-1"
              title={
                sheet.acOverride
                  ? "Set by hand; armor does not change it."
                  : armor.parts.join(" + ")
              }
            >
              <Shield className="size-4 text-stone-400" />{" "}
              <GameTerm id="armor_class">AC</GameTerm> {sheet.ac}
            </span>
            <span>Speed {sheet.speed} ft</span>
            <span>
              <GameTerm id="initiative">Init</GameTerm> {formatModifier(derived.initiative)}
            </span>
            <span>
              <GameTerm id="passive_perception">PP</GameTerm> {derived.passivePerception}
            </span>
            <span>PB {formatModifier(derived.proficiencyBonus)}</span>
            <span>{sheet.gold} gp</span>
            <span>
              {sheet.xp} XP · Hit dice {sheet.hitDice.total - sheet.hitDice.spent}/
              {sheet.hitDice.total}
              {sheet.hitDice.die}
            </span>
          </div>

          {sheet.wildShape ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-lime-800/60 bg-lime-950/40 px-3 py-2 text-sm text-lime-200">
              <span className="flex items-center gap-1.5 font-medium capitalize">
                <PawPrint className="size-4" /> Wild Shaped: {sheet.wildShape.form}
              </span>
              <span className="font-mono text-xs">
                {sheet.wildShape.beastHp}/{sheet.wildShape.beastMaxHp} beast HP
              </span>
              <span className="font-mono text-xs">AC {sheet.wildShape.beastAc}</span>
              <span className="w-full text-xs text-lime-400/80">
                Damage hits the beast&apos;s hit points first. The {sheet.currentHp}/{sheet.maxHp} HP
                above is what {sheet.name} returns to when the form breaks.
              </span>
            </div>
          ) : null}

          {sheet.conditions.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {sheet.conditions.map((condition) => (
                <span
                  key={condition}
                  className="rounded-full bg-red-950 px-2 py-0.5 text-xs text-red-300"
                >
                  {condition}
                  {sheet.conditionMeta?.[condition]?.rounds
                    ? ` (${sheet.conditionMeta[condition].rounds} rd)`
                    : ""}
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

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                <GameTerm id="saving_throw">Saving throws</GameTerm>
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
                <GameTerm id="skill">Skills</GameTerm>
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
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
                  <span>
                    <GameTerm id="spell_slot">Slots</GameTerm>:
                  </span>
                  {Object.entries(sheet.spellcasting.slots).map(([slotLevel, slot]) => (
                    <span
                      key={slotLevel}
                      className="flex items-center gap-1 rounded border border-stone-800 px-1.5 py-0.5"
                    >
                      {mine ? (
                        <button
                          type="button"
                          className={stepButton}
                          disabled={busy || slot.used >= slot.max}
                          title="Spend a slot"
                          onClick={() => adjustUsage({ slots: { [slotLevel]: slot.used + 1 } })}
                        >
                          <Minus className="size-3" />
                        </button>
                      ) : null}
                      <span>
                        L{slotLevel} {slot.max - slot.used}/{slot.max}
                      </span>
                      {mine ? (
                        <button
                          type="button"
                          className={stepButton}
                          disabled={busy || inCombat || slot.used <= 0}
                          title={inCombat ? "Slots recover at rests, not mid-combat" : "Recover a slot"}
                          onClick={() => adjustUsage({ slots: { [slotLevel]: slot.used - 1 } })}
                        >
                          <Plus className="size-3" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}
              {[...sheet.spellcasting.known, ...sheet.spellcasting.prepared].length ? (
                <div className="mt-1">
                  <InfoChipList
                    items={[
                      ...new Set([...sheet.spellcasting.known, ...sheet.spellcasting.prepared]),
                    ].map((spell) => ({
                      name: spell,
                      reference: { kind: "spells", slug: contentSlug(spell), name: spell },
                    }))}
                  />
                </div>
              ) : null}
            </section>
          ) : null}

          {mine || Object.keys(sheet.resources).length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Hit Dice &amp; Resources
              </h3>
              <div className="space-y-1.5 text-xs text-stone-300">
                <div className="flex items-center gap-2">
                  <span className="w-36 shrink-0 text-stone-400">
                    <GameTerm id="hit_dice">Hit dice</GameTerm> ({sheet.hitDice.die})
                  </span>
                  {mine ? (
                    <button
                      type="button"
                      className={stepButton}
                      disabled={busy || sheet.hitDice.spent >= sheet.hitDice.total}
                      title="Spend a hit die"
                      onClick={() => adjustUsage({ hitDiceSpent: sheet.hitDice.spent + 1 })}
                    >
                      <Minus className="size-3" />
                    </button>
                  ) : null}
                  <span>
                    {sheet.hitDice.total - sheet.hitDice.spent}/{sheet.hitDice.total}
                  </span>
                  {mine ? (
                    <button
                      type="button"
                      className={stepButton}
                      disabled={busy || inCombat || sheet.hitDice.spent <= 0}
                      title={
                        inCombat ? "Hit dice recover at rests, not mid-combat" : "Recover a hit die"
                      }
                      onClick={() => adjustUsage({ hitDiceSpent: sheet.hitDice.spent - 1 })}
                    >
                      <Plus className="size-3" />
                    </button>
                  ) : null}
                </div>
                {Object.entries(sheet.resources).map(([id, pool]) => (
                  <div key={id} className="flex items-center gap-2">
                    <span className="flex w-36 shrink-0 items-center gap-1 text-stone-400">
                      {RESOURCE_NAMES.get(id) ?? titleCase(id)}
                      <InfoButton
                        label={RESOURCE_NAMES.get(id) ?? titleCase(id)}
                        text={RESOURCE_HELP.get(id)}
                      />
                    </span>
                    {mine ? (
                      <button
                        type="button"
                        className={stepButton}
                        disabled={busy || pool.used >= pool.max}
                        title="Spend a use"
                        onClick={() => adjustUsage({ resources: { [id]: pool.used + 1 } })}
                      >
                        <Minus className="size-3" />
                      </button>
                    ) : null}
                    <span>
                      {pool.max - pool.used}/{pool.max}
                    </span>
                    {mine ? (
                      <button
                        type="button"
                        className={stepButton}
                        disabled={busy || inCombat || pool.used <= 0}
                        title={
                          inCombat ? "Uses recover at rests, not mid-combat" : "Recover a use"
                        }
                        onClick={() => adjustUsage({ resources: { [id]: pool.used - 1 } })}
                      >
                        <Plus className="size-3" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              {mine ? (
                <p className="mt-1.5 text-[11px] text-stone-500">
                  Minus spends, plus recovers.
                  {inCombat ? " Recovery is locked during combat; rests refill automatically." : ""}{" "}
                  Changes are logged to the session event log.
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
              {mine && wearable.length ? (
                <div className="mt-2 space-y-1">
                  <p className="text-[11px] text-stone-500">
                    Worn gear sets your AC ({sheet.acOverride ? "pinned by hand" : armor.parts.join(" + ")}
                    ). Attuned {attunedCount}/{ATTUNEMENT_SLOTS}.
                  </p>
                  {magic.sources.length ? (
                    <p className="text-[11px] text-sky-400/80">
                      Active magic:{" "}
                      {[
                        magic.acBonus ? `+${magic.acBonus} AC` : null,
                        magic.saveBonus ? `+${magic.saveBonus} saves` : null,
                        ...Object.entries(magic.abilitySet).map(
                          ([ability, score]) => `${ability.toUpperCase()} ${score}`,
                        ),
                        magic.resistances.length ? `resist ${magic.resistances.join(", ")}` : null,
                      ]
                        .filter(Boolean)
                        .join(" \u00b7 ") || "worn"}
                    </p>
                  ) : null}
                  {wearable.map((item) => {
                    const isArmor = matchArmor(item.name) !== null;
                    const worn = item.equipped ?? !anyEquipped;
                    return (
                      <div key={item.name} className="flex items-center gap-2 text-xs text-stone-300">
                        <span className="grow truncate">{item.name}</span>
                        {isArmor ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              adjustUsage({ gear: { [item.name]: { equipped: !worn } } })
                            }
                            className={cn(
                              "rounded border px-1.5 py-0.5",
                              worn
                                ? "border-amber-700/70 bg-amber-950/40 text-amber-200"
                                : "border-stone-700 text-stone-400",
                            )}
                          >
                            {worn ? "worn" : "wear"}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy || (!item.attuned && attunedCount >= ATTUNEMENT_SLOTS)}
                          onClick={() =>
                            adjustUsage({ gear: { [item.name]: { attuned: !item.attuned } } })
                          }
                          className={cn(
                            "rounded border px-1.5 py-0.5 disabled:opacity-40",
                            item.attuned
                              ? "border-sky-800/70 bg-sky-950/40 text-sky-200"
                              : "border-stone-700 text-stone-400",
                          )}
                        >
                          {item.attuned ? "attuned" : "attune"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          ) : null}

          {sheet.features.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Features &amp; Traits
              </h3>
              <InfoChipList
                items={sheet.features.map((feature) => ({
                  name: feature.name,
                  note: feature.source === "story" ? "(story)" : undefined,
                  meta: feature.level ? `Level ${feature.level}` : undefined,
                  text: describeFeature(sheet.class, sheet.subclass, feature.name),
                }))}
              />
            </section>
          ) : null}

          {sheet.feats.length ? (
            <section className="mt-4">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                Feats
              </h3>
              <InfoChipList
                items={sheet.feats.map((feat) => ({
                  name: feat,
                  text: describeFeature(sheet.class, sheet.subclass, feat),
                  reference: { kind: "feats", slug: contentSlug(feat), name: feat },
                }))}
              />
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
