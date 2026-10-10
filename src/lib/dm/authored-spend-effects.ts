// What an authored spend does once it is paid for (src/lib/dm/authored-spends.ts
// has checked the gate, the pool and the turn). Each resolver refuses before
// it writes; the caller then spends the pool and the turn.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter } from "@/lib/db/battle-maps";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import { resolveFormula, type AuthoredSpend, type HeldAuthored } from "@/lib/srd/authored-effects";
import type { Ability, SpendDoes } from "@/lib/srd/authored-effects-types";
import { STORM_AURA } from "@/lib/srd/authored-effects-data";
import { effectiveMaxHp, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { healDeathHook } from "@/lib/dm/death";
import { applyEnemyDamage, publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { bindsWorthResisting } from "@/lib/dm/legendary-logic";
import { hurtEnemy } from "@/lib/dm/spell-aura";
import { withinFeet } from "@/lib/dm/authored-saves";
import { rerollLastSave, swarmPush } from "@/lib/dm/authored-spend-more";
import { summonSteelDefender } from "@/lib/dm/summon-defender";
import type { CharacterSheet, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { rollCard, sheetAttacker } from "@/lib/dm/roll-card";
import { rollAgainst } from "@/lib/roll-labels";

// A spend's damage on one enemy, as the holder's dice card.
const damageDice = (ctx: SpendContext, enemy: EncounterEnemy, dice: string) =>
  rollCard(ctx.campaign, ctx.turn, ctx.sheet.id, "damage", rollAgainst(ctx.spend.name, enemy.displayName), dice, sheetAttacker(ctx.sheet)).total;

export type SpendContext = {
  campaign: Campaign;
  turnId: string;
  turn: DmTurn | null;
  encounter: Encounter | null;
  sheet: CharacterSheet;
  held: HeldAuthored;
  spend: AuthoredSpend;
  args: { amount?: number; variant?: string; targetCharacterId?: string; targetEnemyId?: string };
  units: number;
  mods: Record<string, number>;
  reason: string;
};

type Resolution = { error: string } | { patch?: FullPatchSheetInput; result: Record<string, unknown> };

const lower = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();

function formula(ctx: SpendContext, value: Parameters<typeof resolveFormula>[0]): string {
  return resolveFormula(value, ctx.held.level, ctx.mods);
}

// The save DC a feature sets: the spell save DC, or 8 + proficiency + the
// named ability's modifier.
function saveDc(ctx: SpendContext, ability: Ability | "spell"): number {
  const derived = computeSheetDerived(ctx.sheet);
  if (ability === "spell") {
    return derived.spellSaveDc ?? 8 + derived.proficiencyBonus + Math.max(derived.abilityMods.int, derived.abilityMods.wis, derived.abilityMods.cha);
  }
  return 8 + derived.proficiencyBonus + derived.abilityMods[ability];
}

function bardicDie(level: number): string {
  return level >= 15 ? "d12" : level >= 10 ? "d10" : level >= 5 ? "d8" : "d6";
}

function conditionName(ctx: SpendContext, does: Extract<SpendDoes, { kind: "buff" }>): string {
  const wanted = lower(ctx.args.variant);
  const variant = does.variants ? Object.entries(does.variants).find(([key]) => wanted.includes(key))?.[1] : undefined;
  const base = variant ?? (Array.isArray(does.condition) ? resolveFormula(does.condition, ctx.held.level) : does.condition);
  return base.replace("{bardic}", bardicDie(ctx.held.level)).replace("{units}", String(ctx.units));
}

// The creature a spend aims at: the one named, else the one the character
// attacked last this round.
function targetEnemy(ctx: SpendContext): EncounterEnemy | { error: string } {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return { error: `${ctx.spend.name} aims at a creature in a fight; there is no fight. Nothing was spent.` };
  }
  let ref = ctx.args.targetEnemyId;
  if (!ref) {
    const pairs = encounter.targets?.round === encounter.round ? encounter.targets.pairs[ctx.sheet.id] : undefined;
    ref = pairs?.[pairs.length - 1];
  }
  const enemy = ref ? resolveEnemyRef(encounter.id, ref) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: `${ctx.spend.name} needs a living creature: pass targetEnemyId from GAME STATE. Nothing was spent.` };
  }
  return enemy;
}

