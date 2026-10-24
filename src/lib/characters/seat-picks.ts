// The choices a hero owes when it takes a seat, picked on the confirm sheet
// before it seats (backlog F6's follow-up, JoinConfirmDialog.tsx): the
// subclass its level is due, the Ability Score Improvements (or feats) the
// level earned and nobody offered, the class skills and the expertise left
// open. Without a pick here they stay owed, as before, and the first
// level-up at the table offers them (src/lib/srd/owed-choices.ts).
//
// The rules are the level-up's (src/lib/srd/level-up.ts buildLevelUp), held
// to the same pieces: a subclass the table offers and the class is due, a
// feat it knows and whose prerequisite the hero meets, its picks and a
// subclass's training named in full, expertise in a skill the hero has.
// The sheet these picks make then goes through the stored door
// (src/lib/characters/admit.ts), the door a library character takes into
// play, which writes everything derived from them and checks the sheet once
// more. The join and its preview both come here
// (src/lib/characters/seat-preview.ts), so the sheet a player confirms is
// the sheet that seats.
//
// Pure: the table's catalog is handed in.
import { z } from "zod";
import {
  asiChoiceSchema,
  featChoicesSchema,
  featChoice,
  type AbilityScores,
  type AsiChoice,
  type ClassEntry,
  type CreateSheetInput,
  type Proficiencies,
} from "@/lib/schemas/sheet";
import { SRD_CLASSES, findClass } from "@/lib/srd";
import { asiLevelsFor, earnedAsiCountFor } from "@/lib/srd/asi";
import { asiTaken, withAsiLedger } from "@/lib/srd/asi-ledger";
import { applyFeatIncrease, featSaveProficiency } from "@/lib/srd/feat-effects";
import { applyFeatGrants, type FeatChoices } from "@/lib/srd/feat-grants";
import { featSpellGrants } from "@/lib/srd/feat-spells";
import { hpBonusPerLevelFor, retroactiveHp } from "@/lib/srd/hit-points";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import { featureHitPoints } from "@/lib/srd/trait-rules";
import { bundledSubclassName, expertiseAllowed, expertiseSlotsFor, subclassLevelFor, THIEVES_TOOLS } from "@/lib/srd/features";
import { applyChoices } from "@/lib/srd/level-up";
import { castingClassesOf } from "@/lib/srd/legality/spells";
import { unmetPrerequisite } from "@/lib/srd/legality/features";
import type { ClassGrants, FeatFacts, SpellFacts } from "@/lib/srd/legality/types";
import { classListFor } from "@/lib/srd/multiclass";
import { subclassOwed } from "@/lib/srd/owed-choices";
import { applySubclassTraining, grantsForHeldTraining, subclassGrants } from "@/lib/srd/subclass-training";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import { textKey } from "@/lib/language/text-logic";

// What the confirm sheet sends beside the hero. Every field may be left
// out: what is not picked stays owed.
export const seatPicksSchema = z.object({
  // The subclass for each class that is due one, by class id.
  subclasses: z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80)).optional(),
  asiChoices: z.array(asiChoiceSchema).max(7).optional(),
  // A feat's picks (Linguist's languages) and a subclass's training (a Lore
  // bard's skills), keyed by the feat's or the feature's name.
  featChoices: featChoicesSchema.optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  expertise: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
});
export type SeatPicks = z.infer<typeof seatPicksSchema>;

export type SeatPicksContext = {
  classOf: (classId: string) => ClassGrants | null;
  featOf: (name: string) => FeatFacts | null;
  spellOf: (name: string) => SpellFacts | null;
  subclassOffered: (classId: string, name: string) => boolean;
  // Every subclass the table offers the class, for the picker.
  subclassesOf: (classId: string) => string[];
  subclassExtras?: SubclassExtras;
  // The table, for a workshop feat that runs as Tough (its hit points).
  campaignId?: string;
};

// What the confirm sheet offers to pick, read off the seated sheet.
export type OwedPicks = {
  subclasses: Array<{ classId: string; className: string; classLevel: number; dueAt: number; options: string[] }>;
  asi: number;
  // The class levels that earned them, for the picker's headings.
  asiLevels: number[];
  skills: { count: number; options: string[] };
  expertise: { count: number; options: string[] };
  // The scores and training the pickers start from.
  scores: AbilityScores;
  known: Pick<Proficiencies, "armor" | "languages" | "skills" | "weapons" | "tools"> & { expertise: string[] };
};

export function hasSeatPicks(picks: SeatPicks | null | undefined): picks is SeatPicks {
  return Boolean(
    picks &&
      (Object.keys(picks.subclasses ?? {}).length ||
        picks.asiChoices?.length ||
        picks.skills?.length ||
        picks.expertise?.length),
  );
}

