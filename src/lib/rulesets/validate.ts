import { isValidExpression } from "@/lib/dice";
import type { VariantRules } from "@/lib/rulesets/logic";
import { deriveCr, crLabel, crRowIndex } from "@/lib/bestiary/derive-cr";
import type { MonsterDraft } from "@/lib/bestiary/monster-draft";
import { baseDamageDice } from "@/lib/srd/spell-scaling";
import type { SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
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
export type Finding = { level: FindingLevel; text: string };

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
      findings.push({ level: "error", text: `"${dice}" is not damage the table can roll.` });
    } else {
      const average = averageOf(dice) ?? 0;
      if (average > SRD_WEAPON_TOP_AVERAGE + 0.5 && item.itemKind !== "magic_item") {
        findings.push({
          level: "warn",
          text: `${item.weapon.damage} averages ${average.toFixed(1)}; no SRD weapon averages above ${SRD_WEAPON_TOP_AVERAGE}. A mundane weapon this strong changes what every fighter carries.`,
        });
      }
    }
    const properties = item.weapon.properties ?? [];
    if (properties.includes("heavy") && properties.includes("light")) {
      findings.push({ level: "error", text: "A weapon cannot be both heavy and light." });
    }
    if (item.weapon.kind === "ranged" && !item.weapon.rangeFt) {
      findings.push({ level: "warn", text: "A ranged weapon with no range fires at everything on the map." });
    }
    if (
      rules.ammunition &&
      item.weapon.kind === "ranged" &&
      !properties.includes("ammunition") &&
      !properties.includes("thrown")
    ) {
      findings.push({
        level: "note",
        text: "This table counts ammunition. A ranged weapon without the ammunition or thrown property never runs out.",
      });
    }
  }
  if (item.armor) {
    const armor = item.armor;
    if (armor.category === "heavy" && !armor.strengthRequirement) {
      findings.push({
        level: "note",
        text: "Every SRD heavy armour has a Strength requirement; without one this is heavy armour anybody can wear at full speed.",
      });
    }
    if (armor.category === "heavy" && !armor.stealthDisadvantage) {
      findings.push({ level: "note", text: "SRD heavy armour imposes disadvantage on Stealth; this one does not." });
    }
    if (armor.category !== "shield" && armor.baseAc >= 19) {
      findings.push({
        level: "warn",
        text: `Base AC ${armor.baseAc} is above plate (18) before any magic. Consider making the extra a magic bonus that requires attunement.`,
      });
    }
    if (armor.category === "shield" && armor.baseAc > 2) {
      findings.push({ level: "warn", text: `A shield adding +${armor.baseAc} is stronger than any SRD shield, magical ones included.` });
    }
    if (rules.encumbrance && !armor.weightLb && !item.weight) {
      findings.push({ level: "note", text: "This table weighs packs, and this armour weighs nothing." });
    }
  }
  const effects = item.effects ?? [];
  for (const effect of effects) {
    if ((effect.kind === "ac_bonus" || effect.kind === "save_bonus" || effect.kind === "ac_unarmored") && Math.abs(effect.amount) > 3) {
      findings.push({
        level: "warn",
        text: `A ${effect.kind === "save_bonus" ? "save" : "AC"} bonus of ${effect.amount} is beyond any +3 item in the books.`,
      });
    }
    if (effect.kind === "set_ability" && effect.score > 27) {
      findings.push({ level: "warn", text: `Setting ${effect.ability.toUpperCase()} to ${effect.score} is above the strongest SRD belt (27).` });
    }
  }
  if (effects.length >= 2 && !item.requiresAttunement) {
    findings.push({
      level: "note",
      text: "Two or more standing effects without attunement: in the SRD an item this useful takes one of the three slots.",
    });
  }
  if (rules.encumbrance && item.itemKind !== "magic_item" && item.weight === undefined && !item.armor) {
    findings.push({ level: "note", text: "This table weighs packs, and this item has no weight." });
  }
  return findings;
}

function spellFindings(spell: SpellDraft, rules: Partial<VariantRules>): Finding[] {
  const findings: Finding[] = [];
  const level = Math.max(0, Math.min(9, Math.round(spell.level)));
  const mech = spell.mech ?? null;
  if (mech?.resolution === "save" && !mech.save) {
    findings.push({ level: "error", text: "A spell that calls for a save has to say which ability saves." });
  }
  const dice = baseDamageDice(spell.desc);
  if (dice) {
    const average = averageOf(dice);
    if (average === null) {
      findings.push({ level: "error", text: `"${dice}" in the description is not damage the table can roll.` });
    } else {
      const multi = /each creature|all creatures|every creature|in a \d+-foot|radius|cone|line|cube/i.test(spell.desc);
      const expected = (multi ? SPELL_DAMAGE_MULTI : SPELL_DAMAGE_SINGLE)[level];
      if (average > expected * 1.5) {
        findings.push({
          level: "warn",
          text: `${dice} averages ${average.toFixed(1)} at level ${level}; the DMG's guideline for a ${multi ? "multi-target" : "single-target"} spell of that level is about ${expected}.`,
        });
      } else if (average < expected * 0.5 && level > 0) {
        findings.push({
          level: "note",
          text: `${dice} averages ${average.toFixed(1)}, well under the ${expected} a level ${level} spell usually deals. Fine if it does something else too.`,
        });
      }
    }
  } else if (mech && (mech.resolution === "attack" || mech.resolution === "auto")) {
    findings.push({
      level: "error",
      text: "The engine reads damage out of the description, and this one says no dice. Write it as \"deals 2d8 fire damage\".",
    });
  }
  if (spell.concentration && /instantaneous/i.test(spell.duration ?? "")) {
    findings.push({ level: "note", text: "Concentration on an instantaneous spell holds nothing." });
  }
  if (level === 0 && spell.higherLevel?.trim()) {
    findings.push({ level: "note", text: "Cantrips scale with caster level, not slot level; the engine ignores at-higher-levels text on one." });
  }
  if (rules.restVariant === "gritty" && level >= 6) {
    findings.push({ level: "note", text: "Under gritty realism a long rest is a week; a level 6+ slot comes back once a week." });
  }
  return findings;
}

function monsterFindings(monster: MonsterDraft, rules: Partial<VariantRules>): Finding[] {
  const findings: Finding[] = [];
  for (const attack of monster.stats.attacks) {
    if (!isValidExpression(attack.damage.replace(/\s+/g, ""))) {
      findings.push({ level: "error", text: `${attack.name}: "${attack.damage}" is not damage the table can roll.` });
    }
  }
  if (findings.length) {
    return findings;
  }
  const derived = deriveCr(monster.stats, { extraDamagePerRound: monster.extraDamagePerRound });
  const gap = Math.abs(crRowIndex(derived.cr) - crRowIndex(monster.stats.cr));
  if (gap >= 2) {
    findings.push({
      level: "warn",
      text: `Rated CR ${crLabel(monster.stats.cr)}, but the numbers support CR ${crLabel(derived.cr)}. The encounter budget will believe the rating.`,
    });
  }
  if (!monster.stats.attacks.length && !monster.extraDamagePerRound) {
    findings.push({ level: "note", text: "No attacks and no extra damage per round: the engine will have this monster do nothing on its turn." });
  }
  if (rules.criticalFumbles && monster.stats.attacks.length >= 4) {
    findings.push({ level: "note", text: "This table fumbles on a natural 1; a monster with four attacks a round will fumble often." });
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
