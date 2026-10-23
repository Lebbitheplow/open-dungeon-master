// The quick-build engine: one set of rules that picks for the player when
// they ask, and only then. The quiz (QuickBuildQuiz.tsx) asks four questions
// and turns the answers into a class, a species and a background; "Fill
// what's left" and "Pick for me" hand the builder's empty slots to the same
// rules. Every pick it makes is one the builder could have made by hand,
// checked by the same gates the save runs (submit.ts), and it never touches
// a slot the player already filled.
//
// The fill runs in rounds. A round reads the builder as it stands (the
// fields and what useBuilderDerived made of them) and fills what it can
// see: the class, species and background first, then everything those
// open (skills, languages, spells, the subclass), then what the subclass
// opens. The caller re-derives between rounds and stops when a round fills
// nothing. Pure, for scripts/test-quick-build.mjs.
//
// It reuses the builder's own suggestions wherever they exist: the class's
// score order (#330, classAbilities.ts), the class skills' "Suggest the
// rest" (playstyles.ts), the spell step's starter spells, and a companion's
// improvements and spell ranking (src/lib/srd/companion-build.ts).
import { ALL_SKILLS, STANDARD_LANGUAGES } from "@/lib/content/mechanics";
import { textKey } from "@/lib/language/text-logic";
import { featChoice, withFeatChoice, type Ability, type AsiChoice } from "@/lib/schemas/sheet";
import { SRD_SKILLS } from "@/lib/srd";
import { companionImprovements, preferredSpellOrder } from "@/lib/srd/companion-build";
import { authoredFeatDesc } from "@/lib/srd/feat-effects";
import type { FeatChoices, FeatPicks, FeatGrantSpec } from "@/lib/srd/feat-grants";
import { FIGHTING_STYLES, type FightingStyleId } from "@/lib/srd/feature-effects";
import { expertiseAllowed, expertiseSlotsFor, subclassLevelFor, subclassNamesFor } from "@/lib/srd/features";
import { optionFeatureName } from "@/lib/srd/options";
import { racialFeatCount } from "@/lib/srd/race-id";
import { DRACONIC_ANCESTRIES, findDraconicAncestry, repeatedGrants, takesDraconicAncestry } from "@/lib/srd/racial-grants";
import { checklistSpellsOn, spellLevelOf } from "@/lib/srd/spell-lists";
import { classRoles, type ClassRole } from "@/lib/srd/class-roles";
import { spellClassFor } from "@/lib/classes";
import { abilityPriority, poolSlotsFor, standardFor } from "./classAbilities";
import { rollHeroName } from "./heroNames";
import { EASY_CLASSES, PLAYSTYLES, fillClassSkills, type PlaystyleId } from "./playstyles";
import { TARGET_WORDS } from "./owed";
import { spellOnSavedList } from "./spellSupply";
import { bonusLanguageCount, srdClass, type BlockerTarget } from "./submit";
import type { BuilderDerived } from "./useBuilderDerived";
import type { BackgroundOption, ClassOption, RaceOption } from "./useBuilderOptions";
import type { BuilderDraftFields } from "./useBuilderState";

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// ---- the quiz ----

// The first question's answers are the class step's playstyle picker's
// (playstyles.ts): one set of words for a job, wherever it is asked.
export type QuizRole = PlaystyleId;
export type QuizMethod = "weapons" | "magic" | "mix";
export type QuizSource = "study" | "faith" | "nature" | "born" | "bargain" | "music";
export type QuizOutside = "talk" | "explore" | "lore" | "door";
export type QuizAnswers = { role: QuizRole; method: QuizMethod; source?: QuizSource; outside: QuizOutside };

