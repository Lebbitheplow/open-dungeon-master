"use client";

import { useMemo } from "react";
import { spellClassFor } from "@/lib/classes";
import { suggestedCantripCount, suggestedSpellCount } from "@/lib/content/mechanics";
import { starterSpellsFor } from "@/lib/help";
import type { Ability, AbilityScores } from "@/lib/schemas/sheet";
import {
  abilityMod,
  acBreakdownFor,
  computeSheetDerived,
  spellSlotsFor,
  suggestedStartingHp,
} from "@/lib/srd";
import { ASI_LEVELS, applyAsiChoices } from "@/lib/srd/asi";
import { defaultArmor, suggestArmor } from "@/lib/srd/armor";
import { classFeaturesFor } from "@/lib/srd/features";
import { fightingStyleSlots } from "@/lib/srd/feature-effects";
import { openOptionSlots, optionFeatureName, type OptionSlot } from "@/lib/srd/options";
import { defaultLoadout, suggestWeapons } from "@/lib/srd/weapons";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderState } from "./useBuilderState";

// Everything the builder computes from its fields: final abilities, the sheet
// preview, the auto loadout and AC, spell counts and the class option slots.
// Kept apart from the fields so each wizard step can read what it needs
// without knowing how it was derived.
export function useBuilderDerived({
  state,
  race,
  klass,
  background,
  fixedLevel,
}: {
  state: BuilderState;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  fixedLevel?: number;
}) {
  const {
    level, scores, racialAsi, asiChoices, chosenSkills, expertisePicks, bonusLanguages,
    racialSkills, racialTool, hpOverride, acOverride, equipment, removedAutoNames,
    subclass, optionPicks, spells, cantripNames,
  } = state;

  const effectiveLevel = fixedLevel ?? level;
  const asiSlotLevels = useMemo(
    () => ASI_LEVELS.filter((threshold) => effectiveLevel >= threshold),
    [effectiveLevel],
  );
  const activeAsiChoices = useMemo(
    () => asiSlotLevels.map((_, index) => asiChoices[index] ?? null),
    [asiSlotLevels, asiChoices],
  );

  // Base scores after racial bonuses, before level ASIs; what the ASI cards
  // build on.
  const baseAbilities = useMemo<AbilityScores | null>(() => {
    if (!race || Object.values(scores).some((value) => value === null)) {
      return null;
    }
    const final = { ...(scores as Record<Ability, number>) };
    for (const [ability, bonus] of Object.entries(race.asi)) {
      final[ability as Ability] += bonus ?? 0;
    }
    // Races that grant ability bumps of the player's choice (half-elf).
    if (race.asiChoice) {
      for (const ability of racialAsi) {
        if (ability) {
          final[ability] += race.asiChoice.amount;
        }
      }
    }
    return final as AbilityScores;
  }, [scores, race, racialAsi]);

  const abilities = useMemo<AbilityScores | null>(
    () => (baseAbilities ? applyAsiChoices(baseAbilities, activeAsiChoices) : null),
    [baseAbilities, activeAsiChoices],
  );

  const preview = useMemo(() => {
    if (!abilities || !race || !klass || !background) {
      return null;
    }
    // Skills come from four places, not two: the class picks, the
    // background, the race's fixed grants (high elf Perception, half-orc
    // Intimidation) and the race's choice grants (half-elf).
    const skills = [
      ...new Set([
        ...chosenSkills,
        ...background.skills,
        ...(race.skills ?? []),
        ...racialSkills.filter(Boolean),
      ]),
    ];
    const proficiencies = {
      saves: klass.saves,
      skills,
      // Expertise picks only count while still proficient in the skill.
      expertise: expertisePicks.filter((skillId) => skills.includes(skillId)),
      // A class teaches its own secret tongue: Druidic to a druid, Thieves'
      // Cant to a rogue. Without this a druid could never speak Druidic even
      // though the feature says they do.
      languages: [
        ...new Set([
          ...race.languages,
          ...bonusLanguages.filter(Boolean),
          ...(klass.languages ?? []),
        ]),
      ],
      tools: [
        ...new Set(
          [
            ...(klass.tools ?? []),
            ...(background.tools ?? []),
            ...(race.tools ?? []),
            racialTool,
          ].filter(Boolean),
        ),
      ],
      // Races can teach combat training too: mountain dwarf armor, drow
      // and wood elf weapons.
      armor: [...new Set([...klass.armor, ...(race.armor ?? [])])],
      weapons: [...new Set([...klass.weapons, ...(race.weapons ?? [])])],
    };
    const derived = computeSheetDerived({
      abilities,
      level: effectiveLevel,
      proficiencies,
      spellcasting: klass.spellAbility
        ? { ability: klass.spellAbility, slots: {}, prepared: [], known: [] }
        : null,
    });
    const maxHp =
      hpOverride ?? suggestedStartingHp(klass.id, race.id, abilities.con, effectiveLevel);
    return { proficiencies, derived, maxHp };
  }, [abilities, race, klass, background, chosenSkills, expertisePicks, bonusLanguages, racialSkills, racialTool, effectiveLevel, hpOverride]);

  // Class-appropriate starting weapons ride along automatically (removable
  // chips) so no character begins the adventure unarmed. Weapons AND armor:
  // a fighter who starts with no armor in their pack would derive an
  // unarmored AC, which is not what "plate proficiency" should feel like on
  // turn one.
  const autoLoadout = useMemo(
    () => (klass ? [...defaultLoadout(klass.weapons), ...defaultArmor(klass.armor)] : []),
    [klass],
  );
  const equipmentSuggestions = useMemo(() => {
    if (!klass) {
      return [];
    }
    return [
      ...suggestWeapons(klass.weapons).map((weapon) => ({ name: weapon.name, note: weapon.damage })),
      ...suggestArmor(klass.armor).map((armor) => ({
        name: armor.name,
        note: armor.category === "shield" ? `+${armor.baseAc} AC` : `AC ${armor.baseAc}`,
      })),
    ];
  }, [klass]);
  const fullEquipment = useMemo(() => {
    const manualNames = new Set(equipment.map((item) => item.name));
    const auto = autoLoadout
      .filter((weapon) => !removedAutoNames.includes(weapon.name) && !manualNames.has(weapon.name))
      .map((weapon) => ({ name: weapon.name, qty: 1 }));
    // Backgrounds hand over a starting kit too, not just skills.
    const backgroundGear = (background?.equipment ?? [])
      .filter((itemName) => !removedAutoNames.includes(itemName) && !manualNames.has(itemName))
      .map((itemName) => ({ name: itemName, qty: 1 }));
    return [...auto, ...backgroundGear, ...equipment];
  }, [equipment, autoLoadout, removedAutoNames, background]);

  // AC is derived from the gear above, not typed: equipping a breastplate
  // moves the number here and on the sheet. The player can still pin a value
  // (homebrew armor, a DM ruling), which sets acOverride on the sheet and
  // tells the server engine to stop recomputing it.
  const acInfo = useMemo(() => {
    if (!klass || !preview || !abilities) {
      return null;
    }
    return acBreakdownFor({
      class: klass.id,
      level: effectiveLevel,
      abilities,
      proficiencies: preview.proficiencies,
      equipment: fullEquipment,
      features: classFeaturesFor(klass.id, subclass, effectiveLevel),
    });
  }, [klass, preview, abilities, fullEquipment, subclass, effectiveLevel]);
  const ac = acOverride ?? acInfo?.ac ?? 10;

  // What this class and subclass actually hand the character at this level.
  // Showing them turns a blind dropdown choice into an informed one.
  const grantedFeatures = useMemo(
    () => (klass ? classFeaturesFor(klass.id, subclass, effectiveLevel) : []),
    [klass, subclass, effectiveLevel],
  );
  // Fighting styles the class has earned by this level. Stored on the sheet
  // as "choice"-sourced features so the level-up regrant preserves them.
  const styleSlots = useMemo(() => fightingStyleSlots(grantedFeatures), [grantedFeatures]);

  // Invocations, maneuvers, metamagic, pact boons, infusions, runes and
  // elemental disciplines: the pick-lists that used to be feature names with
  // no way to choose them. Stored like fighting styles, as prefixed
  // "choice" features that survive level-ups.
  const optionSlots = useMemo(
    () =>
      klass
        ? openOptionSlots({
            classId: klass.id,
            subclass,
            level: effectiveLevel,
            features: optionPicks.map((optionName) => ({ name: optionName })),
          })
        : [],
    [klass, subclass, effectiveLevel, optionPicks],
  );

  // Spell lists and advice go through the borrowed SRD list for catalog
  // casters (a Netrunner searches wizard spells).
  const spellSearchClass = klass ? spellClassFor(klass.id) : "";
  const spellAdvice =
    klass?.spellAbility && abilities
      ? suggestedSpellCount(spellSearchClass, effectiveLevel, abilityMod(abilities[klass.spellAbility]))
      : null;
  const cantripAdvice = klass?.spellAbility
    ? suggestedCantripCount(spellSearchClass, effectiveLevel, klass.casterType)
    : null;
  // Opening suggestions, so a player who has never seen a 5e spell list is
  // not left staring at an empty search box.
  const starters = useMemo(
    () => (klass?.spellAbility ? starterSpellsFor(klass.id) : null),
    [klass],
  );
  // What this class calls its spells, used in the empty-spell-list warning.
  const castingLabel = klass?.spellAbility ? (klass.castingLabel || "spells") : "";
  // Which chosen names are cantrips, so the two counters read separately.
  // Seeded from the recommendations and topped up by the picker, which knows
  // each row's level.
  const chosenCantrips = useMemo(() => {
    const known = new Set([
      ...cantripNames.map((spellName) => spellName.toLowerCase()),
      ...(starters?.cantrips.map((pick) => pick.n.toLowerCase()) ?? []),
    ]);
    return spells.filter((spellName) => known.has(spellName.toLowerCase()));
  }, [spells, cantripNames, starters]);
  const maxSpellLevel = useMemo(() => {
    if (!klass || klass.casterType === "none") {
      return 0;
    }
    const slots = spellSlotsFor(klass.id, effectiveLevel);
    return Object.keys(slots).reduce((top, slotLevel) => Math.max(top, Number(slotLevel)), 0);
  }, [klass, effectiveLevel]);

  return {
    effectiveLevel,
    asiSlotLevels,
    activeAsiChoices,
    baseAbilities,
    abilities,
    preview,
    equipmentSuggestions,
    fullEquipment,
    acInfo,
    ac,
    grantedFeatures,
    styleSlots,
    optionSlots,
    spellSearchClass,
    spellAdvice,
    cantripAdvice,
    starters,
    castingLabel,
    chosenCantrips,
    maxSpellLevel,
  };
}

