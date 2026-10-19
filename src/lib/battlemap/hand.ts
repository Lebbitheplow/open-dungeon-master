// The Hand: a player's combat options as cards, derived from the character
// sheet and the turn so far (docs/visual-overhaul-plan.md 5.2).
//
// Every number on a card comes from the same pure helpers the engine uses
// (weaponAttackProfile, combatRiders, spellSaveDcFor, the resource table), so
// a card never promises something pc_attack or the cast tools would refuse.
// Pure and database-free: scripts/test-hand.mjs drives every branch. What a
// card says once it is played lives next door in hand-play.ts.
import { racialNaturalWeapon } from "@/lib/srd/racial-weapons";
import { optionCards } from "@/lib/battlemap/hand-options";
import { maneuverDieFor, maneuverUse, type ManeuverUse } from "@/lib/dm/maneuver-rules";
import { ragingMeleeBonus, weaponAttackProfile, weaponOf } from "@/lib/dm/attack-logic";
import { dualWields, handsRuling, offHandProblem } from "@/lib/dm/attack-rules";
import { shillelaghSwing } from "@/lib/dm/attack-features";
import { magicWeaponOfRow, type WeaponGear } from "@/lib/dm/gear-attack";
import { bonusRouteFor, kiLeft, usesLeft, type BonusRoute, type MoveAction } from "@/lib/dm/bonus-routes";
import { effectiveSpeed, exhaustionSpeed } from "@/lib/dm/condition-logic";
import { martialArtsApplies } from "@/lib/dm/pc-attack-options";
import { attackOptionsFor, bonusStrikeCards, fastHandsCards, kiCards } from "@/lib/battlemap/hand-class";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { acBreakdownFor, computeSheetDerived } from "@/lib/srd";
import { AMMO_LABELS, ammoKindForWeapon, findAmmo } from "@/lib/srd/ammunition";
import { conditionOnHitDice } from "@/lib/srd/condition-effects";
import { combatRiders, type CombatRiders } from "@/lib/srd/feature-effects";
import { matchWeapon, type SrdWeapon } from "@/lib/srd/weapons";

import {
  FRESH_TURN,
  attackGate,
  addFlat,
  costGate,
  gated,
  lowestSlot,
  signed,
  slotLine,
  standingGate,
  budgetOf,
  type BasicActionId,
  type Gate,
  type HandCard,
  type HandCost,
  type HandOptions,
  type HandTarget,
  type HandTurn,
} from "@/lib/battlemap/hand-core";
import { featureCards, spellCards, spellNames } from "@/lib/battlemap/hand-spells";
import { intimidatingPresenceCards, subclassSpendCards } from "@/lib/battlemap/hand-subclass";
import { spellHoldOf } from "@/lib/battlemap/hand-escape";
import { textKey } from "@/lib/language/text-logic";

export * from "@/lib/battlemap/hand-core";

// ---- attacks ----

type Carried = { name: string; srd: SrdWeapon; qty: number; gear: WeaponGear | null };

