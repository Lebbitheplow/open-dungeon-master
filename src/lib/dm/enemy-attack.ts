// enemy_attack: an enemy's action against a character, resolved from the
// enemy's real stat block against the target's real Armor Class. Split from
// encounter-tools.ts, which dispatches to it and whose auto-act fallback
// calls it for the enemies a turn skipped. Must not import encounter-tools.
//
// The target is any combatant (src/lib/dm/combatant.ts): a character goes
// the character path below, with all a sheet's defences; an enemy fighting
// on the other side (a creature the party dominates) is struck stat block
// against stat block (src/lib/dm/enemy-strike.ts).

import { hostileTo, resolveCombatant } from "@/lib/dm/combatant";
import { enemyStrikesEnemy } from "@/lib/dm/enemy-strike";
import { lashOutTarget } from "@/lib/dm/confusion";

import { weaponNamed } from "@/lib/srd/weapons";
import { readiedHolder } from "@/lib/dm/readied-release";
import { hitTraitDice } from "@/lib/dm/side-allies";
import { patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
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
import { coverFor } from "@/lib/dm/attack-spatial";
import { canEnemyAct, enemyActedThisRound, enemyBonusThisRound, markEnemyActed, markEnemyBonus } from "@/lib/dm/can-act";
import { spellAttackHold } from "@/lib/dm/spell-planes";
import { reachThroughProblem } from "@/lib/dm/zone-rules";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { wornArmorTurnsCrits } from "@/lib/srd/armor";
import { resolveEnemyRef, unknownEnemyRef } from "@/lib/dm/enemy-damage";
import { approachTarget, spendEnemyAction, standUpIfProne } from "@/lib/dm/enemy-approach";
import { blowByType, resolveOnHit, scaledParts } from "@/lib/dm/enemy-hit";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { effectOutcome } from "@/lib/dm/effect-tools";
import { alternativeBlow, attackNamed, charmedBy, enemyAttackProfile, plannedSwings, swingMode, type EnemyAttackProfile } from "@/lib/dm/enemy-profile";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { hasTrait } from "@/lib/dm/monster-abilities";
import { enemySwingOdds, hasFeatureNamed } from "@/lib/dm/enemy-swing-odds";
import { openLastHit } from "@/lib/dm/last-hit";
import { authoredAfterHit, authoredIncomingAttack, WARD_WITHSTOOD } from "@/lib/dm/authored-hooks";
import { rollEnemySave } from "@/lib/dm/forced-save";
import type { ConditionMetaMap } from "@/lib/dm/condition-logic";
import { releaseGrapplesOutOfReach } from "@/lib/dm/grapple";
import { sanctuaryWard } from "@/lib/dm/enemy-conditions";
import { naturesSanctuaryRefusal } from "@/lib/dm/srd-defenses";
import { conditionRollRiders, conditionTurnShape } from "@/lib/srd/condition-effects";
import { isImmersed, underwaterSwing } from "@/lib/dm/underwater";
import { swimsFrom } from "@/lib/battlemap/types";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { invalidArguments, noneNamed, toolError, type ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { ADVANTAGE_SOURCES } from "@/lib/dm/pc-attack-options";
import { unknownSheetRef } from "@/lib/dm/rolls";

const attackArgsSchema = z.object({
  enemyId: z.string(),
  targetCharacterId: z.string(),
  attack: z.string().optional(),
  advantage: z.enum(["none", "advantage", "disadvantage"]).optional(),
  advantageSource: z.enum(ADVANTAGE_SOURCES).optional(),
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
  // The engine's own attacks (Confusion's random creature): `anySide` lets
  // the target be on the attacker's own side.
  engine: { anySide?: boolean } = {},
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter: enemy_attack works only in a fight. Call start_encounter first.", retry: true };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return { error: "Invalid arguments: enemy_attack needs enemyId and targetCharacterId.", retry: true };
  }
  const parsed = attackArgsSchema.safeParse(raw);
  if (!parsed.success) {
    return invalidArguments("Invalid arguments: enemy_attack needs enemyId and targetCharacterId.", parsed.error);
  }
  const args = parsed.data;
  const found = resolveEnemyRef(encounter.id, args.enemyId);
  if (!found) {
    return unknownEnemyRef(encounter.id, "enemyId", args.enemyId);
  }
  // An attack the block prints among its Bonus Actions is the creature's
  // bonus action: one swing, beside its action, once a round.
  const bonus = Boolean(args.attack && attackNamed(found.stats.attacks, args.attack)?.bonusAction);
  // One guard for the enemy side (src/lib/dm/can-act.ts): the dead, the
  // incapacitated and the surprised do nothing, and an action is one a round.
  const allowed = canEnemyAct({ enemy: found, encounter, kind: bonus ? "bonus" : "action" });
  if (!allowed.ok) {
    return toolError(allowed);
  }
  // Slow: an action or a bonus action on its turn, not both (SRD 5.1).
  if (conditionTurnShape(found.conditions).slowed && (bonus ? enemyActedThisRound(encounter, found.id) : enemyBonusThisRound(encounter, found.id))) {
    return { error: `${found.displayName} is slowed: it takes an action or a bonus action this turn, not both, and it has taken its ${bonus ? "action" : "bonus action"}.`, retry: true };
  }
  // The target is any combatant (src/lib/dm/combatant.ts): a character on
  // either side, or an enemy fighting on the other one (a creature the party
  // dominates, a summon gone wild).
  const aimed =
    resolveCombatant(campaign.id, encounter, args.targetCharacterId) ??
    (() => {
      const named = sheets.find((sheet) => textKey(sheet.name) === textKey(args.targetCharacterId));
      return named ? resolveCombatant(campaign.id, encounter, named.id) : null;
    })();
  if (!aimed) {
    return unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets);
  }
  if (aimed.id === found.id) {
    return { error: `${found.displayName} cannot attack itself. Name the creature it attacks.`, retry: true };
  }
  // Confusion's lash-out (confusion.ts): one melee attack on the creature
  // its d10 picked, and no other, whichever side it is on.
  const lash = lashOutTarget(found, encounter.round);
  if (lash && aimed.id !== lash) {
    const picked = resolveCombatant(campaign.id, encounter, lash);
    return { error: `${found.displayName} is confused: this turn's attack is on ${picked?.name ?? "the creature Confusion picked"}, picked at random, and no other.`, refused: "rules" };
  }
  if (!engine.anySide && !lash && !hostileTo(encounter, { kind: "enemy", id: found.id }, { kind: aimed.kind, id: aimed.id })) {
    return {
      error: `${aimed.name} fights on ${found.displayName}'s side: enemy_attack does not strike an ally. Pick a creature on the other side.`,
      refused: "rules",
    };
  }
  if (aimed.kind === "enemy") {
    if (charmedBy(found.conditions, found.conditionMeta, aimed.id)) {
      return { error: `${found.displayName} is charmed by ${aimed.name} and cannot attack it.`, retry: true };
    }
    return enemyStrikesEnemy(campaign, turn, found, aimed.enemy, {
      ...(args.attack ? { attack: args.attack } : {}),
      ...(args.advantage ? { advantage: args.advantage } : {}),
      single: bonus || Boolean(lash) || conditionTurnShape(found.conditions).slowed,
      bonus,
      sheets,
      sheetsById,
    });
  }
  const target = getSheetById(aimed.id);
  if (!target) {
    return unknownSheetRef("targetCharacterId", args.targetCharacterId, sheets);
  }
  // SRD 5.1, Charmed: a charmed creature cannot attack its charmer.
  if (charmedBy(found.conditions, found.conditionMeta, target.id)) {
    return {
      error: `${found.displayName} is charmed by ${target.name} and cannot attack them. It may attack someone else or take another action.`,
      retry: true,
    };
  }
  // Calm Emotions, Fear's flight; a target Blink or Etherealness took away (spell-planes.ts).
  const spellHeld = spellAttackHold({ name: found.displayName, conditions: found.conditions }, target);
  if (spellHeld) {
    return spellHeld;
  }
  // Sanctuary turns the attacker away on a failed WIS save (spell-defenses.ts),
  // and a failure holds for the rest of its turn (enemy-conditions.ts).
  const sanctuary = sanctuaryWard(campaign.id, found, target, sanctuaryRefusal);
  if (sanctuary) {
    return sanctuary;
  }
  // Nature's Sanctuary turns a beast or plant away the same way (srd-defenses.ts).
  const natures = sanctuaryWard(campaign.id, found, target, naturesSanctuaryRefusal);
  if (natures) {
    return natures;
  }
  // A legendary action that bought an attack printed only among the legendary
  // actions (an ankheg queen's Acid Glob) may swing it, and only then.
  const owed = (encounter.legendary.strikes ?? []).includes(found.id);
  const attacks = [
    ...(found.stats.attacks.length ? found.stats.attacks : synthesizeStats(found.cr).attacks),
    ...(owed ? (found.stats.legendaryAttacks ?? []) : []),
  ];
  if (!attacks.length) {
    return { error: `${found.displayName} has no usable attacks; narrate a different action.`, retry: true };
  }
  const asked = args.attack ? attackNamed(attacks, args.attack) : null;
  if (args.attack && !asked) {
    return noneNamed(`${found.displayName} has no attack called`, args.attack, attacks.map((attack) => attack.name));
  }
  // The action's attacks: a bonus action's is never one of its swings.
  const actionAttacks = attacks.filter((attack) => !attack.bonusAction);
  if (!asked && !actionAttacks.length) {
    return { error: `${found.displayName}'s attacks are bonus actions: name one in attack (${attacks.map((attack) => attack.name).join(", ")}).`, retry: true };
  }
  // Slow: no more than one attack on its turn, Multiattack or not (SRD 5.1).
  // A bonus action's attack is one swing, and spends no legendary strike.
  // Confusion's lash-out is one melee attack, not the routine.
  const single = bonus || Boolean(lash) || takeLegendaryStrike(campaign.id, found.id) || conditionTurnShape(found.conditions).slowed;
  if (single && !asked && actionAttacks.length > 1) {
    return { error: `${found.displayName} makes one attack this turn: name it in attack (${actionAttacks.map((attack) => attack.name).join(", ")}).`, retry: true };
  }
  const planned = plannedSwings(found.stats, bonus ? attacks : actionAttacks, asked, { single });
  const profiles = planned.map((attack) => enemyAttackProfile(attack, found.stats.traits ?? []));
  // Antilife Shell: no melee reaches through it (zone-rules.ts).
  const shell = leadProfile(profiles).melee ? reachThroughProblem(encounter.id, found.id, target.id, found.stats.type, found.displayName) : null;
  if (shell) {
    return shell;
  }

  // A prone creature stands before it acts, for half its speed (SRD 5.1,
  // Being Prone); with too little movement left it stays down.
  const { enemy, stood } = standUpIfProne(encounter.id, found);

  // Battle-map positions are authoritative: an attacker out of reach walks
  // in along a legal path (not closer to what it fears), and the attack is
  // refused when the target is still out of reach or range.
  // A decision point inside the enemy's turn (issue 264): while a
  // character holds a readied action, an enemy out of reach stays put.
  const spatial = approachTarget(campaign, encounter.id, enemy, target.id, leadProfile(profiles), readiedHolder(campaign.id));
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
  // An attack a legendary action bought is not a turn of the creature's,
  // and a bonus action's is its bonus action.
  if (bonus) {
    markEnemyBonus(live, enemy.id);
  } else if (single) {
    markEnemyActed(live, enemy.id);
  } else {
    spendEnemyAction(live, enemy.id);
  }
  saveEncounter(live);
  // Among the Dead: an undead saves before it may attack this warlock, and on
  // a failure the attack is lost (src/lib/dm/authored-hooks.ts).
  const warded = authoredWardSave(campaign, turn, standing, target);
  if (warded.lost) {
    return { ok: true, attack: planned[0].name, target: target.name, swings: [], hit: false, note: warded.lost };
  }
  if (warded.note) {
    notes.push(warded.note);
  }
  const hitLog = openLastHit(campaign.id, target.id);

  // The routine executes in this ONE call, each swing its own to-hit and
  // damage dice cards, stopping early if the target drops.
  const swings: Array<Record<string, unknown>> = [];
  // Martial Advantage is once a turn: this call is the creature's turn.
  let martialSpent = false;
  let dropped = false;
  let totalDamage = 0;
  let targetHp: string | undefined;
  const damageTypes = new Set<string>();
  let lastSwing: { attack: EnemyAttack; ranged: boolean } | null = null;
  // A routine step that follows only a hit (the grick's beak) is skipped
  // after a miss.
  let previousHit = false;
  const attackerSubmerged = isImmersed(campaign.id, enemy.id);
  planned.forEach((plannedAttack: EnemyAttack, index) => {
    let attack = plannedAttack;
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
    // What the block deals instead at half its hit points or at range (a
    // swarm's weaker bite, a spear thrown), from here on the swing's blow.
    attack = alternativeBlow(plannedAttack, { ranged, bloodied: standing.currentHp <= standing.maxHp / 2 });
    // Under the water (underwater.ts): a shot past normal range misses, and
    // weapons not made for the water swing at disadvantage.
    const underwater = attackerSubmerged
      ? underwaterSwing({ weapon: attack.name, base: weaponNamed(attack.name)?.name, melee: !ranged, swims: swimsFrom(standing.stats.speed), beyondNormal: mode.longRange, spell: attack.spellAttack })
      : null;
    if (underwater?.misses) {
      swings.push({ attack: attack.name, skipped: underwater.note });
      return;
    }
    // Arrows and bolts into a Wind Wall are deflected and miss (SRD 5.1); a
    // spell attack is no projectile.
    if (ranged && !attack.spellAttack && spatial.deflected) {
      swings.push({ attack: attack.name, hit: false, missed: spatial.deflected });
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
    const hitOutcome = rollExpression(`${d20Expression(attack.toHit + odds.attackBonus, advantage)}${riders.diceSuffix}`);
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

    // Martial Advantage and Surprise Attack add their dice to the blow
    // (src/lib/dm/monster-traits.ts), doubled on a critical hit like the rest.
    const bonus = hitTraitDice(encounter, standing, target.id, attack, martialSpent);
    if (bonus.martial) {
      martialSpent = true;
    }
    // An active effect's amount on its damage rolls (set_effect), once.
    const effectDamage = effectOutcome(campaign.id, { kind: "enemy", id: standing.id }, "damage").bonus;
    const withTraits = bonus.dice.length ? `${attack.damage}+${bonus.dice.join("+")}` : attack.damage;
    const baseDamage = effectDamage > 0 ? `${withTraits}+${effectDamage}` : effectDamage < 0 ? `${withTraits}-${-effectDamage}` : withTraits;
    const damageExpression = crit
      ? critDamageExpression(baseDamage, 0, {
          powerfulCritical: campaign.gameSettings.variantRules.powerfulCritical,
          multiplyNumeric: campaign.gameSettings.variantRules.criticalDamageMods,
        })
      : baseDamage;
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

    // Each damage type in the blow meets the target's defenses on its own
    // (a red dragon's fire halves for a tiefling, its teeth do not; a monk
    // immune to poison takes none of a bite's venom). A penalty can bring a
    // hit's damage to 0, never below it.
    const blow = blowByType(attack, damageOutcome, crit);
    // Ray of Enfeeblement halves a Strength weapon's blow (spell-retort.ts).
    const dealt = Math.floor(enfeebledBlow(standing, attack, ranged, Math.max(0, blow.amount)) / (authored.halve ? 2 : 1));
    // Damage lands through the damage path: the ward, each type's defenses,
    // temp HP, clamps, audit, concentration and the sheet_updated publish.
    const applied: Record<string, unknown> = dealt <= 0 ? {} : applyPcDamage(campaign, turn.id, getSheetById(target.id) ?? target, {
      amount: Math.min(dealt, 200),
      ...(blow.type ? { type: blow.type } : {}),
      ...(blow.parts ? { parts: scaledParts(blow.parts, dealt) } : {}),
      // Magic Weapons: its weapon attacks are magical; so is a spell attack,
      // and a blow the block prints as magical ("magical bludgeoning").
      ...(hasTrait(standing.stats, "magicWeapons") || attack.spellAttack || attack.magical ? { magical: true } : {}),
      // Crits against a dying target count double death-save failures.
      ...(crit ? { crit: true } : {}),
      // Emissary of Redemption holds nothing against a creature the paladin attacked.
      ...(authored.spurned.length ? { exceptFeatures: authored.spurned } : {}),
      reason: `${enemy.displayName}'s ${attack.name}`,
    });
    totalDamage += dealt;
    previousHit = true;
    if (multiattackDefense) {
      defended = 4;
    }
    hitLog.swing(hitOutcome, targetAc(), { hit: true, crit, raw: dealt, advantage, type: blow.type ?? "", ...(blow.parts ? { parts: scaledParts(blow.parts, dealt) } : {}), ranged });
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
    // The necrotic part of the blow, for a drain of the target's maximum.
    const byType = Array.isArray(applied.damageByType) ? (applied.damageByType as string[]) : null;
    const necrotic = byType
      ? byType.reduce((sum, part) => sum + (/^(\d+) necrotic\b/i.exec(part) ? Number(/^(\d+)/.exec(part)![1]) : 0), 0)
      : /necrotic/i.test(blow.type ?? attack.type) ? dealt : 0;
    const onHit = resolveOnHit(campaign, turn, standing, attack, target.id, { sheets, sheetsById, dealt: { total: dealt, necrotic } });
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
      ...(byType ? { damageByType: byType } : {}),
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
  notes.push(...authoredAfterHit(campaign, { encounter, attacker: standing, target, dealt: totalDamage, ranged: (lastSwing as { ranged: boolean } | null)?.ranged ?? false }));

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

// Among the Dead (the Undying warlock): an undead that targets the warlock
// with an attack first saves on Wisdom against their spell save DC. On a
// failure the attack is lost; on a success the creature is immune for 24
// hours.
function authoredWardSave(
  campaign: Campaign,
  turn: DmTurn,
  attacker: EncounterEnemy,
  target: CharacterSheet,
): { lost: string | null; note: string | null } {
  const ward = authoredIncomingAttack({ campaignId: campaign.id, encounterId: "", attacker, target }).ward;
  if (!ward) {
    return { lost: null, note: null };
  }
  const save = rollEnemySave(campaign.id, attacker, ward.save as "wis", ward.dc, {
    magical: true,
    record: { turn, detail: `${attacker.displayName}: ${ward.save.toUpperCase()} save against ${ward.feature}` },
  });
  if (!save.success) {
    return { lost: `${ward.feature}: ${attacker.displayName} fails its ${ward.save.toUpperCase()} save (DC ${ward.dc}) and cannot bring itself to attack ${target.name}; the attack is lost.`, note: null };
  }
  patchEnemyConditions(attacker.id, [...attacker.conditions.filter((entry) => textKey(entry) !== textKey(WARD_WITHSTOOD)), WARD_WITHSTOOD], {
    ...(attacker.conditionMeta as ConditionMetaMap),
    [WARD_WITHSTOOD]: { source: target.id, rounds: 14400 },
  } as typeof attacker.conditionMeta);
  return { lost: null, note: `${ward.feature}: ${attacker.displayName} makes its ${ward.save.toUpperCase()} save (DC ${ward.dc}) and is immune to it for 24 hours.` };
}
