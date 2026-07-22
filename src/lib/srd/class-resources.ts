// SRD class-resource tables: which limited-use features a class carries,
// how many uses they have at each level, and when they refill. The sheet's
// `resources` map is populated from the features list the same way
// populateFeatures grants the features themselves; use_resource spends,
// rests refill by recharge type. Pure and dependency-light so test scripts
// import it directly.

import customResourcesJson from "@/lib/classes/resources.json";
import authoredResourcesJson from "@/lib/srd/authored-resources.json";

export type Recharge = "short" | "long";

// What spending the resource actually DOES, resolved server-side by
// computeUseResource. Features whose payload the fiction decides (Ki, Action
// Surge, Channel Divinity) are "narrative": the server spends the use and
// hands the model the SRD reminder in `guidance` so it narrates the right
// thing and reaches for the right follow-up tool.
export type SaveAbilityId = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type ResourceEffect =
  // Heals the spender for a rolled expression (Second Wind).
  | { kind: "heal_self"; dice: (level: number, abilityMods: Record<string, number>) => string }
  // The spent amount IS the hit points restored, to a touched target
  // (Lay on Hands).
  | { kind: "heal_pool" }
  // Each spent use is one die of healing to the target (Balm of the Summer
  // Court: a pool of d6s).
  | { kind: "heal_dice_pool"; die: string }
  // Heals the target for a rolled expression (Healing Light-likes).
  | { kind: "heal_target"; dice: (level: number, abilityMods: Record<string, number>) => string }
  // Grants the spender (or a target) temporary hit points; 5e temp HP never
  // stacks, the higher value stands.
  | { kind: "temp_hp"; dice: (level: number, abilityMods: Record<string, number>) => string }
  // Applies a self-condition with real mechanics for a number of rounds
  // (Rage).
  | { kind: "condition"; condition: string; rounds: number }
  // Applies a condition-effects registry condition to self or a target, with
  // variants for features that offer a choice (Starry Form, Spirit Totem)
  // and optional temporary hit points granted alongside (Fighting Spirit).
  | {
      kind: "buff";
      condition: string;
      rounds: number;
      target: "self" | "ally";
      variants?: string[];
      tempHp?: (level: number, abilityMods: Record<string, number>) => string;
    }
  // Hands a target a bonus die their next d20 roll consumes (Bardic
  // Inspiration).
  | { kind: "inspire"; die: (level: number) => string }
  // The payload is a multi-target save-for-half effect the aoe_damage
  // engine resolves; the spend reports the dice and DC to use.
  | { kind: "aoe"; dice: (level: number) => string; save: SaveAbilityId }
  // A save-or-suffer aimed at one enemy: the spend reports the save, DC,
  // condition, and dice for the cast_at_enemy call that resolves it.
  | {
      kind: "enemy_save";
      save: SaveAbilityId;
      condition?: string;
      dice?: (level: number, abilityMods: Record<string, number>) => string;
    }
  // Repositioning the server cannot fully own (maps are player-moved);
  // reported with the distance so move_token resolves it.
  | { kind: "teleport"; feet: number }
  // Swaps in a beast form with its own hit point pool.
  | { kind: "wild_shape" }
  // Returns expended spell slots on a short rest (Arcane/Natural Recovery),
  // up to a total of `levels` slot levels.
  | { kind: "recover_slots"; levels: (level: number) => number }
  // No server-enforceable payload; guidance only.
  | { kind: "narrative" };

// The JSON form of an effect, carried on resource rows in resources.json /
// authored-resources.json. Dice formulas are strings with `level`, `prof`,
// and ability-mod tokens ("1d8+level", "2d6+wis") resolved at spend time.
export type ResourceFx =
  | { kind: "heal_self"; dice: string }
  | { kind: "heal_pool" }
  | { kind: "heal_dice_pool"; die: string }
  | { kind: "heal_target"; dice: string }
  | { kind: "temp_hp"; dice: string }
  | { kind: "condition"; condition: string; rounds: number }
  | {
      kind: "buff";
      condition: string;
      rounds: number;
      target?: "self" | "ally";
      variants?: string[];
      tempHp?: string;
    }
  | { kind: "inspire"; die: string }
  | { kind: "aoe"; dice: string; save: SaveAbilityId }
  | { kind: "enemy_save"; save: SaveAbilityId; condition?: string; dice?: string }
  | { kind: "teleport"; feet: number };

