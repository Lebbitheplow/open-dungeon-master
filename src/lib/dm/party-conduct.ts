import { allocateSeq, getCampaignById, type Campaign } from "@/lib/db/campaigns";
import { getBattleMapForEncounter, getTokenByRef } from "@/lib/db/battle-maps";
import { companionConduct, saveConduct } from "@/lib/db/companion-conduct";
import { companionValues } from "@/lib/db/companion-conscience";
import { companionNpcFor } from "@/lib/db/companion-npcs";
import { getActiveEncounter, listEnemies } from "@/lib/db/encounters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listRelationships } from "@/lib/db/relationships";
import { listSheets } from "@/lib/db/sheets";
import { footprintForSize } from "@/lib/battlemap/footprint";
import { canEnemyAct } from "@/lib/dm/can-act";
import { sideOf } from "@/lib/dm/combatant";
import { conscienceSetting, consciousCompanions, worstApproval } from "@/lib/dm/conscience";
import { opportunityWeapon } from "@/lib/dm/enemy-profile";
import { leavesReachAt } from "@/lib/dm/opportunity-reach-logic";
import {
  aidRefusal,
  aidRefusedWords,
  demandMet,
  demandRefusal,
  REFUSAL_SHOWN_MINUTES,
  riskyOrderRefusal,
  shareOwed,
  type Spend,
} from "@/lib/dm/party-conduct-logic";
import type { ToolError } from "@/lib/dm/tool-errors";
import { publishEphemeral, publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import { hasItemTag } from "@/lib/srd/item-tags";
import { findCarriedItem } from "@/lib/dm/item-logic";
import { resolveSheetRef } from "@/lib/dm/rolls";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { conditionBlocksReactions } from "@/lib/srd/condition-effects";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// A lasting companion inside the party (issue 503 Phase 4), the rim around
// src/lib/dm/party-conduct-logic.ts: the server checks where the companion
// is the actor. A refusal is the server's outcome: the call does nothing and
// says why, the table reads one line, and the companion's Bonds row shows it
// for the day. Off tables keep approval social only; a companion set against
// the party (turncoat.ts) is past all of it.

type Xy = { x: number; y: number };

function now(campaign: Campaign): number {
  return (getCampaignById(campaign.id) ?? campaign).clock.instant;
}

function tableLine(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({ campaignId: campaign.id, seq, authorType: "system", glyph: "system-party", content });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

// The character a call's id or name names (rolls.ts resolveSheetRef).
function characterNamed(campaignId: string, ref: unknown): CharacterSheet | null {
  if (typeof ref !== "string") {
    return null;
  }
  const sheets = listSheets(campaignId);
  return resolveSheetRef(ref, sheets, new Map(sheets.map((sheet) => [sheet.id, sheet])));
}

// The companion this ref names, while its conscience runs at this table.
function conscientious(campaign: Campaign, ref: unknown): { sheet: CharacterSheet; npcId: string } | null {
  const sheet = conscienceSetting(campaign) === "off" ? null : characterNamed(campaign.id, ref);
  if (!sheet || !consciousCompanions([sheet]).length) {
    return null;
  }
  const npc = companionNpcFor(sheet);
  return npc ? { sheet, npcId: npc.id } : null;
}

// The companion's standing with one character, or null when they have none.
export function standingWith(campaignId: string, companionName: string, characterId: string): number | null {
  const key = textKey(companionName);
  const bond = listRelationships(campaignId).find(
    (entry) => entry.status === "active" && entry.characterId === characterId && textKey(entry.subjectName) === key,
  );
  return bond ? bond.approval : null;
}

function dying(sheet: CharacterSheet): boolean {
  return sheet.currentHp <= 0 && !sheet.deathSaves?.dead && !sheet.deathSaves?.stable;
}

// Written, told and shown: the refusal the call returns.
function refuse(campaign: Campaign, npcId: string, companion: string, what: string, reason: string): ToolError {
  saveConduct(npcId, { ...companionConduct(npcId), refused: { what, at: now(campaign) } });
  tableLine(campaign, `${companion} refuses ${what}.`);
  publishEphemeral(campaign.id, "relationships_updated", {});
  return { error: reason, refused: "rules" };
}

// ---- aid ----

function aidGate(campaign: Campaign, actorRef: unknown, targets: readonly unknown[], spend: Spend | null): ToolError | null {
  const actor = spend ? conscientious(campaign, actorRef) : null;
  if (!actor) {
    return null;
  }
  for (const ref of targets) {
    const target = characterNamed(campaign.id, ref);
    if (!target || target.id === actor.sheet.id) {
      continue;
    }
    const aid = { companion: actor.sheet.name, target: target.name, approval: standingWith(campaign.id, actor.sheet.name, target.id), dying: dying(target), spend: spend! };
    const refused = aidRefusal(aid);
    if (refused) {
      return refuse(campaign, actor.npcId, actor.sheet.name, aidRefusedWords(aid), refused);
    }
  }
  return null;
}

// ---- the mercenary's share ----

function shareGate(campaign: Campaign, actorRef: unknown): ToolError | null {
  const encounter = getActiveEncounter(campaign.id);
  const actor = encounter ? conscientious(campaign, actorRef) : null;
  if (!actor || !encounter) {
    return null;
  }
  const conduct = companionConduct(actor.npcId);
  const demand = conduct.demand;
  if (!demand || demand.encounterId !== encounter.id) {
    return null;
  }
  if (demandMet(demand, actor.sheet.gold)) {
    saveConduct(actor.npcId, { ...conduct, demand: null });
    tableLine(campaign, `${actor.sheet.name} takes their share and fights.`);
    publishEphemeral(campaign.id, "relationships_updated", {});
    return null;
  }
  return refuse(campaign, actor.npcId, actor.sheet.name, "to fight unpaid", demandRefusal(actor.sheet.name, demand, actor.sheet.gold));
}

// A fight has started (start_encounter): each mercenary wary of the party,
// or worse, asks its share. Returns what the DM is told.
export function askShares(campaign: Campaign): string[] {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || conscienceSetting(campaign) === "off") {
    return [];
  }
  const sheets = listSheets(campaign.id);
  const notes: string[] = [];
  for (const companion of consciousCompanions(sheets)) {
    const npc = companionNpcFor(companion);
    const owed = npc ? shareOwed({ values: companionValues(npc.id), worstApproval: worstApproval(campaign.id, companion.name, sheets), level: companion.level }) : null;
    if (!npc || !owed) {
      continue;
    }
    saveConduct(npc.id, { ...companionConduct(npc.id), demand: { amount: owed, goldBefore: companion.gold, encounterId: encounter.id } });
    tableLine(campaign, `${companion.name} wants their share before they fight: ${owed} gp.`);
    notes.push(`${companion.name} demands their share before fighting: ${owed} gp. Until a party member pays it (modify_gold), they neither attack nor cast. Voice the demand.`);
  }
  if (notes.length) {
    publishEphemeral(campaign.id, "relationships_updated", {});
  }
  return notes;
}

// ---- the gate ----

function slotSpell(spell: unknown): boolean {
  return typeof spell === "string" && (spellLevelOf(spell) ?? 0) > 0;
}

// A potion, by the item the carrier holds (or the SRD row of its name).
function potionNamed(actorRef: unknown, campaignId: string, item: unknown): boolean {
  if (typeof item !== "string" || !item.trim()) {
    return false;
  }
  const carrier = characterNamed(campaignId, actorRef);
  const carried = carrier ? findCarriedItem(carrier.equipment, item) : null;
  return hasItemTag(carried ?? { name: item }, "potion");
}

// Before a call a lasting companion may be the actor of: its share unpaid
// in a fight refuses an attack or a spell; a slot or potion spent on a
// character it is wary of, or worse, is refused unless they are dying.
export function conductGate(campaign: Campaign, name: string, rawArguments: string): ToolError | null {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArguments || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }
  // Arguments that are not an object are the tool's own to refuse.
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return null;
  }
  switch (name) {
    case "pc_attack":
    case "cast_at_enemy":
      return shareGate(campaign, args.characterId);
    case "cast_buff": {
      const targets = Array.isArray(args.targetCharacterIds) ? args.targetCharacterIds : [];
      return shareGate(campaign, args.characterId) ?? aidGate(campaign, args.characterId, targets, slotSpell(args.spell) ? "slot" : null);
    }
    case "heal":
      return typeof args.spell === "string" && args.spell.trim() && args.casterId
        ? (shareGate(campaign, args.casterId) ?? aidGate(campaign, args.casterId, [args.characterId], "slot"))
        : null;
    case "use_item":
      return args.targetCharacterId && potionNamed(args.characterId, campaign.id, args.item ?? args.name)
        ? aidGate(campaign, args.characterId, [args.targetCharacterId], "potion")
        : null;
    default:
      return null;
  }
}

