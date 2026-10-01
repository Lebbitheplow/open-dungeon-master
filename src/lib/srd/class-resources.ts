// SRD class-resource tables: which limited-use features a class carries,
// how many uses they have at each level, and when they refill. The sheet's
// `resources` map is populated from the features list the same way
// populateFeatures grants the features themselves; use_resource spends,
// rests refill by recharge type. Pure and dependency-light so test scripts
// import it directly.

import { COMBAT_RESOURCE_DEFS } from "@/lib/srd/combat-rows";
import customResourcesJson from "@/lib/classes/resources.json";
import authoredResourcesJson from "@/lib/srd/authored-resources.json";
import { innateSpellCounterRows } from "@/lib/srd/racial-grants";
import { LATE_RESOURCE_DEFS } from "@/lib/srd/class-resources-late";
import { UNLIMITED_USES } from "@/lib/srd/resource-limits";

export { isUnlimited, UNLIMITED_USES } from "@/lib/srd/resource-limits";

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

// What spending the feature costs of a turn in a fight. "none" is a feature
// used on the character's own turn for nothing (Action Surge). Absent means
// the feature's many uses cost different things (Ki, Channel Divinity
// options, the genre counters) and the turn budget is left to the tool that
// resolves the effect.
export type ResourceAction = "action" | "bonus" | "none";

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
  // The classes whose feature this counter belongs to. A feature of the
  // same name granted by any other class is not this feature: the grifter's
  // Vanish is counted, the ranger's is not.
  grantedBy?: string[];
  displayName: string;
  // classId is the class whose level sized the counter, when one did.
  maxFor: (level: number, abilityMods: Record<string, number>, classId?: string) => number;
  recharge: Recharge;
  effect: ResourceEffect;
  action?: ResourceAction;
  // Never spent by choice: the server burns it on a trigger of its own, so
  // use_resource refuses rather than wasting the charge.
  passive?: boolean;
  // The character level the counter starts at (a tiefling's hellish rebuke
  // at 3rd); below it the sheet holds no counter.
  minLevel?: number;
  // When the refill depends on the level the counter is held at (Bardic
  // Inspiration comes back on a short rest from bard 5, Font of
  // Inspiration). Overrides `recharge` for rests that know the sheet.
  rechargeFor?: (level: number) => Recharge;
  // Never refilled by a rest: the DM gives it back (Inspiration).
  noRefill?: boolean;
  // One line of SRD truth handed back to the model in the tool result, so a
  // spend never leaves it guessing what the feature does.
  guidance: string;
  // Feature-name variants that RAISE the count when the character has them
  // ("Adrenal Override (2 uses)" upgrades "Adrenal Override"). Checked in
  // populateResources against the sheet's actual features.
  upgrades?: Array<{ match: string; uses: number }>;
};