function damageEnemy(ctx: SpendContext, enemy: EncounterEnemy, amount: number, type: string): Record<string, unknown> {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter || amount <= 0) {
    return { damage: 0 };
  }
  if (ctx.turn) {
    const sheets = listSheets(ctx.campaign.id);
    const applied = applyEnemyDamage(ctx.campaign, ctx.turn, encounter, enemy, amount, sheets, new Map(sheets.map((entry) => [entry.id, entry])), type, { magical: true });
    publishEncounter(ctx.campaign.id);
    return { damage: amount, ...applied };
  }
  const line = hurtEnemy(ctx.campaign, encounter, enemy, amount, type, ctx.spend.name);
  publishEncounter(ctx.campaign.id);
  return { damage: amount, applied: line };
}

function enemyCondition(ctx: SpendContext, enemy: EncounterEnemy, condition: string, meta: Record<string, unknown>) {
  const fresh = getEnemy(enemy.id) ?? enemy;
  const kept = fresh.conditions.filter((entry) => lower(entry) !== lower(condition));
  patchEnemyConditions(fresh.id, [...kept, condition], {
    ...(fresh.conditionMeta as ConditionMetaMap),
    [condition]: { source: ctx.sheet.id, ...meta },
  } as typeof fresh.conditionMeta);
  publishEncounter(ctx.campaign.id);
}

