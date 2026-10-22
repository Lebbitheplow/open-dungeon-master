// A caster's slots, casting ability and spell lists, as the class tables
// give them.
//
// Slots and the casting ability have one legal answer, so the server writes
// them and never reads the request's. The lists are the player's picks, so
// they are checked: a cantrip list holds cantrips, a spell is on the class's
// own list at a level its slots reach, a caster who knows spells prepares
// none, a wizard prepares from the book, and the counts are the tables'
// (src/lib/srd/spell-prep.ts spellListProblems).
import { spellClassFor } from "@/lib/classes";
import { featSpellNames, withFeatSpells, type FeatSpellGrant } from "@/lib/srd/feat-spells";
import type { AbilityScores, ClassEntry, Spellcasting } from "@/lib/schemas/sheet";
import { spellSlotsFor } from "@/lib/srd";
import { pactSlotsFor, slotTableFor } from "@/lib/srd/multiclass";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { subclassCastingProfileFor } from "@/lib/srd/features";
import type { SubclassExtras } from "@/lib/srd/subclass-tables";
import {
  casterViewsOf,
  dedupeNames,
  grantedSpellsOf,
  maxSpellLevelOf,
  onWiderList,
  spellListProblems,
  spellbookOf,
  withCasterViews,
  type CasterView,
} from "@/lib/srd/spell-prep";
import {
  thirdCasterAbility,
  thirdCasterList,
  thirdCasterOutside,
  thirdCasterProfileOf,
  thirdCasterSchoolProblem,
  type ThirdCasterProfile,
} from "@/lib/srd/third-caster";
import { type ClassGrants, type SpellFacts } from "@/lib/srd/legality/types";
import { textKey } from "@/lib/language/text-logic";

type Casting = NonNullable<Spellcasting>;
type CastingAbility = Casting["ability"];

export type CastingClass = { entry: ClassEntry; ability: CastingAbility; list: string; progression?: ThirdCasterProfile };

// The classes on a sheet that cast, each with its ability and the spell list
// it draws from. A class with a casting ability and no slots yet (a paladin
// of 1st level) is a casting class with nothing to cast.
export function castingClassesOf(
  classes: ClassEntry[],
  classOf: (classId: string) => ClassGrants | null,
  extras?: SubclassExtras,
  sent?: Spellcasting,
): CastingClass[] {
  const out: CastingClass[] = [];
  for (const entry of classes) {
    const klass = classOf(entry.id);
    const stored = sent?.casters?.find((caster) => textKey(caster.classId) === textKey(entry.id))?.progression ??
      (classes.length === 1 ? sent?.progression : undefined);
    // The server's own reading: the table's workshop subclass, else the
    // published subclass by name. A stored setting is kept only for the
    // published one, where it can only say the same thing.
    const customProfile = subclassCastingProfileFor(entry.id, entry.subclass, extras);
    const bundled = thirdCasterProfileOf(entry.id, entry.subclass);
    const profile = customProfile ?? bundled;
    const progression = customProfile ?? (bundled && stored ? bundled : undefined);
    if (klass && klass.casterType !== "none" && klass.spellAbility) {
      out.push({
        entry,
        ability: klass.spellAbility,
        list: textKey(klass.spellListFrom ?? spellClassFor(entry.id)),
      });
    } else if (profile && entry.level >= 3) {
      out.push({ entry, ability: thirdCasterAbility(profile), list: thirdCasterList(profile), ...(progression ? { progression } : {}) });
    }
  }
  return out;
}

// The slot pool a class list has, nothing spent: the class's own table for
// one Spellcasting class, the shared table for two, and Pact Magic apart
// whenever a warlock stands beside another class.
export function derivedSlots(
  classes: ClassEntry[],
  classOf: (classId: string) => ClassGrants | null,
  used: (slotLevel: string) => number = () => 0,
  profileFor: (entry: ClassEntry) => string | undefined = () => undefined,
): Pick<Casting, "slots" | "pact"> {
  const [first] = classes;
  const multiclass = classes.length > 1;
  // A lone class keeps its own table, a warlock's pact slots included; the
  // shared table is for a class list.
  const table = multiclass
    ? slotTableFor({ class: first.id, classes }, profileFor)
    : spellSlotsFor(first.id, first.level, first.subclass, profileFor(first));
  const slots = Object.fromEntries(
    Object.entries(table).map(([slotLevel, max]) => [
      slotLevel,
      { max, used: Math.min(max, Math.max(0, used(slotLevel))) },
    ]),
  );
  if (!multiclass) {
    return { slots };
  }
  const warlock = classes.find((entry) => classOf(entry.id)?.casterType === "pact");
  const pact = warlock ? pactSlotsFor(warlock.level) : null;
  return pact ? { slots, pact: { level: pact.level, max: pact.max, used: 0 } } : { slots };
}

