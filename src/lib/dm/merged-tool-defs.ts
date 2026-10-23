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
      "Deal damage no attack or spell resolves (a hazard, the environment, a falling chandelier) to a character, an enemy, a character's pet, or several at their share of one total. Temp HP absorbs first, HP floors at 0, resistances and death saves resolve themselves. An enemy takes it only from a hazard or the environment (a blow is pc_attack, a spell cast_at_enemy or aoe_damage), and dies only when the result says dead: true.",
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
              enemyId: { type: "string" },
              characterId: { type: "string" },
              share: { type: "string", enum: ["none", "half", "full", "double"] },
            },
          },
          description: "Several from ONE total, each at its share, for a reason no save covers (cover, an immunity, diving clear). Instead of characterId or enemyId.",
        },
        amount: { type: "integer", minimum: 1, maximum: 500, description: "A damage total the server rolled this turn (request_roll kind=damage)." },
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
          description: "On an enemy: a hazard (a trap, a falling object) or the environment (fire, lava, acid); nothing else.",
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
      "Apply a condition to a character or an enemy. Use the exact 5e name when one fits: blinded, charmed, deafened, frightened, grappled, incapacitated, invisible, paralyzed, petrified, poisoned, prone, restrained, stunned, unconscious, exhaustion. Custom names are allowed for story effects. Always give a duration when the fiction has one, because only timed conditions ever expire on their own: rounds for combat-scale effects, minutes, hours or days for longer ones (a poison, a curse, a potion), or saveAbility + saveDc for save-ends effects the server re-rolls. In combat the countdown runs by round; outside it the in-world clock runs it down as the party travels, rests, or passes time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: CHARACTER_TARGET },
        enemyId: { type: "string", description: ENEMY_TARGET },
        reason: { type: "string", description: "Short in-fiction cause." },
        condition: { type: "string" },
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
          description: "In-world days until the condition ends (Geas's thirty, Contagion's seven).",
        },
        saveAbility: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "Save-ends: ability re-saved at the end of each round.",
        },
        saveDc: { type: "integer", minimum: 1, maximum: 30, description: "Save-ends DC." },
        magical: {
          type: "boolean",
          description: "The condition comes from magic (a creature's magical sleep, an enchanted trap): traits that resist magic apply, such as Fey Ancestry against being put to sleep.",
        },
        sourceEnemyId: {
          type: "string",
          description:
            "The enemy that caused it, when the condition is tied to one (the charmer, the grappler, the source of the fear): exact enemyId from GAME STATE.",
        },
        sourceCharacterId: {
          type: "string",
          description: "The character that caused it, when it was one of the party: exact characterId from GAME STATE.",
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
        condition: { type: "string" },
      },
      required: ["condition"],
    },
  },
};
