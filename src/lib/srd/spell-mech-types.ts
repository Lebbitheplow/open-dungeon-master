// The shape of a spell's structured mechanics (src/lib/srd/spell-mechanics.ts).
// Kept apart from the rows (spell-mech-overrides.ts) so the row table and the
// parsers can both name it without importing each other.

import type { SaveAbilityId } from "@/lib/srd/condition-effects";

// A condition a failed save (or a hit) lays on the target.
export type SpellCondition = {
  name: string;
  // Rounds it lasts; absent with saveEnds false means until the spell ends
  // or something else ends it (Geas, a creature knocked prone).
  rounds?: number;
  // A repeat save at the end of each round ends it (Hold Person).
  saveEnds?: boolean;
  // Conditions that land with it and end with it: Hypnotic Pattern's
  // charmed creature is also incapacitated, Hideous Laughter's is prone.
  also?: string[];
  // The caster picks one (Blindness/Deafness); the first is the default.
  variants?: string[];
  // Ends the moment the creature takes damage (Sleep, Hypnotic Pattern).
  endsOnDamage?: boolean;
  // Each time the creature takes damage it saves again (Dominate Person),
  // with advantage for Hideous Laughter.
  saveOnDamage?: "normal" | "advantage";
  // No saving throw: it takes hold of a creature with this many hit points
  // or fewer and does nothing to one with more (Power Word Stun).
  hpAtMost?: number;
  // No saving throw when cast; the repeat save is the way out
  // (Irresistible Dance).
  noInitialSave?: boolean;
  // Damage at the start of each of the target's turns unless it saves, a
  // save ending the spell for it. `noSave`: the damage lands with no save
  // and nothing ends it but the condition (Black Tentacles' crushing grip).
  turnStart?: { dice: string; perSlotLevel?: string; baseLevel: number; type: string; noSave?: boolean };
  // The same at the END of each of the target's turns (Phantasmal Killer,
  // Weird). With no dice, the save is a tally instead (Flesh to Stone: three
  // failures and the creature is petrified, three successes and it is free).
  turnEnd?: { dice?: string; perSlotLevel?: string; baseLevel: number; type?: string; tally?: { fails: number; becomes: string } };
  // The condition lasts until the end of the target's next turn (Vicious
  // Mockery), or until the caster's next turn starts (Sunbeam).
  endsWith?: "target turn end" | "caster turn start";
  // What the caster's chosen word or form adds to the condition (Command's
  // Grovel lays the creature prone, Halt stops it for its turn). The key is
  // what the caller names in `condition`.
  choices?: Record<string, string[]>;
  // The creature frees itself with its action and a check of one of these
  // abilities against the caster's DC (Entangle, Web: Strength; Black
  // Tentacles: Strength or Dexterity).
  escape?: Array<"str" | "dex" | "int">;
  // A fixed DC for that check instead of the caster's (Maze: 20).
  escapeDc?: number;
  // The way out is a saving throw spent as an action, not a check
  // (Irresistible Dance: Wisdom).
  escapeSave?: "wis";
  // How a chosen variant differs from the rest (Eyebite's Asleep ends on
  // damage, its Sickened saves again at the end of each turn).
  variantRules?: Record<string, Pick<SpellCondition, "rounds" | "saveEnds" | "endsOnDamage">>;
};

