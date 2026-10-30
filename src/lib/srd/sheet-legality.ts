// One legality check for every door a character sheet comes through.
//
// "What is wrong with this sheet as a level N character of this table", in
// plain sentences, in the style of spellListProblems; and beside the
// answer, the sheet with every value that has one legal answer written by
// the server rather than read from the request: hit dice, spell slots and
// casting ability, saving throws, training, speed, the armor class flag, hit
// points under a method that needs no dice, the purse.
//
// Pure: no database. The rows it judges against (the class, the race, the
// background, prices, spells, feats) are looked up by the caller and handed
// in (src/lib/characters/catalog.ts), so a test can drive every rule from
// plain data.
//
// The doors differ in what they can know. A character made here is held to
// a method for its scores and to the starting kit. A file, or a library
// character stored before this check existed, was rolled and played where
// this server could not see: it is held to what dice and levels could have
// given, and keeps what it holds.
import type {
  Ability,
  AsiChoice,
  ClassEntry,
  CreateSheetInput,
  HitDicePool,
  SheetFeature,
} from "@/lib/schemas/sheet";
import { earnedAsiCountFor } from "@/lib/srd/asi";
import { legacyAsiTaken, readAsiLedger, withAsiLedger } from "@/lib/srd/asi-ledger";
import { backgroundFeatureFor } from "@/lib/backgrounds";
import { attunementSlotsFor, matchArmor } from "@/lib/srd/armor";
import { racialTraitsFor, subclassLevelFor } from "@/lib/srd/features";
import {
  derivedMaxHp,
  hpBonusPerLevelFor,
  hpRange,
  levelHpGain,
  type HpClass,
} from "@/lib/srd/hit-points";
import { MULTICLASS_CAP, describePrereq, meetsPrereq, multiclassGrantsFor } from "@/lib/srd/multiclass";
import {
  featureAbilityGrants,
  featureHitPoints,
  holdsFeature,
  reachesPrimalChampion,
  withPrimalChampion,
  withoutPrimalChampion,
} from "@/lib/srd/trait-rules";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import {
  ancestryOf,
  draconicAncestryFeature,
  findDraconicAncestry,
  innateCantripsFor,
  rollDraconicAncestry,
  takesDraconicAncestry,
  type DraconicAncestry,
} from "@/lib/srd/racial-grants";
import { featSpellGrants, freeCastFeatures, freeCastOf } from "@/lib/srd/feat-spells";
import { featSaveProficiency } from "@/lib/srd/feat-effects";
import { applyFeatGrants, featGrantSpec, withoutFeatPicks } from "@/lib/srd/feat-grants";
import { elementalAdeptFeatureName, elementalAdeptFeatureOf } from "@/lib/srd/feat-combat";
import { expandBackgroundGear } from "@/lib/srd/gear-choices";
import { kitNames, startingKitFor } from "@/lib/srd/starting-kit";
import { judgeStartingGear, wealthCeilingGold } from "@/lib/srd/starting-wealth";
import { abilityProblems, baseSpans } from "@/lib/srd/legality/abilities";
import { applyHalfFeats, halfFeatPicks, halfFeatPoints } from "@/lib/srd/legality/half-feats";
import { judgeFeats, judgeFeatures } from "@/lib/srd/legality/features";
import { judgeProficiencies } from "@/lib/srd/legality/proficiencies";
import { applySubclassTraining, autoSubclassPicks, subclassFixedTraining, subclassGrants } from "@/lib/srd/subclass-training";
import { castingClassesOf, judgeSpellcasting } from "@/lib/srd/legality/spells";
import { judgeRacialCantrips } from "@/lib/srd/legality/racial-cantrips";
import { judgeSpeciesVariant, withoutOldVariant } from "@/lib/srd/legality/species-variant";
import { carriedCantrips, carriedVariant } from "@/lib/srd/legality/older-builder";
import { withHeldVariant } from "@/lib/content/species-variants";
import { racialCantripFields } from "@/lib/srd/racial-cantrips";
import {
  type ClassGrants,
  type LegalityContext,
  type Legalized,
} from "@/lib/srd/legality/types";
import { textKey } from "@/lib/language/text-logic";
import { featChoice } from "@/lib/schemas/sheet";

export type { LegalityContext, Legalized } from "@/lib/srd/legality/types";

type Die = "d6" | "d8" | "d10" | "d12";
const dieOf = (klass: ClassGrants | null): Die => `d${klass?.hitDie ?? 8}` as Die;

