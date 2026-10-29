"use client";

import type { Gender } from "@/lib/gender";
import { normalizeAttraction, type Attraction } from "@/lib/attraction";
import { authoredFeatDesc } from "@/lib/srd/feat-effects";
import { toolChoiceOf } from "@/lib/srd/tool-choices";
import { useEffect, useRef, useState } from "react";
import type {
  Ability,
  AbilityScores,
  AsiChoice,
  CreateSheetInput,
  SheetAttachment,
} from "@/lib/schemas/sheet";
import { applyAsiChoices, earnedAsiCountFor, removeAsiChoices } from "@/lib/srd/asi";
import { featSpellGrants, featSpellNames } from "@/lib/srd/feat-spells";
import { innateCantripsFor } from "@/lib/srd/racial-grants";
import { withSpeciesVariant } from "@/lib/content/species-variants";
import { classListFor } from "@/lib/srd/multiclass";
import { halfFeatPicks, halfFeatPoints } from "@/lib/srd/legality/half-feats";
import { withoutFeatPicks, type FeatChoices, type FeatPicks } from "@/lib/srd/feat-grants";
import { racialFeatCount } from "@/lib/srd/race-id";
import { racialCantripsOf } from "@/lib/srd/racial-cantrips";
import { holdsFeature, reachesPrimalChampion, withoutPrimalChampion } from "@/lib/srd/trait-rules";
import type { KitChoices } from "@/lib/srd/starting-kit";
import { findOptionByFeatureName } from "@/lib/srd/options";
import {
  FIGHTING_STYLES,
  fightingStyleFeatureName,
  type FightingStyleId,
} from "@/lib/srd/feature-effects";
import { canonicalRaceId } from "@/lib/content/race-options";
import { withHeldVariant } from "@/lib/content/species-variants";
import type { AbilityMethod, AbilityState } from "./AbilityEditor";
import type { PoolEntry, PoolSlots } from "./abilityDice";
import { reconcilePicks, type BuilderPicks, type DroppedPick } from "./reconcile";
import { undoOutcome, type BuildUndo, type UndoBecause } from "./buildUndo";
import {
  builderAsiSlotLevels,
  castersOf,
  fitExtraClasses,
  fitSpellLists,
  rekeySpellLists,
  shedExtraLevels,
  splitStoredSkills,
  storedExtraClasses,
  trimSpellCounts,
  type CasterEntry,
  type ExtraClass,
  type SpellLists,
} from "./multiclassBuild";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import { keyedFeatChoices, withFeatChoice } from "@/lib/schemas/sheet";
import { textKey } from "@/lib/language/text-logic";
import { revisedSpecies } from "@/lib/srd/race-id";

// `priceCp` is the listed price of one, in copper, as the catalog row it was
// picked from gave it; it is what the purse is charged, and the server
// charges its own catalog's price again when the sheet is saved. `magic`
// marks a row the pack files as a magic item, which the purse refuses in the
// server's words. Neither is saved (submit.ts).
export type EquipmentItem = { name: string; qty: number; slug?: string; priceCp?: number; magic?: boolean };

// What the last change set aside, for the notice the wizard shows: the
// change that did it ("race") and the picks that no longer fit. Null once
// the player has seen it, or when nothing was dropped.
export type DroppedNotice = { because: string; drops: DroppedPick[] };

// Every pick a new character's draft keeps on this device (builderDraft.ts):
// the builder's own fields, without the notices and one-shot acknowledgements.
export type BuilderDraftFields = {
  name: string;
  alignment: string;
  level: number;
  raceId: string;
  classId: string;
  subclass: string;
  // The classes taken after the first (backlog F9), in the order taken;
  // empty for a single class.
  extraClasses: ExtraClass[];
  // The spell lists of each casting class but the one that leads (backlog
  // F9, phase 2), by class id; the lead's are `spells`, `bookPrepared` and
  // `cantrips` below. Empty for a single class.
  casterSpells: Record<string, SpellLists>;
  backgroundId: string;
  method: AbilityMethod;
  scores: AbilityState;
  rollPool: PoolEntry[] | null;
  rollSlots: PoolSlots<Ability>;
  chosenSkills: string[];
  expertisePicks: string[];
  stylePicks: FightingStyleId[];
  spells: string[];
  bookPrepared: string[];
  cantrips: string[];
  equipment: EquipmentItem[];
  removedAutoNames: string[];
  kitChoices: KitChoices;
  feats: string[];
  featChoices: FeatChoices;
  asiChoices: Array<AsiChoice | null>;
  bonusLanguages: string[];
  racialAsi: Array<Ability | "">;
  racialSkills: string[];
  racialCantrips: string[];
  racialTool: string;
  racialAncestry: string;
  racialVariant: string;
  racialFeatAbility: Ability | "";
  toolPicks: string[];
  repeatSkills: string[];
  backgroundSkills: string[];
  backgroundGearPicks: string[];
  optionPicks: string[];
  backstory: string;
  // The player's hopes for the story (src/lib/schemas/sheet.ts HOPES_MAX).
  hopes: string;
  gender: Gender;
  attraction: Attraction;
  appearance: string;
  portrait: SheetAttachment | null;
  gold: number;
  hpOverride: number | null;
  acOverride: number | null;
};

