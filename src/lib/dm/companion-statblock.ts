import type { EnemyAttack, EnemyStats } from "@/lib/bestiary/statblock";
import { deriveCr } from "@/lib/bestiary/derive-cr";
import { spellDamageFor } from "@/lib/content";
import { resolveAttackWeapon, weaponAttackProfile } from "@/lib/dm/attack-logic";
import { stepCr, supportHandicap, type Vitals } from "@/lib/dm/departure-logic";
import { PACT, type SlotPool, type Wear } from "@/lib/dm/return-wear-logic";
import { computeSheetDerived } from "@/lib/srd";
import { xpForCr } from "@/lib/srd/encounter-math";
import { combatRiders } from "@/lib/srd/feature-effects";
import { averageOf } from "@/lib/srd/odds";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A character sheet rated as a foe (issue 503 Phases 2 and 3): the
// sheet-to-EnemyStats adapter the plan names, read by the DMG's procedure
// (src/lib/bestiary/derive-cr.ts) like any homebrew boss, plus a round of its
// best damaging spell (what derive-cr's uncountedDamage says a caster's
// rating misses) and the issue's support handicap for healers and an aura.
// Two readers, both for a rating and never to fight as:
//   - the odds (src/lib/dm/departure-opening.ts): how hard a fight against
//     this companion would be for the party;
//   - the return (src/lib/dm/companion-return.ts): what a departed
//     companion's fight is budgeted on. It fights as its own sheet on the
//     foes' side (Phase 6); the wear below is the one that sheet arrives with.
//
// No writes. Reads the content pack only through spellDamageFor, which falls
// back to the baked SRD answers when there is none.

export type SheetForStats = Pick<
  CharacterSheet,
  "name" | "level" | "class" | "abilities" | "proficiencies" | "equipment" | "features" | "spellcasting" | "maxHp" | "ac"
> & {
  subclass?: string;
  classes?: CharacterSheet["classes"];
  speed?: number;
  alignment?: string;
  currentHp?: number;
  feats?: string[];
};

// Each class's level, for the support handicap: the class list when there
// is one, else the single class at the sheet's level.
function classLevels(sheet: SheetForStats): Record<string, number> {
  const entries = sheet.classes?.length ? sheet.classes : [{ id: sheet.class, level: sheet.level }];
  return Object.fromEntries(entries.map((entry) => [entry.id.toLowerCase(), entry.level]));
}

function slotLevels(sheet: SheetForStats, open: boolean): number[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  const levels = Object.entries(casting.slots)
    .filter(([, slot]) => (open ? slot.max - slot.used : slot.max) > 0)
    .map(([level]) => Number(level));
  if (casting.pact && (open ? casting.pact.max - casting.pact.used : casting.pact.max) > 0) {
    levels.push(casting.pact.level);
  }
  return levels.sort((a, b) => a - b);
}

function spellNames(sheet: SheetForStats): string[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  return [...new Set([...(casting.cantrips ?? []), ...casting.prepared, ...(casting.known ?? [])])];
}

// The average damage of the best damaging spell it could cast this round:
// a cantrip at its level, a levelled spell at the highest slot it has open
// (`open`: the slots left now; otherwise every slot, as after a rest). A
// paladin's Divine Smite counts as one such round where it has a slot.
export function bestSpellRound(sheet: SheetForStats, open: boolean): number {
  const slots = slotLevels(sheet, open);
  const top = slots.length ? slots[slots.length - 1] : 0;
  let best = 0;
  for (const spell of spellNames(sheet)) {
    const level = spellLevelOf(spell);
    if (level === null || (level > 0 && level > top)) {
      continue;
    }
    const rolled = spellDamageFor({ spell, casterLevel: sheet.level, ...(level > 0 ? { slotLevel: top } : {}) });
    if (rolled) {
      best = Math.max(best, averageOf(rolled.dice));
    }
  }
  if ((classLevels(sheet).paladin ?? 0) >= 2 && top > 0) {
    best = Math.max(best, 4.5 * Math.min(5, 1 + top));
  }
  return Math.round(best);
}

function bestAttack(sheet: SheetForStats): { attack: EnemyAttack; sneak: number } {
  const derived = computeSheetDerived(sheet);
  const riders = combatRiders({ class: sheet.class, level: sheet.level, features: sheet.features, classes: sheet.classes });
  const resolved = resolveAttackWeapon(sheet.equipment, sheet.proficiencies.weapons, undefined);
  const profile = weaponAttackProfile(derived, sheet.proficiencies.weapons, resolved, { riders });
  return {
    attack: {
      name: profile.weapon,
      toHit: profile.toHit,
      damage: profile.damageExpression,
      type: profile.damageType,
      mode: profile.ranged ? "ranged" : profile.thrown ? "both" : "melee",
      reach: profile.reachTiles * 5,
      ...(profile.ranged || profile.thrown ? { range: { normal: profile.rangeTiles * 5, long: profile.rangeTiles * 20 } } : {}),
    },
    sneak: riders.sneakAttackDice ? Math.round(riders.sneakAttackDice * 3.5) : 0,
  };
}

