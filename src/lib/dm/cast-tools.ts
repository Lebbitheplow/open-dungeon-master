// The cast tools' definitions: cast_at_enemy (src/lib/dm/cast-at-enemy.ts),
// cast_buff (src/lib/dm/cast-buff.ts) and cast_at_player, and the enemy's
// concentration tracking. A player's spell spends its slot through the one
// cast guard (src/lib/dm/cast-guard.ts); the model never adjudicates the
// save or the effect. This module imports mutations (for the slot spend)
// and must never be imported by it.

import { ZONE_ARGS } from "@/lib/dm/zone-args";

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const castAtPlayerTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_at_player",
    description:
      "An enemy or hazard forces a saving throw on ONE character (a hag's Hold Person, a spider's web, a trap's poison needle, a curse). The server rolls that character's full save from their real sheet (Evasion, Brave and the like included), applies the damage and/or condition on a failure, and reports it. When an enemy does it, pass casterEnemyId and the ability (a name from its block) or the spell (one on its list): that is the enemy's action for the round (refused if it already acted, cannot act, or is charmed by the target), the save, DC, dice and condition come from its block or the spell whatever you send, a Recharge ability must have recharged, and a spell spends the enemy's slot. Only a hazard with no creature behind it uses your own numbers. Use aoe_damage when several characters are caught, and never apply a condition to a character with set_condition when a save should have decided it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        source: { type: "string", description: "What forces the save, e.g. 'the hag's Hold Person'." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "The save the effect forces.",
        },
        dc: { type: "integer", minimum: 1, maximum: 30, description: "The save DC." },
        damage: {
          type: "string",
          description: "Damage dice on a failed save, e.g. '3d6'. Omit for pure-condition effects.",
        },
        damageType: { type: "string", description: "Damage type, e.g. poison." },
        halfOnSave: {
          type: "boolean",
          description: "True = half damage on a successful save (default false: no effect).",
        },
        condition: { type: "string", description: "Condition applied on a failed save." },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "How long the condition lasts. Omit for save-ends: they re-save each round.",
        },
        casterEnemyId: {
          type: "string",
          description:
            "When a specific enemy does this: its enemyId from GAME STATE. It spends the enemy's action; with a concentration spell the server tracks the enemy's concentration and breaks it (ending the effect) when the enemy takes damage or dies.",
        },
        ability: {
          type: "string",
          description: "With casterEnemyId: the ability's name as its block lists it, e.g. 'Poison Spit' or 'Frightful Presence'.",
        },
        spell: {
          type: "string",
          description: "With casterEnemyId: a spell on the enemy's list, e.g. 'Hold Person'.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId", "saveAbility", "dc"],
    },
  },
};

export const castAtEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_at_enemy",
    description:
      "A player casts a saving-throw or automatic spell at ONE enemy (Hold Person, Hypnotic Pattern, Magic Missile, Heat Metal, Dispel Magic on a hasted enemy). The server spends the slot (a warlock's pact slot when no level is named), derives the save, the DC, the damage and the conditions from the spell itself, rolls the enemy's save from its real stats, and applies the result; the model's numbers are corrected. It also applies what the spell does beyond that: Thunderwave's push, Vicious Mockery's disadvantage, Harm's shrunken maximum, Charm Person's advantage in a fight, Blight on a plant, Command's word, Eyebite's form, Divine Word's tiers, and the saves that come at the end of the target's turns (Phantasmal Killer, Flesh to Stone). An area or multi-target spell may be resolved one enemy per call in the same turn and costs one slot (aoe_damage resolves the whole area in one call). A concentration spell's later turns (Heat Metal, Flaming Sphere) spend no slot. Polymorph or True Polymorph at an enemy comes here (or to cast_buff) with the beast in variant: the server refuses a beast above the creature's challenge rating, a shapechanger or a creature at 0 HP before the slot, rolls its WIS save, and on a failure gives it the beast's stat block and hit points until the form drops to 0 or the spell ends. Use pc_attack for attack-roll spells.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        targetEnemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        spell: { type: "string", description: "Exact spell name from the caster's list." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "The save the spell forces.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend. Omit for cantrips.",
        },
        damage: {
          type: "string",
          description: "Damage dice on a failed save, e.g. '3d8'. Omit for pure-condition spells.",
        },
        damageType: { type: "string", description: "Damage type, e.g. psychic." },
        halfOnSave: {
          type: "boolean",
          description: "True = half damage on a successful save (default false: no effect).",
        },
        condition: {
          type: "string",
          description:
            "Condition applied on a failed save, e.g. paralyzed. For a known spell the spell's own applies; for one with a choice name the chosen one: Blindness/Deafness blinded or deafened, Eyebite unconscious, frightened or sickened, Command's word (grovel, halt), Heat Metal 'armor' when the heated object is worn.",
        },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "How many rounds the condition lasts, for a spell the server does not know. Omit for save-ends: the enemy re-saves at the end of each round.",
        },
        darts: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description:
            "Magic Missile: how many of the casting's darts strike this enemy. The rest can go to other enemies in more calls this turn, with no second slot.",
        },
        endSpell: {
          type: "string",
          description: "Dispel Magic: the spell to end on the target when it holds several; omit to end them all.",
        },
        overchannel: {
          type: "boolean",
          description:
            "A School of Evocation wizard's Overchannel (14th level): a 1st to 5th level wizard spell deals its maximum damage. The first use each long rest is free; after that the server rolls the necrotic damage it costs the wizard.",
        },
        secondTargetEnemyId: {
          type: "string",
          description:
            "A Death cleric's Improved Reaper (17th level): a second enemy within 5 feet of the first, struck by the same 1st to 5th level necromancy spell from the same slot. The server rolls both saves and takes 1d8 of the cleric's hit points per spell level.",
        },
        variant: {
          type: "string",
          description: "Polymorph and True Polymorph: the beast the enemy becomes, e.g. 'brown bear', 'wolf', 'giant spider'.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
        ...ZONE_ARGS,
      },
      required: ["characterId", "targetEnemyId", "spell"],
    },
  },
};