// Every field the character builder edits, in one hook so the wizard steps
// can share it without the orchestrator re-declaring forty useStates. The
// shape of each value is exactly what the old single-file builder held; the
// submit payload (submit.ts) reads these unchanged.
export function useBuilderState({
  initial,
  initialFeatDescs,
  initialLevel,
  fixedLevel,
  startLevel,
  races,
  classes,
  backgrounds,
}: {
  initial?: CreateSheetInput;
  // The text of the stored character's feats, by lower-case name, as
  // fetched (useFeatDescs): a content pack half-feat's point comes off the
  // stored scores below, so the scores are read back once it is known.
  initialFeatDescs?: Record<string, string>;
  // The level the stored character reached (its library row's level).
  initialLevel?: number;
  fixedLevel?: number;
  // "Level up" from the library: the stored character opens one level up,
  // and each step asks for what the new level brings. A new character
  // opens at it when the door that opened the builder knows its level
  // (door.ts), and can still change it.
  startLevel?: number;
  races: RaceOption[];
  classes: ClassOption[];
  backgrounds: BackgroundOption[];
}) {
  const { storedLevel, levelFloor } = storedLevelRange(initial, initialLevel);
  const [name, setName] = useState(initial?.name ?? "");
  const [alignment, setAlignment] = useState(initial?.alignment ?? "N");
  // A stored character opens at its own level, never at 1.
  const [level, setLevel] = useState(
    fixedLevel ?? (initial ? (startLevel ? Math.max(storedLevel, startLevel) : storedLevel) : (startLevel ?? 1)),
  );
  const [raceId, setRaceId] = useState(initial?.race ?? "");
  const [classId, setClassId] = useState(initial?.class ?? "");
  const [subclass, setSubclass] = useState(initial?.subclass ?? "");
  // A stored split comes back as it was: a split made in the library is
  // edited like any other pick (the plan's decision 4). At a table below
  // its level the last class's levels go first, as joining sheds them. The
  // skill each added class let the player pick is sorted out of the stored
  // skills once the class rows are at hand (below).
  const [extraClasses, setExtraClasses] = useState<ExtraClass[]>(() => storedExtraClasses(initial, level));
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
  // prepared; every other class leaves `bookPrepared` alone. These are the
  // lead casting class's; a split with more than one casting class keeps
  // each other one's in `casterSpells`, by class id (storedSpellLists).
  const [storedSpells] = useState(() => storedSpellLists(initial));
  const [spells, setSpells] = useState<string[]>(() => storedSpells.lead.spells);
  const [bookPrepared, setBookPrepared] = useState<string[]>(() => storedSpells.lead.bookPrepared);
  const [cantrips, setCantrips] = useState<string[]>(() => storedSpells.lead.cantrips);
  const [casterSpells, setCasterSpells] = useState<Record<string, SpellLists>>(() => storedSpells.others);
  // One casting class's lists set by the spell step: the lead's fields, or
  // its entry in casterSpells. A list may be given as a value or an update.
  function setCasterList(classId: string, key: keyof SpellLists, next: string[] | ((current: string[]) => string[])) {
    setCasterSpells((current) => {
      const lists = current[classId] ?? { spells: [], bookPrepared: [], cantrips: [] };
      const value = typeof next === "function" ? next(lists[key]) : next;
      return { ...current, [classId]: { ...lists, [key]: value } };
    });
  }
  const [equipment, setEquipment] = useState<EquipmentItem[]>(() =>
    (initial?.equipment ?? []).map((item) => ({
      name: item.name,
      qty: item.qty,
      ...(item.slug ? { slug: item.slug } : {}),
    })),
  );
  // Auto-added class weapons the user explicitly removed; reset on class change.
  const [removedAutoNames, setRemovedAutoNames] = useState<string[]>([]);
  // The either-or choices of the class's starting equipment
  // (src/lib/srd/starting-kit.ts); a stored sheet reopens with its own.
  const [kitChoices, setKitChoices] = useState<KitChoices>(() => ({
    options: initial?.kitChoices?.options ?? [],
    picks: initial?.kitChoices?.picks ?? [],
  }));
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
  // The picks a feat leaves open (Linguist's three languages, Skill Expert's
  // skill and expertise), keyed by featChoice (src/lib/srd/feat-grants.ts),
  // a stored draft's map re-keyed so. Kept for every feat ever picked here, so
  // a feat dropped and taken again finds its picks; the payload sends only
  // the feats on the sheet.
  const [featChoices, setFeatChoices] = useState<FeatChoices>(() => keyedFeatChoices(initial?.featChoices));
  function setFeatPicks(feat: string, picks: FeatPicks) {
    setFeatChoices((current) => withFeatChoice(current, feat, picks));
  }
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
  // Every cantrip the race let them pick; a sheet from before there could
  // be more than one holds its pick in `cantrip`.
  const [racialCantrips, setRacialCantrips] = useState<string[]>(() => racialCantripsOf(initial?.racialChoices));
  const [racialTool, setRacialTool] = useState(initial?.racialChoices?.tool ?? "");
  // A dragonborn's draconic ancestry ("red").
  const [racialAncestry, setRacialAncestry] = useState(initial?.racialChoices?.ancestry ?? "");
  // The option of a workshop species' choice ("ashen"), checked like the
  // other racial picks (reconcile.ts).
  const [racialVariant, setRacialVariant] = useState(initial?.racialChoices?.variant ?? "");
  // The score a variant human's half-feat raises, where the feat offers a
  // choice (Resilient, Athlete).
  const [racialFeatAbility, setRacialFeatAbility] = useState<Ability | "">(
    initial?.racialChoices?.featAbility ?? "",
  );
  // Named tools for a grant that leaves the choice open ("three musical
  // instruments"); a stored sheet's named tools come back as its picks.
  const [toolPicks, setToolPicks] = useState<string[]>(
    // The feats' own tool picks (Skilled) are not the class's or the
    // background's; FeatChoicesFields holds them.
    () =>
      (initial ? withoutFeatPicks(initial.proficiencies, initial.featChoices).tools : []).filter(
        (tool) => !toolChoiceOf(tool),
      ),
  );
  // The skill chosen in place of one the race and the background both give.
  const [repeatSkills, setRepeatSkills] = useState<string[]>([]);
  // A content-pack background's skill pick, stored the same way.
  const [backgroundSkills, setBackgroundSkills] = useState<string[]>(
    initial?.backgroundChoices?.skills ?? [],
  );
  // The alternative taken on each either-or line of the background's kit
  // ("a dagger or light hammer"), by its words (src/lib/srd/gear-choices.ts).
  const [backgroundGearPicks, setBackgroundGearPicks] = useState<string[]>(
    initial?.backgroundChoices?.gear ?? [],
  );
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
  const [hopes, setHopes] = useState(initial?.hopes ?? "");
  const [gender, setGender] = useState<Gender>(initial?.gender ?? "");
  // Who they are drawn to (issue 501), kept through an edit like the gender.
  const [attraction, setAttraction] = useState<Attraction>(() => normalizeAttraction(initial?.attraction));
  const [appearance, setAppearance] = useState(initial?.appearance ?? "");
  // An uploaded photo here means the creation routes skip the ComfyUI render
  // entirely (they only queue one when the sheet arrives without a portrait).
  // Edit mode keeps the existing portrait unless the player clears it.
  const [portrait, setPortrait] = useState<SheetAttachment | null>(initial?.portrait ?? null);
  // A stored character's own coin; a new one's purse is its background's
  // (useBuilderDerived), not a number typed here.
  const [gold, setGold] = useState(initial?.gold ?? 0);
  const [hpOverride, setHpOverride] = useState<number | null>(initial?.maxHp ?? null);
  // The level and Constitution the stored hit points (hpOverride) stand on.
  // The server keeps them only while both stand (builderHp.ts).
  const [storedHp] = useState(() => (initial ? { level: storedLevel, con: initial.abilities.con } : null));
  // Only a pinned AC comes back pinned. A derived one re-derives from the
  // gear, or saving an edit would pin it and armour changed in play would
  // stop moving it.
  const [acOverride, setAcOverride] = useState<number | null>(
    initial?.acOverride ? initial.ac : null,
  );
  const [localError, setLocalError] = useState("");
  // The picks the last change dropped, until the player dismisses the
  // notice or the next change replaces it (issue #124: reconcilePicks named
  // them and nothing showed the list).
  const [dropped, setDropped] = useState<DroppedNotice | null>(null);
  // The fields as they stood before the last class, race, subclass or level
  // change that set picks aside (backlog F12), until "Put it back", another
  // pick, or the player leaving the step (CharacterBuilder.tsx) ends it.
  const [undo, setUndo] = useState<BuildUndo | null>(null);
  const undoCount = useRef(0);
  // Kept from an event handler, before the change's own setters run: the
  // render's fields are the ones the change is about to replace.
  function keepUndo(because: UndoBecause, from: string, to: string) {
    undoCount.current += 1;
    setUndo({ id: undoCount.current, because, from, to, fields: draftFields, dropped, after: null });
  }
  const raceName = (id: string) => findRace(races, id)?.name ?? id;
  const className = (id: string) => classes.find((entry) => entry.id === id)?.name ?? id;

  // The picks that depend on an earlier choice, gathered so one call can
  // check them all against the current race, class, background and level
  // (reconcile.ts). Read from the render's values: every caller is an event
  // handler or an effect of this render.
  const picks: BuilderPicks = {
    racialVariant, chosenSkills, racialSkills, racialAsi, racialCantrips, racialTool, repeatSkills, backgroundSkills, bonusLanguages,
    subclass, expertisePicks, stylePicks, optionPicks, spells, bookPrepared, cantrips,
  };
  function applyPicks(next: BuilderPicks) {
    setRacialVariant(next.racialVariant);
    setChosenSkills(next.chosenSkills);
    setRacialSkills(next.racialSkills);
    setRepeatSkills(next.repeatSkills);
    setRacialAsi(next.racialAsi);
    setRacialCantrips(next.racialCantrips);
    setRacialTool(next.racialTool);
    setBackgroundSkills(next.backgroundSkills);
    setBonusLanguages(next.bonusLanguages);
    setSubclass(next.subclass);
    setExpertisePicks(next.expertisePicks);
    setStylePicks(next.stylePicks);
    setOptionPicks(next.optionPicks);
    setSpells(next.spells);
    setBookPrepared(next.bookPrepared);
    setCantrips(next.cantrips);
  }
  type Selection = {
    raceId: string;
    classId: string;
    backgroundId: string;
    level: number;
    extraClasses: ExtraClass[];
    casterSpells: Record<string, SpellLists>;
  };
  const selection: Selection = { raceId, classId, backgroundId, level, extraClasses, casterSpells };
  // The class list as the lists are keyed: the first class with the
  // subclass given, then each class after it.
  const casterEntriesOf = (primaryId: string, primarySubclass: string, total: number, extras: ExtraClass[]): CasterEntry[] => {
    const primary = classes.find((row) => row.id === primaryId);
    if (!primary) {
      return [];
    }
    const others = extras.reduce((sum, entry) => sum + entry.level, 0);
    return [
      { row: primary, subclass: primarySubclass, level: Math.max(1, total - others) },
      ...extras.map((entry) => ({ row: classes.find((row) => row.id === entry.classId), subclass: entry.subclass, level: entry.level })),
    ];
  };
  // The rows the builder shows for these ids. A race, class or background
  // not yet picked is none at all (CharacterBuilder.tsx does the same), so
  // the picks are checked against what is shown.
  // The classes after the first are kept valid against the first class and
  // the level before the picks are checked, since the first class's level
  // is what they leave (multiclassBuild.ts).
  // The spell lists follow their class (backlog F9, phase 2): when the class
  // that leads them changes, each class keeps its own lists, and a class no
  // longer held, or no longer casting, takes its lists with it.
  // `leadBefore` names the class the lead's fields hold now, where the
  // render's own reading of it is not the one to trust (a stored character).
  function reconciled(
    next: Partial<Selection>,
    current: BuilderPicks,
    leadBefore?: string | null,
    // A change that moves levels (the total, or between classes) trims every
    // casting class's lists to its counts at its new level. Opening a stored
    // character, or the content pack's rows arriving, never does.
    trimCounts = false,
  ): { picks: BuilderPicks; drops: DroppedPick[]; extras: ExtraClass[]; casterSpells: Record<string, SpellLists> } {
    const ids = { ...selection, ...next };
    const background = backgrounds.find((entry) => entry.id === ids.backgroundId);
    const total = fixedLevel ?? ids.level;
    const fitted = fitExtraClasses(ids.extraClasses, { primaryId: ids.classId, total });
    const before = leadBefore !== undefined ? leadBefore : castersOf(casterEntriesOf(classId, subclass, fixedLevel ?? level, extraClasses)).lead;
    const afterEntries = casterEntriesOf(ids.classId, current.subclass, total, fitted);
    const after = castersOf(afterEntries);
    const keyed = rekeySpellLists(
      { spells: current.spells, bookPrepared: current.bookPrepared, cantrips: current.cantrips },
      ids.casterSpells,
      before,
      after,
    );
    current = { ...current, ...keyed.lead };
    const result = reconcilePicks(current, {
      race: findRace(races, ids.raceId),
      klass: classes.find((entry) => entry.id === ids.classId),
      background,
      level: total,
      extras: fitted.map((entry) => ({ ...entry, klass: classes.find((row) => row.id === entry.classId) })),
    });
    let { picks } = result;
    const drops = [...result.drops];
    // A class whose row has not arrived yet (a content pack's) keeps its
    // skill pick until it does.
    const extras = fitted.map((entry, index) =>
      classes.some((row) => row.id === entry.classId) ? { ...entry, skills: result.extraSkills[index] ?? [] } : entry,
    );
    // Each other casting class's lists held to what it casts at its level.
    const casterLists = Object.fromEntries(
      Object.entries(keyed.others).map(([id, lists]) => {
        const entry = afterEntries.find((held) => held.row?.id === id);
        if (!entry) {
          return [id, lists];
        }
        const fit = fitSpellLists(lists, entry);
        drops.push(...fit.dropped.map((value) => ({ label: `${entry.row?.name ?? id} spell`, value, target: "spells" as const })));
        return [id, fit.lists];
      }),
    );
    if (trimCounts) {
      // A casting class given up takes its lists with it (rekeySpellLists);
      // they are said, so "Put it back" can return the class with them.
      const kept = new Set([after.lead, ...after.others].filter(Boolean));
      const beforeLists: Array<[string, SpellLists]> = [
        ...(before ? [[before, { spells: current.spells, bookPrepared: current.bookPrepared, cantrips: current.cantrips }] as [string, SpellLists]] : []),
        ...Object.entries(ids.casterSpells),
      ];
      for (const [id, lists] of beforeLists) {
        if (!kept.has(id)) {
          const name = classes.find((row) => row.id === id)?.name ?? id;
          drops.push(
            ...[...lists.cantrips, ...lists.spells].map((value) => ({ label: `${name} spell`, value, target: "spells" as const })),
          );
        }
      }
      // Each casting class's lists to its counts, the picks made last first
      // (multiclassBuild.ts trimSpellCounts). With several casting classes
      // each drop names its class.
      const several = Object.keys(casterLists).length > 0;
      const abilities = countAbilities(ids.raceId, picks, afterEntries);
      const label = (name: string | undefined, kind: string) => (several && name ? `${name} ${kind}` : kind);
      const leadEntry = afterEntries.find((held) => held.row?.id === after.lead);
      if (leadEntry) {
        const race = findRace(races, ids.raceId);
        const trimmed = trimSpellCounts(
          { spells: picks.spells, bookPrepared: picks.bookPrepared, cantrips: picks.cantrips },
          leadEntry,
          abilities,
          { cantrips: [...picks.racialCantrips, ...(race ? innateCantripsFor(race.id, total) : []), ...featCantrips()] },
        );
        picks = { ...picks, ...trimmed.lists };
        drops.push(...trimmed.drops.map((drop) => ({ label: label(leadEntry.row?.name, drop.kind), value: drop.value, target: "spells" as const })));
      }
      for (const [id, lists] of Object.entries(casterLists)) {
        const entry = afterEntries.find((held) => held.row?.id === id);
        if (entry) {
          const trimmed = trimSpellCounts(lists, entry, abilities);
          casterLists[id] = trimmed.lists;
          drops.push(...trimmed.drops.map((drop) => ({ label: label(entry.row?.name, drop.kind), value: drop.value, target: "spells" as const })));
        }
      }
    }
    // A stored content-pack background is not in the bundled list the
    // builder opens with; its skill pick, and the skill picked in place of
    // one it repeats, wait for the pack's rows rather than being checked
    // against no background and lost.
    if (ids.backgroundId && !background) {
      return {
        picks: { ...picks, backgroundSkills: current.backgroundSkills, repeatSkills: current.repeatSkills },
        drops: drops.filter((drop) => drop.target !== "backgroundSkills" && drop.target !== "repeatSkills"),
        extras,
        casterSpells: casterLists,
      };
    }
    return { picks, drops, extras, casterSpells: casterLists };
  }
  // The scores the counts are read from after a change: the assigned ones
  // with the race's increases and the improvements the new split has earned
  // (a half-feat's point aside). Null until all six are assigned.
  function countAbilities(raceIdNow: string, now: BuilderPicks, entries: CasterEntry[]): AbilityScores | null {
    if (Object.values(scores).some((value) => value === null)) {
      return null;
    }
    const race = findRace(races, raceIdNow);
    const shaped = race ? withSpeciesVariant(race, now.racialVariant) : undefined;
    const base = { ...(scores as Record<Ability, number>) };
    for (const [ability, bonus] of Object.entries(shaped?.asi ?? {})) {
      base[ability as Ability] += bonus ?? 0;
    }
    if (shaped?.asiChoice) {
      for (const ability of now.racialAsi) {
        if (ability) base[ability] += shaped.asiChoice.amount;
      }
    }
    const slots = builderAsiSlotLevels(entries.map((entry) => ({ id: entry.row?.id ?? "", level: entry.level }))).length;
    return applyAsiChoices(base, asiChoices.slice(0, slots));
  }
  // The cantrips the feats teach, which no class count holds.
  function featCantrips(): string[] {
    const named = [...feats, ...asiChoices.flatMap((choice) => (choice?.mode === "feat" ? [choice.feat] : []))];
    return featSpellNames(
      featSpellGrants({
        feats: named.map((name) => ({ name, desc: storedFeatDescOf(name) })),
        choices: featChoices,
        raisedAbility: () => null,
        strict: false,
      }).grants,
    ).cantrips;
  }

  // Apply what still fits and say what did not. A change the player made
  // replaces the notice, so it always describes the last change, and clears
  // it when nothing was dropped; the option rows arriving (`keep`) leave an
  // earlier notice alone unless they dropped something themselves.
  function applyReconciled(
    because: string,
    {
      picks,
      drops,
      extras,
      casterSpells: lists,
    }: { picks: BuilderPicks; drops: DroppedPick[]; extras: ExtraClass[]; casterSpells: Record<string, SpellLists> },
    keep = false,
  ) {
    applyPicks(picks);
    setExtraClasses(extras);
    setCasterSpells(lists);
    if (drops.length) {
      setDropped({ because, drops });
    } else if (!keep) {
      setDropped(null);
    }
  }
  function applyChange(because: string, next: Partial<Selection>, current: BuilderPicks) {
    applyReconciled(because, reconciled(next, current));
  }

  // Prefill pieces that need the async option lists: base ability scores
  // (final scores minus ASI picks minus racial bonuses; slightly lossy for
  // scores that hit the 20 cap), skill picks minus the background's fixed
  // skills, and bonus languages beyond the race's own. Runs again whenever
  // the option rows change (the content pack arriving after the SRD
  // fallback), because a pick that was valid against one catalog may not be
  // against the other.
  const hydratedInitial = useRef(false);
  // The rows the picks were last checked against. The check runs once per
  // set of rows: run again on the same rows (React runs a development
  // effect twice) it would read this render's picks, which are from before
  // the stored character's were applied, and wipe them.
  const checkedRows = useRef<unknown[] | null>(null);
  // The stored character's feats, and whether the text of each is at hand:
  // a content pack half-feat's point comes off the stored scores below, so
  // they are read back once it is (an unknown feat is remembered as empty,
  // so the wait ends).
  const storedFeats = [
    ...(initial?.feats ?? []),
    ...(initial?.asiChoices ?? []).flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : [])),
  ];
  const storedFeatDescOf = (feat: string) => initialFeatDescs?.[textKey(feat)] ?? authoredFeatDesc(feat) ?? "";
  const storedFeatsKnown = storedFeats.every((feat) => authoredFeatDesc(feat) || initialFeatDescs?.[textKey(feat)] !== undefined);
  useEffect(() => {
    if (!races.length || !classes.length || !backgrounds.length || !storedFeatsKnown) {
      return;
    }
    const rows = [races, classes, backgrounds];
    if (checkedRows.current && rows.every((row, index) => row === checkedRows.current![index])) {
      return;
    }
    checkedRows.current = rows;
    const ids = { ...selection };
    if (initial && !hydratedInitial.current) {
      hydratedInitial.current = true;
      // With what the stored option of the species' choice gave, as the
      // sheet records it (the workshop may since have changed the option or
      // removed it): its +1 sits in the stored scores, and its skills and
      // languages are not picks.
      const initialRace = withHeldVariant(findRace(races, ids.raceId) ?? races[0], initial.racialChoices);
      const initialBackground = backgrounds.find((entry) => entry.id === initial.background) ?? backgrounds[0];
      const withoutAsi = removeAsiChoices(initial.abilities, initial.asiChoices ?? []);
      const base: Record<Ability, number> = { ...withoutAsi };
      // A half-feat's point was added by the server when the character was
      // saved, and is added again when it is saved from here.
      for (const ability of halfFeatPoints(halfFeatPicks(initial, racialFeatCount(initial.race), storedFeatDescOf))) {
        base[ability] = Math.max(1, base[ability] - 1);
      }
      // Primal Champion's +4 too (a barbarian at 20): the builder adds it
      // back after the improvements, which would otherwise meet the cap of
      // 20 with it already in, and the server expects it sent.
      if (initialHoldsPrimalChampion(initial, initialLevel)) {
        Object.assign(base, withoutPrimalChampion(base));
      }
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
      // Skills granted by background or race are not class picks; the chosen
      // ones are restored from racialChoices and backgroundChoices instead.
      const grantedSkills = new Set([
        ...(initialBackground?.skills ?? []),
        ...(initialRace?.skills ?? []),
        ...(initial.racialChoices?.skills ?? []),
        ...(initial.backgroundChoices?.skills ?? []),
      ]);
      const initialClass = classes.find((entry) => entry.id === initial.class);
      // A class's own tongue (Druidic, Thieves' Cant) is not a pick either,
      // nor one the background names.
      const spoken = new Set([
        ...(initialRace?.languages ?? []),
        ...(initialClass?.languages ?? []),
        ...ids.extraClasses.flatMap((entry) => classes.find((row) => row.id === entry.classId)?.languages ?? []),
        ...(initialBackground?.knownLanguages ?? []),
      ]);
      // What the feats' own picks added (a Linguist's three languages,
      // Skilled's skills) is theirs, held by FeatChoicesFields: read as a
      // bonus language or a class skill it overflowed the slots and was
      // reported as no longer on offer.
      const held = withoutFeatPicks(initial.proficiencies, initial.featChoices);
      // The skills picked for each class: the first class's own, then the
      // one a class taken second let the player pick.
      const stored = splitStoredSkills(
        held.skills.filter((skill) => !grantedSkills.has(skill)),
        initialClass,
        ids.extraClasses,
      );
      // A stored pick the rows no longer offer is said so, like any other
      // drop; the gates then ask for it again on its step.
      applyReconciled(
        "stored character",
        reconciled(
          { ...ids, extraClasses: ids.extraClasses.map((entry, index) => ({ ...entry, skills: stored.extraSkills[index] ?? [] })) },
          {
            ...picks,
            chosenSkills: stored.chosen,
            expertisePicks: held.expertise ?? [],
            bonusLanguages: held.languages.filter((language) => !spoken.has(language)),
          },
          // The lead's fields hold the stored first casting class's lists.
          storedSpells.leadId,
        ),
        true,
      );
      return;
    }
    // The content pack's rows replacing the bundled ones: a pick made
    // against the bundled row that the pack's does not offer is dropped,
    // and said so.
    applyReconciled("content pack", reconciled(ids, picks), true);
    // Runs when the option rows change; the picks it reads are this render's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, storedFeatsKnown, races, classes, backgrounds]);

  // Choosing a different race throws away every race-specific pick, since
  // none of them make sense for the new one, and re-checks the rest (a class
  // skill the new race grants outright, a language it already speaks).
  // The race's own picks are cleared first, so they are not reported as
  // dropped: the new race asks for its own. The feat is the race's too.
  // Choosing the race already chosen (a second tap on its card) is no change.
  function changeRace(id: string) {
    if (id === raceId) {
      return;
    }
    if (raceId) {
      keepUndo("race", raceName(raceId), raceName(id));
    }
    setRaceId(id);
    applyChange(
      "race",
      { raceId: id },
      { ...picks, racialVariant: "", racialAsi: [], racialSkills: [], racialCantrips: [], racialTool: "", repeatSkills: [] },
    );
    setRacialAncestry("");
    // The old race's own feats lead the list (submit.ts reads the racial
    // feat as the first); they go with it. Feats granted in play, which an
    // edit carries after them, stay.
    const oldRacialFeats = racialFeatCount(raceId);
    if (oldRacialFeats > 0) {
      setFeats((current) => current.slice(oldRacialFeats));
    }
    setRacialFeatAbility("");
  }

  // The species' own choice (a Half-Dragon's ancestry). What the new option
  // gives is checked against the racial picks already made, so a +1 of the
  // player's choice on the ability it now raises is set aside, and said so.
  function chooseRacialVariant(id: string) {
    const label = findRace(races, raceId)?.variants?.label.toLowerCase() ?? "species choice";
    applyChange(label, {}, { ...picks, racialVariant: id });
  }

  // Same for the class: skills, subclass, spells, loadout edits and the
  // class option picks all belong to the old class. Choosing the class
  // already chosen keeps them all.
  function changeClass(id: string) {
    if (id === classId) {
      return;
    }
    if (classId) {
      keepUndo("class", className(classId), className(id));
    }
    setClassId(id);
    // The old class's spells go with it as the lists are keyed again
    // (reconciled); a class taken second keeps its own.
    setRemovedAutoNames([]);
    setKitChoices({ options: [], picks: [] });
    applyChange(
      "class",
      { classId: id },
      {
        ...picks,
        chosenSkills: [],
        subclass: "",
        optionPicks: [],
        stylePicks: [],
        expertisePicks: [],
      },
    );
  }

  // A background, subclass or level change keeps every pick that still
  // fits and drops the rest: an acolyte's second language under a criminal,
  // Battle Master maneuvers under a Champion, a 3rd-level spell at level 1.
  // The background's own skill pick belongs to the old background.
  function changeBackground(id: string) {
    setBackgroundId(id);
    setBackgroundGearPicks([]);
    applyChange("background", { backgroundId: id }, { ...picks, backgroundSkills: [] });
  }
  function changeSubclass(name: string) {
    if (subclass && textKey(name) !== textKey(subclass)) {
      keepUndo("subclass", subclass, name || "no subclass");
    }
    applyChange("subclass", {}, { ...picks, subclass: name });
  }
  // A level change keeps every pick that still fits, so only one that sets
  // some aside (a 3rd-level spell at level 1) is kept to put back. A lower
  // level takes its levels from the last class taken first; a higher one
  // goes to the first class.
  function changeLevel(next: number) {
    const result = reconciled(
      { level: next, ...(next < level ? { extraClasses: shedExtraLevels(extraClasses, level - next) } : {}) },
      picks,
      undefined,
      true,
    );
    if ((result.drops.length || result.extras.length !== extraClasses.length) && next !== level) {
      keepUndo("level", `level ${level}`, `level ${next}`);
    }
    setLevel(next);
    applyReconciled("level", result);
  }

  // The classes after the first (backlog F9). Each change moves levels away
  // from the first class or back to it, so every pick is checked again, and
  // one that sets picks aside is kept to put back.
  const splitWords = (list: ExtraClass[]) =>
    [className(classId), ...list.map((entry) => className(entry.classId))].join(" / ");
  function changeExtras(because: string, next: ExtraClass[]) {
    const result = reconciled({ extraClasses: next }, picks, undefined, true);
    if (result.drops.length) {
      keepUndo("class", splitWords(extraClasses), splitWords(result.extras));
    }
    applyReconciled(because, result);
  }
  // A class added takes one level from the first class.
  function addExtraClass(id: string) {
    changeExtras("class", [...extraClasses, { classId: id, subclass: "", level: 1, skills: [] }]);
  }
  function removeExtraClass(index: number) {
    changeExtras("class", extraClasses.filter((_, at) => at !== index));
  }
  function changeExtraLevel(index: number, next: number) {
    changeExtras("level", extraClasses.map((entry, at) => (at === index ? { ...entry, level: next } : entry)));
  }
  function changeExtraSubclass(index: number, name: string) {
    changeExtras("subclass", extraClasses.map((entry, at) => (at === index ? { ...entry, subclass: name } : entry)));
  }
  function changeExtraSkills(index: number, skills: string[]) {
    changeExtras("class", extraClasses.map((entry, at) => (at === index ? { ...entry, skills } : entry)));
  }
  // "Put it back": the old choice and every pick that went with it, set as
  // they were (no reconcile: they were checked against each other then),
  // with the notice that was showing before the change.
  function putBack() {
    if (!undo) {
      return;
    }
    setFields(undo.fields);
    setDropped(undo.dropped);
    setUndo(null);
  }
  function clearUndo() {
    setUndo(null);
  }
  function dismissDropped() {
    setDropped(null);
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

  // Every draft field's setter, so a draft put back (restoreDraft) and a
  // quick-build fill (applyFill) set the same fields the same way.
  const setters: { [K in keyof BuilderDraftFields]: (value: BuilderDraftFields[K]) => void } = {
    name: setName,
    alignment: setAlignment,
    level: (value) => setLevel(fixedLevel ?? value),
    raceId: setRaceId,
    classId: setClassId,
    subclass: setSubclass,
    // A draft from before F9 has none.
    extraClasses: (value) => setExtraClasses(Array.isArray(value) ? value : []),
    casterSpells: (value) => setCasterSpells(value && typeof value === "object" ? value : {}),
    backgroundId: setBackgroundId,
    method: setMethod,
    scores: setScores,
    rollPool: setRollPool,
    rollSlots: setRollSlots,
    chosenSkills: setChosenSkills,
    expertisePicks: setExpertisePicks,
    stylePicks: setStylePicks,
    spells: setSpells,
    bookPrepared: setBookPrepared,
    cantrips: setCantrips,
    equipment: setEquipment,
    removedAutoNames: setRemovedAutoNames,
    kitChoices: setKitChoices,
    feats: setFeats,
    featChoices: (value) => setFeatChoices(keyedFeatChoices(value)),
    asiChoices: setAsiChoices,
    bonusLanguages: setBonusLanguages,
    racialAsi: setRacialAsi,
    racialSkills: setRacialSkills,
    racialCantrips: setRacialCantrips,
    racialTool: setRacialTool,
    racialAncestry: setRacialAncestry,
    racialVariant: setRacialVariant,
    racialFeatAbility: setRacialFeatAbility,
    toolPicks: setToolPicks,
    repeatSkills: setRepeatSkills,
    backgroundSkills: setBackgroundSkills,
    backgroundGearPicks: setBackgroundGearPicks,
    optionPicks: setOptionPicks,
    backstory: setBackstory,
    hopes: setHopes,
    gender: setGender,
    attraction: setAttraction,
    appearance: setAppearance,
    portrait: setPortrait,
    gold: setGold,
    hpOverride: setHpOverride,
    acOverride: setAcOverride,
  };
  // A field this builder no longer keeps (an older draft's) is passed over.
  function setFields(fields: Partial<BuilderDraftFields>) {
    for (const key of Object.keys(fields) as Array<keyof BuilderDraftFields>) {
      const set = setters[key] as ((value: unknown) => void) | undefined;
      set?.(fields[key]);
    }
  }

  // Put back an unfinished character saved on this device, or the fields
  // as they were before a quick-build fill (its Undo). Every pick is set as
  // it was, without the reconcile a change runs: they were checked against
  // each other when they were made. The table's level wins over the
  // draft's.
  function restoreDraft(draft: Partial<BuilderDraftFields>) {
    setFields(draft);
    setUndo(null);
  }

  // What one round of a quick-build fill wrote (quickBuild.ts). The fill
  // writes only blank slots, so a race, class or background it picks has
  // no picks of its own yet to clear; the rest of the picks are checked
  // against the new ones, as a change by hand would be.
  function applyFill(patch: Partial<BuilderDraftFields>) {
    const ids: Partial<Selection> = {};
    if (patch.raceId !== undefined) ids.raceId = patch.raceId;
    if (patch.classId !== undefined) ids.classId = patch.classId;
    if (patch.backgroundId !== undefined) ids.backgroundId = patch.backgroundId;
    if (patch.casterSpells !== undefined) ids.casterSpells = patch.casterSpells;
    if (patch.extraClasses !== undefined) ids.extraClasses = patch.extraClasses;
    setFields(patch);
    if (Object.keys(ids).length) {
      const current = Object.fromEntries(
        Object.entries(picks).map(([key, value]) => [key, key in patch ? patch[key as keyof BuilderDraftFields] : value]),
      ) as BuilderPicks;
      applyChange("quick build", ids, current);
    }
  }
  const draftFields: BuilderDraftFields = {
    name,
    alignment,
    level,
    raceId,
    classId,
    subclass,
    extraClasses,
    casterSpells,
    backgroundId,
    method,
    scores,
    rollPool,
    rollSlots,
    chosenSkills,
    expertisePicks,
    stylePicks,
    spells,
    bookPrepared,
    cantrips,
    equipment,
    removedAutoNames,
    kitChoices,
    feats,
    featChoices,
    asiChoices,
    bonusLanguages,
    racialAsi,
    racialSkills,
    racialCantrips,
    racialTool,
    racialAncestry,
    racialVariant,
    racialFeatAbility,
    toolPicks,
    repeatSkills,
    backgroundSkills,
    backgroundGearPicks,
    optionPicks,
    backstory,
    hopes,
    gender,
    attraction,
    appearance,
    portrait,
    gold,
    hpOverride,
    acOverride,
  };
  // The undo ends with the next pick: the change's first render records the
  // fields it left, and any later difference clears it. Set while
  // rendering, React's pattern for state that follows other state.
  if (undo) {
    const outcome = undoOutcome(undo, JSON.stringify(draftFields));
    if (outcome === "record") {
      setUndo({ ...undo, after: JSON.stringify(draftFields) });
    } else if (outcome === "clear") {
      setUndo(null);
    }
  }

  return {
    draftFields,
    restoreDraft,
    applyFill,
    keepsStoredGear,
    levelFloor,
    // How many classes the stored character held when it was split, else
    // 0, and which: a split it came with stands at a table that turns
    // multiclassing off, or any part of it (the server's table door holds
    // a seated player's rebuild to the same, sheet-legality.ts classListOf).
    storedClassCount: (initial?.classes ?? []).length > 1 ? (initial?.classes ?? []).length : 0,
    storedClassIds: (initial?.classes ?? []).length > 1 ? (initial?.classes ?? []).map((entry) => entry.id) : [],
    asiRecorded,
    asiReachedLevel,
    primalChampionHeld: initialHoldsPrimalChampion(initial, initialLevel),
    // A stored character made as a 2024 species (src/lib/content/edition.ts).
    revisedSpecies: initial
      ? revisedSpecies(initial.race, (initial.features ?? []).filter((feature) => feature.source === "race").map((feature) => feature.name))
      : null,
    storedHp,
    name, setName,
    alignment, setAlignment,
    level, changeLevel,
    raceId, changeRace,
    classId, changeClass,
    subclass, changeSubclass,
    extraClasses, addExtraClass, removeExtraClass, changeExtraLevel, changeExtraSubclass, changeExtraSkills,
    casterSpells, setCasterList,
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
    kitChoices, setKitChoices,
    feats, setFeats,
    featChoices, setFeatPicks,
    asiChoices, setAsiChoices,
    bonusLanguages, setBonusLanguages,
    racialAsi, setRacialAsi,
    racialSkills, setRacialSkills,
    racialCantrips, setRacialCantrips,
    racialTool, setRacialTool,
    racialAncestry, setRacialAncestry,
    racialVariant, chooseRacialVariant,
    racialFeatAbility, setRacialFeatAbility,
    toolPicks, setToolPicks,
    repeatSkills, setRepeatSkills,
    backgroundSkills, setBackgroundSkills,
    backgroundGearPicks, setBackgroundGearPicks,
    optionPicks, setOptionPicks,
    spellWarningAck, setSpellWarningAck,
    backstory, setBackstory,
    hopes, setHopes,
    gender, setGender,
    attraction, setAttraction,
    appearance, setAppearance,
    portrait, setPortrait,
    gold, setGold,
    hpOverride, setHpOverride,
    acOverride, setAcOverride,
    localError, setLocalError,
    dropped, dismissDropped,
    undo, putBack, clearUndo,
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

// The spell lists an edit opens on, and the class whose they are: a single
// class's own lists; on a split, each casting class's own entry, the first
// (in the order the classes were taken) in the lead's fields and the rest by
// class id. The lead is keyed again once the class rows are at hand.
export function storedSpellLists(initial: CreateSheetInput | undefined): {
  lead: SpellLists;
  others: Record<string, SpellLists>;
  leadId: string | null;
} {
  const casting = initial?.spellcasting;
  const toLists = (lists: { known: string[]; prepared: string[]; cantrips?: string[]; spellbook?: string[] }): SpellLists => ({
    spells: [...new Set([...(lists.spellbook ?? []), ...lists.known, ...lists.prepared])],
    bookPrepared: lists.prepared,
    cantrips: [...new Set(lists.cantrips ?? [])],
  });
  const split = (initial?.classes ?? []).length > 1;
  if (!casting) {
    return { lead: { spells: [], bookPrepared: [], cantrips: [] }, others: {}, leadId: split ? null : (initial?.class ?? null) };
  }
  if (!split || !casting.casters?.length) {
    return { lead: toLists(casting), others: {}, leadId: split ? (initial?.classes?.[0]?.id ?? null) : (initial?.class ?? null) };
  }
  const ordered = (initial?.classes ?? []).flatMap((entry) => {
    const own = casting.casters?.find((caster) => textKey(caster.classId) === textKey(entry.id));
    return own ? [{ id: entry.id, lists: toLists(own) }] : [];
  });
  const [first, ...rest] = ordered;
  return {
    lead: first?.lists ?? toLists(casting),
    others: Object.fromEntries(rest.map((entry) => [entry.id, entry.lists])),
    leadId: first?.id ?? null,
  };
}

// A stored barbarian at 20 whose scores carry Primal Champion's +4: what the
// edit takes off on loading and puts back after the improvements.
function initialHoldsPrimalChampion(initial: CreateSheetInput | undefined, initialLevel: number | undefined): boolean {
  if (!initial) {
    return false;
  }
  const level = initialLevel ?? initial.hitDice?.total ?? 1;
  return (
    reachesPrimalChampion({ class: initial.class, classes: initial.classes, level }) &&
    holdsFeature(initial, "primal champion")
  );
}

// The level a stored character reached, and how far an edit outside a table
// may move it (issue 229). Improvements taken in play sit in its scores with
// no recorded pick to give back, so it may not go below the level it earned
// them at, each class's counted at its own level. A split between classes
// is edited like any other pick (backlog F9): a lower level comes off the
// last class taken. A new character ranges freely.
export function storedLevelRange(
  initial: CreateSheetInput | undefined,
  initialLevel: number | undefined,
): { storedLevel: number; levelFloor: number } {
  if (!initial) {
    return { storedLevel: 1, levelFloor: 1 };
  }
  const storedLevel = Math.max(1, Math.min(20, initialLevel ?? initial.hitDice?.total ?? 1));
  const earned = earnedAsiCountFor(
    classListFor({ class: initial.class, subclass: initial.subclass, level: storedLevel, classes: initial.classes }),
  );
  const takenInPlay = earned > (initial.asiChoices?.length ?? 0);
  return { storedLevel, levelFloor: takenInPlay ? storedLevel : 1 };
}
