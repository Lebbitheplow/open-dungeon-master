import { getFloor, setFloor, type Campaign } from "@/lib/db/campaigns";
import { silencedImmunity } from "@/lib/dm/zone-rules";
import { burnWebUnder } from "@/lib/dm/zone-cast";
import { endEncounter, getEnemy, listEnemies, patchEnemyHp, setEnemyConcentration, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { listRollsSince } from "@/lib/db/rolls";
import { listAuditSince } from "@/lib/db/sheet-audit";
import { patchEnemyConditions, setEncounterSummary } from "@/lib/db/encounters";
import { restoreOwnForm } from "@/lib/db/enemy-form";
import { computeEncounterSummary, describeEncounterSummary } from "@/lib/dm/encounter-summary";
import { getBattleMapForEncounter, removeTokenByRef } from "@/lib/db/battle-maps";
import { publishPersisted } from "@/lib/events";
import { healthState } from "@/lib/bestiary/health";
import { ammoCount, recoveredAmmo, withAmmoCount } from "@/lib/srd/ammunition";
import { clearSpellConditionsByName } from "@/lib/dm/concentration";
import { spellEffectsOnEnemyDamage } from "@/lib/dm/spell-effects";
import { enemyDamageMath } from "@/lib/dm/encounter-logic";
import { damageAdjust, resistsAllDamage } from "@/lib/dm/condition-logic";
import { resistLineFor } from "@/lib/dm/underwater";
import { authoredIgnoresResistance } from "@/lib/dm/authored-saves";
import { isDefeated, isKnockedOut, knockedOutConditions } from "@/lib/dm/knockout";
import { endConditionsHeldBy } from "@/lib/dm/enemy-conditions";
import { hasTrait, REGENERATION_STOPPED, regenerationOf } from "@/lib/dm/monster-abilities";
import { fallsRegenerating, regeneratingDown } from "@/lib/dm/regeneration";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { settleFrenzies } from "@/lib/dm/frenzy";
import { applyDmMutation } from "@/lib/dm/mutations";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import { planDeathFx } from "@/lib/battlemap/fx-plan";
import { publishFx, tokenPosition } from "@/lib/dm/fx";
import { dismissGuestCompanions } from "@/lib/dm/companion-tools";
import { followCombatAmbience } from "@/lib/dm/ambience-tools";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// The single server-side path for damage landing on an enemy. Used by the
// damage_enemy tool AND by damage rolls carrying targetEnemyId, which the
// server applies the moment the dice land so the enemy card can never lag
// the narration. Also home to encounter finishing, shared with the turn
// loop. This module must not import encounter-tools (the import points the
// other way, same rule as map-tools).

export function publishEncounter(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", {
    encounter: activePublicEncounter(campaignId),
  });
}

export function resolveEnemyRef(encounterId: string, ref: string): EncounterEnemy | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }
  const direct = getEnemy(trimmed);
  if (direct && direct.encounterId === encounterId) {
    return direct;
  }
  return (
    listEnemies(encounterId).find(
      (enemy) => enemy.displayName.toLowerCase() === trimmed.toLowerCase(),
    ) ?? null
  );
}

