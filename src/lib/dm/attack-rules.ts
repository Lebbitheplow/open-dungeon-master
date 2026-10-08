// The rules of a player's attack that are about hands, turns and where
// people stand, as pure functions. pc_attack asks every one of them BEFORE
// it spends anything, so a refused attack costs no slot, no Superiority Die
// and no arrow. Database-free like attack-logic.ts;
// scripts/test-attack-rules.mjs walks the branches.

import type { TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { matchResource } from "@/lib/srd/class-resources";
import { matchWeapon } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type Carried = { name: string; qty?: number; equipped?: boolean };
type XY = { x: number; y: number };

const hasFeat = (feats: string[] | undefined, name: string) =>
  (feats ?? []).some((feat) => feat.trim().toLowerCase().startsWith(name));

const isLightMelee = (profile: Pick<AttackProfile, "properties" | "ranged">) =>
  !profile.ranged && (profile.properties ?? []).includes("light");

// ---- hands ----

// What a shield on the arm does to the swing. A two-handed weapon cannot be
// used at all; a versatile weapon is swung in one hand whatever was asked
// for; a lance needs both hands unless its wielder is mounted.
export function handsRuling(input: {
  who: string;
  weapon: string;
  properties: string[];
  lance: boolean;
  mounted: boolean;
  twoHandedAsked: boolean;
  shieldName: string | null;
}): { error: string } | { twoHanded: boolean; note: string | null } {
  const needsBoth =
    input.properties.includes("two-handed") || (input.lance && !input.mounted);
  if (needsBoth && input.shieldName) {
    return {
      error: `${input.weapon} needs both hands${
        input.lance ? " on foot" : ""
      }, and ${input.who} has ${input.shieldName} on one arm. They put the shield away first (unequip it on the sheet) or attack with a one-handed weapon.`,
    };
  }
  if (input.twoHandedAsked && input.properties.includes("versatile") && input.shieldName) {
    return {
      twoHanded: false,
      note: `${input.shieldName} on the arm: ${input.weapon} is swung in one hand`,
    };
  }
  return { twoHanded: input.twoHandedAsked, note: null };
}

// ---- two-weapon fighting ----

// Whether the pack holds a second light melee weapon for the other hand:
// two of the same, or two different ones.
function lightWeaponsCarried(equipment: Carried[]): number {
  let count = 0;
  for (const item of equipment) {
    const weapon = matchWeapon(item.name);
    if (weapon && weapon.kind === "melee" && (weapon.properties ?? []).includes("light")) {
      count += Math.max(1, item.qty ?? 1);
    }
  }
  return count;
}

// The bonus-action swing of two-weapon fighting (SRD 5.1): it follows an
// Attack action made with a light melee weapon, on the character's own
// turn, and is made with a different light melee weapon in the other hand.
// The Dual Wielder feat lifts the word "light" from both.
export function offHandProblem(input: {
  who: string;
  profile: Pick<AttackProfile, "weapon" | "properties" | "ranged">;
  budget: TurnBudget | null;
  inFight: boolean;
  equipment: Carried[];
  feats?: string[];
  shieldName: string | null;
}): string | null {
  const dualWielder = hasFeat(input.feats, "dual wielder");
  if (input.profile.ranged || (!isLightMelee(input.profile) && !dualWielder)) {
    return `The off-hand attack of two-weapon fighting is made with a light melee weapon, and ${input.profile.weapon} is not one. ${input.who} can make it with a dagger, shortsword, handaxe or another light weapon.`;
  }
  if (input.shieldName) {
    return `${input.who} has ${input.shieldName} in their other hand, so there is no second weapon to strike with. Two-weapon fighting needs a light weapon in each hand.`;
  }
  if (!dualWielder && lightWeaponsCarried(input.equipment) < 2) {
    return `Two-weapon fighting needs a light melee weapon in each hand, and ${input.who} carries only one.`;
  }
  if (!input.inFight) {
    return null;
  }
  if (!input.budget) {
    return `The off-hand attack is a bonus action on ${input.who}'s own turn; it is not their turn.`;
  }
  if (input.budget.attacksMade < 1 || input.budget.castThisAction) {
    return `The off-hand attack follows the Attack action: ${input.who} attacks with the weapon in their main hand first, then makes the off-hand attack as a bonus action.`;
  }
  if (!input.budget.lightMeleeAttack && !dualWielder) {
    return `The off-hand attack is earned by attacking with a light melee weapon, and ${input.who}'s Attack action this turn was made with something else.`;
  }
  return null;
}

// Whether the other hand holds a weapon, which is what the Dueling style
// refuses. Read from what the sheet marks as equipped: a second one-handed
// melee weapon in hand beside the one being swung (or a pair of the same).
// A pack that marks nothing as equipped says nothing about the other hand.
export function otherHandArmed(input: {
  equipment: Carried[];
  weapon: string;
  shieldName: string | null;
}): boolean {
  if (input.shieldName) {
    return false;
  }
  const wielded = input.weapon.trim().toLowerCase();
  return input.equipment.some((item) => {
    if (item.equipped !== true) {
      return false;
    }
    const weapon = matchWeapon(item.name);
    if (!weapon || weapon.kind !== "melee" || (weapon.properties ?? []).includes("two-handed")) {
      return false;
    }
    const same = item.name.trim().toLowerCase() === wielded;
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
}): string | null {
  if (!(input.profile.properties ?? []).includes("loading") || !input.budget) {
    return null;
  }
  if (hasFeat(input.feats, "crossbow expert") || hasFeat(input.feats, "gunner")) {
    return null;
  }
  const fired = (input.budget.loadingFired ?? []).includes(input.profile.weapon.toLowerCase());
  if (!fired) {
    return null;
  }
  return `${input.profile.weapon} has the loading property: it fires once per action, however many attacks ${input.who} has. They attack with another weapon or end their turn.`;
}

export function withLoadingFired(
  budget: TurnBudget,
  profile: Pick<AttackProfile, "weapon" | "properties">,
): TurnBudget {
  if (!(profile.properties ?? []).includes("loading")) {
    return budget;
  }
  const key = profile.weapon.toLowerCase();
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

const adjacent = (a: XY, b: XY) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1;

// The Flanking variant (DMG): an ally who can act stands on the opposite
// side of the target from the attacker, both within 5 feet of it. On a grid
// of one-square creatures "opposite" is the mirrored square.
export function isFlanking(attacker: XY, target: XY, allies: XY[]): boolean {
  if (!adjacent(attacker, target) || (attacker.x === target.x && attacker.y === target.y)) {
    return false;
  }
  const mirrored = { x: 2 * target.x - attacker.x, y: 2 * target.y - attacker.y };
  return allies.some((ally) => ally.x === mirrored.x && ally.y === mirrored.y);
}

// A ranged attack is made at disadvantage with a hostile creature within 5
// feet that can see the attacker and is not incapacitated.
export function hostileWithinFiveFeet(attacker: XY, hostiles: XY[]): boolean {
  return hostiles.some((hostile) => adjacent(attacker, hostile));
}
