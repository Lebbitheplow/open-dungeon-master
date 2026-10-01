// The subclass features the authored layer resolves (src/lib/srd/authored-
// effects.ts), as the Hand and the sheet offer them: each spend a card
// played with use_resource by the feature's own name (Kensei's Shot, Shadow
// Step, Psychic Blades...), Intimidating Presence aimed at a creature, and the
// once-chosen options (Totem Spirit, Aspect of the Beast...) as a pick on the
// sheet. Each card carries the engine's own gate and pool, so a card is never
// offered for a spend use_resource would refuse for want of the feature.
//
// Pure; scripts/test-hand-engine.mjs drives it.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { gateHolds, heldAuthored, type AuthoredSpend } from "@/lib/srd/authored-effects";
import { holdsFeature } from "@/lib/srd/trait-rules";
import {
  costGate,
  gated,
  primaryClass,
  spellKey,
  standingGate,
  type Gate,
  type HandCard,
  type HandCost,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";

type SpendDoes = AuthoredSpend["does"];

const COST: Record<string, HandCost> = { action: "action", bonus: "bonus", none: "free" };

function targetOf(does: SpendDoes): HandTarget {
  if (does.kind === "buff") {
    return does.target === "enemy" ? "enemy" : does.target === "ally" ? "ally" : "self";
  }
  if (does.kind === "save_effect" || does.kind === "insight_contest" || does.kind === "die_damage") return "enemy";
  return "none";
}

function linesOf(does: SpendDoes): { dice: string; condition: string } {
  switch (does.kind) {
    case "buff":
      return { dice: typeof does.condition === "string" ? does.condition : does.condition[0]?.[1] ?? "", condition: typeof does.condition === "string" ? does.condition : "" };
    case "save_effect":
      return { dice: `${does.save.toUpperCase()} save`, condition: does.condition ?? "" };
    case "temp_hp":
      return { dice: "temp hp", condition: "" };
    case "teleport":
      return { dice: `${does.feet} ft`, condition: "" };
    case "die_damage":
      return { dice: `+${typeof does.dice === "string" ? does.dice : "dice"} ${does.type}`, condition: "" };
    default:
      return { dice: "", condition: "" };
  }
}

// One card per spend the character holds that is played in a fight. The
// counters populateResources makes for these features are already cards
// (hand-spells.ts featureCards); `taken` names them so none shows twice.
export function subclassSpendCards(sheet: CharacterSheet, turn: HandTurn, taken: Set<string>): HandCard[] {
  const cards: HandCard[] = [];
  for (const held of heldAuthored(sheet)) {
    for (const spend of held.entry.spends ?? []) {
      const does = spend.does;
      const action = spend.action ?? "action";
      if (spend.fight === "out" || does.kind === "choose" || action === "reaction") continue;
      if (taken.has(spellKey(spend.name)) || !gateHolds(spend.gate, sheet, held)) continue;
      taken.add(spellKey(spend.name));
      const cost = COST[action] ?? "action";
      const pool = spend.pool;
      const state = pool ? sheet.resources[pool.id] : undefined;
      const left = state ? state.max - state.used : null;
      const lines = linesOf(does);
      const perUnit = Boolean(pool?.perUnit);
      const card: HandCard = {
        id: `feature:authored:${spellKey(spend.name).replace(/\s+/g, "-")}`,
        type: does.kind === "save_effect" ? (lines.condition ? "control" : "spell") : does.kind === "buff" ? "ward" : "feature",
        name: spend.name,
        cost,
        range: targetOf(does) === "self" || targetOf(does) === "none" ? "Self" : "",
        dice: lines.dice,
        roll: does.kind === "save_effect" ? "no attack" : "no roll",
        rules: `${held.feature}: the server resolves it.`,
        resource: state && left !== null ? `${pool!.id.replace(/_/g, " ")} ${left}/${state.max}` : "",
        condition: lines.condition,
        icon: { kind: "feature", key: spend.name, family: `class-${primaryClass(sheet)}` },
        target: targetOf(does),
        toHit: null,
        damage: null,
        damageType: "",
        heals: false,
        save: null,
        melee: false,
        disabled: null,
        spent: false,
        // A spend by amount (Sharpen the Blade, Touch of the Long Death): the
        // player says how much in the box.
        compose: perUnit,
        ...(perUnit ? { unit: pool!.id === "ki" ? "ki" : "points" } : {}),
        intent: { card: "feature", resourceId: spend.name },
      };
      if (does.kind === "variants") {
        card.choice = {
          arg: "variant",
          label: "Choose",
          options: Object.keys(does.options).map((value) => ({ value, label: value.replace(/^./, (c) => c.toUpperCase()) })),
        };
      }
      const need = pool?.optional ? 0 : pool?.amount ?? 1;
      const poolGate: Gate =
        state && left !== null && left < need && !perUnit
          ? { reason: `${spend.name} needs ${need} ${pool!.id.replace(/_/g, " ")} and ${sheet.name} has ${left}. It comes back after a rest.`, spent: true }
          : null;
      cards.push(
        gated(
          card,
          standingGate(sheet, turn, cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
          poolGate,
          cost === "free" ? null : costGate(cost, turn, sheet, spend.name),
        ),
      );
    }
  }
  return cards;
}

// Intimidating Presence (Berserker 10): the action, one creature within 30
// feet, a WIS save against 8 + proficiency + CHA or frightened until the end
// of the barbarian's next turn (use_resource with targetEnemyId; the engine's
// combat-features.ts rolls it).
export function intimidatingPresenceCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!holdsFeature(sheet, "intimidating presence")) return [];
  const derived = computeSheetDerived(sheet);
  const dc = 8 + derived.proficiencyBonus + derived.abilityMods.cha;
  const card: HandCard = {
    id: "feature:intimidating-presence",
    type: "control",
    name: "Intimidating Presence",
    cost: "action",
    range: "30 ft",
    dice: `WIS save DC ${dc}`,
    roll: "no attack",
    rules: "Frightened until the end of your next turn; a creature that saves cannot be frightened by it for 24 hours.",
    resource: "",
    condition: "Frightened",
    icon: { kind: "feature", key: "Intimidating Presence", family: "class-barbarian" },
    target: "enemy",
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: { ability: "WIS", dc },
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    intent: { card: "feature", resourceId: "Intimidating Presence" },
  };
  return [gated(card, standingGate(sheet, turn, "action"), costGate("action", turn, sheet, "Intimidating Presence"))];
}

// The once-chosen options of the subclass features a character holds
// (Totem Spirit, Aspect of the Beast, Totemic Attunement, Transmuter's Stone,
// Elemental Gift, Armor Model): use_resource by the feature's name with the
// option as the variant, outside a fight. `chosen` is the option the sheet's
// feature name already carries ("Totem Spirit (Bear)"), or null.
export type FeatureChoice = { feature: string; spend: string; options: string[]; chosen: string | null };

export function featureChoices(sheet: CharacterSheet): FeatureChoice[] {
  const out: FeatureChoice[] = [];
  for (const held of heldAuthored(sheet)) {
    for (const spend of held.entry.spends ?? []) {
      if (spend.does.kind !== "choose") continue;
      out.push({ feature: held.feature, spend: spend.name, options: spend.does.options, chosen: held.choice });
    }
  }
  return out;
}