// "1d8+level" at level 5 -> "1d8+5"; "2d6+wis" with WIS +3 -> "2d6+3".
// Negative modifiers fold into the sign so the dice grammar stays valid.
export function resolveDiceFormula(
  formula: string,
  level: number,
  abilityMods: Record<string, number>,
): string {
  return formula
    .replace(/\b(level|prof|str|dex|con|int|wis|cha)\b/g, (token) => {
      if (token === "level") {
        return String(Math.max(1, level));
      }
      if (token === "prof") {
        return String(proficiencyBonus(level));
      }
      return String(abilityMods[token] ?? 0);
    })
    .replace(/\+\s*-/g, "-")
    .replace(/(^|[+-])0(?=$|[+-])/g, (match, sign) => (sign === "+" ? "" : match))
    .replace(/\+$/, "");
}

// Lifts a JSON fx row into the executable effect shape.
export function effectFromFx(fx: ResourceFx | undefined): ResourceEffect {
  if (!fx) {
    return { kind: "narrative" };
  }
  switch (fx.kind) {
    case "heal_self":
      return { kind: "heal_self", dice: (level, mods) => resolveDiceFormula(fx.dice, level, mods) };
    case "heal_pool":
      return { kind: "heal_pool" };
    case "heal_dice_pool":
      return { kind: "heal_dice_pool", die: fx.die };
    case "heal_target":
      return {
        kind: "heal_target",
        dice: (level, mods) => resolveDiceFormula(fx.dice, level, mods),
      };
    case "temp_hp":
      return { kind: "temp_hp", dice: (level, mods) => resolveDiceFormula(fx.dice, level, mods) };
    case "condition":
      return { kind: "condition", condition: fx.condition, rounds: fx.rounds };
    case "buff":
      return {
        kind: "buff",
        condition: fx.condition,
        rounds: fx.rounds,
        target: fx.target ?? "self",
        ...(fx.variants ? { variants: fx.variants } : {}),
        ...(fx.tempHp
          ? {
              tempHp: (level: number, mods: Record<string, number>) =>
                resolveDiceFormula(fx.tempHp!, level, mods),
            }
          : {}),
      };
    case "inspire":
      return { kind: "inspire", die: () => fx.die };
    case "aoe":
      return {
        kind: "aoe",
        dice: (level) => resolveDiceFormula(fx.dice, level, {}),
        save: fx.save,
      };
    case "enemy_save":
      return {
        kind: "enemy_save",
        save: fx.save,
        ...(fx.condition ? { condition: fx.condition } : {}),
        ...(fx.dice
          ? { dice: (level: number, mods: Record<string, number>) => resolveDiceFormula(fx.dice!, level, mods) }
          : {}),
      };
    case "teleport":
      return { kind: "teleport", feet: fx.feet };
  }
}

