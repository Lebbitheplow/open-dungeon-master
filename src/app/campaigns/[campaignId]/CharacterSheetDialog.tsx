"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { FileDown, Minus, Plus, PawPrint, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CharacterPortrait, ui } from "@/lib/ui";
import { downloadCharacterSheetPdf } from "@/lib/pdf/download";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import {
  acBreakdownFor,
  computeSheetDerived,
  formatModifier,
  speedFor,
  type DerivedPart,
} from "@/lib/srd";
import { ATTUNEMENT_SLOTS, matchArmor } from "@/lib/srd/armor";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { matchMagicItem, magicItemRiders } from "@/lib/srd/magic-items";
import { RESOURCE_DEFS } from "@/lib/srd/class-resources";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import {
  AbilityTiles,
  ConditionChips,
  EquipmentChips,
  FeatChips,
  FeatureChips,
  HpBar,
  PortraitMedallion,
  SheetBlock,
  SkillRows,
  SpellChips,
  VitalTiles,
} from "@/components/sheet/SheetParts";

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
// Every derived number's working, the way AC has always shown its own.
// computeSheetDerived returns the parts it summed, so a hover can say where a
// +7 came from without this file knowing a single rule.
function explainParts(parts: DerivedPart[]): string {
  return parts.map((part) => `${formatModifier(part.value)} ${part.label}`).join(", ");
}