// The four questions, in the words agreed on 2026-10-15
// (brainstorms/2026-10-14-character-builder/quick-build-design.md). The DM's
// quick companion asks the first one about the party.
export const QUIZ_ROLES: ReadonlyArray<{ id: QuizRole; label: string; tag?: string; roles: ClassRole[] }> = PLAYSTYLES;
export const QUIZ_METHODS: ReadonlyArray<{ id: QuizMethod; label: string }> = [
  { id: "weapons", label: "Weapons" },
  { id: "magic", label: "Magic" },
  { id: "mix", label: "A mix" },
];
// Each source is the spell list it means; a world's or a workshop's class
// borrows one of these lists (spellClassFor).
export const QUIZ_SOURCES: ReadonlyArray<{ id: QuizSource; label: string; lists: string[] }> = [
  { id: "study", label: "Study", lists: ["wizard"] },
  { id: "faith", label: "Faith", lists: ["cleric", "paladin"] },
  { id: "nature", label: "Nature", lists: ["druid", "ranger"] },
  { id: "born", label: "Born with it", lists: ["sorcerer"] },
  { id: "bargain", label: "A bargain", lists: ["warlock"] },
  { id: "music", label: "Music and charm", lists: ["bard"] },
];
// Outside a fight: the backgrounds that fit, best first, and the skills the
// class skills lean to.
export const QUIZ_OUTSIDE: ReadonlyArray<{ id: QuizOutside; label: string; backgrounds: string[]; skills: string[] }> = [
  { id: "talk", label: "Talks their way through", backgrounds: ["charlatan", "noble", "guild_artisan", "acolyte"], skills: ["persuasion", "deception", "insight", "intimidation", "performance"] },
  { id: "explore", label: "Explores and tracks", backgrounds: ["outlander", "folk_hero", "urchin"], skills: ["survival", "perception", "stealth", "nature", "athletics", "animal_handling"] },
  { id: "lore", label: "Knows the lore", backgrounds: ["sage", "hermit", "acolyte"], skills: ["arcana", "history", "religion", "investigation", "nature", "insight"] },
  { id: "door", label: "Kicks the door in", backgrounds: ["soldier", "folk_hero", "criminal"], skills: ["athletics", "intimidation", "perception", "acrobatics"] },
];

// The quiz asks where magic comes from only of someone who answered Magic.
export function asksSource(method: QuizMethod | undefined): boolean {
  return method === "magic";
}

// One suggested character's starting points: the rest is the fill's.
export type BuildSeed = { classId: string; raceId: string; backgroundId: string };

type Offered = {
  classes: readonly ClassOption[];
  // The classes the table's setting recommends (the class picker's first
  // tier), when it has one.
  recommended?: ReadonlySet<string>;
  races: readonly RaceOption[];
  backgrounds: readonly BackgroundOption[];
};

const sameKey = (left: string, right: string) => {
  const key = (value: string) => textKey(value).replace(/[^\p{L}\p{M}]/gu, "");
  return key(left) === key(right);
};

// How well a class answers the quiz. The roles are the class's own
// (src/lib/srd/class-roles.ts); weapons or magic is its caster type; the
// source is the spell list it casts from.
function classScore(klass: ClassOption, answers: QuizAnswers, recommended?: ReadonlySet<string>): number {
  const wanted = QUIZ_ROLES.find((entry) => entry.id === answers.role)?.roles ?? [];
  const { roles } = classRoles(klass);
  // The job counts once: a class that is both Support and Control answers
  // "help the team, control the battlefield" no better than one that is
  // Support first.
  const at = roles.findIndex((role) => wanted.includes(role));
  let score = at === 0 ? 4 : at > 0 ? 3 : 0;
  const caster = klass.casterType;
  const fullMagic = caster === "full" || caster === "pact";
  const someMagic = caster === "half" || caster === "artificer";
  if (answers.method === "weapons") score += caster === "none" ? 3 : someMagic ? 1 : -3;
  if (answers.method === "magic") score += fullMagic ? 3 : someMagic ? 0 : -4;
  if (answers.method === "mix") score += someMagic ? 3 : fullMagic ? 1 : -1;
  if (answers.source && asksSource(answers.method)) {
    const lists = QUIZ_SOURCES.find((entry) => entry.id === answers.source)?.lists ?? [];
    const list = klass.spellListFrom ?? spellClassFor(klass.id);
    if (lists.includes(list)) score += 5;
  }
  if (EASY_CLASSES.has(klass.id)) score += 0.5;
  // The usual first character for the job, in the playstyle picker's order
  // (playstyles.ts): a fighter before a barbarian for the front line.
  const usual = PLAYSTYLES.find((style) => style.id === answers.role)?.first ?? [];
  if (usual.includes(klass.id)) score += 0.3 - usual.indexOf(klass.id) * 0.05;
  // Between two that answer alike: the setting's own class at a table that
  // has one, the core book's anywhere else.
  if (recommended?.size) {
    if (recommended.has(klass.id)) score += 1;
  } else if (srdClass(klass)) {
    score += 0.75;
  }
  return score;
}

// The weight each place in a class's score order carries: the first
// ability matters most, the last not at all.
const RANK_WEIGHT = [3, 2, 1, 0.4, 0.2, 0];

