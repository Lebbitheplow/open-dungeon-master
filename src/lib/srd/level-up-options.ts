// What a character's next level offers, read out for a player's agent: the
// odm_level_up_options tool (src/lib/agents/workbench.ts) answers from here,
// and odm_level_up sends the choices back to the same PATCH the level-up
// dialog sends (src/app/api/campaigns/[campaignId]/sheet/route.ts).
//
// The dialog works this out on the page as the player clicks; an agent has
// no page, so without this it could only learn what a level owes from the
// server's refusals one at a time, and a level taken without its picks
// leaves them owed (src/lib/srd/owed-choices.ts). Every count comes from the
// pieces the dialog and src/lib/srd/level-up.ts already share; nothing here
// decides what is allowed, the level-up does.
//
// Pure: the route supplies the table's settings and its subclass list.
import {
  casterPreview,
  expertiseOpen,
  levelUpHpPreview,
} from "@/app/campaigns/[campaignId]/level-up-preview";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { ALL_CLASSES, SRD_SKILLS, XP_THRESHOLDS, findClass, levelForXp } from "@/lib/srd";
import { asiOwed } from "@/lib/srd/asi-ledger";
import {
  FIGHTING_STYLES,
  chosenFightingStyles,
  fightingStyleFeatureName,
  fightingStyleSlots,
} from "@/lib/srd/feature-effects";
import { featPicksOwed } from "@/lib/srd/feat-grants";
import { isThievesTools, populateFeaturesForClasses, subclassCastingProfileFor, THIEVES_TOOLS } from "@/lib/srd/features";
import type { HpMethod } from "@/lib/srd/hit-points";
import { MULTICLASS_CAP, canMulticlassInto, classListFor, multiclassGrantsFor } from "@/lib/srd/multiclass";
import { openOptionSlots, optionFeatureName } from "@/lib/srd/options";
import { owedChoices, subclassOwed } from "@/lib/srd/owed-choices";
import {
  casterViewsOf,
  dedupeNames,
  grantedSpellsOf,
  preparedCount,
  spellbookAllowance,
  spellbookOf,
} from "@/lib/srd/spell-prep";
import { subclassGrants } from "@/lib/srd/subclass-training";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import { textKey } from "@/lib/language/text-logic";

export type LevelUpOptionsContext = {
  hpMethod: HpMethod;
  multiclassAllowed: boolean;
  // The class to take the level in; the first class when left out.
  classId?: string;
  // A subclass the agent is weighing for a class that owes one: what it
  // opens with this level (a Battle Master's maneuvers, an Eldritch
  // Knight's spells) is counted as though it were taken.
  subclass?: string;
  // Every subclass this table offers the class: the bundled ones and the
  // workshop's (src/lib/characters/catalog.ts offeredSubclasses).
  subclassesOf: (classId: string) => string[];
  // Cantrips the race gave, known on top of the class's (free-cantrips.ts).
  freeCantrips: number;
  subclassExtras?: SubclassExtras;
};

type ClassRow = { id: string; subclass: string; level: number };

export type LevelUpOptions = {
  name: string;
  level: number;
  xp: number;
  classes: ClassRow[];
  nextLevel: number | null;
  xpForNextLevel: number | null;
  // Whether odm_level_up would take the level now.
  ready: boolean;
  notReady?: string;
  // Choices the character's earlier levels left open: the next level-up
  // takes them, so they are listed again under choices below.
  owedFromEarlierLevels: string[];
  // The class this answer is for, and the others the level could go to.
  levelUpClass: string;
  classLevelAfter: number;
  // The subclass the picks below are counted under: the one held, or the
  // one asked about; null before either.
  countedUnderSubclass: string | null;
  otherClasses: Array<{ id: string; allowed: boolean; reason?: string }>;
  hitPoints: {
    die: string;
    method: HpMethod;
    // What the level adds at the table's fixed value, and the roll's range.
    fixed: number;
    min: number;
    max: number;
    extras: string[];
  };
  choices: {
    asiChoices?: { count: number; note: string };
    subclass?: { options: string[] };
    expertise?: { count: number; options: string[] };
    featurePicks?: Array<{ label: string; count: number; options: string[] }>;
    levelUpSkill?: { options: string[] };
    training?: Array<{ name: string; picks: string }>;
    spells?: {
      list: string;
      maxSpellLevel: number;
      newCantrips: number;
      // Spells to learn, prepare or write in the book with this level.
      newSpells: number;
      style: "known" | "prepared" | "spellbook";
      mayReplaceOne: boolean;
      note: string;
    };
  };
};

const STYLE_NOTE = {
  known: "Name new spells in levelUpSpells; levelUpForget gives up one known spell for another.",
  prepared: "Name spells to add to the prepared list in levelUpSpells.",
  spellbook: "Name the spells to write in the spellbook in levelUpSpells; they are prepared as far as the limit has room.",
} as const;