const classesOf = (sheet: CreateSheetInput, level: number): ClassEntry[] =>
  classListFor({ class: sheet.class, subclass: sheet.subclass, classes: sheet.classes, level }).map((entry) => ({ ...entry }));

// The first class's skill picks left: its list, less what the hero holds.
function skillsLeft(sheet: CreateSheetInput, classes: ClassEntry[]): { count: number; options: string[] } {
  const first = SRD_CLASSES.find((entry) => entry.id === (classes[0]?.id ?? sheet.class));
  if (!first?.skillChoices?.count) {
    return { count: 0, options: [] };
  }
  const held = new Set(sheet.proficiencies.skills.map(textKey));
  const offered = first.skillChoices.from;
  const count = Math.max(0, first.skillChoices.count - offered.filter((id) => held.has(textKey(id))).length);
  return { count, options: count ? offered.filter((id) => !held.has(textKey(id))) : [] };
}

function expertiseLeft(skills: string[], held: string[], tools: string[], classes: ClassEntry[]): { count: number; options: string[] } {
  const slots = classes.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0);
  const ids = classes.map((entry) => entry.id);
  const candidates = [...skills, ...(tools.some((tool) => textKey(tool) === textKey(THIEVES_TOOLS)) ? [THIEVES_TOOLS] : [])];
  const options = candidates.filter((pick) => expertiseAllowed(pick, skills, ids) && !held.includes(pick));
  return { count: Math.min(Math.max(0, slots - held.length), options.length), options };
}

// What a seated hero still owes, as the pickers need it; null when nothing.
export function owedPicksOf(seated: CreateSheetInput, level: number, context: Pick<SeatPicksContext, "subclassesOf">): OwedPicks | null {
  const classes = classesOf(seated, level);
  const subclasses = classes
    .filter((entry) => subclassOwed(entry, entry.level))
    .map((entry) => ({
      classId: entry.id,
      className: findClass(entry.id)?.name ?? entry.id,
      classLevel: entry.level,
      dueAt: subclassLevelFor(entry.id) ?? entry.level,
      options: context.subclassesOf(entry.id),
    }))
    .filter((entry) => entry.options.length > 0);
  const asi = Math.max(0, earnedAsiCountFor(classes) - asiTaken({ level, features: seated.features ?? [] }));
  const asiLevels = classes
    .flatMap((entry) => asiLevelsFor(entry.id).filter((at) => at <= entry.level))
    .sort((a, b) => a - b)
    .slice(-asi);
  while (asi && asiLevels.length < asi) {
    asiLevels.unshift(asiLevels[0] ?? level);
  }
  const skills = skillsLeft(seated, classes);
  const held = seated.proficiencies.expertise ?? [];
  const expertise = expertiseLeft(seated.proficiencies.skills, held, seated.proficiencies.tools, classes);
  if (!subclasses.length && !asi && !skills.count && !expertise.count) {
    return null;
  }
  return {
    subclasses,
    asi,
    asiLevels: asi ? asiLevels : [],
    skills,
    expertise,
    scores: seated.abilities,
    known: {
      armor: seated.proficiencies.armor,
      languages: seated.proficiencies.languages,
      skills: seated.proficiencies.skills,
      expertise: held,
      weapons: seated.proficiencies.weapons,
      tools: seated.proficiencies.tools,
    },
  };
}

export type PicksApplied = { ok: true; sheet: CreateSheetInput } | { ok: false; problems: string[] };

// The hit points the picks add for the levels the hero already holds, as a
// level-up pays them back (src/lib/srd/level-up.ts): a Constitution raised
// here, a feat that adds hit points per level (Tough), a subclass that does
// (Draconic Resilience). The stored door derives them again at a table that
// takes the average or the maximum, but keeps a rolled table's hit points
// while they are in range, so they are added here.
function maxHpWithPicks(
  seated: CreateSheetInput,
  level: number,
  before: ClassEntry[],
  after: ClassEntry[],
  abilities: AbilityScores,
  feats: string[],
  context: Pick<SeatPicksContext, "classOf" | "campaignId">,
): number {
  // A class the table cannot name counts a d8, as the stored door counts it.
  const hpClasses = before.map((entry) => ({ die: context.classOf(entry.id)?.hitDie ?? 8, level: entry.level }));
  const dwarf = hpBonusPerLevel(seated.race) > 0;
  const backPay = retroactiveHp(
    hpClasses,
    { con: seated.abilities.con, perLevelBonus: hpBonusPerLevelFor(dwarf, seated.feats ?? [], context.campaignId) },
    { con: abilities.con, perLevelBonus: hpBonusPerLevelFor(dwarf, feats, context.campaignId) },
  );
  // Every class is in the list, its subclass with it, so the feature reads
  // the subclass there.
  const traits = (classes: ClassEntry[]) => ({ class: seated.class, level, classes, features: seated.features ?? [] });
  const featureHp = featureHitPoints(traits(after)) - featureHitPoints(traits(before));
  return Math.max(1, Math.min(500, seated.maxHp + backPay + featureHp));
}

