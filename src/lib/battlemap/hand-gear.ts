// The Hand's gear cards (issue #424): what a character does with the things
// in their hands during a fight, each sent to the tool that keeps the count
// (handle_item, use_item, stabilize, dismount), so the card costs what the
// engine charges.
//
// SRD 5.1: drawing or stowing a weapon, picking something up and handing it
// over are the one free object interaction a turn; a second takes the Use an
// Object action. Dropping something costs nothing. A shield is an action to
// don or doff; armor takes minutes, so it has no card. Drinking a potion or
// feeding one to an ally is an action, and so is stabilizing a dying ally.
// Dismounting costs half the rider's speed.
//
// Pure and database-free: scripts/test-hand-gear.mjs drives it.
import { handsFullError, handsFullFor, spendInteraction, gearKindOf, inHand } from "@/lib/dm/gear-hands";
import { dualWields } from "@/lib/dm/attack-rules";
import { hasFastHands } from "@/lib/dm/bonus-routes";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { wearingIsExplicit } from "@/lib/srd/armor";
import { itemTags } from "@/lib/srd/item-tags";
import { textKey } from "@/lib/language/text-logic";
import {
  budgetOf,
  costGate,
  gated,
  standingGate,
  type Gate,
  type HandCard,
  type HandChoice,
  type HandCost,
  type HandGearContext,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import type { HandGearAction } from "@/lib/battlemap/hand-intent";

// A pick of more than this many rows is cut to the first ones: the pills
// sit in the aim bar, and a pack's whole contents is not a choice.
const MAX_PICKS = 8;

const BLANK = {
  range: "Self",
  dice: "",
  roll: "no roll",
  resource: "",
  condition: "",
  toHit: null,
  damage: null,
  damageType: "",
  heals: false,
  save: null,
  melee: false,
  disabled: null,
  spent: false,
  compose: false,
} as const;

function card(
  id: string,
  name: string,
  action: HandGearAction,
  cost: HandCost,
  rules: string,
  icon: HandCard["icon"],
  extra: Partial<HandCard> = {},
): HandCard {
  return { ...BLANK, id: `gear:${id}`, type: "basic", name, cost, rules, icon, target: "none", intent: { card: "gear", action }, ...extra };
}

function pick(label: string, rows: Array<{ value: string; label: string; note?: string }>): HandChoice {
  return { arg: "item", label, options: rows.slice(0, MAX_PICKS) };
}

function once<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const name = textKey(key(row));
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

const rowPick = (item: EquipmentItem) => ({ value: item.name, label: item.name, ...(item.qty > 1 ? { note: `×${item.qty}` } : {}) });

// What the interaction costs now: nothing while it is unspent, the Use an
// Object action after (Fast Hands' bonus action for a thief), in the
// engine's own words when neither is left.
function interactionCost(sheet: CharacterSheet, turn: HandTurn): { cost: HandCost; note: string; gate: Gate } {
  if (!turn.interactionUsed) {
    return { cost: "free", note: "Your free object interaction this turn.", gate: null };
  }
  const result = spendInteraction(budgetOf(turn, sheet), {
    what: "another object",
    who: sheet.name,
    fastHands: hasFastHands(sheet),
    dualWielder: dualWields(sheet.feats, sheet.campaignId),
  });
  const bonus = result.ok && result.budget.bonusUsed && !turn.bonusUsed;
  return {
    cost: bonus ? "bonus" : "action",
    note: bonus
      ? "Your free object interaction is spent: Fast Hands makes this one your bonus action."
      : "Your free object interaction is spent: this one takes the Use an Object action.",
    gate: result.ok ? null : { reason: result.error, spent: true },
  };
}

export function gearCards(sheet: CharacterSheet, turn: HandTurn, context: HandGearContext = {}): HandCard[] {
  const standing = standingGate(sheet, turn, "action");
  const free = standingGate(sheet, turn, "free");
  const interaction = interactionCost(sheet, turn);
  const touch = { cost: interaction.cost, resource: interaction.cost === "free" ? "Interaction" : "", interaction: true };
  const cards: HandCard[] = [];
  const equipment = sheet.equipment;
  const explicit = wearingIsExplicit(equipment);
  const weapons = once(equipment.filter((item) => gearKindOf(item) === "weapon"), (item) => item.name);
  const held = weapons.filter((item) => inHand(item, equipment));
  const stowed = explicit ? weapons.filter((item) => item.equipped !== true) : [];

  // The shield: on the arm or off it, an action either way.
  const shield = equipment.find((item) => gearKindOf(item) === "shield");
  if (shield) {
    const worn = inHand(shield, equipment);
    cards.push(
      gated(
        card(
          worn ? "doff-shield" : "don-shield",
          worn ? `Take off ${shield.name}` : `Strap on ${shield.name}`,
          worn ? "unequip" : "equip",
          "action",
          worn ? "An action to take it off: your AC drops by its bonus, and the hand is free." : "An action to strap it on: its bonus to AC, and that hand is taken.",
          { kind: "item", key: shield.name, family: "item-armor" },
          { choice: pick("Shield", [rowPick(shield)]) },
        ),
        standing,
        costGate("action", turn, sheet, worn ? `taking off ${shield.name}` : `strapping on ${shield.name}`),
      ),
    );
  }

  if (stowed.length) {
    // Only what a free hand can take; with none free, the card says how to
    // free one (dropping is free, putting one away is the interaction).
    const fits = stowed.filter((item) => !handsFullFor(equipment, item).length);
    const full: Gate = fits.length ? null : { reason: handsFullError(sheet.name, "another weapon", handsFullFor(equipment, stowed[0])), spent: false };
    cards.push(
      gated(
        card("draw", "Draw a weapon", "equip", touch.cost, `${interaction.note} A hand holds one weapon; a two-handed one takes both.`, { kind: "action", key: "use-object" }, {
          resource: touch.resource,
          interaction: touch.interaction,
          choice: pick("Weapon", (fits.length ? fits : stowed).map(rowPick)),
        }),
        standing,
        full,
        interaction.gate,
      ),
    );
  }
  if (held.length) {
    cards.push(
      gated(
        card("stow", "Stow a weapon", "unequip", touch.cost, `${interaction.note} Sheathed or slung, it is ready to draw again.`, { kind: "action", key: "use-object" }, {
          resource: touch.resource,
          interaction: touch.interaction,
          choice: pick("Weapon", held.map(rowPick)),
        }),
        standing,
        interaction.gate,
      ),
    );
    // Letting go costs nothing, and the thing lies where it fell.
    cards.push(
      gated(
        card("drop", "Drop", "drop", "free", "Free: it falls at your feet and lies there to be picked up.", { kind: "action", key: "use-object" }, {
          choice: pick("Item", held.map(rowPick)),
        }),
        free,
      ),
    );
  }

  const reach = (context.drops ?? []).filter((drop) => drop.reach);
  if (reach.length) {
    cards.push(
      gated(
        card("pick-up", "Pick up", "pick_up", touch.cost, `${interaction.note} Something within 5 feet of you.`, { kind: "action", key: "use-object" }, {
          resource: touch.resource,
          interaction: touch.interaction,
          choice: pick("Item", once(reach, (drop) => drop.name).map((drop) => ({ value: drop.id, label: drop.name }))),
        }),
        standing,
        interaction.gate,
      ),
    );
  }

  // Something passed to an ally within 5 feet: a weapon, a potion, a scroll.
  const passable = once(
    equipment.filter((item) => {
      const kind = gearKindOf(item);
      if (kind === "armor" || kind === "shield" || (kind === "worn" && item.equipped === true)) return false;
      const tags = itemTags(item);
      return kind === "weapon" || tags.includes("potion") || tags.includes("scroll") || tags.includes("consumable");
    }),
    (item) => item.name,
  );
  if (passable.length && (context.allies ?? 0) > 0) {
    cards.push(
      gated(
        card("hand", "Hand to an ally", "hand", touch.cost, `${interaction.note} They must be within 5 feet; it is theirs to use on their turn.`, { kind: "action", key: "help" }, {
          resource: touch.resource,
          interaction: touch.interaction,
          target: "ally",
          range: "5 ft",
          choice: pick("Item", passable.map(rowPick)),
        }),
        standing,
        interaction.gate,
      ),
    );
  }

  // A potion, drunk or poured down an ally's throat: an action (use_item).
  const potions = once(equipment.filter((item) => itemTags(item).includes("potion")), (item) => item.name);
  if (potions.length) {
    cards.push(
      gated(
        card("potion", "Drink a potion", "use", "action", "An action, for you or an ally within reach: a dying ally drinks too.", { kind: "item", key: potions[0].name, family: "item-gear" }, {
          target: "ally",
          range: "Touch",
          choice: pick("Potion", potions.map(rowPick)),
        }),
        standing,
        costGate("action", turn, sheet, "drinking a potion"),
      ),
    );
  }

  // Basics that only matter now and then.
  const dying = context.dying ?? [];
  if (dying.some((ally) => ally.id !== sheet.id)) {
    cards.push(
      gated(
        {
          ...BLANK,
          id: "basic:stabilize",
          type: "basic",
          name: "Stabilize",
          cost: "action",
          range: "Touch",
          dice: "Medicine DC 10",
          roll: "skill check",
          rules: "An action: a DC 10 Medicine check, or a healer's kit with no roll, and they stop dying.",
          icon: { kind: "action", key: "help" },
          target: "ally",
          intent: { card: "basic", action: "stabilize" },
        },
        standing,
        costGate("action", turn, sheet, "stabilizing"),
      ),
    );
  }
  if (context.mount) {
    cards.push(
      gated(
        {
          ...BLANK,
          id: "basic:dismount",
          type: "basic",
          name: "Dismount",
          cost: "free",
          rules: `Off ${context.mount}: half your speed.`,
          icon: { kind: "action", key: "stand-up" },
          target: "none",
          intent: { card: "basic", action: "dismount" },
        },
        standingGate(sheet, turn, "move"),
      ),
    );
  }
  return cards;
}

// The Attack action draws the weapon it swings with when a hand is free and
// the interaction is too (pc-attack-plan.ts); otherwise a stowed weapon is
// not swung this turn, in the engine's own words.
export function undrawnGate(sheet: CharacterSheet, turn: HandTurn, weapon: string): Gate {
  if (!wearingIsExplicit(sheet.equipment)) return null;
  const row = sheet.equipment.find((item) => textKey(item.name) === textKey(weapon));
  if (!row || gearKindOf(row) !== "weapon" || row.equipped === true) return null;
  const full = handsFullFor(sheet.equipment, row);
  if (full.length) return { reason: handsFullError(sheet.name, row.name, full), spent: false };
  if (!turn.interactionUsed) return null;
  const result = spendInteraction(budgetOf(turn, sheet), { what: `drawing ${row.name}`, who: sheet.name, withAction: false });
  return result.ok ? null : { reason: result.error, spent: true };
}
