// The bonus-action weapon attacks a feature grants with its own uses or its
// own trigger, which pc_attack's bonusAttack "feature" refused before this
// ("No feature of theirs grants a bonus-action weapon attack") while each
// counter sat unspent (issue 233):
//
//   War Priest (War Domain, PHB): "When you use the Attack action, you can
//     make one weapon attack as a bonus action", Wisdom-modifier uses.
//   Unwavering Mark (Cavalier, XGtE): "if a creature marked by you deals
//     damage to anyone other than you, you can make a special melee weapon
//     attack against the marked creature as a bonus action on your next
//     turn. You have advantage on the attack roll, and if it hits, the
//     attack's weapon deals extra damage to the target equal to half your
//     fighter level", Strength-modifier uses.
//   Hungry Jaws (lizardfolk, VGtM): "As a bonus action, you can make a
//     special attack with your bite. If the attack hits, it deals its normal
//     damage, and you gain temporary hit points equal to your Constitution
//     modifier (minimum of 1)", once a short rest.
//   Pistol and Blade (steampunk catalog): "When you attack with a melee
//     weapon, make one firearm attack as a bonus action."
//
// The bonus action itself is spent with the attack's other costs
// (pc-attack-spend.ts); the use, the mark and the extras here.
// No database: pc-attack-options.ts asks it in its refusal pass.
import type { TurnBudget } from "@/lib/dm/action-budget";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { classLevelFor } from "@/lib/srd/multiclass";
import { weaponNamed } from "@/lib/srd/weapons";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";

// The condition a marked creature's damage to someone else leaves on its
// marker: the bonus attack is open against that creature on the marker's
// next turn (src/lib/dm/authored-hooks.ts authoredAfterHit).
export const UNWAVERING_STRIKE = "unwavering strike";
// A melee attack was made this turn (Pistol and Blade's trigger). Not under
// the "attacked:" prefix, which names the creatures attacked (Horde Breaker).
export const MELEE_ATTACKED = "melee-attack-made";
// The counters the bonus attack itself spends, so use_resource and the Hand
// leave them to pc_attack.
export const BONUS_ATTACK_COUNTERS = ["sub_war_priest", "sub_unwavering_mark", "race_hungry_jaws"];

export type FeatureBonusAttack = {
  feature: string;
  // The counter one use of which the attack spends.
  counter?: string;
  advantage?: boolean;
  // Extra damage on the hit, an expression.
  damage?: string;
  // Temporary hit points on a hit.
  tempHpOnHit?: number;
  // The attacker's condition the attack uses up.
  consume?: string;
  // The swing reuses the arrow that missed (Curving Shot): no ammunition.
  noAmmo?: boolean;
};

const holds = (sheet: CharacterSheet, name: string) =>
  sheet.features.some((feature) => [feature.name, feature.name.replace(/\s*\(.*$/, "")].some((held) => textKey(held) === name));

const usesLeft = (sheet: CharacterSheet, id: string) => {
  const counter = sheet.resources?.[id];
  return counter ? counter.max - counter.used : 0;
};

// The feature bonus attack this swing can be, the refusal that names the
// first one held, or null when the character holds none of these.
export function featureBonusAttack(input: {
  sheet: CharacterSheet;
  budget: TurnBudget;
  profile: AttackProfile;
  melee: boolean;
  targetId?: string;
  mods: Record<string, number>;
}): FeatureBonusAttack | { refused: ToolError } | null {
  const { sheet, budget, profile, melee } = input;
  const refusals: ToolError[] = [];
  if (holds(sheet, "war priest")) {
    if (budget.attacksMade <= 0 || budget.castThisAction) {
      refusals.push({ error: "War Priest's bonus attack follows the Attack action, and they have not taken it this turn.", retry: true });
    } else if (usesLeft(sheet, "sub_war_priest") <= 0) {
      refusals.push({ error: "War Priest has no use left until a long rest.", refused: "rules" });
    } else {
      return { feature: "War Priest", counter: "sub_war_priest" };
    }
  }
  if (holds(sheet, "unwavering mark")) {
    const open = sheet.conditions.find((entry) => entry.trim().toLowerCase() === UNWAVERING_STRIKE);
    const against = open ? (sheet.conditionMeta as Record<string, { source?: string } | undefined>)[open]?.source : undefined;
    if (!open || !against) {
      refusals.push({
        error: "Unwavering Mark's bonus attack answers a creature they marked dealing damage to someone else since their last turn, and none has.",
        refused: "rules",
      });
    } else if (input.targetId && against !== input.targetId) {
      refusals.push({ error: "Unwavering Mark's bonus attack is made against the marked creature that dealt the damage.", retry: true });
    } else if (!melee) {
      refusals.push({ error: "Unwavering Mark's bonus attack is a melee weapon attack.", refused: "rules" });
    } else if (usesLeft(sheet, "sub_unwavering_mark") <= 0) {
      refusals.push({ error: "Unwavering Mark has no use left until a long rest.", refused: "rules" });
    } else {
      const half = Math.floor((classLevelFor(sheet, "fighter") || sheet.level) / 2);
      return { feature: "Unwavering Mark", counter: "sub_unwavering_mark", advantage: true, damage: half > 0 ? String(half) : undefined, consume: open };
    }
  }
  if (holds(sheet, "hungry jaws")) {
    if (!/\bbite\b/i.test(profile.weapon)) {
      refusals.push({ error: "Hungry Jaws is a bite: send weapon \"bite\".", retry: true });
    } else if (usesLeft(sheet, "race_hungry_jaws") <= 0) {
      refusals.push({ error: "Hungry Jaws has no use left until a short or long rest.", refused: "rules" });
    } else {
      return { feature: "Hungry Jaws", counter: "race_hungry_jaws", tempHpOnHit: Math.max(1, input.mods.con ?? 0) };
    }
  }
  if (holds(sheet, "pistol and blade")) {
    const firearm = weaponNamed(profile.base ?? "")?.category === "firearm";
    if (!budget.oncePerTurn.includes(MELEE_ATTACKED)) {
      refusals.push({ error: "Pistol and Blade's firearm shot follows a melee weapon attack this turn, and they have made none.", retry: true });
    } else if (!firearm) {
      refusals.push({ error: "Pistol and Blade's bonus attack is made with a firearm.", retry: true });
    } else {
      return { feature: "Pistol and Blade" };
    }
  }
  return refusals.length ? { refused: refusals[0] } : null;
}
