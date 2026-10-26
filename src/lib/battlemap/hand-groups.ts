// The Hand's groups (issue 528). Every spell, maneuver, ki technique, gear
// action and basic action used to be a card of its own, so a level 9 wizard
// held about 35 and 26 of them waited behind the More spine in one flat list.
// Cards that spend the same thing now gather under one card: the spells
// under Spells, by level with the slots each level has left; the options of
// one pool (ki, superiority dice, Channel Divinity, psionic energy) under
// that pool; what is done with gear under Items; the basic actions under
// Actions. That is the choice a player makes in 5e (which slot or die to
// spend, and whether one is left), and it is objective, so a homebrew spell
// or option needs no tagging to land in the right place.
//
// A group folds only once it holds GROUP_FOLD_MIN cards or more: an Eldritch
// Knight's two spells stay two cards. The urgent cards (Escape, Stand up, a
// reaction an attack offered), End turn and the attacks never fold.
//
// Pure: scripts/test-hand-groups.mjs drives it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { IconRef } from "@/lib/icons";
import { resourceDef } from "@/lib/srd/class-resources";
import { lowestSlot, type HandCard, type HandCardType, type HandCost } from "@/lib/battlemap/hand-core";
import { END_TURN_ID, isUrgentCard } from "@/lib/battlemap/hand-layout";
import { textKey } from "@/lib/language/text-logic";

export const GROUP_FOLD_MIN = 4;
// A group's own search box shows once it holds more cards than this.
export const GROUP_SEARCH_OVER = 12;

// The basic actions every character holds, as hand.ts deals them (the plain
// card and a feature's bonus-action route, Cunning Action's Dash).
const BASIC_ACTIONS = new Set(["dodge", "dash", "disengage", "help", "hide", "search", "ready", "grapple", "shove", "use-object"]);

// A pool's name on its group card, and the short word its count is shown
// in. Any other pool takes the resource table's own name.
const POOL_NAMES: Record<string, { name: string; short: string; noun: [string, string] }> = {
  ki: { name: "Ki", short: "Ki", noun: ["technique", "techniques"] },
  sub_superiority_dice: { name: "Superiority dice", short: "Dice", noun: ["maneuver", "maneuvers"] },
  channel_divinity: { name: "Channel Divinity", short: "Uses", noun: ["option", "options"] },
  sub_psionic_energy: { name: "Psionic Energy", short: "Dice", noun: ["use", "uses"] },
  sorcery_points: { name: "Sorcery points", short: "Points", noun: ["option", "options"] },
};

export type HandGroupKey = "spells" | "items" | "actions" | `pool:${string}`;

export type HandGroupSection = {
  id: string;
  // "Cantrips", "Level 3"; a group of one section is named by the group.
  label: string;
  // What the section has left to spend: "1 of 3 slots".
  note: string;
  // A spell level's section carries its level (0 for the cantrips).
  level?: number;
  cards: HandCard[];
};

export type HandGroup = {
  // "group:spells", "group:pool:ki": what a layout seats (hand-layout.ts).
  id: string;
  key: HandGroupKey;
  name: string;
  // What one of its cards is called, to count them ("20 spells").
  noun: [string, string];
  cards: HandCard[];
  sections: HandGroupSection[];
  // What the whole group has left, on its card's foot: "Slots 7/11", "Ki 4/9".
  left: string;
  // The ribbon its card wears, from the card types it holds.
  tone: HandCardType;
  // Up to three of its cards' paintings, fanned in its art window.
  icons: IconRef[];
  // The costs its cards are paid in, each open while one of them can be
  // played now: the group's card wears them as notches (issue 529).
  costs: Array<{ cost: HandCost; open: boolean }>;
  // Why nothing in it can be played now; null while something can. A
  // group is always opened: its cards are still worth reading.
  disabled: string | null;
  spent: boolean;
};

export type HandUnit = HandCard | HandGroup;

export function isGroup(unit: HandUnit): unit is HandGroup {
  return "cards" in unit;
}

// Which group a card belongs in, or null for one that always stands alone.
export function groupKeyOf(card: HandCard): HandGroupKey | null {
  if (card.id === END_TURN_ID || isUrgentCard(card) || card.type === "attack") return null;
  if (card.id.startsWith("spell:")) return "spells";
  if (card.pool) return `pool:${card.pool}`;
  if (card.id.startsWith("gear:")) return "items";
  // "basic:dash", or a feature's bonus-action route "basic:dash:bonus".
  const [kind, action, route, ...rest] = card.id.split(":");
  return kind === "basic" && BASIC_ACTIONS.has(action) && (route === undefined || route === "bonus") && !rest.length
    ? "actions"
    : null;
}