export type NameRules = {
  spellOf: (name: string) => SpellFacts | null;
  // Names the character already holds: earned, so not judged again.
  held: Set<string>;
  // Cantrips known from the race, with the list each is drawn from.
  racialCantrips: Array<{ name: string; list: string }>;
};

const labelOf = (view: CasterView) => `level ${view.level} ${view.classId.replace(/[_-]+/g, " ")}`;

// What is wrong with the names on one caster's lists: a spell nobody
// published, a spell filed as a cantrip, a spell off the class's list or
// above its level.
export function spellNameProblems(view: CasterView, list: string, rules: NameRules): string[] {
  const problems: string[] = [];
  const granted = new Set(grantedSpellsOf(view).map(textKey));
  const racial = new Map(rules.racialCantrips.map((entry) => [textKey(entry.name), entry.list]));
  const top = maxSpellLevelOf(view);
  const judge = (name: string, asCantrip: boolean) => {
    const key = textKey(name);
    if (rules.held.has(key) || granted.has(key)) {
      return;
    }
    const spell = rules.spellOf(name);
    if (!spell) {
      problems.push(`${name} is not a spell this server knows; pick one from the class's spell list.`);
      return;
    }
    if (asCantrip && spell.level !== 0) {
      problems.push(`${spell.name} is a level ${spell.level} spell, not a cantrip; it cannot sit on the cantrip list.`);
      return;
    }
    if (!asCantrip && spell.level === 0) {
      problems.push(`${spell.name} is a cantrip; it belongs on the cantrip list, not among the spells.`);
      return;
    }
    const lists = spell.classes.map(textKey);
    const racialList = racial.get(key);
    if (racialList !== undefined) {
      if (spell.level !== 0 || !lists.includes(textKey(racialList))) {
        problems.push(`${spell.name} is not a ${racialList} cantrip, which is what the race's cantrip must be.`);
      }
      return;
    }
    // A patron's expanded list and a Divine Soul's cleric list widen it.
    if (!lists.includes(list) && !onWiderList(view, spell)) {
      problems.push(`${spell.name} is not on the ${list} spell list, so a ${labelOf(view)} cannot learn or prepare it.`);
      return;
    }
    // The counts check (spellListProblems) holds the level ceiling for every
    // spell the bundled checklist names; this is for the ones only the
    // content pack knows.
    if (spellLevelOf(name) === null && spell.level > top) {
      problems.push(`${spell.name} is a level ${spell.level} spell; a ${labelOf(view)} casts up to level ${top}.`);
    }
  };
  for (const name of dedupeNames(view.cantrips)) {
    judge(name, true);
  }
  for (const name of dedupeNames([...view.known, ...view.prepared, ...view.pending, ...view.spellbook])) {
    judge(name, false);
  }
  return problems;
}

// How one caster's lists are filed: a caster who knows spells keeps them in
// `known` and prepares nothing. (A wizard's prepared spells are always in
// the book: the book is written to hold them, and then counted.)
export function spellFilingProblems(view: CasterView): string[] {
  const problems: string[] = [];
  const granted = new Set(grantedSpellsOf(view).map(textKey));
  if (view.style === "known") {
    const known = new Set(view.known.map(textKey));
    const apart = [...view.prepared, ...view.pending].filter(
      (name) => !known.has(textKey(name)) && !granted.has(textKey(name)),
    );
    if (view.known.length && apart.length) {
      problems.push(
        `A ${labelOf(view)} knows its spells and prepares none; ${apart.join(", ")} must be among the spells known or come off the sheet.`,
      );
    }
  }
  return problems;
}

export type SpellcastingInput = {
  sent: Spellcasting;
  classes: ClassEntry[];
  classOf: (classId: string) => ClassGrants | null;
  subclassExtras?: SubclassExtras;
  abilities: AbilityScores;
  spellOf: (name: string) => SpellFacts | null;
  // The race's cantrip pick, with the list it comes from.
  racialCantrip: { name: string; list: string } | null;
  // Cantrips the race knows by nature (src/lib/srd/racial-grants.ts): free,
  // and not judged against the class's list.
  innateCantrips?: string[];
  // The spells the sheet's feats teach (src/lib/srd/feat-spells.ts): free,
  // on top of the class's counts, from any list. A character with no
  // Spellcasting of their own gets a block with no slots for them.
  featSpells?: FeatSpellGrant[];
  // Lists the stored character already holds, on an edit.
  held?: Spellcasting;
  // False for a character whose lists were settled where the server saw
  // them: slots and ability are still written, the lists are left alone.
  judgeLists: boolean;
  bookAllowance: boolean;
};

export type SpellcastingVerdict = { problems: string[]; spellcasting: Spellcasting };