export function finishEncounter(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  outcome: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const enemies = listEnemies(encounter.id);
  // Survivors scatter when the fight ends without their deaths.
  if (outcome === "enemies_fled" || outcome === "truce" || outcome === "party_fled") {
    for (const enemy of enemies) {
      if (enemy.status === "alive") {
        patchEnemyHp(enemy.id, enemy.currentHp, "fled");
      }
    }
  }
  endEncounter(encounter.id, outcome);
  // A frenzy outliving its rage costs its level of exhaustion (frenzy.ts).
  settleFrenzies(campaign);

  // Half the ammunition spent in the fight is recovered from the field
  // (PHB). Only ever non-empty when the `ammunition` variant rule is on, so
  // a table that never asked for it pays nothing here.
  const ammoRecovered: Record<string, number> = {};
  for (const [key, spent] of Object.entries(encounter.ammoSpent)) {
    const back = recoveredAmmo(spent);
    if (back <= 0) {
      continue;
    }
    const separator = key.indexOf("|");
    const sheetId = key.slice(0, separator);
    const itemName = key.slice(separator + 1);
    const owner = getSheetById(sheetId);
    if (!owner) {
      continue;
    }
    const index = owner.equipment.findIndex((item) => item.name === itemName);
    const equipment =
      index >= 0
        ? withAmmoCount(owner.equipment, index, ammoCount(owner.equipment[index]) + back)
        : [...owner.equipment, { name: itemName, qty: back }];
    patchSheet(sheetId, { equipment });
    ammoRecovered[`${owner.name}: ${itemName}`] = back;
  }

  const totalXp = enemies.reduce((sum, enemy) => sum + enemy.xp, 0);
  const share =
    outcome === "victory" ? 1 : outcome === "enemies_fled" || outcome === "truce" ? 0.5 : 0;
  // The dead take no share: what the fight was worth is split among those
  // who lived through it.
  const earners = sheets.filter((sheet) => !(getSheetById(sheet.id) ?? sheet).deathSaves?.dead);
  const xpEach = earners.length ? Math.floor((totalXp * share) / earners.length) : 0;
  let xpResult: Record<string, unknown> = {};
  if (xpEach > 0) {
    xpResult = applyDmMutation(
      campaign,
      turn.id,
      "award_xp",
      JSON.stringify({
        characterIds: earners.map((sheet) => sheet.id),
        amount: xpEach,
        reason: outcome === "victory" ? "encounter victory" : `encounter ended: ${outcome}`,
      }),
      sheets,
      sheetsById,
    ).result;
  }

  const floor = getFloor(campaign.id);
  if (floor.mode === "initiative" || (floor.mode === "hold" && floor.next.mode === "initiative")) {
    setFloor(campaign.id, { mode: "open" });
    publishPersisted(campaign.id, "floor_changed", { floor: { mode: "open" } });
  }
  // After the fight (docs/vtt-parity-implementation-plan.md 4.2): the
  // card the table sees and the line the chapter keeps. Never blocks the
  // end of a fight.
  try {
    const endedAt = new Date().toISOString();
    const summary = computeEncounterSummary({
      outcome,
      rounds: encounter.round,
      startedAt: encounter.createdAt,
      endedAt,
      enemies,
      sheets,
      rolls: listRollsSince(campaign.id, encounter.createdAt).map((roll) => ({
        characterId: roll.characterId,
        attacker: roll.attacker,
        kind: roll.kind,
        total: roll.total,
        applied: roll.applied,
        targetEnemyId: roll.targetEnemyId,
        crit: roll.breakdown?.crit ?? null,
      })),
      audits: listAuditSince(campaign.id, encounter.createdAt).map((entry) => ({
        characterId: entry.characterId,
        kind: entry.kind,
        delta: entry.delta,
      })),
    });
    setEncounterSummary(encounter.id, summary, describeEncounterSummary(summary));
    publishPersisted(campaign.id, "encounter_summary", { encounterId: encounter.id, summary });
  } catch (error) {
    console.error("[encounter] summary failed", error);
  }
  publishPersisted(campaign.id, "encounter_updated", { encounter: null });
  // The fight is over, so the fight music is. Every way an encounter can
  // end comes through here, which is why the hook is here and not in the
  // end_encounter tool: a party wipe and a last enemy dropping are not
  // end_encounter calls.
  followCombatAmbience(campaign, false);
  // Clients drop their fogged map view; the archived rows stay for history.
  publishBattleMapUpdate(campaign.id);
  // Guest allies joined for this fight, so the fight ending writes them out;
  // lasting party companions stay. XP above already counted them in.
  const guestsGone = dismissGuestCompanions(campaign, "the fight ended");

  return {
    encounterOver: true,
    ...(Object.keys(ammoRecovered).length ? { ammoRecovered } : {}),
    outcome,
    ...(guestsGone.length
      ? {
          guestsDismissed: `${guestsGone.join(", ")} left with the scene; narrate the parting.`,
        }
      : {}),
    ...(xpEach > 0 ? { xpAwarded: `${xpEach} XP each` } : {}),
    ...(typeof xpResult.levelUpAvailable !== "undefined"
      ? { levelUpAvailable: xpResult.levelUpAvailable }
      : {}),
  };
}

