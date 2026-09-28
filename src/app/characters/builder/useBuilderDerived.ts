"use client";

import { useMemo } from "react";
import { spellClassFor } from "@/lib/classes";
import { suggestedCantripCount, suggestedSpellCount } from "@/lib/content/mechanics";
import { starterSpellsFor } from "@/lib/help";
import type { Ability, AbilityScores, AsiChoice, EquipmentItem } from "@/lib/schemas/sheet";
import {
  abilityMod,
  acBreakdownFor,
  computeSheetDerived,
  spellSlotsFor,
} from "@/lib/srd";
import { applyAsiChoices, asiLevelsFor, asiSlotsTakenInPlay } from "@/lib/srd/asi";
import { derivedMaxHp, hpBonusPerLevelFor, hpRange, type HpMethod } from "@/lib/srd/hit-points";
import { hpBonusPerLevel, srdRaceId } from "@/lib/srd/race-id";
import { halfFeatPicks, scoresWithHalfFeats } from "@/lib/srd/legality/half-feats";
import {
  bundledPrices,
  judgeStartingGear,
  type StartingWealthMethod,
} from "@/lib/srd/starting-wealth";
import { suggestArmor } from "@/lib/srd/armor";
import { classFeaturesFor, subclassSpellsFor } from "@/lib/srd/features";
import { fightingStyleSlots } from "@/lib/srd/feature-effects";
import { openOptionSlots, optionFeatureName, type OptionSlot } from "@/lib/srd/options";
import { spellStyleFor, spellbookAllowance, type SpellStyle } from "@/lib/srd/spell-prep";
import {
  chooseKitOption as withKitOption,
  classKitFor,
  kitNames,
  pickKitSlot as withKitPick,
  resolveKit,
  startingKitFor,
  type KitTraining,
} from "@/lib/srd/starting-kit";
import { suggestWeapons } from "@/lib/srd/weapons";
import { splitToolGrants, type ToolChoice } from "@/lib/srd/tool-choices";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderState, EquipmentItem as BuilderItem } from "./useBuilderState";

// Everything the builder computes from its fields: final abilities, the sheet
// preview, the auto loadout and AC, spell counts and the class option slots.
// Kept apart from the fields so each wizard step can read what it needs
// without knowing how it was derived.
// What the table has set for the numbers the server derives. Absent in the
// library, where a character is built under the defaults.
export type TableRules = {
  hpMethod: HpMethod;
  startingWealth: StartingWealthMethod;
  // Gold the server rolled for this class, at a table that rolls wealth;
  // null until it has.
  wealthRoll?: number | null;
};

// The class's and background's tool grants with the player's picks placed on
// the open ones they fit. Nothing is picked for the player: `left` is what
// each open grant still waits for, and the class step holds until it is 0.
export function resolveToolPicks(
  grants: string[],
  picks: string[],
): { fixed: string[]; choices: ToolChoice[]; chosen: string[]; left: number[] } {
  const { fixed, choices } = splitToolGrants(grants);
  const taken = new Set(fixed.map((tool) => tool.toLowerCase()));
  const left = choices.map((choice) => choice.count);
  const chosen: string[] = [];
  for (const pick of picks.map((tool) => tool.trim().toLowerCase())) {
    const slot = choices.findIndex((choice, index) => left[index] > 0 && choice.from.includes(pick));
    if (slot >= 0 && !chosen.includes(pick) && !taken.has(pick)) {
      left[slot] -= 1;
      chosen.push(pick);
    }
  }
  return { fixed, choices, chosen, left };
}

