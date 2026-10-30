// The Grappler feat's pin. SRD 5.1 Feats, Grappler: "You can use your
// action to try to pin a creature grappled by you. To do so, make another
// grapple check. If you succeed, you and the creature are both restrained
// until the grapple ends."
//
// The pinned creature's restraint names the grappler as its source, so it
// ends with the grapple wherever the grapple ends (grapple.ts
// withoutGrapple). The grappler's own restraint names the creature in
// `pinning`; releaseLostPins ends it once that grapple is gone, and the
// places a grapple ends call it.

import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter, listEnemies, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { rollEnemyContest } from "@/lib/dm/action-common";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { resolveTargetFoe } from "@/lib/dm/sheet-foe";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { featUsable, holdsFeat } from "@/lib/srd/feat-use";
import { isConditionNamed } from "@/lib/srd/feature-names";
import { effectiveAbilities } from "@/lib/srd/magic-items";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const GRAPPLED = "grappled";
const RESTRAINED = "restrained";

type Holder = { conditions: string[]; conditionMeta?: ConditionMetaMap | null };

// The condition's name as the holder writes it.
function conditionName(holder: Holder, condition: string): string | undefined {
  return holder.conditions.find((entry) => isConditionNamed(entry, condition));
}

// The condition's name when its source is `by`.
function heldFrom(holder: Holder, condition: string, by: string): string | null {
  const name = conditionName(holder, condition);
  return name && holder.conditionMeta?.[name]?.source === by ? name : null;
}

// take_action pin. The caller has priced the action; `spend` pays it once
// nothing refuses.
export function pin(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  encounter: ReturnType<typeof getActiveEncounter>,
  targetEnemyId: string | undefined,
  spend: () => void,
): ToolResult {
  if (!featUsable(sheet, "Grappler", effectiveAbilities(sheet.abilities, sheet.equipment ?? [], sheet))) {
    return {
      error: holdsFeat(sheet, "Grappler")
        ? `${sheet.name}'s Strength is below the 13 the Grappler feat asks, so they cannot use it until it is restored. Nothing was spent.`
        : `${sheet.name} does not have the Grappler feat; only a Grappler can pin a creature. Nothing was spent.`,
      refused: "rules",
    };
  }
  if (!encounter) {
    return { error: "pin needs an active encounter and the creature they grapple.", retry: true };
  }
  const enemy = targetEnemyId ? resolveTargetFoe(campaign.id, encounter, targetEnemyId) : null;
  if (!enemy || enemy.status !== "alive") {
    return { error: "pin needs a living targetEnemyId from GAME STATE: the creature they grapple.", retry: true };
  }
  if (!heldFrom(enemy, GRAPPLED, sheet.id)) {
    return {
      error: `${sheet.name} is not grappling ${enemy.displayName}. A pin is made on a creature they already grapple: grapple it first. Nothing was spent.`,
      refused: "rules",
    };
  }
  if (heldFrom(enemy, RESTRAINED, sheet.id)) {
    return { error: `${enemy.displayName} is already pinned by ${sheet.name}. Nothing was spent.`, refused: "rules" };
  }
  if (enemy.stats.conditionImmune.toLowerCase().includes(RESTRAINED)) {
    return { error: `${enemy.displayName} cannot be restrained; it is immune, so it cannot be pinned. Nothing was spent.`, refused: "rules" };
  }
  spend();
  // "Make another grapple check": the grappler's Athletics against the
  // creature's better of Athletics and Acrobatics; a tie leaves it unpinned.
  const mine = rollCharacterCheck(campaign, sheet, { skill: "athletics" }, `${sheet.name}: Athletics to pin ${enemy.displayName}`);
  if (mine.rollId) {
    turn.rollIds.push(mine.rollId);
  }
  const theirs = rollEnemyContest(campaign, turn, enemy, "either", `${enemy.displayName}: contest against the pin`);
  const contest = `${mine.total} vs ${theirs}`;
  if (mine.autoFailed || mine.total <= theirs) {
    return { ok: true, action: "pin", contest, success: false, note: `${enemy.displayName} keeps from being pinned; it is still grappled.` };
  }
  restrainEnemy(enemy, sheet.id);
  const fresh = getSheetById(sheet.id) ?? sheet;
  if (!conditionName(fresh, RESTRAINED)) {
    const updated = patchSheet(sheet.id, {
      conditions: [...fresh.conditions, RESTRAINED],
      conditionMeta: { ...fresh.conditionMeta, [RESTRAINED]: { source: enemy.id, pinning: enemy.id } },
    });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  publishEncounter(campaign.id);
  return {
    ok: true,
    action: "pin",
    contest,
    success: true,
    applied: `${sheet.name} pins ${enemy.displayName}: both are restrained until the grapple ends. The server applied both restraints and ends them with the grapple.`,
  };
}

function restrainEnemy(enemy: EncounterEnemy, holderId: string) {
  if (conditionName(enemy, RESTRAINED)) {
    return;
  }
  patchEnemyConditions(enemy.id, [...enemy.conditions, RESTRAINED], { ...enemy.conditionMeta, [RESTRAINED]: { source: holderId } });
}

// Ends every grappler's own pin restraint whose grapple is gone: the pinned
// creature escaped, fell, fled, was let go or moved out of reach. Returns
// the names of the grapplers freed.
export function releaseLostPins(campaign: Campaign): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const enemies = encounter ? listEnemies(encounter.id) : [];
  const freed: string[] = [];
  for (const sheet of listSheets(campaign.id)) {
    const name = conditionName(sheet, RESTRAINED);
    const pinning = name ? (sheet.conditionMeta as ConditionMetaMap | undefined)?.[name]?.pinning : undefined;
    if (!name || !pinning) {
      continue;
    }
    const pinned = enemies.find((enemy) => enemy.id === pinning);
    if (pinned && pinned.status === "alive" && heldFrom(pinned, GRAPPLED, sheet.id)) {
      continue;
    }
    const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, [name]);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
    freed.push(sheet.name);
  }
  return freed;
}