export type SheetRating = { cr: number; xp: number; spellRound: number; handicap: number };

// The slots a sheet has open, for a wear to spend (return-wear-logic.ts):
// each shared slot level, and a warlock's pact slots under their own key.
export function slotPools(sheet: Pick<SheetForStats, "spellcasting">): SlotPool[] {
  const casting = sheet.spellcasting;
  if (!casting) {
    return [];
  }
  const pools: SlotPool[] = Object.entries(casting.slots)
    .map(([key, slot]) => ({ key, level: Number(key), count: Math.max(0, slot.max - slot.used) }))
    .filter((pool) => pool.count > 0);
  if (casting.pact && casting.pact.max - casting.pact.used > 0) {
    pools.push({ key: PACT, level: casting.pact.level, count: casting.pact.max - casting.pact.used });
  }
  return pools;
}

// A sheet worn as a wear says (issue 503 Phase 3): its current hit points
// lowered, its slots marked spent. The rating reads it, and the returning
// companion's own sheet arrives with it.
export function applyWear<T extends SheetForStats>(sheet: T, wear: Wear): T {
  const casting = sheet.spellcasting;
  const slots = casting
    ? Object.fromEntries(
        Object.entries(casting.slots).map(([key, slot]) => [key, { ...slot, used: Math.min(slot.max, slot.used + (wear.slotsSpent[key] ?? 0)) }]),
      )
    : null;
  return {
    ...sheet,
    currentHp: Math.max(1, (sheet.currentHp ?? sheet.maxHp) - wear.hpLost),
    ...(casting && slots
      ? {
          spellcasting: {
            ...casting,
            slots,
            ...(casting.pact ? { pact: { ...casting.pact, used: Math.min(casting.pact.max, casting.pact.used + (wear.slotsSpent[PACT] ?? 0)) } } : {}),
          },
        }
      : {}),
  };
}

// The sheet as a stat block, rated: `open` reads the spell slots it has
// left (the odds, now) rather than all of them (a foe who has rested), and
// `asItStands` also rates it at the hit points and slots it has left (a worn
// return).
export function sheetStatBlock(
  sheet: SheetForStats,
  options: { open?: boolean; asItStands?: boolean } = {},
): { stats: EnemyStats; rating: SheetRating } {
  const derived = computeSheetDerived(sheet);
  const { attack, sneak } = bestAttack(sheet);
  const standing = options.asItStands === true;
  const stats: EnemyStats = {
    ac: sheet.ac,
    maxHp: sheet.maxHp,
    dexMod: derived.abilityMods.dex,
    saveMods: derived.saves,
    speed: `${sheet.speed ?? 30} ft.`,
    attacks: [attack],
    attacksPerTurn: 1 + combatRiders({ class: sheet.class, level: sheet.level, features: sheet.features, classes: sheet.classes }).extraAttacks,
    traits: sheet.features.slice(0, 6).map((feature) => `${feature.name}.`),
    resist: "",
    immune: "",
    vulnerable: "",
    conditionImmune: "",
    cr: 0,
    xp: 0,
    abilities: { ...sheet.abilities },
    skills: derived.skills,
    type: "humanoid",
    size: "Medium",
    ...(sheet.alignment ? { alignment: sheet.alignment } : {}),
  };
  const spellRound = bestSpellRound(sheet, options.open === true || standing);
  const rated = standing ? { ...stats, maxHp: Math.max(1, sheet.currentHp ?? sheet.maxHp) } : stats;
  const derivedCr = deriveCr(rated, { extraDamagePerRound: spellRound + sneak });
  const handicap = supportHandicap(classLevels(sheet));
  const cr = stepCr(derivedCr.cr, handicap);
  return { stats: { ...stats, cr, xp: xpForCr(cr) }, rating: { cr, xp: xpForCr(cr), spellRound, handicap } };
}

// How whole a sheet is, for the odds: hit points and slots left.
export function sheetVitals(sheet: Pick<CharacterSheet, "currentHp" | "maxHp" | "spellcasting" | "deathSaves">): Vitals {
  const casting = sheet.spellcasting;
  let slotsLeft = 0;
  let slotsMax = 0;
  for (const slot of Object.values(casting?.slots ?? {})) {
    slotsLeft += Math.max(0, slot.max - slot.used);
    slotsMax += slot.max;
  }
  if (casting?.pact) {
    slotsLeft += Math.max(0, casting.pact.max - casting.pact.used);
    slotsMax += casting.pact.max;
  }
  return { hp: sheet.deathSaves?.dead ? 0 : Math.max(0, sheet.currentHp), maxHp: sheet.maxHp, slotsLeft, slotsMax };
}
