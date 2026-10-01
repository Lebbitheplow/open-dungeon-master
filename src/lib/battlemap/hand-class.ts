// The class options the engine resolves on a player's attack, as the Hand
// offers them: Reckless Attack, Stunning Strike and a blow that knocks out as
// toggles on an attack card, Martial Arts' and Frenzy's bonus-action strikes
// and a monk's Flurry of Blows as cards of their own. Each is judged by the
// engine's own pure checks (checkAttackOptions in
// src/lib/dm/pc-attack-options.ts, spendAttack and spendAction in
// src/lib/dm/action-budget.ts), so a refusal on a card is the sentence
// pc_attack would give. Pure; scripts/test-hand-engine.mjs drives it.
import { spendAttack } from "@/lib/dm/action-budget";
import { hasOpenHandTechnique, hurlProblem, OPEN_HAND_NOT_FLURRY } from "@/lib/dm/attack-choice-rules";
import { inspirationProblem, strokeOfLuckProblem } from "@/lib/dm/attack-features";
import { weaponAttackProfile, type AttackProfile } from "@/lib/dm/attack-logic";
import { hasFastHands, kiLeft } from "@/lib/dm/bonus-routes";
import { checkAttackOptions, martialArtsApplies, type AnyBonusAttack } from "@/lib/dm/pc-attack-options";
import { heldInspiration } from "@/lib/dm/roll-riders";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived, type SheetDerived } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import { authoredBonusAttackProblem } from "@/lib/srd/authored-economy";
import { hasRapidStrike } from "@/lib/srd/authored-effects-more";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { classLevelOf, holdsFeature } from "@/lib/srd/trait-rules";
import type { SrdWeapon } from "@/lib/srd/weapons";
import {
  budgetOf,
  costGate,
  gated,
  signed,
  spellKey,
  standingGate,
  type Gate,
  type HandAttackOption,
  type HandCard,
  type HandTurn,
} from "@/lib/battlemap/hand-core";

const holds = (sheet: CharacterSheet, name: string) =>
  sheet.features.some((feature) => {
    const lowered = feature.name.trim().toLowerCase();
    return lowered === name || lowered.startsWith(`${name} (`);
  });

type OptionArgs = { stunningStrike?: boolean; reckless?: boolean; nonlethal?: boolean; bonusAttack?: AnyBonusAttack };

// Open Hand Technique's three riders, as the aim bar offers them.
const OPEN_HAND_OPTIONS: Array<{ id: HandAttackOption["id"]; label: string; note: string }> = [
  { id: "openHand:prone", label: "Knock prone", note: "Open Hand Technique: on a hit it makes a DEX save or falls prone." },
  { id: "openHand:push", label: "Push 15 ft", note: "Open Hand Technique: on a hit it makes a STR save or is pushed up to 15 feet away." },
  {
    id: "openHand:no reactions",
    label: "No reactions",
    note: "Open Hand Technique: on a hit it cannot take reactions until the end of your next turn.",
  },
];

// The engine's verdict on a swing carrying these options, or null when it
// would be accepted.
function optionRefusal(
  sheet: CharacterSheet,
  turn: HandTurn,
  profile: AttackProfile,
  derived: SheetDerived,
  args: OptionArgs,
): string | null {
  const verdict = checkAttackOptions({
    sheet,
    args,
    profile,
    kind: "weapon",
    atRange: profile.ranged,
    derived,
    budget: turn.myTurn ? budgetOf(turn, sheet) : null,
  });
  return "refused" in verdict ? verdict.refused : null;
}