// How well a species' bonus fits a class: its fixed bumps on the abilities
// the class leans on, and its free bumps placed on the best of them.
export function raceFit(race: RaceOption, klass: ClassOption): number {
  const order = abilityPriority(klass);
  const weight = (ability: Ability) => RANK_WEIGHT[order.indexOf(ability)] ?? 0;
  let score = 0;
  for (const [ability, bonus] of Object.entries(race.asi)) {
    score += (bonus ?? 0) * weight(ability as Ability);
  }
  if (race.asiChoice) {
    const free = order.filter((ability) => !(race.asi[ability] ?? 0) && (!race.asiChoice?.from || race.asiChoice.from.includes(ability)));
    for (const ability of free.slice(0, race.asiChoice.count)) {
      score += race.asiChoice.amount * weight(ability);
    }
  }
  return score;
}

// A species that asks for a feat (the variant human) is a heavier first
// character; one that grants a skill the player already chose would take it
// back, so the fill passes it over.
function racePenalty(race: RaceOption, taken: ReadonlySet<string>): number {
  let penalty = racialFeatCount(race.id) > 0 ? 1.5 : 0;
  if ((race.skills ?? []).some((skill) => taken.has(skill))) penalty += 20;
  return penalty;
}

export function bestRace(
  races: readonly RaceOption[],
  klass: ClassOption,
  taken: ReadonlySet<string> = new Set(),
  skip: ReadonlySet<string> = new Set(),
): RaceOption | undefined {
  return races
    .map((race, index) => ({ race, index, score: raceFit(race, klass) - racePenalty(race, taken) }))
    .filter((entry) => !skip.has(entry.race.id))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.race;
}