export type ResourceDef = {
  id: string;
  // The class(es) whose level scales maxFor. On multiclass sheets the
  // counter is sized by that class's level (a barbarian 3 / rogue 5 has
  // 3 rages, not 4); single-class sheets are unaffected because character
  // level = class level. Absent = scale by the level of whichever class
  // granted the matching feature (feature.classId), else character level.
  classIds?: string[];
  // Feature name(s) this resource attaches to, lowercased for matching.
  match: string[];
  // Require the feature name to BE the match term, not merely contain it as
  // a word: "Rage" is barbarian rage, "Road Rage" (road_warrior) is not.
  exact?: boolean;
  displayName: string;
  maxFor: (level: number, abilityMods: Record<string, number>) => number;
  recharge: Recharge;
  effect: ResourceEffect;
  // Never spent by choice: the server burns it on a trigger of its own, so
  // use_resource refuses rather than wasting the charge.
  passive?: boolean;
  // One line of SRD truth handed back to the model in the tool result, so a
  // spend never leaves it guessing what the feature does.
  guidance: string;
  // Feature-name variants that RAISE the count when the character has them
  // ("Adrenal Override (2 uses)" upgrades "Adrenal Override"). Checked in
  // populateResources against the sheet's actual features.
  upgrades?: Array<{ match: string; uses: number }>;
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

// The condition Rage applies. Named here because both the effect table and
// the mechanics in src/lib/dm/condition-logic.ts key off the same string.
export const RAGING = "raging";

// Rage's bonus melee damage, by barbarian level.
export function rageDamageBonus(level: number): number {
  if (level >= 16) return 4;
  if (level >= 9) return 3;
  return 2;
}

function inspirationDie(level: number): string {
  if (level >= 15) return "d12";
  if (level >= 10) return "d10";
  if (level >= 5) return "d8";
  return "d6";
}

// Dragonborn breath weapon: d6s that grow with character level.
function breathDice(level: number): string {
  if (level >= 16) return "5d6";
  if (level >= 11) return "4d6";
  if (level >= 6) return "3d6";
  return "2d6";
}

const SRD_RESOURCE_DEFS: ResourceDef[] = [
  {
    id: "rage",
    classIds: ["barbarian"],
    match: ["rage"],
    exact: true,
    displayName: "Rage",
    maxFor: (level) => rageUses(level),
    recharge: "long",
    effect: { kind: "condition", condition: RAGING, rounds: 10 },
    guidance:
      "Raging for up to 1 minute: resistance to bludgeoning, piercing, and slashing damage, bonus damage on melee Strength attacks, and advantage on Strength checks and saves. The server applies all of it; the rage ends early if they end it or fall unconscious.",
  },
  {
    id: "ki",
    classIds: ["monk"],
    match: ["ki"],
    displayName: "Ki Points",
    maxFor: (level) => Math.max(1, level),
    recharge: "short",
    effect: { kind: "narrative" },
    guidance:
      "Ki fuels Flurry of Blows (a bonus-action pair of unarmed strikes: resolve each with pc_attack), Patient Defense (Dodge), and Step of the Wind (Dash or Disengage, doubled jump).",
  },
  {
    id: "sorcery_points",
    classIds: ["sorcerer"],
    match: ["sorcery points", "font of magic"],
    displayName: "Sorcery Points",
    maxFor: (level) => Math.max(1, level),
    recharge: "long",
    effect: { kind: "narrative" },
    guidance:
      "Sorcery points buy Metamagic on a spell being cast (spend with amount), or convert to and from spell slots: call use_resource with variant like 'create a 2nd-level slot' (costs 2/3/5/6/7 points for levels 1-5) or 'convert my 3rd-level slot into points' and the server moves the points and slots. Created slots vanish on a long rest. The spell itself still goes through use_spell_slot or cast_at_enemy as normal.",
  },
  {
    id: "second_wind",
    classIds: ["fighter"],
    match: ["second wind"],
    displayName: "Second Wind",
    maxFor: () => 1,
    recharge: "short",
    effect: { kind: "heal_self", dice: (level) => `1d10+${level}` },
    guidance: "A bonus action that restores 1d10 + fighter level hit points to the fighter.",
  },
  {
    id: "action_surge",
    classIds: ["fighter"],
    match: ["action surge"],
    displayName: "Action Surge",
    maxFor: (level) => (level >= 17 ? 2 : 1),
    recharge: "short",
    effect: { kind: "narrative" },
    guidance:
      "One additional action this turn, on top of the regular one. Resolve the extra action with its own tool call (a second pc_attack, a cast, a Dash).",
  },
  {
    id: "channel_divinity",
    classIds: ["cleric", "paladin"],
    match: ["channel divinity"],
    displayName: "Channel Divinity",
    maxFor: (level) => channelUses(level),
    recharge: "short",
    effect: { kind: "narrative" },
    guidance:
      "Divine power channelled into a subclass effect (Turn Undead, Destroy Undead, a domain or oath option). Turned enemies flee: apply the frightened condition with set_enemy_condition, or enemy_flees for the ones that break entirely.",
  },
  {
    id: "bardic_inspiration",
    classIds: ["bard"],
    match: ["bardic inspiration"],
    displayName: "Bardic Inspiration",
    maxFor: (_level, mods) => Math.max(1, mods.cha ?? 0),
    // SRD: refills on long rest (short too from bard 5; modeled as long for
    // simplicity, the server errs toward scarcity).
    recharge: "long",
    effect: { kind: "inspire", die: inspirationDie },
    guidance:
      "The target keeps the inspiration die for up to 10 minutes and adds it to one ability check, attack roll, or saving throw. The server hands it to them and spends it on their next roll automatically.",
  },
  {
    id: "wild_shape",
    classIds: ["druid"],
    match: ["wild shape"],
    displayName: "Wild Shape",
    maxFor: () => 2,
    recharge: "short",
    effect: { kind: "wild_shape" },
    guidance:
      "The druid takes on a beast's form: its hit points, AC, and natural attacks, keeping their own mind. Damage spills back to their own hit points when the form drops.",
  },
  {
    id: "lay_on_hands",
    classIds: ["paladin"],
    match: ["lay on hands"],
    displayName: "Lay on Hands (HP pool)",
    maxFor: (level) => Math.max(5, level * 5),
    recharge: "long",
    effect: { kind: "heal_pool" },
    guidance:
      "A touch that restores hit points straight from the paladin's pool: the amount spent is the amount healed. Spend 5 instead to cure one disease or neutralize one poison.",
  },
  {
    id: "divine_sense",
    classIds: ["paladin"],
    match: ["divine sense"],
    displayName: "Divine Sense",
    maxFor: (_level, mods) => Math.max(1, 1 + (mods.cha ?? 0)),
    recharge: "long",
    effect: { kind: "narrative" },
    guidance:
      "Until the end of their next turn the paladin knows the location of any celestial, fiend, or undead within 60 feet that is not behind total cover, and of consecrated or desecrated ground.",
  },
  {
    id: "relentless_endurance",
    match: ["relentless endurance"],
    displayName: "Relentless Endurance",
    maxFor: () => 1,
    recharge: "long",
    // The server burns this counter itself when a hit would drop them
    // (src/lib/dm/mutations.ts, apply_damage). Nothing to spend.
    effect: { kind: "narrative" },
    passive: true,
    guidance:
      "This is not spent by choice: the server drops them to 1 hit point instead of 0 the next time damage would fell them, and burns the use itself.",
  },
  {
    id: "arcane_recovery",
    classIds: ["wizard"],
    match: ["arcane recovery"],
    displayName: "Arcane Recovery",
    maxFor: () => 1,
    recharge: "long",
    // The slots come back through take_rest, which reads the spent use.
    effect: { kind: "recover_slots", levels: (level) => Math.ceil(level / 2) },
    guidance:
      "Once a day, on a short rest, the wizard recovers expended spell slots totalling half their level (rounded up), none of them 6th level or higher.",
  },
  {
    id: "natural_recovery",
    classIds: ["druid"],
    match: ["natural recovery"],
    displayName: "Natural Recovery",
    maxFor: () => 1,
    recharge: "long",
    effect: { kind: "recover_slots", levels: (level) => Math.ceil(level / 2) },
    guidance:
      "Once a day, on a short rest, the druid recovers expended spell slots totalling half their druid level (rounded up), none of them 6th level or higher.",
  },
  {
    id: "breath_weapon",
    match: ["breath weapon"],
    displayName: "Breath Weapon",
    maxFor: () => 1,
    recharge: "short",
    effect: { kind: "aoe", dice: breathDice, save: "dex" },
    guidance:
      "A cone or line of the dragonborn's ancestral damage type. Resolve it with aoe_damage using the dice and DC this call reports, and the damage type their ancestry dictates.",
  },
];

// The custom genre-class counters, generated from the *-features.json
// catalogs by scripts/generate-class-resources.mjs. Each is a plain
// limited-use narrative feature: the server spends the use and hands the
// model the SRD-style guidance line, exactly like Ki or Action Surge.
type CustomResourceRow = {
  id: string;
  displayName: string;
  match: string[];
  uses: number;
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha" | null;
  recharge: Recharge;
  // Feature-name variants that raise the count ("Adrenal Override (2 uses)").
  upgrades: Array<{ match: string; uses: number }>;
  guidance: string;
  // Optional typed effect the spend executes server-side.
  fx?: ResourceFx;
};

const CUSTOM_RESOURCE_DEFS: ResourceDef[] = (
  customResourcesJson as { resources: CustomResourceRow[] }
).resources.map((row) => ({
  id: row.id,
  match: row.match,
  // Custom feature names are distinctive, so a plain contains-word match is
  // safe; exactness is not needed the way it is for "rage".
  displayName: row.displayName,
  maxFor: (_level: number, mods: Record<string, number>) => {
    const abilityFloor = row.ability ? Math.max(1, mods[row.ability] ?? 0) : row.uses;
    // An upgrade line the character also has raises the ceiling.
    return Math.max(row.uses, abilityFloor);
  },
  recharge: row.recharge,
  effect: effectFromFx(row.fx),
  guidance: row.guidance,
  upgrades: row.upgrades,
}));

// The limited-use features of the authored subclass layer. Same row shape as
// the custom-class rows plus two count formulas 5e leans on that the genre
// classes never needed: a multiple of the proficiency bonus, and a table that
// steps at certain levels.
type SubclassResourceRow = {
  id: string;
  displayName: string;
  match: string[];
  uses: number;
  ability: "str" | "dex" | "con" | "int" | "wis" | "cha" | null;
  // Uses = this multiple of the proficiency bonus (1 for most, 2 for the
  // psionic pools).
  proficiency?: number;
  // Descending [level, uses] steps, first match wins.
  scale?: Array<[number, number]>;
  // Pools sized by character level (Balm of the Summer Court, Healing Light).
  byLevel?: boolean;
  levelPlus?: number;
  recharge: Recharge;
  guidance: string;
  // Optional typed effect the spend executes server-side.
  fx?: ResourceFx;
  // Never spent by choice (reaction-triggered features the server or model
  // invokes at the trigger, not on the holder's turn).
  passive?: boolean;
};

function proficiencyBonus(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

const SUBCLASS_RESOURCE_DEFS: ResourceDef[] = (
  authoredResourcesJson as { resources: SubclassResourceRow[] }
).resources.map((row) => ({
  id: row.id,
  match: row.match,
  displayName: row.displayName,
  maxFor: (level: number, mods: Record<string, number>) => {
    if (row.byLevel) {
      return Math.max(1, level + (row.levelPlus ?? 0));
    }
    if (row.proficiency) {
      return proficiencyBonus(level) * row.proficiency;
    }
    if (row.scale) {
      const step = row.scale.find(([atLevel]) => level >= atLevel);
      if (step) {
        return step[1];
      }
    }
    if (row.ability) {
      return Math.max(1, mods[row.ability] ?? 0);
    }
    return row.uses;
  },
  recharge: row.recharge,
  effect: effectFromFx(row.fx),
  guidance: row.guidance,
  ...(row.passive ? { passive: true } : {}),
}));

export const RESOURCE_DEFS: ResourceDef[] = [
  ...SRD_RESOURCE_DEFS,
  ...CUSTOM_RESOURCE_DEFS,
  ...SUBCLASS_RESOURCE_DEFS,
];

export type ResourceState = { max: number; used: number };
export type ResourceMap = Record<string, ResourceState>;

export function resourceDef(id: string): ResourceDef | null {
  return RESOURCE_DEFS.find((def) => def.id === id) ?? null;
}

// Whole-word containment: the fragment must appear as its own word(s), so
// "ki" matches "Ki" and "Ki Points" but never "Skill Versatility" (the
// half-elf trait that a bare substring test turns into a monk).
//
// Both sides are stripped of punctuation, not just the fragment: a feature
// named "Hexblade's Curse" or "Stone's Endurance" otherwise never matched its
// own apostrophe-free fragment.
function containsWord(haystack: string, fragment: string): boolean {
  const clean = (value: string) => value.replace(/[^a-z ]/g, "");
  return new RegExp(`(^|[^a-z])${clean(fragment)}([^a-z]|$)`).test(clean(haystack));
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
      def.match.some(
        (name) => name === wanted || containsWord(wanted, name) || containsWord(name, wanted),
      ),
    ) ??
    null
  );
}

