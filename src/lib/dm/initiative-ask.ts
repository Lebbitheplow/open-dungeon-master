import type { Campaign } from "@/lib/db/campaigns";
import { listOpenPendingRolls, type DmTurn } from "@/lib/db/dm-turns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { handleRequestRoll } from "@/lib/dm/invoke-roll";
import { fieldedSheets } from "@/lib/dm/roster";

// Asking the table for initiative when a person runs it (issue 63).
//
// The AI's fight opens with the server rolling for every character whose
// dice it rolls, and the model is told to request_roll the rest. A person at
// the console was handed the same instruction, rendered as "Waiting on
// initiative from ...", and nothing asked anybody: no roll card reached a
// player, the order never locked, and the fight never began. So the engine
// asks for them, exactly as "Ask for a roll" with Initiative would: the
// server throws the dice for a player who lets it, and a player who holds
// their own rolls or rolls real dice gets the roll card.
//
// Who is asked: every fielded character with no place in the order and no
// initiative roll already waiting. The dead roll nothing and are not waited
// on (recordInitiativeRoll counts the same roster).

export type InitiativeAsk = {
  // "Name total" for each roll the server threw.
  rolled: string[];
  // Names of the characters whose player now holds an initiative roll card.
  waiting: string[];
  // The engine's note when the last roll locked the order.
  combat: string | null;
};

export function askForInitiative(
  campaign: Campaign,
  turn: DmTurn,
  realDiceUserIds: Set<string>,
): InitiativeAsk | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || encounter.orderReady) {
    return null;
  }
  const placed = new Set(
    encounter.order.flatMap((entry) => (entry.kind === "pc" ? [entry.characterId] : [])),
  );
  // A card from an earlier fight is nothing to wait on: nothing closes an
  // unanswered card, and it would stop the character being asked for this
  // one. A card from before a reset of this fight still counts.
  const asked = new Set(
    listOpenPendingRolls(campaign.id)
      .filter((pending) => pending.kind === "initiative" && pending.createdAt >= encounter.createdAt)
      .map((pending) => pending.characterId),
  );
  const sheets = listSheets(campaign.id);
  const sheetsById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const ask: InitiativeAsk = { rolled: [], waiting: [], combat: null };
  for (const sheet of fieldedSheets(campaign, sheets)) {
    if (placed.has(sheet.id) || asked.has(sheet.id) || sheet.deathSaves?.dead) {
      continue;
    }
    const out = handleRequestRoll(
      campaign,
      turn,
      JSON.stringify({ kind: "initiative", characterId: sheet.id, reason: "initiative" }),
      sheets,
      sheetsById,
      realDiceUserIds,
    );
    if (out.parked === true) {
      ask.waiting.push(sheet.name);
    } else if (typeof out.total === "number") {
      ask.rolled.push(`${sheet.name} ${out.total}`);
      if (typeof out.combat === "string") {
        ask.combat = out.combat;
      }
    }
  }
  return ask;
}

// What the console says about it, in a person's words.
export function describeInitiativeAsk(campaignId: string, ask: InitiativeAsk): Record<string, unknown> {
  const encounter = getActiveEncounter(campaignId);
  const current = encounter?.orderReady ? encounter.order[encounter.turnIndex] : undefined;
  return {
    ...(ask.rolled.length ? { initiative: ask.rolled.join(", ") } : {}),
    next: encounter?.orderReady
      ? `Every initiative is in; combat has begun.${current ? ` It is ${current.name}'s turn.` : ""}`
      : ask.waiting.length
        ? `${ask.waiting.join(", ")} ${ask.waiting.length === 1 ? "has" : "have"} an initiative roll to make. The order locks once every initiative is in.`
        : "The order locks once every initiative is in.",
  };
}
