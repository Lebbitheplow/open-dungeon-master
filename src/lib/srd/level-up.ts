// A level-up, built by the server from the player's CHOICES.
//
// The request names what the rules leave to the player: the class taking
// the level, the Ability Score Improvement (or the feat in its place) when
// the class's level grants one, the subclass at the class's subclass level,
// expertise when the feature grants it, the picks a class feature opens
// (a fighting style, an invocation), and the new spells. Everything else
// the level brings is derived: hit points by the table's method, hit dice,
// features, slots, counters. Nothing else in the request is applied: not
// current or temporary hit points, conditions, experience, coin, gear,
// armor class, features or scores as free values.
//
// One level at a time, and only a level the character's experience has
// reached. Spent slots, spent counters and damage taken are kept: current
// hit points rise by what the level adds and no more.
//
// Pure: the single-class and the multiclass level-up are this one function,
// and scripts/test-sheet-legality.mjs can drive it without a database.
import type {
  AbilityScores,
  AsiChoice,
  CharacterSheet,
  FullPatchSheetInput,
  PatchSheetInput,
  Proficiencies,
  SheetFeature,
  Spellcasting,
} from "@/lib/schemas/sheet";
import { ABILITIES } from "@/lib/schemas/sheet";
import { XP_THRESHOLDS, findSkill, levelForXp } from "@/lib/srd";
import { ABILITY_SCORE_CAP, applyAsiChoices, earnedAsiCountFor } from "@/lib/srd/asi";
import { asiTaken, withAsiLedger } from "@/lib/srd/asi-ledger";
import { applyFeatIncrease, featSaveProficiency } from "@/lib/srd/feat-effects";
import { applyFeatGrants, featGrantSpec } from "@/lib/srd/feat-grants";
import { elementalAdeptFeatureName } from "@/lib/srd/feat-combat";
import { featSpellGrants, freeCastFeatures, withFeatSpells } from "@/lib/srd/feat-spells";
import {
  bundledSubclassName,
  expertiseAllowed,
  expertiseSlotsFor,
  populateFeaturesForClasses,
  subclassLevelFor,
} from "@/lib/srd/features";
import {
  fixedDieValue,
  hpBonusPerLevelFor,
  levelHpGain,
  retroactiveHp,
  type HpMethod,
} from "@/lib/srd/hit-points";
import { settleSlots } from "@/lib/srd/level-change";
import { levelUpSpells, type SpellPicks } from "@/lib/srd/level-up-spells";
import {
  canMulticlassInto,
  classListFor,
  multiclassGrantsFor,
} from "@/lib/srd/multiclass";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import { casterViewsOf, dedupeNames, withCasterViews, type CasterView } from "@/lib/srd/spell-prep";
import { isThirdCaster } from "@/lib/srd/third-caster";
import { featureHitPoints, holdsFeature, withPrimalChampion } from "@/lib/srd/trait-rules";
import { isChoiceFeature, unmetPrerequisite } from "@/lib/srd/legality/features";
import { castingClassesOf } from "@/lib/srd/legality/spells";
import {
  ABILITY_NAMES,
  lower,
  type ClassGrants,
  type FeatFacts,
  type SpellFacts,
} from "@/lib/srd/legality/types";

export type LevelUpContext = {
  hpMethod: HpMethod;
  // Whether the table lets a NEW class be taken.
  multiclassAllowed: boolean;
  classOf: (classId: string) => ClassGrants | null;
  // Cantrips the character's race gives on top of its class's.
  racialCantrips: number;
  spellOf: (name: string) => SpellFacts | null;
  featOf: (name: string) => FeatFacts | null;
  subclassOffered: (classId: string, name: string) => boolean;
  rollDie: (sides: number) => number;
};

// The choices, beside the fields of the player's patch that carry them.
export type LevelUpRequest = PatchSheetInput & {
  asiChoices?: AsiChoice[];
  // Under the "rolled" method a player may still take the fixed value.
  hpChoice?: "roll" | "average";
  levelUpForget?: string;
};

