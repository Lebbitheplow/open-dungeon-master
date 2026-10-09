import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handleCastAtPlayer } from "@/lib/dm/cast-tools";
import { afflictCondition } from "@/lib/dm/afflictions";
import { openFall } from "@/lib/dm/last-hit";
import { rollCard } from "@/lib/dm/roll-card";
import { rollOn } from "@/lib/roll-labels";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { wornArmorTurnsCrits } from "@/lib/srd/armor";
import { fallingDamageDice } from "@/lib/srd/hazards";
import type { TrapSpec } from "@/lib/srd/trap-specs";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// One victim of a named trap (apply_hazard with `trap`: an SRD sample trap or
// one of the table's workshop traps), in the trap's own order: the attack it
// makes, the fall it opens, the damage nobody saves against, the conditions
// it leaves on everyone, then the save and what a failure costs. Every roll
// is the server's and every point lands through the same engines a monster's
// do (pc-damage, cast_at_player).
export function springTrapOn(
  campaign: Campaign,
  turn: DmTurn,
  victim: CharacterSheet,
  name: string,
  trap: TrapSpec,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const lines: string[] = [];
  const sheet = () => getSheetById(victim.id) ?? victim;
  // An attack roll is an attack roll (SRD 5.1): a natural 1 misses, a
  // natural 20 hits and is a critical hit, whose hit dice are rolled twice.
  // The AC is the one every other attack on the character faces (a pinned
  // AC, Shield, a beast form, the table's effects: ac-effects.ts).
  let crit = false;
  if (trap.attackBonus !== undefined) {
    const ac = acWithEffects(campaign.id, sheet());
    const sign = trap.attackBonus >= 0 ? "+" : "-";
    const attack = rollCard(campaign, turn, victim.id, "attack", rollOn(`${name} attacks (vs AC ${ac})`, [victim.name]), `1d20${sign}${Math.abs(trap.attackBonus)}`, null);
    const natural = attack.crit;
    const hit = natural !== "nat1" && (natural === "nat20" || attack.total >= ac);
    if (!hit) {
      return {
        name: victim.name,
        hit: false,
        ...(natural === "nat1" ? { fumble: true } : {}),
        note: `${name} misses ${victim.name} (${natural === "nat1" ? "a natural 1" : `${attack.total} vs AC ${ac}`}).`,
      };
    }
    // Adamantine armour turns a critical hit into a normal one.
    crit = natural === "nat20" && !wornArmorTurnsCrits(sheet().equipment ?? []);
    lines.push(`${name} hits ${victim.name} (${natural === "nat20" ? "a natural 20" : `${attack.total} vs AC ${ac}`})${crit ? ": a critical hit" : ""}.`);
  }
  if (trap.fallFeet) {
    const dice = fallingDamageDice(trap.fallFeet);
    if (dice !== "0") {
      const rolled = rollCard(campaign, turn, victim.id, "damage", rollOn(`${trap.fallFeet} ft fall into ${name} (${dice} bludgeoning)`, [victim.name]), dice, null);
      const fall = openFall(campaign.id, victim.id);
      applyPcDamage(campaign, turn.id, sheet(), { amount: rolled.total, type: "bludgeoning", knocksProne: true, reason: name });
      fall.close(rolled.total);
      lines.push(`${victim.name} falls ${trap.fallFeet} feet: ${rolled.total} bludgeoning, prone.`);
    }
  }
  // The hit's own dice double on a critical; a save the hit calls for (a
  // needle's poison) is rolled below at its own dice.
  const critical = (dice: string) =>
    crit
      ? critDamageExpression(dice, 0, {
          powerfulCritical: campaign.gameSettings?.variantRules?.powerfulCritical,
          multiplyNumeric: campaign.gameSettings?.variantRules?.criticalDamageMods,
        })
      : dice;
  for (const part of trap.hit ?? []) {
    const dice = critical(part.dice);
    const amount = /^\d+$/.test(dice)
      ? Number(dice)
      : rollCard(campaign, turn, victim.id, "damage", rollOn(`${name} (${dice} ${part.type})`, [victim.name]), dice, null).total;
    if (amount > 0) {
      applyPcDamage(campaign, turn.id, sheet(), { amount, type: part.type, reason: name });
      lines.push(`${amount} ${part.type}.`);
    }
  }
  for (const condition of trap.conditionsAlways ?? []) {
    if (afflictCondition(campaign, turn.id, victim.id, condition, { ...(trap.rounds ? { rounds: trap.rounds } : {}), source: name })) {
      lines.push(`${victim.name} is ${condition}.`);
    }
  }
  if (!trap.save) {
    return { name: victim.name, hit: true, ...(crit ? { crit: true } : {}), note: lines.join(" ") };
  }
  const saved = handleCastAtPlayer(
    campaign,
    turn,
    JSON.stringify({
      characterId: victim.id,
      source: name,
      saveAbility: trap.save.ability,
      dc: trap.save.dc,
      ...(trap.damage ? { damage: trap.damage.dice, damageType: trap.damage.type } : {}),
      halfOnSave: trap.save.halfOnSave,
      ...(trap.condition ? { condition: trap.condition } : {}),
      ...(trap.condition && trap.rounds ? { rounds: Math.min(100, trap.rounds) } : {}),
      hazard: "trap",
    }),
    sheets,
    sheetsById,
  );
  return { name: victim.name, hit: true, ...(crit ? { crit: true } : {}), note: lines.join(" "), ...saved };
}