// Every carried row the engine would swing, resolved as resolveAttackWeapon
// resolves a named weapon: a homebrew block first, then a magic weapon's base
// item and riders (a Berserker Axe is a battleaxe with its +1 and its
// attunement judged), then the SRD table by name.
export function carriedWeapons(sheet: Pick<CharacterSheet, "equipment">): Carried[] {
  const seen = new Set<string>();
  const out: Carried[] = [];
  for (const item of sheet.equipment) {
    const own = weaponOf(item);
    const magic = magicWeaponOfRow(item);
    const srd = (magic.gear ? magic.srd : null) ?? own ?? matchWeapon(item.name);
    const key = textKey(item.name);
    if (!srd || seen.has(key)) continue;
    seen.add(key);
    out.push({ name: item.name.trim(), srd, qty: item.qty, gear: magic.gear ?? null });
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
  const standing = standingGate(sheet, turn, "attack");
  // Martial Arts only with no armor and no shield (the engine's own gate).
  const martialArts = martialArtsApplies(sheet);
  // A shield on the arm keeps a versatile weapon in one hand, whatever is
  // asked, and a two-handed weapon out of use (handsRuling in
  // src/lib/dm/attack-rules.ts). The off-hand swing of two-weapon fighting
  // has a weapon in each hand, so it is one-handed as well.
  const shieldName = acBreakdownFor(sheet).shieldName;
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
            id: `attack:${textKey(attack.name)}`,
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
          attackGate(turn, allowed, sheet),
        ),
      );
    }
    return cards;
  }

  const carried = carriedWeapons(sheet);
  const build = (name: string, srd: SrdWeapon | null, offHand: boolean, gear: WeaponGear | null = null, natural = false): HandCard => {
    const resolved = { displayName: name, srd, unarmed: srd === null, ...(gear ? { gear } : {}) };
    // Shillelagh, as pc_attack swings it: a club or quarterstaff deals a d8
    // with the spellcasting ability when that is better, and is no longer
    // versatile (shillelaghSwing in src/lib/dm/attack-features.ts).
    const shillelagh = shillelaghSwing(sheet, resolved, derived);
    const held = shillelagh?.resolved.srd ?? srd;
    const profile = weaponAttackProfile(
      shillelagh?.derived ?? derived,
      // A natural weapon is always proficient, as the engine swings it.
      natural ? [...profs, "simple", name.toLowerCase()] : profs,
      shillelagh?.resolved ?? resolved,
      { riders, offHand, martialArts },
    );
    const rage = ragingMeleeBonus(sheet, profile);
    const damage = `${addFlat(profile.damageExpression, rage)}${onHit.suffix}`;
    const notes: string[] = [];
    if (!offHand && allowed > 1) notes.push(`Extra Attack: ${allowed} swings on this action.`);
    if (riders.sneakAttackDice > 0 && profile.sneakEligible) {
      notes.push(`Sneak Attack +${riders.sneakAttackDice}d6 once a turn when it applies.`);
    }
    if (rage) notes.push(`Rage +${rage}.`);
    notes.push(...onHit.notes.map((note) => `${note}.`));
    if (shillelagh) notes.push(`${shillelagh.note}.`);
    notes.push(...profile.riderNotes.map((note) => `${note}.`));
    if (!profile.proficient) notes.push("Not proficient.");
    // The bigger die is for a melee attack (SRD 5.1), so a weapon that can
    // also be thrown says where it counts.
    if (held?.properties?.includes("versatile") && !profile.twoHanded && !shieldName && !offHand) {
      notes.push(profile.thrown ? "Versatile: say two hands in melee for the bigger die." : "Versatile: say two hands for the bigger die.");
    }
    const ammoKind = srd?.properties?.includes("ammunition") ? ammoKindForWeapon(srd.name) : null;
    const ammo = ammoKind ? findAmmo(sheet.equipment, ammoKind) : null;
    const empty = ammoKind !== null && ammo === null;
    const card: HandCard = {
      ...base,
      id: `${offHand ? "offhand" : "attack"}:${textKey(name)}`,
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
      ...(offHand ? {} : { options: attackOptionsFor(sheet, turn, profile, derived, { allowed }) }),
    };
    const ammoGate: Gate =
      empty && options.trackAmmo ? { reason: `Out of ${AMMO_LABELS[ammoKind!]}.`, spent: true } : null;
    // A two-handed weapon is not swung at all with a shield on the arm, in
    // handsRuling's own words. A lance is left to the engine: the Hand does
    // not know whether its rider is mounted.
    const hands = held
      ? handsRuling({ who: sheet.name, weapon: name, properties: held.properties ?? [], lance: false, mounted: false, twoHandedAsked: false, shieldName })
      : null;
    const handsGate: Gate = hands && "error" in hands ? { reason: hands.error, spent: false } : null;
    if (offHand) {
      // The engine's own rule (attack-rules.ts offHandProblem): the swing is
      // earned by the Attack action's weapon, not by any attack, so a rapier
      // swing leaves the card shut and a dagger swing opens it (issue 210).
      // A server too old to say what the action was made with leaves the
      // card to the first swing, as it always was.
      const legacy = turn.lightMeleeAttack === undefined && turn.attacksMade > 0;
      const rule = offHandProblem({
        who: sheet.name,
        profile,
        budget: turn.myTurn
          ? { ...budgetOf(turn, sheet, allowed), ...(legacy ? { lightMeleeAttack: true, oneHandMeleeAttack: true } : {}) }
          : null,
        inFight: true,
        equipment: sheet.equipment,
        feats: sheet.feats,
        campaignId: sheet.campaignId,
        shieldName,
      });
      const opened: Gate = rule ? { reason: rule.error, spent: false } : null;
      return gated(card, standing, costGate("bonus", turn, sheet, `an off-hand attack with ${name}`), opened);
    }
    return gated(card, standing, handsGate, attackGate(turn, allowed, sheet, { unarmed: srd === null }), ammoGate);
  };

  for (const weapon of carried) cards.push(build(weapon.name, weapon.srd, false, weapon.gear));
  // A lineage's bite or claws (src/lib/srd/racial-weapons.ts), proficient.
  for (const term of ["bite", "claws"]) {
    const natural = racialNaturalWeapon(sheet.features, [term]);
    if (natural && !carried.some((weapon) => textKey(weapon.name) === textKey(natural.srd.name))) {
      cards.push(build(natural.srd.name, natural.srd, false, null, true));
    }
  }
  cards.push(build("Unarmed strike", null, false));
  // The bonus-action strikes a feature grants (Martial Arts, Frenzy).
  cards.push(...bonusStrikeCards(sheet, turn, riders, carried.map((weapon) => ({ name: weapon.name, srd: weapon.srd }))));

  // Two-weapon fighting: two light melee weapons in hand buy a bonus swing,
  // and with Dual Wielder any two melee weapons held in one hand do.
  const dualWielder = dualWields(sheet.feats, sheet.campaignId);
  const paired = carried.filter(
    (weapon) =>
      weapon.srd.kind === "melee" &&
      (dualWielder ? !weapon.srd.properties?.includes("two-handed") : weapon.srd.properties?.includes("light")),
  );
  const pairedCount = paired.reduce((sum, weapon) => sum + weapon.qty, 0);
  if (pairedCount >= 2) {
    const second = paired.length > 1 ? paired[1] : paired[0];
    cards.push(build(second.name, second.srd, true, second.gear));
  }
  return cards;
}