function rageUses(level: number): number {
  // Primal Champion's table row: unlimited.
  if (level >= 20) return UNLIMITED_USES;
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

// Dragonborn breath weapon: d6s that grow with character level. The save and
// damage type a spend reports are the ancestry's (src/lib/srd/aoe-spend.ts);
// the Dexterity save below stands for a dragonborn stored without one.
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
    action: "bonus",
    effect: { kind: "condition", condition: RAGING, rounds: 10 },
    guidance:
      "A bonus action. Raging for up to 1 minute: resistance to bludgeoning, piercing, and slashing damage, bonus damage on melee Strength attacks, and advantage on Strength checks and saves, none of it while wearing heavy armor. The server applies all of it; the rage ends early if they end it, fall unconscious, or end a turn without having attacked or taken damage since their last one.",
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
    action: "bonus",
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
    action: "none",
    effect: { kind: "narrative" },
    guidance:
      "One additional action this turn, on top of the regular one. Resolve the extra action with its own tool call (a second pc_attack, a cast, a Dash).",
  },
  {
    id: "channel_divinity",
    classIds: ["cleric", "paladin"],
    match: ["channel divinity"],
    displayName: "Channel Divinity",
    // The paladin's table gives one use at every level; only the cleric's
    // grows.
    maxFor: (level, _mods, classId) => (classId === "paladin" ? 1 : channelUses(level)),
    recharge: "short",
    effect: { kind: "narrative" },
    guidance:
      "Divine power channelled into a subclass effect. Pass variant to have the server resolve it: 'turn undead' (every undead within 30 feet makes a WIS save against the spell DC; a failure is turned for a minute, and from cleric 5 an undead at or under the Destroy Undead CR is destroyed instead), 'sacred weapon' (Oath of Devotion: +CHA to weapon attack rolls for a minute), 'preserve life' (Life Domain: heals up to 5 x cleric level split among targetCharacterIds, none past half their maximum). Never apply turned or frightened by hand: the save decides it.",
  },
  {
    id: "bardic_inspiration",
    classIds: ["bard"],
    match: ["bardic inspiration"],
    displayName: "Bardic Inspiration",
    maxFor: (_level, mods) => Math.max(1, mods.cha ?? 0),
    // SRD: refills on a long rest, and from bard 5 (Font of Inspiration) on
    // a short rest too.
    recharge: "long",
    rechargeFor: (level) => (level >= 5 ? "short" : "long"),
    action: "bonus",
    effect: { kind: "inspire", die: inspirationDie },
    guidance:
      "The target keeps the inspiration die for up to 10 minutes and adds it to one ability check, attack roll, or saving throw. The server hands it to them and spends it on their next roll automatically. From bard 5 (Font of Inspiration) the uses come back on a short rest too.",
  },
  {
    id: "wild_shape",
    classIds: ["druid"],
    match: ["wild shape"],
    displayName: "Wild Shape",
    // Archdruid, at druid 20: unlimited.
    maxFor: (level) => (level >= 20 ? UNLIMITED_USES : 2),
    recharge: "short",
    action: "action",
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
    action: "action",
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
    action: "action",
    effect: { kind: "aoe", dice: breathDice, save: "dex" },
    guidance:
      "A cone or line of the dragonborn's ancestral damage type. Resolve it with aoe_damage using the dice, save, DC and damage type this call reports (the ancestry sets the type and the save).",
  },
  {
    id: "indomitable",
    classIds: ["fighter"],
    // "Indomitable (1 use)"; the barbarian's Indomitable Might is another
    // feature altogether, which the granting class tells apart.
    grantedBy: ["fighter"],
    match: ["indomitable"],
    displayName: "Indomitable",
    maxFor: (level) => (level >= 17 ? 3 : level >= 13 ? 2 : 1),
    recharge: "long",
    effect: { kind: "narrative" },
    guidance:
      "The fighter rerolls the saving throw they last failed and must use the new roll. The server rerolls it; on a success the condition that save put on them comes off.",
  },
  {
    id: "cleansing_touch",
    classIds: ["paladin"],
    grantedBy: ["paladin"],
    match: ["cleansing touch"],
    displayName: "Cleansing Touch",
    maxFor: (_level, mods) => Math.max(1, mods.cha ?? 0),
    recharge: "long",
    action: "action",
    effect: { kind: "narrative" },
    guidance:
      "An action that ends one spell on the paladin or on a willing creature they touch. Clear what the spell left with clear_condition.",
  },
  {
    id: "stroke_of_luck",
    classIds: ["rogue"],
    grantedBy: ["rogue"],
    match: ["stroke of luck"],
    displayName: "Stroke of Luck",
    maxFor: () => 1,
    recharge: "short",
    effect: { kind: "narrative" },
    guidance:
      "An attack that missed a target in range hits instead, or a failed ability check is treated as a 20 on the d20.",
  },
  ...LATE_RESOURCE_DEFS,
  ...[6, 7, 8, 9].map(
    (spellLevel): ResourceDef => ({
      id: `mystic_arcanum_${spellLevel}`,
      classIds: ["warlock"],
      grantedBy: ["warlock"],
      match: [`mystic arcanum (${spellLevel}th level)`],
      exact: true,
      displayName: `Mystic Arcanum (${spellLevel}th level)`,
      maxFor: () => 1,
      recharge: "long",
      effect: { kind: "narrative" },
      guidance: `The warlock's one ${spellLevel}th level arcanum is cast once without a spell slot, and again only after a long rest. Resolve the spell with its own tool.`,
    }),
  ),
];

