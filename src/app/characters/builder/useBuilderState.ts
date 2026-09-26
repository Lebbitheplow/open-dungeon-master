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
import {
  FIGHTING_STYLES,
  fightingStyleFeatureName,
  type FightingStyleId,
} from "@/lib/srd/feature-effects";
import { canonicalRaceId } from "@/lib/content/race-options";
import type { AbilityMethod, AbilityState } from "./AbilityEditor";
import type { PoolEntry, PoolSlots } from "./abilityDice";
import { reconcilePicks, type BuilderPicks } from "./reconcile";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";

export type EquipmentItem = { name: string; qty: number; slug?: string };

// Every field the character builder edits, in one hook so the wizard steps
// can share it without the orchestrator re-declaring forty useStates. The
// shape of each value is exactly what the old single-file builder held; the
// submit payload (submit.ts) reads these unchanged.
export function useBuilderState({
  initial,
  initialLevel,
  fixedLevel,
  races,
  classes,
  backgrounds,
}: {
  initial?: CreateSheetInput;
  // The level the stored character reached (its library row's level).
  initialLevel?: number;
  fixedLevel?: number;
  races: RaceOption[];
  classes: ClassOption[];
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
  // The six 4d6 totals and which ability holds each. Kept here rather than
  // in the editor so leaving the step, or trying another method and coming
  // back, does not hand the player a free reroll.
  const [rollPool, setRollPool] = useState<PoolEntry[] | null>(null);
  const [rollSlots, setRollSlots] = useState<PoolSlots<Ability>>({
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [expertisePicks, setExpertisePicks] = useState<string[]>([]);
  // A stored fighting style rides as a "choice" feature; an edit reopens
  // with it picked rather than asking for it again.
  const [stylePicks, setStylePicks] = useState<FightingStyleId[]>(() =>
    FIGHTING_STYLES.filter((style) =>
      (initial?.features ?? []).some(
        (feature) => feature.source === "choice" && feature.name === fightingStyleFeatureName(style.id),
      ),
    ).map((style) => style.id),
  );
  // Levelled spells and cantrips are two lists, the way the sheet keeps them.
  // For a wizard `spells` is the spellbook and `bookPrepared` the part of it
  // prepared; every other class leaves `bookPrepared` alone.
  const [spells, setSpells] = useState<string[]>(() =>
    initial?.spellcasting
      ? [
          ...new Set([
            ...(initial.spellcasting.spellbook ?? []),
            ...initial.spellcasting.known,
            ...initial.spellcasting.prepared,
          ]),
        ]
      : [],
  );
  const [bookPrepared, setBookPrepared] = useState<string[]>(
    () => initial?.spellcasting?.prepared ?? [],
  );
  const [cantrips, setCantrips] = useState<string[]>(() =>
    initial?.spellcasting ? [...new Set(initial.spellcasting.cantrips ?? [])] : [],
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
  // Only a pinned AC comes back pinned. A derived one re-derives from the
  // gear, or saving an edit would pin it and armour changed in play would
  // stop moving it.
  const [acOverride, setAcOverride] = useState<number | null>(
    initial?.acOverride ? initial.ac : null,
  );
  const [localError, setLocalError] = useState("");

  // The picks that depend on an earlier choice, gathered so one call can
  // check them all against the current race, class, background and level
  // (reconcile.ts). Read from the render's values: every caller is an event
  // handler or an effect of this render.
  const picks: BuilderPicks = {
    chosenSkills, racialSkills, racialAsi, racialCantrip, racialTool, bonusLanguages,
    subclass, expertisePicks, stylePicks, optionPicks, spells, bookPrepared, cantrips,
  };
  function applyPicks(next: BuilderPicks) {
    setChosenSkills(next.chosenSkills);
    setRacialSkills(next.racialSkills);
    setRacialAsi(next.racialAsi);
    setRacialCantrip(next.racialCantrip);
    setRacialTool(next.racialTool);
    setBonusLanguages(next.bonusLanguages);
    setSubclass(next.subclass);
    setExpertisePicks(next.expertisePicks);
    setStylePicks(next.stylePicks);
    setOptionPicks(next.optionPicks);
    setSpells(next.spells);
    setBookPrepared(next.bookPrepared);
    setCantrips(next.cantrips);
  }
  type Selection = { raceId: string; classId: string; backgroundId: string; level: number };
  const selection: Selection = { raceId, classId, backgroundId, level };
  // The rows the builder shows for these ids: until the player picks, each
  // list's first row stands in (CharacterBuilder.tsx does the same), and
  // the picks have to be checked against what is shown, or an unpicked
  // background's language slots would be trimmed away by the next change.
  function reconciled(next: Partial<Selection>, current: BuilderPicks): BuilderPicks {
    const ids = { ...selection, ...next };
    return reconcilePicks(current, {
      race: findRace(races, ids.raceId) ?? races[0],
      klass: classes.find((entry) => entry.id === ids.classId) ?? classes[0],
      background: backgrounds.find((entry) => entry.id === ids.backgroundId) ?? backgrounds[0],
      level: fixedLevel ?? ids.level,
    }).picks;
  }

  // Prefill pieces that need the async option lists: base ability scores
  // (final scores minus ASI picks minus racial bonuses; slightly lossy for
  // scores that hit the 20 cap), skill picks minus the background's fixed
  // skills, and bonus languages beyond the race's own. Runs again whenever
  // the option rows change (the content pack arriving after the SRD
  // fallback), because a pick that was valid against one catalog may not be
  // against the other.
  const hydratedInitial = useRef(false);
  useEffect(() => {
    if (!races.length || !classes.length || !backgrounds.length) {
      return;
    }
    const ids = { ...selection };
    if (initial && !hydratedInitial.current) {
      hydratedInitial.current = true;
      const initialRace = findRace(races, ids.raceId) ?? races[0];
      const initialBackground = backgrounds.find((entry) => entry.id === initial.background) ?? backgrounds[0];
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
      // A saved sheet opens on the roll method: its six scores become the
      // pool, already placed, so they can be moved around but not rerolled
      // into something better.
      const keys = Object.keys(base) as Ability[];
      setRollPool(keys.map((key) => ({ total: base[key], roll: null })));
      setRollSlots(Object.fromEntries(keys.map((key, index) => [key, index])) as PoolSlots<Ability>);
      // Skills granted by background or race are not class picks; the racial
      // ones are restored from racialChoices instead.
      const grantedSkills = new Set([
        ...(initialBackground?.skills ?? []),
        ...(initialRace?.skills ?? []),
        ...(initial.racialChoices?.skills ?? []),
      ]);
      const initialClass = classes.find((entry) => entry.id === initial.class);
      // A class's own tongue (Druidic, Thieves' Cant) is not a pick either.
      const spoken = new Set([...(initialRace?.languages ?? []), ...(initialClass?.languages ?? [])]);
      applyPicks(
        reconciled(ids, {
          ...picks,
          chosenSkills: initial.proficiencies.skills.filter((skill) => !grantedSkills.has(skill)),
          expertisePicks: initial.proficiencies.expertise ?? [],
          bonusLanguages: initial.proficiencies.languages.filter((language) => !spoken.has(language)),
        }),
      );
      return;
    }
    applyPicks(reconciled(ids, picks));
    // Runs when the option rows change; the picks it reads are this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, races, classes, backgrounds]);

  // Choosing a different race throws away every race-specific pick, since
  // none of them make sense for the new one, and re-checks the rest (a class
  // skill the new race grants outright, a language it already speaks).
  function changeRace(id: string) {
    setRaceId(id);
    applyPicks(
      reconciled(
        { raceId: id },
        { ...picks, racialAsi: [], racialSkills: [], racialCantrip: "", racialTool: "" },
      ),
    );
  }

  // Same for the class: skills, subclass, spells, loadout edits and the
  // class option picks all belong to the old class.
  function changeClass(id: string) {
    setClassId(id);
    setRemovedAutoNames([]);
    applyPicks(
      reconciled(
        { classId: id },
        {
          ...picks,
          chosenSkills: [],
          subclass: "",
          spells: [],
          bookPrepared: [],
          cantrips: [],
          optionPicks: [],
          stylePicks: [],
          expertisePicks: [],
        },
      ),
    );
  }

  // A background, subclass or level change keeps every pick that still
  // fits and drops the rest: an acolyte's second language under a criminal,
  // Battle Master maneuvers under a Champion, a 3rd-level spell at level 1.
  function changeBackground(id: string) {
    setBackgroundId(id);
    applyPicks(reconciled({ backgroundId: id }, picks));
  }
  function changeSubclass(name: string) {
    applyPicks(reconciled({}, { ...picks, subclass: name }));
  }
  function changeLevel(next: number) {
    setLevel(next);
    applyPicks(reconciled({ level: next }, picks));
  }

  // An edit keeps the gear the character actually carries. The class
  // loadout and background kit are added to a new character only; for a
  // stored one they would bring back what was sold or lost in play. A class
  // or background changed in the edit hands over its kit as creation does.
  // Improvements the stored character took at the table, which its scores
  // already carry (asiSlotsTakenInPlay). A sheet never levelled in play
  // recorded a pick for every slot it earned, so none are marked.
  const asiRecorded = initial?.asiChoices?.length ?? 0;
  const asiReachedLevel = initial ? (initialLevel ?? initial.hitDice?.total ?? 0) : 0;

  const keepsStoredGear =
    Boolean(initial) && classId === initial?.class && backgroundId === initial?.background;

  return {
    keepsStoredGear,
    asiRecorded,
    asiReachedLevel,
    name, setName,
    alignment, setAlignment,
    level, changeLevel,
    raceId, changeRace,
    classId, changeClass,
    subclass, changeSubclass,
    backgroundId, changeBackground,
    method, setMethod,
    scores, setScores,
    rollPool, setRollPool,
    rollSlots, setRollSlots,
    chosenSkills, setChosenSkills,
    expertisePicks, setExpertisePicks,
    stylePicks, setStylePicks,
    spells, setSpells,
    bookPrepared, setBookPrepared,
    cantrips, setCantrips,
    equipment, setEquipment,
    removedAutoNames, setRemovedAutoNames,
    feats, setFeats,
    asiChoices, setAsiChoices,
    bonusLanguages, setBonusLanguages,
    racialAsi, setRacialAsi,
    racialSkills, setRacialSkills,
    racialCantrip, setRacialCantrip,
    racialTool, setRacialTool,
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

// The row for a race id, or for the same lineage under another spelling: a
// sheet built from the bundled list holds "hill_dwarf" while the content
// pack, once it arrives, offers "hill-dwarf" and "odm-hill-dwarf". Matching
// the lineage keeps an edit on its race instead of the list's first row.
export function findRace(races: RaceOption[], raceId: string): RaceOption | undefined {
  if (!raceId) {
    return undefined;
  }
  return (
    races.find((entry) => entry.id === raceId) ??
    races.find((entry) => canonicalRaceId(entry.id) === canonicalRaceId(raceId))
  );
}
