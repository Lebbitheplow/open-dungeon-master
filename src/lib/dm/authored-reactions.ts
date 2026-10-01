// use_reaction on an authored subclass feature (src/lib/srd/authored-effects-data*.ts,
// `reactions`), resolved by the engine the way Uncanny Dodge and Cutting Words
// are: a reaction to a hit re-resolves that attack from the engine's record of
// it (src/lib/dm/last-hit.ts) and gives back what the feature gives back
// (reaction-refund.ts); a reaction that strikes back rolls and lands its
// damage; a reaction attack is one pc_attack with the reaction. Only a holder
// of the feature (or, for Voice of Authority, Inspiring Surge, Protective Bond
// and Combat Inspiration, the ally it serves) takes it, and a refusal spends
// nothing.
//
// Before this every one of them fell to use_reaction's last branch: the
// reaction was spent and the effect was "resolved from its own text".

import { getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import {
  authoredReactionNamed,
  gateHolds,
  heldAuthored,
  resolveFormula,
  type AuthoredReaction,
  type HeldAuthored,
} from "@/lib/srd/authored-effects";
import { addSheetCondition, rollCard } from "@/lib/dm/action-common";
import { pcResistances, removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { freshLastHit, type LastHit, type SwingRecord } from "@/lib/dm/last-hit";
import { READIED } from "@/lib/dm/object-actions";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { handlePcAttack } from "@/lib/dm/pc-attack";
import { allyOf, noHit, settle, SPENT, spendReaction, type Ctx } from "@/lib/dm/reaction-tools";
import { withinFeet } from "@/lib/dm/authored-saves";
import { resolveMoreReaction } from "@/lib/dm/authored-reactions-more";
import { projectWard } from "@/lib/dm/arcane-ward";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

type Found = { reaction: AuthoredReaction; held: HeldAuthored; holder: CharacterSheet; variant: string };

// The authored reaction a use_reaction call names, for the character taking
// it: their own feature, or an ally's feature that serves them. The feature
// may carry its option after the name ("Raging Storm tundra").
function findReaction(ctx: Ctx): Found | null | { error: string } {
  const asked = lower(ctx.args.feature);
  const split = (name: string) => (asked === lower(name) || asked.startsWith(`${lower(name)} `) || asked.startsWith(`${lower(name)} (`) ? asked.slice(name.length).replace(/[()]/g, "").trim() : null);
  for (const held of heldAuthored(ctx.sheet)) {
    for (const reaction of held.entry.reactions ?? []) {
      for (const name of [reaction.name, ...(reaction.aliases ?? [])]) {
        const variant = split(name);
        if (variant !== null && (reaction.usedBy ?? "holder") === "holder") {
          return { reaction, held, holder: ctx.sheet, variant };
        }
      }
    }
  }
  const named = authoredReactionNamed(asked.replace(/\s*\(.*$/, ""));
  if (!named) {
    return null;
  }
  if ((named.reaction.usedBy ?? "holder") === "holder") {
    return { error: `${ctx.sheet.name} does not have ${named.reaction.name}; only its holder takes that reaction. Nothing was spent.` };
  }
  // A reaction the feature gives an ally: someone at the table holds it.
  for (const stale of listSheets(ctx.campaign.id)) {
    const holder = getSheetById(stale.id) ?? stale;
    const held = heldAuthored(holder).find((entry) => entry.key === named.row.key);
    if (held && !holder.deathSaves?.dead) {
      return { reaction: named.reaction, held, holder, variant: "" };
    }
  }
  return { error: `Nobody at the table has ${named.reaction.name}, so ${ctx.sheet.name} cannot answer with it. Nothing was spent.` };
}

function heaviest(swings: SwingRecord[], which: (swing: SwingRecord) => boolean = () => true): number {
  let best = -1;
  swings.forEach((swing, index) => {
    if (swing.hit && which(swing) && (best < 0 || swing.raw > swings[best].raw)) {
      best = index;
    }
  });
  return best;
}

function lastHitOn(ctx: Ctx, target: CharacterSheet, label: string): { record: LastHit; index: number } | { error: string } {
  const record = freshLastHit(ctx.campaign.id, target.id);
  const index = record && record.source === "attack" && !record.answered.includes(label) ? heaviest(record.swings) : -1;
  if (!record || index < 0) {
    return { error: noHit(target.name, label) };
  }
  return { record, index };
}

function modsOf(sheet: CharacterSheet) {
  return computeSheetDerived(sheet).abilityMods;
}

function saveDc(holder: CharacterSheet, ability: string): number {
  const derived = computeSheetDerived(holder);
  if (ability === "spell") {
    return derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha);
  }
  return 8 + derived.proficiencyBonus + (derived.abilityMods[ability as keyof typeof derived.abilityMods] ?? 0);
}

function reachFeet(range: number | Array<[number, number]>, level: number): number {
  if (typeof range === "number") {
    return range;
  }
  let feet = range[0]?.[1] ?? 5;
  for (const [at, value] of range) {
    if (level >= at) {
      feet = value;
    }
  }
  return feet;
}

function enemyTarget(ctx: Ctx, fallbackId: string | null): EncounterEnemy | null {
  const encounter = ctx.encounter;
  const ref = ctx.args.targetEnemyId ?? fallbackId;
  if (!encounter || !ref) {
    return null;
  }
  const enemy = resolveEnemyRef(encounter.id, ref);
  return enemy && enemy.status === "alive" ? enemy : null;
}

function psionicDie(level: number): string {
  return level >= 17 ? "1d12" : level >= 11 ? "1d10" : level >= 5 ? "1d8" : "1d6";
}

// The authored reaction this call names, resolved; null when the call names
// none of them and use_reaction's own branches decide.
export function authoredReaction(ctx: Ctx): Record<string, unknown> | null {
  const found = findReaction(ctx);
  if (!found) {
    return null;
  }
  if ("error" in found) {
    return found;
  }
  const { reaction, held, holder } = found;
  if (!gateHolds(reaction.gate, holder, held)) {
    return { error: `${reaction.name} is not open to ${holder.name} right now (${reaction.gate?.raging ? "only while raging" : reaction.gate?.condition ? `only while ${reaction.gate.condition} holds` : "its condition is not met"}). Nothing was spent.` };
  }
  // The pool: a counter, or a spell slot of the level asked for.
  let paid: (() => void) | null = null;
  if (reaction.pool && "slot" in reaction.pool) {
    const level = ctx.args.level ?? 1;
    const slot = ctx.sheet.spellcasting?.slots?.[String(level)];
    if (!slot || slot.used >= slot.max) {
      return { error: `${ctx.sheet.name} has no unspent level-${level} spell slot for ${reaction.name}. Nothing was spent.` };
    }
    paid = () => {
      const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
      const slots = { ...now.spellcasting!.slots, [String(level)]: { max: slot.max, used: slot.used + 1 } };
      const updated = patchSheet(now.id, { spellcasting: { ...now.spellcasting!, slots } });
      if (updated) publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
    };
  } else if (reaction.pool) {
    const pool = reaction.pool;
    const state = holder.resources?.[pool.id];
    const amount = pool.amount ?? 1;
    if (!state || state.max - state.used < amount) {
      return { error: `${holder.name} has nothing left to spend on ${reaction.name} (${pool.id.replace(/^sub_/, "").replace(/_/g, " ")}). Nothing was spent.` };
    }
    paid = () => {
      const now = getSheetById(holder.id) ?? holder;
      const current = now.resources[pool.id];
      const updated = patchSheet(now.id, { resources: { ...now.resources, [pool.id]: { max: current.max, used: current.used + amount } } });
      if (updated) publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
    };
  }
  const outcome = resolve(ctx, found);
  if ("error" in outcome) {
    return outcome;
  }
  paid?.();
  spendReaction(ctx);
  return { ok: true, reaction: reaction.name, spent: SPENT(ctx.sheet.name), ...outcome };
}

function resolve(ctx: Ctx, found: Found): Record<string, unknown> | { error: string } {
  const { reaction, held, holder } = found;
  const does = reaction.does;
  const label = lower(reaction.name);
  const encounter = ctx.encounter;
  switch (does.kind) {
    case "reduce": {
      const ally = allyOf(ctx);
      const target = does.who === "self" ? ctx.sheet : does.who === "ally" ? ally : (ally ?? ctx.sheet);
      if (!target || (does.who === "ally" && target.id === ctx.sheet.id)) {
        return { error: `${reaction.name} protects another creature: pass the ally's targetCharacterId. Nothing was spent.` };
      }
      if (does.rangeFt && encounter && target.id !== ctx.sheet.id && !withinFeet(encounter.id, ctx.sheet.id, target.id, does.rangeFt)) {
        return { error: `${target.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.` };
      }
      const hit = lastHitOn(ctx, target, label);
      if ("error" in hit) return hit;
      const swing = hit.record.swings[hit.index];
      if (does.types && !does.types.includes(lower(swing.type ?? hit.record.type))) {
        return { error: `${reaction.name} answers ${does.types.join(", ")} damage, and the hit on ${target.name} was ${swing.type ?? hit.record.type}. Nothing was spent.` };
      }
      let reduction: number;
      let rolled = "";
      if (does.amount === "half") {
        reduction = Math.ceil(swing.raw / 2);
      } else if (does.amount === "ward") {
        // Projected Ward: the Arcane Ward takes what it can hold (arcane-ward.ts).
        const held = projectWard(ctx.campaign, holder, swing.raw);
        if (!held) {
          return { error: `${holder.name}'s Arcane Ward has no hit points to give (it rises with an abjuration spell of 1st level or higher). Nothing was spent.` };
        }
        reduction = held;
      } else if (does.amount === "slot5") {
        reduction = 5 * (ctx.args.level ?? 1);
      } else {
        const expression = does.amount === "psionic_int" ? `${psionicDie(held.level)}+${modsOf(holder).int}` : resolveFormula(does.amount, held.level, modsOf(holder));
        reduction = Math.max(0, rollCard(ctx.campaign, ctx.turn, holder.id, "custom", `${holder.name}: ${reaction.name}`, expression).total);
        rolled = `${expression}: ${reduction}`;
      }
      const corrected = hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, raw: Math.max(0, entry.raw - reduction) } : entry));
      const settled = settle(ctx, hit.record, corrected, label);
      return { ...(rolled ? { rolled } : {}), applied: `${reaction.name} takes ${reduction} off the ${hit.record.attack} hit on ${target.name}: ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "ac_vs_hit": {
      let bonus: number;
      let spentDie: string | null = null;
      if (does.amount === "bardic") {
        spentDie = ctx.sheet.conditions.find((entry) => /^bardic inspiration \(d\d+\)$/i.test(entry)) ?? null;
        if (!spentDie) {
          return { error: `${ctx.sheet.name} holds no Bardic Inspiration die to add to their AC. Nothing was spent.` };
        }
        const die = /\((d\d+)\)/i.exec(spentDie)![1];
        bonus = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${reaction.name}`, `1${die}`).total;
      } else {
        bonus = does.amount;
      }
      const hit = lastHitOn(ctx, ctx.sheet, label);
      if ("error" in hit) return hit;
      const swing = hit.record.swings[hit.index];
      const missed = swing.natural !== 20 && swing.total < swing.vsAc + bonus;
      if (spentDie) {
        const cleared = removeConditions(ctx.sheet.conditions, ctx.sheet.conditionMeta, [spentDie]);
        patchSheet(ctx.sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
      }
      if (!missed) {
        return { applied: `AC ${swing.vsAc} + ${bonus} against ${swing.total}: the hit still lands.` };
      }
      const corrected = hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry));
      const settled = settle(ctx, hit.record, corrected, label);
      return { applied: `AC ${swing.vsAc} + ${bonus} turns the ${swing.total} into a miss: ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "disadv_vs_hit": {
      const hit = lastHitOn(ctx, ctx.sheet, label);
      if ("error" in hit) return hit;
      const swing = hit.record.swings[hit.index];
      if (swing.natural === null) {
        return { error: `${reaction.name} answers an attack roll, and this hit had none on record. Nothing was spent.` };
      }
      const kept =
        swing.advantage === "disadvantage"
          ? swing.natural
          : swing.advantage === "advantage"
            ? (swing.faces[0] ?? swing.natural)
            : Math.min(swing.natural, rollCard(ctx.campaign, ctx.turn, null, "attack", `${hit.record.attacker.name}: the attack again, at disadvantage (${reaction.name})`, "1d20").total);
      const total = swing.total - swing.natural + kept;
      const missed = kept !== 20 && (kept === 1 || total < swing.vsAc);
      if (!missed) {
        return { applied: `Rolled again at disadvantage: ${total} against AC ${swing.vsAc} still hits.` };
      }
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      return { applied: `Rolled again at disadvantage: ${total} against AC ${swing.vsAc} misses, and ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "resist_instance": {
      const target = allyOf(ctx) ?? ctx.sheet;
      if (encounter && target.id !== ctx.sheet.id && !withinFeet(encounter.id, ctx.sheet.id, target.id, does.rangeFt)) {
        return { error: `${target.name} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.` };
      }
      const hit = lastHitOn(ctx, target, label);
      if ("error" in hit) return hit;
      const type = lower(hit.record.swings[hit.index].type ?? hit.record.type);
      if (!does.types.includes(type)) {
        return { error: `${reaction.name} answers ${does.types.join(", ")} damage; the hit on ${target.name} was ${type || "untyped"}. Nothing was spent.` };
      }
      if (pcResistances(target).includes(type)) {
        return { error: `${target.name} already resists ${type} damage. Nothing was spent.` };
      }
      const corrected = hit.record.swings.map((entry) => (lower(entry.type ?? hit.record.type) === type && entry.hit ? { ...entry, raw: Math.floor(entry.raw / 2) } : entry));
      const settled = settle(ctx, hit.record, corrected, label);
      return { applied: `${target.name} resists this ${type} damage: ${settled.given} hit points come back. HP ${settled.hp}.` };
    }
    case "take_for_ally": {
      const ally = allyOf(ctx);
      if (!ally || ally.id === ctx.sheet.id) {
        return { error: `${reaction.name} takes the hit an ally took: pass the ally's targetCharacterId. Nothing was spent.` };
      }
      const feet = reachFeet(does.rangeFt, held.level);
      if (encounter && !withinFeet(encounter.id, ctx.sheet.id, ally.id, feet)) {
        return { error: `${ally.name} is beyond ${feet} feet of ${ctx.sheet.name}. Nothing was spent.` };
      }
      const record = freshLastHit(ctx.campaign.id, ally.id);
      if (!record || record.source !== "attack" || record.answered.includes(label) || !record.swings.some((swing) => swing.hit)) {
        return { error: noHit(ally.name, reaction.name, `an attack that hit ${ally.name}`) };
      }
      const raw = record.swings.filter((swing) => swing.hit).reduce((sum, swing) => sum + swing.raw, 0);
      const settled = settle(ctx, record, record.swings.map((swing) => ({ ...swing, hit: false, raw: 0 })), label);
      // The damage lands on the paladin as it was dealt: nothing reduces it.
      const taken = applyPcDamage(ctx.campaign, ctx.turn.id, getSheetById(ctx.sheet.id) ?? ctx.sheet, { amount: raw, reason: `${reaction.name} for ${ally.name}` });
      return { applied: `${ctx.sheet.name} takes the ${raw} damage meant for ${ally.name}, whose ${settled.given} hit points come back.`, taken };
    }
    case "strike_back": {
      const record = freshLastHit(ctx.campaign.id, ctx.sheet.id);
      const enemy = enemyTarget(ctx, record?.attacker.kind === "enemy" ? record.attacker.id : null);
      if (!enemy || !encounter) {
        return { error: `${reaction.name} strikes a creature in the fight: pass targetEnemyId. Nothing was spent.` };
      }
      if (does.melee && record && record.attacker.id !== enemy.id) {
        return { error: `${reaction.name} answers the creature whose melee attack just hit ${ctx.sheet.name}. Nothing was spent.` };
      }
      if (does.melee && (!record || record.ranged || !record.swings.some((swing) => swing.hit))) {
        return { error: noHit(ctx.sheet.name, reaction.name, "a melee attack that hit them") };
      }
      if (does.rangeFt && !withinFeet(encounter.id, ctx.sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}. Nothing was spent.` };
      }
      const expression = resolveFormula(does.amount, held.level, modsOf(holder));
      let amount = rollCard(ctx.campaign, ctx.turn, holder.id, "damage", `${holder.name}: ${reaction.name}`, expression).total;
      const out: Record<string, unknown> = { rolled: `${expression}: ${amount}` };
      if (does.save) {
        const dc = saveDc(holder, does.save.dcAbility);
        const save = rollEnemySave(ctx.campaign.id, enemy, does.save.ability, dc, {
          magical: true,
          record: { turn: ctx.turn, detail: `${enemy.displayName}: ${does.save.ability.toUpperCase()} save against ${reaction.name}` },
        });
        out.save = `${save.total ?? "failed"} vs DC ${dc}`;
        if (save.success && !does.save.damageRegardless) {
          amount = does.save.half ? Math.floor(amount / 2) : 0;
        }
        if (!save.success && does.save.onFail) {
          out.onFail = `${enemy.displayName} ${does.save.onFail}.`;
        }
      }
      if (amount > 0) {
        Object.assign(out, applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, amount, ctx.sheets, ctx.sheetsById, does.type, { magical: true }));
        publishEncounter(ctx.campaign.id);
      }
      return out;
    }
    case "attack": {
      const enemy = enemyTarget(ctx, null);
      if (!enemy || !encounter) {
        return { error: `${reaction.name} is one weapon attack at a creature in the fight: pass targetEnemyId. Nothing was spent.` };
      }
      if (!withinFeet(encounter.id, ctx.sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${ctx.sheet.name}; ${reaction.name} is a melee attack. Nothing was spent.` };
      }
      addSheetCondition(ctx.campaign, ctx.sheet, READIED, { untilTurnOf: ctx.sheet.id }, reaction.name);
      const result = handlePcAttack(ctx.campaign, ctx.turn, JSON.stringify({ characterId: ctx.sheet.id, targetEnemyId: enemy.id }), ctx.sheets, ctx.sheetsById, new Set(), null);
      const after = getSheetById(ctx.sheet.id);
      if (after?.conditions.some((entry) => entry.toLowerCase() === READIED)) {
        const cleared = removeConditions(after.conditions, after.conditionMeta, [READIED]);
        patchSheet(after.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
      }
      if ("error" in result) {
        return { error: String(result.error) };
      }
      if (does.onHitCondition && result.hit) {
        const fresh = getEnemy(enemy.id);
        if (fresh && fresh.status === "alive") {
          patchEnemyConditions(fresh.id, [...fresh.conditions, does.onHitCondition.name], {
            ...(fresh.conditionMeta as ConditionMetaMap),
            [does.onHitCondition.name]: { rounds: does.onHitCondition.rounds, source: ctx.sheet.id },
          } as typeof fresh.conditionMeta);
          publishEncounter(ctx.campaign.id);
        }
      }
      return { attack: result };
    }
    case "save_condition": {
      const record = freshLastHit(ctx.campaign.id, ctx.sheet.id);
      const enemy = enemyTarget(ctx, record?.attacker.kind === "enemy" ? record.attacker.id : null);
      if (!enemy || !encounter) {
        return { error: `${reaction.name} answers a creature in the fight: pass targetEnemyId. Nothing was spent.` };
      }
      const condition = (does.variants && Object.entries(does.variants).find(([key]) => found.variant.includes(key))?.[1]) ?? does.condition;
      const dc = saveDc(holder, does.dcAbility);
      const save = rollEnemySave(ctx.campaign.id, enemy, does.save, dc, {
        magical: true,
        record: { turn: ctx.turn, detail: `${enemy.displayName}: ${does.save.toUpperCase()} save against ${reaction.name}` },
      });
      if (save.success) {
        return { applied: `${enemy.displayName} resists (${does.save.toUpperCase()} ${save.total} vs DC ${dc}).` };
      }
      patchEnemyConditions(enemy.id, [...enemy.conditions.filter((entry) => lower(entry) !== condition), condition], {
        ...(enemy.conditionMeta as ConditionMetaMap),
        [condition]: { source: ctx.sheet.id, ...(does.rounds ? { rounds: does.rounds } : { untilTurnOf: ctx.sheet.id }) },
      } as typeof enemy.conditionMeta);
      publishEncounter(ctx.campaign.id);
      return { applied: `${enemy.displayName} fails the ${does.save.toUpperCase()} save (${save.total ?? "failed"} vs DC ${dc}) and is ${condition}.` };
    }
    case "gain_condition": {
      addSheetCondition(ctx.campaign, ctx.sheet, does.condition, { rounds: does.rounds }, reaction.name);
      return { applied: `${ctx.sheet.name} gains ${does.condition}.` };
    }
    case "attack_penalty": {
      const target = allyOf(ctx) ?? ctx.sheet;
      const hit = lastHitOn(ctx, target, label);
      if ("error" in hit) return hit;
      const die = rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "custom", `${ctx.sheet.name}: ${reaction.name}`, does.die).total;
      const swing = hit.record.swings[hit.index];
      if (swing.natural === 20 || swing.total - die >= swing.vsAc) {
        return { rolled: die, applied: `The attack falls to ${swing.total - die} and still hits AC ${swing.vsAc}.` };
      }
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      return { rolled: die, applied: `The attack falls to ${swing.total - die} against AC ${swing.vsAc} and misses: ${settled.given} hit points come back to ${target.name}.` };
    }
    case "redirect": {
      const hit = lastHitOn(ctx, ctx.sheet, label);
      if ("error" in hit) return hit;
      const enemy = enemyTarget(ctx, null);
      if (!enemy || !encounter) {
        return { error: `${reaction.name} turns the attack onto the creature beside ${ctx.sheet.name}: pass its targetEnemyId. Nothing was spent.` };
      }
      if (!withinFeet(encounter.id, ctx.sheet.id, enemy.id, 5)) {
        return { error: `${enemy.displayName} is not within 5 feet of ${ctx.sheet.name}. Nothing was spent.` };
      }
      const swing = hit.record.swings[hit.index];
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      const applied = applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, swing.raw, ctx.sheets, ctx.sheetsById, swing.type ?? hit.record.type);
      publishEncounter(ctx.campaign.id);
      return { applied: `The blow lands on ${enemy.displayName} instead: ${settled.given} hit points come back to ${ctx.sheet.name}.`, redirected: applied };
    }
    case "force_miss": {
      const target = allyOf(ctx) ?? ctx.sheet;
      const hit = lastHitOn(ctx, target, label);
      if ("error" in hit) return hit;
      const settled = settle(ctx, hit.record, hit.record.swings.map((entry, at) => (at === hit.index ? { ...entry, hit: false, raw: 0 } : entry)), label);
      const now = getSheetById(ctx.sheet.id) ?? ctx.sheet;
      const updated = patchSheet(now.id, { exhaustion: Math.min(6, (now.exhaustion ?? 0) + does.exhaustion) });
      if (updated) {
        publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
      }
      return { applied: `The attack misses by the wizard's word: ${settled.given} hit points come back to ${target.name}. ${ctx.sheet.name} gains ${does.exhaustion} level of exhaustion.` };
    }
    // Skirmisher's move, Tipsy Sway (src/lib/dm/authored-reactions-more.ts).
    case "move":
    case "redirect_miss":
      return resolveMoreReaction(ctx, reaction);
  }
}
