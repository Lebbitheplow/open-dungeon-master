import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { findFactionByName, getFaction, listFactions, updateFaction } from "@/lib/db/factions";
import { insertFact } from "@/lib/db/facts";
import { getParty, setParty } from "@/lib/db/party";
import { publishEphemeral } from "@/lib/events";
import { clampReputation, reputationLabel } from "@/lib/dm/faction-logic";

// The faction tools (docs/vtt-parity-implementation-plan.md section 6):
// standing moves through adjust_reputation and nothing else; faction_note
// records a thing the world learned about a faction as a fact.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const FACTION_TOOL_NAMES = ["adjust_reputation", "faction_note"] as const;

export const factionTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "adjust_reputation",
      description:
        "Move the party's standing with a faction by a step or two after something they did in front of that faction's people: kept a bargain, robbed a caravan, saved a member. The server clamps it to the minus five to five ladder and every member's social checks lean on it from then on. Call it before narrating the faction's reaction.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          faction: { type: "string", description: "The faction's name or id from GAME STATE." },
          delta: { type: "integer", minimum: -2, maximum: 2, description: "Plus for regard, minus for grievance." },
          reason: { type: "string", description: "One line on what earned it." },
        },
        required: ["faction", "delta", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "faction_note",
      description: "Record something established about a faction (a move they made, a place they hold) as a world fact the table keeps.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          faction: { type: "string", description: "The faction's name or id." },
          note: { type: "string", description: "The fact, in one line." },
          secret: { type: "boolean", description: "True when only the DM should know it yet." },
        },
        required: ["faction", "note"],
      },
    },
  },
];

function resolveFaction(campaignId: string, ref: string) {
  const byId = getFaction(ref);
  if (byId && byId.campaignId === campaignId) {
    return byId;
  }
  return findFactionByName(campaignId, ref);
}

const adjustSchema = z.object({
  faction: z.string().trim().min(1),
  delta: z.coerce.number().int().min(-2).max(2),
  reason: z.string().trim().max(200).default(""),
});

export function handleAdjustReputation(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof adjustSchema>;
  try {
    args = adjustSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: adjust_reputation needs faction, delta and reason." };
  }
  const faction = resolveFaction(campaign.id, args.faction);
  if (!faction) {
    return { error: `No faction called "${args.faction}". Known: ${listFactions(campaign.id).map((entry) => entry.name).join(", ") || "none"}.` };
  }
  const party = getParty(campaign.id);
  const before = party.reputation[faction.id] ?? 0;
  const after = clampReputation(before + args.delta);
  setParty(campaign.id, { ...party, reputation: { ...party.reputation, [faction.id]: after } });
  if (args.reason) {
    insertFact({
      campaignId: campaign.id,
      category: "world",
      subject: faction.name,
      fact: `The party's standing with ${faction.name} ${args.delta > 0 ? "rose" : "fell"}: ${args.reason}`,
      knownBy: "party",
      source: "manual",
    });
    publishEphemeral(campaign.id, "facts_updated", {});
  }
  publishEphemeral(campaign.id, "factions_updated", { at: Date.now() });
  return { ok: true, faction: faction.name, before, after, standing: reputationLabel(after) };
}

const noteSchema = z.object({
  faction: z.string().trim().min(1),
  note: z.string().trim().min(1).max(300),
  secret: z.boolean().optional(),
});

export function handleFactionNote(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof noteSchema>;
  try {
    args = noteSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: faction_note needs faction and note." };
  }
  const faction = resolveFaction(campaign.id, args.faction);
  if (!faction) {
    return { error: `No faction called "${args.faction}".` };
  }
  insertFact({
    campaignId: campaign.id,
    category: "world",
    subject: faction.name,
    fact: args.note,
    knownBy: args.secret ? "dm" : "party",
    source: "manual",
  });
  publishEphemeral(campaign.id, "facts_updated", {});
  return { ok: true, faction: faction.name, recorded: args.note };
}

// The chapter tick and the arc hook both land here: power moves, the
// world remembers why.
export function shiftFactionPower(campaignId: string, factionId: string, power: number, fact: string): void {
  const faction = getFaction(factionId);
  if (!faction || faction.campaignId !== campaignId) {
    return;
  }
  updateFaction(factionId, { power });
  insertFact({ campaignId, category: "world", subject: faction.name, fact, knownBy: "dm", source: "simulation" });
}