function sheetCondition(campaign: Campaign, target: CharacterSheet, condition: string, rounds: number, extra: FullPatchSheetInput = {}) {
  const fresh = getSheetById(target.id) ?? target;
  const kept = fresh.conditions.filter((entry) => lower(entry) !== lower(condition));
  const updated = patchSheet(fresh.id, {
    conditions: [...kept, condition],
    conditionMeta: { ...fresh.conditionMeta, [condition]: { rounds } },
    ...extra,
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The allies in reach of the holder, the holder first when `withSelf`.
function alliesInReach(ctx: SpendContext, rangeFt: number, withSelf: boolean): CharacterSheet[] {
  const encounter = getActiveEncounter(ctx.campaign.id);
  const party = listSheets(ctx.campaign.id)
    .map((stale) => getSheetById(stale.id) ?? stale)
    .filter((entry) => !entry.deathSaves?.dead && entry.id !== ctx.sheet.id)
    .filter((entry) => !encounter || withinFeet(encounter.id, ctx.sheet.id, entry.id, rangeFt));
  return withSelf ? [ctx.sheet, ...party] : party;
}

function addUnits(base: string, per: string | undefined, units: number): string {
  if (!per || units <= 0) {
    return base;
  }
  const a = /^(\d+)d(\d+)$/.exec(base);
  const b = /^(\d+)d(\d+)$/.exec(per);
  if (a && b && a[2] === b[2]) {
    return `${Number(a[1]) + units * Number(b[1])}d${a[2]}`;
  }
  return `${base}+${units * Number(b?.[1] ?? 1)}d${b?.[2] ?? "6"}`;
}

export function resolveSpendEffect(ctx: SpendContext, does: SpendDoes): Resolution {
  const { sheet, campaign } = ctx;
  switch (does.kind) {
    case "choose": {
      const wanted = lower(ctx.args.variant);
      const option = does.options.find((entry) => wanted && (lower(entry) === wanted || wanted.includes(lower(entry))));
      if (!option) {
        return { error: `${ctx.spend.name} takes one option as the variant: ${does.options.join(", ")}. Nothing was changed.` };
      }
      const features = sheet.features.map((feature) =>
        feature.name === ctx.held.name ? { ...feature, name: `${ctx.held.feature} (${option})` } : feature,
      );
      return { patch: { features }, result: { chosen: `${ctx.held.feature}: ${option}. The server applies its effects from now on.` } };
    }
    case "buff": {
      const condition = conditionName(ctx, does);
      const lines: string[] = [];
      const tempHp = does.tempHp ? Math.max(0, Number(rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: temporary hit points`, formula(ctx, does.tempHp), null).total)) : 0;
      if (does.target === "enemy") {
        const enemy = targetEnemy(ctx);
        if ("error" in enemy) {
          return enemy;
        }
        enemyCondition(ctx, enemy, condition, { rounds: does.rounds });
        lines.push(`${enemy.displayName} is ${condition} for ${does.rounds} rounds.`);
      } else if (does.target === "allies") {
        const count = does.count ? Number(formula(ctx, does.count)) : 5;
        const touched = alliesInReach(ctx, does.rangeFt ?? 30, true).slice(0, count + 1);
        for (const ally of touched) {
          sheetCondition(campaign, ally, condition, does.rounds);
        }
        lines.push(`${touched.map((entry) => entry.name).join(", ")}: ${condition} for ${does.rounds} rounds.`);
      } else if (does.target === "ally") {
        const ally = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
        if (!ally || ally.campaignId !== campaign.id) {
          return { error: `${ctx.spend.name} goes to a creature at the table: pass targetCharacterId. Nothing was spent.` };
        }
        if (ally.id !== sheet.id) {
          sheetCondition(campaign, ally, condition, does.rounds, tempHp > ally.tempHp ? { tempHp } : {});
          lines.push(`${ally.name} is ${condition} for ${does.rounds} rounds.`);
          return { result: { applied: lines } };
        }
      }
      let patch: FullPatchSheetInput | undefined;
      if (!does.target || does.target === "self" || (does.target === "ally" && !ctx.args.targetCharacterId)) {
        const kept = sheet.conditions.filter((entry) => lower(entry) !== lower(condition));
        patch = {
          conditions: [...kept, condition],
          conditionMeta: { ...sheet.conditionMeta, [condition]: { rounds: does.rounds } },
          ...(tempHp > sheet.tempHp ? { tempHp } : {}),
        };
        lines.push(`${sheet.name} is ${condition} for ${does.rounds} rounds${tempHp ? `, with ${Math.max(tempHp, sheet.tempHp)} temporary hit points` : ""}.`);
      }
      if (does.mark) {
        // The creature named (or last attacked) carries the holder's mark.
        const marked = targetEnemy(ctx);
        if (!("error" in marked)) {
          enemyCondition(ctx, marked, does.mark, { rounds: does.rounds });
          lines.push(`${marked.displayName} is marked (${does.mark}).`);
        }
      }
      if (does.teleportFeet) {
        lines.push(`${sheet.name} teleports up to ${does.teleportFeet} feet: move their token with move_token (forced).`);
      }
      if (does.burst) {
        lines.push(...burst(ctx, does.burst));
      }
      return { patch, result: { applied: lines } };
    }
    case "save_effect": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const encounter = getActiveEncounter(campaign.id)!;
      if (does.rangeFt && !withinFeet(encounter.id, sheet.id, enemy.id, does.rangeFt)) {
        return { error: `${enemy.displayName} is beyond ${does.rangeFt} feet of ${sheet.name}; ${ctx.spend.name} reaches no further. Nothing was spent.` };
      }
      if (does.perUnit && ctx.units < 1) {
        return { error: `${ctx.spend.name} needs at least 1 point spent: pass amount. Nothing was spent.` };
      }
      const dc = saveDc(ctx, does.dcAbility);
      const save = rollEnemySave(campaign.id, enemy, does.save, dc, {
        resist: Boolean(does.condition) && bindsWorthResisting([does.condition ?? ""]),
        record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${does.save.toUpperCase()} save against ${ctx.spend.name}` },
      });
      const result: Record<string, unknown> = { target: enemy.displayName, save: save.total, dc, saved: save.success };
      const dice = does.perUnit ? addUnits(does.perUnit, does.perUnit, ctx.units - 1) : does.dice ? formula(ctx, does.dice) : null;
      if (dice) {
        const type = (does.typeFromVariant ?? []).find((entry) => lower(ctx.args.variant).includes(entry)) ?? does.type ?? "";
        const rolled = damageDice(ctx, enemy, dice);
        const amount = save.success ? (does.half ? Math.floor(rolled / 2) : 0) : rolled;
        Object.assign(result, { rolled: `${dice}: ${rolled}` }, damageEnemy(ctx, getEnemy(enemy.id) ?? enemy, amount, type));
      }
      if (!save.success && does.condition) {
        enemyCondition(ctx, enemy, does.condition, does.rounds ? { rounds: does.rounds } : {});
        result.condition = `${enemy.displayName} is ${does.condition}.`;
      }
      if (!save.success && does.onFail) {
        result.onFail = `${enemy.displayName} ${does.onFail}.`;
      }
      return { result };
    }
    case "reroll_save":
      return rerollLastSave(ctx);
    case "temp_hp": {
      const amount = Math.max(1, Number(rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: temporary hit points`, formula(ctx, does.formula), null).total));
      if (!does.allies) {
        return {
          patch: amount > sheet.tempHp ? { tempHp: amount } : {},
          result: { tempHp: amount > sheet.tempHp ? `${amount} temporary hit points to ${sheet.name}` : `${sheet.name} keeps their ${sheet.tempHp}` },
        };
      }
      const count = Number(formula(ctx, does.allies.count)) || 1;
      const given: string[] = [];
      for (const ally of alliesInReach(ctx, does.allies.rangeFt, false).slice(0, count)) {
        if (amount > ally.tempHp) {
          const updated = patchSheet(ally.id, { tempHp: amount });
          if (updated) {
            publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
          }
          given.push(`${ally.name} ${amount}`);
        }
      }
      return { result: { tempHp: given.length ? given : "nobody in reach gains more than they hold" } };
    }
    case "aoe_report": {
      const extra = Math.max(0, ctx.units - (does.baseUnits ?? 0));
      const dice = addUnits(formula(ctx, does.dice), does.perUnit, extra);
      return {
        result: {
          resolveWith: "aoe_damage",
          dice,
          saveAbility: does.save,
          dc: saveDc(ctx, does.dcAbility),
          damageType: does.type,
          area: does.area,
          note: `Resolve it with aoe_damage using these numbers; ${ctx.spend.name} is paid for.`,
        },
      };
    }
    case "teleport":
      return {
        result: {
          teleport: `${sheet.name} moves up to ${does.feet} feet${does.note ? `, ${does.note}` : ""}: move their token with move_token (forced: true) if a battle map is live.`,
        },
      };
    case "die_damage": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const dice = formula(ctx, does.dice);
      const rolled = damageDice(ctx, enemy, dice);
      return { result: { rolled: `${dice}: ${rolled}`, ...damageEnemy(ctx, enemy, rolled, does.type) } };
    }
    case "flourish": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const die = `1${bardicDie(ctx.held.level)}`;
      const rolled = damageDice(ctx, enemy, die);
      const result: Record<string, unknown> = { rolled: `${die}: ${rolled}`, ...damageEnemy(ctx, enemy, rolled, "") };
      if (/defen/.test(lower(ctx.args.variant))) {
        const condition = `defensive flourish (+${rolled})`;
        return {
          patch: {
            conditions: [...sheet.conditions.filter((entry) => !/^defensive flourish/i.test(entry)), condition],
            conditionMeta: { ...sheet.conditionMeta, [condition]: { untilTurnOf: sheet.id } },
          },
          result: { ...result, applied: `${condition}: +${rolled} AC until ${sheet.name}'s next turn.` },
        };
      }
      return { result: { ...result, note: "A slashing or mobile flourish's second target or push is the DM's to resolve with its own tool." } };
    }
    case "storm_aura":
      return stormAura(ctx);
    case "flames": {
      const wanted = lower(ctx.args.variant);
      if (/heal/.test(wanted)) {
        const rolled = rollCard(ctx.campaign, ctx.turn, sheet.id, "custom", `${ctx.spend.name}: healing`, formula(ctx, does.formula), null).total;
        const ally = ctx.args.targetCharacterId ? getSheetById(ctx.args.targetCharacterId) : sheet;
        if (!ally || ally.deathSaves?.dead) {
          return { error: `${ctx.spend.name} heals a living creature at the table: pass targetCharacterId. Nothing was spent.` };
        }
        const currentHp = Math.min(effectiveMaxHp(ally), ally.currentHp + rolled);
        patchSheet(ally.id, { currentHp });
        healDeathHook(campaign, ctx.turnId, ally);
        const updated = patchSheet(ally.id, {});
        if (updated) {
          publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
        }
        return { result: { healed: `${ally.name} regains ${currentHp - ally.currentHp} hit points (${rolled} rolled).` } };
      }
      if (!/burn|harm|damage/.test(wanted)) {
        return { error: `${ctx.spend.name} takes variant "heal" or "burn". Nothing was spent.` };
      }
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      // Rolled once the burn is sure to land: a refusal above spends nothing.
      const rolled = damageDice(ctx, enemy, formula(ctx, does.formula));
      return { result: { rolled, ...damageEnemy(ctx, enemy, rolled, does.type) } };
    }
    case "insight_contest": {
      const enemy = targetEnemy(ctx);
      if ("error" in enemy) {
        return enemy;
      }
      const insight = rollCharacterCheck(campaign, sheet, { skill: "insight" }, `${sheet.name}: Insight against ${enemy.displayName}'s Deception`);
      const skills = enemy.stats.skills as Record<string, number> | undefined;
      const deceptionMod = Number(skills?.deception ?? Math.floor(((enemy.stats.abilities?.cha ?? 10) - 10) / 2));
      // A contest the table sees, as every enemy's contest roll is (action-common.ts).
      const deception = rollCard(ctx.campaign, ctx.turn, null, "skill_check", `${enemy.displayName}: Deception against ${sheet.name}'s Insight`, `1d20${deceptionMod >= 0 ? "+" : ""}${deceptionMod}`, null).total;
      if (insight.total <= deception) {
        return { result: { insight: insight.total, deception, read: `${enemy.displayName} gives nothing away; no Sneak Attack edge.` } };
      }
      enemyCondition(ctx, enemy, does.condition, { rounds: does.rounds });
      return { result: { insight: insight.total, deception, read: `${sheet.name} reads ${enemy.displayName}: ${does.condition} for a minute.` } };
    }
    case "variants":
      return { error: `${ctx.spend.name} needs a variant. Nothing was spent.` };
    // Gathered Swarm's push (src/lib/dm/authored-spend-more.ts).
    case "swarm_push":
      return swarmPush(ctx, does);
    case "summon":
      return summonSteelDefender(ctx.campaign, sheet, ctx.held.level);
  }
}

// A burst the spend sets off around the holder: each enemy in range saves
// or takes the dice, or the condition.
function burst(ctx: SpendContext, spec: NonNullable<Extract<SpendDoes, { kind: "buff" }>["burst"]>): string[] {
  const encounter = getActiveEncounter(ctx.campaign.id);
  if (!encounter) {
    return [];
  }
  const lines: string[] = [];
  const dc = saveDc(ctx, spec.dcAbility);
  const enemies = (ctx.args.targetEnemyId ? [resolveEnemyRef(encounter.id, ctx.args.targetEnemyId)] : listEnemiesNear(ctx, encounter, spec.rangeFt)).filter(
    (enemy): enemy is EncounterEnemy => Boolean(enemy && enemy.status === "alive"),
  );
  for (const enemy of enemies) {
    const save = rollEnemySave(ctx.campaign.id, enemy, spec.save, dc, {
      resist: Boolean(spec.condition) && bindsWorthResisting([spec.condition ?? ""]),
      record: { turn: ctx.turn ?? undefined, detail: `${enemy.displayName}: ${spec.save.toUpperCase()} save against ${ctx.spend.name}` },
    });
    if (save.success) {
      lines.push(`${enemy.displayName} resists (${spec.save.toUpperCase()} ${save.total} vs DC ${dc}).`);
      continue;
    }
    if (spec.dice) {
      const rolled = damageDice(ctx, enemy, formula(ctx, spec.dice));
      damageEnemy(ctx, getEnemy(enemy.id) ?? enemy, rolled, spec.type ?? "");
      lines.push(`${enemy.displayName} takes ${rolled} ${spec.type ?? ""} damage.`.replace("  ", " "));
    }
    if (spec.condition) {
      enemyCondition(ctx, enemy, spec.condition, spec.rounds ? { rounds: spec.rounds } : {});
      lines.push(`${enemy.displayName} is ${spec.condition}.`);
    }
  }
  return lines;
}

function listEnemiesNear(ctx: SpendContext, encounter: Encounter, feet: number): EncounterEnemy[] {
  return listEnemiesOf(encounter).filter((enemy) => withinFeet(encounter.id, ctx.sheet.id, enemy.id, feet) && hasBoard(encounter));
}

function listEnemiesOf(encounter: Encounter): EncounterEnemy[] {
  return encounter.order
    .filter((entry): entry is Extract<typeof entry, { kind: "enemy" }> => entry.kind === "enemy")
    .map((entry) => getEnemy(entry.enemyId))
    .filter((enemy): enemy is EncounterEnemy => Boolean(enemy));
}

function hasBoard(encounter: Encounter): boolean {
  return getBattleMapForEncounter(encounter.id) !== null;
}

// Storm Aura: the barbarian's environment, chosen by the variant.
function stormAura(ctx: SpendContext): Resolution {
  const kind = (["desert", "sea", "tundra"] as const).find((entry) => lower(ctx.args.variant).includes(entry));
  if (!kind) {
    return { error: "Storm Aura takes the environment as the variant: desert, sea or tundra. Nothing was spent." };
  }
  const encounter = getActiveEncounter(ctx.campaign.id);
  const amount = formula(ctx, STORM_AURA[kind]);
  const condition = `storm aura (${kind})`;
  const patch: FullPatchSheetInput = {
    conditions: [...ctx.sheet.conditions.filter((entry) => !/^storm aura/i.test(entry)), condition],
    conditionMeta: { ...ctx.sheet.conditionMeta, [condition]: { rounds: 10 } },
  };
  if (kind === "sea") {
    const enemy = targetEnemy(ctx);
    if ("error" in enemy) {
      return enemy;
    }
    const resolved = resolveSpendEffect(ctx, { kind: "save_effect", save: "dex", dcAbility: "con", dice: amount, type: "lightning", half: true, rangeFt: 10 });
    return "error" in resolved ? resolved : { patch, result: { aura: condition, ...resolved.result } };
  }
  if (kind === "desert") {
    const lines: string[] = [];
    for (const enemy of encounter ? listEnemiesNear(ctx, encounter, 10) : []) {
      if (enemy.status === "alive") {
        lines.push(hurtEnemy(ctx.campaign, encounter!, enemy, Number(amount), "fire", "Storm Aura"));
      }
    }
    if (encounter) {
      publishEncounter(ctx.campaign.id);
    }
    return { patch, result: { aura: condition, desert: lines.length ? lines : "no creature stands in the aura on the board" } };
  }
  const given: string[] = [];
  for (const ally of alliesInReach(ctx, 10, false)) {
    if (Number(amount) > ally.tempHp) {
      const updated = patchSheet(ally.id, { tempHp: Number(amount) });
      if (updated) {
        publishPersisted(ctx.campaign.id, "sheet_updated", { sheet: updated });
      }
      given.push(ally.name);
    }
  }
  return { patch, result: { aura: condition, tundra: `${amount} temporary hit points to ${given.join(", ") || "nobody new"}` } };
}