// The single-target save spell tool, its redirects and the Sleep pool live
// in src/lib/dm/cast-at-enemy.ts; re-exported for the callers that have
// always found them here.
export { castRedirect, handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
export { sleepPool } from "@/lib/dm/spell-pool";

// ---- cast_buff ----

export const castBuffTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_buff",
    description:
      "A player casts a spell that grants an ongoing effect to themselves or allies (Bless, Mage Armor, Haste, Shield of Faith, Aid, Heroism, Spirit Guardians, Magic Weapon, Death Ward, Beacon of Hope, Hunter's Mark, Invisibility...). The server spends the slot (a warlock's pact slot when no level is named), applies the effect as a tracked condition with its real mechanics (AC, attack/save dice, resistances, speed, hit points, Spirit Guardians' damage at each enemy's turn start) and duration, and handles concentration: ending it ends only this casting's effects. Dispel Magic goes here too, with the target. A summoning spell goes here with the creature in variant (Conjure Animals 'wolf', Animate Dead 'skeleton', Giant Insect 'spider', Find Steed 'warhorse', Animate Objects 'tiny', Faithful Hound...): the server checks the kind and challenge rating the slot allows, spends the slot, and brings the creatures in as allies with their SRD stat blocks, tokens and initiative. Find Familiar goes here with the form in variant (the familiar is bound as the caster's pet); Animal Shapes and Shapechange with the beast in variant, as Polymorph. Polymorph at an enemy takes targetEnemyId and the beast in variant: the creature saves (WIS) and on a failure becomes the beast; any other buff refuses a targetEnemyId it cannot honour (only Hunter's Mark, Hex and Dispel Magic take one). Freedom of Movement, Spider Climb, Water Walk, Jump, See Invisibility, True Seeing, Blink, Etherealness, Mislead, Gaseous Form and Wind Walk go here too. Call this INSTEAD of narrating a buff; set_condition refuses a spell's effect.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId of the caster from GAME STATE." },
        spell: { type: "string", description: "Exact spell name from the caster's list." },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend. Omit for cantrips.",
        },
        targetCharacterIds: {
          type: "array",
          items: { type: "string" },
          description: "Who receives the effect (characterIds). Defaults to the caster.",
        },
        targetEnemyId: {
          type: "string",
          description:
            "Hunter's Mark and Hex: the enemyId of the marked creature (the extra die rides only against it). Dispel Magic: the enemy whose spells end. Polymorph and True Polymorph: the enemy to turn into the beast in variant. Any other spell refuses it.",
        },
        variant: {
          type: "string",
          description:
            "For spells with a choice: Enlarge/Reduce, Protection from Energy's damage type, Enhance Ability's effect, Fire Shield's warm or chill, Polymorph's beast, a summoning spell's creature.",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 40,
          description: "A summoning spell: fewer creatures than the slot allows (the most by default).",
        },
        endSpell: {
          type: "string",
          description: "Dispel Magic: the spell to end when the target holds several; omit to end them all.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId", "spell"],
    },
  },
};

// The handler lives in src/lib/dm/cast-buff.ts; re-exported for the
// dispatch that has always found it here.
export { handleCastBuff } from "@/lib/dm/cast-buff";

// cast_at_player and the enemy concentration it tracks live in
// src/lib/dm/cast-at-player.ts; re-exported for the callers that have always
// found them here.
export { handleCastAtPlayer, trackEnemyConcentration } from "@/lib/dm/cast-at-player";