export function useBuilderDerived({
  state,
  race,
  klass,
  background,
  fixedLevel,
  rules,
}: {
  state: BuilderState;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  fixedLevel?: number;
  rules?: TableRules;
}) {
  const {
    level, scores, racialAsi, asiChoices, chosenSkills, expertisePicks, bonusLanguages,
    racialSkills, racialTool, backgroundSkills, hpOverride, acOverride, equipment, removedAutoNames,
    toolPicks, repeatSkills,
    subclass, optionPicks, spells, cantrips, bookPrepared, keepsStoredGear, asiRecorded, asiReachedLevel,
  } = state;

  const effectiveLevel = fixedLevel ?? level;
  // Improvements are the class's own: a fighter's seven, a rogue's six.
  const classId = klass?.id;
  const asiSlotLevels = useMemo(
    () => asiLevelsFor(classId).filter((threshold) => effectiveLevel >= threshold),
    [effectiveLevel, classId],
  );
  const activeAsiChoices = useMemo(
    () => asiSlotLevels.map((_, index) => asiChoices[index] ?? null),
    [asiSlotLevels, asiChoices],
  );
  // Slots an edited character took in play: resolved, and worth nothing
  // here, since the stored scores already include them.
  const asiTakenInPlay = useMemo(
    () => asiSlotsTakenInPlay(asiSlotLevels, asiRecorded, asiReachedLevel),
    [asiSlotLevels, asiRecorded, asiReachedLevel],
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

  // The scores the builder SENDS: the improvements in, the half-feats' points
  // not (the server adds those, src/lib/srd/legality/half-feats.ts).
  const abilities = useMemo<AbilityScores | null>(
    () => (baseAbilities ? applyAsiChoices(baseAbilities, activeAsiChoices) : null),
    [baseAbilities, activeAsiChoices],
  );
  // The scores the server will STORE, with those points in, and the saving
  // throw Resilient adds: what every number on screen is worked out from.
  const raceId = race?.id;
  const { feats: racialFeatNames, racialFeatAbility } = state;
  const halfFeats = useMemo(() => {
    if (!abilities) {
      return null;
    }
    const picks = halfFeatPicks(
      {
        asiChoices: activeAsiChoices.filter((choice): choice is AsiChoice => choice !== null),
        feats: racialFeatNames,
        racialChoices: { featAbility: racialFeatAbility },
      },
      raceId && srdRaceId(raceId) === "variant_human" ? 1 : 0,
    );
    return scoresWithHalfFeats(abilities, picks);
  }, [abilities, activeAsiChoices, racialFeatNames, racialFeatAbility, raceId]);
  const shownAbilities = halfFeats?.abilities ?? null;

  // Skills come from five places, not two: the class picks, the
  // background's fixed grants and its picks, the race's fixed grants (high
  // elf Perception, half-orc Intimidation) and the race's choice grants
  // (half-elf). Known before any
  // ability score is, which the expertise picks on the class step rely on:
  // a rogue or bard chooses them a step ahead of the scores.
  const proficientSkills = useMemo(
    () => [
      ...new Set([
        ...chosenSkills,
        ...(background?.skills ?? []),
        ...backgroundSkills.filter(Boolean),
        ...(race?.skills ?? []),
        ...racialSkills.filter(Boolean),
        ...repeatSkills.filter(Boolean),
      ]),
    ],
    [chosenSkills, background, backgroundSkills, race, racialSkills, repeatSkills],
  );

  const toolGrants = useMemo(
    () => resolveToolPicks([...(klass?.tools ?? []), ...(background?.tools ?? [])], toolPicks),
    [klass, background, toolPicks],
  );

  const preview = useMemo(() => {
    if (!shownAbilities || !race || !klass || !background) {
      return null;
    }
    const skills = proficientSkills;
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
          ...(background.knownLanguages ?? []),
          ...bonusLanguages.filter(Boolean),
          ...(klass.languages ?? []),
        ]),
      ],
      tools: [
        ...new Set(
          [
            ...toolGrants.fixed,
            ...(race.tools ?? []),
            racialTool,
            ...toolGrants.chosen,
          ].filter(Boolean),
        ),
      ],
      // Races can teach combat training too: mountain dwarf armor, drow
      // and wood elf weapons.
      armor: [...new Set([...klass.armor, ...(race.armor ?? [])])],
      weapons: [...new Set([...klass.weapons, ...(race.weapons ?? [])])],
    };
    // Resilient's save counts in what is shown; the server writes it itself,
    // so the proficiencies sent stay the class's.
    const saves = [...new Set([...klass.saves, ...(halfFeats?.saves ?? [])])];
    // The class's features and the feats count too (Remarkable Athlete and
    // Alert move the initiative), as they do on the stored sheet.
    const derived = computeSheetDerived({
      abilities: shownAbilities,
      level: effectiveLevel,
      class: klass.id,
      features: classFeaturesFor(klass.id, subclass, effectiveLevel),
      feats: [
        ...state.feats,
        ...activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
      ],
      proficiencies: { ...proficiencies, saves },
      spellcasting: klass.spellAbility
        ? { ability: klass.spellAbility, slots: {}, prepared: [], known: [], cantrips: [] }
        : null,
    });
    // Hit points are the server's to derive, by the table's method; this is
    // the same arithmetic, shown. A table that rolls them rolls on the
    // server when the character is saved, so the figure here is the fixed
    // value and `hpRange` what the dice may give. A stored character keeps
    // the hit points it came home with (hpOverride) until the server says
    // otherwise.
    const hpInput = {
      classes: [{ die: klass.hitDie, level: effectiveLevel }],
      con: shownAbilities.con,
      perLevelBonus: hpBonusPerLevelFor(hpBonusPerLevel(race.id) > 0, [
        ...state.feats,
        ...activeAsiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : [])),
      ]),
    };
    const method = rules?.hpMethod ?? "average";
    const maxHp =
      hpOverride ?? derivedMaxHp(method === "max" ? "max" : "average", hpInput);
    return { proficiencies, derived, maxHp, hpMethod: method, hpRange: hpRange(hpInput) };
  }, [shownAbilities, halfFeats, race, klass, subclass, background, proficientSkills, expertisePicks, bonusLanguages, racialTool, toolGrants, effectiveLevel, hpOverride, rules?.hpMethod, state.feats, activeAsiChoices]);

  // The class's starting equipment rides along automatically (removable
  // chips): the book's list with the either-or choices the player made on
  // the gear step (src/lib/srd/starting-kit.ts), the same kit the server
  // hands out free. A barbarian starts with a greataxe and no armor, and
  // its armor class is its Unarmored Defense.
  const kitChoicesState = state.kitChoices;
  // The training a kit's "(if proficient)" options ask about.
  const kitTraining = useMemo<KitTraining>(
    () => ({
      armor: [...(klass?.armor ?? []), ...(race?.armor ?? [])],
      weapons: [...(klass?.weapons ?? []), ...(race?.weapons ?? [])],
      subclass,
    }),
    [klass, race, subclass],
  );
  const startingKit = useMemo(
    () =>
      klass
        ? startingKitFor(
            { id: klass.id, armor: kitTraining.armor, weapons: kitTraining.weapons },
            kitChoicesState ?? null,
            subclass,
            klass.name,
          )
        : null,
    [klass, kitTraining, kitChoicesState, subclass],
  );
  const autoLoadout = useMemo(() => startingKit?.items ?? [], [startingKit]);
  const classKit = useMemo(() => (klass && !keepsStoredGear ? classKitFor(klass.id) : null), [klass, keepsStoredGear]);
  // What the sheet stores: the choices as the server reads them, or a
  // stored character's own while it keeps its gear.
  const kitChoices =
    keepsStoredGear
      ? kitChoicesState?.options.length || kitChoicesState?.picks.length
        ? kitChoicesState
        : undefined
      : startingKit?.tabled
        ? startingKit.choices
        : undefined;
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
    if (keepsStoredGear) {
      return equipment;
    }
    const auto = autoLoadout
      .filter((item) => !removedAutoNames.includes(item.name))
      .map((item) => ({ name: item.name, qty: item.qty }));
    // Backgrounds hand over a starting kit too, not just skills.
    const backgroundGear = (background?.equipment ?? [])
      .filter((itemName) => !removedAutoNames.includes(itemName))
      .map((itemName) => ({ name: itemName, qty: 1 }));
    // One row per name: a dagger bought beside the rogue's two is a third.
    const rows: BuilderItem[] = [];
    for (const item of [...auto, ...backgroundGear, ...equipment]) {
      const held = rows.findIndex((row) => row.name === item.name);
      if (held >= 0) {
        rows[held] = { ...rows[held], ...item, qty: rows[held].qty + item.qty };
      } else {
        rows.push({ ...item });
      }
    }
    return rows;
  }, [equipment, autoLoadout, removedAutoNames, background, keepsStoredGear]);

  // What the pack costs. Under "equipment" the class's gear and the
  // background's kit are free and the background's coin is the purse; under
  // "rolled" the server's roll is the purse and everything is bought. A
  // stored character's pack was earned, so an edit charges only what it adds.
  const wealthMethod = rules?.startingWealth ?? "equipment";
  const purse = useMemo(() => {
    const priceOf = (itemName: string) => {
      const picked = equipment.find((item) => item.name === itemName);
      return picked?.priceCp !== undefined
        ? { copper: picked.priceCp, magic: false }
        : bundledPrices(itemName);
    };
    const freeKit = keepsStoredGear
      ? equipment.flatMap((item) => Array.from({ length: item.qty }, () => item.name))
      : wealthMethod === "rolled"
        ? []
        : [...kitNames(autoLoadout), ...(background?.equipment ?? [])];
    const coinCopper = keepsStoredGear
      ? state.gold * 100
      : Math.round(
          (wealthMethod === "rolled" ? (rules?.wealthRoll ?? 0) : (background?.purse ?? 0)) * 100,
        );
    const verdict = judgeStartingGear({ equipment: fullEquipment, freeKit, coinCopper, priceOf });
    const left = Math.max(0, coinCopper - verdict.spentCopper);
    return {
      method: wealthMethod,
      coinCopper,
      spentCopper: verdict.spentCopper,
      // The kit's choices matter where the kit is free; under rolled wealth
      // they only say what is pre-added to buy.
      problems: [
        ...(keepsStoredGear || wealthMethod === "rolled" ? [] : (startingKit?.problems ?? [])),
        ...verdict.problems,
      ],
      gold: Math.floor(left / 100),
      copper: left % 100,
    };
  }, [equipment, fullEquipment, autoLoadout, startingKit, background, keepsStoredGear, wealthMethod, rules?.wealthRoll, state.gold]);

  // AC is derived from the gear above, never typed: equipping a breastplate
  // moves the number here and on the sheet. Pinning an armor class is a
  // correction, and corrections are the DM's or the party lead's to make.
  const acInfo = useMemo(() => {
    if (!klass || !preview || !shownAbilities) {
      return null;
    }
    return acBreakdownFor({
      class: klass.id,
      level: effectiveLevel,
      abilities: shownAbilities,
      proficiencies: preview.proficiencies,
      equipment: fullEquipment,
      features: classFeaturesFor(klass.id, subclass, effectiveLevel),
    });
  }, [klass, preview, shownAbilities, fullEquipment, subclass, effectiveLevel]);
  const ac = acInfo?.ac ?? acOverride ?? 10;

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
  const maxSpellLevel = useMemo(() => {
    if (!klass || klass.casterType === "none") {
      return 0;
    }
    const slots = spellSlotsFor(klass.id, effectiveLevel);
    return Object.keys(slots).reduce((top, slotLevel) => Math.max(top, Number(slotLevel)), 0);
  }, [klass, effectiveLevel]);
  const rawCantripAdvice = klass?.spellAbility
    ? suggestedCantripCount(spellSearchClass, effectiveLevel, klass.casterType)
    : null;
  // A class that casts, and has something to cast at this level. A level 1
  // paladin or ranger has a spellcasting ability and no spells, no cantrips
  // and no slots: showing them a spell step with a level 0 search and an
  // "unable to cast" warning was a dead end with nothing to pick.
  const casts = Boolean(klass?.spellAbility) && (maxSpellLevel > 0 || rawCantripAdvice !== null);
  const cantripAdvice = casts ? rawCantripAdvice : null;
  const spellAdvice =
    casts && klass?.spellAbility && shownAbilities
      ? suggestedSpellCount(spellSearchClass, effectiveLevel, abilityMod(shownAbilities[klass.spellAbility]))
      : null;
  // Opening suggestions, so a player who has never seen a 5e spell list is
  // not left staring at an empty search box.
  const starters = useMemo(
    () => (casts && klass ? starterSpellsFor(klass.id) : null),
    [klass, casts],
  );
  // Domain, circle, oath and patron spells: always prepared, free, and worth
  // showing at the top of the list so a cleric knows what their domain gives.
  const subclassSpells = useMemo(
    () => (casts && klass ? subclassSpellsFor(klass.id, subclass, effectiveLevel) : []),
    [klass, subclass, effectiveLevel, casts],
  );
  // What this class calls its spells, used in the empty-spell-list warning.
  const castingLabel = casts && klass ? (klass.castingLabel || "spells") : "";
  // How this class holds its spells: known, prepared from the class list, or
  // (a wizard) written in a spellbook and prepared from it. A content-pack
  // class says whether it is a known caster; the rest follow the SRD.
  const spellStyle: SpellStyle | null = !casts || !klass
    ? null
    : klass.knownCaster === true
      ? "known"
      : klass.knownCaster === false && spellStyleFor(klass.id) === "known"
        ? "prepared"
        : spellStyleFor(klass.id);
  // A wizard's book: six spells at 1st level, two more every level.
  const spellbookAdvice = spellStyle === "spellbook" ? spellbookAllowance(effectiveLevel) : null;
  // Cantrips are their own list. Levelled spells count against the class's
  // allowance except the subclass's always-prepared ones, which are free. For
  // a wizard `chosenSpells` is the book and `chosenPrepared` what is
  // prepared from it; for everyone else the two are the same list.
  const chosenCantrips = cantrips;
  const chosenSpells = useMemo(() => {
    const free = new Set(subclassSpells.map((spellName) => spellName.toLowerCase()));
    return spells.filter((spellName) => !free.has(spellName.toLowerCase()));
  }, [spells, subclassSpells]);
  const chosenPrepared = useMemo(() => {
    if (spellStyle !== "spellbook") {
      return chosenSpells;
    }
    const book = new Set(spells.map((spellName) => spellName.toLowerCase()));
    return bookPrepared.filter((spellName) => book.has(spellName.toLowerCase()));
  }, [spellStyle, chosenSpells, spells, bookPrepared]);

  return {
    effectiveLevel,
    asiSlotLevels,
    activeAsiChoices,
    asiTakenInPlay,
    baseAbilities,
    abilities,
    shownAbilities,
    proficientSkills,
    toolGrants,
    preview,
    equipmentSuggestions,
    classKit,
    kitChoices,
    kitTraining,
    fullEquipment,
    purse,
    acInfo,
    ac,
    grantedFeatures,
    styleSlots,
    optionSlots,
    spellSearchClass,
    casts,
    spellAdvice,
    cantripAdvice,
    starters,
    subclassSpells,
    castingLabel,
    chosenCantrips,
    chosenSpells,
    chosenPrepared,
    spellStyle,
    spellbookAdvice,
    maxSpellLevel,
  };
}

