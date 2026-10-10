import { isValidExpression } from "@/lib/dice";
import type { VariantRules } from "@/lib/rulesets/logic";
import { deriveCr, crLabel, crRowIndex } from "@/lib/bestiary/derive-cr";
import type { MonsterDraft } from "@/lib/bestiary/monster-draft";
import { baseDamageDice } from "@/lib/srd/spell-scaling";
import { SRD_ARMOR, type SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import type { ArmorRiders, ChargeRule, WeaponRiders } from "@/lib/srd/magic-gear";
import type { ItemSpell } from "@/lib/srd/item-spells";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";
import { CONDITIONS } from "@/lib/bestiary/kit";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { TERRAIN, blocksMove, inBounds, tileIndex, type MapLight } from "@/lib/battlemap/types";

// "Is this legal at this table?"
//
// docs/workshop-plan.md section 2 promised one place every tool could ask
// that of the selected ruleset, and deferred it twice. This is it. It takes
// the ruleset's variant flags and a draft (an item, a spell, a monster, a
// map) and returns findings: what is refused, what is stronger than the
// books, what the table's own rules make relevant.
//
// A finding is a sentence a DM can disagree with. Nothing here rewrites a
// draft. "error" is something the engine cannot run; "warn" is a number
// outside what the published material would print; "note" is a reminder the
// selected rules make worth saying.
//
// Pure by design: no DB and no I/O, so scripts/test-ruleset-validate.mjs
// drives it directly.

export type FindingLevel = "error" | "warn" | "note";
// `page`: the rulebook page the rule it measures against is printed on, for
// the editor to open beside the draft.
export type Finding = { level: FindingLevel; text: string; page?: string };

export type RulesetContext = { variantRules: Partial<VariantRules> };

export type ItemDraft = {
  name: string;
  itemKind: "weapon" | "armor" | "gear" | "magic_item";
  weapon?: SrdWeapon;
  armor?: SrdArmor;
  effects?: MagicItemEffect[];
  requiresAttunement?: boolean;
  rarity?: string;
  weight?: number;
  // The rest of a magic item's magic (src/lib/homebrew/item-data.ts), each
  // measured against what the SRD prints.
  weaponRiders?: WeaponRiders;
  armorRiders?: ArmorRiders;
  charges?: ChargeRule;
  checks?: { bonus?: number; skillBonus?: Record<string, number>; advantage?: string[] };
  spells?: ItemSpell[];
  cursed?: boolean;
};

export type SpellDraft = {
  name: string;
  level: number;
  desc: string;
  duration?: string;
  concentration?: boolean;
  higherLevel?: string;
  mech?: SpellMech | null;
};

export type MapDraft = {
  terrain: string;
  width: number;
  height: number;
  ambient: "bright" | "dim" | "dark";
  lights: MapLight[];
};

export type Draft =
  | { kind: "item"; item: ItemDraft }
  | { kind: "spell"; spell: SpellDraft }
  | { kind: "monster"; monster: MonsterDraft }
  | { kind: "map"; map: MapDraft };

// Average of a dice expression's dice part, for comparing a draft against
// the tables. "2d6+3" averages 10; "1d8" averages 4.5.
export function averageOf(expression: string): number | null {
  const cleaned = expression.replace(/\s+/g, "").toLowerCase();
  if (!cleaned || !isValidExpression(cleaned)) {
    return null;
  }
  let total = 0;
  const terms = cleaned.match(/[+-]?[^+-]+/g) ?? [];
  for (const term of terms) {
    const sign = term.startsWith("-") ? -1 : 1;
    const body = term.replace(/^[+-]/, "");
    const dice = /^(\d*)d(\d+)$/.exec(body);
    if (dice) {
      const count = dice[1] ? Number(dice[1]) : 1;
      total += sign * count * ((Number(dice[2]) + 1) / 2);
    } else if (/^\d+$/.test(body)) {
      total += sign * Number(body);
    } else {
      return null;
    }
  }
  return total;
}

// The strongest damage die an SRD weapon carries, averaged: a greatsword's
// 2d6 and a greataxe's 1d12 both average within a point of 7.
const SRD_WEAPON_TOP_AVERAGE = 7;

// The DMG's spell damage guideline by level, averaged, for a single target
// and for a spell that hits several. Cantrips scale with caster level, so
// the cantrip row is the level 1 to 4 die.
const SPELL_DAMAGE_SINGLE = [5.5, 11, 16.5, 27.5, 33, 44, 55, 60.5, 66, 82.5];
const SPELL_DAMAGE_MULTI = [3.5, 7, 14, 21, 24.5, 28, 38.5, 42, 45.5, 49];

function itemFindings(item: ItemDraft, rules: Partial<VariantRules>): Finding[] {
  const findings: Finding[] = [];
  if (item.weapon) {
    const [dice] = item.weapon.damage.split(/\s+/);
    if (!isValidExpression(dice)) {
      findings.push({ page: "weapons", level: "error", text: `"${dice}" is not damage the table can roll.` });
    } else {
      const average = averageOf(dice) ?? 0;
      if (average > SRD_WEAPON_TOP_AVERAGE + 0.5 && item.itemKind !== "magic_item") {
        findings.push({
          page: "weapons",
          level: "warn",
          text: `${item.weapon.damage} averages ${average.toFixed(1)}; no SRD weapon averages above ${SRD_WEAPON_TOP_AVERAGE}. A mundane weapon this strong changes what every fighter carries.`,
        });
      }
    }
    const properties = item.weapon.properties ?? [];
    if (properties.includes("heavy") && properties.includes("light")) {
      findings.push({ page: "weapons", level: "error", text: "A weapon cannot be both heavy and light." });
    }
    if (item.weapon.kind === "ranged" && !item.weapon.rangeFt) {
      findings.push({ page: "weapons", level: "warn", text: "A ranged weapon with no range fires at everything on the map." });
    }
    if (
      rules.ammunition &&
      item.weapon.kind === "ranged" &&
      !properties.includes("ammunition") &&
      !properties.includes("thrown")
    ) {
      findings.push({
        page: "weapons",
        level: "note",
        text: "This table counts ammunition. A ranged weapon without the ammunition or thrown property never runs out.",
      });
    }
  }
  if (item.armor) {
    const armor = item.armor;
    const riders = item.armorRiders ?? {};
    // The SRD's own heavy armours: ring mail (AC 14) asks no Strength,
    // chain mail asks 13, splint and plate 15. A suit as strong as chain
    // mail with no requirement is one anybody wears at full speed.
    const strongestFree = Math.max(...SRD_ARMOR.filter((row) => row.category === "heavy" && !row.strengthRequirement).map((row) => row.baseAc), 0);
    if (armor.category === "heavy" && !armor.strengthRequirement && !riders.noStrength && armor.baseAc > strongestFree) {
      findings.push({
        page: "armor",
        level: "note",
        text: `SRD heavy armour above ring mail (AC ${strongestFree}) has a Strength requirement of 13 to 15; at AC ${armor.baseAc} with none, anybody wears it at full speed.`,
      });
    }
    if (armor.category === "heavy" && !armor.stealthDisadvantage && !riders.noStealthPenalty) {
      findings.push({ page: "armor", level: "note", text: "SRD heavy armour imposes disadvantage on Stealth; this one does not." });
    }
    if (armor.category !== "shield" && armor.baseAc >= 19) {
      findings.push({
        page: "armor",
        level: "warn",
        text: `Base AC ${armor.baseAc} is above plate (18) before any magic. Consider making the extra a magic bonus that requires attunement.`,
      });
    }
    if (armor.category === "shield" && armor.baseAc > 2) {
      // A magic shield keeps its +2 and adds its bonus on top (+1 to +3),
      // which this editor holds as the armour bonus below.
      findings.push({
        page: "armor",
        level: "warn",
        text: `A shield's own bonus is +2 in the SRD; a magic shield adds its +1 to +3 on top as a bonus. Put the extra in the magic bonus rather than the base (+${armor.baseAc} here).`,
      });
    }
    const shieldTotal = armor.category === "shield" ? armor.baseAc + (riders.bonus ?? 0) : 0;
    if (shieldTotal > 5) {
      findings.push({ page: "armor", level: "warn", text: `+${shieldTotal} AC from one shield: the SRD's best, a +3 shield, gives +5.` });
    }
    if (rules.encumbrance && !armor.weightLb && !item.weight) {
      findings.push({ page: "armor", level: "note", text: "This table weighs packs, and this armour weighs nothing." });
    }
  }
  findings.push(...magicFindings(item));
  const effects = item.effects ?? [];
  for (const effect of effects) {
    if ((effect.kind === "ac_bonus" || effect.kind === "save_bonus" || effect.kind === "ac_unarmored") && Math.abs(effect.amount) > 3) {
      findings.push({
        page: "magic-items",
        level: "warn",
        text: `A ${effect.kind === "save_bonus" ? "save" : "AC"} bonus of ${effect.amount} is beyond any +3 item in the books.`,
      });
    }
    if (effect.kind === "set_ability" && effect.score > 27) {
      findings.push({ page: "magic-items", level: "warn", text: `Setting ${effect.ability.toUpperCase()} to ${effect.score} is above the strongest SRD belt (27).` });
    }
  }
  if (effects.length >= 2 && !item.requiresAttunement) {
    findings.push({
      page: "magic-items",
      level: "note",
      text: "Two or more standing effects without attunement: in the SRD an item this useful takes one of the three slots.",
    });
  }
  if (rules.encumbrance && item.itemKind !== "magic_item" && item.weight === undefined && !item.armor) {
    findings.push({ page: "using-ability-scores", level: "note", text: "This table weighs packs, and this item has no weight." });
  }
  return findings;
}

// The 13 damage types the damage engine reads (resistance, immunity,
// vulnerability, the riders). Anything else is dealt as untyped.
const DAMAGE_TYPES = new Set([
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
]);

const SRD_CONDITIONS = new Set(CONDITIONS.map((name) => name.toLowerCase()));

const RARITY_SPELL_LEVEL: Record<string, number> = { common: 1, uncommon: 3, rare: 5, "very rare": 8, legendary: 9, artifact: 9 };

// Riders, charges, checks, the spells an item casts and its curse: what the
// SRD's own magic items print at most, and what the engine does with each.
function magicFindings(item: ItemDraft): Finding[] {
  const findings: Finding[] = [];
  const weapon = item.weaponRiders ?? {};
  if ((weapon.bonus ?? 0) > 3) {
    findings.push({ page: "magic-items", level: "warn", text: `+${weapon.bonus} to hit and damage: the SRD's weapons stop at +3.` });
  }
  if (weapon.bonusVs && weapon.bonusVs.bonus > 3) {
    findings.push({ page: "magic-items", level: "warn", text: `+${weapon.bonusVs.bonus} against ${weapon.bonusVs.types.join(", ")}: the SRD's slaying weapons stop at +3.` });
  }
  for (const extra of [...(weapon.extra ?? []), ...(weapon.critExtra ?? [])]) {
    const average = averageOf(extra.dice);
    if (average === null) {
      findings.push({ page: "magic-items", level: "error", text: `"${extra.dice}" on a hit is not damage the table can roll.` });
    } else if (average > 11.5) {
      findings.push({ page: "magic-items", level: "warn", text: `${extra.dice} more on a hit averages ${average.toFixed(1)}: the SRD's strongest rider is a holy avenger's 2d10 against fiends and undead.` });
    }
    if (extra.type !== "weapon" && !DAMAGE_TYPES.has(extra.type)) {
      findings.push({ page: "magic-items", level: "warn", text: `"${extra.type}" is not one of the 13 damage types; the engine deals it untyped, so no resistance or immunity meets it.` });
    }
  }
  if (weapon.damageType && !DAMAGE_TYPES.has(weapon.damageType)) {
    findings.push({ page: "magic-items", level: "warn", text: `"${weapon.damageType}" is not one of the 13 damage types; the engine deals it untyped.` });
  }
  if ((item.armorRiders?.bonus ?? 0) > 3) {
    findings.push({ page: "magic-items", level: "warn", text: `+${item.armorRiders?.bonus} AC from magic: the SRD's armour and shields stop at +3.` });
  }
  for (const effect of item.effects ?? []) {
    if (effect.kind === "resistance") {
      const unknown = effect.types.filter((type) => !DAMAGE_TYPES.has(type));
      if (unknown.length) {
        findings.push({ page: "magic-items", level: "warn", text: `Resistance to ${unknown.join(", ")}: not a damage type the engine deals, so it never applies.` });
      }
    }
  }
  const charges = item.charges;
  if (charges) {
    const most = typeof charges.max === "number" ? charges.max : averageOf(charges.max) ?? 0;
    if (most > 50) {
      findings.push({ page: "magic-items", level: "warn", text: `${charges.max} charges: the SRD's largest pool, a staff of the magi, holds 50.` });
    }
    if (!charges.regain && !charges.spentAway && !charges.daily) {
      findings.push({ page: "magic-items", level: "note", text: "Its charges never come back: no regain at dawn and nothing said of the last one." });
    }
    if (charges.regain && charges.regain !== "all" && averageOf(charges.regain) === null) {
      findings.push({ page: "magic-items", level: "error", text: `"${charges.regain}" regained at dawn is not dice the table can roll.` });
    }
  }
  const checks = item.checks;
  if (checks?.bonus && checks.bonus > 1) {
    findings.push({ page: "magic-items", level: "warn", text: `+${checks.bonus} to every check: the SRD's luckstone gives +1.` });
  }
  for (const [skill, bonus] of Object.entries(checks?.skillBonus ?? {})) {
    if (bonus > 5) {
      findings.push({ page: "magic-items", level: "warn", text: `+${bonus} to ${skill}: the SRD's items that add to one skill give +5 at most (eyes of the eagle, the cloak's advantage aside).` });
    }
  }
  const ceiling = RARITY_SPELL_LEVEL[String(item.rarity ?? "").trim().toLowerCase()] ?? 9;
  for (const entry of item.spells ?? []) {
    if (!bundledSpellFacts(entry.spell)) {
      findings.push({ page: "magic-items", level: "note", text: `${entry.spell} is not a spell the bundled books know; the cast tools resolve it only if the content pack or the table's workshop has it.` });
    }
    if (entry.level > ceiling) {
      findings.push({ page: "magic-items", level: "warn", text: `Casts ${entry.spell} at level ${entry.level}: a ${item.rarity} item in the SRD casts spells of level ${ceiling} or lower.` });
    }
  }
  if (item.cursed) {
    findings.push({
      page: "magic-items",
      level: "note",
      text: "Cursed: the engine holds the attunement until remove curse ends it (magic-gear.ts). What the curse does beyond that is in the description, for the DM to run.",
    });
  }
  return findings;
}

// What the engine runs for an item, in one line, so a green checker is not
// read as "everything in the description works": the rest is the DM's.
export function itemEngineSummary(item: ItemDraft): string | null {
  const runs: string[] = [];
  if (item.weapon) runs.push(`a ${item.weapon.damage} weapon`);
  if (item.armor) runs.push(item.armor.category === "shield" ? `a +${item.armor.baseAc} shield` : `AC ${item.armor.baseAc} armour`);
  if (item.weaponRiders?.bonus) runs.push(`+${item.weaponRiders.bonus} to hit and damage`);
  for (const extra of item.weaponRiders?.extra ?? []) runs.push(`${extra.dice} ${extra.type} on a hit`);
  if (item.armorRiders?.bonus) runs.push(`+${item.armorRiders.bonus} AC`);
  if (item.effects?.length) runs.push(`${item.effects.length} standing effect${item.effects.length === 1 ? "" : "s"}`);
  if (item.charges) runs.push(`${item.charges.max} charges`);
  if (item.spells?.length) runs.push(`casts ${item.spells.map((entry) => entry.spell).join(", ")}`);
  if (item.checks) runs.push("its check bonuses");
  if (item.requiresAttunement) runs.push("attunement");
  return runs.length ? `The engine runs ${runs.join(", ")}. Anything else the description says is the DM's to run.` : null;
}

function spellFindings(spell: SpellDraft, rules: Partial<VariantRules>): Finding[] {
  const findings: Finding[] = [];
  const level = Math.max(0, Math.min(9, Math.round(spell.level)));
  const mech = spell.mech ?? null;
  if (mech?.resolution === "save" && !mech.save) {
    findings.push({ page: "spellcasting", level: "error", text: "A spell that calls for a save has to say which ability saves." });
  }
  const dice = baseDamageDice(spell.desc);
  if (dice) {
    const average = averageOf(dice);
    if (average === null) {
      findings.push({ page: "spellcasting", level: "error", text: `"${dice}" in the description is not damage the table can roll.` });
    } else {
      const multi = /each creature|all creatures|every creature|in a \d+-foot|radius|cone|line|cube/i.test(spell.desc);
      const expected = (multi ? SPELL_DAMAGE_MULTI : SPELL_DAMAGE_SINGLE)[level];
      if (average > expected * 1.5) {
        findings.push({
          page: "spellcasting",
          level: "warn",
          text: `${dice} averages ${average.toFixed(1)} at level ${level}; the DMG's guideline for a ${multi ? "multi-target" : "single-target"} spell of that level is about ${expected}.`,
        });
      } else if (average < expected * 0.5 && level > 0) {
        findings.push({
          page: "spellcasting",
          level: "note",
          text: `${dice} averages ${average.toFixed(1)}, well under the ${expected} a level ${level} spell usually deals. Fine if it does something else too.`,
        });
      }
    }
  } else if (mech && (mech.resolution === "attack" || mech.resolution === "auto") && !mech.dice && !mech.darts && !mech.noDamage && !mech.hitPointPool && !mech.riders && !mech.condition && !mech.buff) {
    findings.push({
      page: "spellcasting",
      level: "error",
      text: "The engine reads damage out of the description, and this one says no dice. Write it as \"deals 2d8 fire damage\", or tick \"deals no damage\" in the block below.",
    });
  }
  // A condition the engine has no row for is laid as a name: it shows on
  // the sheet and does nothing else.
  for (const name of [mech?.condition?.name, ...(mech?.condition?.also ?? []), mech?.buff?.condition].filter((entry): entry is string => Boolean(entry))) {
    // The SRD's fifteen conditions are run by the condition engine itself;
    // the rest need a row of their own (condition-effects.ts).
    if (!SRD_CONDITIONS.has(name.trim().toLowerCase().replace(/\s*\(.*\)$/, "")) && !conditionEffectsFor(name)) {
      findings.push({ page: "conditions", level: "warn", text: `The engine has no rules for "${name}": it is laid as a name on the target and does nothing by itself.` });
    }
  }
  if (mech?.damageType && !DAMAGE_TYPES.has(mech.damageType)) {
    findings.push({ page: "spellcasting", level: "warn", text: `"${mech.damageType}" is not one of the 13 damage types; the engine deals it untyped.` });
  }
  if (spell.concentration && /instantaneous/i.test(spell.duration ?? "")) {
    findings.push({ page: "spellcasting", level: "note", text: "Concentration on an instantaneous spell holds nothing." });
  }
  if (level === 0 && spell.higherLevel?.trim()) {
    findings.push({ page: "spellcasting", level: "note", text: "Cantrips scale with caster level, not slot level; the engine ignores at-higher-levels text on one." });
  }
  if (rules.restVariant === "gritty" && level >= 6) {
    findings.push({ page: "spellcasting", level: "note", text: "Under gritty realism a long rest is a week; a level 6+ slot comes back once a week." });
  }
  return findings;
}

function monsterFindings(monster: MonsterDraft, rules: Partial<VariantRules>): Finding[] {
  const findings: Finding[] = [];
  for (const attack of monster.stats.attacks) {
    if (!isValidExpression(attack.damage.replace(/\s+/g, ""))) {
      findings.push({ page: "monster-statistics", level: "error", text: `${attack.name}: "${attack.damage}" is not damage the table can roll.` });
    }
  }
  if (findings.length) {
    return findings;
  }
  const derived = deriveCr(monster.stats, { extraDamagePerRound: monster.extraDamagePerRound });
  const gap = Math.abs(crRowIndex(derived.cr) - crRowIndex(monster.stats.cr));
  if (gap >= 2) {
    findings.push({
      page: "monster-statistics",
      level: "warn",
      text: `Rated CR ${crLabel(monster.stats.cr)}, but the numbers support CR ${crLabel(derived.cr)}. The encounter budget will believe the rating.`,
    });
  }
  if (!monster.stats.attacks.length && !monster.extraDamagePerRound) {
    findings.push({ page: "monster-statistics", level: "note", text: "No attacks and no extra damage per round: the engine will have this monster do nothing on its turn." });
  }
  if (rules.criticalFumbles && monster.stats.attacks.length >= 4) {
    findings.push({ page: "monster-statistics", level: "note", text: "This table fumbles on a natural 1; a monster with four attacks a round will fumble often." });
  }
  return findings;
}

function mapFindings(map: MapDraft): Finding[] {
  const findings: Finding[] = [];
  const { terrain, width, height } = map;
  if (terrain.length !== width * height) {
    return [{ level: "error", text: "The terrain does not match the map's size." }];
  }
  // Every open tile grouped by what it can reach. The largest group is the
  // field; anything else is somewhere nobody can walk to.
  const seen = new Set<number>();
  const groups: number[] = [];
  let open = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = tileIndex(width, x, y);
      if (blocksMove(terrain[index]) || seen.has(index)) {
        continue;
      }
      open += 1;
      let size = 0;
      const queue = [{ x, y }];
      seen.add(index);
      while (queue.length) {
        const at = queue.shift() as { x: number; y: number };
        size += 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = at.x + dx;
          const ny = at.y + dy;
          if (!inBounds(width, height, nx, ny)) {
            continue;
          }
          const next = tileIndex(width, nx, ny);
          if (seen.has(next) || blocksMove(terrain[next])) {
            continue;
          }
          seen.add(next);
          queue.push({ x: nx, y: ny });
        }
      }
      groups.push(size);
    }
  }
  if (!groups.length) {
    return [{ level: "error", text: "There is nowhere to stand: the map is solid." }];
  }
  groups.sort((a, b) => b - a);
  const stranded = groups.slice(1).reduce((sum, size) => sum + size, 0);
  if (stranded) {
    findings.push({
      level: "warn",
      text: `${stranded} open tile${stranded === 1 ? "" : "s"} in ${groups.length - 1} sealed pocket${groups.length - 1 === 1 ? "" : "s"} nobody can reach. Cut a door, or fill them in.`,
    });
  }
  if (map.ambient === "dark" && !map.lights.length) {
    findings.push({ level: "note", text: "Dark, with no lights: only carried torches will show anything." });
  }
  const doors = [...terrain].filter((ch) => ch === TERRAIN.door).length;
  if (groups.length === 1 && !doors && open < width * height * 0.5) {
    findings.push({ level: "note", text: "Rooms and corridors, but no doors anywhere." });
  }
  return findings;
}

export function validateDraft(context: RulesetContext, draft: Draft): Finding[] {
  const rules = context.variantRules ?? {};
  switch (draft.kind) {
    case "item":
      return itemFindings(draft.item, rules);
    case "spell":
      return spellFindings(draft.spell, rules);
    case "monster":
      return monsterFindings(draft.monster, rules);
    case "map":
      return mapFindings(draft.map);
  }
}

export function worstLevel(findings: Finding[]): FindingLevel | null {
  if (findings.some((finding) => finding.level === "error")) {
    return "error";
  }
  if (findings.some((finding) => finding.level === "warn")) {
    return "warn";
  }
  return findings.length ? "note" : null;
}
