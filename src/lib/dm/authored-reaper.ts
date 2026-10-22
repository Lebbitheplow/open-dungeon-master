// Improved Reaper (Death cleric 17): a 1st to 5th level necromancy spell
// that targets one creature strikes a second creature within 5 feet of the
// first from the same slot, at no further cost (the material components a
// spell consumes are the caster's to provide for each). Reaper (Death cleric
// 1) does the same for a necromancy cantrip, Moon Fire (Lunar Sorcery 1) for
// sacred flame. cast_at_enemy with secondTargetEnemyId reaches
// handleReaperCast, which casts once (the slot spent, if any) and opens one
// more share of that casting for the second creature (cast-guard.ts open
// casts, so nothing more is spent).

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { getSheetById } from "@/lib/db/sheets";
import { spellFactsFor, spellMechanicsFor, spellSchoolFor } from "@/lib/content";
import { authoredTwinSpell } from "@/lib/srd/authored-effects-more";
import { conditionTurnShape } from "@/lib/srd/condition-effects";
import { withinFeet } from "@/lib/dm/authored-saves";
import { handleCastAtEnemy } from "@/lib/dm/cast-at-enemy";
import { openCastOf, withOpenCast } from "@/lib/dm/cast-rules";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { attacksAllowedFor, budgetFor, storeBudget } from "@/lib/dm/turn-budget";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolResult } from "@/lib/dm/tool-errors";

// cast_at_enemy with a second target (Improved Reaper), or null when the call
// names none and the plain handler resolves it.
export function handleReaperCast(
  campaign: Campaign,
  turn: DmTurn,
  rawArguments: string,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): ToolResult | null {
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
    return { error: "A second target is a creature in the fight: cast_at_enemy needs a caster from GAME STATE and an active encounter.", retry: true };
  }
  const first = resolveEnemyRef(encounter.id, String(rest.targetEnemyId ?? ""));
  const second = resolveEnemyRef(encounter.id, secondRef);
  if (!first || !second || second.status !== "alive" || second.id === first.id) {
    return { error: "secondTargetEnemyId names a second living creature from GAME STATE, not the first target. Nothing was spent.", retry: true };
  }
  const authors = spellAuthorsFor(campaign);
  const facts = spellFactsFor(spell, authors);
  const twin = authoredTwinSpell(sheet, { name: facts?.name ?? spell, school: spellSchoolFor(spell, authors), level: facts?.level ?? 0 });
  if (!twin) {
    return { error: `${sheet.name} cannot strike a second creature with ${spell}: that takes Reaper (a necromancy cantrip), Improved Reaper (a 1st to 5th level necromancy spell) or Moon Fire (sacred flame). Ask the player whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  const mech = spellMechanicsFor({ spell, userIds: authors })?.mech;
  if ((mech?.targets?.count ?? 1) > 1 || mech?.area) {
    return { error: `${spell} already reaches more than one creature; ${twin.feature} doubles a spell that targets only one. Ask the player whether to cast it as it is. Nothing was spent.`, retry: true };
  }
  if (!withinFeet(encounter.id, first.id, second.id, 5)) {
    return { error: `${second.displayName} is not within 5 feet of ${first.displayName}; ${twin.feature}'s second target must be. Ask the player for another target, or whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  const budget = budgetFor(encounter, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions));
  if (!budget) {
    return { error: `${twin.feature} doubles a spell ${sheet.name} casts on their own turn. Ask the player whether to cast it at one creature. Nothing was spent.`, retry: true };
  }
  const cast = handleCastAtEnemy(campaign, turn, JSON.stringify(rest), sheets, sheetsById);
  if (typeof cast.error === "string") {
    return cast;
  }
  // One more share of the same casting, for the second creature.
  const live = getActiveEncounter(campaign.id);
  const liveBudget = live ? budgetFor(live, sheet.id, attacksAllowedFor(sheet), conditionTurnShape(sheet.conditions)) : null;
  const name = facts?.name ?? spell;
  if (live && liveBudget) {
    const open = openCastOf(liveBudget, name);
    const slotLevel = typeof rest.level === "number" ? rest.level : (open?.slotLevel ?? facts?.level ?? null);
    storeBudget(live, withOpenCast(liveBudget, { spell: name, slotLevel, left: (open?.left ?? 0) + 1 }));
  }
  const again = handleCastAtEnemy(campaign, turn, JSON.stringify({ ...rest, targetEnemyId: second.id }), sheets, sheetsById);
  return { ...cast, secondTarget: again, [twin.feature]: `${name} also strikes ${second.displayName}.` };
}
