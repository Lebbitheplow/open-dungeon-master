// SRD class-resource tables: which limited-use features a class carries,
// how many uses they have at each level, and when they refill. The sheet's
// `resources` map is populated from the features list the same way
// populateFeatures grants the features themselves; use_resource spends,
// rests refill by recharge type. Pure and dependency-light so test scripts
// import it directly.

export type Recharge = "short" | "long";

export type ResourceDef = {
  id: string;
  // Feature name(s) this resource attaches to, lowercased for matching.
  match: string[];
  displayName: string;
  maxFor: (level: number, abilityMods: Record<string, number>) => number;
  recharge: Recharge;
};

function rageUses(level: number): number {
  if (level >= 17) return 6;
  if (level >= 12) return 5;
  if (level >= 6) return 4;
  if (level >= 3) return 3;
  return 2;
}

function channelUses(level: number): number {
  if (level >= 18) return 3;
  if (level >= 6) return 2;
  return 1;
}

export const RESOURCE_DEFS: ResourceDef[] = [
  {
    id: "rage",
    match: ["rage"],
    displayName: "Rage",
    maxFor: (level) => rageUses(level),
    recharge: "long",
  },
  {
    id: "ki",
    match: ["ki"],
    displayName: "Ki Points",
    maxFor: (level) => Math.max(1, level),
    recharge: "short",
  },
  {
    id: "sorcery_points",
    match: ["sorcery points", "font of magic"],
    displayName: "Sorcery Points",
    maxFor: (level) => Math.max(1, level),
    recharge: "long",
  },
  {
    id: "second_wind",
    match: ["second wind"],
    displayName: "Second Wind",
    maxFor: () => 1,
    recharge: "short",
  },
  {
    id: "action_surge",
    match: ["action surge"],
    displayName: "Action Surge",
    maxFor: (level) => (level >= 17 ? 2 : 1),
    recharge: "short",
  },
  {
    id: "channel_divinity",
    match: ["channel divinity"],
    displayName: "Channel Divinity",
    maxFor: (level) => channelUses(level),
    recharge: "short",
  },
  {
    id: "bardic_inspiration",
    match: ["bardic inspiration"],
    displayName: "Bardic Inspiration",
    maxFor: (_level, mods) => Math.max(1, mods.cha ?? 0),
    // SRD: refills on long rest (short too from bard 5; modeled as long for
    // simplicity, the server errs toward scarcity).
    recharge: "long",
  },
  {
    id: "wild_shape",
    match: ["wild shape"],
    displayName: "Wild Shape",
    maxFor: () => 2,
    recharge: "short",
  },
  {
    id: "lay_on_hands",
    match: ["lay on hands"],
    displayName: "Lay on Hands (HP pool)",
    maxFor: (level) => Math.max(5, level * 5),
    recharge: "long",
  },
  {
    id: "divine_sense",
    match: ["divine sense"],
    displayName: "Divine Sense",
    maxFor: (_level, mods) => Math.max(1, 1 + (mods.cha ?? 0)),
    recharge: "long",
  },
  {
    id: "relentless_endurance",
    match: ["relentless endurance"],
    displayName: "Relentless Endurance",
    maxFor: () => 1,
    recharge: "long",
  },
  {
    id: "breath_weapon",
    match: ["breath weapon"],
    displayName: "Breath Weapon",
    maxFor: () => 1,
    recharge: "short",
  },
];

export type ResourceState = { max: number; used: number };
export type ResourceMap = Record<string, ResourceState>;

export function resourceDef(id: string): ResourceDef | null {
  return RESOURCE_DEFS.find((def) => def.id === id) ?? null;
}

// Fuzzy find by id or display/feature name ("rage", "Ki", "sorcery
// points"...); used by the use_resource tool with model-supplied names.
export function matchResource(term: string): ResourceDef | null {
  const wanted = term.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!wanted) {
    return null;
  }
  return (
    RESOURCE_DEFS.find((def) => def.id.replace(/_/g, " ") === wanted) ??
    RESOURCE_DEFS.find((def) => def.displayName.toLowerCase() === wanted) ??
    RESOURCE_DEFS.find((def) =>
      def.match.some((name) => name === wanted || wanted.includes(name) || name.includes(wanted)),
    ) ??
    null
  );
}

// Builds the resources map from the features list: features that map to a
// known resource get a counter sized for the level; existing used counts
// are preserved (clamped to the new max) so level-ups never refund spent
// uses. Resources whose feature disappeared are dropped.
export function populateResources(
  features: Array<{ name: string }>,
  level: number,
  abilityMods: Record<string, number>,
  existing: ResourceMap | undefined,
): ResourceMap {
  const out: ResourceMap = {};
  const featureNames = features.map((feature) => feature.name.trim().toLowerCase());
  for (const def of RESOURCE_DEFS) {
    const has = featureNames.some((name) =>
      def.match.some((fragment) => name === fragment || name.startsWith(`${fragment} `) || name.includes(fragment)),
    );
    if (!has) {
      continue;
    }
    const max = def.maxFor(level, abilityMods);
    const used = Math.min(existing?.[def.id]?.used ?? 0, max);
    out[def.id] = { max, used };
  }
  return out;
}

// Rest refills: long rests refill everything, short rests only the
// short-recharge pools.
export function refillResources(resources: ResourceMap | undefined, rest: Recharge): ResourceMap {
  const out: ResourceMap = {};
  for (const [id, state] of Object.entries(resources ?? {})) {
    const def = resourceDef(id);
    const refill = rest === "long" || def?.recharge === "short";
    out[id] = { max: state.max, used: refill ? 0 : state.used };
  }
  return out;
}