// The toggles an attack card offers: only the ones the sheet could ever use
// on this kind of swing, each with the engine's refusal when not now.
export function attackOptionsFor(
  sheet: CharacterSheet,
  turn: HandTurn,
  profile: AttackProfile,
  derived: SheetDerived,
  // The swings the Attack action grants, and whether this card is a
  // bonus-action strike (which is never one of Flurry of Blows' strikes).
  swing: { allowed: number; bonusStrike?: boolean } = { allowed: 1 },
): HandAttackOption[] {
  const options: HandAttackOption[] = [];
  const melee = !profile.ranged;
  // Inspiration: offered while the DM's award is held; the refusal is the
  // engine's (attack-features.ts inspirationProblem).
  if (heldInspiration(sheet)) {
    options.push({
      id: "useInspiration",
      label: "Inspiration",
      note: "Spend your Inspiration: advantage on this attack roll.",
      disabled: inspirationProblem(sheet, true),
    });
  }
  // Stroke of Luck (rogue 20): a miss becomes a hit; spent only on a miss.
  if (classLevelOf(sheet, "rogue") >= 20 || holdsFeature(sheet, "stroke of luck")) {
    options.push({
      id: "strokeOfLuck",
      label: "Stroke of Luck",
      note: "If this attack misses, it hits instead. Spent only on a miss; back on a short or long rest.",
      disabled: strokeOfLuckProblem(sheet, true),
    });
  }
  // Hurl Through Hell (Fiend 14): the hit creature is gone until the end of
  // your next turn, then 10d10 psychic unless it is a fiend.
  if (holdsFeature(sheet, "hurl through hell") || (classLevelOf(sheet, "warlock") >= 14 && /fiend/i.test(sheet.subclass ?? ""))) {
    options.push({
      id: "hurlThroughHell",
      label: "Hurl Through Hell",
      note: "On a hit: gone through the lower planes until the end of your next turn, then 10d10 psychic unless a fiend. Once a long rest.",
      disabled: hurlProblem(sheet, true),
    });
  }
  // Rapid Strike (Samurai 15): this swing's advantage traded for one more
  // attack of the action, once a turn. The engine judges the advantage when
  // it rolls, and refuses in its own words when there is none.
  const rapid = hasRapidStrike(sheet);
  if (rapid && !swing.bonusStrike) {
    options.push({
      id: "rapidStrike",
      label: "Rapid Strike",
      note: `${rapid}: give up this attack's advantage for one more attack this turn. Only with advantage, once a turn.`,
      // Off the fighter's turn the whole card is refused by canAct already.
      disabled: null,
    });
  }
  // Open Hand Technique rides an unarmed strike paid for by Flurry of Blows:
  // asked of spendAttack exactly as pc_attack asks it.
  if (hasOpenHandTechnique(sheet) && profile.weapon === "Unarmed strike" && !swing.bonusStrike) {
    const before = turn.flurryStrikes ?? 0;
    const spend = spendAttack(budgetOf(turn, sheet, swing.allowed), sheet.name, { unarmed: true });
    const flurry = spend.ok && (spend.budget.flurryStrikes ?? 0) < before;
    for (const option of OPEN_HAND_OPTIONS) {
      options.push({ ...option, group: "openHand", disabled: flurry ? null : OPEN_HAND_NOT_FLURRY });
    }
  }
  if (holds(sheet, "reckless attack") && melee) {
    options.push({
      id: "reckless",
      label: "Reckless",
      note: "Advantage on your Strength melee attacks this turn; attacks against you have advantage until your next turn.",
      disabled: optionRefusal(sheet, turn, profile, derived, { reckless: true }),
    });
  }
  if (holds(sheet, "stunning strike") && melee) {
    const dc = 8 + derived.proficiencyBonus + derived.abilityMods.wis;
    options.push({
      id: "stunningStrike",
      label: "Stunning Strike",
      note: `1 ki on a hit: CON save DC ${dc} or stunned until your next turn.`,
      disabled: optionRefusal(sheet, turn, profile, derived, { stunningStrike: true }),
    });
  }
  if (melee) {
    options.push({
      id: "nonlethal",
      label: "Knock out",
      note: "A blow that drops it leaves it unconscious at 0 hit points instead of dead.",
      disabled: optionRefusal(sheet, turn, profile, derived, { nonlethal: true }),
    });
  }
  return options;
}

type Carried = { name: string; srd: SrdWeapon };

