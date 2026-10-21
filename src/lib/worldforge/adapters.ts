import type { BindingKind, Shelf, WorldType } from "./model.ts";
import { RESERVED_RULE } from "../bestiary/reserved-creatures.ts";
import { OUTLINE_ITEM_KINDS, type OutlineItemKind } from "./outline.ts";

// Task-specific draft adapters (plan M5 item 1, audit WF-08). One prompt for
// every entry wrote a monster the way it wrote a town. Each kind of thing now
// asks for what that kind needs, chosen from what the entry is (its shelf,
// its type's lore category, the playable record it links to), never from the
// words of a type's name. A creature or an item that links to a stat block
// or a Homebrew entry is told its rules, so the lore agrees with what the
// table plays, and never quotes them.
//
// The outline's playable assets have their own adapters: the creature and
// item drafts below ask a model for the fields the Bestiary's and Homebrew's
// own validators read (src/lib/bestiary/monster-draft.ts checkMonsterDraft,
// src/lib/homebrew/gear.ts normalizeHomebrewData), and nothing is stored
// that those validators have not passed. Pure; the model calls are in
// src/lib/dm/world-ai.ts and src/lib/dm/world-outline.ts.

export type DraftKind = "person" | "place" | "faction" | "creature" | "item" | "deity" | "history" | "culture" | "lore";

export function draftKind(shelf: Shelf, type: Pick<WorldType, "id" | "loreCategory">, bound: ReadonlyArray<{ kind: BindingKind }>): DraftKind {
  if (shelf === "npc") return "person";
  if (shelf === "location") return "place";
  if (shelf === "faction") return "faction";
  if (bound.some((record) => record.kind === "monster")) return "creature";
  if (bound.some((record) => record.kind === "item") || type.id === "t_artifact") return "item";
  switch (type.loreCategory) {
    case "religion":
      return "deity";
    case "history":
      return "history";
    case "culture":
      return "culture";
    case "geography":
      return "place";
    case "factions":
      return "faction";
    default:
      return "lore";
  }
}

// What each kind's entry is asked to cover.
export const DRAFT_ASKS: Record<DraftKind, string> = {
  person: "Cover how they look and sound at a first meeting, what they want now and what they would give up for it, who they answer to and who answers to them, and what they keep from others.",
  place: "Cover what a traveller sees, hears and smells on arriving, who is found there and who runs it, what is dangerous or valuable there, and how it ties to the places around it.",
  faction: "Cover what it wants, how it works and what it will not do, who leads it and who serves it, who it opposes, and what joining or crossing it costs.",
  creature: "Cover where it lives and how it behaves, what it hunts or guards, the signs it leaves, what folk tell of it, and how they ward against it or bring it down. Its game statistics live in the Bestiary: describe it, never give numbers.",
  item: "Cover what it looks and feels like, who made it and who has held it, what it is said to do and what using it costs. Its mechanics live in Homebrew: never give bonuses, dice or charges.",
  deity: "Cover what the deity is said to rule and want, how the faithful worship and what they are forbidden, its signs and holy places, and who opposes it.",
  history: "Cover what happened, who took part and what it cost, how it is remembered and by whom, and what it left behind.",
  culture: "Cover how its people live and what they value, their customs and taboos, how they greet strangers, and what outsiders get wrong about them.",
  lore: "Cover what it is, who knows of it and what they say, and why it matters in the world now.",
};

// ---- creatures ----