// The level a resource counter scales by. Single-class (no class list):
// the character level, exactly as before. Multiclass: the def's own class
// when the sheet has levels in it, else the level of the class that granted
// the matching feature, else the character level (race features like Breath
// Weapon scale by character level, per RAW).
function resourceLevelFor(
  def: ResourceDef,
  grantingClassId: string | undefined,
  level: number,
  classes: Array<{ id: string; level: number }> | undefined,
): number {
  if (!classes?.length || classes.length < 2) {
    return level;
  }
  const levelOf = (classId: string) =>
    classes.find((entry) => entry.id.toLowerCase() === classId.toLowerCase())?.level ?? 0;
  for (const classId of def.classIds ?? []) {
    const held = levelOf(classId);
    if (held > 0) {
      return held;
    }
  }
  if (grantingClassId) {
    const held = levelOf(grantingClassId);
    if (held > 0) {
      return held;
    }
  }
  return level;
}

// The level a resource's scaling functions should receive for this sheet:
// the def's own class's level on a multiclass sheet (Arcane Recovery reads
// the wizard levels), else the character level. For engines that hold a
// full sheet at spend time.
export function resourceLevel(
  def: ResourceDef,
  sheet: {
    level: number;
    classes?: Array<{ id: string; level: number }>;
    features?: Array<{ name: string; classId?: string }>;
  },
): number {
  const matched = sheet.features?.find((feature) => {
    const name = feature.name.trim().toLowerCase();
    return def.match.some(
      (fragment) => name === fragment || (!def.exact && containsWord(name, fragment)),
    );
  });
  return resourceLevelFor(def, matched?.classId, sheet.level, sheet.classes);
}