export type LevelUpResult =
  | {
      patch: FullPatchSheetInput;
      // What the server rolled for hit points, when it rolled.
      rolled?: { hp: number };
      hpGained: number;
    }
  | { error: string; status?: number };

const refuse = (error: string, status = 400): LevelUpResult => ({ error, status });

type AbilityScoresKey = keyof AbilityScores;

// The improvements a request asks for. A client that sends choices is read
// as written; one that sends finished scores and a feat list (the dialog
// before the choices existed) is read for the improvements those amount to.
function improvementsAsked(
  sheet: CharacterSheet,
  request: LevelUpRequest,
): { choices: AsiChoice[] } | { error: string } {
  if (request.asiChoices?.length) {
    return { choices: request.asiChoices };
  }
  const choices: AsiChoice[] = [];
  const held = new Set(sheet.feats.map(lower));
  for (const feat of dedupeNames(request.feats ?? [])) {
    if (!held.has(lower(feat))) {
      choices.push({ mode: "feat", feat });
    }
  }
  if (request.abilities) {
    const raised: Array<keyof AbilityScores> = [];
    for (const ability of ABILITIES) {
      const delta = request.abilities[ability] - sheet.abilities[ability];
      if (delta < 0) {
        return {
          error: `An Ability Score Improvement raises scores; it cannot lower ${ABILITY_NAMES[ability]} from ${sheet.abilities[ability]} to ${request.abilities[ability]}.`,
        };
      }
      if (request.abilities[ability] > ABILITY_SCORE_CAP && delta > 0) {
        return {
          error: `An Ability Score Improvement cannot raise ${ABILITY_NAMES[ability]} above ${ABILITY_SCORE_CAP}.`,
        };
      }
      for (let point = 0; point < delta; point += 1) {
        raised.push(ability);
      }
    }
    // Two points to an improvement: both on one score, or one on each of two.
    for (let index = 0; index < raised.length; index += 2) {
      const first = raised[index];
      const second = raised[index + 1];
      if (second === undefined || second === first) {
        choices.push(
          second === undefined
            ? { mode: "plus1x2", abilities: [first, first] }
            : { mode: "plus2", ability: first },
        );
      } else {
        choices.push({ mode: "plus1x2", abilities: [first, second] });
      }
    }
  }
  return { choices };
}

// A choice as the points it adds, a lone odd point included (the old shape
// can ask for +1 to a single score).
export function applyChoices(scores: AbilityScores, choices: AsiChoice[]): AbilityScores {
  const next = { ...scores };
  for (const choice of choices) {
    if (choice.mode === "plus1x2" && choice.abilities[0] === choice.abilities[1]) {
      next[choice.abilities[0]] = Math.min(ABILITY_SCORE_CAP, next[choice.abilities[0]] + 1);
    } else {
      Object.assign(next, applyAsiChoices(next, [choice]));
    }
  }
  return next;
}

function emptyView(classId: string, ability: CasterView["ability"], style: CasterView["style"]): CasterView {
  return {
    classId,
    ability,
    level: 0,
    subclass: "",
    style,
    known: [],
    prepared: [],
    cantrips: [],
    pending: [],
    spellbook: [],
  };
}

