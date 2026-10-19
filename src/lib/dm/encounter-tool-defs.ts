// The encounter tools the AI DM is offered, as the model reads them: their
// descriptions and argument schemas. Split from encounter-tools.ts, which
// offers them (encounterTools) and handles every call.

import { sceneIds } from "@/lib/ambience/catalog";
import { ENCOUNTER_OUTCOMES } from "@/lib/dm/encounter-logic";
import { waypointProperty } from "@/lib/dm/waypoint-logic";
import { ADVANTAGE_SOURCES } from "@/lib/dm/pc-attack-options";

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const startEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "start_encounter",
    description:
      "Begin combat with real, server-tracked enemies.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemies: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              monster: {
                type: "string",
                description: "Monster slug or name ('goblin', 'Gutter Punk').",
              },
              name: {
                type: "string",
                description: "In-world display name, to reskin one for this setting.",
              },
              count: { type: "integer", minimum: 1, maximum: 8 },
              cr: {
                type: "number",
                description:
                  "Only for an invented enemy with no matching monster: its challenge rating.",
              },
            },
            required: ["monster"],
          },
        },
        summary: { type: "string", description: "One line on what this fight is." },
        ambush: {
          type: "string",
          enum: ["enemies", "party"],
          description:
            "Who was lying in wait, hidden: 'enemies' when they jump the party, 'party' when the party springs it. Those surprised lose their first turn.",
        },
        surprised: {
          type: "string",
          enum: ["none", "enemies", "party"],
          description:
            "A whole side the story has already decided is caught off guard, overriding ambush. Default 'none'.",
        },
        scene: {
          type: "string",
          enum: sceneIds(),
          description:
            "The kind of ground this fight is on, for its battle map, when it is not the current place's own (an ambush on the road outside the town). Omit it and the map follows the place.",
        },
        distanceFeet: {
          type: "integer",
          minimum: 5,
          description:
            "How far the nearest enemy stands from the party as the fight opens, in feet, whenever the story has already said: 5 for a foe at arm's length, 10 for one two paces off, 30 across a room. The battle map places them there. Omit it and the sides open across the field from each other.",
        },
        lair: {
          type: "boolean",
          description: "True when the fight is in a legendary creature's lair, so the lair acts on initiative 20 each round (lair_action).",
        },
        from: {
          type: "string",
          enum: ["ahead", "behind"],
          description:
            "Where the enemy comes from against the party's travel formation (GAME STATE): 'ahead' (the default) puts the front of the formation nearest them, 'behind' the rear. The formation only places the party; it grants no surprise or bonus.",
        },
      },
      required: ["enemies"],
    },
  },
};

export const damageEnemyTool: ToolDef = {
  type: "function",
  function: {
    name: "damage_enemy",
    description:
      "Deal damage to an enemy from a hazard or the environment (a falling chandelier, burning oil, a collapsing floor): never from an attack or a spell. For a character's or companion's blow, use pc_attack; for a spell, cast_at_enemy or aoe_damage; an ally who fights is recruited with add_companion and attacks with pc_attack. The enemy dies only when the result says dead: true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        amount: { type: "integer", minimum: 1, maximum: 200, description: "A damage total the server rolled this turn; omit it for a fall (fallFeet) or dice." },
        dice: { type: "string", description: "Dice the server rolls for the damage ('4d10'). Instead of amount." },
        fallFeet: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "A fall, instead of amount: how far the creature falls. The server rolls 1d6 bludgeoning per 10 feet (at most 20d6) and lays it prone.",
        },
        type: { type: "string", description: "Damage type (slashing, fire)." },
        magical: {
          type: "boolean",
          description:
            "True when the hazard is magical, so resistance to nonmagical attacks does not apply.",
        },
        source: {
          type: "string",
          enum: ["hazard", "environment"],
          description: "What deals it: 'hazard' (a trap, a falling object) or 'environment' (fire, lava, acid); anything else is refused.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: ["enemyId"],
    },
  },
};

export const enemyAttackTool: ToolDef = {
  type: "function",
  function: {
    name: "enemy_attack",
    description:
      "Resolve an enemy's attack on a character, on the enemy's own turn: once end_turn hands it to you (or it acts first in the round); before its turn comes it only reacts or takes a legendary action. The server rolls to-hit from the enemy's real stat block against the target's real AC and applies real damage, and reads what bears on the roll (conditions, exhaustion, light, Pack Tactics, Sunlight Sensitivity, Sanctuary, Chill Touch). Never invent an enemy's numbers or use request_roll for enemy attacks.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemyId: { type: "string", description: "Exact enemyId from GAME STATE." },
        targetCharacterId: {
          type: "string",
          description: "Exact characterId from GAME STATE.",
        },
        attack: {
          type: "string",
          description: "Attack name from the enemy's attack list. Default: its first.",
        },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
          description: "Situational advantage the server cannot see; counts only with advantageSource 'other' and advantageReason. Conditions, light, cover, range, flanking and Pack Tactics are the server's already.",
        },
        advantageSource: {
          type: "string",
          enum: [...ADVANTAGE_SOURCES],
          description:
            "Where the advantage or disadvantage comes from. Only 'other', a circumstance of the fiction the server cannot see (named in advantageReason), counts: the server applies conditions, cover, light, range, Help, flanking, spells, Inspiration and features itself.",
        },
        advantageReason: { type: "string", description: "The circumstance behind advantage, in a few words." },
      },
      required: ["enemyId", "targetCharacterId"],
    },
  },
};

export const endEncounterTool: ToolDef = {
  type: "function",
  function: {
    name: "end_encounter",
    description:
      "End the active encounter when it resolves any way other than every enemy dying: flight, surrender, parley, or party defeat. Victory by killing every enemy ends automatically.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...waypointProperty,
        outcome: { type: "string", enum: [...ENCOUNTER_OUTCOMES] },
        reason: { type: "string" },
      },
      required: ["outcome"],
    },
  },
};

export const endTurnTool: ToolDef = {
  type: "function",
  function: {
    name: "end_turn",
    description:
      "Mark the current character's combat turn as complete. THIS is what advances the initiative: an attack alone never ends a turn, because the character may still have movement or a bonus action. Call it when the player has spent or declined the rest of their turn (or their whole declared turn is resolved). The server advances the initiative after your narration and posts a note naming the next turn. Never announce whose turn is next yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
      },
      required: ["characterId"],
    },
  },
};
