"use client";

import { owedChoices } from "@/lib/srd/owed-choices";
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
  sizeForRace,
  type DerivedPart,
} from "@/lib/srd";
import { attunementSlotsFor, matchArmor } from "@/lib/srd/armor";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { matchMagicItem, magicItemRiders } from "@/lib/srd/magic-items";
import { RESOURCE_DEFS } from "@/lib/srd/class-resources";
import { GameTerm } from "@/components/ui/GameTerm";
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
  VitalTiles, TrainingLines } from "@/components/sheet/SheetParts";
import { SheetSpells } from "@/components/sheet/SheetSpells";
import { DefensesLine, HitDiceSpend, StateTags } from "@/components/sheet/SheetState";
import { SheetBetween } from "@/components/sheet/SheetBetween";
import { conditionDetail, hitDiceLine, itemStatus, maxHpView, otherSpeedsLine, speedView } from "@/components/sheet/sheet-state";
import { FeatureChoicePicker, OtherSpeeds } from "@/components/sheet/SheetChoices";
import { SheetGearRow } from "@/components/sheet/SheetGearRow";
import { ResourceRow, SlotRow, STEP_BUTTON } from "@/components/sheet/SheetCounters";
import { namesLookup } from "@/lib/battlemap/condition-notes";

function titleCase(value: string) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const RESOURCE_NAMES = new Map(RESOURCE_DEFS.map((def) => [def.id, def.displayName]));
// Every resource already carries a line explaining what spending it does; it
// was written for the DM model and reads just as well for the player.
const RESOURCE_HELP = new Map(RESOURCE_DEFS.map((def) => [def.id, def.guidance]));

