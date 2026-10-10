// The reaction spells and the opportunity attack of use_reaction
// (src/lib/dm/reaction-tools.ts). A reaction spell is a cast through the one
// guard; Shield and Feather Fall then answer the attack or fall the engine
// kept (src/lib/dm/last-hit.ts), Hellish Rebuke resolves as cast_at_enemy
// does, and Absorb Elements resists the elemental hit it answers. An
// opportunity attack is the server's own on a battle map; off the map it is
// resolved here as one attack with the reaction.

import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import { getActiveEncounter, saveEncounter, type EncounterEnemy } from "@/lib/db/encounters";
import { spellFactsFor } from "@/lib/content";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { enemyActedThisRound } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { findMonsterSpell, slotFor, spellUsesLeft, spendSlot, spendSpellUse, type AbilityLedger } from "@/lib/dm/monster-abilities";
import { boughtByLegendary } from "@/lib/dm/enemy-casting";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { addSheetCondition } from "@/lib/dm/action-common";
import { acWithEffects } from "@/lib/dm/ac-effects";
import { handleCastAtEnemy } from "@/lib/dm/cast-tools";
import { pcResistances, removeConditions } from "@/lib/dm/condition-logic";
import { freshLastHit } from "@/lib/dm/last-hit";
// For the reaction spells' slot spend; mutations never imports back.
import { applyDmMutation } from "@/lib/dm/mutations";
import { READIED } from "@/lib/dm/object-actions";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { allyOf, noHit, settle, softenFall, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";

// ---- reaction spells ----

function castReactionSpell(ctx: Ctx, spell: string): Record<string, unknown> | { error: string } {
  // Shield is cast as the hit lands. When that hit dropped the caster, the
  // guard is asked of them as they stood before it, and the sheet is put
  // back exactly as it was for the refund to work from.
  const record = freshLastHit(ctx.campaign.id, ctx.sheet.id);
  const now = getSheetById(ctx.sheet.id);
  const dropped = record && now && record.before.currentHp > 0 && now.currentHp <= 0 ? record.before : null;
  if (!dropped || !now) {
    return castThrough(ctx, spell);
  }
  patchSheet(now.id, { currentHp: dropped.currentHp, conditions: dropped.conditions, conditionMeta: dropped.conditionMeta, deathSaves: dropped.deathSaves });
  const cast = castThrough(ctx, spell);
  patchSheet(now.id, { currentHp: now.currentHp, conditions: now.conditions, conditionMeta: now.conditionMeta, deathSaves: now.deathSaves ?? null });
  return cast;
}

function castThrough(ctx: Ctx, spell: string): Record<string, unknown> | { error: string } {
  return applyDmMutation(
    ctx.campaign,
    ctx.turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: ctx.sheet.id,
      spell,
      ...(ctx.args.level ? { level: ctx.args.level } : {}),
      via: "reaction",
      reason: `${spell} reaction`,
    }),
    ctx.sheets,
    ctx.sheetsById,
  ).result;
}

function spentLine(ctx: Ctx, cast: Record<string, unknown>): string {
  return `${ctx.sheet.name}'s reaction${
    typeof cast.slotLevel === "number" ? ` and a level-${cast.slotLevel} slot are` : " is"
  } spent.`;
}