// Martial Arts' bonus unarmed strike and Frenzy's bonus melee attack, for the
// characters who have them. Refused, until the engine would take them, with
// the engine's own sentence.
export function bonusStrikeCards(
  sheet: CharacterSheet,
  turn: HandTurn,
  riders: CombatRiders,
  carried: Carried[],
): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const profs = sheet.proficiencies.weapons;
  const cards: HandCard[] = [];
  const standing = standingGate(sheet, turn, "bonus");
  const strike = (
    bonusAttack: AnyBonusAttack,
    weapon: string,
    srd: SrdWeapon | null,
    name: string,
    rules: string,
  ): HandCard => {
    const profile = weaponAttackProfile(
      derived,
      profs,
      { displayName: weapon, srd, unarmed: srd === null },
      { riders, martialArts: martialArtsApplies(sheet) },
    );
    const refused = optionRefusal(sheet, turn, profile, derived, { bonusAttack });
    const card: HandCard = {
      id: `attack:${spellKey(weapon)}:${bonusAttack.replace(/\s+/g, "-")}`,
      type: "attack",
      name,
      cost: "bonus",
      range: profile.ranged && srd?.rangeFt ? `${srd.rangeFt} ft` : `${profile.reachTiles * 5} ft`,
      dice: `${profile.damageExpression} ${profile.damageType}`.trim(),
      roll: `${signed(profile.toHit)} to hit`,
      rules,
      resource: "",
      condition: "",
      icon: srd ? { kind: "item", key: srd.name, family: "item-weapon" } : { kind: "action", key: "attack" },
      target: "enemy",
      toHit: profile.toHit,
      damage: profile.damageExpression,
      damageType: profile.damageType,
      heals: false,
      save: null,
      melee: !profile.ranged,
      disabled: null,
      spent: false,
      compose: false,
      intent: { card: "attack", weapon, attack: { bonusAttack } },
      options: attackOptionsFor(sheet, turn, profile, derived, { allowed: 1, bonusStrike: true }).filter(
        (option) => option.id !== "reckless",
      ),
    };
    const refusedGate: Gate = refused ? { reason: refused, spent: false } : null;
    return gated(card, standing, costGate("bonus", turn, sheet, name), refusedGate);
  };
  if (holds(sheet, "martial arts")) {
    cards.push(
      strike(
        "martial arts",
        "Unarmed strike",
        null,
        "Martial Arts strike",
        "After the Attack action with an unarmed strike or a monk weapon: one more unarmed strike.",
      ),
    );
  }
  if (holds(sheet, "frenzy")) {
    const melee = carried.find((entry) => entry.srd.kind === "melee");
    cards.push(
      strike(
        "frenzy",
        melee?.name ?? "Unarmed strike",
        melee?.srd ?? null,
        "Frenzy attack",
        "While raging in a frenzy: one melee weapon attack as a bonus action. Exhaustion when the rage ends.",
      ),
    );
  }
  // A subclass's bonus weapon attack (Battle Magic, War Magic, Sudden Strike,
  // Curving Shot...): pc_attack bonusAttack "feature", judged by the authored
  // layer's own check (src/lib/srd/authored-effects.ts).
  const offers = activeAuthored(sheet, "bonus_attack");
  if (offers.length) {
    const verdict = authoredBonusAttackProblem(sheet, turn.myTurn ? budgetOf(turn, sheet) : null);
    const feature = "feature" in verdict ? verdict.feature : offers[0].held.feature;
    const weapon = carried[0];
    cards.push(
      strike(
        "feature",
        weapon?.name ?? "Unarmed strike",
        weapon?.srd ?? null,
        `${feature} attack`,
        `${feature}: one weapon attack as a bonus action.`,
      ),
    );
  }
  return cards;
}

// Fast Hands (Thief 3): Cunning Action's bonus action also Uses an Object
// (take_action use_object with bonus, which the engine prices through
// hasFastHands).
export function fastHandsCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  if (!hasFastHands(sheet)) return [];
  const card: HandCard = {
    id: "basic:use-object:bonus",
    type: "basic",
    name: "Fast Hands: Use an object",
    cost: "bonus",
    range: "Self",
    dice: "",
    roll: "no roll",
    rules: "Drink, pull, light, throw: say what. Fast Hands: a bonus action.",
    resource: "",
    condition: "",
    icon: { kind: "action", key: "use-object" },
    target: "none",
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: false,
    disabled: null,
    spent: false,
    compose: true,
    intent: { card: "basic", action: "use-object", bonus: true },
  };
  return [gated(card, standingGate(sheet, turn, "bonus"), costGate("bonus", turn, sheet, "Fast Hands (Use an Object)"))];
}

// Flurry of Blows: 1 ki and the bonus action, after the Attack action, for
// two unarmed strikes (use_resource Ki, variant "flurry of blows"). Once
// bought, the strikes are played with the Unarmed strike card, which the
// engine's spendAttack pays from the flurry.
export function kiCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  // A ki counter is a monk's (Ki, monk 2), and Flurry of Blows comes with it.
  const ki = sheet.resources.ki;
  if (!ki) {
    return [];
  }
  const left = kiLeft(sheet) ?? 0;
  const bought = (turn.flurryStrikes ?? 0) > 0;
  const card: HandCard = {
    id: "feature:ki:flurry",
    type: "feature",
    name: "Flurry of Blows",
    cost: "bonus",
    range: "5 ft",
    dice: "2 unarmed strikes",
    roll: "then play Unarmed strike",
    rules: "After the Attack action: two unarmed strikes as a bonus action.",
    resource: `Ki ${left}/${ki.max} · 1 ki`,
    condition: "",
    icon: { kind: "feature", key: "Flurry of Blows", family: "class-monk" },
    target: "none",
    toHit: null,
    damage: null,
    damageType: "",
    heals: false,
    save: null,
    melee: true,
    disabled: null,
    spent: false,
    compose: false,
    intent: { card: "feature", resourceId: "ki", variant: "flurry of blows" },
  };
  const afterAttack: Gate =
    turn.attacksMade > 0 || bought
      ? null
      : { reason: "Flurry of Blows follows the Attack action: attack first, then spend the ki.", spent: false };
  return [
    gated(
      card,
      standingGate(sheet, turn, "bonus"),
      left >= 1 ? null : { reason: `${sheet.name} has no ki point left for Flurry of Blows. It comes back after a rest.`, spent: true },
      costGate("bonus", turn, sheet, "Flurry of Blows"),
      afterAttack,
    ),
  ];
}