// What each door lets through. Read once, at the top, so the rest of the
// check asks a question ("may this door add a story feature?") rather than
// naming doors.
function policyFor(context: LegalityContext) {
  const { door } = context;
  const edit = door === "library" && Boolean(context.baseline);
  const made = door === "table" || door === "engine" || (door === "library" && !edit);
  return {
    edit,
    // A character made here, with nothing earned behind it.
    made,
    // Scores held to a method, or only to what dice can give.
    scores: door === "import" || door === "stored" ? ("bounds" as const) : ("method" as const),
    // A class list the builder sent is kept (backlog F9); the AI's engine
    // builds one class, and a table that turns multiclassing off is asked
    // in classListOf.
    keepsClasses: door !== "engine",
    // A stored character's picks were settled where the server saw them.
    judgesPicks: door !== "stored",
    // A file may be older than the rule that asks for a pick: one it left
    // open is owed, not wrong; one it names is still judged (issue #430).
    picksMayWait: door === "import",
    plainStory: door === "import",
    trustsHeld: door === "stored",
  };
}

function classListOf(
  input: CreateSheetInput,
  context: LegalityContext,
  keeps: boolean,
  problems: string[],
): ClassEntry[] {
  const sent = input.classes ?? [];
  const single = [{ id: input.class, subclass: input.subclass ?? "", level: context.level }];
  if (!keeps || sent.length < 2) {
    return single;
  }
  // A character already played keeps what it earned (the setting's own
  // promise, src/lib/schemas/game-settings.ts); one made at this table
  // follows its rule. A seated player rebuilding the character they have
  // keeps its split, or part of it: no class the seat does not hold. The
  // table's rule also holds an in-place edit made at that table, which
  // comes through the library door; a stored hero entering play keeps all.
  const held = new Set((context.heldClasses ?? []).map((entry) => textKey(entry.id)));
  const keepsHeld = held.size > 1 && sent.every((entry) => held.has(textKey(entry.id)));
  const makesHere = context.door === "table" || context.door === "library";
  if (makesHere && context.multiclassAllowed === false && !keepsHeld) {
    problems.push("This table turns multiclassing off; a character made here holds one class.");
    return single;
  }
  const ids = new Set(sent.map((entry) => textKey(entry.id)));
  if (ids.size !== sent.length) {
    problems.push("A character holds each class once; the class list names one twice.");
    return single;
  }
  if (sent.length > MULTICLASS_CAP) {
    problems.push(`A character has at most ${MULTICLASS_CAP} classes here; that list has ${sent.length}.`);
    return single;
  }
  if (textKey(sent[0].id) !== textKey(input.class)) {
    problems.push(`The first class on the list (${sent[0].id}) must be the character's class (${input.class}).`);
    return single;
  }
  const total = sent.reduce((sum, entry) => sum + entry.level, 0);
  if (total !== context.level) {
    problems.push(
      `The class levels add up to ${total} and the character is level ${context.level}; they must be equal.`,
    );
    return single;
  }
  for (const entry of sent) {
    if (!context.classOf(entry.id)) {
      problems.push(`"${entry.id}" is not a class this server knows.`);
      continue;
    }
    if (!meetsPrereq(input.abilities, entry.id)) {
      problems.push(
        `Holding levels in ${context.classOf(entry.id)?.name ?? entry.id} beside another class requires ${describePrereq(entry.id)}.`,
      );
    }
  }
  return sent.map((entry) => ({ ...entry }));
}

// SRD 5.1 makes multiclassing the table's choice, so a table that turns it
// off takes in no character from outside that holds levels in more than one
// class: a library hero or companion joining it is refused, and told what
// will do. One seated there before the switch went off keeps the classes it
// holds (the setting's own promise), so its own edit passes them as `held`.
// A character a lower table's level strips to one class comes in as that.
export function multiclassEntryProblem(
  name: string,
  classes: ReadonlyArray<{ id: string }> | null | undefined,
  multiclassAllowed: boolean,
  held: ReadonlyArray<{ id: string }> = [],
): string | null {
  const list = classes ?? [];
  if (multiclassAllowed || list.length < 2) {
    return null;
  }
  const seat = new Set(held.map((entry) => textKey(entry.id)));
  if (list.every((entry) => seat.has(textKey(entry.id)))) {
    return null;
  }
  return `${name} holds levels in more than one class, and this table turns multiclassing off. Bring a character with one class, or build one here.`;
}

function subclassesOf(
  classes: ClassEntry[],
  context: LegalityContext,
  problems: string[],
): ClassEntry[] {
  return classes.map((entry) => {
    const name = (entry.subclass ?? "").trim();
    if (!name) {
      return { ...entry, subclass: "" };
    }
    const pickLevel = subclassLevelFor(entry.id);
    if (pickLevel !== null && entry.level < pickLevel) {
      // Not yet theirs to choose: the name comes off, as the builder drops it.
      return { ...entry, subclass: "" };
    }
    if (!context.subclassOffered(entry.id, name)) {
      problems.push(
        `${name} is not a subclass of the ${context.classOf(entry.id)?.name ?? entry.id}; pick one from that class's list.`,
      );
    }
    return { ...entry, subclass: name };
  });
}

