import { rollHeroName } from "@/app/characters/builder/heroNames";
import type { PlaystyleId } from "@/app/characters/builder/playstyles";
import {
  FILL_ROUNDS,
  bestBackground,
  bestRace,
  fillRound,
  suggestBuilds,
  type QuizAnswers,
  type QuizOutside,
} from "@/app/characters/builder/quickBuild";
import { buildBuilderResult, validateBuilder } from "@/app/characters/builder/submit";
import { deriveBuilder } from "@/app/characters/builder/useBuilderDerived";
import type { BuilderDraftFields, BuilderState } from "@/app/characters/builder/useBuilderState";
import {
  srdBackgroundOptions,
  srdClassOptions,
  srdRaceOptions,
  type BackgroundOption,
  type ClassOption,
  type RaceOption,
} from "@/lib/characters/options";
import { normalizeAttraction } from "@/lib/attraction";
import { settingClassIds } from "@/lib/classes";
import { textKey } from "@/lib/language/text-logic";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { draftNotes, roleWords, type DraftOptionNames, type HeroProposal } from "@/lib/dm/pregen-draft-logic";

// The AI DM's proposed heroes built into sheets by the quick-build engine
// (src/app/characters/builder/quickBuild.ts): the same rounds "Build one for
// me" runs in the wizard, each reading what useBuilderDerived makes of the
// fields (deriveBuilder, the hook run once outside a render), checked by the
// builder's own save check (submit.ts). The model only names a class, a race
// and a background; anything it names that the builder does not offer
// falls back to the closest option that is, and the hero's notes say so.
// Every sheet still goes through the library's door (admitSheet) before
// anything is stored: see src/app/api/workshops/[workshopId]/pregens/draft.
//
// Built at any level 1 to 20: the builder's own level rules give a higher
// draft its hit points, features, subclass and improvements.

export type DraftOffered = {
  classes: readonly ClassOption[];
  races: readonly RaceOption[];
  backgrounds: readonly BackgroundOption[];
};

// What the library builder offers by default: ODM's bundled classes,
// species and backgrounds, the classes cut to the ones the adventure's
// setting takes (settingClassIds, the rule every place that drafts a class
// follows: a netrunner is not drafted for a high fantasy keep, and a world
// pack's own class list wins over its genre's). A custom setting, or none,
// takes the whole catalog.
export function draftOffered(genre?: Genre, packClassIds: string[] = []): DraftOffered {
  const all = srdClassOptions();
  const setting = new Set(genre ? settingClassIds(genre, packClassIds) : []);
  const classes = setting.size ? all.filter((entry) => setting.has(entry.id)) : all;
  return { classes: classes.length ? classes : all, races: srdRaceOptions(), backgrounds: srdBackgroundOptions() };
}

export function draftOptionNames(offered: DraftOffered): DraftOptionNames {
  return {
    classes: offered.classes.map((entry) => entry.name),
    races: offered.races.map((entry) => entry.name),
    backgrounds: offered.backgrounds.map((entry) => entry.name),
  };
}

export type BuiltDraft = {
  proposal: HeroProposal;
  level: number;
  sheet: CreateSheetInput;
  // What the engine changed from the proposal, in words for the DM.
  changes: string[];
};

export type DraftBuild = { ok: true; draft: BuiltDraft } | { ok: false; error: string };

const letters = (value: string) => textKey(value).replace(/[^\p{L}\p{M}]/gu, "");
const words = (value: string) => textKey(value).split(/[^\p{L}\p{M}]+/u).filter((word) => word.length > 2);

type Named = { id: string; name: string };

// The option the model named, by its whole name or id ("Half-Elf",
// "half_elf"), else null.
function named<T extends Named>(list: readonly T[], wanted: string): T | null {
  const key = letters(wanted);
  return key ? (list.find((entry) => letters(entry.id) === key || letters(entry.name) === key) ?? null) : null;
}

// The nearest option by shared words: "Wood Elf" where only "High Elf" is
// offered, "Battle Cleric" for the Cleric. The first such option wins.
function nearest<T extends Named>(list: readonly T[], wanted: string): T | null {
  const asked = new Set(words(wanted));
  let best: T | null = null;
  let score = 0;
  for (const entry of list) {
    const shared = words(entry.name).filter((word) => asked.has(word)).length;
    if (shared > score) {
      best = entry;
      score = shared;
    }
  }
  return best;
}

