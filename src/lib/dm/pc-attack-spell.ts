// The spell attack branch of pc_attack: an attack-roll spell named in the
// call is a cast, checked by the cast guard before anything is spent and
// cast for real once the attack can no longer be refused. Split from
// pc-attack.ts, which decides when each half runs.

import { magicImmunityNote } from "@/lib/dm/monster-traits";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import type { AttackProfile } from "@/lib/dm/attack-logic";
import { spellAttackReach } from "@/lib/dm/cast-reach";
import { applyDmMutation } from "@/lib/dm/mutations";
import type { PcAttackArgs } from "@/lib/dm/pc-attack";
import type { AttackPlan } from "@/lib/dm/pc-attack-plan";
import type { AttackKind } from "@/lib/dm/pc-attack-profile";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { toolError, type ToolError } from "@/lib/dm/tool-errors";

// A spell named here is a cast, whatever form the caster wears: it goes
// through the one guard (src/lib/dm/cast-guard.ts) as a dry run now, so
// every refusal comes before anything is spent, and for real once this
// attack can no longer be refused. A granted attack (Spiritual Weapon's
// swing) is a spell already cast and is not cast again.
export function checkAttackSpell(input: {
  campaign: Campaign;
  turn: DmTurn;
  sheet: CharacterSheet;
  args: PcAttackArgs;
  kind: AttackKind;
  profile: AttackProfile;
  sheets: CharacterSheet[];
  sheetsById: Map<string, CharacterSheet>;
}):
  | { refused: ToolError }
  | { castsSpell: boolean; spellSlotLevel: number | null; profile: AttackProfile; noEffect: string | null } {
  const { campaign, turn, sheet, args, kind, sheets, sheetsById } = input;
  let profile = input.profile;
  const castsSpell = Boolean(args.spell?.trim()) && kind !== "granted";
  let spellSlotLevel: number | null = null;
  if (castsSpell) {
    const check = applyDmMutation(
      campaign,
      turn.id,
      "use_spell_slot",
      JSON.stringify({
        characterId: sheet.id,
        spell: args.spell,
        ...(args.level ? { level: args.level } : {}),
        via: "attack",
        dryRun: true,
      }),
      sheets,
      sheetsById,
    ).result;
    if (typeof check.error === "string") {
      return { refused: toolError(check) };
    }
    spellSlotLevel = typeof check.slotLevel === "number" ? check.slotLevel : null;
  }
  // Limited Magic Immunity (the rakshasa): a spell of its level or lower is
  // cast and has no effect on it (src/lib/dm/monster-traits.ts).
  const live = castsSpell ? getActiveEncounter(campaign.id) : null;
  const target = live && args.targetEnemyId ? resolveEnemyRef(live.id, args.targetEnemyId) : null;
  const noEffect = target ? magicImmunityNote(target, args.spell ?? "the spell", spellSlotLevel ?? 0) : null;
  if (kind === "spell") {
    profile = spellAttackReach(campaign, sheet, args.spell ?? "", profile, spellSlotLevel);
  }
  return { castsSpell, spellSlotLevel, profile, noEffect };
}

// Checked above, so the cast goes through: the slot, the material, the
// action (or the rest of an open casting), and concentration. A spell a
// monster's Counterspell stops, or Slow holds back, is spent and ends here:
// the refusal comes back for the caller to return in place of any roll.
export function castAttackSpell(plan: AttackPlan): ToolError | null {
  const { campaign, turn, encounter, sheet, args, sheets, sheetsById } = plan;
  const cast = applyDmMutation(
    campaign,
    turn.id,
    "use_spell_slot",
    JSON.stringify({
      characterId: sheet.id,
      spell: args.spell,
      ...(plan.spellSlotLevel ? { level: plan.spellSlotLevel } : {}),
      via: "attack",
    }),
    sheets,
    sheetsById,
  ).result;
  for (const line of [cast.slot, cast.cost, cast.shares, cast.continuing, cast.droppedConcentration]) {
    if (typeof line === "string") {
      plan.context.notes.push(line);
    }
  }
  // The guard wrote the turn to the encounter row; keep this copy level
  // with it so a later save here does not write the old turn back.
  const live = getActiveEncounter(campaign.id);
  if (live) {
    encounter.turnBudget = live.turnBudget;
    encounter.reactionsUsed = live.reactionsUsed;
  }
  // Checked by the dry run, so a refusal now is a cast paid for and stopped
  // (a counter, Slow's hold): no roll follows it.
  return typeof cast.error === "string" ? toolError(cast) : null;
}