// The background for an answer: the ones the answer names, matched by id or
// name (a content pack writes "folk-hero"), then any whose skills fit it.
export function bestBackground(
  backgrounds: readonly BackgroundOption[],
  outside: QuizOutside | undefined,
  klass?: ClassOption,
): BackgroundOption | undefined {
  const answer = QUIZ_OUTSIDE.find((entry) => entry.id === outside);
  for (const wanted of answer?.backgrounds ?? []) {
    const found = backgrounds.find((entry) => sameKey(entry.id, wanted) || sameKey(entry.name, wanted));
    if (found) return found;
  }
  // No answer (a fill), or none of its backgrounds on offer: the one whose
  // skills overlap the answer's, or the class's own list, the most.
  const leaning = answer?.skills ?? klass?.skillChoices.from ?? [];
  return backgrounds
    .map((entry, index) => ({ entry, index, score: entry.skills.filter((skill) => leaning.includes(skill)).length }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.entry;
}

// The suggested character and a second choice: the two classes that answer
// best, each with the species whose bonus fits it and the background the
// last answer named. Fewer than two classes on offer gives fewer seeds.
export function suggestBuilds(answers: QuizAnswers, offered: Offered): BuildSeed[] {
  const ranked = offered.classes
    .map((klass, index) => ({ klass, index, score: classScore(klass, answers, offered.recommended) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2);
  return ranked.flatMap(({ klass }) => {
    const race = bestRace(offered.races, klass);
    const background = bestBackground(offered.backgrounds, answers.outside, klass);
    return race && background ? [{ classId: klass.id, raceId: race.id, backgroundId: background.id }] : [];
  });
}

// ---- the fill ----

// One pick the engine made, as the read-back says it: what kind of pick,
// which one, and where it is made by hand ("Change" goes there).
export type FilledPick = { target: BlockerTarget; label: string; value: string };

export type FillContext = {
  fields: BuilderDraftFields;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  // What the builder offers (its pickers' rows, a table's own included).
  offered: Offered;
  // The subclasses offered for the chosen class; the bundled ones by
  // default.
  subclasses?: string[];
  // Improvement slots an edited character already took in play.
  asiTakenInPlay?: boolean[];
  // The quiz's answers, which lean the skills and the background.
  answers?: QuizAnswers;
  // The spells the spell step offers this class (useSpellPool: the content
  // pack's list, a table's own spells among them). The bundled checklist
  // stands in until it arrives.
  spellPool?: ReadonlyArray<{ name: string; level: number }>;
  // Only these slots ("Pick for me" on one card); every open slot when
  // absent.
  only?: BlockerTarget[];
  rng?: () => number;
};

export type FillRound = { patch: Partial<BuilderDraftFields>; filled: FilledPick[] };

const skillName = (id: string) => SRD_SKILLS.find((skill) => skill.id === id)?.name ?? id;
const ABILITY_WORDS: Record<Ability, string> = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
const has = (list: readonly string[], name: string) => list.some((entry) => textKey(entry) === textKey(name));

// Fills a slot-indexed list's blanks (and the slots past its end) from the
// candidates, keeping every pick already made where it is.
function fillSlots(current: readonly string[], count: number, candidates: readonly string[]): { next: string[]; added: string[] } {
  const next = Array.from({ length: Math.max(count, current.length) }, (_, index) => current[index] ?? "");
  const added: string[] = [];
  const pool = candidates.filter((entry) => !has(next.filter(Boolean), entry));
  for (let index = 0; index < count; index += 1) {
    if (next[index]) continue;
    const pick = pool.shift();
    if (!pick) break;
    next[index] = pick;
    added.push(pick);
  }
  return { next, added };
}

// The skills a pick may go to, most useful first: the quiz's lean, the
// class's own list, then the rest; never one already held.
function skillOrder(ctx: FillContext, held: ReadonlySet<string>, from: readonly string[] = ALL_SKILLS): string[] {
  const lean = QUIZ_OUTSIDE.find((entry) => entry.id === ctx.answers?.outside)?.skills ?? [];
  const ordered = [...lean, ...(ctx.klass?.skillChoices.from ?? []), ...ALL_SKILLS];
  return [...new Set(ordered)].filter((skill) => from.includes(skill) && !held.has(skill));
}

// A feat-shaped grant's open picks (a subclass's training, a feat): the
// languages, skills, expertise and tools it leaves to the player. Weapons,
// damage types and taught spells are left for the player.
function fillFeatPicks(
  spec: FeatGrantSpec,
  picks: FeatPicks | undefined,
  ctx: FillContext,
  held: { skills: Set<string>; languages: Set<string>; tools: Set<string> },
): FeatPicks | null {
  const out: FeatPicks = { ...picks };
  let changed = false;
  const top = (kind: "languages" | "skills" | "expertise" | "tools", count: number, candidates: string[]) => {
    const have = (out[kind] ?? []).filter(Boolean);
    const room = count - have.length;
    if (room <= 0) return;
    const add = candidates.filter((entry) => !has(have, entry)).slice(0, room);
    if (add.length) {
      out[kind] = [...have, ...add];
      changed = true;
    }
  };
  top("languages", spec.languages, STANDARD_LANGUAGES.filter((language) => !held.languages.has(textKey(language))));
  top("skills", spec.skills + (spec.anyKinds.includes("skills") ? spec.any : 0), skillOrder(ctx, held.skills));
  for (const skill of out.skills ?? []) held.skills.add(skill);
  top("expertise", spec.expertise, [...held.skills]);
  top("tools", spec.tools, spec.toolsFrom.filter((tool) => !held.tools.has(textKey(tool))));
  return changed ? out : null;
}

// A feat the fill may hand a variant human: one with no prerequisite and
// nothing more to pick.
const PLAIN_FEATS = ["Alert", "Tough"];

// One round of the fill: every open slot the builder can see now, filled
// once. The patch holds only fields that changed, and only blanks in them.
export function fillRound(ctx: FillContext): FillRound {
  const { fields, derived, offered } = ctx;
  const wants = (target: BlockerTarget) => !ctx.only || ctx.only.includes(target);
  const patch: Partial<BuilderDraftFields> = {};
  const filled: FilledPick[] = [];
  const note = (target: BlockerTarget, value: string, label = TARGET_WORDS[target]) => filled.push({ target, label, value });

  // The three big choices, in the order they lean on each other: the class
  // decides which species fits, the answers which background.
  let klass = ctx.klass;
  if (!klass && wants("class")) {
    klass = offered.classes.find((entry) => EASY_CLASSES.has(entry.id)) ?? offered.classes[0];
    if (klass) {
      patch.classId = klass.id;
      note("class", klass.name);
    }
  }
  if (!ctx.race && wants("race") && klass) {
    const taken = new Set([...fields.chosenSkills, ...fields.backgroundSkills, ...(ctx.background?.skills ?? [])]);
    const race = bestRace(offered.races, klass, taken);
    if (race) {
      patch.raceId = race.id;
      note("race", race.name);
    }
  }
  if (!ctx.background && wants("background")) {
    const background = bestBackground(offered.backgrounds, ctx.answers?.outside, klass);
    if (background) {
      patch.backgroundId = background.id;
      note("background", background.name);
    }
  }
  // Scores are placed by the class's order (#330) once there is a class,
  // and only when none is placed yet: the standard array, or a thrown pool.
  const noScores = Object.values(fields.scores).every((score) => score === null);
  if (noScores && klass && wants("scores")) {
    if (fields.method === "roll" && fields.rollPool?.length === 6) {
      const slots = poolSlotsFor(klass, fields.rollPool.map((entry) => entry.total));
      patch.rollSlots = slots;
      patch.scores = Object.fromEntries(
        Object.entries(slots).map(([ability, slot]) => [ability, fields.rollPool![slot].total]),
      ) as BuilderDraftFields["scores"];
    } else if (fields.method !== "pointbuy") {
      patch.method = "standard";
      patch.scores = standardFor(klass, STANDARD_ARRAY);
    } else {
      // Point buy with nothing spent: the standard array costs exactly the
      // 27-point budget, so it is a legal buy too.
      patch.scores = standardFor(klass, STANDARD_ARRAY);
    }
    const order = abilityPriority(klass);
    note("scores", `highest in ${ABILITY_WORDS[order[0]]}, then ${ABILITY_WORDS[order[1]]}`);
  }
  if (!fields.name.trim() && wants("name")) {
    const race = ctx.race ?? offered.races.find((entry) => entry.id === patch.raceId);
    if (race) {
      const name = rollHeroName({ raceId: race.id, raceName: race.name, rng: ctx.rng });
      patch.name = name;
      note("name", name);
    }
  }
  // Everything else waits for the round after the big three exist, so it
  // reads what useBuilderDerived made of them.
  if (!ctx.klass || !ctx.race || !ctx.background) {
    return { patch, filled };
  }
  const race = ctx.race;
  const background = ctx.background;
  klass = ctx.klass;

  const proficient = new Set(derived.proficientSkills);
  const languages = new Set(derived.training.languages.map((language) => textKey(language)));
  const tools = new Set((derived.training.tools ?? []).map((tool) => textKey(tool)));

  // The background's own skill pick.
  if (background.skillChoice && wants("backgroundSkills")) {
    const { next, added } = fillSlots(fields.backgroundSkills, background.skillChoice.count, skillOrder(ctx, proficient, background.skillChoice.from));
    if (added.length) {
      patch.backgroundSkills = next;
      added.forEach((skill) => proficient.add(skill));
      note("backgroundSkills", added.map(skillName).join(", "));
    }
  }

  // The species' picks.
  const languageCount = bonusLanguageCount(race, background);
  if (languageCount > 0 && wants("languages")) {
    const next = Array.from({ length: Math.max(languageCount, fields.bonusLanguages.length) }, (_, index) => fields.bonusLanguages[index] ?? "");
    const added: string[] = [];
    const spoken = new Set([...race.languages, ...(background.knownLanguages ?? []), ...next.filter(Boolean)].map((language) => textKey(language)));
    for (let index = 0; index < languageCount; index += 1) {
      if (next[index]) continue;
      const from = race.languageChoice && index < race.languageChoice.count ? race.languageChoice.from : STANDARD_LANGUAGES;
      const pick = from.find((language) => !spoken.has(textKey(language)));
      if (!pick) continue;
      next[index] = pick;
      spoken.add(textKey(pick));
      added.push(pick);
    }
    if (added.length) {
      patch.bonusLanguages = next;
      note("languages", added.join(", "));
    }
  }
  if (race.asiChoice && wants("racialAsi")) {
    const choice = race.asiChoice;
    const candidates = abilityPriority(klass).filter(
      (ability) => !(race.asi[ability] ?? 0) && (!choice.from || choice.from.includes(ability)),
    );
    const { next, added } = fillSlots(fields.racialAsi, choice.count, candidates);
    if (added.length) {
      patch.racialAsi = next as Array<Ability | "">;
      note("racialAsi", added.map((ability) => ABILITY_WORDS[ability as Ability]).join(", "));
    }
  }
  if (race.skillChoice && wants("racialSkills")) {
    const from = race.skillChoice.from?.length ? race.skillChoice.from : ALL_SKILLS;
    const { next, added } = fillSlots(fields.racialSkills, race.skillChoice.count, skillOrder(ctx, proficient, from));
    if (added.length) {
      patch.racialSkills = next;
      added.forEach((skill) => proficient.add(skill));
      note("racialSkills", added.map(skillName).join(", "));
    }
  }
  if (race.toolChoice && !fields.racialTool && wants("racialTool")) {
    const pick = race.toolChoice.from.find((tool) => !tools.has(textKey(tool)));
    if (pick) {
      patch.racialTool = pick;
      note("racialTool", pick);
    }
  }
  if (race.cantripChoice && !fields.racialCantrip && wants("racialCantrip")) {
    const known = new Set(fields.cantrips.map((name) => textKey(name)));
    const pick = preferredSpellOrder(checklistSpellsOn(race.cantripChoice.list).filter((spell) => spell.level === 0))
      .find((spell) => !known.has(textKey(spell.name)));
    if (pick) {
      patch.racialCantrip = pick.name;
      note("racialCantrip", pick.name);
    }
  }
  if (takesDraconicAncestry(race.id) && !findDraconicAncestry(fields.racialAncestry) && wants("ancestry")) {
    const pick = DRACONIC_ANCESTRIES[0];
    patch.racialAncestry = pick.id;
    note("ancestry", pick.dragon);
  }
  const racialFeats = racialFeatCount(race.id);
  if (racialFeats > fields.feats.length && wants("racialFeat")) {
    const pick = PLAIN_FEATS.find((feat) => !has(fields.feats, feat) && authoredFeatDesc(feat));
    if (pick) {
      patch.feats = [...fields.feats, pick];
      note("racialFeat", pick);
    }
  }
  const repeats = repeatedGrants(background.skills, race.skills).length;
  if (repeats && wants("repeatSkills")) {
    const { next, added } = fillSlots(fields.repeatSkills, repeats, skillOrder(ctx, proficient));
    if (added.length) {
      patch.repeatSkills = next;
      added.forEach((skill) => proficient.add(skill));
      note("repeatSkills", added.map(skillName).join(", "));
    }
  }

  // The class's picks.
  if (wants("classSkills") && srdClass(klass) && fields.chosenSkills.length < klass.skillChoices.count) {
    const lean = QUIZ_OUTSIDE.find((entry) => entry.id === ctx.answers?.outside)?.skills ?? [];
    const granted = new Set([...proficient].filter((skill) => !fields.chosenSkills.includes(skill)));
    const leaning = lean.filter((skill) => klass!.skillChoices.from.includes(skill) && !granted.has(skill) && !fields.chosenSkills.includes(skill));
    const next = fillClassSkills({
      classId: klass.id,
      from: klass.skillChoices.from,
      count: klass.skillChoices.count,
      chosen: [...fields.chosenSkills, ...leaning].slice(0, klass.skillChoices.count),
      granted,
    });
    const added = next.filter((skill) => !fields.chosenSkills.includes(skill));
    if (added.length) {
      patch.chosenSkills = next;
      added.forEach((skill) => proficient.add(skill));
      note("classSkills", added.map(skillName).join(", "));
    }
  }
  if (wants("tools")) {
    const picks = [...fields.toolPicks];
    const added: string[] = [];
    derived.toolGrants.choices.forEach((choice, index) => {
      let left = derived.toolGrants.left[index];
      for (const tool of choice.from) {
        if (left <= 0) break;
        if (tools.has(textKey(tool)) || has(picks, tool)) continue;
        picks.push(tool);
        added.push(tool);
        tools.add(textKey(tool));
        left -= 1;
      }
    });
    if (added.length) {
      patch.toolPicks = picks;
      note("tools", added.join(", "));
    }
  }
  const pickLevel = subclassLevelFor(klass.id);
  if (pickLevel !== null && derived.effectiveLevel >= pickLevel && !fields.subclass.trim() && wants("subclass")) {
    const pick = (ctx.subclasses ?? []).find(Boolean) ?? subclassNamesFor(klass.id)[0];
    if (pick) {
      patch.subclass = pick;
      note("subclass", pick);
    }
  }
  // What the subclass's training leaves open (a Lore bard's three skills).
  if (fields.subclass && wants("subclass")) {
    let featChoices: FeatChoices = fields.featChoices;
    const held = { skills: proficient, languages, tools };
    const added: string[] = [];
    for (const grant of derived.subclassTraining ?? []) {
      const picks = fillFeatPicks(grant.spec, featChoice(featChoices, grant.name), ctx, held);
      if (picks) {
        featChoices = withFeatChoice(featChoices, grant.name, picks);
        added.push(grant.name);
      }
    }
    if (added.length) {
      patch.featChoices = featChoices;
      note("subclass", added.join(", "), "Subclass training");
    }
  }
  if (derived.styleSlots > fields.stylePicks.length && wants("styles")) {
    const ranged = abilityPriority(klass)[0] === "dex";
    const order: FightingStyleId[] = [ranged ? "archery" : "defense", ranged ? "defense" : "dueling", "dueling", "protection"];
    const ids = derived.styleChoices.map((style) => style.id);
    const candidates = [...new Set([...order, ...ids])].filter((id) => ids.includes(id) && !fields.stylePicks.includes(id));
    const add = candidates.slice(0, derived.styleSlots - fields.stylePicks.length);
    if (add.length) {
      patch.stylePicks = [...fields.stylePicks, ...add];
      note("styles", add.map((id) => FIGHTING_STYLES.find((style) => style.id === id)?.name ?? id).join(", "));
    }
  }
  const expertiseSlots = expertiseSlotsFor(klass.id, derived.effectiveLevel);
  const expertiseHeld = fields.expertisePicks.filter((skill) => expertiseAllowed(skill, [...proficient], [klass!.id]));
  if (expertiseSlots > expertiseHeld.length && wants("expertise")) {
    const candidates = skillOrder(ctx, new Set(), [...proficient]).filter((skill) => !expertiseHeld.includes(skill));
    const add = candidates.slice(0, expertiseSlots - expertiseHeld.length);
    if (add.length) {
      patch.expertisePicks = [...expertiseHeld, ...add];
      note("expertise", add.map(skillName).join(", "));
    }
  }
  if (wants("options")) {
    const picks = [...fields.optionPicks];
    const added: string[] = [];
    for (const slot of derived.optionSlots) {
      const open = slot.options.filter((option) => !option.req && !slot.chosen.includes(option.n));
      for (const option of open.slice(0, slot.remaining)) {
        picks.push(optionFeatureName(slot.kind, option.n));
        added.push(option.n);
      }
    }
    if (added.length) {
      patch.optionPicks = picks;
      note("options", added.join(", "));
    }
  }

  // Improvements: the numbers, never a feat (a feat chosen for you is a
  // different character). Two points to the class's first ability with room.
  if (wants("asi") && derived.abilities) {
    const taken = ctx.asiTakenInPlay ?? derived.asiTakenInPlay;
    const open = derived.activeAsiChoices.flatMap((choice, index) => (choice === null && !taken[index] ? [index] : []));
    if (open.length) {
      const next = [...fields.asiChoices];
      let scores = { ...derived.abilities };
      const words: string[] = [];
      for (const index of open) {
        const [choice] = companionImprovements(scores, abilityPriority(klass), 1);
        if (!choice) break;
        next[index] = choice;
        scores = applyOne(scores, choice);
        words.push(`level ${derived.asiSlotLevels[index]}: ${asiWords(choice)}`);
      }
      if (words.length) {
        for (let index = 0; index < next.length; index += 1) next[index] = next[index] ?? null;
        patch.asiChoices = next;
        note("asi", words.join("; "));
      }
    }
  }

  // Spells: the spell step's own suggestions first, then the class list by
  // how glad an adventurer is to have each one.
  if (derived.casts && wants("spells")) {
    const spellPatch = fillSpells(ctx);
    if (spellPatch) {
      Object.assign(patch, spellPatch.patch);
      note("spells", spellPatch.words);
    }
  }
  return { patch, filled };
}

function applyOne(scores: Record<Ability, number>, choice: AsiChoice): Record<Ability, number> {
  const next = { ...scores };
  if (choice.mode === "plus2") next[choice.ability] += 2;
  if (choice.mode === "plus1x2") for (const ability of choice.abilities) next[ability] += 1;
  return next;
}

function asiWords(choice: AsiChoice): string {
  if (choice.mode === "plus2") return `+2 ${ABILITY_WORDS[choice.ability]}`;
  if (choice.mode === "plus1x2") return choice.abilities.map((ability) => `+1 ${ABILITY_WORDS[ability]}`).join(", ");
  return choice.feat;
}

// What a fill picks for the spell step, from the spells the save takes. The
// step's own "Fill with the suggested spells" button runs it too.
export function fillSpells(
  ctx: Pick<FillContext, "derived" | "klass" | "spellPool"> & {
    fields: Pick<BuilderDraftFields, "cantrips" | "spells" | "bookPrepared">;
  },
): { patch: Partial<BuilderDraftFields>; words: string } | null {
  const { fields, derived } = ctx;
  const free = new Set(
    [...derived.racialCantrips, ...derived.featSpells.cantrips, ...derived.subclassSpells].map((name) => textKey(name)),
  );
  const starters = derived.starters;
  // A third caster (an Eldritch Knight: a class that casts nothing, given
  // spells by its subclass) keeps to its own two schools, so it takes only
  // its starters, which are chosen from them.
  const third = ctx.klass?.casterType === "none";
  const listed = third || !derived.spellSearchClass
    ? []
    : ctx.spellPool?.length
      ? [...ctx.spellPool]
      : checklistSpellsOn(derived.spellSearchClass);
  const levelOf = new Map(listed.map((spell) => [textKey(spell.name), spell.level]));
  const ordered = (names: string[], cantrip: boolean) => {
    const fromList = preferredSpellOrder(
      listed.filter((spell) => (cantrip ? spell.level === 0 : spell.level >= 1 && spell.level <= derived.maxSpellLevel)),
    ).map((spell) => spell.name);
    // A starter the server's list does not carry for this class would be
    // refused at the save, so only the ones on it.
    const onList = (name: string) =>
      spellOnSavedList(name, { third, spellClass: derived.spellSearchClass, spellPool: ctx.spellPool });
    return [...new Set([...names.filter(onList), ...fromList])].filter((name) => !free.has(textKey(name)));
  };
  const words: string[] = [];
  const patch: Partial<BuilderDraftFields> = {};

  const cantripRoom = (derived.cantripAdvice ?? 0) - derived.chosenCantrips.length;
  if (cantripRoom > 0) {
    const add = ordered((starters?.cantrips ?? []).map((entry) => entry.n), true)
      .filter((name) => !has(fields.cantrips, name))
      .slice(0, cantripRoom);
    if (add.length) {
      patch.cantrips = [...fields.cantrips, ...add];
      words.push(...add);
    }
  }
  const starterSpells = (starters?.spells ?? [])
    .map((entry) => entry.n)
    .filter((name) => (spellLevelOf(name) ?? 1) <= derived.maxSpellLevel);
  const wizard = derived.spellbookAdvice !== null;
  const listRoom = wizard ? derived.spellbookAdvice! - derived.chosenSpells.length : (derived.spellAdvice?.count ?? 0) - derived.chosenPrepared.length;
  let spells = fields.spells;
  if (listRoom > 0 && derived.maxSpellLevel > 0) {
    const add = spreadByLevel(ordered(starterSpells, false).filter((name) => !has(spells, name)), listRoom, levelOf, starterSpells);
    if (add.length) {
      spells = [...spells, ...add];
      patch.spells = spells;
      words.push(...add);
    }
  }
  if (wizard && derived.spellAdvice) {
    const book = spells.filter((name) => !free.has(textKey(name)));
    const prepared = fields.bookPrepared.filter((name) => has(book, name));
    const room = Math.min(derived.spellAdvice.count, book.length) - prepared.length;
    if (room > 0) {
      const add = book.filter((name) => !has(prepared, name)).slice(0, room);
      patch.bookPrepared = [...fields.bookPrepared, ...add];
      if (!words.length) words.push(`${add.length} prepared from the spellbook`);
    }
  }
  return Object.keys(patch).length ? { patch, words: words.join(", ") } : null;
}

// A list of spells that covers every slot level: the starters first, then
// one of each level in turn, so a level 9 wizard's book is not all 1st level.
function spreadByLevel(names: string[], room: number, levelOf: Map<string, number>, first: string[]): string[] {
  const out = names.filter((name) => has(first, name)).slice(0, room);
  const byLevel = new Map<number, string[]>();
  for (const name of names) {
    if (has(out, name)) continue;
    const level = levelOf.get(textKey(name)) ?? spellLevelOf(name) ?? 1;
    byLevel.set(level, [...(byLevel.get(level) ?? []), name]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => b - a);
  let added = true;
  while (out.length < room && added) {
    added = false;
    for (const level of levels) {
      const next = byLevel.get(level)?.shift();
      if (next && out.length < room) {
        out.push(next);
        added = true;
      }
    }
  }
  return out;
}

// The rounds a fill may take: the big three, what they open, what the
// subclass opens, and a spare.
export const FILL_ROUNDS = 6;

// The fields a fill wrote: those that differ between the builder before it
// began and as it finished. Each was blank before.
export function changedFields(before: BuilderDraftFields, after: BuilderDraftFields): Array<keyof BuilderDraftFields> {
  return (Object.keys(after) as Array<keyof BuilderDraftFields>).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

// What the read-back's Undo puts back: each field the fill wrote, as it was
// before the fill, but only while it still holds what the fill wrote. The
// panel can be reopened long after the fill, and a pick the player has
// changed since is theirs, so Undo leaves it alone. Right after a fill this
// is every field the fill wrote.
export function undoFill(
  before: BuilderDraftFields,
  after: BuilderDraftFields,
  now: BuilderDraftFields,
): Partial<BuilderDraftFields> {
  const undo: Partial<BuilderDraftFields> = {};
  for (const key of changedFields(before, after)) {
    if (JSON.stringify(now[key]) === JSON.stringify(after[key])) {
      (undo as Record<string, unknown>)[key] = before[key];
    }
  }
  return undo;
}