// `race` with its species option folded in, so a pick of the player's choice
// cannot stack on the ability the option raises.
function racialIncrease(
  input: CreateSheetInput,
  race: NonNullable<LegalityContext["race"]>,
  problems: string[],
): { racial: Partial<Record<Ability, number>>; picks: Ability[] } {
  const racial: Partial<Record<Ability, number>> = { ...race.asi };
  const sent = input.racialChoices?.asi ?? [];
  const choice = race.asiChoice;
  if (!choice) {
    return { racial, picks: [] };
  }
  const picks: Ability[] = [];
  for (const ability of sent) {
    const fixed = (race.asi[ability] ?? 0) !== 0;
    const offered = !choice.from || choice.from.includes(ability);
    if (picks.includes(ability) || fixed || !offered || picks.length >= choice.count) {
      problems.push(
        `The ${race.name}'s increase of the player's choice goes to ${choice.count} different ${choice.count === 1 ? "ability" : "abilities"}${choice.from ? ` among ${choice.from.join(", ")}` : ""} the race does not already raise; ${ability} cannot take it.`,
      );
      continue;
    }
    picks.push(ability);
    racial[ability] = (racial[ability] ?? 0) + choice.amount;
  }
  return { racial, picks };
}

// The background's named feature as the sheet writes it, "Feature
// (Background)": the bundled tables' for a bundled background, the content
// pack row's otherwise.
function backgroundFeatureOf(background: LegalityContext["background"]): string | null {
  if (!background) {
    return null;
  }
  const bundled = backgroundFeatureFor(background.id);
  if (bundled) {
    return `${bundled.name} (${bundled.background})`;
  }
  return background.feature ? `${background.feature} (${background.name})` : null;
}

// The kit that costs a new character nothing: its class's starting
// equipment with the choices the request made (src/lib/srd/starting-kit.ts)
// and the background's pack.
function freeKitOf(
  klass: ClassGrants,
  background: LegalityContext["background"],
  input: CreateSheetInput,
  who: { armor: string[]; weapons: string[]; tools: string[]; subclass: string },
) {
  const kit = startingKitFor(
    { id: klass.id, armor: who.armor, weapons: who.weapons },
    input.kitChoices,
    who.subclass,
    klass.name,
  );
  // The background's kit with its choice lines answered: a tool line from
  // the training the character holds, an either-or line from the pick the
  // sheet records (issue #127).
  const backgroundKit = expandBackgroundGear(background?.equipment, {
    tools: who.tools,
    backgroundTools: background?.tools ?? [],
    picks: input.backgroundChoices?.gear ?? [],
  });
  return {
    names: [...kitNames(kit.items), ...backgroundKit.names],
    problems: [...kit.problems, ...backgroundKit.problems],
    choices: kit.tabled ? kit.choices : undefined,
  };
}