export function reactionSpell(ctx: Ctx, spellName: string): Record<string, unknown> {
  const { sheet, campaign } = ctx;
  const name = spellName.toLowerCase();

  // Hellish Rebuke answers the creature that damaged the caster with a DEX
  // save and fire, resolved as cast_at_enemy resolves it (the cast guard
  // charges the reaction).
  if (name === "hellish rebuke") {
    const record = freshLastHit(campaign.id, sheet.id);
    const attackerId =
      ctx.args.targetEnemyId ?? (record?.attacker.kind === "enemy" ? (record.attacker.id ?? undefined) : undefined);
    if (!attackerId) {
      return { error: "Hellish Rebuke answers the creature that damaged the caster: pass its targetEnemyId. Nothing was spent." };
    }
    if (!record || record.attacker.id !== attackerId || record.swings.every((swing) => !swing.hit || swing.raw <= 0)) {
      return {
        error: `Hellish Rebuke is cast in response to being damaged by the creature, and the server has no damage to ${sheet.name} from it this turn. Nothing was spent.`,
      };
    }
    return handleCastAtEnemy(
      campaign,
      ctx.turn,
      JSON.stringify({
        characterId: sheet.id,
        targetEnemyId: attackerId,
        spell: spellName,
        saveAbility: "dex",
        halfOnSave: true,
        ...(ctx.args.level ? { level: ctx.args.level } : {}),
        reason: ctx.args.reason ?? "Hellish Rebuke",
      }),
      ctx.sheets,
      ctx.sheetsById,
    );
  }

  // Feather Fall saves a creature from a fall that has just landed.
  if (name === "feather fall") {
    const target = allyOf(ctx) ?? sheet;
    const record = freshLastHit(campaign.id, target.id);
    if (!record || record.source !== "fall") {
      return { error: noHit(target.name, "Feather Fall", `a fall of ${target.name}'s (apply_hazard falling)`) };
    }
    const cast = castReactionSpell(ctx, spellName);
    if ("error" in cast) {
      return cast;
    }
    spendReaction(ctx);
    const settled = softenFall(ctx, target, "feather fall", "all");
    return {
      ok: true,
      reaction: "Feather Fall",
      spent: spentLine(ctx, cast),
      applied: `${target.name} drifts down and lands on their feet: ${settled?.given ?? 0} hit points of falling damage come back. HP ${settled?.hp ?? ""}.`,
    };
  }

  // Shield answers a hit or Magic Missile; Absorb Elements an acid, cold,
  // fire, lightning or thunder hit. Without the trigger nothing is spent.
  if (name === "shield") {
    const record = freshLastHit(campaign.id, sheet.id);
    const hit = record?.source === "attack" && !record.answered.includes("shield") && record.swings.some((swing) => swing.hit);
    if (!hit) {
      return {
        error: `Shield is cast when ${sheet.name} is hit by an attack (or targeted by Magic Missile), and the server has no hit on them this turn to answer. Nothing was spent.`,
      };
    }
  }
  if (name === "absorb elements") {
    const record = freshLastHit(campaign.id, sheet.id);
    const typed = absorbedType(record);
    if (!record || !typed || record.answered.includes("absorb elements")) {
      return {
        error: `Absorb Elements is cast when ${sheet.name} takes acid, cold, fire, lightning or thunder damage, and the server has no such damage to them this turn to answer. Nothing was spent.`,
      };
    }
  }
  // A reaction spell the server has no rule for still needs its trigger
  // named, and is said to be the spell's text.
  const known = ["counterspell", "shield", "absorb elements"];
  if (!known.includes(name) && !(ctx.args.reason ?? "").trim()) {
    return {
      error: `${spellName} is a reaction: name what triggered it in reason (the creature and what it did). The server has no rule of its own for it, so it is cast as the spell's text. Nothing was spent.`,
    };
  }

  // Counterspell's own refusals come before its slot.
  let counter: Counter | null = null;
  if (name === "counterspell") {
    const checked = checkCounterspell(ctx);
    if ("error" in checked) {
      return checked;
    }
    counter = checked;
  }
  const cast = castReactionSpell(ctx, spellName);
  if ("error" in cast) {
    return cast;
  }
  spendReaction(ctx);
  const spent = spentLine(ctx, cast);

  // Shield: +5 AC until the start of their next turn, against the
  // triggering attack too. Every swing of the last attack that the higher
  // AC turns away becomes a miss (a natural 20 still hits).
  if (name === "shield") {
    addSheetCondition(campaign, sheet, "shielded", { untilTurnOf: sheet.id });
    const record = freshLastHit(campaign.id, sheet.id);
    let answered = "";
    if (record && record.source === "attack" && !record.answered.includes("shield")) {
      const corrected = record.swings.map((swing) =>
        swing.hit && swing.natural !== 20 && swing.total < swing.vsAc + 5 ? { ...swing, hit: false, raw: 0 } : swing,
      );
      const turned = corrected.filter((swing, at) => record.swings[at].hit && !swing.hit).length;
      const settled = settle(ctx, record, corrected, "shield");
      answered = turned
        ? ` Against ${record.attacker.name}'s ${record.attack}, ${turned} hit${turned === 1 ? "" : "s"} now miss${turned === 1 ? "es" : ""}: ${settled.given} hit points come back. HP ${settled.hp}.`
        : ` ${record.attacker.name}'s ${record.attack} still hits the higher AC.`;
    }
    const updated = getSheetById(sheet.id) ?? sheet;
    return {
      ok: true,
      reaction: "Shield",
      spent,
      applied: `Shield: +5 AC until the start of their next turn; their AC is now ${acWithEffects(campaign.id, updated)}. The server applied it.${answered}`,
    };
  }

  // Absorb Elements: resistance to the triggering type until the start of
  // their next turn (the triggering damage too), and the first melee hit on
  // their next turn deals 1d6 of it per slot level (condition-effects.ts
  // absorbed strike).
  if (name === "absorb elements") {
    const record = freshLastHit(campaign.id, sheet.id)!;
    const type = absorbedType(record)!;
    const slot = typeof cast.slotLevel === "number" ? cast.slotLevel : 1;
    const resisted = pcResistances(sheet).toLowerCase().includes(type);
    let applied = `Absorb Elements: resistance to ${type} until the start of ${sheet.name}'s next turn, and the first melee hit on their next turn deals ${slot}d6 ${type} more.`;
    if (!resisted) {
      const settled = settle(
        ctx,
        record,
        record.swings.map((swing) => ((swing.type ?? record.type).toLowerCase() === type ? { ...swing, raw: Math.floor(swing.raw / 2) } : swing)),
        "absorb elements",
      );
      applied += ` ${settled.given} hit points come back. HP ${settled.hp}.`;
    }
    const now = getSheetById(sheet.id) ?? sheet;
    addSheetCondition(campaign, now, `absorb elements (${type})`, { untilTurnOf: sheet.id }, "Absorb Elements");
    addSheetCondition(campaign, getSheetById(sheet.id) ?? now, `absorbed strike (${slot}d6 ${type})`, { untilTurnEndOf: sheet.id }, "Absorb Elements");
    return { ok: true, reaction: "Absorb Elements", spent, applied };
  }

  if (name === "counterspell" && counter) {
    return finishCounterspell(ctx, counter, cast, spent);
  }
  return {
    ok: true,
    reaction: spellName,
    spent,
    ...(cast.droppedConcentration ? { droppedConcentration: cast.droppedConcentration } : {}),
    note: `${spellName} is cast; its effect is the spell's text.`,
  };
}