// What a failed save does besides damage and a condition (SRD 5.1):
// Thunderwave's push, Harm's shrunken maximum, Sleet Storm's concentration
// save, Stinking Cloud's lost action. Read by cast_at_enemy and aoe_damage
// (src/lib/dm/spell-riders.ts).
export type SpellSaveRiders = {
  // Pushed this many feet straight away from the caster, on a battle map.
  pushFeet?: number;
  // The damage cannot take the creature below 1 hit point (Harm).
  hpFloor?: number;
  // A failed save shrinks the hit point maximum by the damage taken (Harm).
  shrinksMaxHp?: boolean;
  // A concentrating creature caught makes this save or loses concentration
  // (Sleet Storm: Constitution).
  concentrationSave?: "con";
  // The creature loses its action on its next turn (Stinking Cloud).
  losesAction?: boolean;
  // Heat Metal: the holder saves (CON) or drops the object; one who keeps it
  // (or wears it) has disadvantage on attacks and checks until the caster's
  // next turn.
  gripSave?: "con";
  // The save is made with advantage while the caster's party fights the
  // creature (Charm Person).
  advantageInFight?: boolean;
  // Creature types that save with disadvantage (Blight: plants; Sunbeam:
  // undead and oozes), and that take the dice's maximum (Blight: plants).
  saveDisadvantageFor?: string[];
  maxDamageFor?: string[];
  // Divine Word: by the creature's hit points after the failed save, the
  // conditions it gets and for how long; `dies` kills it outright.
  hpTiers?: Array<{ atMost: number; conditions: string[]; rounds?: number; dies?: boolean }>;
  // A creature the spell drops to 0 hit points is disintegrated: a character
  // is dead, not dying (Disintegrate).
  disintegrates?: boolean;
  // Acid Splash: each creature after the first stands within this many feet
  // of another creature the casting struck.
  clusterFeet?: number;
  // The damage lands whatever the save; the save decides only the condition
  // (Feeblemind's 4d6 psychic).
  damageIgnoresSave?: boolean;
  // Creatures of these types that fail are sent back to their home plane and
  // leave the fight (Divine Word: celestials, elementals, fey, fiends).
  returnsHome?: string[];
};

// A damaging aura around the caster (Spirit Guardians): an enemy that starts
// its turn inside it saves or takes the dice, half on a success.
export type SpellAura = {
  radiusFeet: number;
  save: SaveAbilityId;
  dice: string;
  perSlotLevel?: string;
  baseLevel: number;
  type: string;
  halfOnSave: boolean;
};