export function legalizeSheet(input: CreateSheetInput, context: LegalityContext): Legalized {
  const problems: string[] = [];
  const policy = policyFor(context);
  const level = Math.max(1, Math.min(20, Math.floor(context.level)));
  const klass = context.classOf(input.class);
  const { race: baseRace, background } = context;
  if (context.door === "stored" && (!klass || !baseRace)) {
    // A character stored with a class or a race no table describes (made
    // when any name was taken) has nothing to be derived from. It enters
    // play as it was stored, which is how it has always played.
    return { problems: [], sheet: input };
  }
  if (!klass) {
    problems.push(
      `"${input.class}" is not a class this server knows; pick one from the builder's list.`,
    );
  }
  if (!baseRace) {
    problems.push(`"${input.race}" is not a race this server knows; pick one from the builder's list.`);
  }
  if (input.background.trim() && !background && context.door !== "stored") {
    problems.push(
      `"${input.background}" is not a background this server knows; pick one from the builder's list.`,
    );
  }
  if (!klass || !baseRace) {
    return { problems, sheet: input };
  }
  const held = policy.trustsHeld ? input : (context.baseline?.sheet ?? null);
  // A builder older than a species' own picks had no field for them
  // (src/lib/srd/legality/older-builder.ts): an edit keeps the stored
  // character's, and one made there owes them.
  const older = context.olderBuilder ?? null;

  // ---- the species' own choice ----
  // The option picked (a Half-Dragon's ancestry), folded into the race every
  // rule below reads: its scores, skills, tools and languages.
  const speciesChoice = judgeSpeciesVariant({
    race: baseRace,
    picked: older?.variant
      ? carriedVariant(held, input.race, (baseRace.variants?.options ?? []).map((option) => option.id))
      : (input.racialChoices?.variant ?? "").trim(),
    heldGrants: input.racialChoices?.variantGrants,
    door: context.door,
    ...policy,
    ...(older?.variant ? { made: false, edit: false, picksMayWait: true } : {}),
    rollDie: context.rollDie,
  });
  problems.push(...speciesChoice.problems);
  const race = speciesChoice.race;

  // ---- classes and subclasses ----
  const classes = subclassesOf(
    classListOf(input, { ...context, level }, policy.keepsClasses, problems),
    context,
    problems,
  );
  const multiclass = classes.length > 1;
  // What each subclass trains its character in, by its class's level (issue
  // 251: a Life Domain cleric's heavy armor was a feature's name and never
  // training), and the armor and weapons among it the feat prerequisites
  // read before the training is written.
  const subclassTraining = subclassGrants(classes, context.subclassExtras);
  const subclassFixed = subclassFixedTraining(subclassTraining);
  const secondClassTraining = classes.slice(1).map((entry) => multiclassGrantsFor(entry.id));

  // ---- improvements, feats and ability scores ----
  const earned = earnedAsiCountFor(classes);
  const recorded: AsiChoice[] = (input.asiChoices ?? []).slice();
  if (recorded.length > earned) {
    problems.push(
      `This character has earned ${earned} Ability Score Improvement${earned === 1 ? "" : "s"} at its level; ${recorded.length} are recorded.`,
    );
  }
  const unrecorded = Math.max(0, earned - recorded.length);
  const casts = castingClassesOf(classes, context.classOf, context.subclassExtras, input.spellcasting).length > 0;
  const feats = policy.trustsHeld
    ? { problems: [], feats: input.feats ?? [], slotsUsed: 0 }
    : judgeFeats({
        sent: input.feats ?? [],
        recorded: recorded.flatMap((choice) => (choice.mode === "feat" ? [choice.feat] : [])),
        racialFeats: race.feats,
        unrecordedSlots: policy.made ? 0 : unrecorded,
        held: held?.feats ?? [],
        featOf: context.featOf,
        who: {
          abilities: input.abilities,
          armor: [...klass.armor, ...(race.armor ?? []), ...secondClassTraining.flatMap((grant) => grant.armor), ...subclassFixed.armor],
          casts,
          raceId: race.id,
          raceName: race.name,
          skills: input.proficiencies.skills,
          tools: input.proficiencies.tools,
          weapons: [
            ...klass.weapons,
            ...input.proficiencies.weapons,
            ...secondClassTraining.flatMap((grant) => grant.weapons),
            ...subclassFixed.weapons,
          ],
          level,
        },
      });
  problems.push(...feats.problems);
  // A variant human starts with a feat of their choice. A character made or
  // edited here names it, as it names a draconic ancestry; a stored sheet
  // is trusted, and a companion the engine drafts may go without.
  if (race.feats > 0 && (policy.made || policy.edit) && context.door !== "engine") {
    const recordedFeats = new Set(
      recorded.flatMap((choice) => (choice.mode === "feat" ? [textKey(choice.feat)] : [])),
    );
    const racial = feats.feats.filter((name) => !recordedFeats.has(textKey(name)));
    if (racial.length < race.feats) {
      problems.push(
        `A ${race.name} starts with ${race.feats === 1 ? "a feat" : `${race.feats} feats`} of their choice; pick ${race.feats === 1 ? "one" : "them"} from the feat list.`,
      );
    }
  }
  // Half-feats (Actor's Charisma, Resilient's score and save). A character
  // made or edited in the builder arrives with the scores before them and
  // takes them here, as a level-up does; a stored or imported one already
  // holds them in its scores.
  const takesHalfFeats = policy.made || policy.edit;
  const featText = (feat: string) => context.featOf(feat)?.desc ?? "";
  const halfFeats = halfFeatPicks({ ...input, feats: feats.feats }, race.feats, featText);
  const increase = racialIncrease(input, race, problems);
  // On an edit the stored scores are a pool too: they may be moved about,
  // as the builder lets them be, and not raised. They carry what the stored
  // character's option gave it (which an edit may swap for another, and the
  // workshop may since have changed or removed) and its own racial picks,
  // not the ones the edit sends.
  const storedPool = context.baseline
    ? Object.values(
        baseSpans({
          scores: context.baseline.sheet.abilities,
          racial: racialIncrease(context.baseline.sheet, withHeldVariant(baseRace, context.baseline.sheet.racialChoices), []).racial,
          recorded: context.baseline.sheet.asiChoices ?? [],
          halfFeats: halfFeatPoints(halfFeatPicks(context.baseline.sheet, race.feats, featText)),
          freePoints: 0,
          mode: "bounds",
          pools: [],
        }),
      ).map((span) => span.lo)
    : null;
  problems.push(
    ...abilityProblems({
      scores: input.abilities,
      racial: increase.racial,
      recorded,
      halfFeats: takesHalfFeats ? [] : halfFeatPoints(halfFeats),
      freePoints: 2 * Math.max(0, unrecorded - feats.slotsUsed),
      // Primal Champion's +4 STR and CON, which lift the cap to 24.
      grants: featureAbilityGrants({ class: input.class, level, classes, features: input.features }),
      mode: policy.scores,
      pools: [
        ...(context.abilityPool ? [context.abilityPool] : []),
        ...(storedPool ? [storedPool] : []),
      ],
    }),
  );
  // Primal Champion (barbarian 20): +4 Strength and Constitution, to 24,
  // added last as a level-up adds it. A character made at 20 arrives
  // without them. An edit of a sheet that already holds the feature sends
  // its scores with them in, as they were stored; they come off first, so a
  // half-feat's point is counted beneath them and not lost to the cap of 20.
  const primalChampion = takesHalfFeats && reachesPrimalChampion({ class: input.class, level, classes });
  const primalHeld =
    primalChampion && Boolean(context.baseline && holdsFeature(context.baseline.sheet, "primal champion"));
  let abilities = primalHeld ? withoutPrimalChampion(input.abilities) : input.abilities;
  let featSaves = halfFeatPoints(halfFeats.filter((pick) => featSaveProficiency(pick.feat, pick.ability, pick.desc)));
  if (takesHalfFeats) {
    const applied = applyHalfFeats(abilities, halfFeats);
    if ("error" in applied) {
      problems.push(applied.error);
    } else {
      abilities = applied.abilities;
      featSaves = applied.saves;
    }
  }
  if (primalChampion) {
    abilities = withPrimalChampion(abilities);
  }

  // ---- hit dice and hit points ----
  const hpClasses: HpClass[] = classes.map((entry) => ({
    die: context.classOf(entry.id)?.hitDie ?? 8,
    level: entry.level,
  }));
  // A workshop feat counts as the published feat it runs as (Tough's hit points).
  const perLevelBonus = hpBonusPerLevelFor(
    hpBonusPerLevel(race.id) > 0,
    feats.feats.map((feat) => context.featOf(feat)?.runsAs ?? feat),
  );
  // Draconic Resilience's hit point per sorcerer level (trait-rules.ts).
  const extraHp = featureHitPoints({ class: input.class, subclass: input.subclass, level, classes, features: input.features });
  const hpInput = { classes: hpClasses, con: abilities.con, perLevelBonus, extraHp };
  const range = hpRange(hpInput);
  let maxHp = input.maxHp;
  let rolledHp: number[] | undefined;
  const inRange = maxHp >= range.min && maxHp <= range.max;
  if (context.hpMethod === "average" || context.hpMethod === "max") {
    maxHp = derivedMaxHp(context.hpMethod, hpInput);
  } else if (context.hpMethod === "rolled") {
    if (!(policy.trustsHeld && inRange)) {
      // The server's dice, one for every level after the first.
      rolledHp = [];
      maxHp = range.min;
      hpClasses.forEach((entry, index) => {
        for (let step = index === 0 ? 1 : 0; step < entry.level; step += 1) {
          const face = Math.max(1, Math.min(entry.die, context.rollDie(entry.die)));
          rolledHp!.push(face);
          maxHp +=
            levelHpGain(face, abilities.con, perLevelBonus) -
            levelHpGain(1, abilities.con, perLevelBonus);
        }
      });
    }
  } else if (policy.made || (policy.edit && !inRange)) {
    maxHp = derivedMaxHp("average", hpInput);
  } else if (policy.edit) {
    // An edit keeps the hit points the character came home with while the
    // level and the Constitution behind them stand.
    const before = context.baseline!;
    const same =
      before.level === level &&
      before.sheet.abilities.con === abilities.con &&
      before.sheet.maxHp === maxHp;
    maxHp = same ? maxHp : derivedMaxHp("average", hpInput);
  } else if (!inRange) {
    problems.push(
      `A level ${level} ${klass.name} with Constitution ${abilities.con} has between ${range.min} and ${range.max} hit points; the sheet says ${input.maxHp}.`,
    );
  }
  const hitDice = { die: dieOf(klass), total: level, spent: 0 };
  const hitDicePools: HitDicePool[] | null = multiclass
    ? classes.map((entry) => ({
        classId: entry.id,
        die: dieOf(context.classOf(entry.id)),
        total: entry.level,
        spent: 0,
      }))
    : null;

  // ---- training, skills, languages ----
  const trained = judgeProficiencies({
    // The builder's preview already holds its feats' picks (Skilled's
    // thieves' tools); they come off here, since the class and background
    // never offered them, and go back on with the grants below (issue #147).
    sent: withoutFeatPicks(input.proficiencies, input.featChoices),
    classes,
    classOf: context.classOf,
    race,
    background,
    racialTool: input.racialChoices?.tool ?? "",
    // What the stored character holds stays with it while it is the same
    // class, race and background; an edit that changes one of them picks
    // again from what the new one offers.
    // The picks its feats made come off first and go back on below, so an
    // edit that re-picks Linguist's languages replaces them (issue #125).
    // An option of the species given up takes its grants with it; a stored
    // character entering play keeps what it holds.
    held:
      held && held.class === input.class && held.race === input.race && held.background === input.background
        ? policy.trustsHeld
          ? withoutFeatPicks(held.proficiencies, held.featChoices)
          : withoutOldVariant(withoutFeatPicks(held.proficiencies, held.featChoices), baseRace, held.racialChoices, speciesChoice.option)
        : null,
    // The builder's doors name the tools an open grant leaves to the player.
    requireToolPicks: context.door === "table" || context.door === "library",
  });
  if (policy.judgesPicks) {
    problems.push(...trained.problems);
  }
  // What the feats grant beyond their ability point: Linguist's languages,
  // Heavily Armored's armor, Skill Expert's skill and expertise, each pick
  // the sheet records (featChoices). A character made or edited here, or
  // imported, names every pick; a stored one or an engine's companion is
  // read as it is (issue #125).
  const granted = applyFeatGrants({
    proficiencies: trained.proficiencies,
    feats: feats.feats.map((name) => ({ name, desc: context.featOf(name)?.desc ?? "" })),
    choices: input.featChoices ?? {},
    strict: policy.judgesPicks && context.door !== "engine",
    picksMayWait: policy.picksMayWait,
  });
  if (policy.judgesPicks) {
    problems.push(...granted.problems);
  }
  // What the subclasses grant: fixed training always, their picks (a Lore
  // bard's three skills) as featChoices records them under the feature's
  // name, held to the grant where the feats' picks are (issue 251).
  const bySubclass = applySubclassTraining({
    proficiencies: granted.proficiencies,
    grants: subclassTraining,
    // A companion the engine drafts takes its picks on its own.
    choices:
      context.door === "engine"
        ? autoSubclassPicks(subclassTraining, granted.proficiencies, input.featChoices)
        : (input.featChoices ?? {}),
    strict: policy.judgesPicks && context.door !== "engine",
    picksMayWait: policy.picksMayWait,
    abilities,
  });
  if (policy.judgesPicks) {
    problems.push(...bySubclass.problems);
  }
  const training = bySubclass.proficiencies;
  // The spells the feats teach (src/lib/srd/feat-spells.ts): Fey Touched's
  // misty step and its pick, Magic Initiate's cantrips, Ritual Caster's
  // book. They are written into the spell lists below, on top of the
  // class's counts, and each free cast becomes a feature the counters read.
  const raisedByFeat = (feat: string) => halfFeats.find((pick) => textKey(pick.feat) === textKey(feat))?.ability ?? null;
  const taught = featSpellGrants({
    feats: feats.feats.map((name) => ({ name, desc: context.featOf(name)?.desc ?? "" })),
    choices: input.featChoices ?? {},
    raisedAbility: raisedByFeat,
    spellOf: context.spellOf,
    strict: policy.judgesPicks && context.door !== "engine",
    picksMayWait: policy.picksMayWait,
  });
  if (policy.judgesPicks) {
    problems.push(...taught.problems);
  }
  const owed = [...speciesChoice.owed, ...(granted.owed ?? []), ...(bySubclass.owed ?? []), ...(taught.owed ?? [])];
  // Elemental Adept's type is kept the same way ("Elemental Adept: fire").
  const elementPicks = feats.feats.flatMap((name) => {
    const spec = featGrantSpec(context.featOf(name)?.desc ?? "");
    const picked = textKey(featChoice(input.featChoices, name)?.damageType ?? "");
    return spec.damageTypes.length && spec.damageTypes.includes(picked) ? [elementalAdeptFeatureName(picked)] : [];
  });
  const freeCasts = [...freeCastFeatures(taught.grants), ...elementPicks];

  // ---- spells ----
  const racialCantrips = judgeRacialCantrips({
    race,
    sent: older?.cantrips ? carriedCantrips(input.racialChoices, held, input.race) : input.racialChoices,
    casts,
    spellOf: context.spellOf,
    judgesPicks: policy.judgesPicks,
    countsPicks: context.door !== "engine",
    picksMayWait: policy.picksMayWait || Boolean(older?.cantrips),
  });
  problems.push(...racialCantrips.problems);
  owed.push(...racialCantrips.owed);
  const racialPicks = racialCantrips.picks.map((pick) => pick.name);
  const spells = judgeSpellcasting({
    sent: input.spellcasting ?? null,
    classes,
    classOf: context.classOf,
    subclassExtras: context.subclassExtras,
    abilities,
    spellOf: context.spellOf,
    racialCantrips: casts ? racialCantrips.picks : [],
    // Cantrips the race casts by nature (a tiefling's thaumaturgy) ride on
    // the caster's list, free.
    innateCantrips: innateCantripsFor(race.id, level),
    featSpells: taught.grants,
    held: held?.spellcasting ?? null,
    // A pact boon picked on the sheet widens its lists (class-spell-grants.ts).
    features: input.features ?? held?.features,
    judgeLists: policy.judgesPicks && context.door !== "engine",
    bookAllowance: policy.made,
  });
  problems.push(...spells.problems);

  // ---- draconic ancestry ----
  // A dragonborn chooses one (SRD 5.1, Dragonborn). It is written as a race
  // feature naming the damage type, which the damage engine resists and the
  // breath weapon reads.
  const isAncestry = (feature: { name: string }) => /^draconic ancestry:/i.test(feature.name.trim());
  let ancestry: DraconicAncestry | null = null;
  if (takesDraconicAncestry(race.id)) {
    const picked = (input.racialChoices?.ancestry ?? "").trim();
    ancestry =
      findDraconicAncestry(picked) ?? ancestryOf(input.features ?? []) ?? ancestryOf(held?.features ?? []);
    const refusal =
      "A dragonborn chooses a draconic ancestry: one of black, blue, brass, bronze, copper, gold, green, red, silver or white.";
    if (picked && !findDraconicAncestry(picked)) {
      problems.push(refusal);
    } else if (!ancestry && (policy.made || policy.edit) && context.door !== "engine") {
      problems.push(refusal);
    } else if (!ancestry && context.door === "engine") {
      // A companion the engine drafts with none named rolls on the table
      // (add_companion already does; this covers any other engine draft).
      ancestry = rollDraconicAncestry(context.rollDie);
    }
  }

  // ---- features ----
  const bundledTraits = racialTraitsFor(race.id).length > 0;
  const featured = policy.trustsHeld
    ? { problems: [], features: withFreeCasts(input.features ?? [], freeCasts) }
    : judgeFeatures({
        sent: (input.features ?? []).filter((feature) => !isAncestry(feature) && !featDerived(feature.name)),
        held: (held?.features ?? []).filter((feature) => !featDerived(feature.name)),
        // Written afresh every time, so an option given up leaves nothing.
        raceTraits: [...(bundledTraits ? [] : race.traitNames), ...speciesChoice.traits],
        backgroundFeature: backgroundFeatureOf(background),
        derived: [...(casts ? [] : racialPicks.map((name) => `Racial cantrip: ${name}`)), ...freeCasts],
        allowPlainStory: policy.plainStory,
        sameBackground: (held?.background ?? "") === input.background,
      });
  problems.push(...featured.problems);
  // The ledger of improvements taken. A character made here, or arriving
  // in a file, has taken all it has earned: what it left unspent is not
  // owed again. A stored one keeps its own count, or the old table's.
  const ledger = policy.trustsHeld
    ? Math.min(
        earned,
        readAsiLedger(input.features ?? []) ?? Math.max(recorded.length, legacyAsiTaken(level)),
      )
    : policy.edit
      ? Math.min(
          earned,
          Math.max(
            recorded.length + feats.slotsUsed,
            readAsiLedger(held?.features ?? []) ?? legacyAsiTaken(context.baseline!.level),
          ),
        )
      : earned;
  const ledgered =
    level >= 4 || ledger > 0 ? withAsiLedger(featured.features, ledger) : featured.features;
  const features = ancestry
    ? [...ledgered.filter((feature) => !isAncestry(feature)), draconicAncestryFeature(ancestry)]
    : ledgered;

  // ---- gear and coin ----
  let equipment = input.equipment ?? [];
  let gold = input.gold ?? 0;
  let copper = input.copper ?? 0;
  let kitChoices = input.kitChoices;
  const kitOf = () =>
    freeKitOf(klass, background, input, {
      armor: training.armor,
      weapons: training.weapons,
      tools: training.tools,
      subclass: classes[0].subclass ?? "",
    });
  if (policy.made && context.door !== "engine") {
    const rolled = context.startingWealth === "rolled";
    const coinCopper = rolled
      ? Math.max(0, Math.floor((context.wealthRoll ?? 0) * 100))
      : Math.max(0, Math.floor((background?.purse ?? 0) * 100));
    const kit = rolled ? null : kitOf();
    kitChoices = kit ? kit.choices : undefined;
    const verdict = judgeStartingGear({
      equipment,
      freeKit: kit?.names ?? [],
      coinCopper,
      priceOf: context.priceOf,
    });
    problems.push(...(kit?.problems ?? []), ...verdict.problems);
    const left = Math.max(0, coinCopper - verdict.spentCopper);
    gold = Math.floor(left / 100);
    copper = left % 100;
    // Nothing a new character carries is attuned: attunement takes a rest
    // with the item, in play.
    equipment = equipment.map((item) => {
      const kept = { ...item };
      delete kept.attuned;
      return kept;
    });
  } else if (policy.edit) {
    const before = context.baseline!.sheet;
    const sameKit = before.class === input.class && before.background === input.background;
    const beforeCopper = (before.gold ?? 0) * 100 + (before.copper ?? 0);
    // A class or background changed in the edit hands over its kit as
    // creation does; otherwise the character keeps what it carries.
    const kit = sameKit ? null : kitOf();
    kitChoices = kit ? kit.choices : (input.kitChoices ?? before.kitChoices);
    const verdict = judgeStartingGear({
      equipment,
      freeKit: [
        ...(before.equipment ?? []).flatMap((item) =>
          Array.from({ length: Math.min(item.qty, 999) }, () => item.name),
        ),
        ...(kit?.names ?? []),
      ],
      coinCopper: beforeCopper,
      priceOf: context.priceOf,
    });
    problems.push(...(kit?.problems ?? []), ...verdict.problems);
    const left = Math.max(0, beforeCopper - verdict.spentCopper);
    gold = Math.floor(left / 100);
    copper = left % 100;
  } else if (context.door === "import") {
    const ceiling = wealthCeilingGold(level);
    if (gold > ceiling) {
      problems.push(
        `A level ${level} character arriving from a file carries at most ${ceiling} gp; the file says ${gold}. Lower it, and let whoever runs the table award the rest.`,
      );
    }
  }
  let attuned = 0;
  const attunementCap = attunementSlotsFor({ class: input.class, level, classes: input.classes });
  equipment = equipment.map((item) => {
    if (!item.attuned) {
      return item;
    }
    attuned += 1;
    return attuned <= attunementCap ? item : { ...item, attuned: false };
  });
  if (context.door === "import" && attuned > attunementCap) {
    problems.push(
      `This character is attuned to at most ${attunementCap} magic items; the file attunes ${attuned}.`,
    );
  }

  // ---- armor class ----
  // A stored character from before the armor engine has no armor in its
  // pack and no flag: its saved number is the only truthful one, and it
  // stays pinned. Every other armor class is the engine's.
  const legacyPin =
    policy.trustsHeld &&
    input.acOverride === undefined &&
    !equipment.some((item) => matchArmor(item));

  const sheet: CreateSheetInput = {
    ...input,
    subclass: classes[0].subclass,
    classes: multiclass ? classes : [],
    hitDicePools,
    hitDice,
    maxHp: Math.max(1, Math.min(500, maxHp)),
    speed: race.speed,
    ...(legacyPin ? {} : { acOverride: false }),
    abilities,
    proficiencies: featSaves.length
      ? {
          ...training,
          saves: [...new Set([...training.saves, ...featSaves])],
        }
      : training,
    feats: feats.feats,
    features,
    asiChoices: recorded.slice(0, earned),
    racialChoices: {
      asi: increase.picks,
      skills: input.racialChoices?.skills ?? [],
      ...racialCantripFields(racialPicks),
      tool: race.toolChoice ? (input.racialChoices?.tool ?? "") : "",
      ancestry: ancestry?.id ?? "",
      variant: speciesChoice.variant,
      ...(speciesChoice.grants ? { variantGrants: speciesChoice.grants } : {}),
      ...(race.feats && input.racialChoices?.featAbility
        ? { featAbility: input.racialChoices.featAbility }
        : {}),
    },
    spellcasting: spells.spellcasting,
    equipment,
    gold,
    copper,
    ...(kitChoices ? { kitChoices } : {}),
  };
  return {
    problems: [...new Set(problems)],
    sheet,
    ...(rolledHp ? { rolled: { hp: rolledHp } } : {}),
    ...(owed.length ? { owed: [...new Set(owed)] } : {}),
  };
}

// A stored sheet's features with the free casts its feats call for today:
// one taken away by a re-pick comes off, one the feat teaches goes on.
// A feature a feat's picks wrote: a free cast, or Elemental Adept's type.
const featDerived = (name: string) => Boolean(freeCastOf(name) || elementalAdeptFeatureOf(name));

function withFreeCasts(features: SheetFeature[], freeCasts: string[]): SheetFeature[] {
  const wanted = new Set(freeCasts.map(textKey));
  const kept = features.filter((feature) => !featDerived(feature.name) || wanted.has(textKey(feature.name)));
  const held = new Set(kept.map((feature) => textKey(feature.name)));
  return [...kept, ...freeCasts.filter((name) => !held.has(textKey(name))).map((name) => ({ name: name.slice(0, 80), source: "story" as const }))];
}
