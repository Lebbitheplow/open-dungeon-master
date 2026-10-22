// The rules of a player's attack that are about hands, turns and where
// people stand, as pure functions. pc_attack asks every one of them BEFORE
// it spends anything, so a refused attack costs no slot, no Superiority Die
// and no arrow. Database-free like attack-logic.ts;
// scripts/test-attack-rules.mjs walks the branches.

import { footprintDistance, footprintSide, type Footprint } from "@/lib/battlemap/footprint";
import { holdsFeat } from "@/lib/srd/feat-effects";

import type { TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { matchResource } from "@/lib/srd/class-resources";
import { matchWeapon } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

type Carried = { name: string; srdName?: string; qty?: number; equipped?: boolean };
type XY = { x: number; y: number };

// A content pack twin (Level Up's Dual-Wielding Expert) counts as the feat,
// and so does a table's workshop feat that runs as it.
const hasFeat = (feats: string[] | undefined, name: string, campaignId?: string) => holdsFeat({ feats, campaignId }, name);

const isLightMelee = (profile: Pick<AttackProfile, "properties" | "ranged">) =>
  !profile.ranged && (profile.properties ?? []).includes("light");

// Whether a sheet's feats include Dual Wielder (or a pack twin of it), for
// the Hand's off-hand card.
export function dualWields(feats: string[] | undefined, campaignId?: string): boolean {
  return hasFeat(feats, "dual wielder", campaignId);
}

// ---- hands ----

// What a shield on the arm does to the swing. A two-handed weapon cannot be
// used at all; a versatile weapon is swung in one hand whatever was asked
// for; a lance needs both hands unless its wielder is mounted. The off-hand
// swing of two-weapon fighting is made with a weapon in each hand (SRD 5.1),
// so a versatile weapon there is swung in one hand too.
export function handsRuling(input: {
  who: string;
  weapon: string;
  properties: string[];
  lance: boolean;
  mounted: boolean;
  twoHandedAsked: boolean;
  shieldName: string | null;
  offHand?: boolean;
}): ToolError | { twoHanded: boolean; note: string | null } {
  const needsBoth =
    input.properties.includes("two-handed") || (input.lance && !input.mounted);
  if (needsBoth && input.shieldName) {
    return {
      error: `${input.weapon} needs both hands${
        input.lance ? " on foot" : ""
      }, and ${input.who} has ${input.shieldName} on one arm. They put the shield away first (unequip it on the sheet) or attack with a one-handed weapon.`,
      refused: "rules",
    };
  }
  const versatileAsked = input.twoHandedAsked && input.properties.includes("versatile");
  if (versatileAsked && input.shieldName) {
    return {
      twoHanded: false,
      note: `${input.shieldName} on the arm: ${input.weapon} is swung in one hand`,
    };
  }
  if (versatileAsked && input.offHand) {
    return { twoHanded: false, note: `${input.weapon} is in the off hand: swung in one hand` };
  }
  return { twoHanded: input.twoHandedAsked, note: null };
}

// A thrown weapon is a ranged attack once it leaves the hand, and a melee
// one inside its reach (SRD 5.1, Thrown). `apart` is how many tiles lie
// between attacker and target, null when the board does not know.
export function thrownAtRange(
  profile: Pick<AttackProfile, "thrown" | "reachTiles">,
  apart: number | null,
): boolean {
  return profile.thrown && apart !== null && apart > profile.reachTiles;
}

// ---- two-weapon fighting ----

// Whether the pack holds a second weapon for the other hand: two of the
// same, or two different ones. Light melee weapons, or with Dual Wielder
// any melee weapon held in one hand.
function offHandWeaponsCarried(equipment: Carried[], dualWielder: boolean): number {
  let count = 0;
  for (const item of equipment) {
    const weapon = matchWeapon(item);
    const properties = weapon?.properties ?? [];
    if (weapon && weapon.kind === "melee" && (dualWielder ? !properties.includes("two-handed") : properties.includes("light"))) {
      count += Math.max(1, item.qty ?? 1);
    }
  }
  return count;
}

// The bonus-action swing of two-weapon fighting (SRD 5.1): it follows an
// Attack action made with a light melee weapon, on the character's own
// turn, and is made with a different light melee weapon in the other hand.
// The Dual Wielder feat lifts the word "light" from both, and only that:
// the weapons are still one-handed melee weapons, one in each hand. The
// Hand's off-hand card asks this same function (hand.ts, issue 210).
export function offHandProblem(input: {
  who: string;
  profile: Pick<AttackProfile, "weapon" | "properties" | "ranged">;
  budget: TurnBudget | null;
  inFight: boolean;
  equipment: Carried[];
  feats?: string[];
  campaignId?: string;
  shieldName: string | null;
}): ToolError | null {
  const dualWielder = hasFeat(input.feats, "dual wielder", input.campaignId);
  const twoHanded = (input.profile.properties ?? []).includes("two-handed");
  if (dualWielder && (input.profile.ranged || twoHanded)) {
    return { error: `The off-hand attack of two-weapon fighting is made with a melee weapon held in one hand, and ${input.profile.weapon} is not one. Dual Wielder lifts the need for a light weapon, not for a one-handed one.`, refused: "rules" };
  }
  if (input.profile.ranged || (!isLightMelee(input.profile) && !dualWielder)) {
    return { error: `The off-hand attack of two-weapon fighting is made with a light melee weapon, and ${input.profile.weapon} is not one. ${input.who} can make it with a dagger, shortsword, handaxe or another light weapon.`, refused: "rules" };
  }
  if (input.shieldName) {
    return { error: `${input.who} has ${input.shieldName} in their other hand, so there is no second weapon to strike with. Two-weapon fighting needs a ${dualWielder ? "weapon" : "light weapon"} in each hand.`, refused: "rules" };
  }
  if (offHandWeaponsCarried(input.equipment, dualWielder) < 2) {
    return { error: dualWielder
      ? `Two-weapon fighting needs a one-handed melee weapon in each hand, and ${input.who} carries only one.`
      : `Two-weapon fighting needs a light melee weapon in each hand, and ${input.who} carries only one.`, refused: "rules" };
  }
  if (!input.inFight) {
    return null;
  }
  if (!input.budget) {
    return { error: `The off-hand attack is a bonus action on ${input.who}'s own turn; it is not their turn. What they declared waits for their turn.`, refused: "rules" };
  }
  if (input.budget.attacksMade < 1 || input.budget.castThisAction) {
    return { error: `The off-hand attack follows the Attack action: ${input.who} attacks with the weapon in their main hand first, then makes the off-hand attack as a bonus action.`, retry: true };
  }
  // A budget saved before the one-handed flag existed reads the light one.
  const earned = dualWielder
    ? (input.budget.oneHandMeleeAttack ?? input.budget.lightMeleeAttack)
    : input.budget.lightMeleeAttack;
  if (!earned) {
    return { error: dualWielder
      ? `The off-hand attack is earned by attacking with a melee weapon held in one hand, and ${input.who}'s Attack action this turn was made with something else.`
      : `The off-hand attack is earned by attacking with a light melee weapon, and ${input.who}'s Attack action this turn was made with something else.`, refused: "rules" };
  }
  return null;
}

// Whether the other hand holds a weapon, which is what the Dueling style
// refuses. Read from what the sheet marks as equipped: a second one-handed
// melee weapon in hand beside the one being swung (or a pair of the same).
// A pack that marks nothing as equipped says nothing about the other hand.
// `weapon` is the swung line's own name as resolveAttackWeapon gives it
// (displayName), so the line is the one stored under that very string.
export function otherHandArmed(input: {
  equipment: Carried[];
  weapon: string;
  shieldName: string | null;
}): boolean {
  if (input.shieldName) {
    return false;
  }
  return input.equipment.some((item) => {
    if (item.equipped !== true) {
      return false;
    }
    const weapon = matchWeapon(item);
    if (!weapon || weapon.kind !== "melee" || (weapon.properties ?? []).includes("two-handed")) {
      return false;
    }
    const same = item.name === input.weapon;
    return !same || (item.qty ?? 1) > 1;
  });
}

// ---- loading ----

// A loading weapon fires once per action, bonus action or reaction, however
// many attacks the character has (SRD 5.1). Crossbow Expert ignores it.
export function loadingProblem(input: {
  who: string;
  profile: Pick<AttackProfile, "weapon" | "properties">;
  budget: TurnBudget | null;
  feats?: string[];
  campaignId?: string;
}): ToolError | null {
  if (!(input.profile.properties ?? []).includes("loading") || !input.budget) {
    return null;
  }
  if (hasFeat(input.feats, "crossbow expert", input.campaignId) || hasFeat(input.feats, "gunner", input.campaignId)) {
    return null;
  }
  const fired = (input.budget.loadingFired ?? []).includes(textKey(input.profile.weapon));
  if (!fired) {
    return null;
  }
  return { error: `${input.profile.weapon} has the loading property: it fires once per action, however many attacks ${input.who} has. They attack with another weapon or end their turn.`, refused: "rules" };
}

export function withLoadingFired(
  budget: TurnBudget,
  profile: Pick<AttackProfile, "weapon" | "properties">,
): TurnBudget {
  if (!(profile.properties ?? []).includes("loading")) {
    return budget;
  }
  const key = textKey(profile.weapon);
  const fired = budget.loadingFired ?? [];
  return fired.includes(key) ? budget : { ...budget, loadingFired: [...fired, key] };
}

// ---- what a rider would cost, looked at without spending it ----

// Uses left of a tracked resource, or null when the sheet has none.
export function resourceLeft(
  sheet: Pick<CharacterSheet, "resources">,
  name: string,
): { left: number; max: number } | null {
  const def = matchResource(name);
  const state = def ? sheet.resources?.[def.id] : undefined;
  return state ? { left: Math.max(0, state.max - state.used), max: state.max } : null;
}

// Whether a spell slot of exactly this level is free, in the shared pool or
// as a Pact Magic slot.
export function slotFree(sheet: Pick<CharacterSheet, "spellcasting">, level: number): boolean {
  const casting = sheet.spellcasting;
  if (!casting) {
    return false;
  }
  const slot = casting.slots?.[String(level)];
  if (slot && slot.used < slot.max) {
    return true;
  }
  return Boolean(casting.pact && casting.pact.level === level && casting.pact.used < casting.pact.max);
}

// ---- Divine Smite ----

// 2d8 for a 1st level slot, 1d8 more per slot level above it, to a maximum
// of 5d8; 1d8 more against an undead or a fiend, which is outside the cap
// (SRD 5.1, Divine Smite).
export function smiteDice(slotLevel: number, undeadOrFiend: boolean): number {
  return Math.min(5, 1 + Math.max(1, slotLevel)) + (undeadOrFiend ? 1 : 0);
}

const UNDEAD_FIEND_NAMES =
  /\b(undead|fiend|demon|devil|zombie|skeleton|ghoul|ghast|wraith|wight|lich|vampire|specter|spectre|mummy)\b/i;

// The stat block's creature type decides it. A block saved before blocks
// carried a type falls back to the name, matched on whole words so an
// "imp" is not found inside "simple" nor a "shadow" in a Shadowfell elf.
export function isUndeadOrFiend(enemy: {
  displayName: string;
  slug: string;
  stats: { type?: string };
}): boolean {
  const type = String(enemy.stats.type ?? "").trim().toLowerCase();
  if (type) {
    return /^(undead|fiend)\b/.test(type);
  }
  return UNDEAD_FIEND_NAMES.test(`${enemy.displayName} ${enemy.slug.replace(/[-_]/g, " ")}`);
}

// ---- positions ----

// A square with the size of what stands on it: a Large creature's space is
// two by two from its anchor, and "within 5 feet" is measured to its nearest
// square (src/lib/battlemap/footprint.ts). Absent, one square.
export type Spot = XY & { footprint?: Footprint };

const adjacent = (a: Spot, b: Spot) => footprintDistance(a, a.footprint ?? 1, b, b.footprint ?? 1) <= 1;

// The Flanking variant (DMG): an ally who can act stands on the opposite
// side of the target from the attacker, both within 5 feet of it. For a
// one-square target that is the mirrored square; for a larger one, the
// opposite edge or the opposite corner of its space.
export function isFlanking(attacker: Spot, target: Spot, allies: Spot[]): boolean {
  if (!adjacent(attacker, target)) {
    return false;
  }
  const footprint = target.footprint ?? 1;
  const mine = footprintSide(attacker, attacker.footprint ?? 1, target, footprint);
  if (mine.x === 0 && mine.y === 0) {
    return false;
  }
  return allies.some((ally) => {
    if (!adjacent(ally, target)) {
      return false;
    }
    const theirs = footprintSide(ally, ally.footprint ?? 1, target, footprint);
    return theirs.x === -mine.x && theirs.y === -mine.y;
  });
}

// A ranged attack is made at disadvantage with a hostile creature within 5
// feet that can see the attacker and is not incapacitated.
export function hostileWithinFiveFeet(attacker: Spot, hostiles: Spot[]): boolean {
  return hostiles.some((hostile) => adjacent(attacker, hostile));
}

