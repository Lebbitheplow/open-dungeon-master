// The Hand: a player's combat options as cards, derived from the character
// sheet and the turn so far (docs/visual-overhaul-plan.md 5.2).
//
// Every number on a card comes from the same pure helpers the engine uses
// (weaponAttackProfile, combatRiders, spellSaveDcFor, the resource table), so
// a card never promises something pc_attack or the cast tools would refuse.
// Pure and database-free: scripts/test-hand.mjs drives every branch. What a
// card says once it is played lives next door in hand-play.ts.
import { ragingMeleeBonus, weaponAttackProfile, weaponOf } from "@/lib/dm/attack-logic";
import { effectiveSpeed } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived } from "@/lib/srd";
import { AMMO_LABELS, ammoKindForWeapon, findAmmo } from "@/lib/srd/ammunition";
import { conditionOnHitDice } from "@/lib/srd/condition-effects";
import { combatRiders, type CombatRiders } from "@/lib/srd/feature-effects";
import { matchWeapon, type SrdWeapon } from "@/lib/srd/weapons";

import {
  FRESH_TURN,
  HAND_FAN_CAP,
  attackGate,
  addFlat,
  costGate,
  gated,
  hasFeature,
  lowestSlot,
  signed,
  slotLine,
  spellKey,
  standingGate,
  type BasicActionId,
  type Gate,
  type HandCard,
  type HandCost,
  type HandOptions,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { featureCards, spellCards, spellNames } from "@/lib/battlemap/hand-spells";

export * from "@/lib/battlemap/hand-core";

// ---- attacks ----

type Carried = { name: string; srd: SrdWeapon; qty: number };

function carriedWeapons(sheet: CharacterSheet): Carried[] {
  const seen = new Set<string>();
  const out: Carried[] = [];
  for (const item of sheet.equipment) {
    const srd = weaponOf(item) ?? matchWeapon(item.name);
    const key = item.name.trim().toLowerCase();
    if (!srd || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: item.name.trim(), srd, qty: item.qty });
  }
  return out;
}

function weaponRange(srd: SrdWeapon | null, reachTiles: number, thrown: boolean, ranged: boolean): string {
  if (ranged && srd?.rangeFt) return `${srd.rangeFt} ft`;
  const reach = `${reachTiles * 5} ft`;
  return thrown && srd?.rangeFt ? `${reach} / ${srd.rangeFt} ft` : reach;
}

function attackCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, options: HandOptions): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const profs = sheet.proficiencies.weapons;
  const allowed = 1 + riders.extraAttacks;
  const standing = standingGate(sheet, turn);
  const onHit = conditionOnHitDice(sheet.conditions);
  const cards: HandCard[] = [];
  const base = {
    type: "attack" as const,
    cost: "action" as const,
    roll: "",
    resource: "",
    condition: "",
    target: "enemy" as const,
    heals: false,
    save: null,
    disabled: null,
    spent: false,
    compose: false,
  };

  // A beast form swings with its statblock, not with the sheet's gear.
  if (sheet.wildShape?.attacks?.length) {
    for (const attack of sheet.wildShape.attacks) {
      cards.push(
        gated(
          {
            ...base,
            id: `attack:${spellKey(attack.name)}`,
            name: attack.name,
            range: "5 ft",
            dice: `${attack.damage} ${attack.type}`.trim(),
            roll: `${signed(attack.toHit)} to hit`,
            rules: `${sheet.wildShape.form} form.`,
            icon: { kind: "action", key: "attack" },
            toHit: attack.toHit,
            damage: attack.damage,
            damageType: attack.type,
            melee: true,
            intent: { card: "attack", weapon: attack.name },
          },
          standing,
          attackGate(turn, allowed),
        ),
      );
    }
    return cards;
  }

  const carried = carriedWeapons(sheet);
  const build = (name: string, srd: SrdWeapon | null, offHand: boolean): HandCard => {
    const profile = weaponAttackProfile(derived, profs, { displayName: name, srd, unarmed: srd === null }, { riders, offHand });
    const rage = ragingMeleeBonus(sheet, profile);
    const damage = `${addFlat(profile.damageExpression, rage)}${onHit.suffix}`;
    const notes: string[] = [];
    if (!offHand && allowed > 1) notes.push(`Extra Attack: ${allowed} swings on this action.`);
    if (riders.sneakAttackDice > 0 && profile.sneakEligible) {
      notes.push(`Sneak Attack +${riders.sneakAttackDice}d6 once a turn when it applies.`);
    }
    if (rage) notes.push(`Rage +${rage}.`);
    notes.push(...onHit.notes.map((note) => `${note}.`));
    notes.push(...profile.riderNotes.map((note) => `${note}.`));
    if (!profile.proficient) notes.push("Not proficient.");
    if (srd?.properties?.includes("versatile") && !profile.twoHanded) notes.push("Versatile: say two hands for the bigger die.");
    const ammoKind = srd?.properties?.includes("ammunition") ? ammoKindForWeapon(name) ?? ammoKindForWeapon(srd.name) : null;
    const ammo = ammoKind ? findAmmo(sheet.equipment, ammoKind) : null;
    const empty = ammoKind !== null && ammo === null;
    const card: HandCard = {
      ...base,
      id: `${offHand ? "offhand" : "attack"}:${spellKey(name)}`,
      name: offHand ? `Off-hand ${name}` : name,
      cost: offHand ? "bonus" : "action",
      range: weaponRange(srd, profile.reachTiles, profile.thrown, profile.ranged),
      dice: `${damage} ${profile.damageType}`.trim(),
      roll: `${signed(profile.toHit)} to hit`,
      rules: notes.slice(0, 2).join(" "),
      resource: ammoKind ? (ammo ? `${AMMO_LABELS[ammoKind]} ${ammo.count}` : `No ${AMMO_LABELS[ammoKind]}`) : "",
      icon: srd ? { kind: "item", key: srd.name, family: "item-weapon" } : { kind: "action", key: "attack" },
      toHit: profile.toHit,
      damage,
      damageType: profile.damageType,
      melee: !profile.ranged,
      intent: { card: "attack", weapon: name, ...(offHand ? { offHand: true } : {}) },
    };
    const ammoGate: Gate =
      empty && options.trackAmmo ? { reason: `Out of ${AMMO_LABELS[ammoKind!]}.`, spent: true } : null;
    if (offHand) {
      const opened: Gate =
        turn.attacksMade > 0 ? null : { reason: "Attack with a light weapon first; the off-hand swing follows it.", spent: false };
      return gated(card, standing, costGate("bonus", turn, sheet), opened);
    }
    return gated(card, standing, attackGate(turn, allowed), ammoGate);
  };

  for (const weapon of carried) cards.push(build(weapon.name, weapon.srd, false));
  cards.push(build("Unarmed strike", null, false));

  // Two-weapon fighting: two light melee weapons in hand buy a bonus swing.
  const light = carried.filter((weapon) => weapon.srd.kind === "melee" && weapon.srd.properties?.includes("light"));
  const lightCount = light.reduce((sum, weapon) => sum + weapon.qty, 0);
  if (lightCount >= 2) {
    const second = light.length > 1 ? light[1] : light[0];
    cards.push(build(second.name, second.srd, true));
  }
  return cards;
}

// ---- riders ----

// Battle Master die by fighter level; the engine's own table is in
// src/lib/dm/pc-attack.ts, which cannot be imported here (it reaches the
// database).
function superiorityDie(level: number): string {
  return level >= 18 ? "d12" : level >= 10 ? "d10" : "d8";
}

function riderCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders): HandCard[] {
  const standing = standingGate(sheet, turn);
  const cards: HandCard[] = [];
  const base = {
    type: "rider" as const,
    cost: "rider" as const,
    range: "Self",
    roll: "on a hit",
    condition: "",
    target: "none" as const,
    toHit: null,
    heals: false,
    save: null,
    melee: true,
    disabled: null,
    spent: false,
    compose: false,
  };
  if (riders.canSmite && sheet.spellcasting) {
    const slot = lowestSlot(sheet, 1);
    // The engine's smite: 2d8 at a 1st level slot, one more per level, six at most.
    const dice = `${Math.min(6, 1 + (slot?.level ?? 1))}d8`;
    cards.push(
      gated(
        {
          ...base,
          id: "rider:divine smite",
          name: "Divine Smite",
          dice: `+${dice} radiant`,
          rules: "Spend a slot as the blade lands. One more d8 against undead and fiends.",
          resource: slot ? slotLine(slot) : "No slots",
          icon: { kind: "feature", key: "Divine Smite", family: "class-paladin" },
          damage: dice,
          damageType: "radiant",
          intent: { card: "rider", rider: "Divine Smite", ...(slot ? { slotLevel: slot.level } : {}) },
        },
        standing,
        slot ? null : { reason: "No spell slot left to smite with.", spent: true },
      ),
    );
  }
  const pool = sheet.resources.sub_superiority_dice;
  if (pool) {
    const fighter = sheet.classes.find((entry) => entry.id.toLowerCase() === "fighter")?.level ?? sheet.level;
    const die = `1${superiorityDie(fighter)}`;
    const picks = sheet.features
      .map((feature) => /^maneuver:\s*(.+)$/i.exec(feature.name)?.[1]?.trim())
      .filter((name): name is string => Boolean(name));
    const left = pool.max - pool.used;
    for (const name of picks.length ? picks : ["Maneuver"]) {
      cards.push(
        gated(
          {
            ...base,
            id: `rider:${spellKey(name)}`,
            name,
            dice: `+${die}`,
            rules: picks.length ? "A superiority die rides this attack." : "Name the maneuver when you play it.",
            resource: `Dice ${left}/${pool.max}`,
            icon: { kind: "feature", key: name, family: "class-fighter" },
            damage: die,
            damageType: "",
            intent: { card: "rider", rider: name },
          },
          standing,
          left > 0 ? null : { reason: "No superiority dice left until a rest.", spent: true },
        ),
      );
    }
  }
  return cards;
}

// ---- the basics ----

const BASICS: Array<{ id: BasicActionId; name: string; rules: string; target: HandTarget; compose?: boolean }> = [
  { id: "dodge", name: "Dodge", rules: "Attacks against you roll at disadvantage until your next turn.", target: "none" },
  { id: "dash", name: "Dash", rules: "Double your movement this turn.", target: "none" },
  { id: "disengage", name: "Disengage", rules: "Your movement provokes no opportunity attacks this turn.", target: "none" },
  { id: "help", name: "Help", rules: "An ally gets advantage on their next check or attack.", target: "ally" },
  { id: "hide", name: "Hide", rules: "A Stealth check to slip out of sight.", target: "none" },
  { id: "ready", name: "Ready", rules: "Name a trigger; your reaction fires when it happens.", target: "none", compose: true },
  { id: "grapple", name: "Grapple", rules: "Athletics against their Athletics or Acrobatics. Takes the place of one attack.", target: "enemy" },
  { id: "shove", name: "Shove", rules: "Knock them prone or push them 5 ft. Takes the place of one attack.", target: "enemy" },
  { id: "use-object", name: "Use an object", rules: "Drink, pull, light, throw: say what.", target: "none", compose: true },
  { id: "end-turn", name: "End turn", rules: "Done with your action, movement and bonus action.", target: "none" },
];

function basicCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const cunning = hasFeature(sheet, "cunning action");
  const allowed = 1 + riders.extraAttacks;
  const standing = standingGate(sheet, turn);
  return BASICS.map((basic) => {
    const contest = basic.id === "grapple" || basic.id === "shove";
    // Cunning Action moves Dash, Disengage and Hide to the bonus action once
    // the action is gone.
    const quick = cunning && (basic.id === "dash" || basic.id === "disengage" || basic.id === "hide");
    const cost: HandCost =
      basic.id === "end-turn" ? "free" : quick && turn.actionUsed && !turn.bonusUsed ? "bonus" : "action";
    const athletics = derived.skills.athletics ?? derived.abilityMods.str;
    const card: HandCard = {
      id: `basic:${basic.id}`,
      type: "basic",
      name: basic.name,
      cost,
      range: contest ? "5 ft" : basic.id === "help" ? "5 ft" : "Self",
      dice: contest ? `Athletics ${signed(athletics)}` : basic.id === "hide" ? `Stealth ${signed(derived.skills.stealth ?? derived.abilityMods.dex)}` : "",
      roll: contest ? "contested check" : basic.id === "hide" ? "skill check" : "no roll",
      rules: quick ? `${basic.rules} Cunning Action: also a bonus action.` : basic.rules,
      resource: "",
      condition: basic.id === "dodge" ? "Dodging" : basic.id === "grapple" ? "Grappled" : basic.id === "shove" ? "Prone" : "",
      icon: { kind: "action", key: basic.id },
      target: basic.target,
      toHit: null,
      damage: null,
      damageType: "",
      heals: false,
      save: null,
      melee: contest,
      disabled: null,
      spent: false,
      compose: Boolean(basic.compose),
      intent: { card: "basic", action: basic.id },
    };
    if (basic.id === "end-turn") {
      // Ending the turn is always open to whoever holds it, down or not.
      return turn.myTurn ? card : gated(card, standing);
    }
    const still: Gate =
      basic.id === "dash" && effectiveSpeed(sheet.conditions, sheet.speed) === 0
        ? { reason: "Your speed is 0, so a Dash goes nowhere.", spent: false }
        : null;
    return gated(card, standing, contest ? attackGate(turn, allowed) : costGate(cost, turn, sheet), still);
  });
}

// ---- the hand ----

// Attacks, the riders that ride them, spells by level, class features, then
// the basics every character has, so a level 1 commoner still holds a hand.
export function deriveHand(sheet: CharacterSheet, turn: HandTurn = FRESH_TURN, options: HandOptions = {}): HandCard[] {
  const riders = combatRiders(sheet);
  return [
    ...attackCards(sheet, turn, riders, options),
    ...riderCards(sheet, turn, riders),
    ...spellCards(sheet, turn, riders, options),
    ...featureCards(sheet, turn),
    ...basicCards(sheet, turn, riders),
  ];
}

// The spells the component has to look up before the hand is complete.
export function spellsToLookUp(sheet: CharacterSheet): string[] {
  return spellNames(sheet);
}

// Nine in the fan; the rest wait behind the "more" spine in the same order.
// A playable card is never pushed behind the spine by an unplayable one.
export function splitHand(cards: HandCard[], cap = HAND_FAN_CAP): { fan: HandCard[]; more: HandCard[] } {
  if (cards.length <= cap) return { fan: cards, more: [] };
  const end = cards.find((card) => card.id === "basic:end-turn");
  const rest = cards.filter((card) => card !== end);
  // A bare fist gives its seat up too when there is steel to swing.
  const armed = rest.some((card) => card.intent.card === "attack" && card.id !== "attack:unarmed strike");
  const rank = (card: HandCard) => (card.disabled ? 2 : armed && card.id === "attack:unarmed strike" ? 1 : 0);
  const ranked = [...rest].sort((a, b) => rank(a) - rank(b));
  const keep = new Set(ranked.slice(0, end ? cap - 1 : cap));
  const fan = rest.filter((card) => keep.has(card));
  if (end) fan.push(end);
  return { fan, more: rest.filter((card) => !keep.has(card)) };
}

// Swings the Attack action grants this character (1 + Extra Attack), which
// is what afterCommit needs to know when the action closes.
export function attacksAllowed(sheet: CharacterSheet): number {
  return 1 + combatRiders(sheet).extraAttacks;
}
