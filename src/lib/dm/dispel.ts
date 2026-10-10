// Dispel Magic (SRD 5.1): any spell of 3rd level or lower on the target
// ends; for each of a higher level the caster makes a spellcasting ability
// check against DC 10 + that spell's level. Cast from a higher slot, every
// spell of that level or lower ends outright.
//
// What is "on" a creature is what the engine tracks: the conditions a spell
// laid down, which record the spell (src/lib/dm/spell-effects.ts), and on
// older rows the effect conditions only one spell lays down (hasted,
// blessed). Reached through cast_at_enemy and cast_buff. Imports mutations
// (for the slot spend) and must never be imported by it.

import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, getEnemy, patchEnemyConditions } from "@/lib/db/encounters";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import type { DmTurn } from "@/lib/db/dm-turns";
import { publishPersisted } from "@/lib/events";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { MECH_OVERRIDES } from "@/lib/srd/spell-mechanics";
import { applyDmMutation } from "@/lib/dm/mutations";
import { instancesOf, removeConditionInstances, type ConditionMeta, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { spellKey } from "@/lib/dm/spell-effects";
import { spellReachProblem } from "@/lib/dm/cast-reach";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const SRD_CONDITIONS = new Set([
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
  "stunned", "unconscious",
]);

// The spell an effect condition written before spells were recorded on it
// belongs to: "hasted" is Haste's, "aided (+5)" Aid's.
function legacySpellOf(condition: string): string | null {
  const name = condition.toLowerCase().replace(/ \(.*$/, "");
  if (SRD_CONDITIONS.has(name)) {
    return null;
  }
  for (const [spell, mech] of Object.entries(MECH_OVERRIDES)) {
    const names = [
      mech.buff?.condition,
      ...(mech.buff?.variants ?? []),
      ...(mech.buff?.bySlot ?? []).map(([, entry]) => entry),
      mech.condition?.name,
    ].map((entry) => (entry ?? "").toLowerCase().replace(/ \(.*$/, ""));
    if (names.includes(name)) {
      return spell;
    }
  }
  return null;
}

type Held = { spell: string; key: string; conditions: string[] };

// One casting's key on a condition instance: the spell and its caster.
function castingKey(condition: string, instance: ConditionMeta): string | null {
  const spell = instance.spell ?? legacySpellOf(condition);
  return spell ? `${spellKey(spell)}|${instance.source ?? ""}` : null;
}

// The spells on a creature, each casting with the conditions it holds
// there. Every source's instance counts on its own: two casters' Hold
// Person are two spells to dispel (src/lib/dm/condition-logic.ts).
function spellsOn(conditions: string[], meta: ConditionMetaMap): Held[] {
  const bySpell = new Map<string, Held>();
  for (const condition of conditions) {
    for (const instance of instancesOf(meta[condition])) {
      const key = castingKey(condition, instance);
      if (!key) {
        continue;
      }
      const spell = instance.spell ?? legacySpellOf(condition) ?? "";
      const entry = bySpell.get(key) ?? { spell, key, conditions: [] };
      entry.conditions.push(condition);
      bySpell.set(key, entry);
    }
  }
  return [...bySpell.values()];
}

// Takes the ended castings' instances off, leaving every other source's.
function withoutCastings(conditions: string[], meta: ConditionMetaMap, keys: Set<string>) {
  let nextConditions = conditions;
  let nextMeta = meta;
  for (const name of conditions) {
    const result = removeConditionInstances(nextConditions, nextMeta, name, (instance) => {
      const key = castingKey(name, instance);
      return key !== null && keys.has(key);
    });
    nextConditions = result.conditions;
    nextMeta = result.meta;
  }
  return { conditions: nextConditions, meta: nextMeta };
}

export function handleDispelMagic(
  campaign: Campaign,
  turn: DmTurn,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
  input: {
    caster: CharacterSheet;
    spell: string;
    level?: number;
    target: { kind: "enemy" | "sheet"; id: string };
    endSpell?: string;
    reason?: string;
  },
): Record<string, unknown> {
  const { caster } = input;
  const enemy = input.target.kind === "enemy" ? getEnemy(input.target.id) : null;
  const ally = input.target.kind === "sheet" ? getSheetById(input.target.id) : null;
  const holder = enemy
    ? { name: enemy.displayName, conditions: enemy.conditions, meta: enemy.conditionMeta as ConditionMetaMap }
    : ally
      ? { name: ally.name, conditions: ally.conditions, meta: ally.conditionMeta as ConditionMetaMap }
      : null;
  if (!holder) {
    return { error: "Unknown target for Dispel Magic; use an id from GAME STATE." };
  }
  const wanted = input.endSpell ? spellKey(input.endSpell) : null;
  const held = spellsOn(holder.conditions, holder.meta).filter(
    (entry) => !wanted || spellKey(entry.spell) === wanted,
  );
  if (!held.length) {
    return {
      error: `${holder.name} holds no spell the server tracks${input.endSpell ? ` named ${input.endSpell}` : ""}, so ${input.spell} would end nothing. The slot was not spent.`,
    };
  }
  const authors = spellAuthorsFor(campaign);
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const reach = spellReachProblem({
      encounterId: encounter.id,
      casterId: caster.id,
      casterName: caster.name,
      targetId: input.target.id,
      targetName: holder.name,
      facts: spellFactsFor(input.spell, authors),
    });
    if (reach) {
      return { error: reach };
    }
  }
  const cast = applyDmMutation(
    campaign,
    turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: caster.id,
      spell: input.spell,
      ...(input.level ? { level: input.level } : {}),
      via: enemy ? "enemy" : "buff",
      reason: (input.reason ?? "").slice(0, 200),
    }),
    sheets,
    sheetsById,
  ).result;
  if ("error" in cast) {
    return cast;
  }
  const slotLevel = typeof cast.slotLevel === "number" ? cast.slotLevel : 3;
  const ability = caster.spellcasting?.ability ?? "int";
  const ended: string[] = [];
  const endedKeys = new Set<string>();
  const kept: string[] = [];
  const lines: string[] = [];
  for (const entry of held) {
    const level = spellMechanicsFor({ spell: entry.spell, userIds: authors })?.spellLevel ?? 1;
    if (level <= slotLevel) {
      ended.push(...entry.conditions);
      endedKeys.add(entry.key);
      lines.push(`${entry.spell} (level ${level}) ends.`);
      continue;
    }
    const dc = 10 + level;
    // An ability check like any other (src/lib/dm/contest-roll.ts): Jack of
    // All Trades, Guidance, exhaustion, a held die and Lucky ride it.
    const outcome = rollCharacterCheck(campaign, caster, { ability, dc }, `Check to dispel ${entry.spell}`);
    if (outcome.rollId) {
      turn.rollIds.push(outcome.rollId);
    }
    if (!outcome.autoFailed && outcome.total >= dc) {
      ended.push(...entry.conditions);
      endedKeys.add(entry.key);
      lines.push(`${entry.spell} (level ${level}) ends: check ${outcome.total} vs DC ${dc}.`);
    } else {
      kept.push(...entry.conditions);
      lines.push(`${entry.spell} (level ${level}) holds: check ${outcome.total} vs DC ${dc}.`);
    }
  }
  if (ended.length) {
    if (enemy) {
      const fresh = getEnemy(enemy.id);
      if (fresh) {
        const cleared = withoutCastings(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, endedKeys);
        patchEnemyConditions(fresh.id, cleared.conditions, cleared.meta);
        publishEncounter(campaign.id);
      }
    } else if (ally) {
      const fresh = getSheetById(ally.id) ?? ally;
      const cleared = withoutCastings(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, endedKeys);
      const updated = patchSheet(fresh.id, {
        conditions: cleared.conditions,
        conditionMeta: cleared.meta,
      });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
    }
  }
  return {
    ok: true,
    spell: input.spell,
    target: holder.name,
    ...(cast.slot ? { slot: cast.slot } : {}),
    ...(cast.cost ? { cost: cast.cost } : {}),
    dispelled: lines,
    ...(ended.length ? { ended } : {}),
    ...(kept.length ? { stillHeld: kept } : {}),
  };
}
