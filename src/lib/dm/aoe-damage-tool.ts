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
      "Resolve a multi-target save-or-damage effect (breath weapon, fireball, collapsing ceiling, Entangle, Hypnotic Pattern, Slow, Sleep) in ONE call. The server rolls the damage once and each target's save from their real stats, and applies the damage and the spell's conditions to each, its riders too (Earthquake's concentration save, Chain Lightning's four targets). A player's spell needs casterCharacterId: the server spends the slot once for everyone caught. A spell that stays on the ground (Web, Entangle, Grease, Moonbeam, Stinking Cloud, Cloudkill, Wall of Fire) is laid on the battle map where it was cast (atX), and the server applies its ground, obscurement, saves and damage from then on until it ends. An enemy's spell that only lays an area (Darkness, Fog Cloud, a Web with nobody in it yet) is casterEnemyId, spell and atX/atY with no targets. Never chain per-target request_roll or apply_damage calls for an area effect.",
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
          description: "Required for an effect that names no spell (a trap, a collapsing ceiling). A spell or an enemy's ability brings its own.",
        },
        dc: {
          type: "integer",
          minimum: 1,
          maximum: 30,
          description: "Required with saveAbility for an effect that names no spell.",
        },
        halfOnSave: {
          type: "boolean",
          description: "True for half damage on a successful save, false for none. Default: true.",
        },
        condition: {
          type: "string",
          description: "What a failed save lays (restrained, frightened), for an effect with no spell or enemy.",
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
          description: "Exact enemyIds from GAME STATE caught in the effect.",
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
            "The ENEMY doing it, if one did: exact enemyId from GAME STATE, with enemyAbility or spell. It is the enemy's action for the round (refused if it already acted, cannot act, or is charmed by a target); the save, DC, dice and condition come from the block or the spell whatever you send, a Recharge ability must have recharged, and the server spends the spell's slot and tracks its concentration.",
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
            "Evoker's Overchannel (14th level): a 1st to 5th level wizard spell deals its maximum damage. The first use each long rest is free; later ones cost the wizard necrotic damage the server rolls.",
        },
        sparedCharacterIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Sculpt Spells only: up to 1 + spell level characterIds from GAME STATE; omit: all caught, [] none. Those spared succeed on the save and take nothing.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
        ...ZONE_ARGS,
      },
    },
  },
};
