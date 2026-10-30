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
      "Resolve an enemy or hazard forcing a saving throw on ONE character (a hag's Hold Person, a spider's web, a trap's poison needle, a curse). The server rolls the character's save from their sheet (Evasion, Brave included) and applies the damage or condition on a failure. When an enemy does it (casterEnemyId, with enemyAbility or spell), it is the enemy's action for the round (refused if it already acted, cannot act, or is charmed by the target); the save, DC, dice and condition come from its block or the spell whatever you send, a Recharge ability must have recharged, and a spell spends its slot. Only a hazard with no creature behind it uses your own numbers. For several characters caught, use aoe_damage; never set a condition with set_condition when a save should have decided it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        source: { type: "string", description: "What forces the save ('the hag's Hold Person')." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "Required for a hazard with no creature behind it (a trap's needle). An enemy's ability or spell brings its own.",
        },
        dc: { type: "integer", minimum: 1, maximum: 30, description: "Required with saveAbility for a hazard." },
        damage: {
          type: "string",
          description: "Damage dice on a failed save ('3d6'). Omit for pure-condition effects.",
        },
        damageType: { type: "string", description: "Damage type (poison)." },
        halfOnSave: {
          type: "boolean",
          description: "True for half damage on a successful save. Default: false.",
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
            "The enemy doing it, when a specific one does: exact enemyId from GAME STATE. The server tracks a concentration spell's concentration.",
        },
        enemyAbility: {
          type: "string",
          description: "With casterEnemyId: the ability's name as its block lists it ('Poison Spit', 'Frightful Presence').",
        },
        spell: {
          type: "string",
          description: "With casterEnemyId: a spell on the enemy's list ('Hold Person').",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["characterId"],
    },
  },
};

export const castAtEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_at_enemy",
    description:
      "Resolve a player casting a saving-throw or automatic spell at ONE enemy (Hold Person, Hypnotic Pattern, Magic Missile, Heat Metal, Dispel Magic on a hasted enemy). The server spends the slot (a warlock's pact slot when no level is named), takes the save, DC, damage and conditions from the spell, rolls the enemy's save and applies the result. An area or multi-target spell may go one enemy per call in the same turn for one slot (aoe_damage resolves the whole area in one call). Polymorph or True Polymorph is refused before the slot on a beast above the target's challenge rating, a shapechanger or a creature at 0 HP. For attack-roll spells, use pc_attack.",
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
          description: "Damage dice on a failed save ('3d8'). Omit for pure-condition spells.",
        },
        damageType: { type: "string", description: "Damage type (psychic)." },
        halfOnSave: {
          type: "boolean",
          description: "True for half damage on a successful save. Default: false.",
        },
        condition: {
          type: "string",
          description:
            "Condition applied on a failed save (paralyzed). A known spell applies its own; for a spell with a choice name the chosen one (Blindness/Deafness 'deafened', Eyebite 'sickened', Command's word 'grovel', Heat Metal 'armor' when the object is worn).",
        },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "Rounds the condition lasts, for a spell the server does not know. Omit for save-ends (a save at the end of each round).",
        },
        darts: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description:
            "Magic Missile only: the darts that strike this enemy. Default: all of them. The rest go to other enemies in more calls this turn, with no second slot.",
        },
        endSpell: {
          type: "string",
          description: "Dispel Magic only: the spell to end on the target when it holds several; omit to end them all.",
        },
        overchannel: {
          type: "boolean",
          description:
            "Evoker's Overchannel (14th level): a 1st to 5th level wizard spell deals its maximum damage. The first use each long rest is free; later ones cost the wizard necrotic damage the server rolls.",
        },
        secondTargetEnemyId: {
          type: "string",
          description:
            "Improved Reaper only: a second enemy within 5 feet of the first, exact enemyId from GAME STATE. A Death cleric's 17th-level feature for a 1st to 5th level necromancy spell; the server rolls both saves and the HP it costs.",
        },
        variant: {
          type: "string",
          description: "Polymorph and True Polymorph only: the form (a beast; any creature for True).",
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

// ---- cast_buff ----

export const castBuffTool: ToolDef = {
  type: "function",
  function: {
    name: "cast_buff",
    description:
      "Resolve a player casting a spell that grants an ongoing effect to themselves or allies, a summoning, Find Familiar, Animal Shapes, Shapechange, or Polymorph at an enemy. The server spends the slot (a warlock's pact slot when no level is named) and applies the effect's real mechanics and duration, Spirit Guardians' damage at each enemy's turn start too.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "The caster: exact characterId from GAME STATE." },
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
          maxItems: 12,
          description: "Who receives the effect: exact characterIds from GAME STATE. Default: the caster.",
        },
        targetEnemyId: {
          type: "string",
          description:
            "The creature the spell marks, targets or buffs: exact enemyId from GAME STATE. Hunter's Mark, Hex, Dispel Magic, Polymorph (the form in variant), or a buff on a creature on the caster's side that is no character.",
        },
        variant: {
          type: "string",
          description:
            "For a spell with a choice: the chosen option, or the beast or creature made ('wolf', 'skeleton'). Enlarge/Reduce, Protection from Energy's damage type, Enhance Ability's effect, Fire Shield's warm or chill, a form, or a summoning's creature (Animate Dead 'skeleton' or 'reassert control', Find Steed 'warhorse' or 'fey warhorse', Animate Objects 'tiny').",
        },
        count: {
          type: "integer",
          minimum: 1,
          maximum: 40,
          description: "A summoning spell only: fewer creatures than the slot allows. Default: the most.",
        },
        endSpell: {
          type: "string",
          description: "Dispel Magic only: the spell to end on the target when it holds several; omit to end them all.",
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