// Whether an option's name holds every word the model wrote.
function covers(name: string, wanted: string): boolean {
  const have = new Set(words(name));
  const asked = words(wanted);
  return asked.length > 0 && asked.every((word) => have.has(word));
}

// The quiz answers a role stands for: its job, weapons or magic, and the
// life outside a fight that leans its skills.
const ROLE_ANSWERS: Record<PlaystyleId, Omit<QuizAnswers, "role">> = {
  tank: { method: "weapons", outside: "door" },
  dps: { method: "weapons", outside: "door" },
  healer: { method: "magic", outside: "lore" },
  support: { method: "magic", outside: "lore" },
  utility: { method: "weapons", outside: "explore" },
};

function answersFor(role: PlaystyleId | null): QuizAnswers {
  const job = role ?? "dps";
  return { role: job, ...ROLE_ANSWERS[job] };
}

const EMPTY_SCORES = { str: null, dex: null, con: null, int: null, wis: null, cha: null };

function freshFields(proposal: HeroProposal, level: number, ids: { classId: string; raceId: string; backgroundId: string }): BuilderDraftFields {
  return {
    name: proposal.name,
    alignment: "N",
    level,
    raceId: ids.raceId,
    classId: ids.classId,
    subclass: "",
    backgroundId: ids.backgroundId,
    method: "standard",
    scores: EMPTY_SCORES,
    rollPool: null,
    rollSlots: EMPTY_SCORES,
    chosenSkills: [],
    expertisePicks: [],
    stylePicks: [],
    spells: [],
    bookPrepared: [],
    cantrips: [],
    equipment: [],
    removedAutoNames: [],
    kitChoices: { options: [], picks: [] },
    feats: [],
    featChoices: {},
    asiChoices: [],
    bonusLanguages: [],
    racialAsi: [],
    racialSkills: [],
    racialCantrips: [],
    racialTool: "",
    racialAncestry: "",
    racialVariant: "",
    racialFeatAbility: "",
    toolPicks: [],
    repeatSkills: [],
    backgroundSkills: [],
    backgroundGearPicks: [],
    optionPicks: [],
    backstory: proposal.backstory,
    gender: "",
    attraction: normalizeAttraction(undefined),
    appearance: "",
    portrait: null,
    gold: 0,
    hpOverride: null,
    acOverride: null,
  };
}

// The builder's state as a fresh wizard holds it: these fields, no stored
// character behind them. Only the values are read; nothing calls a setter.
function asState(fields: BuilderDraftFields): BuilderState {
  return {
    ...fields,
    draftFields: fields,
    spellWarningAck: false,
    keepsStoredGear: false,
    asiRecorded: 0,
    asiReachedLevel: 0,
    primalChampionHeld: false,
    revisedSpecies: null,
    storedHp: null,
    levelFloor: 1,
    levelLocked: false,
  } as unknown as BuilderState;
}

// One sheet from these choices, filled round by round as the wizard does,
// or the save check's refusal.
function fill(
  proposal: HeroProposal,
  level: number,
  offered: DraftOffered,
  ids: { classId: string; raceId: string; backgroundId: string },
  rng: () => number,
): { sheet: CreateSheetInput; level: number } | { refused: string } {
  let fields = freshFields(proposal, level, ids);
  const pick = () => ({
    race: offered.races.find((entry) => entry.id === fields.raceId),
    klass: offered.classes.find((entry) => entry.id === fields.classId),
    background: offered.backgrounds.find((entry) => entry.id === fields.backgroundId),
  });
  const answers = answersFor(proposal.role);
  for (let round = 0; round < FILL_ROUNDS + 1; round += 1) {
    const chosen = pick();
    const derived = deriveBuilder({ state: asState(fields), ...chosen });
    const step = fillRound({ fields, derived, ...chosen, offered, answers, rng });
    if (!step.filled.length) {
      break;
    }
    fields = { ...fields, ...step.patch };
  }
  const chosen = pick();
  const state = asState(fields);
  const derived = deriveBuilder({ state, ...chosen });
  const input = { state, derived, ...chosen };
  const blocker = validateBuilder(input);
  if (blocker) {
    return { refused: blocker.message };
  }
  return buildBuilderResult(input);
}