// The elemental type a recorded hit dealt, for Absorb Elements: the hit's
// own, or the first swing of an elemental type that landed.
function absorbedType(record: ReturnType<typeof freshLastHit>): string | null {
  if (!record) {
    return null;
  }
  const types = [record.type, ...record.swings.filter((swing) => swing.hit && swing.raw > 0).map((swing) => swing.type ?? "")];
  const found = types.map((entry) => (entry ?? "").toLowerCase()).find((entry) => /^(acid|cold|fire|lightning|thunder)$/.test(entry));
  return found ?? null;
}

// ---- Counterspell ----

type Counter = {
  enemy: EncounterEnemy;
  spell: string;
  // The level of the slot it is cast with (a cantrip and an innate use: the
  // spell's own).
  level: number;
  // How the creature pays for it: the slot or use the cast takes, and the
  // action, bonus action, reaction or legendary cantrip it costs.
  spend: (ledger: AbilityLedger | undefined) => AbilityLedger | undefined;
  timing: "action" | "bonus" | "reaction" | "legendary";
};

// Everything that can refuse a Counterspell, before the slot is spent: the
// creature named, the spell its block lists, a spell not yet resolved (the
// action, bonus action or reaction it costs not yet taken this round), a
// caster who can see it, and 60 ft.
function checkCounterspell(ctx: Ctx): Counter | { error: string } {
  const { encounter, args, sheet } = ctx;
  const enemy = encounter && args.targetEnemyId ? resolveEnemyRef(encounter.id, args.targetEnemyId) : null;
  if (!encounter || !enemy || enemy.status !== "alive") {
    return { error: "Counterspell answers a creature casting a spell: pass its targetEnemyId and the spell. Nothing was spent." };
  }
  const wanted = (args.spell ?? "").trim();
  if (!wanted) {
    return { error: `Counterspell needs the spell ${enemy.displayName} is casting (spell), so the server knows its level. Nothing was spent.` };
  }
  // Only a spell the creature can cast: its block's list.
  const casting = enemy.stats.spellcasting;
  const listed = findMonsterSpell(casting, wanted);
  const innate = (enemy.stats.spells ?? []).find((name) => name.toLowerCase() === wanted.toLowerCase());
  if (!listed && !innate) {
    return { error: `${enemy.displayName}'s stat block lists no ${wanted}; Counterspell answers a spell the creature is casting. Nothing was spent.` };
  }
  const facts = spellFactsFor(wanted);
  const own = listed?.level ?? facts?.level ?? null;
  if (own === null) {
    return { error: `The server does not know the level of "${wanted}"; name the spell as its stat block lists it. Nothing was spent.` };
  }
  // A caster who cannot see the creature cannot target it.
  if (sheet.conditions.some((entry) => entry.toLowerCase() === "blinded")) {
    return { error: `${sheet.name} is blinded: Counterspell needs a creature they can see. Nothing was spent.` };
  }
  const unseen = enemy.conditions.some((entry) => entry.toLowerCase() === "invisible") && !seesInvisible(sheet);
  if (unseen) {
    return { error: `${enemy.displayName} is invisible to ${sheet.name}: Counterspell needs a creature they can see. Nothing was spent.` };
  }
  const apart = tilesBetween(encounter.id, sheet.id, enemy.id);
  if (apart !== null && apart > 12) {
    return { error: `${enemy.displayName} is ${apart * 5} ft away; Counterspell reaches a creature within 60 ft. Nothing was spent.` };
  }
  // What the cast costs the creature, and whether it has already been paid
  // (a spell already resolved cannot be countered).
  const ledger = encounter.legendary.abilities?.[enemy.id];
  const timing: Counter["timing"] =
    own === 0 && boughtByLegendary(encounter, enemy.id).includes("cantrip")
      ? "legendary"
      : facts?.castingTime === "bonus"
        ? "bonus"
        : facts?.castingTime === "reaction"
          ? "reaction"
          : "action";
  const paid =
    timing === "action"
      ? enemyActedThisRound(encounter, enemy.id)
      : timing === "bonus"
        ? encounter.legendary.bonus?.round === encounter.round && encounter.legendary.bonus.ids.includes(enemy.id)
        : timing === "reaction"
          ? encounter.reactionsUsed.includes(enemy.id)
          : false;
  if (paid) {
    return {
      error: `${enemy.displayName} has already taken its ${timing === "bonus" ? "bonus action" : timing} this round; a spell already resolved cannot be countered. Call Counterspell before resolving the enemy's spell. Nothing was spent.`,
    };
  }
  let level = own;
  let spend: Counter["spend"] = (next) => next;
  if (listed?.perDay) {
    if (spellUsesLeft(ledger, listed) <= 0) {
      return { error: `${enemy.displayName} has no use of ${wanted} left today; it cannot be casting it. Nothing was spent.` };
    }
    spend = (next) => spendSpellUse(next, listed.name);
  } else if (own > 0 && listed && listed.level !== null && casting && Object.keys(casting.slots).length) {
    const slot = slotFor(casting, ledger, own);
    if (slot === null) {
      return { error: `${enemy.displayName} has no spell slot left for ${wanted}; it cannot be casting it. Nothing was spent.` };
    }
    level = slot;
    spend = (next) => spendSlot(next, slot);
  }
  return { enemy, spell: wanted, level, spend, timing };
}

