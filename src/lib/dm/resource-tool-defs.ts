// The tool definitions the model sees for the resource engine (use_item,
// purchase, use_resource). Kept apart from the handlers in resource-tools.ts:
// mutations.ts spreads this list while it loads, and the handlers' imports
// reach back to mutations.ts through the clock, so the list must not wait on
// them.

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const resourceTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "use_item",
      description:
        "Resolve a character using up ONE consumable they carry (potion, scroll, thrown flask, ration, torch); one taken in the same action (from a chest, off a fallen foe) is given with grant_item first. In a fight it is the Use an Object action. Weapons, armor and other kept items (a Bag of Holding, a ring) are refused, since they are not used up. Never narrate a consumable's use without calling it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          item: { type: "string", description: "Item name from their equipment." },
          targetCharacterId: {
            type: "string",
            description: "Who receives the effect when fed to someone else: exact characterId from GAME STATE. Default: the user.",
          },
          charges: {
            type: "integer",
            minimum: 1,
            description:
              "For an item with charges (a wand, a staff, a once-a-day power): how many this use spends. The server keeps the count and refuses a use the item cannot pay for.",
          },
          spell: {
            type: "string",
            description:
              "The spell a wand or staff casts with these charges (Wand of Fireballs: Fireball). A scroll needs none.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "item"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "purchase",
      description:
        "Resolve a character buying or selling an item outside a shop, in one audited step.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          item: { type: "string", description: "Item name, without its worth: price carries that." },
          price: {
            type: "integer",
            minimum: 0,
            maximum: 100000,
            description: "Gold per unit, used only for an item the table has no list price for.",
          },
          qty: { type: "integer", minimum: 1, maximum: 99 },
          action: { type: "string", enum: ["buy", "sell"] },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "item", "price", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "use_resource",
      description:
        "Resolve a character spending a limited-use class feature tracked in their Resources list, or a subclass feature the server resolves (resource). It refuses at 0 uses left.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          resource: {
            type: "string",
            description:
              "Resource name from their Resources list ('Rage', 'Ki Points'). Subclass features the server resolves are spent by their own name, with no counter of their own needed: Kensei's Shot, Shadow Step, Symbiotic Entity, Visage of the Astral Self, Sharpen the Blade (amount), Planar Warrior, Otherworldly Wings, Umbral Form, Fanatical Focus, Summon Wildfire Spirit, Slayer's Prey (targetEnemyId), Gathered Swarm (variant 'push' and targetEnemyId, after the ranger's hit), Arcane Jolt (variant 'burn' and targetEnemyId, or 'heal' and targetCharacterId), Peerless Skill (the bard's die on their own next check), Quivering Palm (targetEnemyId; 3 ki after an unarmed hit; call it again to end the vibrations with the action), Draconic Presence (variant 'fear' or 'charm'), Hide in Plain Sight (outside a fight), Primeval Awareness (amount: the slot level).",
          },
          amount: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Uses or points to spend. Default 1. Lay on Hands spends HP from its pool.",
          },
          targetCharacterId: {
            type: "string",
            description:
              "Who the feature is aimed at, for features that touch someone else (Lay on Hands, Bardic Inspiration): exact characterId from GAME STATE. Default: the user.",
          },
          targetEnemyId: {
            type: "string",
            description:
              "The creature a feature is aimed at, exact enemyId from GAME STATE: Intimidating Presence (the server rolls its WIS save against the barbarian's DC and frightens it until the end of the barbarian's next turn; a later use on a creature already frightened by it extends that). Also the subclass features aimed at a creature (Touch of the Long Death, Psychic Blades, Unsettling Words, Hound of Ill Omen, Versatile Trickster, Mighty Impel, Elemental Fury, Storm Aura's sea, Insightful Fighting, Cauterizing Flames' burn): the server rolls their saves and damage.",
          },
          form: {
            type: "string",
            description: "Wild Shape only: the beast being assumed ('dire wolf').",
          },
          variant: {
            type: "string",
            description:
              "For features with a choice (Starry Form's archer/chalice/dragon, Spirit Totem's bear/hawk/unicorn; Totem Spirit or Transmuter's Stone, outside a fight): the chosen option. Ki Points: 'flurry of blows' (after the Attack action: two bonus-action unarmed strikes, each resolved with pc_attack), 'patient defense' (Dodge as a bonus action), 'step of the wind' (Disengage as a bonus action; 'step of the wind dash' to Dash); the server spends the ki and the bonus action and applies the effect.",
          },
          formHp: {
            type: "integer",
            minimum: 1,
            maximum: 300,
            description: "Wild Shape only: the beast form's hit points from its stat block.",
          },
          formAc: {
            type: "integer",
            minimum: 1,
            maximum: 30,
            description: "Wild Shape only: the beast form's armor class.",
          },
          formCr: {
            type: "number",
            minimum: 0,
            maximum: 30,
            description:
              "Wild Shape only, for a beast the server does not know: its challenge rating from its stat block (0.25 for 1/4). The druid's level caps it.",
          },
          formFlies: {
            type: "boolean",
            description: "Wild Shape only, for a beast the server does not know: it has a flying speed.",
          },
          formSwims: {
            type: "boolean",
            description: "Wild Shape only, for a beast the server does not know: it has a swimming speed.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "resource"],
      },
    },
  },
];