export type BuilderDerived = ReturnType<typeof useBuilderDerived>;

// Action helpers that close over the state setters. Plain functions rather
// than hooks so the steps can call them from any handler.
export function builderActions(
  state: BuilderState,
  klass: ClassOption | undefined,
  race?: RaceOption,
  background?: BackgroundOption,
) {
  // A skill the background or race grants outright is not a class pick;
  // taking it again would spend a slot on nothing.
  const granted = new Set([...(background?.skills ?? []), ...state.backgroundSkills, ...(race?.skills ?? [])]);
  return {
    addEquipmentItem(entry: {
      name: string;
      qty?: number;
      slug?: string;
      gear?: EquipmentItem["gear"];
      weight?: number;
      priceCp?: number;
    }) {
      state.setEquipment((current) => {
        const existing = current.find((item) => item.name === entry.name);
        if (existing) {
          return current.map((item) =>
            item.name === entry.name ? { ...item, qty: item.qty + 1 } : item,
          );
        }
        // A homebrew item arrives with its mechanics snapshotted, so the
        // builder's live AC and attack lines read it before it is saved.
        return [
          ...current,
          {
            name: entry.name,
            qty: entry.qty ?? 1,
            slug: entry.slug,
            ...(entry.gear ? { gear: entry.gear } : {}),
            ...(entry.weight !== undefined ? { weight: entry.weight } : {}),
            ...(entry.priceCp !== undefined ? { priceCp: entry.priceCp } : {}),
          },
        ];
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
    // An either-or line of the class's starting equipment, and the weapon
    // named for an "any simple weapon" slot. Kit items the player removed
    // come back with a new choice, since the choice is about them.
    chooseKitOption(line: number, option: number) {
      const kit = klass ? classKitFor(klass.id) : null;
      if (kit) {
        state.setKitChoices((current) => withKitOption(kit, current, line, option));
        state.setRemovedAutoNames([]);
      }
    },
    pickKitSlot(index: number, name: string) {
      const kit = klass ? classKitFor(klass.id) : null;
      if (kit) {
        state.setKitChoices((current) =>
          withKitPick(resolveKit(kit, current, { armor: [], weapons: [] }).choices, index, name),
        );
        state.setRemovedAutoNames([]);
      }
    },
    toggleSkill(skillId: string) {
      if (!klass || granted.has(skillId)) {
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