function namesOf(casting: Spellcasting): string[] {
  if (!casting) {
    return [];
  }
  const lists = [casting, ...(casting.casters ?? [])];
  return lists.flatMap((entry) => [
    ...(entry.cantrips ?? []),
    ...entry.known,
    ...entry.prepared,
    ...(entry.pending ?? []),
    ...(entry.spellbook ?? []),
  ]);
}

// A book nobody wrote in is left off the sheet, so a sheet that never kept
// one is stored in the shape it came in.
function withoutEmptyBooks(casting: Casting): Casting {
  const strip = <T extends { spellbook?: string[] }>(lists: T): T => {
    if (lists.spellbook && !lists.spellbook.length) {
      const next = { ...lists };
      delete next.spellbook;
      return next;
    }
    return lists;
  };
  const top = strip(casting);
  return top.casters ? { ...top, casters: top.casters.map(strip) } : top;
}

export function judgeSpellcasting(input: SpellcastingInput): SpellcastingVerdict {
  const casting = castingClassesOf(input.classes, input.classOf, input.subclassExtras, input.sent);
  const invalidProfile = input.classes.some((entry) => {
    const stored = input.sent?.casters?.find((caster) => textKey(caster.classId) === textKey(entry.id))?.progression ??
      (input.classes.length === 1 ? input.sent?.progression : undefined);
    // A sheet that says it casts as a third caster when nothing on the
    // server says so: a subclass whose author turned it off, or a crafted
    // request. A profile that differs is not refused, only overwritten.
    return Boolean(stored) && !thirdCasterProfileOf(entry.id, entry.subclass) &&
      !subclassCastingProfileFor(entry.id, entry.subclass, input.subclassExtras);
  });
  const [first] = input.classes;
  const level = input.classes.reduce((sum, entry) => sum + entry.level, 0);
  if (!casting.length) {
    // A fighter with Fey Touched or Magic Initiate casts the feat's spells
    // and nothing else: the block holds them, the feat's ability, no slots.
    const taught = withFeatSpells(null, input.featSpells ?? []);
    const allowed = new Set(
      taught ? [...(taught.cantrips ?? []), ...taught.known, ...(taught.spellbook ?? [])].map(textKey) : [],
    );
    const names = dedupeNames(namesOf(input.sent)).filter((name) => !allowed.has(textKey(name)));
    return {
      problems: [
        ...(invalidProfile ? ["This subclass is not configured to use the third-caster spellcasting progression."] : []),
        ...(names.length && input.judgeLists
          ? [`A ${first.id.replace(/[_-]+/g, " ")} has no Spellcasting feature, so ${names.slice(0, 3).join(", ")} cannot be on the sheet.`]
          : []),
      ],
      spellcasting: taught,
    };
  }

  const multiclass = input.classes.length > 1;
  const sent: Casting = input.sent ?? {
    ability: casting[0].ability,
    slots: {},
    prepared: [],
    known: [],
    cantrips: [],
  };
  // Per-class lists on a multiclass sheet, the top-level lists otherwise.
  let shaped: Casting = { ...sent, ability: casting[0].ability };
  if (multiclass) {
    const existing = sent.casters ?? [];
    const legacyOwner = existing.length ? null : casting[0].entry.id;
    shaped = {
      ...shaped,
      casters: casting.map(({ entry, ability, progression }) => {
        const mine = existing.find((caster) => textKey(caster.classId) === textKey(entry.id));
        if (mine) {
          return { ...mine, ability, ...(progression ? { progression } : {}) };
        }
        return textKey(entry.id) === textKey(legacyOwner ?? "")
          ? {
              classId: entry.id,
              ability,
              ...(progression ? { progression } : {}),
              known: sent.known,
              prepared: sent.prepared,
              cantrips: sent.cantrips ?? [],
              ...(sent.pending ? { pending: sent.pending } : {}),
              ...(sent.spellbook ? { spellbook: sent.spellbook } : {}),
            }
          : { classId: entry.id, ability, ...(progression ? { progression } : {}), known: [], prepared: [], cantrips: [] };
      }),
    };
  } else {
    delete shaped.casters;
    delete shaped.pact;
    if (casting[0].progression) shaped.progression = casting[0].progression;
  }

  const sheetLike = {
    class: first.id,
    subclass: first.subclass,
    level,
    classes: multiclass ? input.classes : [],
    abilities: input.abilities,
    spellcasting: shaped,
  };
  let views = casterViewsOf(sheetLike, input.subclassExtras);
  // An older sheet filed a known caster's spells under prepared.
  views = views.map((view) =>
    view.style === "known" && !view.known.length && view.prepared.length
      ? { ...view, known: view.prepared, prepared: [] }
      : view,
  );
  // What a wizard has prepared is written in the book, whether or not the
  // request wrote it down twice; the book's allowance then counts it.
  // A sheet that keeps no book at all (an older one) is left without: what
  // it has prepared is read as its book wherever a book is asked for.
  views = views.map((view) =>
    view.style === "spellbook" && view.spellbook.length
      ? { ...view, spellbook: spellbookOf(view) }
      : view,
  );
  // The race's cantrip sits with the first caster's, on top of its own.
  const racial = input.racialCantrip;
  if (racial?.name && views.length) {
    const holder = views[0];
    if (!views.some((view) => view.cantrips.some((name) => textKey(name) === textKey(racial.name)))) {
      views[0] = { ...holder, cantrips: [...holder.cantrips, racial.name] };
    }
  }

  const innate = dedupeNames(input.innateCantrips ?? []);
  if (innate.length && views.length) {
    const holder = views[0];
    const missing = innate.filter(
      (name) => !views.some((view) => view.cantrips.some((cantrip) => textKey(cantrip) === textKey(name))),
    );
    if (missing.length) {
      views[0] = { ...holder, cantrips: [...holder.cantrips, ...missing] };
    }
  }

  // The feats' spells sit with the first caster's, on top of its own:
  // cantrips with the cantrips, spells with the known, a ritual book's with
  // the spellbook.
  const taught = featSpellNames(input.featSpells ?? []);
  const rituals = (input.featSpells ?? []).flatMap((grant) => grant.rituals);
  if (views.length && (taught.cantrips.length || taught.spells.length)) {
    const holder = views[0];
    const heldAnywhere = (name: string, pick: (view: CasterView) => string[]) =>
      views.some((view) => pick(view).some((entry) => textKey(entry) === textKey(name)));
    views[0] = {
      ...holder,
      cantrips: [...holder.cantrips, ...taught.cantrips.filter((name) => !heldAnywhere(name, (view) => view.cantrips))],
      known: [
        ...holder.known,
        ...taught.spells.filter(
          (name) => !rituals.some((entry) => textKey(entry) === textKey(name)) && !heldAnywhere(name, (view) => [...view.known, ...view.prepared]),
        ),
      ],
      spellbook: [...holder.spellbook, ...rituals.filter((name) => !heldAnywhere(name, (view) => view.spellbook))],
    };
  }
  const free = [...innate, ...taught.cantrips, ...taught.spells];

  const problems: string[] = [];
  if (invalidProfile) {
    problems.push("This subclass is not configured to use the third-caster spellcasting progression.");
  }
  if (input.judgeLists) {
    const held = new Set([...namesOf(input.held ?? null), ...free].map(textKey));
    for (const view of views) {
      const list = casting.find((entry) => textKey(entry.entry.id) === textKey(view.classId))?.list ?? "";
      problems.push(
        ...spellNameProblems(view, list, {
          spellOf: input.spellOf,
          held,
          racialCantrips: racial?.name ? [racial] : [],
        }),
        ...spellFilingProblems(view),
      );
      // An Eldritch Knight or Arcane Trickster learns from two schools, a few
      // picks from any other; only adding past both is refused.
      const levelled = (names: string[]) =>
        dedupeNames(names)
          .map((name) => ({ name, school: input.spellOf(name)?.school ?? null, level: input.spellOf(name)?.level ?? 1 }))
          .filter((spell) => spell.level > 0);
      const heldNames = namesOf(input.held ?? null).filter((name) => !free.some((entry) => textKey(entry) === textKey(name)));
      const schools = thirdCasterSchoolProblem({
        classId: view.classId,
        subclass: casting.find((entry) => textKey(entry.entry.id) === textKey(view.classId))?.entry.subclass,
        profile: view.progression,
        level: view.level,
        spells: levelled((view.known.length ? view.known : view.prepared).filter((name) => !taught.spells.some((entry) => textKey(entry) === textKey(name)))),
        heldOutside: thirdCasterOutside(view.classId, levelled(heldNames), view.progression),
      });
      if (schools) {
        problems.push(schools);
      }
    }
  }
  const written = withoutEmptyBooks(withCasterViews(shaped, views));
  if (input.judgeLists) {
    problems.push(
      ...spellListProblems(
        { ...sheetLike, spellcasting: written },
        {
          bookAllowance: input.bookAllowance,
          freeCantrips: [...(racial?.name ? [racial.name] : []), ...innate, ...taught.cantrips],
          freeSpells: taught.spells,
          extras: input.subclassExtras,
        },
      ),
    );
  }
  const spellcasting: Casting = {
    ...written,
    ability: casting[0].ability,
    ...derivedSlots(input.classes, input.classOf, () => 0, (entry) => casting.find((caster) => textKey(caster.entry.id) === textKey(entry.id))?.progression),
  };
  if (!multiclass) {
    delete spellcasting.pact;
  }
  return { problems: [...new Set(problems)], spellcasting };
}