// ---- orders ----

// The foes whose reach this walk leaves, each with its reaction to spend: who
// would strike the walker as it goes.
export function provokers(campaignId: string, walkerId: string, steps: readonly Xy[]): string[] {
  const encounter = getActiveEncounter(campaignId);
  const map = encounter ? getBattleMapForEncounter(encounter.id) : null;
  if (!encounter || !map || steps.length < 2) {
    return [];
  }
  const side = sideOf(encounter, "sheet", walkerId);
  return listEnemies(encounter.id).flatMap((enemy) => {
    if (sideOf(encounter, "enemy", enemy.id, enemy) === side || encounter.reactionsUsed.includes(enemy.id)) {
      return [];
    }
    if (!canEnemyAct({ enemy, encounter, kind: "reaction" }).ok || conditionBlocksReactions(enemy.conditions)) {
      return [];
    }
    const token = getTokenByRef(map.id, enemy.id);
    const weapon = opportunityWeapon(enemy.stats);
    return token && weapon && leavesReachAt([...steps], token, weapon.reachTiles, footprintForSize(enemy.stats.size)) ? [enemy.displayName] : [];
  });
}

// A player's order to the companion they command: one that walks it out of
// a foe's reach is refused when it is wary of that player's character, or
// worse. Null when the order stands.
export function riskyOrderGate(campaign: Campaign, companion: CharacterSheet, commanderId: string, steps: readonly Xy[], disengaged: boolean): string | null {
  const actor = !disengaged && companion.commandedBy === commanderId ? conscientious(campaign, companion.id) : null;
  if (!actor) {
    return null;
  }
  const theirs = listSheets(campaign.id).filter((sheet) => sheet.userId === commanderId && !sheet.isCompanion);
  const standings = theirs.map((sheet) => standingWith(campaign.id, companion.name, sheet.id)).filter((value): value is number => value !== null);
  const approval = standings.length ? Math.min(...standings) : null;
  const commander = theirs.find((sheet) => standingWith(campaign.id, companion.name, sheet.id) === approval)?.name ?? "their commander";
  const refused = riskyOrderRefusal({ companion: companion.name, commander, approval, provokers: provokers(campaign.id, companion.id, steps) });
  return refused ? refuse(campaign, actor.npcId, companion.name, `an order from ${commander}`, refused).error : null;
}

// ---- what the Bonds row shows ----

export type ConductView = { demand?: string; refused?: string };

// Each lasting companion's share still owed in this fight and what it last
// refused today, by name key. Visible to every seat: the companion says it.
export function conductViews(campaign: Campaign): Map<string, ConductView> {
  const views = new Map<string, ConductView>();
  if (conscienceSetting(campaign) === "off") {
    return views;
  }
  const encounter = getActiveEncounter(campaign.id);
  const at = now(campaign);
  for (const companion of consciousCompanions(listSheets(campaign.id))) {
    const npc = companionNpcFor(companion);
    const conduct = npc ? companionConduct(npc.id) : null;
    if (!conduct) {
      continue;
    }
    const view: ConductView = {};
    const demand = conduct.demand;
    if (demand && encounter && demand.encounterId === encounter.id && !demandMet(demand, companion.gold)) {
      view.demand = `${demand.goldBefore + demand.amount - companion.gold} gp before they fight`;
    }
    if (conduct.refused && at - conduct.refused.at < REFUSAL_SHOWN_MINUTES) {
      view.refused = conduct.refused.what;
    }
    if (view.demand || view.refused) {
      views.set(textKey(companion.name), view);
    }
  }
  return views;
}
