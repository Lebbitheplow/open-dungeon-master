// A readied spell (SRD 5.1, Ready): "When you ready a spell, you cast it as
// normal but hold its energy, which you release with your reaction when the
// trigger occurs. To be readied, a spell must have a casting time of 1
// action, and holding onto the spell's magic requires concentration. If
// your concentration is broken, the spell dissipates without taking effect."
//
// take_action ready with `spell` casts it on the turn through the one cast
// door (use_spell_slot: the slot, the action, the material), holds it with
// concentration, and leaves the "readied" condition carrying the spell and
// its slot. The release is the same spell cast off turn through any tool:
// the cast guard (src/lib/dm/cast-guard.ts castSpell) asks readiedRelease
// first, which charges the reaction and no second slot. Unreleased, it is
// lost when the caster's next turn starts (condition-tick.ts ends the
// readied condition and the concentration that held it).

import { sheetSpellAuthors } from "@/lib/dm/spell-authors";
import type { Campaign } from "@/lib/db/campaigns";
import { saveEncounter, type Encounter } from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { spellFactsFor } from "@/lib/content";
import { actingCombatantId, canAct } from "@/lib/dm/can-act";
import { spellKeyOf } from "@/lib/dm/cast-rules";
import { breakConcentration, setConcentration } from "@/lib/dm/concentration";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const READIED = "readied";

type Held = { spell: string; slotLevel: number | null };

// The spell a character holds readied, or null.
export function readiedSpellOf(sheet: Pick<CharacterSheet, "conditions" | "conditionMeta">): Held | null {
  const name = sheet.conditions.find((entry) => entry.trim().toLowerCase() === READIED);
  const meta = name ? (sheet.conditionMeta as ConditionMetaMap)[name] : undefined;
  return meta?.spell ? { spell: meta.spell, slotLevel: meta.slotLevel ?? null } : null;
}

// take_action ready with a spell: cast now, hold until the trigger.
// `castSlot` is use_spell_slot, handed in by the caller: the cast guard
// reaches this module, so it must not import mutations.ts itself.
export function readySpell(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  input: { spell: string; level?: number; trigger: string | undefined; inFight: boolean },
  castSlot: (args: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown> {
  const trigger = (input.trigger ?? "").trim();
  if (!input.inFight) {
    return { error: "Ready is an action in a fight, where turns are taken in order; there is no active fight." };
  }
  if (!trigger) {
    return { error: "Ready needs the trigger it waits for, e.g. trigger: 'when the goblin steps through the door'. Nothing was spent." };
  }
  const facts = spellFactsFor(input.spell, sheetSpellAuthors(sheet));
  if (facts && facts.castingTime !== "action") {
    return {
      error: `${facts.name} cannot be readied: only a spell with a casting time of one action can be (SRD 5.1, Ready). Nothing was spent.`,
    };
  }
  const cast = castSlot({
    characterId: sheet.id,
    spell: input.spell,
    ...(input.level ? { level: input.level } : {}),
    reason: `readied: ${trigger}`,
  });
  if ("error" in cast) {
    return { error: String(cast.error) };
  }
  const name = String(cast.spell ?? facts?.name ?? input.spell);
  const slotLevel = typeof cast.slotLevel === "number" ? cast.slotLevel : null;
  // Holding the spell is concentration, whatever the spell itself needs.
  const held = getSheetById(sheet.id) ?? sheet;
  if (spellKeyOf(held.concentratingOn ?? "") !== spellKeyOf(name)) {
    setConcentration(campaign, turn.id, sheet.id, name);
  }
  const fresh = getSheetById(sheet.id) ?? sheet;
  const meta: ConditionMetaMap = {
    ...(fresh.conditionMeta as ConditionMetaMap),
    [READIED]: { untilTurnOf: sheet.id, source: trigger.slice(0, 80), spell: name, ...(slotLevel !== null ? { slotLevel } : {}) },
  };
  const conditions = fresh.conditions.some((entry) => entry.trim().toLowerCase() === READIED) ? fresh.conditions : [...fresh.conditions, READIED];
  const updated = patchSheet(sheet.id, { conditions, conditionMeta: meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return {
    ok: true,
    action: "Ready",
    spell: name,
    ...(cast.slot ? { slot: cast.slot } : {}),
    trigger: trigger.slice(0, 80),
    applied: `${sheet.name} casts ${name} and holds it, concentrating, until the start of their next turn. When the trigger happens, cast ${name} with its own tool (pc_attack, cast_at_enemy, cast_buff, aoe_damage, heal): it is released with their reaction and spends no second slot. If their concentration breaks first, or the trigger never comes, the spell is lost.`,
  };
}

// Whether this cast is the release of a readied spell: the caster holds it,
// and it is not their turn.
export function readiedRelease(sheet: CharacterSheet, encounter: Encounter | null, spell: string): Held | null {
  const held = readiedSpellOf(sheet);
  if (!held || !encounter || actingCombatantId(encounter) === sheet.id) {
    return null;
  }
  return spellKeyOf(held.spell) === spellKeyOf(spell) ? held : null;
}

// The release: the reaction, no slot, no material. A broken concentration
// lost the spell before the trigger came.
export function releaseReadied(
  campaign: Campaign,
  sheet: CharacterSheet,
  encounter: Encounter,
  held: Held,
  dryRun: boolean,
): Record<string, unknown> {
  const able = canAct({ sheet, encounter, kind: "reaction" });
  if (!able.ok) {
    return { error: able.error };
  }
  if (encounter.reactionsUsed.includes(sheet.id)) {
    return { error: `${sheet.name} has already used their reaction, so the readied ${held.spell} cannot be released; it is lost when their turn starts.` };
  }
  if (spellKeyOf(sheet.concentratingOn ?? "") !== spellKeyOf(held.spell)) {
    if (!dryRun) {
      dropReadied(campaign, sheet.id);
    }
    return { error: `${sheet.name}'s concentration on the readied ${held.spell} was broken, so it dissipated without taking effect. Nothing is cast.` };
  }
  if (dryRun) {
    return { ok: true, dryRun: true, spell: held.spell, slotLevel: held.slotLevel, released: true };
  }
  encounter.reactionsUsed = [...encounter.reactionsUsed, sheet.id];
  saveEncounter(encounter);
  dropReadied(campaign, sheet.id);
  // The concentration was the holding; a spell that is not itself a
  // concentration spell lets go of it now.
  const facts = spellFactsFor(held.spell, sheetSpellAuthors(sheet));
  if (facts && !facts.concentration) {
    breakConcentration(campaign, null, sheet.id, "the readied spell was released");
  }
  return {
    ok: true,
    spell: held.spell,
    slotLevel: held.slotLevel,
    slot: "released from readiness: no slot spent",
    cost: "their reaction",
    released: true,
  };
}

function dropReadied(campaign: Campaign, sheetId: string) {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return;
  }
  const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [READIED]);
  const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}
