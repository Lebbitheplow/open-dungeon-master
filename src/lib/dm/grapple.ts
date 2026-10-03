// A grapple from the first grab to its end. Before this the grab was real
// (take_action grapple) and nothing else was: nobody could escape, and the
// grapple held when the grappler walked 25 feet away or dropped to 0.
//
// SRD 5.1, Grappling:
//   - The grab and the shove each replace one attack of the Attack action
//     (charged by the caller through spendAttack).
//   - Escaping takes the grappled creature's action: its Athletics or
//     Acrobatics against the grappler's Athletics. A tie holds the grapple.
//   - The grapple ends when the grappler is incapacitated (dropping to 0
//     hit points is that too, see set-condition.ts releaseGrapplesHeldBy),
//     or when an effect removes the grappled creature from the grappler's
//     reach. ODM reads the second on the board: once the two stand more than
//     the grappler's reach apart, the grapple is gone. Dragging the grappled
//     creature along is the move route's `drag` (src/lib/dm/drag.ts);
//     moving away without it lets go.
//   - A monster's grapple prints its escape DC ("grappled (escape DC 13)"):
//     the escape is an Athletics or Acrobatics check against that DC, not a
//     contest (SRD 5.1, Monsters: Grapple Rules for Monsters). A restraint
//     that lasts "until this grapple ends" ends with it.