const PIP_COSTS: HandCost[] = ["action", "bonus", "reaction"];

const plural = (count: number, noun: [string, string]) => `${count} ${count === 1 ? noun[0] : noun[1]}`;

// The slots that pay for a spell of this level, as the level's header says
// them: "1 of 3 slots", "2 of 2 pact slots (level 3)", "none left".
export function slotNote(sheet: Pick<CharacterSheet, "spellcasting"> | null, level: number): string {
  const casting = sheet?.spellcasting;
  if (!casting || level <= 0) return "";
  const parts: string[] = [];
  const slot = casting.slots[level];
  if (slot?.max) {
    parts.push(`${slot.max - slot.used} of ${plural(slot.max, ["slot", "slots"])}`);
  }
  const pact = casting.pact;
  if (pact?.max && pact.level >= level) {
    parts.push(`${pact.max - pact.used} of ${plural(pact.max, ["pact slot", "pact slots"])}${pact.level > level ? ` (level ${pact.level})` : ""}`);
  }
  const anyLeft = parts.length && ((slot?.max ?? 0) - (slot?.used ?? 0) > 0 || (pact && pact.level >= level && pact.max - pact.used > 0));
  if (!anyLeft) {
    // Spent at this level, or never held: a higher slot still casts it.
    const higher = lowestSlot(sheet as CharacterSheet, level);
    if (higher) parts.push(parts.length ? `level ${higher.level} slots open` : `cast with a level ${higher.level} slot`);
    else if (!parts.length) parts.push("no slots");
  }
  return parts.join(", ");
}

function spellLeft(sheet: Pick<CharacterSheet, "spellcasting"> | null): string {
  const casting = sheet?.spellcasting;
  if (!casting) return "";
  let left = 0;
  let max = 0;
  for (const slot of Object.values(casting.slots)) {
    left += Math.max(0, slot.max - slot.used);
    max += slot.max;
  }
  const parts = max ? [`Slots ${left}/${max}`] : [];
  if (casting.pact?.max) parts.push(`Pact ${casting.pact.max - casting.pact.used}/${casting.pact.max}`);
  return parts.join(" · ");
}

