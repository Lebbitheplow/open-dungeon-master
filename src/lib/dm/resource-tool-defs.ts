// The tool definitions the model sees for the resource engine (use_item,
// purchase, use_resource). Kept apart from the handlers in resource-tools.ts:
// mutations.ts spreads this list while it loads, and the handlers' imports
// reach back to mutations.ts through the clock, so the list must not wait on
// them.

export type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const RESOURCE_TOOL_NAMES = ["use_item", "purchase", "use_resource"] as const;

export const resourceTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "use_item",
      description:
        "A character uses up ONE consumable they carry (potion, scroll, thrown flask, ration, torch). The server checks they carry it, applies a healing potion's healing itself (rolling the dice), and decrements or removes the item, all in one call. In a fight it is their action (Use an Object) on their own turn, and feeding a potion to someone needs them within 5 ft; a character at 0 HP cannot use anything. An item with charges (a wand, a staff) spends charges and stays in the pack; weapons, armor and other kept items (a Bag of Holding, a ring) are refused, since they are not used up. Never narrate a consumable's use without calling this.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          item: { type: "string", description: "Item name from their equipment." },
          targetCharacterId: {
            type: "string",
            description: "Who receives the effect when fed to someone else; defaults to the user.",
          },
          charges: {
            type: "integer",
            minimum: 1,
            description:
              "For an item with charges (a wand, a staff, a once-a-day power): how many this use spends. The server keeps the count, refuses a use the item cannot pay for, keeps the item in the pack, and refills it at dawn.",
          },
          spell: {
            type: "string",
            description:
              "The spell a wand or staff casts with these charges (Wand of Fireballs: Fireball). The server sets the charge cost and the spell's level, and the spell's own tool called next (aoe_damage, cast_at_enemy, heal, cast_buff) spends no slot and uses the item's save DC. A scroll needs none: reading it casts its spell the same way.",
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
        "A character buys or sells an item outside a shop, atomically: the coin moves and the item lands in (or leaves) their pack in one audited step. The server prices it: a buyer pays the list price, a seller gets half of it, and gems, jewelry, art and trade goods sell at their full value (name a treasure with its value, e.g. 'Ruby (1000 gp)'). Your price is used only for something the table has no price for. Where a shop is open, use buy_item and sell_item instead.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          item: { type: "string", description: "Item name." },
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
        "A character spends a limited-use class feature tracked in their Resources list (Rage, Ki Points, Second Wind, Action Surge, Channel Divinity, Bardic Inspiration, Wild Shape, Lay on Hands...). The server spends the use AND applies the feature's real effect: Second Wind heals, Lay on Hands moves hit points to the target, Rage grants its resistance and damage, Bardic Inspiration hands the target a die, Intimidating Presence (with targetEnemyId) rolls the creature's save, Holy Nimbus burns enemies that start their turns near the paladin, Divine Intervention rolls the percentile dice and holds the 7-day wait. Subclass features the server resolves are spent by their own name, with no counter of their own needed (Kensei's Shot, Shadow Step, Symbiotic Entity, Visage of the Astral Self, Sharpen the Blade with amount, Planar Warrior, Slayer's Prey, Otherworldly Wings, Umbral Form, Fanatical Focus, Summon Wildfire Spirit, Slayer's Prey with targetEnemyId, Gathered Swarm with variant 'push' and targetEnemyId after the ranger's hit, Arcane Jolt with variant 'burn' and targetEnemyId or 'heal' and targetCharacterId, Peerless Skill (the bard's die on their own next check), Quivering Palm with targetEnemyId (3 ki after an unarmed hit; call it again to end the vibrations with the action), Draconic Presence (variant 'fear' or 'charm'), Hide in Plain Sight (outside a fight), Primeval Awareness (amount: the slot level); a choice like Totem Spirit or Transmuter's Stone takes the option as the variant, outside a fight). It refuses at 0 uses left. Call this BEFORE narrating the feature and narrate exactly what it reports back.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          resource: {
            type: "string",
            description: "Resource name from their Resources list, e.g. 'Rage' or 'Ki Points'.",
          },
          amount: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Uses or points to spend (default 1). Lay on Hands spends HP from its pool.",
          },
          targetCharacterId: {
            type: "string",
            description:
              "Who the feature is aimed at, for features that touch someone else (Lay on Hands, Bardic Inspiration). Defaults to the user.",
          },
          targetEnemyId: {
            type: "string",
            description:
              "The creature a feature is aimed at: Intimidating Presence (the server rolls its WIS save against the barbarian's DC and frightens it until the end of the barbarian's next turn; a later use on a creature already frightened by it extends that). Also the subclass features aimed at a creature (Touch of the Long Death, Psychic Blades, Unsettling Words, Hound of Ill Omen, Versatile Trickster, Mighty Impel, Elemental Fury, Storm Aura's sea, Insightful Fighting, Cauterizing Flames' burn): the server rolls their saves and damage.",
          },
          form: {
            type: "string",
            description: "Wild Shape only: the beast being assumed, e.g. 'dire wolf'.",
          },
          variant: {
            type: "string",
            description:
              "For features with a choice (Starry Form's archer/chalice/dragon, Spirit Totem's bear/hawk/unicorn): the chosen option. Ki Points: 'flurry of blows' (after the Attack action: two bonus-action unarmed strikes, each resolved with pc_attack), 'patient defense' (Dodge as a bonus action), 'step of the wind' (Disengage as a bonus action; 'step of the wind dash' to Dash); the server spends the ki and the bonus action and applies the effect.",
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
