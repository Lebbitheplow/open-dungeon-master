"use client";

import { Camera, Loader2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AvatarCropDialog } from "@/app/settings/AvatarCropDialog";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  STANDARD_LANGUAGES,
  suggestedCantripCount,
  suggestedSpellCount,
} from "@/lib/content/mechanics";
import type {
  Ability,
  AbilityScores,
  AsiChoice,
  CreateSheetInput,
  SheetAttachment,
} from "@/lib/schemas/sheet";
import {
  SRD_SKILLS,
  abilityMod,
  acBreakdownFor,
  computeSheetDerived,
  formatModifier,
  proficiencyBonus,
  spellSlotsFor,
  suggestedStartingHp,
} from "@/lib/srd";
import { ASI_LEVELS, applyAsiChoices, removeAsiChoices } from "@/lib/srd/asi";
import {
  classFeaturesFor,
  expertiseSlotsFor,
  subclassLevelFor,
  subclassNamesFor,
  subclassSpellsFor,
} from "@/lib/srd/features";
import { GameTerm } from "@/components/ui/GameTerm";
import { InfoButton } from "@/components/ui/InfoDialog";
import { describeFeature, describeRace, starterSpellsFor } from "@/lib/help";
import {
  findOptionByFeatureName,
  openOptionSlots,
  optionFeatureName,
  type OptionSlot,
} from "@/lib/srd/options";
import {
  FIGHTING_STYLES,
  fightingStyleFeatureName,
  fightingStyleSlots,
  type FightingStyleId,
} from "@/lib/srd/feature-effects";
import { defaultLoadout, suggestWeapons } from "@/lib/srd/weapons";
import { defaultArmor, suggestArmor } from "@/lib/srd/armor";
import { classGenres, spellClassFor } from "@/lib/classes";
import { GENRE_PRESETS } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import AbilityEditor, { type AbilityMethod, type AbilityState } from "./AbilityEditor";
import AsiFeatEditor from "./AsiFeatEditor";
import ContentPicker from "./ContentPicker";
import EquipmentSection from "./EquipmentSection";
import OptionPicker, { type PickerGroup, type PickerOption } from "./OptionPicker";
import { RacialChoicesSection } from "./RacialChoicesSection";
import {
  useArchetypes,
  useBuilderOptions,
  type BackgroundOption,
  type ClassOption,
} from "./useBuilderOptions";

const ALIGNMENTS = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"];
const GENDERS = ["Female", "Male", "Nonbinary"];

// Splits a flat option list into the standard (SRD/content-pack) entries and
// the other settings' catalog entries, grouped by each entry's primary genre.
// Only catalog rows carry `genres`, so "no genres" IS the standard bucket.
// Used when no genre steers the picker (high fantasy, custom, or the library
// builder) so a new player can tell a Netrunner is not a high-fantasy class;
// everything stays selectable either way.
function groupBySourceSetting<T extends { id: string; genres?: Genre[] }>(
  options: T[],
): { standard: T[]; packs: Array<{ genre: Genre; label: string; options: T[] }> } {
  const standard: T[] = [];
  const byGenre = new Map<Genre, T[]>();
  for (const option of options) {
    const source = option.genres?.[0];
    if (!source) {
      standard.push(option);
      continue;
    }
    byGenre.set(source, [...(byGenre.get(source) ?? []), option]);
  }
  const packs = GENRE_PRESETS.filter((preset) => byGenre.has(preset.id)).map((preset) => ({
    genre: preset.id,
    label: preset.name,
    options: byGenre.get(preset.id) ?? [],
  }));
  return { standard, packs };
}

export type BuilderResult = { level: number; sheet: CreateSheetInput };

