// The aoe_damage tool as the model is offered it (src/lib/dm/aoe-damage.ts
// resolves it). Kept apart so the handler stays readable.

import { ZONE_ARGS } from "@/lib/dm/zone-args";

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const aoeDamageTool: ToolDef = {
  type: "function",
  function: {
    name: "aoe_damage",
    description:
      "Resolve a multi-target save-or-damage effect (breath weapon, fireball, collapsing ceiling, Entangle, Hypnotic Pattern, Slow, Sleep) in ONE call. The server rolls the damage once, rolls every target's saving throw from their real stats, and applies full or half damage and the spell's conditions to each. A player's spell needs casterCharacterId: the server spends the slot once for everyone caught. Besides the riders the spell rules list, it applies Earthquake's concentration save and Chain Lightning's four targets. A creature Blink, Etherealness or Maze took away is left out of the area. A spell that stays on the ground (Web, Entangle, Grease, Moonbeam, Sleet Storm, Stinking Cloud, Cloudkill, Insect Plague, Black Tentacles, Wall of Fire, Blade Barrier) is laid on the battle map where it was cast (atX) and the server applies it from then on: its difficult ground, obscurement, and the saves and damage for creatures entering it or starting or ending a turn in it, until the concentration or the duration ends. An enemy's spell that only lays an area (Darkness, Fog Cloud, a Web with nobody in it yet) is casterEnemyId, spell and atX/atY with no targets (saveAbility and dc as its block gives them; nobody rolls): its action and slot are spent and the area laid. Never chain per-target request_roll or apply_damage calls for an area effect.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        damage: {
          type: "string",
          description:
            "Damage dice expression (8d6) or a flat integer. Omit for a player's spell that deals none (Entangle).",
        },
        type: { type: "string", description: "Damage type (slashing, fire)." },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "Required for an effect that names no spell (a trap, a collapsing ceiling). A player's spell (casterCharacterId and spell) or an enemy's ability (casterEnemyId) brings its own; omit it then.",
        },
        dc: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description: "Required with saveAbility for an effect that names no spell. A player's spell uses the caster's own spell save DC; an enemy's uses its block.",
        },
        halfOnSave: {
          type: "boolean",
          description: "True for half damage on a successful save, false for none. Default: true.",
        },
        condition: {
          type: "string",
          description: "What a failed save lays (restrained, frightened), for an effect with no spell or enemy. A spell or a block lays its own.",
        },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "With condition: the rounds it lasts. Omit and each creature repeats the save at the end of its turns.",
        },
        enemyIds: {
          type: "array",
          items: { type: "string" },
          description: "Exact enemyIds from GAME STATE caught in the effect. A player's spell on the battle map may name nobody and send its atX/atY (or towardX/towardY from the caster) instead: the server catches everyone inside.",
        },
        characterIds: {
          type: "array",
          items: { type: "string" },
          description: "Exact characterIds from GAME STATE caught in the effect.",
        },
        targets: {
          type: "string",
          description: "Fallback: comma-separated combatant names, mixed enemies and characters.",
        },
        casterCharacterId: {
          type: "string",
          description:
            "The player character casting or using this on their combat turn: exact characterId from GAME STATE. An AI companion's turn is then taken; a player's still ends with end_turn.",
        },
        casterEnemyId: {
          type: "string",
          description:
            "The ENEMY doing it, if one did: exact enemyId from GAME STATE, with enemyAbility or spell. It is the enemy's action for the round (refused if it already acted, cannot act, or is charmed by a target); the save, DC, dice and condition come from the block or the spell whatever you send, a Recharge ability must have recharged, and a spell spends the enemy's slot. A concentration spell is tracked and ends when the enemy's concentration breaks or it dies.",
        },
        enemyAbility: {
          type: "string",
          description: "With casterEnemyId: the ability's name as its block lists it ('Fire Breath', 'Wing Attack').",
        },
        spell: {
          type: "string",
          description:
            "The spell being cast (Fireball); its real dice, save, DC and conditions override the numbers above. An enemy's needs casterEnemyId.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 9,
          description: "Slot level to spend for a player's spell (upcasting scales the dice).",
        },
        overchannel: {
          type: "boolean",
          description:
            "Evoker's Overchannel (14th level): a 1st to 5th level wizard spell deals its maximum damage. School of Evocation wizards only. The first use each long rest is free; after that the server rolls the necrotic damage it costs the wizard.",
        },
        sparedCharacterIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Sculpt Spells only: up to 1 + spell level characterIds from GAME STATE; omit: all caught, [] none. An evoker's feature: those spared, exact characterIds, succeed on the save and take nothing.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
        ...ZONE_ARGS,
      },
    },
  },
};