// Full character sheet, opened by selecting any party member. Read-only,
// except the owner may mark counters their class actually has as spent
// (spell slots, hit dice, resource pools) and change which gear they wear or
// are attuned to, via /sheet/usage. Handing a use back is a correction, so
// those controls are drawn only for the DM and the party lead, on any sheet.
// Notes stay private to the sheet's owner.
// Every derived number's working, the way AC has always shown its own.
// computeSheetDerived returns the parts it summed, so a hover can say where a
// +7 came from without this file knowing a single rule.
function explainParts(parts: DerivedPart[]): string {
  return parts.map((part) => `${formatModifier(part.value)} ${part.label}`).join(", ");
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

export function CharacterSheetDialog({
  sheet,
  mine,
  steersStory,
  corrects = false,
  encumbranceRule = false,
  inCombat = false,
  myTurn = false,
  names = [],
  portraitFallback,
  onAdjust,
  onClose,
}: {
  sheet: CharacterSheet;
  mine: boolean;
  steersStory: boolean;
  // The viewer is the DM or the party lead: they may hand uses back, on
  // this sheet whoever owns it. A player only ever spends.
  corrects?: boolean;
  // The world pack's picture for this character's class or race, drawn
  // before the generic plate when nobody has painted a portrait.
  portraitFallback?: string | null;
  // The table's optional encumbrance rule.
  encumbranceRule?: boolean;
  // 5e timing, which the server enforces too: in a fight armor does not go
  // on or off and nothing is attuned. A shield costs the action of the turn.
  // (Hit dice belong to a short rest in or out of a fight; see below.)
  inCombat?: boolean;
  // Whether the fight's pointer rests on this character (a shield is handled
  // with the action, on their own turn).
  myTurn?: boolean;
  // Who a condition's "until X's turn" or "from X" may name: the party and
  // the enemies the viewer can see.
  names?: Array<{ id: string; name: string }>;
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
  const magic = magicItemRiders(sheet.equipment, sheet);
  // Carried weight is always worth showing once the pack has weights on it;
  // the thresholds and their penalties only mean something when the table
  // turned the variant rule on.
  // The speed the server will actually let them move: armor gates the class
  // bonuses, heavy armor below its Strength minimum costs 10 feet, and a
  // heavy pack costs more when the table plays with encumbrance.
  // speedFor, then the conditions, then exhaustion: the speed the move route
  // lets them walk (src/components/sheet/sheet-state.ts).
  const speedState = speedView(sheet, { encumbrance: encumbranceRule });
  const speed = speedState.speed;
  const hp = maxHpView(sheet);
  const nameOf = namesLookup(names);
  const dead = Boolean(sheet.deathSaves?.dead);
  // The same load speedFor weighs (size and a Belt of Giant Strength count),
  // so the tile and the speed beside it agree.
  const load = encumbranceFor({
    strength: sheet.abilities.str,
    equipment: sheet.equipment,
    coins: sheet.gold,
    size: sizeForRace(sheet.race),
    wearer: sheet,
  });
  const anyEquipped = sheet.equipment.some((item) => item.equipped);
  const speedNote = speedState.notes.length ? speedState.notes.join(" ") : "Their walking speed.";
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  // The server's reason when it refuses an adjustment, shown under the
  // counters so the player knows what would be accepted.
  // It is kept beside the control that was used (the counters or the gear).
  const [refusal, setRefusal] = useState<{ text: string; at: "usage" | "gear" } | null>(null);
  // The route's line after armor went on or off outside a fight: the minutes
  // it took, already on the clock.
  const [timeNote, setTimeNote] = useState<string | null>(null);
  const spends = mine || corrects;
  // The usage route's own refusal for a dead character's spend.
  const deadNote = dead && !corrects ? `${sheet.name} is dead and spends nothing.` : null;

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
  async function adjustUsage(body: Record<string, unknown>, at: "usage" | "gear" = "usage") {
    setBusy(true);
    setRefusal(null);
    setTimeNote(null);
    try {
      const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // A correction names the sheet; a player is answered on their own.
        body: JSON.stringify({ ...body, characterId: sheet.id }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setRefusal({ text: typeof data?.error === "string" ? data.error : "That change was refused.", at });
      } else if (typeof data?.timePassed === "string") {
        // Out of a fight armor takes minutes to put on or take off, and the
        // route moved the table's clock by them (src/lib/dm/don-doff.ts).
        setTimeNote(data.timePassed);
      }
    } catch {
      setRefusal({ text: "The change did not reach the server.", at });
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
                  Level {sheet.level} {sheet.raceLabel ?? titleCase(sheet.race)}{" "}
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
            <HpBar current={sheet.currentHp} max={hp.max} temp={sheet.tempHp ?? 0} note={hp.note} />
            <VitalTiles
              vitals={[
                {
                  glyph: "rest-ac",
                  label: <GameTerm id="armor_class">Armor class</GameTerm>,
                  value: sheet.ac,
                  title: sheet.acOverride ? "Set by hand; armor does not change it." : armor.parts.join(" + "),
                },
                {
                  glyph: "rest-speed",
                  label: "Speed",
                  value: `${speed} ft`,
                  title: [speedNote, ...otherSpeedsLine(derived.speeds)].join(" "),
                  tone: speed < speedState.base ? "warn" : "plain",
                },
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
                  // Every pool of a multiclass character, not only the first.
                  value: hitDiceLine(sheet),
                },
                {
                  glyph: "coin-purse",
                  label: "Carried",
                  value: `${load.carriedLb}${load.unweighed ? "+" : ""}/${load.capacityLb} lb`,
                  tone: load.overCapacity || (encumbranceRule && load.tier !== "unencumbered") ? "warn" : "plain",
                  // Past the capacity (Strength x 15) the load can only be
                  // dragged at 5 feet, whatever the table's encumbrance rule
                  // (src/lib/dm/load-rules.ts, speedFor).
                  title: `${
                    load.overCapacity
                      ? `Past their carrying capacity of ${load.capacityLb} lb: they can only drag this load, at a speed of 5 feet, and nothing more can be given to them.`
                      : encumbranceRule
                        ? `${load.note ?? "Not encumbered"}. Capacity ${load.capacityLb} lb.`
                        : `Carrying capacity ${load.capacityLb} lb. Encumbrance is off for this table, so weight up to the capacity costs nothing.`
                  }${load.unweighed ? ` ${load.unweighed} item${load.unweighed === 1 ? "" : "s"} of unknown weight are not counted.` : ""}`,
                },
              ]}
            />
            <OtherSpeeds speeds={derived.speeds} />
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
                Damage hits the beast&apos;s hit points first. The {sheet.currentHp}/{hp.max} HP
                above is what {sheet.name} returns to when the form breaks.
              </span>
            </div>
          ) : null}

          <StateTags sheet={sheet} className="mt-2" />
          <SheetBetween sheet={sheet} className="mt-2" />
          {sheet.conditions.length ? (
            <div className="reveal mt-2">
              <ConditionChips
                conditions={sheet.conditions}
                rounds={sheet.conditionMeta}
                detail={(condition) => conditionDetail(sheet, condition, nameOf)}
              />
            </div>
          ) : null}
          <DefensesLine sheet={sheet} />

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

          <SheetBlock className="mt-4" title="Languages and training">
            <TrainingLines proficiencies={sheet.proficiencies} />
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
              {Object.keys(sheet.spellcasting.slots).length || sheet.spellcasting.pact ? (
                <div className="reveal space-y-1.5 text-xs text-stone-300">
                  <p className="flex items-center gap-1 text-stone-400">
                    <GameIcon icon={{ kind: "glyph", key: "rest-spell-slot" }} size="size-5" />
                    <GameTerm id="spell_slot">Spell slots</GameTerm>
                    <span className="text-stone-500">: the magic left today</span>
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(sheet.spellcasting.slots).map(([slotLevel, slot]) => (
                      <SlotRow
                        key={slotLevel}
                        label={`Level ${ROMAN[Number(slotLevel)] ?? slotLevel}`}
                        left={slot.max - slot.used}
                        max={slot.max}
                        spends={spends}
                        corrects={corrects}
                        busy={busy || Boolean(deadNote)}
                        onSpend={() => adjustUsage({ slots: { [slotLevel]: slot.used + 1 } })}
                        onRecover={() => adjustUsage({ slots: { [slotLevel]: slot.used - 1 } })}
                      />
                    ))}
                    {sheet.spellcasting.pact ? (
                      <SlotRow
                        label={`Pact, level ${ROMAN[sheet.spellcasting.pact.level] ?? sheet.spellcasting.pact.level}`}
                        left={sheet.spellcasting.pact.max - sheet.spellcasting.pact.used}
                        max={sheet.spellcasting.pact.max}
                        spends={spends}
                        corrects={corrects}
                        busy={busy || Boolean(deadNote)}
                        onSpend={() => adjustUsage({ pactUsed: (sheet.spellcasting?.pact?.used ?? 0) + 1 })}
                        onRecover={() => adjustUsage({ pactUsed: (sheet.spellcasting?.pact?.used ?? 0) - 1 })}
                      />
                    ) : null}
                  </div>
                  <p className="text-[11px] leading-snug text-stone-500">
                    Casting a spell of level I or higher uses up one slot of that level (or a higher
                    one, to cast it stronger); cantrips never use one. Filled marks are slots still
                    available, empty ones are spent. They all come back after a long rest
                    {sheet.class === "warlock" || sheet.spellcasting.pact ? " (a warlock's pact slots after a short rest too)" : ""}.
                    {corrects
                      ? " The DM marks them as spells are cast; the buttons correct the count."
                      : mine
                        ? " The DM marks them as you cast; the button marks one the count missed."
                        : ""}
                  </p>
                </div>
              ) : null}
              <div className="reveal mt-3">
                <SheetSpells sheet={sheet} editable={mine} />
              </div>
            </SheetBlock>
          ) : null}

          {spends || Object.keys(sheet.resources).length ? (
            <SheetBlock className="mt-4" title="Hit dice and resources">
              <div className="space-y-1.5 text-xs text-stone-300">
                <div className="flex items-start gap-2">
                  <span className="w-36 shrink-0 pt-1 text-stone-400">
                    <GameTerm id="hit_dice">Hit dice</GameTerm>
                  </span>
                  {/* SRD 5.1: hit dice are spent at the end of a short rest.
                      A player at the table chooses their own while the rest's
                      window is open (POST /sheet/hit-dice, which rolls and
                      heals); the DM seats and the lead correct the count. */}
                  <HitDiceSpend sheet={sheet} mine={mine} inCombat={inCombat} />
                  {corrects && !(sheet.hitDicePools?.length ?? 0) ? (
                    <button
                      type="button"
                      className={STEP_BUTTON}
                      disabled={busy || sheet.hitDice.spent >= sheet.hitDice.total}
                      title="Correction: mark a hit die as spent"
                      onClick={() => adjustUsage({ hitDiceSpent: sheet.hitDice.spent + 1 })}
                    >
                      <Minus className="size-3" />
                    </button>
                  ) : null}
                  {corrects && !(sheet.hitDicePools?.length ?? 0) ? (
                    <button
                      type="button"
                      className={STEP_BUTTON}
                      disabled={busy || sheet.hitDice.spent <= 0}
                      title="Correction: give a hit die back"
                      onClick={() => adjustUsage({ hitDiceSpent: sheet.hitDice.spent - 1 })}
                    >
                      <Plus className="size-3" />
                    </button>
                  ) : null}
                </div>
                {Object.entries(sheet.resources).map(([id, pool]) => (
                  <ResourceRow
                    key={id}
                    id={id}
                    pool={pool}
                    name={RESOURCE_NAMES.get(id) ?? titleCase(id)}
                    help={RESOURCE_HELP.get(id)}
                    spends={spends}
                    corrects={corrects}
                    busy={busy}
                    deadNote={deadNote}
                    onSpend={() => adjustUsage({ resources: { [id]: pool.used + 1 } })}
                    onRecover={() => adjustUsage({ resources: { [id]: pool.used - 1 } })}
                  />
                ))}
              </div>
              {spends ? (
                <p className="reveal mt-1.5 text-[11px] text-stone-500">
                  {corrects
                    ? "Minus spends, plus hands a use back as a correction."
                    : "Minus marks a use spent. Uses come back at rests; the DM or the party lead corrects a wrong count."}{" "}
                  Changes are logged to the session event log.
                </p>
              ) : null}
              {refusal?.at === "usage" ? (
                <p role="alert" className="reveal mt-1.5 text-[11px] text-amber-300">
                  {refusal.text}
                </p>
              ) : null}
            </SheetBlock>
          ) : null}

          {sheet.equipment.length ? (
            <SheetBlock className="mt-4" title="Equipment" aside={`Attuned ${attunedCount}/${attunementSlotsFor(sheet)}`}>
              <EquipmentChips
                equipment={sheet.equipment}
                extra={(index) => {
                  const item = sheet.equipment[index];
                  return item ? itemStatus(sheet, item).charges : null;
                }}
              />
              {mine && wearable.length ? (
                <div className="reveal mt-2 space-y-1">
                  <p className="text-[11px] text-stone-500">
                    Worn gear sets your AC ({sheet.acOverride ? "pinned by hand" : armor.parts.join(" + ")}
                    ). Attuned {attunedCount}/{attunementSlotsFor(sheet)}.
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
                  {wearable.map((item) => (
                    <SheetGearRow
                      key={item.name}
                      sheet={sheet}
                      item={item}
                      worn={item.equipped ?? !anyEquipped}
                      inCombat={inCombat}
                      myTurn={myTurn}
                      dead={dead}
                      busy={busy}
                      onGear={(change) => adjustUsage({ gear: { [item.name]: change } }, "gear")}
                    />
                  ))}
                  {refusal?.at === "gear" ? (
                    <p role="alert" className="reveal text-[11px] text-amber-300">
                      {refusal.text}
                    </p>
                  ) : null}
                  {timeNote ? (
                    <p key={timeNote} role="status" className="animate-fade-up text-[11px] text-sky-200/90">
                      {timeNote}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </SheetBlock>
          ) : null}

          {owedChoices(sheet).length ? (
            <SheetBlock className="mt-4" title="Choices owed">
              <p className="text-sm text-amber-200/90">
                Earned and not yet made: {owedChoices(sheet).join("; ")}. The next level-up takes them.
              </p>
            </SheetBlock>
          ) : null}
          {sheet.features.length ? (
            <SheetBlock className="mt-4" title="Features and traits">
              <FeatureChips features={sheet.features} classId={sheet.class} subclass={sheet.subclass} />
              <FeatureChoicePicker sheet={sheet} mine={mine} inCombat={inCombat} />
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