// Full character creation form: Open5e races/classes/subclasses/backgrounds
// (SRD fallback), three ability-score methods, spell/equipment/feat pickers,
// live derived stats. Used by /characters/new and the campaign flow.
export default function CharacterBuilder({
  fixedLevel,
  genre,
  initial,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  fixedLevel?: number;
  // Campaign genre: floats setting-appropriate classes to the top of the
  // class picker. Absent in the library builder (default ordering).
  genre?: Genre;
  // Edit mode: prefill every field from an existing stored sheet (the
  // library copy, which owns builder-only fields like ASI picks).
  initial?: CreateSheetInput;
  submitLabel: string;
  onSubmit: (result: BuilderResult) => void;
  busy: boolean;
  error: string;
}) {
  const { races, classes, backgrounds, packInstalled } = useBuilderOptions();

  const [name, setName] = useState(initial?.name ?? "");
  const [alignment, setAlignment] = useState(initial?.alignment ?? "N");
  const [level, setLevel] = useState(fixedLevel ?? 1);
  const [raceId, setRaceId] = useState(initial?.race ?? "");
  const [classId, setClassId] = useState(initial?.class ?? "");
  const [subclass, setSubclass] = useState(initial?.subclass ?? "");
  const [backgroundId, setBackgroundId] = useState(initial?.background ?? "");
  const [method, setMethod] = useState<AbilityMethod>(initial ? "roll" : "standard");
  const [scores, setScores] = useState<AbilityState>({
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [expertisePicks, setExpertisePicks] = useState<string[]>([]);
  const [stylePicks, setStylePicks] = useState<FightingStyleId[]>([]);
  const [spells, setSpells] = useState<string[]>(() =>
    initial?.spellcasting
      ? [...new Set([...initial.spellcasting.known, ...initial.spellcasting.prepared])]
      : [],
  );
  const [equipment, setEquipment] = useState<Array<{ name: string; qty: number; slug?: string }>>(
    () =>
      (initial?.equipment ?? []).map((item) => ({
        name: item.name,
        qty: item.qty,
        ...(item.slug ? { slug: item.slug } : {}),
      })),
  );
  // Auto-added class weapons the user explicitly removed; reset on class change.
  const [removedAutoNames, setRemovedAutoNames] = useState<string[]>([]);
  const [feats, setFeats] = useState<string[]>(() => {
    if (!initial) {
      return [];
    }
    // ASI-mode feats re-derive from the ASI cards; keep only the extras.
    const asiFeats = new Set(
      (initial.asiChoices ?? []).flatMap((choice) =>
        choice.mode === "feat" ? [choice.feat] : [],
      ),
    );
    return (initial.feats ?? []).filter((feat) => !asiFeats.has(feat));
  });
  // One slot per ASI threshold the effective level has earned; kept full
  // length so lowering and re-raising the level restores earlier picks.
  const [asiChoices, setAsiChoices] = useState<Array<AsiChoice | null>>(
    initial?.asiChoices ?? [],
  );
  // Bonus languages of the player's choice (human, half-elf, high elf, and
  // content-pack races whose language text offers a pick).
  const [bonusLanguages, setBonusLanguages] = useState<string[]>([]);
  // Racial choices that used to be lost entirely: half-elf's two +1 ability
  // bumps and two skills, high elf's wizard cantrip, dwarf's tool pick.
  // Stored on the sheet so edit mode can rehydrate them exactly.
  const [racialAsi, setRacialAsi] = useState<Array<Ability | "">>(
    initial?.racialChoices?.asi ?? [],
  );
  const [racialSkills, setRacialSkills] = useState<string[]>(
    initial?.racialChoices?.skills ?? [],
  );
  const [racialCantrip, setRacialCantrip] = useState(
    initial?.racialChoices?.cantrip ?? "",
  );
  const [racialTool, setRacialTool] = useState(initial?.racialChoices?.tool ?? "");
  const [cantripNames, setCantripNames] = useState<string[]>([]);
  // Prefixed feature names, e.g. "Invocation: Agonizing Blast".
  const [optionPicks, setOptionPicks] = useState<string[]>(() =>
    (initial?.features ?? [])
      .filter((feature) => feature.source === "choice")
      .map((feature) => feature.name)
      .filter((name) => findOptionByFeatureName(name) !== null),
  );
  // One-shot acknowledgement for the "caster with no spells" warning.
  const [spellWarningAck, setSpellWarningAck] = useState(false);
  const [backstory, setBackstory] = useState(initial?.backstory ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [appearance, setAppearance] = useState(initial?.appearance ?? "");
  // An uploaded photo here means the creation routes skip the ComfyUI render
  // entirely (they only queue one when the sheet arrives without a portrait).
  // Edit mode keeps the existing portrait unless the player clears it.
  const [portrait, setPortrait] = useState<SheetAttachment | null>(initial?.portrait ?? null);
  const [cropping, setCropping] = useState(false);
  const [gold, setGold] = useState(initial?.gold ?? 15);
  const [hpOverride, setHpOverride] = useState<number | null>(initial?.maxHp ?? null);
  const [acOverride, setAcOverride] = useState<number | null>(initial?.ac ?? null);
  const [localError, setLocalError] = useState("");

  // Prefill pieces that need the async option lists: base ability scores
  // (final scores minus ASI picks minus racial bonuses; slightly lossy for
  // scores that hit the 20 cap), skill picks minus the background's fixed
  // skills, and bonus languages beyond the race's own.
  const hydratedInitial = useRef(false);
  useEffect(() => {
    if (!initial || hydratedInitial.current || !races.length || !backgrounds.length) {
      return;
    }
    hydratedInitial.current = true;
    const initialRace = races.find((entry) => entry.id === initial.race);
    const initialBackground = backgrounds.find((entry) => entry.id === initial.background);
    const withoutAsi = removeAsiChoices(initial.abilities, initial.asiChoices ?? []);
    const base: Record<Ability, number> = { ...withoutAsi };
    for (const [ability, bonus] of Object.entries(initialRace?.asi ?? {})) {
      base[ability as Ability] -= bonus ?? 0;
    }
    // Racial bumps of the player's choice were baked in the same way.
    if (initialRace?.asiChoice) {
      for (const ability of initial.racialChoices?.asi ?? []) {
        base[ability] -= initialRace.asiChoice.amount;
      }
    }
    setScores(base);
    // Skills granted by background or race are not class picks; the racial
    // ones are restored from racialChoices instead.
    const grantedSkills = new Set([
      ...(initialBackground?.skills ?? []),
      ...(initialRace?.skills ?? []),
      ...(initial.racialChoices?.skills ?? []),
    ]);
    setChosenSkills(initial.proficiencies.skills.filter((skill) => !grantedSkills.has(skill)));
    setExpertisePicks(initial.proficiencies.expertise ?? []);
    setBonusLanguages(
      initial.proficiencies.languages.filter(
        (language) => !(initialRace?.languages ?? []).includes(language),
      ),
    );
  }, [initial, races, backgrounds]);

  const race = races.find((entry) => entry.id === raceId) ?? races[0];
  const klass = classes.find((entry) => entry.id === classId) ?? classes[0];
  const background = backgrounds.find((entry) => entry.id === backgroundId) ?? backgrounds[0];
  const archetypes = useArchetypes(klass?.id ?? "");

  // Genre-recommended classes float to the top; everything stays selectable
  // (a fantasy wizard in a cyberpunk story is a legitimate choice). High
  // fantasy keeps the default order: the SRD twelve are its baseline.
  const recommendedClasses = useMemo(
    () =>
      genre && genre !== "custom" && genre !== "high_fantasy"
        ? classes.filter((entry) => classGenres(entry.id).includes(genre))
        : [],
    [classes, genre],
  );
  const otherClasses = useMemo(
    () =>
      recommendedClasses.length
        ? classes.filter(
            (entry) => !recommendedClasses.some((match) => match.id === entry.id),
          )
        : classes,
    [classes, recommendedClasses],
  );
  // Setting-specific backgrounds float to the top the same way classes do.
  const recommendedBackgrounds = useMemo(
    () =>
      genre && genre !== "custom" && genre !== "high_fantasy"
        ? backgrounds.filter((entry) => entry.genres?.includes(genre))
        : [],
    [backgrounds, genre],
  );
  const otherBackgrounds = useMemo(
    () =>
      recommendedBackgrounds.length
        ? backgrounds.filter(
            (entry) => !recommendedBackgrounds.some((match) => match.id === entry.id),
          )
        : backgrounds,
    [backgrounds, recommendedBackgrounds],
  );
  // With no recommended tier (high fantasy, custom, library builder), the
  // other settings' entries separate out under their source setting instead
  // of blending into the standard list unlabeled.
  const classGroups = useMemo(
    () => (recommendedClasses.length ? null : groupBySourceSetting(otherClasses)),
    [recommendedClasses, otherClasses],
  );
  const backgroundGroups = useMemo(
    () => (recommendedBackgrounds.length ? null : groupBySourceSetting(otherBackgrounds)),
    [recommendedBackgrounds, otherBackgrounds],
  );
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
          ...(klass?.languages ?? []),
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
  // chips) so no character begins the adventure unarmed.
  // Weapons AND armor: a fighter who starts with no armor in their pack
  // would derive an unarmored AC, which is not what "plate proficiency"
  // should feel like on turn one.
  const autoLoadout = useMemo(
    () => (klass ? [...defaultLoadout(klass.weapons), ...defaultArmor(klass.armor)] : []),
    [klass],
  );
  const suggestedWeapons = useMemo(() => (klass ? suggestWeapons(klass.weapons) : []), [klass]);
  const suggestedArmor = useMemo(() => (klass ? suggestArmor(klass.armor) : []), [klass]);
  const equipmentSuggestions = useMemo(
    () => [
      ...suggestedWeapons.map((weapon) => ({ name: weapon.name, note: weapon.damage })),
      ...suggestedArmor.map((armor) => ({
        name: armor.name,
        note: armor.category === "shield" ? `+${armor.baseAc} AC` : `AC ${armor.baseAc}`,
      })),
    ],
    [suggestedWeapons, suggestedArmor],
  );
  const fullEquipment = useMemo(() => {
    const manualNames = new Set(equipment.map((item) => item.name));
    const auto = autoLoadout
      .filter((weapon) => !removedAutoNames.includes(weapon.name) && !manualNames.has(weapon.name))
      .map((weapon) => ({ name: weapon.name, qty: 1 }));
    // Backgrounds hand over a starting kit too, not just skills.
    const backgroundGear = (background?.equipment ?? [])
      .filter((name) => !removedAutoNames.includes(name) && !manualNames.has(name))
      .map((name) => ({ name, qty: 1 }));
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

  // Fighting styles the class has earned by this level. Stored on the sheet
  // as "choice"-sourced features so the level-up regrant preserves them.
  const styleSlots = useMemo(
    () => (klass ? fightingStyleSlots(classFeaturesFor(klass.id, subclass, effectiveLevel)) : 0),
    [klass, subclass, effectiveLevel],
  );

  function addEquipmentItem(entry: { name: string; qty?: number; slug?: string }) {
    setEquipment((current) => {
      const existing = current.find((item) => item.name === entry.name);
      if (existing) {
        return current.map((item) =>
          item.name === entry.name ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [...current, { name: entry.name, qty: entry.qty ?? 1, slug: entry.slug }];
    });
  }

  function removeEquipmentItem(name: string) {
    if (equipment.some((item) => item.name === name)) {
      setEquipment((current) => current.filter((item) => item.name !== name));
    } else {
      setRemovedAutoNames((removed) =>
        removed.includes(name) ? removed : [...removed, name],
      );
    }
  }

  // The subclasses we have real feature tables for, offered once the chosen
  // level reaches the class's subclass level. Content-pack archetypes are
  // listed after them: those are prose only, so a player picking one gets no
  // features, and these should be the obvious choice.
  const builtInSubclasses = useMemo(() => {
    if (!klass) {
      return [];
    }
    const pickLevel = subclassLevelFor(klass.id);
    return pickLevel !== null && effectiveLevel >= pickLevel ? subclassNamesFor(klass.id) : [];
  }, [klass, effectiveLevel]);

  // Pack archetypes we already have a table for would otherwise appear twice.
  const packOnlyArchetypes = useMemo(() => {
    const known = new Set(builtInSubclasses.map((name) => name.toLowerCase()));
    return archetypes.filter((entry) => !known.has(entry.name.toLowerCase()));
  }, [archetypes, builtInSubclasses]);

  // The pack row behind the chosen subclass, which carries its write-up.
  const chosenArchetype = useMemo(
    () =>
      archetypes.find((entry) => entry.name.toLowerCase() === subclass.trim().toLowerCase()) ??
      null,
    [archetypes, subclass],
  );

  // Rows for the race/class/subclass/background dropdowns, each carrying the
  // info wiring for its InfoButton so any option can be read before choosing,
  // the same way the spell picker works.
  const raceGroups = useMemo<PickerGroup[]>(
    () => [
      {
        label: null,
        options: races.map((entry) => ({
          id: entry.id,
          name: entry.name,
          infoText: describeRace(entry.id) ?? entry.note,
          reference: { kind: "races", slug: entry.id, name: entry.name },
        })),
      },
    ],
    [races],
  );
  const classPickerGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: ClassOption): PickerOption => ({
      id: entry.id,
      name: entry.name,
      meta: entry.spellAbility ? `d${entry.hitDie} · caster` : `d${entry.hitDie}`,
      infoText: entry.blurb || entry.desc,
      reference: { kind: "classes", slug: entry.id, name: entry.name },
    });
    if (recommendedClasses.length) {
      return [
        { label: "Recommended for this setting", options: recommendedClasses.map(toOption) },
        { label: "All classes", options: otherClasses.map(toOption) },
      ];
    }
    if (classGroups?.packs.length) {
      return [
        { label: "Standard classes (high fantasy)", options: classGroups.standard.map(toOption) },
        ...classGroups.packs.map((pack) => ({
          label: `From the ${pack.label} setting`,
          options: pack.options.map(toOption),
        })),
      ];
    }
    return [{ label: null, options: otherClasses.map(toOption) }];
  }, [recommendedClasses, otherClasses, classGroups]);
  const subclassGroups = useMemo<PickerGroup[]>(() => {
    const groups: PickerGroup[] = [{ label: null, options: [{ id: "", name: "None yet" }] }];
    if (builtInSubclasses.length) {
      groups.push({
        label: "Full features",
        options: builtInSubclasses.map((name) => {
          const match = archetypes.find(
            (entry) => entry.name.toLowerCase() === name.toLowerCase(),
          );
          return {
            id: name,
            name,
            infoText: match?.desc,
            reference: match ? { kind: "archetypes", slug: match.id, name } : undefined,
          };
        }),
      });
    }
    if (packOnlyArchetypes.length) {
      groups.push({
        label: "From the content pack",
        options: packOnlyArchetypes.map((entry) => ({
          id: entry.name,
          name: entry.name,
          infoText: entry.desc,
          reference: { kind: "archetypes", slug: entry.id, name: entry.name },
        })),
      });
    }
    return groups;
  }, [builtInSubclasses, packOnlyArchetypes, archetypes]);
  const backgroundPickerGroups = useMemo<PickerGroup[]>(() => {
    const toOption = (entry: BackgroundOption): PickerOption => ({
      id: entry.id,
      name: entry.name,
      meta: entry.skills
        .map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId)
        .join(", "),
      infoText: entry.blurb || entry.desc,
      reference: { kind: "backgrounds", slug: entry.id, name: entry.name },
    });
    if (recommendedBackgrounds.length) {
      return [
        { label: "Recommended for this setting", options: recommendedBackgrounds.map(toOption) },
        { label: "All backgrounds", options: otherBackgrounds.map(toOption) },
      ];
    }
    if (backgroundGroups?.packs.length) {
      return [
        {
          label: "Standard backgrounds (high fantasy)",
          options: backgroundGroups.standard.map(toOption),
        },
        ...backgroundGroups.packs.map((pack) => ({
          label: `From the ${pack.label} setting`,
          options: pack.options.map(toOption),
        })),
      ];
    }
    return [{ label: null, options: otherBackgrounds.map(toOption) }];
  }, [recommendedBackgrounds, otherBackgrounds, backgroundGroups]);

  // What this class and subclass actually hand the character at this level.
  // The builder already computed these for the preview; showing them turns a
  // blind dropdown choice into an informed one.
  const grantedFeatures = useMemo(
    () => (klass ? classFeaturesFor(klass.id, subclass, effectiveLevel) : []),
    [klass, subclass, effectiveLevel],
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
            features: optionPicks.map((name) => ({ name })),
          })
        : [],
    [klass, subclass, effectiveLevel, optionPicks],
  );

  function toggleOption(slot: OptionSlot, name: string) {
    const featureName = optionFeatureName(slot.kind, name);
    setOptionPicks((current) => {
      if (current.includes(featureName)) {
        return current.filter((entry) => entry !== featureName);
      }
      return slot.chosen.length < slot.total ? [...current, featureName] : current;
    });
  }

  // Opening suggestions, so a player who has never seen a 5e spell list is
  // not left staring at an empty search box.
  const starters = useMemo(
    () => (klass?.spellAbility ? starterSpellsFor(klass.id) : null),
    [klass],
  );
  // What this class calls its spells, used in the empty-spell-list warning.
  const castingLabel = klass?.spellAbility ? (klass.castingLabel || "spells") : "";
  const starterCantripNames = useMemo(
    () => starters?.cantrips.map((pick) => pick.n.toLowerCase()) ?? [],
    [starters],
  );
  // Which chosen names are cantrips, so the two counters read separately.
  // Seeded from the recommendations and topped up by the picker, which knows
  // each row's level.
  const chosenCantrips = useMemo(() => {
    const known = new Set([...cantripNames.map((name) => name.toLowerCase()), ...starterCantripNames]);
    return spells.filter((name) => known.has(name.toLowerCase()));
  }, [spells, cantripNames, starterCantripNames]);
  const maxSpellLevel = useMemo(() => {
    if (!klass || klass.casterType === "none") {
      return 0;
    }
    const slots = spellSlotsFor(klass.id, effectiveLevel);
    return Object.keys(slots).reduce((top, slotLevel) => Math.max(top, Number(slotLevel)), 0);
  }, [klass, effectiveLevel]);

  function toggleSkill(skillId: string) {
    if (!klass || !background) {
      return;
    }
    setChosenSkills((current) =>
      current.includes(skillId)
        ? current.filter((entry) => entry !== skillId)
        : current.length < klass.skillChoices.count
          ? [...current, skillId]
          : current,
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!abilities || !preview || !race || !klass || !background) {
      setLocalError("Assign all six ability scores first.");
      return;
    }
    if (!name.trim()) {
      setLocalError("Give your character a name.");
      return;
    }
    const unresolvedSlot = activeAsiChoices.findIndex((choice) => choice === null);
    if (unresolvedSlot !== -1) {
      setLocalError(
        `Resolve your level ${asiSlotLevels[unresolvedSlot]} ability score improvement first.`,
      );
      return;
    }
    if (race.bonusLanguages > 0 && bonusLanguages.filter(Boolean).length < race.bonusLanguages) {
      setLocalError(`Pick your bonus ${race.bonusLanguages === 1 ? "language" : "languages"} first.`);
      return;
    }
    if (race.asiChoice && racialAsi.filter(Boolean).length < race.asiChoice.count) {
      setLocalError(`Pick which abilities your ${race.name} bonus raises first.`);
      return;
    }
    if (race.skillChoice && racialSkills.filter(Boolean).length < race.skillChoice.count) {
      setLocalError(`Pick your ${race.name} skill proficiencies first.`);
      return;
    }
    if (race.toolChoice && !racialTool) {
      setLocalError(`Pick your ${race.name} tool proficiency first.`);
      return;
    }
    if (race.cantripChoice && !racialCantrip) {
      setLocalError(`Pick your ${race.name} cantrip first.`);
      return;
    }
    // Casters with no spells at all can still be submitted (homebrew varies),
    // but not by accident: one confirmation makes it a deliberate choice.
    if (castingLabel && !spells.length && !spellWarningAck) {
      setSpellWarningAck(true);
      setLocalError(
        `${name.trim() || "This character"} has no ${castingLabel.toLowerCase()} selected and will start unable to cast. Submit again to continue anyway.`,
      );
      return;
    }
    setLocalError("");
    const resolvedAsiChoices = activeAsiChoices.filter(
      (choice): choice is AsiChoice => choice !== null,
    );
    const asiFeats = resolvedAsiChoices.flatMap((choice) =>
      choice.mode === "feat" ? [choice.feat] : [],
    );
    const slots = Object.fromEntries(
      Object.entries(spellSlotsFor(klass.id, effectiveLevel)).map(([slotLevel, max]) => [
        slotLevel,
        { max, used: 0 },
      ]),
    );
    const isKnownCaster =
      klass.knownCaster ?? ["bard", "sorcerer", "warlock", "ranger"].includes(klass.id);
    // A racial cantrip (high elf) joins the spell list for casters. A
    // non-caster has nowhere to put it, so it rides along as a feature
    // instead, which populateFeatures keeps and the DM prompt can see.
    const spellsWithRacial =
      racialCantrip && !spells.includes(racialCantrip) ? [...spells, racialCantrip] : spells;
    // Domain, circle, oath and patron spells are always prepared and free:
    // they ride onto the list on top of whatever the player picked.
    const grantedSpells = subclassSpellsFor(klass.id, subclass, effectiveLevel).filter(
      (spell) => !spellsWithRacial.some((entry) => entry.toLowerCase() === spell.toLowerCase()),
    );
    const finalSpells = klass.spellAbility ? [...spellsWithRacial, ...grantedSpells] : spells;
    const racialFeatures =
      racialCantrip && !klass.spellAbility
        ? [{ name: `Racial cantrip: ${racialCantrip}`, source: "story" as const }]
        : [];
    onSubmit({
      level: effectiveLevel,
      sheet: {
        name: name.trim(),
        race: race.id,
        class: klass.id,
        subclass,
        background: background.id,
        alignment,
        gender,
        appearance: appearance.trim(),
        abilities,
        maxHp: preview.maxHp,
        ac,
        acOverride: acOverride !== null,
        portrait,
        speed: race.speed,
        hitDice: {
          die: `d${klass.hitDie}` as "d6" | "d8" | "d10" | "d12",
          total: effectiveLevel,
          spent: 0,
        },
        // Characters are always built single-class; multiclassing happens
        // at level-up in play.
        classes: [],
        hitDicePools: null,
        proficiencies: preview.proficiencies,
        equipment: fullEquipment,
        gold,
        feats: [...new Set([...asiFeats, ...feats])],
        // Server-side creation populates SRD class features, racial traits
        // and the background feature; the builder contributes only what has
        // no other home, like a non-caster's racial cantrip.
        features: [
          ...racialFeatures,
          ...stylePicks
            .slice(0, styleSlots)
            .map((id) => ({ name: fightingStyleFeatureName(id), source: "choice" as const })),
          // Invocations, maneuvers, metamagic and the rest ride along as
          // "choice" features, the same shape as a fighting style, so the
          // level-up regrant preserves them.
          ...optionPicks.map((name) => ({ name, source: "choice" as const })),
        ],
        asiChoices: resolvedAsiChoices,
        racialChoices: {
          asi: racialAsi.filter((ability): ability is Ability => Boolean(ability)),
          skills: racialSkills.filter(Boolean),
          cantrip: racialCantrip,
          tool: racialTool,
        },
        spellcasting: klass.spellAbility
          ? {
              ability: klass.spellAbility,
              slots,
              prepared: isKnownCaster ? [] : finalSpells,
              known: isKnownCaster ? finalSpells : [],
            }
          : null,
        notes: "",
        backstory: backstory.trim(),
      },
    });
  }

  if (!races.length || !classes.length || !backgrounds.length) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300";
  const chip = (label: string, onRemove: () => void, homebrew = false) => (
    <span
      key={label}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        homebrew ? "border-amber-800 bg-amber-950/40 text-amber-200" : "border-stone-700 bg-stone-900 text-stone-200",
      )}
    >
      {label}
      <button type="button" onClick={onRemove} className="text-stone-500 hover:text-red-400">
        <X className="size-3" />
      </button>
    </span>
  );

  return (
    <form onSubmit={submit} className="space-y-6 text-sm">
      {!packInstalled ? (
        <p className="rounded-md border border-stone-800 bg-stone-900/60 p-3 text-xs text-stone-400">
          Content pack not installed; showing SRD 5.1 basics only. Run
          <span className="font-mono"> node scripts/import-open5e.mjs</span> on the server
          for the full Open5e catalog.
        </p>
      ) : null}

      <section className="panel ornate grid grid-cols-1 gap-3 rounded-xl p-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-stone-400">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-400">Gender</span>
          <select value={gender} onChange={(event) => setGender(event.target.value)} className={inputClass}>
            <option value="">Unspecified</option>
            {GENDERS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-stone-400">Alignment</span>
            <select value={alignment} onChange={(event) => setAlignment(event.target.value)} className={inputClass}>
              {ALIGNMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">Level</span>
            {fixedLevel ? (
              <span className="block rounded-md border border-stone-800 bg-stone-950 px-3 py-2 text-stone-400">
                {fixedLevel} (campaign)
              </span>
            ) : (
              <select value={level} onChange={(event) => setLevel(Number(event.target.value))} className={inputClass}>
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            )}
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-stone-400">Race</span>
          <OptionPicker
            value={race?.id ?? ""}
            groups={raceGroups}
            className={inputClass}
            onChange={(id) => {
              setRaceId(id);
              setBonusLanguages([]);
              setRacialAsi([]);
              setRacialSkills([]);
              setRacialCantrip("");
              setRacialTool("");
            }}
          />
          {race?.note ? (
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              <span className="line-clamp-2 grow">{race.note}</span>
              <InfoButton
                label={race.name}
                text={describeRace(race.id) ?? race.note}
                reference={{ kind: "races", slug: race.id }}
              />
            </span>
          ) : null}
        </label>
        {race && race.bonusLanguages > 0 ? (
          <div className="block">
            <span className="mb-1 block text-stone-400">
              Bonus {race.bonusLanguages === 1 ? "language" : "languages"} ({race.name} speaks{" "}
              {race.languages.join(" and ")} plus {race.bonusLanguages} of your choice)
            </span>
            {Array.from({ length: race.bonusLanguages }, (_, index) => (
              <select
                key={index}
                value={bonusLanguages[index] ?? ""}
                onChange={(event) =>
                  setBonusLanguages((current) => {
                    const next = [...current];
                    next[index] = event.target.value;
                    return next;
                  })
                }
                className={inputClass}
              >
                <option value="">Choose a language...</option>
                {STANDARD_LANGUAGES.filter(
                  (language) =>
                    !race.languages.includes(language) &&
                    (bonusLanguages[index] === language || !bonusLanguages.includes(language)),
                ).map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
              </select>
            ))}
          </div>
        ) : null}
        {race ? (
          <RacialChoicesSection
            race={race}
            grantedSkills={[...chosenSkills, ...(background?.skills ?? []), ...(race.skills ?? [])]}
            asi={racialAsi}
            onAsiChange={(index, ability) =>
              setRacialAsi((current) => {
                const next = [...current];
                next[index] = ability;
                return next;
              })
            }
            skills={racialSkills}
            onSkillsChange={(index, skill) =>
              setRacialSkills((current) => {
                const next = [...current];
                next[index] = skill;
                return next;
              })
            }
            cantrip={racialCantrip}
            onCantripChange={setRacialCantrip}
            tool={racialTool}
            onToolChange={setRacialTool}
            inputClass={inputClass}
          />
        ) : null}
        <label className="block">
          <span className="mb-1 block text-stone-400">Class</span>
          <OptionPicker
            value={klass?.id ?? ""}
            groups={classPickerGroups}
            className={inputClass}
            onChange={(id) => { setClassId(id); setChosenSkills([]); setSubclass(""); setSpells([]); setRemovedAutoNames([]); setOptionPicks([]); }}
          />
          {klass ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
              <GameTerm id="hit_dice">d{klass.hitDie} hit die</GameTerm> ·{" "}
              <GameTerm id="saving_throw">saves</GameTerm>{" "}
              {klass.saves.map((save) => save.toUpperCase()).join(", ")}
              {klass.spellAbility ? (
                <>
                  {" · "}
                  <GameTerm id={klass.spellAbility}>{klass.spellAbility.toUpperCase()}</GameTerm>{" "}
                  caster
                  {klass.castingLabel ? ` (spells flavored as ${klass.castingLabel})` : ""}
                </>
              ) : null}
              <InfoButton
                label={klass.name}
                text={klass.blurb || klass.desc}
                reference={{ kind: "classes", slug: klass.id }}
              />
            </span>
          ) : null}
        </label>
        {packOnlyArchetypes.length || builtInSubclasses.length ? (
          <label className="block">
            <span className="mb-1 block text-stone-400">Subclass</span>
            <OptionPicker
              value={subclass}
              groups={subclassGroups}
              placeholder="None yet"
              className={inputClass}
              onChange={setSubclass}
            />
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              {subclass ? (
                <>
                  <span className="grow">
                    {chosenArchetype?.desc
                      ? chosenArchetype.desc.split("\n")[0]
                      : "A specialization within your class."}
                  </span>
                  <InfoButton
                    label={subclass}
                    text={chosenArchetype?.desc}
                    reference={
                      chosenArchetype ? { kind: "archetypes", slug: chosenArchetype.id } : undefined
                    }
                  />
                </>
              ) : (
                <>
                  <span className="grow">
                    Your <GameTerm id="subclass">subclass</GameTerm> is the biggest choice about how
                    this character plays. Tap the info icon next to any option to read what it does
                    before choosing.
                  </span>
                </>
              )}
            </span>
          </label>
        ) : null}
        {grantedFeatures.length ? (
          <div className="rounded-lg border border-stone-800 bg-stone-950/60 p-3">
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-amber-200/80">
              What you gain at level {effectiveLevel}
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {grantedFeatures.map((feature) => (
                <span
                  key={`${feature.name}-${feature.level ?? 0}`}
                  className="flex items-center gap-1 text-xs text-stone-300"
                >
                  {feature.name}
                  <InfoButton
                    label={feature.name}
                    meta={feature.level ? `Level ${feature.level}` : undefined}
                    text={klass ? describeFeature(klass.id, subclass, feature.name) : null}
                  />
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-stone-600">
              Tap any name to read what it does. Racial traits and background perks are added on top
              when the character is saved.
            </p>
          </div>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-stone-400">Background</span>
          <OptionPicker
            value={background?.id ?? ""}
            groups={backgroundPickerGroups}
            className={inputClass}
            onChange={setBackgroundId}
          />
          {background ? (
            <span className="mt-1 flex items-start gap-1 text-xs text-stone-500">
              <span className="grow">
                {background.skills.length
                  ? `Grants ${background.skills.map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId).join(", ")}`
                  : "What your character did before adventuring."}
              </span>
              <InfoButton
                label={background.name}
                text={background.blurb || background.desc}
                reference={{ kind: "backgrounds", slug: background.id }}
              />
            </span>
          ) : null}
        </label>
      </section>

      <AbilityEditor
        method={method}
        onMethodChange={setMethod}
        scores={scores}
        onScoresChange={setScores}
        racialBonus={race?.asi ?? {}}
        asiCount={asiSlotLevels.length}
      />

      {asiSlotLevels.length ? (
        <AsiFeatEditor
          level={effectiveLevel}
          slotLevels={asiSlotLevels}
          baseScores={baseAbilities}
          choices={activeAsiChoices}
          onChange={(next) =>
            setAsiChoices((current) => {
              const merged = [...current];
              next.forEach((choice, index) => {
                merged[index] = choice;
              });
              return merged;
            })
          }
        />
      ) : null}

      {klass ? (
        <section className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-2 text-xs text-amber-200/90">Class skills (pick {klass.skillChoices.count})</h2>
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const fromBackground = background?.skills.includes(skillId) ?? false;
              const selected = chosenSkills.includes(skillId);
              return (
                <button
                  key={skillId}
                  type="button"
                  onClick={() => toggleSkill(skillId)}
                  disabled={fromBackground}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    fromBackground
                      ? "border-stone-800 bg-stone-900 text-stone-500"
                      : selected
                        ? "border-amber-700 bg-amber-950 text-amber-200"
                        : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  {skill?.name ?? skillId}
                  {fromBackground ? " (background)" : ""}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {klass && expertiseSlotsFor(klass.id, effectiveLevel) > 0 && preview ? (
        <section className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-2 text-xs text-amber-200/90">
            Expertise (pick {expertiseSlotsFor(klass.id, effectiveLevel)}: doubled proficiency bonus)
          </h2>
          <div className="flex flex-wrap gap-2">
            {preview.proficiencies.skills.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const selected = expertisePicks.includes(skillId);
              const slots = expertiseSlotsFor(klass.id, effectiveLevel);
              return (
                <button
                  key={skillId}
                  type="button"
                  onClick={() =>
                    setExpertisePicks((current) =>
                      selected
                        ? current.filter((entry) => entry !== skillId)
                        : current.length < slots
                          ? [...current, skillId]
                          : current,
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    selected
                      ? "border-amber-700 bg-amber-950 text-amber-200"
                      : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  {skill?.name ?? skillId}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {styleSlots > 0 ? (
        <section className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-2 text-xs text-amber-200/90">
            Fighting Style (pick {styleSlots})
          </h2>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {FIGHTING_STYLES.map((style) => {
              const selected = stylePicks.includes(style.id);
              return (
                <button
                  key={style.id}
                  type="button"
                  onClick={() =>
                    setStylePicks((current) =>
                      selected
                        ? current.filter((entry) => entry !== style.id)
                        : current.length < styleSlots
                          ? [...current, style.id]
                          : current,
                    )
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left",
                    selected
                      ? "border-amber-700 bg-amber-950 text-amber-200"
                      : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  <span className="block text-xs">{style.name}</span>
                  <span className="block text-[11px] text-stone-500">{style.description}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {optionSlots.map((slot) => (
        <section key={slot.kind} className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-1 text-xs text-amber-200/90">
            {slot.label} (pick {slot.total})
          </h2>
          <p className="mb-2 text-xs text-stone-500">
            {slot.remaining > 0 ? (
              <span className="text-amber-300">
                {slot.remaining} still to choose.{" "}
              </span>
            ) : null}
            These are real abilities your character gets. Tap the info button on any one to read
            what it does.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {slot.options.map((option) => {
              const selected = slot.chosen.some(
                (name) => name.toLowerCase() === option.n.toLowerCase(),
              );
              return (
                <div
                  key={option.n}
                  className={cn(
                    "flex items-start gap-1 rounded-lg border px-3 py-2",
                    selected
                      ? "border-amber-700 bg-amber-950 text-amber-200"
                      : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleOption(slot, option.n)}
                    className="grow text-left"
                  >
                    <span className="block text-xs">{option.n}</span>
                    <span className="block text-[11px] text-stone-500">
                      {option.req ? `Requires ${option.req}. ` : ""}
                      {option.d}
                    </span>
                  </button>
                  <InfoButton
                    label={option.n}
                    meta={option.req ? `Requires ${option.req}` : undefined}
                    text={option.d}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {klass?.spellAbility ? (
        <section className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Spells</h2>
          {/* Counts, so nobody leaves picks unspent without noticing. The
              picker knows each spell's level, so chosen cantrips are counted
              separately from levelled spells. */}
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {cantripAdvice ? (
              <span
                className={cn(
                  chosenCantrips.length >= cantripAdvice ? "text-stone-500" : "text-amber-300",
                )}
              >
                <GameTerm id="cantrip">Cantrips</GameTerm> {chosenCantrips.length}/{cantripAdvice}
              </span>
            ) : null}
            {spellAdvice ? (
              <span
                className={cn(
                  spells.length - chosenCantrips.length >= spellAdvice.count
                    ? "text-stone-500"
                    : "text-amber-300",
                )}
              >
                {spellAdvice.label} {Math.max(0, spells.length - chosenCantrips.length)}/
                {spellAdvice.count}
              </span>
            ) : null}
            <span className="text-stone-500">
              Up to level {maxSpellLevel}. Suggestions, not limits; homebrew varies.
            </span>
          </div>
          {starters ? (
            <div className="mb-3 rounded-lg border border-stone-800 bg-stone-950/60 p-3">
              <p className="text-xs text-stone-400">{starters.why}</p>
              <p className="mt-2 mb-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-200/80">
                Good picks if you are new
              </p>
              <div className="flex flex-wrap gap-1.5">
                {[...starters.cantrips, ...starters.spells].map((pick) => {
                  const chosen = spells.some(
                    (entry) => entry.toLowerCase() === pick.n.toLowerCase(),
                  );
                  return (
                    <span key={pick.n} className="flex items-center">
                      <button
                        type="button"
                        onClick={() =>
                          setSpells((current) =>
                            chosen
                              ? current.filter(
                                  (entry) => entry.toLowerCase() !== pick.n.toLowerCase(),
                                )
                              : [...current, pick.n],
                          )
                        }
                        className={cn(
                          "rounded-l-full border py-0.5 pl-2.5 pr-1.5 text-xs transition-colors",
                          chosen
                            ? "border-amber-600 bg-amber-950/40 text-amber-100"
                            : "border-stone-700 text-stone-300 hover:border-amber-800",
                        )}
                      >
                        {chosen ? "\u2713 " : "+ "}
                        {pick.n}
                      </button>
                      <span
                        className={cn(
                          "rounded-r-full border border-l-0 py-0.5 pl-1 pr-2",
                          chosen ? "border-amber-600 bg-amber-950/40" : "border-stone-700",
                        )}
                      >
                        <InfoButton label={pick.n} text={pick.d} />
                      </span>
                    </span>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() =>
                  setSpells((current) => [
                    ...current,
                    ...[...starters.cantrips, ...starters.spells]
                      .map((pick) => pick.n)
                      .filter(
                        (name) =>
                          !current.some((entry) => entry.toLowerCase() === name.toLowerCase()),
                      ),
                  ])
                }
                className="mt-2 text-xs text-amber-300 underline-offset-2 hover:underline"
              >
                Add all recommended
              </button>
            </div>
          ) : null}
          <ContentPicker
            kind="spells"
            extraParams={{ class: spellSearchClass, level: String(maxSpellLevel) }}
            placeholder="Search spells (e.g. cure wounds)"
            onPick={(entry) => {
              if (entry.level === 0) {
                setCantripNames((current) =>
                  current.includes(entry.name) ? current : [...current, entry.name],
                );
              }
              setSpells((current) =>
                current.includes(entry.name) ? current : [...current, entry.name],
              );
            }}
            renderMeta={(entry) => (entry.level === 0 ? "cantrip" : `level ${entry.level}`)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {spells.map((spell) => chip(spell, () => setSpells((current) => current.filter((entry) => entry !== spell))))}
          </div>
        </section>
      ) : null}

      <EquipmentSection
        equipment={fullEquipment}
        suggestions={equipmentSuggestions}
        onAdd={addEquipmentItem}
        onAddMany={(entries) =>
          setEquipment((current) => {
            const names = new Set(current.map((item) => item.name));
            return [...current, ...entries.filter((item) => !names.has(item.name))];
          })
        }
        onRemove={removeEquipmentItem}
        gold={gold}
        setGold={setGold}
        chip={chip}
        inputClass={inputClass}
      />

      <section className="panel rounded-xl p-4">
        <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Portrait (optional)</h2>
        <div className="mb-3 flex items-center gap-3">
          {portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait.url}
              alt="Character portrait"
              className="size-16 shrink-0 rounded-lg border border-amber-500/30 object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-stone-800 bg-stone-950 text-stone-600">
              <UserRound className="size-6" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setCropping(true)} className={ui.btnSmall}>
                <Camera className="size-3.5" />
                {portrait ? "Replace photo" : "Upload a photo"}
              </button>
              {portrait ? (
                <button type="button" onClick={() => setPortrait(null)} className={ui.btnSmall}>
                  {initial?.portrait && portrait.url === initial.portrait.url
                    ? "Regenerate portrait"
                    : "Remove photo"}
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-stone-500">
              {portrait
                ? "This photo is used as-is; no portrait is painted for you."
                : "A portrait is painted for you after you save."}
            </p>
          </div>
        </div>
        <h3 className="mb-1 text-xs text-stone-400">Appearance</h3>
        <p className="mb-2 text-xs text-stone-500">
          Used to paint your character&apos;s portrait if you don&apos;t upload a photo.
        </p>
        <textarea
          value={appearance}
          onChange={(event) => setAppearance(event.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Silver hair, weathered face, a scar across one eye..."
          className={cn(inputClass, "resize-y")}
        />
      </section>

      <section className="panel rounded-xl p-4">
        <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Backstory (optional)</h2>
        <p className="mb-2 text-xs text-stone-500">
          Who were they before the adventure? The party can read this, and the DM weaves it
          into the story.
        </p>
        <textarea
          value={backstory}
          onChange={(event) => setBackstory(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="A disgraced temple guard looking for a second chance..."
          className={cn(inputClass, "resize-y")}
        />
      </section>

      <section className="panel rounded-xl p-4">
        <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Additional feats (optional)</h2>
        {asiSlotLevels.length ? (
          <p className="mb-2 text-xs text-stone-500">
            Beyond the ability score improvement picks above; racial or homebrew feats go here.
          </p>
        ) : null}
        <ContentPicker
          kind="feats"
          placeholder="Search feats (e.g. alert, tough)"
          onPick={(entry) => setFeats((current) => (current.includes(entry.name) ? current : [...current, entry.name]))}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {feats.map((feat) => chip(feat, () => setFeats((current) => current.filter((entry) => entry !== feat))))}
        </div>
      </section>

      {preview && race ? (
        <section className="panel ornate rounded-xl border-amber-500/30 p-4">
          <h2 className="eyebrow mb-2 text-xs text-amber-200/90">Derived stats</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-stone-300 sm:grid-cols-4">
            <label className="block">
              <span className="block text-xs text-stone-500">Max HP</span>
              <input
                type="number"
                min={1}
                max={500}
                value={preview.maxHp}
                onChange={(event) => setHpOverride(Number(event.target.value) || 1)}
                className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-stone-500">
                AC{acOverride === null ? "" : " (pinned)"}
              </span>
              <input
                type="number"
                min={1}
                max={30}
                value={ac}
                onChange={(event) => setAcOverride(Number(event.target.value) || 10)}
                className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1"
              />
              <span className="mt-1 block text-[11px] text-stone-500">
                {acOverride === null
                  ? (acInfo?.parts.join(" + ") ?? "")
                  : "typed by hand; armor no longer changes it"}
              </span>
              {acOverride === null ? null : (
                <button
                  type="button"
                  onClick={() => setAcOverride(null)}
                  className="mt-1 text-[11px] text-amber-300/80 underline"
                >
                  use my armor instead
                </button>
              )}
            </label>
            <span className="self-end">Speed {race.speed} ft</span>
            <span className="self-end">Prof {formatModifier(proficiencyBonus(effectiveLevel))}</span>
            <span>Initiative {formatModifier(preview.derived.initiative)}</span>
            <span>Passive Perception {preview.derived.passivePerception}</span>
            {preview.derived.spellSaveDc ? <span>Spell DC {preview.derived.spellSaveDc}</span> : null}
            {preview.derived.spellAttack !== null ? (
              <span>Spell attack {formatModifier(preview.derived.spellAttack)}</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {localError || error ? <p className="text-red-400">{localError || error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-200 px-3 py-2.5 font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {submitLabel}
      </button>

      {cropping ? (
        <AvatarCropDialog
          title={`Portrait for ${name.trim() || "your character"}`}
          onUploaded={(image) => {
            setCropping(false);
            setPortrait({ id: image.id, name: image.name, type: image.type, url: image.url });
          }}
          onClose={() => setCropping(false)}
        />
      ) : null}
    </form>
  );
}