// ---- riders ----

// What a maneuver riding the swing asks beyond its die, on its card
// (src/lib/dm/maneuver-rules.ts). The maneuvers that are not part of a swing
// are dealt elsewhere: Parry and Riposte as reactions (hand-react.ts), Rally
// and Commander's Strike as bonus actions (hand-options.ts).
const SWING_RULES: Partial<Record<ManeuverUse, string>> = {
  swing: "A superiority die rides this attack.",
  feint: "Feint at a creature within 5 feet first, for your bonus action: advantage on this attack, and the die on its hit.",
  bonus_swing: "A thrown weapon, as your bonus action, the die on its hit.",
  grapple: "On a melee hit, grapple the target as your bonus action; the die goes on the Athletics check.",
  ally_move: "On a hit, an ally may move half its speed with its reaction, drawing no opportunity attack from the target.",
};

function riderCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders): HandCard[] {
  const standing = standingGate(sheet, turn, "attack");
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
    const die = `1${maneuverDieFor(sheet)}`;
    const picks = sheet.features
      .map((feature) => /^maneuver:\s*(.+)$/i.exec(feature.name)?.[1]?.trim())
      .filter((name): name is string => Boolean(name));
    const left = pool.max - pool.used;
    for (const name of picks.length ? picks : ["Maneuver"]) {
      const use = maneuverUse(name);
      const rules = picks.length ? SWING_RULES[use] : "Name the maneuver when you play it.";
      if (!rules) continue;
      // Feinting Attack and Quick Toss take the bonus action with the swing;
      // Grappling Strike's grapple needs it after.
      const bonus = use === "feint" || use === "bonus_swing" || use === "grapple";
      cards.push(
        gated(
          {
            ...base,
            id: `rider:${textKey(name)}`,
            name,
            dice: use === "grapple" ? `+${die} Athletics` : `+${die}`,
            rules,
            resource: `Dice ${left}/${pool.max}`,
            icon: { kind: "feature", key: name, family: "class-fighter" },
            damage: use === "grapple" ? null : die,
            damageType: "",
            intent: { card: "rider", rider: name },
          },
          standing,
          left > 0 ? null : { reason: "No superiority dice left until a rest.", spent: true },
          bonus ? costGate("bonus", turn, sheet, name) : null,
        ),
      );
    }
  }
  return cards;
}