function notReadyReason(sheet: CharacterSheet, next: number): string | undefined {
  if (sheet.deathSaves?.dead) {
    return `${sheet.name} is dead, and the dead gain no levels.`;
  }
  if (sheet.currentHp <= 0) {
    return `${sheet.name} is at 0 hit points and levels up once back on their feet.`;
  }
  if (sheet.level >= 20) {
    return "No character passes level 20.";
  }
  if (levelForXp(sheet.xp) < next) {
    return `Level ${next} takes ${XP_THRESHOLDS[next - 1]} experience points and ${sheet.name} has ${sheet.xp}. A level is earned in play, or granted by whoever runs the table.`;
  }
  return undefined;
}

export function levelUpOptions(sheet: CharacterSheet, context: LevelUpOptionsContext): LevelUpOptions | { error: string } {
  const classList = classListFor(sheet).map((entry) => ({ ...entry }));
  const classId = (context.classId ?? "").trim().toLowerCase() || classList[0].id.toLowerCase();
  const klass = findClass(classId);
  if (!klass) {
    return { error: `Unknown class "${classId}".` };
  }
  const held = classList.find((entry) => entry.id.toLowerCase() === classId);
  const next = Math.min(20, sheet.level + 1);
  let notReady = notReadyReason(sheet, next);
  if (!held && !notReady) {
    if (!context.multiclassAllowed) {
      notReady = "Multiclassing is turned off for this campaign, so the level goes to a class the character has.";
    } else {
      const check = canMulticlassInto(sheet, classId);
      if (!check.ok) {
        notReady = check.error ?? `${sheet.name} cannot take a level in ${klass.name}.`;
      }
    }
  }

  const otherClasses: LevelUpOptions["otherClasses"] = classList
    .filter((entry) => entry.id.toLowerCase() !== classId)
    .map((entry) => ({ id: entry.id, allowed: true }));
  if (context.multiclassAllowed && classList.length < MULTICLASS_CAP) {
    for (const candidate of ALL_CLASSES) {
      if (candidate.id === classId || classList.some((entry) => entry.id.toLowerCase() === candidate.id)) {
        continue;
      }
      const check = canMulticlassInto(sheet, candidate.id);
      otherClasses.push(check.ok ? { id: candidate.id, allowed: true } : { id: candidate.id, allowed: false, reason: check.error });
    }
  }

  const classLevelAfter = (held?.level ?? 0) + 1;
  const subclassHeld = (held?.subclass ?? "").trim();
  const owesSubclass = subclassOwed({ id: klass.id, subclass: subclassHeld }, classLevelAfter);
  const subclassOptions = owesSubclass ? context.subclassesOf(klass.id) : [];
  const asked = (context.subclass ?? "").trim();
  const weighed = asked ? (subclassOptions.find((name) => textKey(name) === textKey(asked)) ?? "") : "";
  if (asked && !weighed) {
    return {
      error: owesSubclass
        ? `${asked} is not a subclass the ${klass.name} may take here; pick one from choices.subclass.options.`
        : `The ${klass.name} has no subclass to choose with this level.`,
    };
  }
  // The subclass the level's other picks are counted under.
  const subclassNow = subclassHeld || weighed;
  const classesAfter: ClassRow[] = held
    ? classList.map((entry) => (entry === held ? { ...entry, level: classLevelAfter, subclass: subclassNow } : entry))
    : [...classList, { id: klass.id, subclass: subclassNow, level: 1 }];

  const choices: LevelUpOptions["choices"] = {};

  const asi = asiOwed(sheet, classesAfter);
  if (asi > 0) {
    choices.asiChoices = {
      count: asi,
      note: 'Each is { mode: "plus2", ability } or { mode: "plus1x2", abilities: [a, b] } (scores cap at 20), or { mode: "feat", feat } for a feat in its place. Optional: an improvement left out stays owed.',
    };
  }

  if (owesSubclass) {
    choices.subclass = { options: subclassOptions };
  }

  const expertise = expertiseOpen(sheet, classesAfter);
  if (expertise > 0) {
    const current = sheet.proficiencies.expertise ?? [];
    const tools =
      classesAfter.some((entry) => entry.id === "rogue") &&
      (sheet.proficiencies.tools ?? []).some(isThievesTools) &&
      !current.some(isThievesTools)
        ? [THIEVES_TOOLS]
        : [];
    const options = [...sheet.proficiencies.skills.filter((skill) => !current.includes(skill)), ...tools];
    if (options.length) {
      choices.expertise = { count: Math.min(expertise, options.length), options };
    }
  }

  // Picks a class feature opens, sent back as feature names: fighting styles,
  // then invocations, maneuvers, metamagic and the rest (src/lib/srd/options.ts).
  const featurePicks: NonNullable<LevelUpOptions["choices"]["featurePicks"]> = [];
  const styles = chosenFightingStyles(sheet.features);
  const styleSlots = fightingStyleSlots(populateFeaturesForClasses(sheet.features, classesAfter, sheet.race));
  if (styleSlots > styles.length) {
    featurePicks.push({
      label: "Fighting Style",
      count: styleSlots - styles.length,
      options: FIGHTING_STYLES.filter((style) => !styles.some((name) => textKey(name) === textKey(style.name))).map((style) =>
        fightingStyleFeatureName(style.id),
      ),
    });
  }
  for (const slot of openOptionSlots({
    classId: klass.id,
    subclass: subclassNow,
    level: classLevelAfter,
    features: sheet.features,
    feats: sheet.feats,
  })) {
    if (slot.remaining <= 0) {
      continue;
    }
    const chosen = new Set(slot.chosen.map(textKey));
    featurePicks.push({
      label: slot.label,
      count: slot.remaining,
      options: slot.options.filter((option) => !chosen.has(textKey(option.n))).map((option) => optionFeatureName(slot.kind, option.n)),
    });
  }
  if (featurePicks.length) {
    choices.featurePicks = featurePicks;
  }

  if (!held) {
    const grant = multiclassGrantsFor(klass.id);
    if (grant.skillChoice) {
      const from = grant.skillChoice.from.length ? grant.skillChoice.from : SRD_SKILLS.map((skill) => skill.id);
      const options = from.filter((id) => !sheet.proficiencies.skills.includes(id));
      if (options.length) {
        choices.levelUpSkill = { options };
      }
    }
  }

  // What the subclass trains the character in, arriving with this level: a
  // feature at the class's new level (a Gloom Stalker's Iron Mind at 7), or
  // the weighed subclass's own (a Lore bard's three skills). Picks are keyed
  // in featChoices by the grant's name.
  const trainedBefore = new Set(subclassGrants(classList, context.subclassExtras).map((grant) => `${grant.classId}|${textKey(grant.name)}`));
  const training = subclassGrants(classesAfter, context.subclassExtras)
    .filter((grant) => !trainedBefore.has(`${grant.classId}|${textKey(grant.name)}`))
    .flatMap((grant) => {
      const picks = featPicksOwed(grant.name, grant.spec, undefined);
      return picks ? [{ name: grant.name, picks }] : [];
    });
  if (training.length) {
    choices.training = training;
  }

  // The casting this level brings, as the dialog reckons it: a workshop or
  // pack subclass with third-caster rules casts by its own profile, which
  // its name alone never shows (src/lib/srd/third-caster.ts).
  const casterEntry = sheet.spellcasting?.casters?.find((entry) => entry.classId.toLowerCase() === klass.id);
  const progression =
    subclassCastingProfileFor(klass.id, subclassNow, context.subclassExtras) ??
    casterEntry?.progression ??
    (sheet.spellcasting?.casters?.length ? undefined : sheet.spellcasting?.progression);
  const caster = casterPreview({
    classId: klass.id,
    subclass: subclassNow,
    progression,
    level: classLevelAfter,
    abilitiesAfter: sheet.abilities,
  });
  if (caster.casts && caster.ability) {
    const view = casterViewsOf(sheet, context.subclassExtras).find((entry) => entry.classId.toLowerCase() === klass.id);
    const cantripsHeld = view ? dedupeNames(view.cantrips).length - context.freeCantrips : 0;
    const newCantrips = caster.cantripCap === null ? 0 : Math.max(0, caster.cantripCap - Math.max(0, cantripsHeld));
    let newSpells = 0;
    if (caster.style === "spellbook") {
      newSpells = view && spellbookOf(view).length ? 2 : spellbookAllowance(classLevelAfter);
    } else if (caster.spellCap) {
      const granted = new Set((view ? grantedSpellsOf({ ...view, level: classLevelAfter, subclass: subclassNow }) : []).map(textKey));
      const holding = !view
        ? 0
        : caster.style === "known"
          ? dedupeNames(view.known.length ? view.known : view.prepared).filter((name) => !granted.has(textKey(name))).length
          : preparedCount(view);
      newSpells = Math.max(0, caster.spellCap.count - holding);
    }
    const knownBefore = view ? (view.known.length ? view.known : view.prepared) : [];
    choices.spells = {
      list: caster.list,
      maxSpellLevel: caster.maxLevel,
      newCantrips,
      newSpells,
      style: caster.style,
      mayReplaceOne: caster.style === "known" && knownBefore.length > 0,
      note: STYLE_NOTE[caster.style],
    };
  }

  const hp = levelUpHpPreview({
    sheet,
    hitDie: klass.hitDie,
    method: context.hpMethod,
    abilitiesAfter: sheet.abilities,
    featsAfter: [],
    classesAfter,
    targetLevel: next,
  });

  return {
    name: sheet.name,
    level: sheet.level,
    xp: sheet.xp,
    classes: classList,
    nextLevel: sheet.level >= 20 ? null : next,
    xpForNextLevel: sheet.level >= 20 ? null : XP_THRESHOLDS[next - 1],
    ready: !notReady,
    ...(notReady ? { notReady } : {}),
    owedFromEarlierLevels: owedChoices(sheet),
    levelUpClass: klass.id,
    classLevelAfter,
    countedUnderSubclass: subclassNow || null,
    otherClasses,
    hitPoints: {
      die: `d${klass.hitDie}`,
      method: context.hpMethod,
      fixed: hp.fixed,
      min: hp.min,
      max: hp.max,
      extras: hp.extras,
    },
    choices,
  };
}
