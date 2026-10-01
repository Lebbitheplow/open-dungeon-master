// Attacks a character makes with their reaction off their own turn beyond an
// opportunity attack and a readied action: Giant Killer (a Hunter ranger's
// Hunter's Prey pick, SRD 5.1): "When a Large or larger creature within 5 feet
// of you hits or misses you with an attack, you can use your reaction to
// attack that creature immediately after its attack."
//
// The attack it answers is the last one recorded against the ranger
// (src/lib/dm/last-hit.ts): same round and turn, by that creature, and not
// answered by Giant Killer already.

import { sizeRank } from "@/lib/bestiary/statblock";
import type { EncounterEnemy } from "@/lib/db/encounters";
import { tilesBetween } from "@/lib/dm/attack-spatial";
import { freshLastHit, writeLastHit } from "@/lib/dm/last-hit";
import { holdsFeature } from "@/lib/srd/trait-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const GIANT_KILLER = "giant killer";
const LARGE = sizeRank("Large");

export function holdsGiantKiller(sheet: CharacterSheet): boolean {
  return holdsFeature(sheet, "hunter's prey: giant killer", "giant killer");
}

// Whether this off-turn attack is Giant Killer's: the ranger holds it, and
// the creature is Large or larger, within 5 feet, and just attacked them.
export function giantKillerOpen(
  campaignId: string,
  encounterId: string,
  sheet: CharacterSheet,
  enemy: EncounterEnemy,
): boolean {
  if (!holdsGiantKiller(sheet) || sizeRank(String(enemy.stats.size ?? "Medium")) < LARGE) {
    return false;
  }
  const record = freshLastHit(campaignId, sheet.id);
  if (
    !record ||
    record.source !== "attack" ||
    record.attacker.kind !== "enemy" ||
    record.attacker.id !== enemy.id ||
    record.answered.includes(GIANT_KILLER)
  ) {
    return false;
  }
  const apart = tilesBetween(encounterId, sheet.id, enemy.id);
  return apart === null || apart <= 1;
}

// The attack it allowed has been made: the record is answered.
export function spendGiantKiller(campaignId: string, sheetId: string) {
  const record = freshLastHit(campaignId, sheetId);
  if (record && !record.answered.includes(GIANT_KILLER)) {
    writeLastHit(campaignId, { ...record, answered: [...record.answered, GIANT_KILLER] });
  }
}