// Ends the encounter with victory XP once no living enemies remain.
export function autoEndOnVictory(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> {
  const enemies = listEnemies(encounter.id);
  // A creature knocked out is out of the fight (src/lib/dm/knockout.ts).
  if (enemies.some((enemy) => !isDefeated(enemy))) {
    return {};
  }
  return finishEncounter(campaign, turn, encounter, "victory", sheets, sheetsById);
}

// Applies damage to a living enemy: resistance/immunity/vulnerability math
// from the stat block, HP patch, live enemy-card update, token removal and
// auto-victory on a kill. Returns the compact tool result.
export function applyEnemyDamage(
  campaign: Campaign,
  turn: DmTurn,
  encounter: Encounter,
  enemy: EncounterEnemy,
  amount: number,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  damageType?: string,
  options?: {
    // The damage comes from a spell, a magic weapon, or strikes that count
    // as magical, so "from nonmagical attacks" on the stat block does not
    // cover it.
    magical?: boolean;
    // A melee blow meant to knock out (src/lib/dm/knockout.ts).
    nonlethal?: boolean;
    // Leave the fight open when the last foe falls: an opportunity attack
    // has no DM turn, so the end and its XP wait for the next one (ODM's
    // rule, test-enforce-movement).
    holdVictory?: boolean;
    // A critical hit, which Undead Fortitude cannot save against.
    crit?: boolean;
    // Not damage but death outright (exhaustion 6): no resistance halves it
    // and no Undead Fortitude holds it.
    death?: boolean;
    // A silvered or adamantine weapon (damage-logic.ts weaponMaterial).
    silvered?: boolean;
    adamantine?: boolean;
    // Elemental Adept: the creature's resistance to this type does not
    // count (src/lib/srd/feat-combat.ts).
    ignoreResistance?: boolean;
  },
): Record<string, unknown> {
  // Inescapable Destruction: the acting Death cleric's necrotic ignores resistance (authored-saves.ts).
  const ignores = (damageType && authoredIgnoresResistance(campaign.id, damageType)) || (options?.ignoreResistance && damageType ? "Elemental Adept" : null);
  const adjusted = options?.death
    ? { amount: Math.max(1, enemy.currentHp), note: null }
    : damageAdjust(
        amount,
        damageType,
        // Fully immersed in water: resistance to fire (underwater.ts).
        ignores ? resistLineFor(campaign.id, enemy).replace(new RegExp(`\\b${damageType}\\b`, "gi"), "") : resistLineFor(campaign.id, enemy),
        // Inside Silence, thunder does nothing (zone-rules.ts).
        `${enemy.stats.immune ?? ""}${silencedImmunity(campaign.id, enemy.id)}`,
        enemy.stats.vulnerable,
        { magical: options?.magical === true, resistAll: resistsAllDamage(enemy.conditions), silvered: options?.silvered, adamantine: options?.adamantine },
      );
  if (adjusted.amount <= 0) {
    return {
      ok: true,
      name: enemy.displayName,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
      health: healthState(enemy.currentHp, enemy.maxHp),
      damageApplied: 0,
      note: `${enemy.displayName} is ${adjusted.note ?? "unharmed"}. Narrate the effect washing over it harmlessly.`,
    };
  }
  // Fire burns away the web around it (zone-cast.ts).
  if (/\bfire\b/i.test(damageType ?? "")) {
    burnWebUnder(campaign, enemy.id);
  }
  // A Polymorph's beast dropped to 0 reverts (SRD 5.1): the creature's own
  // block and hit points return (src/lib/db/enemy-form.ts), and only the
  // excess reaches them, already through the beast's defences, so untyped.
  const own = enemy.stats.polymorphedFrom;
  if (own && (options?.death === true || adjusted.amount >= enemy.currentHp)) {
    restoreOwnForm(enemy.id, own);
    const reverted = getEnemy(enemy.id);
    if (reverted) {
      const excess = adjusted.amount - enemy.currentHp;
      const formEnded = `${reverted.displayName}'s ${own.form} form drops to 0 hit points and ${own.spell} ends for it: its own form returns${excess > 0 ? `, and the ${excess} damage left over carries over` : ""}.`;
      publishEncounter(campaign.id);
      if (excess <= 0 && options?.death !== true) {
        return { ok: true, name: reverted.displayName, hp: `${reverted.currentHp}/${reverted.maxHp}`, health: healthState(reverted.currentHp, reverted.maxHp), formEnded };
      }
      return { ...applyEnemyDamage(campaign, turn, encounter, reverted, excess, sheets, sheetsById, undefined, options), formEnded };
    }
  }
  // A knockout leaves the creature alive at 0 and unconscious; any damage
  // to a creature already knocked out is the killing blow.
  const knockedOut = isKnockedOut(enemy);
  // Death outright takes a creature lying at 0 too (a troll down and burned).
  let math = knockedOut || (options?.death === true && enemy.currentHp <= 0)
    ? { currentHp: 0, dropped: true }
    : enemyDamageMath(enemy.currentHp, adjusted.amount);
  // Undead Fortitude (SRD 5.1, zombies): damage that would drop it forces a
  // Constitution save, DC 5 + the damage taken, unless the damage is radiant
  // or from a critical hit; on a success it drops to 1 hit point instead.
  let fortitude: string | null = null;
  if (
    math.dropped &&
    !knockedOut &&
    options?.nonlethal !== true &&
    options?.crit !== true &&
    options?.death !== true &&
    !/radiant/i.test(damageType ?? "") &&
    hasTrait(enemy.stats, "undeadFortitude")
  ) {
    const dc = 5 + adjusted.amount;
    // A save like any other (forced-save.ts): exhaustion, Bane, its roll row.
    const save = rollEnemySave(campaign.id, enemy, "con", dc, { record: { turn, detail: `${enemy.displayName}: Undead Fortitude (CON save)` } });
    if (save.success) {
      math = { currentHp: 1, dropped: false };
      fortitude = `${enemy.displayName}'s Undead Fortitude holds (CON save ${save.total} vs DC ${dc}): it stays up at 1 hit point.`;
    } else {
      fortitude = `${enemy.displayName}'s Undead Fortitude fails (CON save ${save.total ?? "failed"} vs DC ${dc}).`;
    }
  }
  const knockout = options?.nonlethal === true && math.dropped && !knockedOut;
  // A troll dies only at its turn start (src/lib/dm/regeneration.ts): 0 hit
  // points leaves it down.
  const regenerating = math.dropped && !knockout && options?.death !== true && fallsRegenerating(enemy);
  const updated = patchEnemyHp(enemy.id, math.currentHp, math.dropped && !knockout && !regenerating ? "dead" : "alive");
  if (knockout || regenerating) {
    const out = knockout ? knockedOutConditions(enemy) : regeneratingDown(enemy.conditions, enemy.conditionMeta);
    patchEnemyConditions(enemy.id, out.conditions, out.meta);
  }
  publishEncounter(campaign.id);
  if (!updated) {
    return { error: "Failed to update enemy." };
  }
  const base: Record<string, unknown> = {
    ok: true,
    name: updated.displayName,
    hp: `${updated.currentHp}/${updated.maxHp}`,
    health: healthState(updated.currentHp, updated.maxHp),
    // The type as it was taken, a homebrew one ("sonic") included: a
    // resistance answers only the type it names, so an unknown one is simply
    // unresisted, and the console says which was used.
    ...(damageType?.trim() ? { damageType: damageType.trim().toLowerCase() } : {}),
    ...(adjusted.note ? { damageApplied: adjusted.amount, damageNote: adjusted.note } : {}),
    ...(fortitude ? { undeadFortitude: fortitude } : {}),
  };
  // The damage that stops Regeneration (a troll's acid or fire) holds it off
  // at the creature's next turn start (legendary-tools.ts). Kept as a
  // condition on the creature that ends at the start of its own turn, so
  // the table and the DM see it.
  const stoppers = regenerationOf(enemy.stats)?.stoppedBy ?? [];
  if ((!math.dropped || regenerating) && stoppers.some((type) => new RegExp(`\\b${type}\\b`, "i").test(damageType ?? ""))) {
    const fresh = getEnemy(enemy.id);
    if (fresh && !fresh.conditions.includes(REGENERATION_STOPPED)) {
      patchEnemyConditions(enemy.id, [...fresh.conditions, REGENERATION_STOPPED], {
        ...fresh.conditionMeta,
        [REGENERATION_STOPPED]: { untilTurnOf: enemy.id },
      });
    }
  }
  // A creature that falls lets go: its grapples, charms and fears on others
  // end with it (src/lib/dm/enemy-conditions.ts).
  if (math.dropped) {
    const freed = endConditionsHeldBy(campaign, enemy.id);
    if (freed.length) {
      base.released = `${freed.join("; ")}: no longer held by ${updated.displayName}.`;
    }
  }
  // Enemy concentration: damage forces the CON save (DC 10 or half the
  // damage); death breaks it outright. A break ends the spell's conditions
  // on everyone it was holding (the same cleanup a PC's break runs).
  if (enemy.concentration) {
    const spell = enemy.concentration;
    if (math.dropped) {
      setEnemyConcentration(enemy.id, null);
      clearSpellConditionsByName(campaign, spell, undefined, enemy.id);
      base.concentrationBroken = `${updated.displayName}'s ${spell} ends as it falls; the spell's effects fade.`;
    } else {
      const dc = Math.max(10, Math.floor(adjusted.amount / 2));
      // A save like any other (forced-save.ts): exhaustion, Bane, its roll row.
      const outcome = rollEnemySave(campaign.id, enemy, "con", dc, { record: { turn, detail: `${enemy.displayName}: concentration on ${spell} (CON save)` } });
      const held = outcome.success;
      if (!held) {
        setEnemyConcentration(enemy.id, null);
        clearSpellConditionsByName(campaign, spell, undefined, enemy.id);
      }
      base.concentration = held
        ? `${updated.displayName} keeps concentrating on ${spell} (CON save ${outcome.total} vs DC ${dc}).`
        : `${updated.displayName} loses concentration on ${spell} (CON save ${outcome.total ?? "failed"} vs DC ${dc}); the spell's effects end.`;
    }
  }
  // A spell that ends on damage (Sleep, Hypnotic Pattern) ends; one that
  // grants a save on damage rolls it (src/lib/dm/spell-effects.ts).
  const spellEffects = math.dropped ? [] : spellEffectsOnEnemyDamage(enemy.id);
  if (spellEffects.length) {
    base.spellEffects = spellEffects;
  }
  if (knockout) {
    base.knockedOut = true;
    base.note = `${updated.displayName} is knocked out: unconscious at 0 hit points, out of the fight but alive. Narrate it falling senseless.`;
    Object.assign(base, options?.holdVictory ? {} : autoEndOnVictory(campaign, turn, encounter, sheets, sheetsById));
  } else if (regenerating) {
    base.down = true;
    base.note = `${updated.displayName} falls at 0 hit points but is not dead: it regenerates and rises at the start of its turn, and dies then only if ${(regenerationOf(enemy.stats)?.stoppedBy ?? []).join(" or ") || "the damage that stops its regeneration"} damage has landed since its last turn. Narrate it collapsing, not dying.`;
  } else if (math.dropped) {
    base.dead = true;
    base.note = `${updated.displayName} is slain. You may now narrate its death.`;
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      // The death plays where the token stood, then the token goes. A
      // hidden ambusher dying unseen plays nothing for the party.
      const pos = tokenPosition(campaign.id, enemy.id);
      if (pos && !pos.hidden) {
        publishFx(
          campaign.id,
          planDeathFx({ to: pos.at, toTokenId: pos.tokenId, name: updated.displayName }),
        );
      }
      removeTokenByRef(map.id, enemy.id);
      publishBattleMapUpdate(campaign.id);
    }
    Object.assign(base, options?.holdVictory ? {} : autoEndOnVictory(campaign, turn, encounter, sheets, sheetsById));
  }
  return base;
}

// The blow of a parked (physical dice) attack and a targeted damage roll:
// src/lib/dm/enemy-blow.ts, re-exported for the callers that find them here.
export { applyPendingDamageRoll, autoApplyDamageRoll, type DamageBlow } from "@/lib/dm/enemy-blow";