function poolInfo(pool: string) {
  const known = POOL_NAMES[pool];
  if (known) return known;
  const name = resourceDef(pool)?.displayName ?? pool.replace(/^sub_/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { name, short: "Uses", noun: ["option", "options"] as [string, string] };
}

function spellSections(cards: HandCard[], sheet: Pick<CharacterSheet, "spellcasting"> | null): HandGroupSection[] {
  const levels = [...new Set(cards.map((card) => card.level ?? 0))].sort((a, b) => a - b);
  return levels.map((level) => ({
    id: `level:${level}`,
    label: level === 0 ? "Cantrips" : `Level ${level}`,
    note: slotNote(sheet, level),
    level,
    cards: cards.filter((card) => (card.level ?? 0) === level),
  }));
}

function makeGroup(key: HandGroupKey, cards: HandCard[], sheet: Pick<CharacterSheet, "spellcasting" | "resources"> | null): HandGroup {
  let name: string;
  let noun: [string, string];
  let left = "";
  let tone: HandCardType = "basic";
  let sections: HandGroupSection[];
  if (key === "spells") {
    name = "Spells";
    noun = ["spell", "spells"];
    left = spellLeft(sheet);
    tone = "spell";
    sections = spellSections(cards, sheet);
  } else {
    if (key.startsWith("pool:")) {
      const pool = key.slice("pool:".length);
      const info = poolInfo(pool);
      const state = sheet?.resources?.[pool];
      name = info.name;
      noun = info.noun;
      left = state ? `${info.short} ${Math.max(0, state.max - state.used)}/${state.max}` : "";
      tone = "feature";
    } else if (key === "items") {
      name = "Items";
      noun = ["card", "cards"];
    } else {
      name = "Actions";
      noun = ["action", "actions"];
    }
    sections = [{ id: "all", label: name, note: left, cards }];
  }
  const playable = cards.filter((card) => !card.disabled);
  const reasons = [...new Set(cards.map((card) => card.disabled).filter((reason): reason is string => Boolean(reason)))];
  const disabled = playable.length ? null : reasons.length === 1 ? reasons[0] : `Nothing under ${name} can be played right now.`;
  return {
    id: `group:${key}`,
    key,
    name,
    noun,
    cards,
    sections,
    left,
    tone,
    icons: [...playable, ...cards.filter((card) => card.disabled)].slice(0, 3).map((card) => card.icon),
    costs: PIP_COSTS.filter((cost) => cards.some((card) => card.cost === cost)).map((cost) => ({
      cost,
      open: playable.some((card) => card.cost === cost),
    })),
    disabled,
    spent: !playable.length && cards.every((card) => card.spent),
  };
}

// The hand as the fan deals it: each folding group's card where its first
// card stood, every other card where it was. `groups` lists the folded ones.
export function groupHand(
  cards: HandCard[],
  sheet: Pick<CharacterSheet, "spellcasting" | "resources"> | null,
): { units: HandUnit[]; groups: HandGroup[] } {
  const buckets = new Map<HandGroupKey, HandCard[]>();
  for (const card of cards) {
    const key = groupKeyOf(card);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(card);
    else buckets.set(key, [card]);
  }
  const folded = new Map<HandGroupKey, HandGroup>();
  for (const [key, members] of buckets) {
    if (members.length >= GROUP_FOLD_MIN) folded.set(key, makeGroup(key, members, sheet));
  }
  const units: HandUnit[] = [];
  const placed = new Set<HandGroupKey>();
  for (const card of cards) {
    const key = groupKeyOf(card);
    const group = key ? folded.get(key) : undefined;
    if (!group) {
      units.push(card);
    } else if (!placed.has(group.key)) {
      placed.add(group.key);
      units.push(group);
    }
  }
  return { units, groups: [...folded.values()] };
}

// ---- finding a card in a group, or in More ----

export type HandFilter = { costs: HandCost[]; concentration: boolean; query: string };

export const NO_FILTER: HandFilter = { costs: [], concentration: false, query: "" };

export function filtering(filter: HandFilter): boolean {
  return filter.costs.length > 0 || filter.concentration || filter.query.trim().length > 0;
}

// The cards a filter keeps. Costs are any of those chosen; Concentration and
// the words typed narrow further. A word typed is the start of a word in the
// name, the dice line (so "fire" finds the fire spells) or what the card
// applies: a filter box, where a partial hit is the point.
export function filterCards(cards: HandCard[], filter: HandFilter): HandCard[] {
  const wanted = textKey(filter.query).split(" ").filter(Boolean);
  return cards.filter((card) => {
    if (filter.costs.length && !filter.costs.includes(card.cost)) return false;
    if (filter.concentration && !card.concentration) return false;
    if (!wanted.length) return true;
    const held = textKey([card.name, card.dice, card.damageType, card.condition].join(" ")).split(" ");
    return wanted.every((word) => held.some((part) => part.startsWith(word)));
  });
}

// `short` is what the chip shows, the pips' own word for the cost; `label`
// is its name in full, for a screen reader.
export type FilterChip = { id: HandCost | "concentration"; label: string; short: string; count: number };

const CHIP_LABEL: Record<"action" | "bonus" | "reaction", [string, string]> = {
  action: ["Action", "Action"],
  bonus: ["Bonus action", "Bonus"],
  reaction: ["Reaction", "Reaction"],
};

// The filter chips worth offering for these cards: a cost or Concentration
// only when some cards have it and some do not, so every chip narrows.
export function filterChips(cards: HandCard[]): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const cost of PIP_COSTS) {
    const count = cards.filter((card) => card.cost === cost).length;
    if (count > 0 && count < cards.length) {
      const [label, short] = CHIP_LABEL[cost as keyof typeof CHIP_LABEL];
      chips.push({ id: cost, label, short, count });
    }
  }
  const held = cards.filter((card) => card.concentration).length;
  if (held > 0 && held < cards.length) chips.push({ id: "concentration", label: "Concentration", short: "Concentration", count: held });
  return chips;
}

// A group's card count in words, and what it has left: the group card's
// accessible name and its face's lines.
export function groupSummary(group: HandGroup): string {
  return [plural(group.cards.length, group.noun), group.left].filter(Boolean).join(", ");
}

// The sections as one line for the group card's face:
// "Cantrips 4 · L1 5 · L2 3".
export function sectionLine(group: HandGroup): string {
  if (group.sections.length < 2) return "";
  return group.sections
    .map((section) => `${section.level ? `L${section.level}` : section.label} ${section.cards.length}`)
    .join(" · ");
}
