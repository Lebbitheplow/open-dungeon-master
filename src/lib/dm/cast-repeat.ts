// A concentration spell already running whose effect comes again on a later
// turn (Call Lightning's bolt, Heat Metal, Moonbeam): not a new casting, so
// no slot, no material, and concentration is not reset. Split from
// cast-guard.ts, which sends a repeat here before any refusal of a new
// casting is asked.

import type { Campaign } from "@/lib/db/campaigns";
import type { Encounter } from "@/lib/db/encounters";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { SpellFacts } from "@/lib/srd/spell-facts";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { canAct } from "@/lib/dm/can-act";
import type { CastInput, CastResult } from "@/lib/dm/cast-guard";
import { turnCharge } from "@/lib/dm/cast-rules";
import { lastCastSlot } from "@/lib/dm/spell-effects";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";

// The effect of a concentration spell coming again (Call Lightning's next
// bolt): the caster must still be up and able, and the turn pays what the
// spell says; the slot level is the one the casting was made from, read
// from the audit trail, so an upcast bolt stays upcast.
export function repeatSpell(
  campaign: Campaign,
  sheet: CharacterSheet,
  // The encounter when a fight with turns is running, null otherwise.
  fight: Encounter | null,
  facts: SpellFacts | null,
  name: string,
  cost: "action" | "bonus" | "free",
  input: CastInput,
): CastResult {
  if (sheet.deathSaves?.dead || sheet.currentHp <= 0) {
    return { error: `${sheet.name} is ${sheet.deathSaves?.dead ? "dead" : "at 0 HP"}, and ${name} ended with their concentration.` };
  }
  const slotLevel = lastCastSlot(sheet.id, name) ?? facts?.level ?? null;
  const repeatNote = `${name} is already cast and held by ${sheet.name}'s concentration: this is its effect again, and no slot is spent.`;
  if (cost === "free" || !fight) {
    return input.dryRun
      ? { ok: true, dryRun: true, spell: name, slotLevel, repeat: true }
      : { ok: true, spell: name, slotLevel, repeat: repeatNote };
  }
  const able = canAct({ sheet, encounter: fight, kind: cost === "bonus" ? "bonus" : "action" });
  if (!able.ok) {
    return { error: able.error };
  }
  const budget = budgetFor(fight, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
  // Not a casting: the bonus-action spell rule and the levelled spell mark
  // do not apply, so the charge is made as for a cantrip of that time.
  const charge = turnCharge({
    who: sheet.name,
    facts: facts ? { ...facts, level: 0, castingTime: cost === "bonus" ? "bonus" : "action" } : null,
    spell: name,
    slotLevel: null,
    inFight: true,
    budget,
    reactionSpent: false,
  });
  if ("error" in charge) {
    return charge;
  }
  if (input.dryRun) {
    return { ok: true, dryRun: true, spell: name, slotLevel, repeat: true };
  }
  if (charge.kind === "budget") {
    storeBudget(fight, charge.budget);
  }
  return {
    ok: true,
    spell: name,
    slotLevel,
    repeat: repeatNote,
    cost: cost === "bonus" ? "their bonus action" : "their action",
  };
}