// See Invisibility, True Seeing or a truesight sense lets a caster see an
// invisible creature.
function seesInvisible(sheet: Ctx["sheet"]): boolean {
  const lines = [...sheet.conditions, ...sheet.features.map((feature) => feature.name)].join(" ").toLowerCase();
  return /see invisibility|true seeing|truesight|blindsight/.test(lines);
}

// The ability Counterspell's check is made with: the spellcasting ability of
// the class it is cast from (SRD 5.1: sorcerer, warlock, wizard), the
// sheet's own when it is one of them.
const COUNTERSPELL_CLASSES: Record<string, string> = { sorcerer: "cha", warlock: "cha", wizard: "int" };
function counterspellAbility(sheet: Ctx["sheet"]): string {
  const primary = sheet.spellcasting?.ability ?? "int";
  const holders = [sheet.class, ...(sheet.classes ?? []).map((entry) => entry.id)]
    .map((id) => COUNTERSPELL_CLASSES[(id ?? "").toLowerCase()])
    .filter((ability): ability is string => Boolean(ability));
  return !holders.length || holders.includes(primary) ? primary : holders[0];
}

// A spell of the slot's level or lower fails; a higher one fails on an
// ability check with the caster's spellcasting ability, DC 10 + its level.
// A countered spell is spent all the same: the creature's slot or use goes,
// and so does the action, bonus action, reaction or legendary cantrip it was
// cast with, so the engine refuses the cast that would have followed.
function finishCounterspell(
  ctx: Ctx,
  counter: Counter,
  cast: Record<string, unknown>,
  spent: string,
): Record<string, unknown> {
  const slot = typeof cast.slotLevel === "number" ? cast.slotLevel : 3;
  let countered = counter.level <= slot;
  let check: string | undefined;
  if (!countered) {
    const dc = 10 + counter.level;
    const ability = counterspellAbility(ctx.sheet);
    const rolled = rollCharacterCheck(ctx.campaign, ctx.sheet, { ability: ability as "int" }, `${ctx.sheet.name}: Counterspell against ${counter.spell}`);
    if (rolled.rollId) {
      ctx.turn.rollIds.push(rolled.rollId);
    }
    countered = !rolled.autoFailed && rolled.total >= dc;
    check = `${ability.toUpperCase()} check ${rolled.total} against DC ${dc}`;
  }
  if (countered) {
    const live = getActiveEncounter(ctx.campaign.id);
    if (live) {
      const abilities = { ...(live.legendary.abilities ?? {}) };
      let ledger = counter.spend(abilities[counter.enemy.id]);
      if (counter.timing === "legendary") {
        const bought = ledger?.bought ?? [];
        const at = bought.indexOf("cantrip");
        ledger = { ...(ledger ?? {}), bought: bought.filter((_, index) => index !== at) };
      } else if (counter.timing === "bonus") {
        const used = live.legendary.bonus?.round === live.round ? live.legendary.bonus.ids : [];
        live.legendary.bonus = { round: live.round, ids: [...used, counter.enemy.id] };
      } else if (counter.timing === "reaction") {
        live.reactionsUsed = [...live.reactionsUsed, counter.enemy.id];
      } else {
        spendEnemyAction(live, counter.enemy.id);
      }
      if (ledger) {
        abilities[counter.enemy.id] = ledger;
      }
      live.legendary.abilities = abilities;
      saveEncounter(live);
    }
  }
  const paid = counter.timing === "bonus" ? "its bonus action" : counter.timing === "reaction" ? "its reaction" : counter.timing === "legendary" ? "the legendary action that bought it" : "its action for the round";
  return {
    ok: true,
    reaction: "Counterspell",
    spent,
    ...(check ? { check } : {}),
    countered,
    applied: countered
      ? `${counter.enemy.displayName}'s ${counter.spell} fails: the ${counter.level ? `level-${counter.level} slot` : "casting"} and ${paid} are spent, and the server will refuse the cast. Do not resolve the spell.`
      : `${counter.enemy.displayName}'s ${counter.spell} goes ahead; resolve it as it is cast.`,
  };
}

