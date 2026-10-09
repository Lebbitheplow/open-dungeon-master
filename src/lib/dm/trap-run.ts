import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById } from "@/lib/db/sheets";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handleCastAtPlayer } from "@/lib/dm/cast-tools";
import { afflictCondition } from "@/lib/dm/afflictions";
import { openFall } from "@/lib/dm/last-hit";
import { rollCard } from "@/lib/dm/roll-card";
import { rollOn } from "@/lib/roll-labels";
import { acBreakdownFor } from "@/lib/srd";
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
  if (trap.attackBonus !== undefined) {
    const ac = acBreakdownFor(sheet()).ac;
    const sign = trap.attackBonus >= 0 ? "+" : "-";
    const attack = rollCard(campaign, turn, victim.id, "attack", rollOn(`${name} attacks (vs AC ${ac})`, [victim.name]), `1d20${sign}${Math.abs(trap.attackBonus)}`, null);
    if (attack.total < ac) {
      return { name: victim.name, hit: false, note: `${name} misses ${victim.name} (${attack.total} vs AC ${ac}).` };
    }
    lines.push(`${name} hits ${victim.name} (${attack.total} vs AC ${ac}).`);
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
  for (const part of trap.hit ?? []) {
    const amount = /^\d+$/.test(part.dice)
      ? Number(part.dice)
      : rollCard(campaign, turn, victim.id, "damage", rollOn(`${name} (${part.dice} ${part.type})`, [victim.name]), part.dice, null).total;
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
    return { name: victim.name, hit: true, note: lines.join(" ") };
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
  return { name: victim.name, hit: true, note: lines.join(" "), ...saved };
}