// The seated sheet with the picks made, or what is wrong with them. The
// sheet still goes through the stored door after this (seat-preview.ts).
export function applySeatPicks(
  seated: CreateSheetInput,
  level: number,
  picks: SeatPicks,
  context: SeatPicksContext,
): PicksApplied {
  const problems: string[] = [];
  const name = seated.name;
  const before = classesOf(seated, level);
  const classes = before.map((entry) => ({ ...entry }));
  const choices: FeatChoices = picks.featChoices ?? {};

  // ---- subclasses ----
  for (const [classId, wanted] of Object.entries(picks.subclasses ?? {})) {
    const entry = classes.find((held) => textKey(held.id) === textKey(classId));
    const className = context.classOf(classId)?.name ?? findClass(classId)?.name ?? classId;
    if (!entry) {
      problems.push(`${name} has no ${className} levels to choose a subclass for.`);
      continue;
    }
    if (!subclassOwed(entry, entry.level)) {
      problems.push(
        entry.subclass
          ? `${name} is a ${entry.subclass}; a subclass is chosen once and later levels build on it.`
          : `A ${className} chooses a subclass at ${className} level ${subclassLevelFor(entry.id)}; ${name} plays ${className} ${entry.level} here.`,
      );
      continue;
    }
    if (!context.subclassOffered(entry.id, wanted)) {
      problems.push(`${wanted} is not a subclass of the ${className}; pick one from that class's list.`);
      continue;
    }
    entry.subclass = bundledSubclassName(entry.id, wanted) ?? wanted;
  }

  // ---- what a subclass picked here trains its hero in ----
  let proficiencies: Proficiencies = { ...seated.proficiencies };
  const trainedBefore = new Set(subclassGrants(before, context.subclassExtras).map((grant) => `${grant.classId}|${textKey(grant.name)}`));
  const freshTraining = grantsForHeldTraining(
    subclassGrants(classes, context.subclassExtras).filter((grant) => !trainedBefore.has(`${grant.classId}|${textKey(grant.name)}`)),
    proficiencies,
  );
  if (freshTraining.length) {
    const trained = applySubclassTraining({ proficiencies, grants: freshTraining, choices, strict: true, abilities: seated.abilities });
    problems.push(...trained.problems);
    proficiencies = trained.proficiencies;
  }

  // ---- class skills ----
  const skillPicks = [...new Set((picks.skills ?? []).map((skill) => skill.trim().toLowerCase()))];
  if (skillPicks.length) {
    const left = skillsLeft({ ...seated, proficiencies }, classes);
    const off = skillPicks.filter((skill) => !left.options.includes(skill));
    if (off.length) {
      problems.push(`${off.join(", ")} ${off.length === 1 ? "is not a skill" : "are not skills"} ${name}'s class still offers.`);
    } else if (skillPicks.length > left.count) {
      problems.push(`${name}'s class offers ${left.count} more skill${left.count === 1 ? "" : "s"}; ${skillPicks.length} were picked.`);
    } else {
      proficiencies = { ...proficiencies, skills: [...proficiencies.skills, ...skillPicks] };
    }
  }

  // ---- improvements and feats ----
  const asked: AsiChoice[] = picks.asiChoices ?? [];
  const taken = asiTaken({ level, features: seated.features ?? [] });
  const owed = Math.max(0, earnedAsiCountFor(classes) - taken);
  let abilities = seated.abilities;
  const feats = [...(seated.feats ?? [])];
  const recorded: AsiChoice[] = [];
  const featsTaken: string[] = [];
  const featSaves: Array<keyof AbilityScores> = [];
  // The score each half-feat raised, for the spells it teaches.
  const raisedBy = new Map<string, keyof AbilityScores | null>();
  if (asked.length > owed) {
    problems.push(
      owed
        ? `${name} is owed ${owed} Ability Score Improvement${owed === 1 ? "" : "s"}: two points, or one feat, each. ${asked.length} were picked.`
        : `${name} is owed no Ability Score Improvement at this table's level.`,
    );
  } else if (asked.length) {
    abilities = applyChoices(abilities, asked);
    const casts = castingClassesOf(classes, context.classOf, context.subclassExtras, seated.spellcasting).length > 0;
    for (const choice of asked) {
      if (choice.mode !== "feat") {
        recorded.push(choice);
        continue;
      }
      if (feats.some((feat) => textKey(feat) === textKey(choice.feat))) {
        problems.push(`${name} already has ${choice.feat}; a feat is taken once.`);
        continue;
      }
      const facts = context.featOf(choice.feat);
      if (!facts) {
        problems.push(`"${choice.feat}" is not a feat this table offers; pick one from the feat list.`);
        continue;
      }
      const unmet = unmetPrerequisite(facts.prerequisite, {
        abilities,
        armor: proficiencies.armor,
        casts,
        raceId: seated.race,
        raceName: seated.race,
        skills: proficiencies.skills,
        tools: proficiencies.tools,
        weapons: proficiencies.weapons,
        level,
      });
      if (unmet) {
        problems.push(`${facts.name} requires ${unmet}, which ${name} does not have.`);
        continue;
      }
      const raised = applyFeatIncrease(abilities, facts.name, choice.ability ?? null, facts.desc);
      if ("error" in raised) {
        problems.push(raised.error);
        continue;
      }
      abilities = raised.abilities;
      raisedBy.set(textKey(facts.name), raised.raised);
      const save = featSaveProficiency(facts.name, raised.raised, facts.desc);
      if (save) {
        featSaves.push(save);
      }
      feats.push(facts.name);
      featsTaken.push(facts.name);
      recorded.push({ ...choice, feat: facts.name });
    }
  }
  if (featsTaken.length) {
    const described = featsTaken.map((feat) => ({ name: feat, desc: context.featOf(feat)?.desc ?? "" }));
    const granted = applyFeatGrants({ proficiencies, feats: described, choices, strict: true });
    problems.push(...granted.problems);
    proficiencies = granted.proficiencies;
    // The spells a feat teaches (Magic Initiate's) are named in full here;
    // the stored door writes them into the lists from featChoices.
    const taught = featSpellGrants({
      feats: described,
      choices,
      raisedAbility: (feat) => raisedBy.get(textKey(feat)) ?? null,
      spellOf: context.spellOf,
      strict: true,
    });
    problems.push(...taught.problems);
  }
  if (featSaves.length) {
    proficiencies = { ...proficiencies, saves: [...new Set([...proficiencies.saves, ...featSaves])] };
  }

  // ---- expertise ----
  const expertisePicks = [...new Set((picks.expertise ?? []).map((pick) => pick.trim().toLowerCase()))];
  if (expertisePicks.length) {
    const held = proficiencies.expertise ?? [];
    const left = expertiseLeft(proficiencies.skills, held, proficiencies.tools, classes);
    const off = expertisePicks.filter((pick) => !left.options.includes(pick));
    if (off.length) {
      problems.push(
        `Expertise doubles a proficiency the character has; ${off.join(", ")} ${off.length === 1 ? "is" : "are"} not among ${name}'s skills.`,
      );
    } else if (expertisePicks.length > left.count) {
      problems.push(`${name} has expertise in ${left.count} more proficienc${left.count === 1 ? "y" : "ies"} to pick; ${expertisePicks.length} were picked.`);
    } else {
      proficiencies = { ...proficiencies, expertise: [...held, ...expertisePicks] };
    }
  }

  if (problems.length) {
    return { ok: false, problems: [...new Set(problems)] };
  }

  // The picks applied, recorded beside the ones the sheet already keeps, as
  // the level-up records them (issue #430).
  const kept = Object.fromEntries(
    [...featsTaken, ...freshTraining.map((grant) => grant.name)].flatMap((pick) => {
      const made = featChoice(choices, pick);
      return made ? [[textKey(pick), made] as const] : [];
    }),
  );
  const multiclass = classes.length > 1;
  const features = recorded.length
    ? withAsiLedger(seated.features ?? [], taken + recorded.length)
    : (seated.features ?? []);
  return {
    ok: true,
    sheet: {
      ...seated,
      subclass: classes[0].subclass ?? "",
      classes: multiclass ? classes : seated.classes,
      maxHp: maxHpWithPicks(seated, level, before, classes, abilities, feats, context),
      abilities,
      feats,
      features,
      asiChoices: [...(seated.asiChoices ?? []), ...recorded],
      proficiencies,
      ...(Object.keys(kept).length ? { featChoices: { ...(seated.featChoices ?? {}), ...kept } } : {}),
    },
  };
}