// ---- the basics ----

const BASICS: Array<{ id: BasicActionId; name: string; rules: string; target: HandTarget; compose?: boolean; asks?: "trigger" }> = [
  { id: "dodge", name: "Dodge", rules: "Attacks against you roll at disadvantage until your next turn.", target: "none" },
  { id: "dash", name: "Dash", rules: "Double your movement this turn.", target: "none" },
  { id: "disengage", name: "Disengage", rules: "Your movement provokes no opportunity attacks this turn.", target: "none" },
  { id: "help", name: "Help", rules: "An ally gets advantage on their next attack against the creature you name, or on a check.", target: "ally" },
  { id: "hide", name: "Hide", rules: "A Stealth check to slip out of sight.", target: "none" },
  { id: "search", name: "Search", rules: "Perception or Investigation to find what is hidden.", target: "none" },
  { id: "escape", name: "Escape", rules: "Athletics or Acrobatics against the grappler's Athletics.", target: "none" },
  { id: "stand-up", name: "Stand up", rules: "Getting up costs half your speed.", target: "none" },
  { id: "ready", name: "Ready", rules: "Name a trigger and what you will do when it happens; your reaction does it then.", target: "none", asks: "trigger" },
  { id: "grapple", name: "Grapple", rules: "Athletics against their Athletics or Acrobatics. Takes the place of one attack.", target: "enemy" },
  { id: "shove", name: "Shove", rules: "Knock them prone or push them 5 ft. Takes the place of one attack.", target: "enemy" },
  { id: "use-object", name: "Use an object", rules: "Drink, pull, light, throw: say what.", target: "none", compose: true },
  { id: "end-turn", name: "End turn", rules: "Done with your action, movement and bonus action.", target: "none" },
];

// The moves a feature lets a character make as the bonus action, by the
// engine's own reading of the sheet (bonus-routes.ts, which take_action asks).
const BONUS_MOVES: MoveAction[] = ["dash", "disengage", "hide", "dodge"];

function basicCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const allowed = 1 + riders.extraAttacks;
  const grappled = sheet.conditions.some((entry) => entry.trim().toLowerCase() === "grappled");
  const prone = sheet.conditions.some((entry) => entry.trim().toLowerCase() === "prone");
  // A spell's hold (Web, Maze, Irresistible Dance): take_action escape breaks
  // it when no grapple does (src/lib/dm/spell-escape.ts).
  const hold = grappled ? null : spellHoldOf(sheet);
  const cards: HandCard[] = [];
  const athletics = derived.skills.athletics ?? derived.abilityMods.str;
  const make = (basic: (typeof BASICS)[number], route: BonusRoute | null): HandCard => {
    const contest = basic.id === "grapple" || basic.id === "shove";
    const cost: HandCost = basic.id === "end-turn" || basic.id === "stand-up" ? "free" : route ? "bonus" : "action";
    const escape = basic.id === "escape";
    const ki = route?.ki ? kiLeft(sheet) : null;
    return {
      id: route ? `basic:${basic.id}:bonus` : `basic:${basic.id}`,
      type: "basic",
      name: route ? `${route.feature}: ${basic.name}` : basic.name,
      cost,
      range: contest || basic.id === "help" ? "5 ft" : "Self",
      dice: contest || escape
        ? `Athletics ${signed(athletics)}`
        : basic.id === "hide"
          ? `Stealth ${signed(derived.skills.stealth ?? derived.abilityMods.dex)}`
          : basic.id === "search"
            ? `Perception ${signed(derived.skills.perception ?? derived.abilityMods.wis)}`
            : "",
      roll: contest || escape ? "contested check" : basic.id === "hide" || basic.id === "search" ? "skill check" : "no roll",
      rules: route ? `${basic.rules} ${route.feature}: a bonus action${route.ki ? ` for ${route.ki} ki` : route.counter ? " and one use" : ""}.` : basic.rules,
      resource: route?.ki && sheet.resources.ki
        ? `Ki ${ki ?? 0}/${sheet.resources.ki.max}`
        : route?.counter
          ? `${route.feature} ${usesLeft(sheet, route.counter) ?? 0}/${sheet.resources[route.counter].max}`
          : "",
      condition: basic.id === "dodge" ? "Dodging" : basic.id === "grapple" ? "Grappled" : basic.id === "shove" ? "Prone" : basic.id === "ready" ? "Readied" : "",
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
      ...(basic.asks ? { asks: basic.asks } : {}),
      intent: { card: "basic", action: basic.id, ...(route ? { bonus: true } : {}) },
    };
  };
  for (const basic of BASICS) {
    // Escape is only there to take while something holds you.
    if (basic.id === "escape" && !grappled && !hold) continue;
    // Standing up is only there to take while lying prone.
    if (basic.id === "stand-up" && !prone) continue;
    const plain = make(basic, null);
    const card: HandCard =
      basic.id === "escape" && hold
        ? { ...plain, name: `Escape: ${hold.spell}`, rules: hold.rules, dice: hold.dice, roll: hold.roll, condition: "" }
        : plain;
    if (basic.id === "stand-up") {
      // Movement, not an action (SRD 5.1, Being Prone): no standing at speed
      // 0, whether a condition or exhaustion stops them.
      const still: Gate =
        exhaustionSpeed(sheet.exhaustion ?? 0, effectiveSpeed(sheet.conditions, sheet.speed)) === 0
          ? { reason: "Your speed is 0, so you cannot stand up.", spent: false }
          : null;
      cards.push(gated(card, standingGate(sheet, turn, "move"), still));
      continue;
    }
    if (basic.id === "end-turn") {
      // Ending the turn is always open to whoever holds it, down or not.
      cards.push(turn.myTurn ? card : gated(card, standingGate(sheet, turn, "free")));
      continue;
    }
    const contest = basic.id === "grapple" || basic.id === "shove";
    const still: Gate =
      basic.id === "dash" && effectiveSpeed(sheet.conditions, sheet.speed) === 0
        ? { reason: "Your speed is 0, so a Dash goes nowhere.", spent: false }
        : null;
    cards.push(
      gated(
        card,
        standingGate(sheet, turn, contest ? "attack" : "action"),
        contest ? attackGate(turn, allowed, sheet, { hasteOk: false }) : costGate("action", turn, sheet, basic.name),
        still,
      ),
    );
    // The same move as the bonus action, where a feature allows it: Cunning
    // Action before the action as well as after it, Step of the Wind and
    // Patient Defense for a point of ki.
    const route = (BONUS_MOVES as string[]).includes(basic.id) ? bonusRouteFor(sheet, basic.id as MoveAction) : null;
    if (route) {
      const kiGate: Gate =
        route.ki > 0 && (kiLeft(sheet) ?? 0) < route.ki
          ? { reason: `${sheet.name} has no ki point left for ${route.feature}. It comes back after a rest.`, spent: true }
          : null;
      const usesGate: Gate =
        route.counter && !usesLeft(sheet, route.counter)
          ? { reason: `${sheet.name} has no use of ${route.feature} left. It comes back after a rest.`, spent: true }
          : null;
      cards.push(
        gated(make(basic, route), standingGate(sheet, turn, "bonus"), costGate("bonus", turn, sheet, `${route.feature} (${basic.name})`), kiGate, usesGate, still),
      );
    }
  }
  return cards;
}