// The class, race and background the engine builds for a proposal, each the
// one the model named when it is offered, else the closest that is, with a
// line saying what changed.
export function resolveChoices(proposal: HeroProposal, offered: DraftOffered): {
  ids: { classId: string; raceId: string; backgroundId: string };
  changes: string[];
} {
  const changes: string[] = [];
  const who = proposal.name;
  const answers = answersFor(proposal.role);

  let klass = named(offered.classes, proposal.className);
  if (!klass) {
    const seed = suggestBuilds(answers, offered)[0];
    klass = nearest(offered.classes, proposal.className) ?? offered.classes.find((entry) => entry.id === seed?.classId) ?? offered.classes[0];
    const because = proposal.role ? `the closest class offered for a hero who ${roleWords(proposal.role)}` : "the closest class offered";
    changes.push(`${proposal.className} is not a class the builder offers, so ${who} is a ${klass.name}, ${because}.`);
  }
  let race = named(offered.races, proposal.race);
  if (!race) {
    const near = nearest(offered.races, proposal.race);
    race = near ?? bestRace(offered.races, klass) ?? offered.races[0];
    // "Halfling" where the builder offers "Halfling (Lightfoot)": the race
    // named, in the form the builder offers it.
    changes.push(
      near && covers(near.name, proposal.race)
        ? `${who} is a ${race.name}, the builder's form of ${proposal.race}.`
        : `${proposal.race} is not a race the builder offers, so ${who} is a ${race.name}, the closest one offered.`,
    );
  }
  let background = named(offered.backgrounds, proposal.background);
  if (!background) {
    const outside: QuizOutside | undefined = answers.outside;
    background = nearest(offered.backgrounds, proposal.background) ?? bestBackground(offered.backgrounds, outside, klass) ?? offered.backgrounds[0];
    changes.push(`${proposal.background} is not a background the builder offers, so ${who} has the ${background.name} background instead.`);
  }
  return { ids: { classId: klass.id, raceId: race.id, backgroundId: background.id }, changes };
}

// One proposal built into a sheet at this level. A combination the save
// check refuses is tried once more with the race and background the engine
// would pick for that class, then as the next class the quiz suggests for
// the hero's job. One that still fails is the caller's to report.
export function buildDraft(
  proposal: HeroProposal,
  level: number,
  offered: DraftOffered = draftOffered(),
  rng: () => number = Math.random,
): DraftBuild {
  const hero = proposal.name.trim() ? proposal : { ...proposal, name: rollHeroName({ raceName: proposal.race, rng }) };
  const { ids, changes } = resolveChoices(hero, offered);
  let built = fill(hero, level, offered, ids, rng);
  if ("refused" in built) {
    const klass = offered.classes.find((entry) => entry.id === ids.classId);
    const race = klass ? bestRace(offered.races, klass) : undefined;
    const background = bestBackground(offered.backgrounds, answersFor(hero.role).outside, klass);
    if (race && background && (race.id !== ids.raceId || background.id !== ids.backgroundId)) {
      const retry = fill(hero, level, offered, { ...ids, raceId: race.id, backgroundId: background.id }, rng);
      if (!("refused" in retry)) {
        changes.push(`The builder could not finish ${hero.name} as a ${raceNameOf(offered, ids.raceId)} with that background, so they are a ${race.name} ${background.name}.`);
        built = retry;
      }
    }
  }
  // A class the engine cannot finish at this level (an artificer's late
  // infusions, which it leaves to the player): the next class the quiz
  // would suggest for the hero's job, as the quiz suggests it.
  if ("refused" in built) {
    const className = offered.classes.find((entry) => entry.id === ids.classId)?.name ?? ids.classId;
    for (const seed of suggestBuilds(answersFor(hero.role), offered).filter((entry) => entry.classId !== ids.classId)) {
      const retry = fill(hero, level, offered, seed, rng);
      if (!("refused" in retry)) {
        const instead = offered.classes.find((entry) => entry.id === seed.classId)?.name ?? seed.classId;
        changes.push(`The builder cannot finish a level ${level} ${className} on its own, so ${hero.name} is a ${raceNameOf(offered, seed.raceId)} ${instead} instead.`);
        built = retry;
        break;
      }
    }
  }
  if ("refused" in built) {
    return { ok: false, error: `${hero.name} could not be built within the rules: ${built.refused}` };
  }
  const sheet: CreateSheetInput = { ...built.sheet, notes: draftNotes(hero, changes) };
  return { ok: true, draft: { proposal: hero, level: built.level, sheet, changes } };
}

function raceNameOf(offered: DraftOffered, raceId: string): string {
  return offered.races.find((entry) => entry.id === raceId)?.name ?? raceId;
}