// The custom genre-class counters, generated from the *-features.json
// catalogs by scripts/generate-class-resources.mjs. Each is a plain
// limited-use narrative feature: the server spends the use and hands the
// model the SRD-style guidance line, exactly like Ki or Action Surge.
type CustomResourceRow = {
  id: string;
  displayName: string;
  match: string[];
  // The genre classes that have the feature.
  classes?: string[];
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
  // A genre counter belongs to the feature of exactly that name, granted by
  // the class it was written for. Containing its words is not enough: a
  // rigger's Hardened Uplink is not the road warrior's Hardened.
  exact: true,
  ...(row.classes?.length ? { grantedBy: row.classes } : {}),
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
  // Pools sized by character level (Balm of the Summer Court, Healing Light),
  // times `levelTimes`, plus an ability modifier (the Arcane Ward: twice the
  // wizard level plus Intelligence).
  byLevel?: boolean;
  levelPlus?: number;
  levelTimes?: number;
  plusAbility?: "str" | "dex" | "con" | "int" | "wis" | "cha";
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
      return Math.max(1, level * (row.levelTimes ?? 1) + (row.levelPlus ?? 0) + (row.plusAbility ? (mods[row.plusAbility] ?? 0) : 0));
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

// The spells a race casts once a day by nature (a tiefling's hellish rebuke
// from 3rd level, darkness from 5th; a drow's faerie fire and darkness), on
// the trait that carries them. Below the level the spell arrives at the
// counter has no use, and populateResources leaves it off the sheet.
// One counter per spell: a tiefling's darkness and a drow's are the same
// counter on two traits.
const ORDINAL = ["", "1st", "2nd", "3rd"];
const INNATE_RESOURCE_DEFS: ResourceDef[] = [
  ...new Map(innateSpellCounterRows().map((row) => [row.id, row])).values(),
].map((row) => {
  const rows = innateSpellCounterRows().filter((entry) => entry.id === row.id);
  return {
    id: row.id,
    match: [...new Set(rows.map((entry) => entry.trait))],
    displayName: row.spell,
    maxFor: () => 1,
    minLevel: Math.min(...rows.map((entry) => entry.gainedAt)),
    recharge: "long",
    effect: { kind: "narrative" },
    guidance: `${row.spell} once, cast as a ${ORDINAL[row.castAt] ?? `${row.castAt}th`}-level spell, and again after a long rest.`,
  };
});

export const RESOURCE_DEFS: ResourceDef[] = [
  ...SRD_RESOURCE_DEFS,
  ...CUSTOM_RESOURCE_DEFS,
  ...SUBCLASS_RESOURCE_DEFS,
  ...INNATE_RESOURCE_DEFS,
  ...COMBAT_RESOURCE_DEFS,
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

// The level a resource counter scales by, and the class it came from.
// Single-class (no class list): the character level, exactly as before, from
// the class that granted the feature. Multiclass: the def's own class when
// the sheet has levels in it, else the level of the class that granted the
// matching feature, else the character level (race features like Breath
// Weapon scale by character level, per RAW).
function resourceLevelFor(
  def: ResourceDef,
  grantingClassId: string | undefined,
  level: number,
  classes: Array<{ id: string; level: number }> | undefined,
): { level: number; classId: string | undefined } {
  const granting = grantingClassId?.toLowerCase();
  if (!classes?.length || classes.length < 2) {
    return { level, classId: granting ?? classes?.[0]?.id.toLowerCase() };
  }
  const levelOf = (classId: string) =>
    classes.find((entry) => entry.id.toLowerCase() === classId.toLowerCase())?.level ?? 0;
  for (const classId of def.classIds ?? []) {
    const held = levelOf(classId);
    if (held > 0) {
      return { level: held, classId: classId.toLowerCase() };
    }
  }
  if (granting) {
    const held = levelOf(granting);
    if (held > 0) {
      return { level: held, classId: granting };
    }
  }
  return { level, classId: granting };
}

const plainName = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9()]+/g, " ").trim();

// "Hardened (2 uses)" is the feature Hardened, grown: the suffix is what an
// upgrade line adds to the name of the feature it upgrades.
const withoutUses = (name: string) => name.replace(/\s*\((?:\d+|[a-z]+) uses?\)\s*$/i, "");

// Whether a feature on a sheet is the one this counter belongs to: the name
// matches (exactly for the defs that ask for it, as whole words otherwise),
// and the class that granted the feature is one the counter was written for.
// A feature that names no class (story grants, sheets written before the
// class was kept) is matched on its name alone.
function featureHolds(def: ResourceDef, feature: { name: string; classId?: string }): boolean {
  if (def.grantedBy?.length && feature.classId) {
    const granting = feature.classId.toLowerCase();
    if (!def.grantedBy.some((classId) => classId.toLowerCase() === granting)) {
      return false;
    }
  }
  const name = feature.name.trim().toLowerCase();
  return def.match.some((fragment) => {
    if (name === fragment || plainName(withoutUses(name)) === plainName(fragment)) {
      return true;
    }
    if (def.upgrades?.some((upgrade) => plainName(upgrade.match) === plainName(name))) {
      return true;
    }
    return !def.exact && containsWord(name, fragment);
  });
}

// The "(N uses)" a feature's own name states, which is the count its class
// table gives at that level.
function usesNamed(name: string): number | null {
  const stated = /\((\d+) uses?\)\s*$/i.exec(name.trim());
  return stated ? Number(stated[1]) : null;
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
  const matched = sheet.features?.find((feature) => featureHolds(def, feature));
  return resourceLevelFor(def, matched?.classId, sheet.level, sheet.classes).level;
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
  for (const def of RESOURCE_DEFS) {
    const held = features.filter((feature) => featureHolds(def, feature));
    const matched = held[0];
    if (!matched) {
      continue;
    }
    const scaled = resourceLevelFor(def, matched.classId, level, classes);
    if (def.minLevel && level < def.minLevel) {
      // A use the character has not reached yet (a tiefling's hellish
      // rebuke before 3rd level) is no counter at all.
      continue;
    }
    let max = def.maxFor(scaled.level, abilityMods, scaled.classId);
    // A feature that upgrades this one raises the ceiling: by the row the
    // catalog wrote for it, or by the count its own name states.
    for (const feature of held) {
      const name = feature.name.trim().toLowerCase();
      const row = def.upgrades?.find((upgrade) => plainName(upgrade.match) === plainName(name));
      const stated = def.upgrades ? usesNamed(name) : null;
      max = Math.max(max, row?.uses ?? 0, stated ?? 0);
    }
    const used = Math.min(existing?.[def.id]?.used ?? 0, max);
    out[def.id] = { max, used };
  }
  // Inspiration belongs to no feature: the DM awarded it, and it stays until
  // it is spent.
  if (existing?.inspiration) {
    out.inspiration = existing.inspiration;
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