export function CharacterSheetDialog({
  sheet,
  mine,
  steersStory,
  encumbranceRule = false,
  inCombat = false,
  portraitFallback,
  onAdjust,
  onClose,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  steersStory: boolean;
  // The world pack's picture for this character's class or race, drawn
  // before the generic plate when nobody has painted a portrait.
  portraitFallback?: string | null;
  // The table's optional encumbrance rule.
  encumbranceRule?: boolean;
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
  // Carried weight is always worth showing once the pack has weights on it;
  // the thresholds and their penalties only mean something when the table
  // turned the variant rule on.
  // The speed the server will actually let them move: armor gates the class
  // bonuses, heavy armor below its Strength minimum costs 10 feet, and a
  // heavy pack costs more when the table plays with encumbrance.
  const speed = speedFor(sheet, { encumbrance: encumbranceRule });
  const load = encumbranceFor({
    strength: sheet.abilities.str,
    equipment: sheet.equipment,
    coins: sheet.gold,
  });
  const anyEquipped = sheet.equipment.some((item) => item.equipped);
  const speedNote =
    speed === sheet.speed
      ? "Their walking speed."
      : `Base ${sheet.speed} ft, reduced by what they wear${encumbranceRule && load.speedPenalty ? " and carry" : ""}.`;
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  async function handleDownloadPdf() {
    setPdfBusy(true);
    try {
      await downloadCharacterSheetPdf(sheet);
    } finally {
      setPdfBusy(false);
    }
  }

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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 z-50 bg-[#05030d]/70 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            ui.dialog,
            "fixed left-1/2 top-1/2 z-50 max-h-[88dvh] w-[min(52rem,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-4">
              <PortraitMedallion classId={sheet.class} level={sheet.level}>
                {sheet.portrait ? (
                  <ImageLightbox
                    src={sheet.portrait.url}
                    alt={sheet.name}
                    caption={sheet.name}
                    className="size-full object-cover"
                  />
                ) : (
                  <CharacterPortrait
                    fallback={portraitFallback}
                    look={{ race: sheet.race, class: sheet.class, gender: sheet.gender }}
                    alt={sheet.name}
                    size="size-full"
                  />
                )}
              </PortraitMedallion>
              <div>
                <Dialog.Title className="gold-title font-display text-2xl tracking-wide">
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

          <div className="space-y-1.5">
            <HpBar current={sheet.currentHp} max={sheet.maxHp} temp={sheet.tempHp ?? 0} />
            <VitalTiles
              vitals={[
                {
                  glyph: "rest-ac",
                  label: <GameTerm id="armor_class">Armor class</GameTerm>,
                  value: sheet.ac,
                  title: sheet.acOverride ? "Set by hand; armor does not change it." : armor.parts.join(" + "),
                },
                { glyph: "rest-speed", label: "Speed", value: `${speed} ft`, title: speedNote },
                {
                  glyph: "rest-initiative",
                  label: <GameTerm id="initiative">Initiative</GameTerm>,
                  value: formatModifier(derived.initiative),
                  title: explainParts(derived.parts.initiative),
                },
                {
                  glyph: "sense-passive-perception",
                  label: <GameTerm id="passive_perception">Passive perception</GameTerm>,
                  value: derived.passivePerception,
                  title: explainParts(derived.parts.passivePerception),
                },
                { glyph: "rest-proficiency", label: "Proficiency", value: formatModifier(derived.proficiencyBonus) },
                { glyph: "coin-gp", label: "Gold", value: `${sheet.gold} gp` },
                { glyph: "rest-xp", label: "Experience", value: `${sheet.xp} XP` },
                {
                  glyph: `die-${sheet.hitDice.die}`,
                  label: <GameTerm id="hit_dice">Hit dice</GameTerm>,
                  value: `${sheet.hitDice.total - sheet.hitDice.spent}/${sheet.hitDice.total}${sheet.hitDice.die}`,
                },
                {
                  glyph: "coin-purse",
                  label: "Carried",
                  value: `${load.carriedLb}${load.unweighed ? "+" : ""}/${load.capacityLb} lb`,
                  tone: encumbranceRule && load.tier !== "unencumbered" ? "warn" : "plain",
                  title: encumbranceRule
                    ? `${load.note ?? "Not encumbered"}. Capacity ${load.capacityLb} lb.${load.unweighed ? ` ${load.unweighed} item${load.unweighed === 1 ? "" : "s"} of unknown weight are not counted.` : ""}`
                    : `Carrying capacity ${load.capacityLb} lb. Encumbrance is off for this table, so the weight costs nothing.${load.unweighed ? ` ${load.unweighed} item${load.unweighed === 1 ? "" : "s"} of unknown weight are not counted.` : ""}`,
                },
              ]}
            />
          </div>

          {sheet.wildShape ? (
            <div className="reveal mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-lime-800/60 bg-lime-950/40 px-3 py-2 text-sm text-lime-200">
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
            <div className="reveal mt-2">
              <ConditionChips conditions={sheet.conditions} rounds={sheet.conditionMeta} />
            </div>
          ) : null}

          <SheetBlock
            className="mt-4"
            title="Abilities"
            aside={
              <>
                <GameTerm id="saving_throw">Saving throws</GameTerm> ride each tile
              </>
            }
          >
            <AbilityTiles
              abilities={sheet.abilities}
              mods={derived.abilityMods}
              saves={derived.saves}
              saveProficiencies={sheet.proficiencies.saves}
              explainSave={(ability) => explainParts(derived.parts.saves[ability])}
            />
          </SheetBlock>

          <SheetBlock className="mt-4" title={<GameTerm id="skill">Skills</GameTerm>}>
            <SkillRows
              skills={derived.skills}
              proficient={sheet.proficiencies.skills}
              explain={(skillId) => explainParts(derived.parts.skills[skillId])}
            />
          </SheetBlock>

          {sheet.spellcasting ? (
            <SheetBlock
              className="mt-4"
              title="Spellcasting"
              hint={
                derived.parts.spellSaveDc.length
                  ? `Save DC: ${explainParts(derived.parts.spellSaveDc)}. To hit: ${explainParts(derived.parts.spellAttack)}`
                  : undefined
              }
              aside={
                <>
                  {sheet.spellcasting.ability.toUpperCase()}
                  {derived.spellSaveDc ? ` · DC ${derived.spellSaveDc}` : ""}
                  {derived.spellAttack !== null ? ` · ${formatModifier(derived.spellAttack)} to hit` : ""}
                </>
              }
            >
              {Object.keys(sheet.spellcasting.slots).length ? (
                <div className="reveal flex flex-wrap items-center gap-1.5 text-xs text-stone-400">
                  <span className="flex items-center gap-1">
                    <GameIcon icon={{ kind: "glyph", key: "rest-spell-slot" }} size="size-5" />
                    <GameTerm id="spell_slot">Slots</GameTerm>
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
                <div className="reveal mt-2">
                  <SpellChips spells={[...sheet.spellcasting.known, ...sheet.spellcasting.prepared]} />
                </div>
              ) : null}
            </SheetBlock>
          ) : null}

          {mine || Object.keys(sheet.resources).length ? (
            <SheetBlock className="mt-4" title="Hit dice and resources">
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
                <p className="reveal mt-1.5 text-[11px] text-stone-500">
                  Minus spends, plus recovers.
                  {inCombat ? " Recovery is locked during combat; rests refill automatically." : ""}{" "}
                  Changes are logged to the session event log.
                </p>
              ) : null}
            </SheetBlock>
          ) : null}

          {sheet.equipment.length ? (
            <SheetBlock className="mt-4" title="Equipment" aside={`Attuned ${attunedCount}/${ATTUNEMENT_SLOTS}`}>
              <EquipmentChips equipment={sheet.equipment} />
              {mine && wearable.length ? (
                <div className="reveal mt-2 space-y-1">
                  <p className="text-[11px] text-stone-500">
                    Worn gear sets your AC ({sheet.acOverride ? "pinned by hand" : armor.parts.join(" + ")}
                    ). Attuned {attunedCount}/{ATTUNEMENT_SLOTS}.
                  </p>
                  {magic.sources.length ? (
                    <p className="reveal text-[11px] text-sky-400/80">
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
                        <GameIcon icon={{ kind: "item", key: item.name, family: "item-gear" }} size="size-6" />
                        <span className="grow truncate">{item.name}</span>
                        {isArmor ? (
                          <button
                            type="button"
                            disabled={busy} aria-busy={busy}
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
            </SheetBlock>
          ) : null}

          {sheet.features.length ? (
            <SheetBlock className="mt-4" title="Features and traits">
              <FeatureChips features={sheet.features} classId={sheet.class} subclass={sheet.subclass} />
            </SheetBlock>
          ) : null}

          {sheet.feats.length ? (
            <SheetBlock className="mt-4" title="Feats">
              <FeatChips feats={sheet.feats} classId={sheet.class} subclass={sheet.subclass} />
            </SheetBlock>
          ) : null}

          {sheet.backstory ? (
            <SheetBlock className="mt-4" title="Backstory">
              <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-300">{sheet.backstory}</p>
            </SheetBlock>
          ) : null}

          {mine && sheet.notes ? (
            <SheetBlock className="mt-4" title="Notes" aside="only you see these">
              <p className="whitespace-pre-wrap text-xs text-stone-300">{sheet.notes}</p>
            </SheetBlock>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={pdfBusy}
              className={ui.btnSmall}
              title="Download this character sheet as a fillable PDF"
            >
              <FileDown className="size-3.5" /> {pdfBusy ? "Preparing..." : "Download PDF"}
            </button>
            {steersStory && onAdjust ? (
              <button
                type="button"
                onClick={onAdjust}
                className={ui.btnSmall}
                title="Party lead: correct this character's stats, items, and spells"
              >
                <Wrench className="size-3.5" /> Adjust
              </button>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
