// The tool definitions the model sees for the intents whose siblings were
// merged into one tool (issue #471): damage no attack resolves, and laying
// or lifting a condition, each on a character or an enemy (and damage on a
// pet, or on several creatures at once). The engine keeps each sibling's own
// handler; src/lib/dm/tool-merge-logic.ts says which one a call reaches.
// Kept apart from mutations.ts, which spreads them into its list, for the
// same reason resource-tool-defs.ts is: plain data the list needs while it
// loads.

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

const CHARACTER_TARGET = "Exact characterId from GAME STATE.";
const ENEMY_TARGET = "Or an enemy: exact enemyId from GAME STATE.";

export const applyDamageTool: ToolDef = {
  type: "function",
  function: {
    name: "apply_damage",
    description:
      "Deal damage no attack or spell resolves (a hazard, the environment, a falling chandelier) to a character, an enemy, a character's pet, or several at their share of one total. The server applies temp HP, resistances and death saves. An enemy takes it only from a hazard or the environment (a blow is pc_attack, a spell cast_at_enemy or aoe_damage), and dies only when the result says dead: true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE (with petName, the owner)." },
        enemyId: { type: "string", description: ENEMY_TARGET },
        petName: {
          type: "string",
          description: "Their pet takes it instead: which, by name.",
        },
        targets: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              enemyId: { type: "string", description: "An enemy: exact enemyId from GAME STATE." },
              characterId: { type: "string", description: "Or a character: exact characterId from GAME STATE." },
              share: { type: "string", enum: ["none", "half", "full", "double"] },
            },
          },
          description: "Several targets from ONE total, each at its share for a reason no save covers (cover, immunity). Instead of characterId or enemyId.",
        },
        amount: { type: "integer", minimum: 1, maximum: 200, description: "A damage total the server rolled this turn (request_roll kind=damage)." },
        dice: { type: "string", description: "Dice the server rolls instead ('2d6')." },
        fallFeet: {
          type: "integer",
          minimum: 1,
          maximum: 1000,
          description: "An enemy's fall instead: the server rolls 1d6 per 10 feet and lays it prone.",
        },
        type: { type: "string", description: "Damage type (slashing, fire)." },
        magical: {
          type: "boolean",
          description: "From a spell, a magic weapon or a magical hazard: resistance to nonmagical attacks does not apply.",
        },
        source: {
          type: "string",
          enum: ["hazard", "environment"],
          description: "Required on an enemy: 'hazard' (a trap, a falling object) or 'environment' (fire, lava, acid). Nothing else.",
        },
        reason: { type: "string", description: "Short in-fiction cause." },
      },
      required: [],
    },
  },
};

export const setConditionTool: ToolDef = {
  type: "function",
  function: {
    name: "set_condition",
    description:
      "Apply a condition to a character or an enemy; always give a duration the fiction has, since only timed conditions expire on their own. The 5e names are blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious and exhaustion. Any other name is a story effect. A duration is rounds, minutes, hours or days, or saveAbility + saveDc for a save-ends effect the server re-rolls; out of a fight the in-world clock runs it down.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: CHARACTER_TARGET },
        enemyId: { type: "string", description: ENEMY_TARGET },
        reason: { type: "string", description: "Short in-fiction cause." },
        condition: { type: "string", description: "Its 5e name (poisoned, prone, exhaustion), or a custom name for a story effect." },
        rounds: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Rounds until the condition ends on its own.",
        },
        minutes: {
          type: "integer",
          minimum: 1,
          maximum: 1440,
          description: "In-world minutes until the condition ends (10 rounds per minute).",
        },
        hours: {
          type: "integer",
          minimum: 1,
          maximum: 24,
          description: "In-world hours until the condition ends.",
        },
        days: {
          type: "integer",
          minimum: 1,
          maximum: 365,
          description: "In-world days until the condition ends.",
        },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "Save-ends: ability re-saved at the end of each round.",
        },
        saveDc: { type: "integer", minimum: 1, maximum: 30, description: "Save-ends DC." },
        magical: {
          type: "boolean",
          description: "True when the condition comes from magic, so traits that resist magic apply (Fey Ancestry vs sleep).",
        },
        sourceEnemyId: {
          type: "string",
          description:
            "The enemy that caused it: exact enemyId from GAME STATE. The charmer, the grappler, the source of the fear.",
        },
        sourceCharacterId: {
          type: "string",
          description: "The party member that caused it: exact characterId from GAME STATE. With inspiration: the one giving up theirs to pass it on.",
        },
        level: {
          type: "integer",
          minimum: 1,
          maximum: 6,
          description: "An enemy's exhaustion only: the level it now has.",
        },
      },
      required: ["condition"],
    },
  },
};

export const clearConditionTool: ToolDef = {
  type: "function",
  function: {
    name: "clear_condition",
    description:
      "Remove a condition from a character or an enemy the moment the fiction ends it (cured, dispelled, rested, shaken off). Use the condition name shown in GAME STATE.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: CHARACTER_TARGET },
        enemyId: { type: "string", description: ENEMY_TARGET },
        reason: { type: "string", description: "Short in-fiction cause." },
        condition: { type: "string", description: "Its name as GAME STATE shows it." },
      },
      required: ["condition"],
    },
  },
};