// Builds the resources map from the features list: features that map to a
// known resource get a counter sized for the level; existing used counts
// are preserved (clamped to the new max) so level-ups never refund spent
// uses. Resources whose feature disappeared are dropped. On multiclass
// sheets each counter is sized by ITS class's level (ki = monk level).
export function populateResources(
  features: Array<{ name: string; classId?: string }>,
  level: number,
  abilityMods: Record<string, number>,
  existing: ResourceMap | undefined,
  classes?: Array<{ id: string; level: number }>,
): ResourceMap {
  const out: ResourceMap = {};
  const featureNames = features.map((feature) => feature.name.trim().toLowerCase());
  for (const def of RESOURCE_DEFS) {
    const matched = features.find((feature) => {
      const name = feature.name.trim().toLowerCase();
      return def.match.some(
        (fragment) => name === fragment || (!def.exact && containsWord(name, fragment)),
      );
    });
    if (!matched) {
      continue;
    }
    const defLevel = resourceLevelFor(def, matched.classId, level, classes);
    let max = def.maxFor(defLevel, abilityMods);
    // A feature that upgrades this one raises the ceiling.
    for (const upgrade of def.upgrades ?? []) {
      if (featureNames.includes(upgrade.match)) {
        max = Math.max(max, upgrade.uses);
      }
    }
    const used = Math.min(existing?.[def.id]?.used ?? 0, max);
    out[def.id] = { max, used };
  }
  return out;
}

// Relentless Endurance is never spent by choice: the server burns it the
// moment a hit would drop the character to 0, leaving them at 1 instead.
// Returns the resources map with the use spent, or null when the feature is
// absent or already used.
export function spendRelentlessEndurance(resources: ResourceMap | undefined): ResourceMap | null {
  const state = resources?.relentless_endurance;
  if (!state || state.used >= state.max) {
    return null;
  }
  return { ...resources, relentless_endurance: { max: state.max, used: state.used + 1 } };
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