import type { Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import {
  getActiveEncounter,
  listEnemies,
  patchEnemyConditions,
  saveEncounter,
  type EncounterEnemy,
} from "@/lib/db/encounters";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getSheetById, listSheets, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { computeSheetDerived } from "@/lib/srd";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollEnemyContest } from "@/lib/dm/action-common";
import { canEnemyAct } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { removeConditions, type ConditionMetaMap } from "@/lib/dm/condition-logic";
import { rollCharacterCheck } from "@/lib/dm/contest-roll";
import { publishEncounter, resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { enemyAttackProfile } from "@/lib/dm/enemy-profile";
import { characterSpellEscape, characterSpellHold, enemySpellEscape, enemySpellHold } from "@/lib/dm/spell-escape";

const GRAPPLED = "grappled";

function grappleOf(meta: ConditionMetaMap | undefined): { name: string; source: string | null; escapeDc: number | null } | null {
  for (const [name, entry] of Object.entries(meta ?? {})) {
    if (name.toLowerCase() === GRAPPLED) {
      return { name, source: entry?.source ?? null, escapeDc: typeof entry?.escapeDc === "number" ? entry.escapeDc : null };
    }
  }
  return null;
}

// The grapple's end: grappled goes, and so does a restraint the same
// grappler holds, which a constrictor's grapple brings and which lasts only
// "until this grapple ends".
export function withoutGrapple(
  conditions: string[],
  meta: ConditionMetaMap | undefined,
  held: { name: string; source: string | null },
): { conditions: string[]; meta: ConditionMetaMap } {
  const restrained = held.source
    ? Object.entries(meta ?? {})
        .filter(([name, entry]) => name.toLowerCase() === "restrained" && entry?.source === held.source)
        .map(([name]) => name)
    : [];
  return removeConditions(conditions, meta, [held.name, ...restrained]);
}

// The skill a character escapes with: the better of their Athletics and
// Acrobatics.
function escapeSkill(sheet: CharacterSheet): "athletics" | "acrobatics" {
  const skills = computeSheetDerived(sheet).skills;
  return (skills.acrobatics ?? 0) > (skills.athletics ?? 0) ? "acrobatics" : "athletics";
}

// A character's escape from a grapple. The caller has priced the action;
// `spend` pays it once nothing refuses.
export function characterEscape(
  campaign: Campaign,
  turn: DmTurn,
  sheet: CharacterSheet,
  spend: () => void,
): Record<string, unknown> {
  const held = sheet.conditions.some((entry) => entry.toLowerCase() === GRAPPLED)
    ? grappleOf(sheet.conditionMeta as ConditionMetaMap)
    : null;
  if (!held) {
    // A spell's hold (Entangle, Web): src/lib/dm/spell-escape.ts.
    return characterSpellHold(sheet)
      ? characterSpellEscape(campaign, turn, sheet, spend)
      : { error: `${sheet.name} is not grappled; there is nothing to escape.` };
  }
  const encounter = getActiveEncounter(campaign.id);
  const enemyHolder = held.source && encounter ? resolveEnemyRef(encounter.id, held.source) : null;
  const sheetHolder = held.source && !enemyHolder ? getSheetById(held.source) : null;
  if (!enemyHolder && !sheetHolder) {
    return {
      error: `${sheet.name}'s grapple names no grappler the server can find, so there is no contest to roll. The DM or the party lead ends it with clear_condition.`,
    };
  }
  spend();
  const skill = escapeSkill(sheet);
  const holderName = enemyHolder?.displayName ?? sheetHolder?.name ?? "the grappler";
  const mine = rollCharacterCheck(
    campaign,
    sheet,
    { skill },
    held.escapeDc && enemyHolder
      ? `${sheet.name}: ${skill} to escape ${holderName}'s grapple (DC ${held.escapeDc})`
      : `${sheet.name}: ${skill} to escape the grapple`,
  );
  if (mine.rollId) {
    turn.rollIds.push(mine.rollId);
  }
  // A monster's printed escape DC is the number to reach; a creature with
  // none (a character, a block written without one) holds with a contest.
  const theirs =
    held.escapeDc && enemyHolder
      ? null
      : enemyHolder
        ? rollEnemyContest(campaign, turn, enemyHolder, "athletics", `${holderName}: Athletics to hold the grapple`)
        : (() => {
            const check = rollCharacterCheck(campaign, sheetHolder!, { skill: "athletics" }, `${holderName}: Athletics to hold the grapple`);
            if (check.rollId) {
              turn.rollIds.push(check.rollId);
            }
            return check.total;
          })();
  // Against a DC, meeting it escapes; in a contest a tie leaves things as
  // they are: the grapple holds.
  const escaped = !mine.autoFailed && (theirs === null ? mine.total >= (held.escapeDc ?? 0) : mine.total > theirs);
  if (escaped) {
    const fresh = getSheetById(sheet.id) ?? sheet;
    const cleared = withoutGrapple(fresh.conditions, fresh.conditionMeta as ConditionMetaMap, held);
    const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
    if (updated) {
      publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
    }
  }
  return {
    ok: true,
    action: "escape",
    ...(theirs === null ? { check: `${mine.total} vs escape DC ${held.escapeDc}` } : { contest: `${mine.total} vs ${theirs}` }),
    success: escaped,
    note: escaped
      ? `${sheet.name} breaks free of ${holderName}'s grapple; the server cleared grappled (and the restraint it held) and their speed is back.`
      : `${holderName} holds on; ${sheet.name} is still grappled.`,
  };
}

// An enemy's escape from a character's grapple: its action, the better of
// its Athletics and Acrobatics against the grappler's Athletics.
export function enemyEscape(
  campaign: Campaign,
  turn: DmTurn,
  enemyRef: string,
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter." };
  }
  const enemy = resolveEnemyRef(encounter.id, enemyRef);
  if (!enemy) {
    return { error: "Unknown enemyId; use one from GAME STATE." };
  }
  const held = enemy.conditions.some((entry) => entry.toLowerCase() === GRAPPLED)
    ? grappleOf(enemy.conditionMeta)
    : null;
  if (!held) {
    return enemySpellHold(enemy)
      ? enemySpellEscape(campaign, turn, enemy)
      : { error: `${enemy.displayName} is not grappled; there is nothing to escape.` };
  }
  const allowed = canEnemyAct({ enemy, encounter, kind: "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  const holder = held.source ? getSheetById(held.source) : null;
  if (!holder) {
    return {
      error: `${enemy.displayName}'s grapple names no grappler the server can find; end it with set_enemy_condition instead of a contest.`,
    };
  }
  spendEnemyAction(encounter, enemy.id);
  saveEncounter(encounter);
  const theirs = rollEnemyContest(campaign, turn, enemy, "either", `${enemy.displayName}: escape the grapple`);
  const hold = rollCharacterCheck(campaign, holder, { skill: "athletics" }, `${holder.name}: Athletics to hold the grapple`);
  if (hold.rollId) {
    turn.rollIds.push(hold.rollId);
  }
  const escaped = theirs > hold.total;
  if (escaped) {
    const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, [held.name]);
    patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
    publishEncounter(campaign.id);
  }
  return {
    ok: true,
    action: "escape",
    contest: `${theirs} vs ${hold.total}`,
    success: escaped,
    note: escaped
      ? `${enemy.displayName} breaks free of ${holder.name}'s grapple; it used its action to do it.`
      : `${holder.name} holds on; ${enemy.displayName} spent its action and is still grappled.`,
  };
}

// The grappler's reach in tiles: 1 for a character, a stat block's longest
// melee reach for an enemy (an otyugh's tentacle holds from 10 feet).
function reachOf(enemy: EncounterEnemy | null): number {
  if (!enemy) {
    return 1;
  }
  const reaches = enemy.stats.attacks
    .map((attack) => enemyAttackProfile(attack, enemy.stats.traits ?? []))
    .filter((profile) => profile.melee)
    .map((profile) => profile.reachTiles);
  return Math.max(1, ...reaches);
}

// Ends every grapple on the board whose two creatures now stand farther
// apart than the grappler's reach. Called after anything moves a token
// (the move route, move_token, an enemy's approach). Returns the names of
// those let go. A grapple with no recorded grappler, or off the board, is
// left alone.
export function releaseGrapplesOutOfReach(campaign: Campaign): string[] {
  const encounter = getActiveEncounter(campaign.id);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map) {
    return [];
  }
  const enemies = listEnemies(encounter.id);
  const apart = (a: string, b: string): number | null => {
    const one = getTokenByRef(map.id, a);
    const two = getTokenByRef(map.id, b);
    return one && two ? Math.max(Math.abs(one.x - two.x), Math.abs(one.y - two.y)) : null;
  };
  const released: string[] = [];
  for (const enemy of enemies) {
    const held = grappleOf(enemy.conditionMeta);
    if (enemy.status !== "alive" || !held?.source || !enemy.conditions.some((c) => c.toLowerCase() === GRAPPLED)) {
      continue;
    }
    const gap = apart(enemy.id, held.source);
    if (gap !== null && gap > reachOf(enemies.find((entry) => entry.id === held.source) ?? null)) {
      const cleared = removeConditions(enemy.conditions, enemy.conditionMeta, [held.name]);
      patchEnemyConditions(enemy.id, cleared.conditions, cleared.meta);
      released.push(enemy.displayName);
    }
  }
  for (const sheet of listSheets(campaign.id)) {
    const held = grappleOf(sheet.conditionMeta as ConditionMetaMap);
    if (!held?.source || !sheet.conditions.some((c) => c.toLowerCase() === GRAPPLED)) {
      continue;
    }
    const gap = apart(sheet.id, held.source);
    if (gap !== null && gap > reachOf(enemies.find((entry) => entry.id === held.source) ?? null)) {
      const cleared = withoutGrapple(sheet.conditions, sheet.conditionMeta as ConditionMetaMap, held);
      const updated = patchSheet(sheet.id, { conditions: cleared.conditions, conditionMeta: cleared.meta });
      if (updated) {
        publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
      }
      released.push(sheet.name);
    }
  }
  if (released.length) {
    publishEncounter(campaign.id);
  }
  return released;
}