// ---- the hand ----

// Attacks, the riders that ride them, spells by level, class features, then
// the basics every character has, so a level 1 commoner still holds a hand.
export function deriveHand(sheet: CharacterSheet, turn: HandTurn = FRESH_TURN, options: HandOptions = {}): HandCard[] {
  const riders = combatRiders(sheet);
  const spells = spellCards(sheet, turn, riders, options);
  const features = featureCards(sheet, turn);
  const taken = new Set(features.map((card) => textKey(card.name)));
  return [
    ...attackCards(sheet, turn, riders, options),
    ...riderCards(sheet, turn, riders),
    ...spells,
    ...features,
    ...optionCards(sheet, turn),
    ...intimidatingPresenceCards(sheet, turn),
    ...subclassSpendCards(sheet, turn, taken),
    ...kiCards(sheet, turn),
    ...basicCards(sheet, turn, riders).map((card) => (card.id === "basic:ready" ? withReadySpells(card, spells) : card)),
    ...fastHandsCards(sheet, turn),
  ];
}

// Ready commits to one action (SRD 5.1; src/lib/dm/readied-kinds.ts): an
// attack unless the player picks another. The "@" picks are take_action's
// `readied` (hand-play.ts sends them as readyAction); a spell by its name is
// take_action's `spell`: the engine casts it now, slot and concentration,
// and releases it with the reaction when the trigger comes. The spells
// offered are the hand's own one-action spell cards the cast guard would
// take now.
const READY_PICKS: NonNullable<HandCard["choice"]>["options"] = [
  { value: "", label: "An attack" },
  { value: "@move", label: "A move" },
  { value: "@help", label: "Help" },
  { value: "@hide", label: "Hide" },
  { value: "@search", label: "Search" },
  { value: "@use_object", label: "Use an object" },
  { value: "@item", label: "Use an item" },
  { value: "@grapple", label: "Grapple" },
  { value: "@shove", label: "Shove" },
];

function withReadySpells(card: HandCard, spells: HandCard[]): HandCard {
  const ready = spells.filter(
    (spell) => spell.intent.card === "spell" && spell.cost === "action" && !spell.disabled,
  );
  const levels: Record<string, number> = {};
  const options: NonNullable<HandCard["choice"]>["options"] = [...READY_PICKS];
  for (const spell of ready) {
    if (spell.intent.card !== "spell") continue;
    options.push({ value: spell.name, label: spell.name, note: spell.resource });
    if (spell.intent.slotLevel) levels[spell.name] = spell.intent.slotLevel;
  }
  return { ...card, choice: { arg: "readySpell", label: "Ready", options, fallback: "", levels } };
}

// The spells the component has to look up before the hand is complete.
export function spellsToLookUp(sheet: CharacterSheet): string[] {
  return spellNames(sheet);
}

// Nine in the fan, the rest behind the "more" spine; a player's own
// arrangement of the fan is hand-layout.ts (issue 231).
export { splitHand } from "@/lib/battlemap/hand-layout";

// Swings the Attack action grants this character (1 + Extra Attack), which
// is what afterCommit needs to know when the action closes.
export function attacksAllowed(sheet: CharacterSheet): number {
  return 1 + combatRiders(sheet).extraAttacks;
}
