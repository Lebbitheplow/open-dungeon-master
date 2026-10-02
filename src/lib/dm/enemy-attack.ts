// enemy_attack: an enemy's action against a character, resolved from the
// enemy's real stat block against the target's real Armor Class. Split from
// encounter-tools.ts, which dispatches to it and whose auto-act fallback
// calls it for the enemies a turn skipped. Must not import encounter-tools.

import { mirrorImageDecoy, sanctuaryRefusal } from "@/lib/dm/spell-defenses";
import { enfeebledBlow, spellRetort, spendEnemyRiders } from "@/lib/dm/spell-retort";
import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  recordEncounterTarget,
  saveEncounter,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { insertRoll } from "@/lib/db/rolls";
import { rollAgainst } from "@/lib/roll-labels";
import { getSheetById } from "@/lib/db/sheets";
import { d20Expression, rollExpression } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import { planAttackFx } from "@/lib/battlemap/fx-plan";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { normalizeAdvantage } from "@/lib/dm/arg-coerce";
import { coverFor } from "@/lib/dm/attack-spatial";
import { canEnemyAct, markEnemyActed } from "@/lib/dm/can-act";
import { spellAttackHold } from "@/lib/dm/spell-planes";
import { reachThroughProblem } from "@/lib/dm/zone-rules";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { wornArmorTurnsCrits } from "@/lib/srd/armor";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { approachTarget, standUpIfProne } from "@/lib/dm/enemy-approach";
import { blowByType, resolveOnHit } from "@/lib/dm/enemy-hit";
import { charmedBy, enemyAttackProfile, plannedSwings, swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { applyDmMutation } from "@/lib/dm/mutations";
import { enemySwingOdds, hasFeatureNamed } from "@/lib/dm/enemy-swing-odds";
import { openLastHit } from "@/lib/dm/last-hit";
import { authoredAfterHit } from "@/lib/dm/authored-hooks";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { sanctuaryWard } from "@/lib/dm/enemy-conditions";
import { naturesSanctuaryRefusal } from "@/lib/dm/srd-defenses";
import { conditionRollRiders } from "@/lib/srd/condition-effects";
import { isImmersed, underwaterSwing } from "@/lib/dm/underwater";
import { swimsFrom } from "@/lib/battlemap/types";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const attackArgsSchema = z.object({
  enemyId: z.string(),
  targetCharacterId: z.string(),
  attack: z.string().optional(),
  advantage: z.preprocess(
    normalizeAdvantage,
    z.enum(["none", "advantage", "disadvantage"]).optional(),
  ),
  advantageReason: z.string().max(200).optional(),
});

// The profile the enemy walks in for: the shortest reach among the melee
// swings it is about to make, or the shortest range when every swing is
// ranged, so the whole routine lands from where it stops.
function leadProfile(profiles: EnemyAttackProfile[]): EnemyAttackProfile {
  const melee = profiles.filter((profile) => profile.melee);
  if (melee.length) {
    return melee.reduce((best, profile) => (profile.reachTiles < best.reachTiles ? profile : best));
  }
  return profiles.reduce((best, profile) => (profile.rangeTiles < best.rangeTiles ? profile : best));
}

// A legendary action that buys one attack (legendary-tools.ts) is exactly
// one swing, whatever the Multiattack says. Consumed here.
function takeLegendaryStrike(campaignId: string, enemyId: string): boolean {
  const encounter = getActiveEncounter(campaignId);
  const strikes = encounter?.legendary.strikes ?? [];
  if (!encounter || !strikes.includes(enemyId)) {
    return false;
  }
  const at = strikes.indexOf(enemyId);
  encounter.legendary.strikes = [...strikes.slice(0, at), ...strikes.slice(at + 1)];
  saveEncounter(encounter);
  return true;
}

export function handleEnemyAttack(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  let args: z.infer<typeof attackArgsSchema>;
  try {
    args = attackArgsSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: enemy_attack needs enemyId and targetCharacterId." };
  }
  const found = resolveEnemyRef(encounter.id, args.enemyId);
  if (!found) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  // One guard for the enemy side (src/lib/dm/can-act.ts): the dead, the
  // incapacitated and the surprised do nothing, and an action is one a round.
  const allowed = canEnemyAct({ enemy: found, encounter, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const staleTarget =
    sheetsById.get(args.targetCharacterId.trim()) ??
    sheets.find(
      (sheet) => sheet.name.toLowerCase() === args.targetCharacterId.trim().toLowerCase(),
    );
  const target = staleTarget ? getSheetById(staleTarget.id) : null;
  if (!target) {
    return { error: "Unknown targetCharacterId; use one from GAME STATE." };
  }
  // SRD 5.1, Charmed: a charmed creature cannot attack its charmer.
  if (charmedBy(found.conditions, found.conditionMeta, target.id)) {
    return {
      error: `${found.displayName} is charmed by ${target.name} and cannot attack them. It may attack someone else or take another action.`,
    };
  }
  // Calm Emotions, Fear's flight; a target Blink or Etherealness took away (spell-planes.ts).
  const spellHeld = spellAttackHold({ name: found.displayName, conditions: found.conditions }, target);
  if (spellHeld) {
    return { error: spellHeld };
  }
  // Sanctuary turns the attacker away on a failed WIS save (spell-defenses.ts),
  // and a failure holds for the rest of its turn (enemy-conditions.ts).
  const sanctuary = sanctuaryWard(campaign.id, found, target, sanctuaryRefusal);
  if (sanctuary) {
    return { error: sanctuary };
  }
  // Nature's Sanctuary turns a beast or plant away the same way (srd-defenses.ts).
  const natures = sanctuaryWard(campaign.id, found, target, naturesSanctuaryRefusal);
  if (natures) {
    return { error: natures };
  }
  const attacks = found.stats.attacks.length ? found.stats.attacks : synthesizeStats(found.cr).attacks;
  if (!attacks.length) {
    return { error: `${found.displayName} has no usable attacks; narrate a different action.` };
  }
  const single = takeLegendaryStrike(campaign.id, found.id);
  const planned = plannedSwings(found.stats, attacks, args.attack, { single });
  const profiles = planned.map((attack) => enemyAttackProfile(attack, found.stats.traits ?? []));
  // Antilife Shell: no melee reaches through it (zone-rules.ts).
  const shell = leadProfile(profiles).melee ? reachThroughProblem(encounter.id, found.id, target.id, found.stats.type, found.displayName) : null;
  if (shell) {
    return { error: shell };
  }

  // A prone creature stands before it acts, for half its speed (SRD 5.1,
  // Being Prone); with too little movement left it stays down.
  const { enemy, stood } = standUpIfProne(encounter.id, found);

  // Battle-map positions are authoritative: an attacker out of reach walks
  // in along a legal path (not closer to what it fears), and the attack is
  // refused when the target is still out of reach or range.
  const spatial = approachTarget(campaign, encounter.id, enemy, target.id, leadProfile(profiles));
  if (spatial.blocked) {
    return spatial.blocked;
  }
  // A walk that took it out of a grappled creature's reach let go.
  releaseGrapplesOutOfReach(campaign);
  // The walk may have drawn an opportunity attack that killed it.
  const standing = resolveEnemyRef(encounter.id, enemy.id);
  if (!standing || standing.status !== "alive") {
    return {
      ok: true,
      attack: planned[0].name,
      target: target.name,
      swings: [],
      hit: false,
      opportunityAttacks: spatial.opportunityAttacks ?? [],
      note: `${enemy.displayName} was struck down on its way to ${target.name} and never made the attack.`,
    };
  }
  // Where the two stand after the approach, for the effect and the target
  // line every client draws (src/lib/battlemap/fx-plan.ts).
  const attackerPos = tokenPosition(campaign.id, enemy.id);
  const targetPos = tokenPosition(campaign.id, target.id);
  if (attackerPos && targetPos) {
    recordEncounterTarget(encounter.id, encounter.round, enemy.id, target.id);
  }
  const boardForWeather = getBattleMapForEncounter(encounter.id);
  // Cover protects whoever stands behind it.
  const cover = coverFor(encounter.id, enemy.id, target.id);
  // Multiattack Defense (a Hunter's Defensive Tactics): once this creature
  // hits, +4 AC against its later attacks this turn.
  const multiattackDefense = hasFeatureNamed(target, /multiattack defense/i);
  let defended = 0;
  const targetAc = () => {
    const fresh = getSheetById(target.id) ?? target;
    return acWithEffects(campaign.id, fresh) + cover + defended;
  };
  // A spell a character left on the creature (Bane's d4 off, Bless's d4 on)
  // counts on every swing, as it would on a character's attack.
  let riders = conditionRollRiders(standing.conditions, "attack");
  const notes: string[] = [];
  if (stood) {
    notes.push(`${enemy.displayName} stands up (half its speed)`);
  }
  if (cover) {
    notes.push(`${target.name} has ${cover === 2 ? "half" : "three-quarters"} cover: +${cover} AC`);
  }
  notes.push(...riders.notes);

  // The action is spent by taking it, hit or miss. Read fresh: the walk up
  // to the target may have spent a character's reaction on this same row.
  const live = getActiveEncounter(campaign.id) ?? encounter;
  markEnemyActed(live, enemy.id);
  saveEncounter(live);
  const hitLog = openLastHit(campaign.id, target.id);

  // The routine executes in this ONE call, each swing its own to-hit and
  // damage dice cards, stopping early if the target drops.
  const swings: Array<Record<string, unknown>> = [];
  let dropped = false;
  let totalDamage = 0;
  let targetHp: string | undefined;
  const damageTypes = new Set<string>();
  let lastSwing: { attack: EnemyAttack; ranged: boolean } | null = null;
  // A routine step that follows only a hit (the grick's beak) is skipped
  // after a miss.
  let previousHit = false;
  const attackerSubmerged = isImmersed(campaign.id, enemy.id);
  planned.forEach((attack: EnemyAttack, index) => {
    if (dropped) {
      return;
    }
    if (attack.onlyIfHit && !previousHit) {
      swings.push({ attack: attack.name, skipped: "it follows only a hit, and the attack before it missed" });
      return;
    }
    previousHit = false;
    const mode = swingMode(profiles[index], spatial.distance);
    if (!mode) {
      swings.push({ attack: attack.name, skipped: `${target.name} is out of this attack's reach` });
      return;
    }
    const ranged = mode.ranged;
    // Under the water (underwater.ts): a shot past normal range misses, and
    // weapons not made for the water swing at disadvantage.
    const underwater = attackerSubmerged
      ? underwaterSwing({ weapon: attack.name, melee: !ranged, swims: swimsFrom(standing.stats.speed), beyondNormal: mode.longRange, spell: attack.spellAttack })
      : null;
    if (underwater?.misses) {
      swings.push({ attack: attack.name, skipped: underwater.note });
      return;
    }
    lastSwing = { attack, ranged };
    // Every source of advantage on this swing (src/lib/dm/enemy-swing-odds.ts).
    const odds = enemySwingOdds({
      campaign,
      turn,
      encounterId: encounter.id,
      standing,
      target,
      requested: args,
      ranged,
      longRange: mode.longRange,
      distance: spatial.distance,
      outdoorsOnMap: Boolean(attackerPos && targetPos && boardForWeather?.outdoors),
      underwater,
      riders,
      defended,
    });
    const { advantage, authored } = odds;
    for (const note of odds.notes) {
      if (!notes.includes(note)) {
        notes.push(note);
      }
    }
    const hitOutcome = rollExpression(`${d20Expression(attack.toHit, advantage)}${riders.diceSuffix}`);
    // A one-shot rider (Vicious Mockery) is spent by the roll it rode (spell-retort.ts).
    riders = spendEnemyRiders(standing, riders);
    const hitRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "attack",
      detail: rollAgainst(attack.name, target.name),
      advantage,
      result: hitOutcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: hitRoll,
      source: "digital",
    });
    turn.rollIds.push(hitRoll.id);

    // Mirror Image: a duplicate may take the attack instead.
    const decoy = mirrorImageDecoy(campaign.id, target.id, hitOutcome.total);
    if (decoy) {
      swings.push({ attack: attack.name, rolled: hitOutcome.total, hit: false, duplicate: decoy });
      return;
    }
    const natCrit = hitOutcome.crit === "nat20";
    const hit = hitOutcome.crit !== "nat1" && (natCrit || hitOutcome.total >= targetAc());
    // Adamantine Armor turns a critical hit into a normal one (srd/armor.ts).
    const crit = (natCrit || (hit && odds.autoCrit)) && !wornArmorTurnsCrits(target.equipment ?? []) && !authored.noCrit;
    if (!hit) {
      hitLog.swing(hitOutcome, targetAc(), { hit: false, crit: false, raw: 0, advantage, ranged });
      swings.push({
        attack: attack.name,
        rolled: hitOutcome.total,
        hit: false,
        ...(hitOutcome.crit === "nat1" ? { fumble: true } : {}),
      });
      if (attackerPos && targetPos && !attackerPos.hidden) {
        publishFx(
          campaign.id,
          planAttackFx({
            from: attackerPos.at,
            to: targetPos.at,
            fromTokenId: attackerPos.tokenId,
            toTokenId: targetPos.tokenId,
            hit: false,
            crit: false,
            fumble: hitOutcome.crit === "nat1",
            ranged,
            damageType: attack.type,
            visibility: hitRoll.visibility,
          }),
        );
      }
      return;
    }

    const damageExpression = crit
      ? critDamageExpression(attack.damage, 0, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : attack.damage;
    const damageOutcome = rollExpression(damageExpression);
    const damageRoll = insertRoll({
      campaignId: campaign.id,
      characterId: target.id,
      requestedBy: "dm",
      kind: "damage",
      detail: rollAgainst(attack.name, target.name),
      result: damageOutcome,
      attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    });
    publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
      roll: damageRoll,
      source: "digital",
    });
    turn.rollIds.push(damageRoll.id);

    // Each damage type in the blow meets the target's resistances on its
    // own (a red dragon's fire halves for a tiefling, its teeth do not). A
    // penalty can bring a hit's damage to 0, never below it.
    const blow = blowByType(attack, damageOutcome, getSheetById(target.id) ?? target, crit, hasTrait(standing.stats, "magicWeapons"));
    // Ray of Enfeeblement halves a Strength weapon's blow (spell-retort.ts).
    const dealt = Math.floor(enfeebledBlow(standing, attack, ranged, Math.max(0, blow.amount)) / (authored.halve ? 2 : 1));
    // Damage lands through the standard mutation: temp HP, clamps, audit,
    // concentration, and the live sheet_updated publish all come for free.
    const applied: Record<string, unknown> = dealt <= 0 ? {} : applyDmMutation(
      campaign,
      turn.id,
      "apply_damage",
      JSON.stringify({
        characterId: target.id,
        amount: dealt,
        ...(blow.type ? { type: blow.type } : {}),
        // Magic Weapons: its weapon attacks are magical.
        ...(hasTrait(standing.stats, "magicWeapons") ? { magical: true } : {}),
        // Crits against a dying target count double death-save failures.
        ...(crit ? { crit: true } : {}),
        reason: `${enemy.displayName}'s ${attack.name}`,
      }),
      sheets,
      sheetsById,
    ).result;
    totalDamage += dealt;
    previousHit = true;
    if (multiattackDefense) {
      defended = 4;
    }
    hitLog.swing(hitOutcome, targetAc(), { hit: true, crit, raw: dealt, advantage, type: blow.type ?? "", ranged });
    for (const type of attack.type.split("/")) {
      damageTypes.add(type);
    }
    if (attackerPos && targetPos && !attackerPos.hidden) {
      publishFx(
        campaign.id,
        planAttackFx({
          from: attackerPos.at,
          to: targetPos.at,
          fromTokenId: attackerPos.tokenId,
          toTokenId: targetPos.tokenId,
          hit: true,
          crit,
          ranged,
          damage: dealt,
          damageType: attack.type,
          visibility: hitRoll.visibility,
        }),
      );
    }
    if (typeof applied.hp === "string") {
      targetHp = applied.hp;
    }
    // What the hit carries besides its damage: a save against poison, a
    // shove to the ground, a grapple (SRD 5.1: the rider is part of the
    // attack, so it is the engine's to resolve).
    const onHit = resolveOnHit(campaign, turn, standing, attack, target.id, { sheets, sheetsById });
    // Fire Shield and Holy Aura answer the blow (spell-retort.ts).
    const retort = spellRetort(campaign, turn, standing, target.id, !ranged, spatial.distance === null || spatial.distance <= 1, sheets, sheetsById);
    if (typeof onHit?.targetHp === "string") {
      targetHp = onHit.targetHp;
    }
    const after = getSheetById(target.id);
    if (applied.dropped || (after && after.currentHp <= 0)) {
      dropped = true;
    }
    swings.push({
      attack: attack.name,
      rolled: hitOutcome.total,
      hit: true,
      ...(crit ? { crit: true } : {}),
      damage: dealt,
      ...(blow.byType ? { damageByType: blow.byType } : {}),
      ...(onHit ?? {}),
      ...(retort ? { retort } : {}),
    });
  });

  const closing = lastSwing as { attack: EnemyAttack; ranged: boolean } | null;
  hitLog.close({
    attacker: { kind: "enemy", id: enemy.id, name: enemy.displayName },
    attack: (closing?.attack ?? planned[0]).name,
    type: (closing?.attack ?? planned[0]).type,
    ranged: closing?.ranged ?? false,
  });
  notes.push(...authoredAfterHit(campaign, { encounter, attacker: standing, target, dealt: totalDamage }));
  // The auto-act fallback in advanceAfterTurn skips enemies that already
  // took their turn here.
  if (!turn.actedEnemyIds.includes(enemy.id)) {
    turn.actedEnemyIds.push(enemy.id);
  }

  const names = [...new Set(planned.map((attack) => attack.name))];
  return {
    attack: names.join(", "),
    vsAc: targetAc(),
    target: target.name,
    ...(spatial.opportunityAttacks?.length
      ? { opportunityAttacks: spatial.opportunityAttacks }
      : {}),
    ...(planned.length > 1 ? { multiattack: planned.map((attack) => attack.name).join(", ") } : {}),
    swings,
    hit: swings.some((entry) => entry.hit),
    ...(totalDamage > 0 ? { totalDamage, damageType: [...damageTypes].join("/") } : {}),
    ...(notes.length ? { conditionEffects: notes } : {}),
    ...(targetHp ? { targetHp } : {}),
    ...(dropped ? { dropped: true, note: `${target.name} falls to 0 HP.` } : {}),
  };
}
