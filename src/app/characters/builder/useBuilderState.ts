"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Ability,
  AsiChoice,
  CreateSheetInput,
  SheetAttachment,
} from "@/lib/schemas/sheet";
import { removeAsiChoices } from "@/lib/srd/asi";
import { findOptionByFeatureName } from "@/lib/srd/options";
import type { FightingStyleId } from "@/lib/srd/feature-effects";
import type { AbilityMethod, AbilityState } from "./AbilityEditor";
import type { BackgroundOption, RaceOption } from "./useBuilderOptions";

export type EquipmentItem = { name: string; qty: number; slug?: string };

// Every field the character builder edits, in one hook so the wizard steps
// can share it without the orchestrator re-declaring forty useStates. The
// shape of each value is exactly what the old single-file builder held; the
// submit payload (submit.ts) reads these unchanged.
export function useBuilderState({
  initial,
  fixedLevel,
  races,
  backgrounds,
}: {
  initial?: CreateSheetInput;
  fixedLevel?: number;
  races: RaceOption[];
  backgrounds: BackgroundOption[];
}) {
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
  const [equipment, setEquipment] = useState<EquipmentItem[]>(() =>
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
  const [racialCantrip, setRacialCantrip] = useState(initial?.racialChoices?.cantrip ?? "");
  const [racialTool, setRacialTool] = useState(initial?.racialChoices?.tool ?? "");
  const [cantripNames, setCantripNames] = useState<string[]>([]);
  // Prefixed feature names, e.g. "Invocation: Agonizing Blast".
  const [optionPicks, setOptionPicks] = useState<string[]>(() =>
    (initial?.features ?? [])
      .filter((feature) => feature.source === "choice")
      .map((feature) => feature.name)
      .filter((featureName) => findOptionByFeatureName(featureName) !== null),
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

  // Choosing a different race throws away every race-specific pick, since
  // none of them make sense for the new one.
  function changeRace(id: string) {
    setRaceId(id);
    setBonusLanguages([]);
    setRacialAsi([]);
    setRacialSkills([]);
    setRacialCantrip("");
    setRacialTool("");
  }

  // Same for the class: skills, subclass, spells, loadout edits and the
  // class option picks all belong to the old class.
  function changeClass(id: string) {
    setClassId(id);
    setChosenSkills([]);
    setSubclass("");
    setSpells([]);
    setRemovedAutoNames([]);
    setOptionPicks([]);
  }

  return {
    name, setName,
    alignment, setAlignment,
    level, setLevel,
    raceId, changeRace,
    classId, changeClass,
    subclass, setSubclass,
    backgroundId, setBackgroundId,
    method, setMethod,
    scores, setScores,
    chosenSkills, setChosenSkills,
    expertisePicks, setExpertisePicks,
    stylePicks, setStylePicks,
    spells, setSpells,
    equipment, setEquipment,
    removedAutoNames, setRemovedAutoNames,
    feats, setFeats,
    asiChoices, setAsiChoices,
    bonusLanguages, setBonusLanguages,
    racialAsi, setRacialAsi,
    racialSkills, setRacialSkills,
    racialCantrip, setRacialCantrip,
    racialTool, setRacialTool,
    cantripNames, setCantripNames,
    optionPicks, setOptionPicks,
    spellWarningAck, setSpellWarningAck,
    backstory, setBackstory,
    gender, setGender,
    appearance, setAppearance,
    portrait, setPortrait,
    gold, setGold,
    hpOverride, setHpOverride,
    acOverride, setAcOverride,
    localError, setLocalError,
  };
}

export type BuilderState = ReturnType<typeof useBuilderState>;