export type SpellMech = {
  // How the spell resolves at the table:
  //   attack  - spell attack roll: pc_attack
  //   save    - target saves: cast_at_enemy / cast_at_player / aoe_damage
  //   auto    - hits without roll or save (magic missile): damage applies
  //   heal    - restores hit points: heal
  //   buff    - grants an effect condition to self/allies: cast_buff
  //   summon  - conjures creatures: add_enemies / add_companion + narration
  //   utility - everything else; narrated
  resolution: "attack" | "save" | "auto" | "heal" | "buff" | "summon" | "utility";
  save?: SaveAbilityId;
  halfOnSave?: boolean;
  damageType?: string;
  // Two damage types in one blast (Meteor Swarm: 20d6 fire and 20d6
  // bludgeoning; Flame Strike: fire and radiant; Ice Storm: bludgeoning and
  // cold): the last dice of the damage expression deal this type, the rest
  // `damageType`, and each meets its own resistance (src/lib/dm/aoe-parts.ts).
  secondType?: string;
  // A melee or ranged spell attack (Inflict Wounds is melee, Fire Bolt is
  // ranged): a melee one is made at touch reach.
  attack?: "melee" | "ranged";
  // Condition applied to the target on a failed save (or on a hit).
  condition?: SpellCondition;
  // The spell deals no damage, whatever dice its text mentions in passing
  // (Web's burning strands, Hypnotic Pattern).
  noDamage?: boolean;
  // The effect condition cast_buff applies. `rounds` in combat rounds
  // (1 minute = 10). `variants` for spells with a choice (enlarge/reduce);
  // the first is the default. `tempHp` grants temporary hit points at cast
  // time, scaled per slot level above the spell's own.
  buff?: {
    condition: string;
    target: "self" | "ally" | "allies";
    rounds: number;
    variants?: string[];
    tempHp?: { base: number; perSlotLevel?: number; dice?: string };
    // Aid: the hit point maximum and current hit points rise by this much,
    // and fall back when the spell ends.
    maxHp?: { base: number; perSlotLevel?: number };
    // Heroism: temporary hit points equal to the caster's spellcasting
    // modifier at the start of each of the target's turns.
    tempHpEachTurn?: boolean;
    // The condition's name carries the slot's bonus (Magic Weapon: +1, +2
    // from a 4th level slot, +3 from a 6th): [slot level, variant] pairs.
    bySlot?: Array<[number, string]>;
  };
  aura?: SpellAura;
  // Dice the prose cannot be read for (a garbled upcast line): the base
  // expression at `baseLevel` and what each slot level above it adds.
  dice?: { base: string; perSlotLevel?: string; baseLevel: number };
  // Magic Missile: so many darts, one more for each slot level above the
  // spell's own, each dealing `each`. They hit without a roll.
  darts?: { count: number; perSlotLevel: number; each: string };
  // Several attack rolls from one casting: Eldritch Blast's beams grow with
  // the caster's level (two at 5th, three at 11th, four at 17th), Scorching
  // Ray's rays with the slot.
  attacks?: { count: number; perSlotLevel?: number; byCasterLevel?: boolean };
  // Sleep and Color Spray: a pool of hit points rolled once for the casting
  // and no saving throw, spent from the creature with the fewest hit points
  // up. A creature with more hit points than what is left is untouched.
  hitPointPool?: {
    dice: string;
    perSlotLevel: string;
    condition: string;
    rounds: number;
    // Creature types the spell passes over (Sleep: undead).
    immuneTypes?: string[];
    // A condition immunity that makes a creature immune (Sleep: charmed).
    immuneCondition?: string;
    // Creatures already holding one of these are passed over (Color Spray
    // skips the unconscious and the blinded).
    skipConditions?: string[];
    endsOnDamage?: boolean;
  };
  // How many creatures one casting may affect, and how many more each slot
  // level above the spell's own adds. Absent means one, or with `area` every
  // creature in the area.
  targets?: { count: number; perSlotLevel?: number };
  // An area spell: one casting reaches every creature in its area, resolved
  // in one aoe_damage call (or cast_at_enemy calls in the same turn).
  area?: boolean;
  // The area's size in feet (a radius, a cube's side, a cone's or a line's
  // length): how far past the spell's range a caught creature may stand.
  areaFeet?: number;
  // While the caster concentrates, the effect comes again at this cost and
  // no slot: an action (Call Lightning), a bonus action (Heat Metal,
  // Flaming Sphere), or nothing of the caster's (Moonbeam, Cloudkill: it
  // happens on the creature's turn).
  repeat?: "action" | "bonus" | "free";
  // The creature types the spell can take hold of (Hold Person: humanoid).
  // Absent means any.
  targetTypes?: string[];
  // Creature types it has no effect on (Command: undead).
  immuneTypes?: string[];
  // A creature immune to this condition is immune to the spell (Suggestion
  // and Irresistible Dance: charmed).
  immuneIfImmuneTo?: string;
  // Revivify, Raise Dead, Resurrection: a dead creature returns, with one
  // hit point or all of them, if it died within the window.
  revive?: { hp: "one" | "all"; withinMinutes: number; ordeal?: boolean };
  // Healing that is a number, not dice (Heal: 70, +10 a slot level above).
  healing?: { flat: number; perSlotLevel?: number };
  // Hit points one casting divides among any number of creatures (Mass
  // Heal: 700); each heal call of the casting takes what it names.
  healPool?: number;
  // Dispel Magic: ends the spells on its target.
  dispel?: boolean;
  // Restoration: what the spell ends on its target, the first it holds (or
  // the one the caller names), or every one with `all` (Remove Curse).
  // "exhaustion" takes one level; "cursed" is any curse.
  cures?: { conditions: string[]; all?: boolean };
  // What a failed save does besides damage and a condition.
  riders?: SpellSaveRiders;
  // Heroes' Feast: the hit point maximum rises by these dice (and current hit
  // points by as much) for the buff's duration.
  maxHpDice?: string;
  // Regenerate: hit points regained at the start of each of the target's
  // turns while the spell lasts, and healing whose dice carry their own
  // bonus, with no spellcasting modifier added (4d8 + 15).
  regainEachTurn?: number;
  healNoModifier?: boolean;
  // One line the tool result hands the model for the parts no engine covers.
  note?: string;
};
