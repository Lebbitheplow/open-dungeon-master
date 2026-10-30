// The tool definitions the model sees for the resource engine (use_item,
// purchase, use_resource). Kept apart from the handlers in resource-tools.ts:
// mutations.ts spreads this list while it loads, and the handlers' imports
// reach back to mutations.ts through the clock, so the list must not wait on
// them. purchase is every trade (issue #471): a shop's sale reaches the shop
// (src/lib/dm/shop-tools.ts tradeCall).

import { waypointProperty } from "@/lib/dm/waypoint-logic";

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
        "Resolve a character using up ONE consumable they carry (potion, scroll, thrown flask, ration, torch); one taken in the same action (from a chest, off a fallen foe) is given with grant_item first. In a fight it is the Use an Object action. Kept items (weapons, armor, a ring) are refused. Never narrate a consumable's use without calling it.",
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
            maximum: 50,
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
        "Resolve a character buying or selling an item in one audited step. A shop standing here that stocks the item (or buys it) trades it from its own shelf at its own prices; anywhere else the list price is paid, and a seller gets half. Loot no list has, or a spell scroll, is granted with grant_item (its tags, its spell) and paid for with modify_gold.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          ...waypointProperty,
          characterId: { type: "string", description: "Exact characterId from GAME STATE." },
          action: { type: "string", enum: ["buy", "sell"] },
          item: { type: "string", description: "Item name, without its worth: price carries that." },
          qty: { type: "integer", minimum: 1, maximum: 99 },
          shop: {
            type: "string",
            description: "A shop in SHOPS HERE the party picks; omit it and the server picks one that stocks (or buys) it.",
          },
          srdName: {
            type: "string",
            description: "Only when item is in the table's own words: the SRD or pack item's English name ('Longsword'). Send it with the first call, as grant_item does; omit it when item already is that English name.",
          },
          price: {
            type: "number",
            minimum: 0,
            maximum: 100000,
            description: "Gold each, for a thing no shelf or list prices.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "action", "item"],
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
              "Resource name from their Resources list ('Rage', 'Ki Points'). Subclass features the server resolves go by their own name, no counter needed: Kensei's Shot, Shadow Step, Symbiotic Entity, Visage of the Astral Self, Sharpen the Blade (amount), Planar Warrior, Otherworldly Wings, Umbral Form, Fanatical Focus, Summon Wildfire Spirit, Slayer's Prey (targetEnemyId), Gathered Swarm (variant 'push', targetEnemyId), Arcane Jolt (variant 'burn' and targetEnemyId, or 'heal' and targetCharacterId), Peerless Skill, Quivering Palm (targetEnemyId; again to end the vibrations), Draconic Presence (variant 'fear' or 'charm'), Hide in Plain Sight, Primeval Awareness (amount: the slot level).",
          },
          amount: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "Uses or points to spend. Default: 1. Lay on Hands spends HP from its pool.",
          },
          targetCharacterId: {
            type: "string",
            description:
              "Who a feature that touches someone else is aimed at: exact characterId from GAME STATE. E.g. Lay on Hands, Bardic Inspiration. Default: the user.",
          },
          targetEnemyId: {
            type: "string",
            description:
              "The creature a feature is aimed at: exact enemyId from GAME STATE. Intimidating Presence and the subclass features aimed at a creature use it (Touch of the Long Death, Psychic Blades, Unsettling Words, Hound of Ill Omen, Versatile Trickster, Mighty Impel, Elemental Fury, Storm Aura's sea, Insightful Fighting, Cauterizing Flames' burn): the server rolls their saves and damage.",
          },
          form: {
            type: "string",
            description: "Wild Shape only: the beast being assumed ('dire wolf').",
          },
          variant: {
            type: "string",
            description:
              "The chosen option; Ki Points: 'flurry of blows', 'patient defense', 'step of the wind'. Features with a choice: Starry Form's archer/chalice/dragon, Spirit Totem's bear/hawk/unicorn; Totem Spirit or Transmuter's Stone, outside a fight. Flurry of blows: after the Attack action, two unarmed strikes, each a pc_attack call; 'step of the wind dash' to Dash. The server spends the ki and the bonus action and applies the effect.",
          },
          formHp: {
            type: "integer",
            minimum: 1,
            maximum: 300,
            description: "Wild Shape only: the beast form's HP from its stat block.",
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
              "Wild Shape only, for a beast the server lacks: its challenge rating (0.25 for 1/4). Take it from its stat block. The druid's level caps it.",
          },
          formFlies: {
            type: "boolean",
            description: "Wild Shape only, for a beast the server lacks: it has a flying speed.",
          },
          formSwims: {
            type: "boolean",
            description: "Wild Shape only, for a beast the server lacks: it has a swimming speed.",
          },
          reason: { type: "string", description: "Short in-fiction cause." },
        },
        required: ["characterId", "resource"],
      },
    },
  },
];
