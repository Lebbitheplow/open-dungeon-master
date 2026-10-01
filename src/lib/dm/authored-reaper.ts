// Improved Reaper (Death cleric 17): a 1st to 5th level necromancy spell
// that targets one creature strikes a second creature within 5 feet of the
// first from the same slot. The authored text prices it at 1d8 of the
// cleric's hit points per spell level. cast_at_enemy with secondTargetEnemyId
// reaches handleReaperCast, which casts once (the slot spent), opens one more
// share of that casting for the second creature (cast-guard.ts open casts, so
// nothing more is spent) and takes the price.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { authoredTwinSpell } from "@/lib/srd/authored-effects-more";
import { conditionExtraActions } from "@/lib/srd/condition-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
import { openCastOf, withOpenCast } from "@/lib/dm/cast-rules";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// cast_at_enemy with a second target (Improved Reaper), or null when the call
// names none and the plain handler resolves it.
export function handleReaperCast(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): Record<string, unknown> | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const secondRef = typeof parsed.secondTargetEnemyId === "string" ? parsed.secondTargetEnemyId.trim() : "";
  if (!secondRef) {
    return null;
  }
  const { secondTargetEnemyId: _second, ...rest } = parsed;
  void _second;
  const encounter = getActiveEncounter(campaign.id);
  const stale = resolveSheetRef(String(rest.characterId ?? ""), sheets, sheetsById);
  const sheet = stale ? (getSheetById(stale.id) ?? stale) : null;
  const spell = String(rest.spell ?? "");
  if (!encounter || !sheet) {
    return { error: "A second target is a creature in the fight: cast_at_enemy needs a caster from GAME STATE and an active encounter." };
  }
  const first = resolveEnemyRef(encounter.id, String(rest.targetEnemyId ?? ""));
  const second = resolveEnemyRef(encounter.id, secondRef);
  if (!first || !second || second.status !== "alive" || second.id === first.id) {
    return { error: "secondTargetEnemyId names a second living creature from GAME STATE, not the first target. Nothing was spent." };
  }
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(spell, authors);
  const twin = authoredTwinSpell(sheet, { school: spellSchoolFor(spell, authors), level: facts?.level ?? 0 });
  if (!twin) {
    return { error: `${sheet.name} cannot strike a second creature with ${spell}: that takes Improved Reaper (a Death cleric's 17th level feature) and a 1st to 5th level necromancy spell. Nothing was spent.` };
  }
  const mech = spellMechanicsFor({ spell, userIds: authors })?.mech;
  if ((mech?.targets?.count ?? 1) > 1 || mech?.area) {
    return { error: `${spell} already reaches more than one creature; Improved Reaper doubles a spell that targets only one. Nothing was spent.` };
  }
  if (!withinFeet(encounter.id, first.id, second.id, 5)) {
    return { error: `${second.displayName} is not within 5 feet of ${first.displayName}; Improved Reaper's second target must be. Nothing was spent.` };
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions));
  if (!budget) {
    return { error: `Improved Reaper doubles a spell ${sheet.name} casts on their own turn. Nothing was spent.` };
  }
  const cast = handleCastAtEnemy(campaign, turn, JSON.stringify(rest), sheets, sheetsById);
  if (typeof cast.error === "string") {
    return cast;
  }
  // One more share of the same casting, for the second creature.
  const live = getActiveEncounter(campaign.id);
  const liveBudget = live ? budgetFor(live, sheet.id, attacksAllowedFor(sheet), conditionExtraActions(sheet.conditions)) : null;
  const name = facts?.name ?? spell;
  if (live && liveBudget) {
    const open = openCastOf(liveBudget, name);
    const slotLevel = typeof rest.level === "number" ? rest.level : (open?.slotLevel ?? facts?.level ?? null);
    storeBudget(live, withOpenCast(liveBudget, { spell: name, slotLevel, left: (open?.left ?? 0) + 1 }));
  }
  const again = handleCastAtEnemy(campaign, turn, JSON.stringify({ ...rest, targetEnemyId: second.id }), sheets, sheetsById);
  // The price the authored text names, in the cleric's own hit points.
  const price = Math.max(1, rollExpression(twin.cost).total);
  const paid = applyPcDamage(campaign, turn.id, getSheetById(sheet.id) ?? sheet, { amount: price, reason: `${twin.feature} (${spell})` });
  return { ...cast, secondTarget: again, [twin.feature]: `${twin.cost} of ${sheet.name}'s own hit points: ${price}`, paid };
}