export type BuilderDerived = ReturnType<typeof useBuilderDerived>;

// Action helpers that close over the state setters. Plain functions rather
// than hooks so the steps can call them from any handler.
export function builderActions(state: BuilderState, klass: ClassOption | undefined) {
  return {
    addEquipmentItem(entry: { name: string; qty?: number; slug?: string }) {
      state.setEquipment((current) => {
        const existing = current.find((item) => item.name === entry.name);
        if (existing) {
          return current.map((item) =>
            item.name === entry.name ? { ...item, qty: item.qty + 1 } : item,
          );
        }
        return [...current, { name: entry.name, qty: entry.qty ?? 1, slug: entry.slug }];
      });
    },
    addEquipmentItems(entries: Array<{ name: string; qty: number }>) {
      state.setEquipment((current) => {
        const names = new Set(current.map((item) => item.name));
        return [...current, ...entries.filter((item) => !names.has(item.name))];
      });
    },
    removeEquipmentItem(itemName: string) {
      if (state.equipment.some((item) => item.name === itemName)) {
        state.setEquipment((current) => current.filter((item) => item.name !== itemName));
      } else {
        state.setRemovedAutoNames((removed) =>
          removed.includes(itemName) ? removed : [...removed, itemName],
        );
      }
    },
    toggleSkill(skillId: string) {
      if (!klass) {
        return;
      }
      state.setChosenSkills((current) =>
        current.includes(skillId)
          ? current.filter((entry) => entry !== skillId)
          : current.length < klass.skillChoices.count
            ? [...current, skillId]
            : current,
      );
    },
    toggleOption(slot: OptionSlot, optionName: string) {
      const featureName = optionFeatureName(slot.kind, optionName);
      state.setOptionPicks((current) => {
        if (current.includes(featureName)) {
          return current.filter((entry) => entry !== featureName);
        }
        return slot.chosen.length < slot.total ? [...current, featureName] : current;
      });
    },
  };
}

export type BuilderActions = ReturnType<typeof builderActions>;