export function buildLevelUp(
  sheet: CharacterSheet,
  request: LevelUpRequest,
  context: LevelUpContext,
): LevelUpResult {
  // ---- may this character level at all, and to this level ----
  if (sheet.deathSaves?.dead) {
    return refuse(`${sheet.name} is dead, and the dead gain no levels.`, 409);
  }
  if (sheet.currentHp <= 0) {
    return refuse(
      `${sheet.name} is at 0 hit points. A character levels up once they are back on their feet.`,
      409,
    );
  }
  const target = request.level ?? sheet.level + 1;
  if (target > 20) {
    return refuse("No character passes level 20.");
  }
  if (target !== sheet.level + 1) {
    return refuse(
      `A character gains one level at a time: ${sheet.name} is level ${sheet.level}, so the next level is ${sheet.level + 1}. Take the levels one after another.`,
    );
  }
  const reached = levelForXp(sheet.xp);
  if (reached < target) {
    return refuse(
      `Level ${target} takes ${XP_THRESHOLDS[target - 1]} experience points and ${sheet.name} has ${sheet.xp}. A level is earned in play, or granted by whoever runs the table.`,
      403,
    );
  }

  // ---- the class taking the level ----
  const before = classListFor(sheet).map((entry) => ({ ...entry }));
  const classId = (request.levelUpClass ?? "").trim().toLowerCase() || before[0].id.toLowerCase();
  const klass = context.classOf(classId);
  if (!klass) {
    return refuse(`Unknown class "${classId}".`);
  }
  const classes = before.map((entry) => ({ ...entry }));
  let leveled = classes.find((entry) => entry.id.toLowerCase() === classId);
  const isNewClass = !leveled;
  if (!leveled) {
    if (!context.multiclassAllowed) {
      return refuse(
        "Multiclassing is turned off for this campaign (a lobby setting the owner controls).",
        403,
      );
    }
    const check = canMulticlassInto(sheet, classId);
    if (!check.ok) {
      return refuse(check.error ?? "Cannot multiclass into that class.");
    }
    leveled = { id: klass.id, subclass: "", level: 0 };
    classes.push(leveled);
  }
  leveled.level += 1;
  const multiclass = classes.length > 1;

  // ---- the subclass ----
  const wantedSubclass = (request.subclass ?? "").trim();
  if (wantedSubclass && lower(wantedSubclass) !== lower(leveled.subclass)) {
    if (leveled.subclass) {
      return refuse(
        `${sheet.name} is a ${leveled.subclass}; a subclass is chosen once and later levels build on it.`,
      );
    }
    const pickLevel = subclassLevelFor(klass.id);
    if (pickLevel !== null && leveled.level < pickLevel) {
      return refuse(
        `A ${klass.name} chooses a subclass at ${klass.name} level ${pickLevel}; this is level ${leveled.level}.`,
      );
    }
    if (!context.subclassOffered(klass.id, wantedSubclass)) {
      return refuse(`${wantedSubclass} is not a subclass of the ${klass.name}; pick one from that class's list.`);
    }
    leveled.subclass = bundledSubclassName(klass.id, wantedSubclass) ?? wantedSubclass;
  }

  // ---- improvements and feats ----
  const asked = improvementsAsked(sheet, request);
  if ("error" in asked) {
    return refuse(asked.error);
  }
  const taken = asiTaken(sheet);
  const owed = Math.max(0, earnedAsiCountFor(classes) - taken);
  if (asked.choices.length > owed) {
    return refuse(
      owed
        ? `This level gives ${sheet.name} ${owed} Ability Score Improvement${owed === 1 ? "" : "s"}: two points, or one feat, each. The request asks for ${asked.choices.length}.`
        : `${klass.name} level ${leveled.level} gives no Ability Score Improvement, so ability scores and feats stay as they are. Improvements come at the class's own levels.`,
    );
  }
  let abilities = applyChoices(sheet.abilities, asked.choices);
  const feats = [...sheet.feats];
  // A half-feat's point (Actor's Charisma, Resilient's chosen score) and
  // Resilient's saving throw come with the feat.
  const featSaves: AbilityScoresKey[] = [];
  const casts = castingClassesOf(classes, context.classOf).length > 0;
  for (const choice of asked.choices) {
    if (choice.mode !== "feat") {
      continue;
    }
    if (feats.some((feat) => lower(feat) === lower(choice.feat))) {
      return refuse(`${sheet.name} already has ${choice.feat}; a feat is taken once.`);
    }
    const facts = context.featOf(choice.feat);
    if (!facts) {
      return refuse(`"${choice.feat}" is not a feat this table offers; pick one from the feat list.`);
    }
    const unmet = unmetPrerequisite(facts.prerequisite, {
      abilities,
      armor: sheet.proficiencies.armor,
      casts,
      raceId: sheet.race,
      raceName: sheet.race,
      skills: sheet.proficiencies.skills,
      tools: sheet.proficiencies.tools,
      weapons: sheet.proficiencies.weapons,
      level: target,
    });
    if (unmet) {
      return refuse(`${facts.name} requires ${unmet}, which ${sheet.name} does not have.`);
    }
    feats.push(facts.name);
    const raised = applyFeatIncrease(abilities, facts.name, choice.ability ?? null, facts.desc);
    if ("error" in raised) {
      return refuse(raised.error);
    }
    abilities = raised.abilities;
    const save = featSaveProficiency(facts.name, raised.raised, facts.desc);
    if (save) {
      featSaves.push(save);
    }
  }

  // Primal Champion (barbarian 20): +4 Strength and Constitution, to a
  // maximum of 24. Applied before the hit points, since the Constitution
  // counts for every level held.
  const primalChampion =
    lower(leveled.id) === "barbarian" &&
    leveled.level === 20 &&
    !holdsFeature(sheet, "primal champion");
  if (primalChampion) {
    abilities = withPrimalChampion(abilities);
  }

  // ---- hit points ----
  const hpClasses = before.map((entry) => ({
    die: context.classOf(entry.id)?.hitDie ?? Number(sheet.hitDice.die.slice(1)),
    level: entry.level,
  }));
  const dwarf = hpBonusPerLevel(sheet.race) > 0;
  const bonusBefore = hpBonusPerLevelFor(dwarf, sheet.feats, sheet.campaignId);
  const bonusAfter = hpBonusPerLevelFor(dwarf, feats, sheet.campaignId);
  const rolls = context.hpMethod === "rolled" && request.hpChoice !== "average";
  const face = rolls
    ? Math.max(1, Math.min(klass.hitDie, context.rollDie(klass.hitDie)))
    : context.hpMethod === "max"
      ? klass.hitDie
      : fixedDieValue(klass.hitDie);
  const gain = levelHpGain(face, abilities.con, bonusAfter);
  // A Constitution that rose, or Tough, counts for the levels already held.
  const backPay = retroactiveHp(
    hpClasses,
    { con: sheet.abilities.con, perLevelBonus: bonusBefore },
    { con: abilities.con, perLevelBonus: bonusAfter },
  );
  // Draconic Resilience: one more hit point for each sorcerer level, the
  // ones already held included when the bloodline is taken now.
  const featureHp =
    featureHitPoints({ ...sheet, classes, class: classes[0].id, level: target }) -
    featureHitPoints(sheet);
  const hpGained = gain + Math.max(0, backPay) + Math.max(0, featureHp);
  const maxHp = Math.max(1, Math.min(500, sheet.maxHp + gain + backPay + featureHp));
  const currentHp = Math.min(maxHp, sheet.currentHp + hpGained);

  // ---- training and expertise ----
  let proficiencies: Proficiencies = featSaves.length
    ? { ...sheet.proficiencies, saves: [...new Set([...sheet.proficiencies.saves, ...featSaves])] }
    : sheet.proficiencies;
  const union = (current: string[], more: string[]) => [
    ...current,
    ...more.filter((entry) => !current.some((held) => lower(held) === lower(entry))),
  ];
  if (isNewClass) {
    const grants = multiclassGrantsFor(klass.id);
    proficiencies = {
      ...proficiencies,
      armor: union(proficiencies.armor, grants.armor),
      weapons: union(proficiencies.weapons, grants.weapons),
      tools: union(proficiencies.tools, grants.tools),
    };
    // The one skill some grants offer. A pick off the grant's list is not
    // taken; the level still is.
    const skillPick = (request.levelUpSkill ?? "").trim().toLowerCase();
    if (skillPick && grants.skillChoice) {
      const allowed = !grants.skillChoice.from.length || grants.skillChoice.from.includes(skillPick);
      if (findSkill(skillPick) && allowed && !proficiencies.skills.includes(skillPick)) {
        proficiencies = { ...proficiencies, skills: [...proficiencies.skills, skillPick] };
      }
    }
  }
  // What the feats taken with this level grant beyond their point
  // (src/lib/srd/feat-grants.ts): Linguist's three languages, Heavily
  // Armored's armor. Every pick the feat leaves open is named in the
  // request, or the level is refused with what is still to pick.
  const featsTaken = asked.choices.flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : []));
  if (featsTaken.length) {
    const granted = applyFeatGrants({
      proficiencies,
      feats: featsTaken.map((name) => {
        const facts = context.featOf(name);
        return { name: facts?.name ?? name, desc: facts?.desc ?? "" };
      }),
      choices: request.featChoices ?? {},
      strict: true,
    });
    if (granted.problems.length) {
      return refuse(granted.problems[0]);
    }
    proficiencies = granted.proficiencies;
  }
  // And the spells they teach (src/lib/srd/feat-spells.ts): every pick
  // named in the request, held to the feat's list, school and level.
  const raisedThisLevel = new Map(
    asked.choices.flatMap((choice) => (choice.mode === "feat" ? [[lower(choice.feat), choice.ability ?? null] as const] : [])),
  );
  const taught = featSpellGrants({
    feats: featsTaken.map((name) => {
      const facts = context.featOf(name);
      return { name: facts?.name ?? name, desc: facts?.desc ?? "" };
    }),
    choices: request.featChoices ?? {},
    raisedAbility: (feat) => raisedThisLevel.get(lower(feat)) ?? null,
    spellOf: context.spellOf,
    strict: true,
  });
  if (taught.problems.length) {
    return refuse(taught.problems[0]);
  }
  if (request.expertise) {
    const held = proficiencies.expertise ?? [];
    const picks = dedupeNames(request.expertise.map(lower)).filter((skill) => !held.includes(skill));
    const slots = classes.reduce((sum, entry) => sum + expertiseSlotsFor(entry.id, entry.level), 0);
    if (picks.length > Math.max(0, slots - held.length)) {
      return refuse(
        slots
          ? `${sheet.name} has earned expertise in ${slots} skills and holds ${held.length}; ${picks.length} more cannot be picked.`
          : "Expertise is a rogue's feature (1st and 6th level) and a bard's (3rd and 10th); this character has none to pick.",
      );
    }
    const unproficient = picks.filter((skill) => !expertiseAllowed(skill, proficiencies.skills, classes.map((entry) => entry.id)));
    if (unproficient.length) {
      return refuse(
        `Expertise doubles a proficiency the character has; ${unproficient.join(", ")} ${unproficient.length === 1 ? "is" : "are"} not among ${sheet.name}'s skills.`,
      );
    }
    proficiencies = { ...proficiencies, expertise: [...held, ...picks] };
  }


  // ---- features ----
  // The sheet's own features, and of the request's only the picks a class
  // feature opens; the regrant keeps as many of those as the classes have
  // slots for, the ones already held first.
  const heldNames = new Set(sheet.features.map((feature) => lower(feature.name)));
  const picked: SheetFeature[] = (request.features ?? [])
    .filter(
      (feature) =>
        feature.source === "choice" &&
        isChoiceFeature(feature.name) &&
        !heldNames.has(lower(feature.name)),
    )
    .map((feature) => ({ name: feature.name, source: "choice" as const }));
  const elementPicks = featsTaken.flatMap((name) => {
    const spec = featGrantSpec(context.featOf(name)?.desc ?? "");
    const picked = lower(request.featChoices?.[lower(name)]?.damageType ?? "");
    return spec.damageTypes.length && spec.damageTypes.includes(picked) ? [elementalAdeptFeatureName(picked)] : [];
  });
  const freeCasts = [...freeCastFeatures(taught.grants), ...elementPicks].map((name) => ({ name: name.slice(0, 80), source: "story" as const }));
  let features = populateFeaturesForClasses([...sheet.features, ...picked, ...freeCasts], classes, sheet.race, feats);
  const takenAfter = taken + asked.choices.length;
  if (target >= 4 || takenAfter > 0) {
    features = withAsiLedger(features, takenAfter);
  }

  // ---- spells ----
  const casting = castingClassesOf(classes, context.classOf);
  const mine = casting.find((entry) => entry.entry.id.toLowerCase() === classId);
  let spellcasting: Spellcasting = sheet.spellcasting;
  if (casting.length && (mine || sheet.spellcasting)) {
    // The lists as the sheet holds them. A sheet with no per-class entries
    // keeps one list, and it belongs to the first of its classes that casts.
    const owner = castingClassesOf(before, context.classOf)[0]?.entry;
    const views = (sheet.spellcasting ? casterViewsOf(sheet) : [])
      .map((view) =>
        sheet.spellcasting?.casters?.length || !owner
          ? view
          : { ...view, classId: owner.id, level: owner.level, subclass: owner.subclass },
      )
      .filter((view) =>
        casting.some((entry) => lower(entry.entry.id) === lower(view.classId)),
      );
    let shaped: NonNullable<Spellcasting> = sheet.spellcasting ?? {
      ability: casting[0].ability,
      slots: {},
      prepared: [],
      known: [],
      cantrips: [],
    };
    let nextViews = views;
    if (mine) {
      const held =
        views.find((view) => view.classId.toLowerCase() === classId) ??
        emptyView(
          klass.id,
          mine.ability,
          isThirdCaster(klass.id, leveled.subclass) ? "known" : emptyStyle(klass.id),
        );
      const picks: SpellPicks | null = request.levelUpSpells?.length || request.levelUpForget
        ? { kind: "picks", spells: request.levelUpSpells ?? [], forget: request.levelUpForget }
        : request.spellcasting && !multiclass
          ? { kind: "lists", lists: request.spellcasting }
          : null;
      const learned = levelUpSpells({
        before: { ...held, ability: mine.ability, level: leveled.level - 1, subclass: leveled.subclass },
        level: leveled.level,
        subclass: leveled.subclass,
        list: mine.list,
        firstLevel: leveled.level === 1 || !views.some((view) => view.classId.toLowerCase() === classId),
        abilities,
        freeCantrips: context.racialCantrips,
        spellOf: context.spellOf,
        picks,
      });
      if ("error" in learned) {
        return refuse(learned.error);
      }
      nextViews = views.some((view) => view.classId.toLowerCase() === classId)
        ? views.map((view) => (view.classId.toLowerCase() === classId ? learned.view : view))
        : [...views, learned.view];
    }
    if (multiclass) {
      // Each caster class keeps its own lists; the top-level ones mirror
      // their union for every reader that predates the per-class entries.
      shaped = {
        ...shaped,
        casters: nextViews.map((view) => ({
          classId: view.classId,
          ability: casting.find((entry) => lower(entry.entry.id) === lower(view.classId))?.ability ?? view.ability,
          known: view.known,
          prepared: view.prepared,
          cantrips: view.cantrips,
          ...(view.pending.length ? { pending: view.pending } : {}),
          ...(view.style === "spellbook" || view.spellbook.length ? { spellbook: view.spellbook } : {}),
        })),
      };
    }
    const written = nextViews.length ? withCasterViews(shaped, nextViews) : shaped;
    spellcasting = settleSlots(
      {
        class: classes[0].id,
        subclass: classes[0].subclass,
        race: sheet.race,
        level: target,
        xp: sheet.xp,
        classes: multiclass ? classes : [],
        features,
        hitDice: sheet.hitDice,
        hitDicePools: sheet.hitDicePools,
        spellcasting: { ...written, ability: casting[0].ability },
        loneClassBefore: sheet.classes.length ? null : sheet.class,
      },
      classes,
    );
  }

  // The feat's spells join the lists, on top of the class's own; a
  // character with no Spellcasting gets a slotless block for them.
  spellcasting = withFeatSpells(spellcasting, taught.grants);
  const patch: FullPatchSheetInput = {
    maxHp,
    currentHp,
    proficiencies,
    features,
    ...(asked.choices.length || primalChampion ? { abilities, feats } : {}),
    ...(spellcasting !== sheet.spellcasting ? { spellcasting } : {}),
    ...(multiclass ? { classes } : { level: target, subclass: classes[0].subclass }),
  };
  return { patch, hpGained, ...(rolls ? { rolled: { hp: face } } : {}) };
}

function emptyStyle(classId: string): CasterView["style"] {
  return casterViewsOf({
    class: classId,
    subclass: "",
    level: 1,
    classes: [],
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    spellcasting: { ability: "int", slots: {}, prepared: [], known: [], cantrips: [] },
  })[0].style;
}
