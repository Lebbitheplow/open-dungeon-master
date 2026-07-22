// The pick-lists that hang off a class feature: invocations, maneuvers,
// metamagic, pact boons, infusions, runes and elemental disciplines.
//
// Before this existed a warlock's sheet said "Eldritch Invocations" and
// stopped, so the player never chose any and never got the abilities. The
// storage trick is the one Fighting Style already used: a pick becomes a
// "choice"-sourced feature named with the kind's prefix ("Invocation:
// Agonizing Blast"), which populateFeatures preserves across level-ups, so
// nothing about the sheet schema changes.
//
// Pure data and pure functions, client-importable like the rest of srd/.

import optionsJson from "@/lib/srd/options.json";

export type OptionKind =
  | "invocation"
  | "maneuver"
  | "metamagic"
  | "pact_boon"
  | "infusion"
  | "rune"
  | "discipline";

export type OptionDef = {
  k: OptionKind;
  n: string;
  d: string;
  req?: string;
};

type KindMeta = { label: string; prefix: string; grantedBy: string };

const KINDS = (optionsJson as { kinds: Record<OptionKind, KindMeta> }).kinds;
const OPTIONS = (optionsJson as { options: OptionDef[] }).options;

export function optionKindMeta(kind: OptionKind): KindMeta {
  return KINDS[kind];
}

export function optionsOfKind(kind: OptionKind): OptionDef[] {
  return OPTIONS.filter((option) => option.k === kind);
}

// "Invocation: Agonizing Blast". The prefix is what makes a pick findable on
// a sheet without a new column.
export function optionFeatureName(kind: OptionKind, name: string): string {
  return `${KINDS[kind].prefix}${name}`;
}

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

// The picks of one kind already on a sheet, as bare option names.
export function chosenOptions(features: Array<{ name: string }>, kind: OptionKind): string[] {
  const prefix = normalize(KINDS[kind].prefix);
  return features
    .filter((feature) => normalize(feature.name).startsWith(prefix))
    .map((feature) => feature.name.slice(KINDS[kind].prefix.length).trim());
}

// Any option pick on a sheet, whatever its kind. Used by the help layer so
// "Invocation: Agonizing Blast" can explain itself.
export function findOptionByFeatureName(featureName: string): OptionDef | null {
  const name = normalize(featureName);
  for (const [kind, meta] of Object.entries(KINDS) as Array<[OptionKind, KindMeta]>) {
    const prefix = normalize(meta.prefix);
    if (name.startsWith(prefix)) {
      const bare = normalize(featureName.slice(meta.prefix.length));
      return OPTIONS.find((option) => option.k === kind && normalize(option.n) === bare) ?? null;
    }
  }
  return null;
}

// How many picks of a kind a character has earned. Descending [level, count]
// tables, first match wins, exactly like the resource tables.
type Grant = { kind: OptionKind; classId: string; subclass?: string; steps: Array<[number, number]> };

const GRANTS: Grant[] = [
  // Warlock invocations: 2 at level 2, then one at 5, 7, 9, 12, 15 and 18.
  {
    kind: "invocation",
    classId: "warlock",
    steps: [
      [18, 8],
      [15, 7],
      [12, 6],
      [9, 5],
      [7, 4],
      [5, 3],
      [2, 2],
    ],
  },
  { kind: "pact_boon", classId: "warlock", steps: [[3, 1]] },
  {
    kind: "maneuver",
    classId: "fighter",
    subclass: "Battle Master",
    steps: [
      [15, 9],
      [10, 7],
      [7, 5],
      [3, 3],
    ],
  },
  {
    kind: "metamagic",
    classId: "sorcerer",
    steps: [
      [17, 4],
      [10, 3],
      [3, 2],
    ],
  },
  {
    kind: "infusion",
    classId: "artificer",
    steps: [
      [18, 12],
      [14, 10],
      [10, 8],
      [6, 6],
      [2, 4],
    ],
  },
  {
    kind: "rune",
    classId: "fighter",
    subclass: "Rune Knight",
    steps: [
      [15, 5],
      [10, 4],
      [7, 3],
      [3, 2],
    ],
  },
  {
    kind: "discipline",
    classId: "monk",
    subclass: "Way of the Four Elements",
    steps: [
      [17, 5],
      [11, 4],
      [6, 3],
      [3, 2],
    ],
  },
];

function subclassMatches(stored: string, wanted: string): boolean {
  const a = normalize(stored);
  const b = normalize(wanted);
  return Boolean(a) && (a === b || a.includes(b) || b.includes(a));
}

export function optionSlotsFor(
  classId: string,
  subclass: string,
  level: number,
  kind: OptionKind,
): number {
  const grant = GRANTS.find(
    (entry) =>
      entry.kind === kind &&
      entry.classId === normalize(classId) &&
      (!entry.subclass || subclassMatches(subclass, entry.subclass)),
  );
  if (!grant) {
    return 0;
  }
  const step = grant.steps.find(([atLevel]) => level >= atLevel);
  return step ? step[1] : 0;
}

// Every pick-list this character currently has open, with how many are still
// unspent. The builder and the level-up dialog both render straight from this.
export type OptionSlot = {
  kind: OptionKind;
  label: string;
  total: number;
  chosen: string[];
  remaining: number;
  options: OptionDef[];
};

export function openOptionSlots(input: {
  classId: string;
  subclass: string;
  level: number;
  features: Array<{ name: string }>;
}): OptionSlot[] {
  const slots: OptionSlot[] = [];
  for (const kind of Object.keys(KINDS) as OptionKind[]) {
    const total = optionSlotsFor(input.classId, input.subclass, input.level, kind);
    if (total <= 0) {
      continue;
    }
    const chosen = chosenOptions(input.features, kind);
    slots.push({
      kind,
      label: KINDS[kind].label,
      total,
      chosen,
      remaining: Math.max(0, total - chosen.length),
      options: optionsOfKind(kind),
    });
  }
  return slots;
}