// ---- opportunity attacks ----

export function opportunity(ctx: Ctx): Record<string, unknown> {
  const { campaign, encounter, sheet, args } = ctx;
  if (!encounter) {
    return { error: "Opportunity attacks happen in a fight; there is no active encounter." };
  }
  if (getBattleMapForEncounter(encounter.id)) {
    return {
      error: `On the battle map the server rolls opportunity attacks itself the moment an enemy leaves ${sheet.name}'s reach (and reports them on the move). Nothing was spent; do not call pc_attack for one either.`,
    };
  }
  if (!args.targetEnemyId) {
    return {
      error: "Off the battle map, an opportunity attack needs the enemy leaving the character's reach: pass its targetEnemyId. Nothing was spent.",
    };
  }
  // One melee attack with the reaction, through pc_attack's own rules. The
  // readied mark is what lets the off-turn attack through; the attack
  // spends it and the reaction.
  addSheetCondition(campaign, sheet, READIED, { untilTurnOf: sheet.id }, "opportunity attack");
  const result = handlePcAttack(
    campaign,
    ctx.turn,
    JSON.stringify({ characterId: sheet.id, targetEnemyId: args.targetEnemyId }),
    ctx.sheets,
    ctx.sheetsById,
    new Set(),
    null,
  );
  const after = getSheetById(sheet.id);
  if (after?.conditions.some((entry) => entry.toLowerCase() === READIED)) {
    const cleared = removeConditions(after.conditions, after.conditionMeta, [READIED]);
    patchSheet(after.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  }
  return "error" in result ? result : { ...result, reaction: "Opportunity attack" };
}