export function creatureMessages(input: { worldName: string; name: string; summary: string; cr: number; basis: string; context: string[] }) {
  return [
    {
      role: "system" as const,
      content: [
        `You design one creature for ${input.worldName}, a tabletop world played with 5e rules, as a stat block a game master will check in their Bestiary.`,
        'Reply with one JSON object and nothing else: {"basis":"","size":"","type":"","cr":1,"speed":"","attacksPerTurn":1,"attacks":[{"name":"","toHit":0,"damage":"","type":""}],"traits":[],"desc":""}',
        RESERVED_RULE,
        '"basis" is the exact name of the SRD creature it is, or "" for an original design. With a basis, the SRD block is used as it stands and only the name and "desc" are yours.',
        '"size" is one of Tiny, Small, Medium, Large, Huge, Gargantuan. "type" is a 5e creature type in one word (beast, monstrosity, undead, fiend...).',
        '"cr" is its challenge rating. Each attack\'s "damage" is a dice expression such as "2d6+3", and its "type" a damage type such as piercing or fire. At most 4 attacks and 4 traits, each trait one line: "Name. What it does."',
        '"desc" is two or three sentences in the world\'s own voice: how it looks and behaves, with no numbers.',
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `The creature: ${input.name}, challenge rating about ${input.cr}.`,
        input.summary ? `What the outline says: ${input.summary}` : "",
        input.basis ? `The outline suggests it is built on: ${input.basis}` : "",
        ...input.context,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

export type CreatureReply = { basis: string; desc: string; fields: Record<string, unknown> };

// What the creature draft carries into checkMonsterDraft: only the fields it
// reads, as sent. The validator decides; this only picks them out.
export function readCreatureReply(reply: Record<string, unknown> | null): CreatureReply {
  const source = reply ?? {};
  const pick = (key: string) => (source[key] === undefined ? {} : { [key]: source[key] });
  return {
    basis: typeof source.basis === "string" ? source.basis.trim().slice(0, 80) : "",
    desc: typeof source.desc === "string" ? source.desc.trim().slice(0, 2_000) : "",
    fields: {
      ...pick("size"),
      ...pick("type"),
      ...pick("speed"),
      ...pick("attacksPerTurn"),
      ...(Array.isArray(source.attacks) ? { attacks: source.attacks.slice(0, 4) } : {}),
      ...(Array.isArray(source.traits) ? { traits: source.traits.slice(0, 4) } : {}),
    },
  };
}

// ---- items ----

export function itemMessages(input: { worldName: string; name: string; summary: string; itemKind: OutlineItemKind; context: string[] }) {
  return [
    {
      role: "system" as const,
      content: [
        `You design one item for ${input.worldName}, a tabletop world played with 5e rules, as a Homebrew entry a game master will check.`,
        'Reply with one JSON object and nothing else: {"itemKind":"","rarity":"","cost":"","weight":0,"desc":"","weapon":{"category":"","kind":"","damage":"","properties":[]},"armor":{"category":"","baseAc":0},"requiresAttunement":false}',
        `"itemKind" is one of: ${OUTLINE_ITEM_KINDS.join(", ")}.`,
        'Only a weapon (or a magic weapon) has "weapon": "category" simple or martial, "kind" melee or ranged, "damage" a die and a type such as "1d8 slashing" (a d12 at most), "properties" from: finesse, light, heavy, reach, thrown, two-handed, versatile, ammunition, loading. Leave "weapon" out otherwise.',
        'Only armour (or magic armour) has "armor": "category" light, medium, heavy or shield, "baseAc" from 10 to 18 (a shield adds 1 to 3). Leave "armor" out otherwise.',
        '"rarity" is one of common, uncommon, rare, very rare, legendary. "cost" is a price such as "50 gp". "weight" is in pounds.',
        '"desc" is two or three sentences on what it is and what it does at the table, plainly: what the item does, not a story.',
        "Never use the exact name of an item from the 5e rules.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `The item: ${input.name}, a ${input.itemKind.replace(/_/g, " ")}.`,
        input.summary ? `What the outline says: ${input.summary}` : "",
        ...input.context,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

// The item draft as Homebrew's create schema reads it; the outline's kind
// stands when the model names none.
export function readItemReply(reply: Record<string, unknown> | null, itemKind: OutlineItemKind): Record<string, unknown> {
  const source = { ...(reply ?? {}) };
  const asked = OUTLINE_ITEM_KINDS.find((kind) => kind === source.itemKind) ?? itemKind;
  const out: Record<string, unknown> = { ...source, itemKind: asked, desc: typeof source.desc === "string" ? source.desc.trim().slice(0, 8_000) : "" };
  for (const key of ["rarity", "cost"] as const) {
    if (typeof out[key] !== "string") delete out[key];
  }
  if (typeof out.weight !== "number") delete out.weight;
  // A block the kind does not use is the model filling in the template.
  if (asked !== "weapon" && asked !== "magic_item") delete out.weapon;
  if (asked !== "armor" && asked !== "magic_item") delete out.armor;
  if (asked === "magic_item") {
    const weapon = out.weapon as Record<string, unknown> | undefined;
    if (weapon && !weapon.damage) delete out.weapon;
    const armor = out.armor as Record<string, unknown> | undefined;
    if (armor && !armor.baseAc) delete out.armor;
  }
  return out;
}
