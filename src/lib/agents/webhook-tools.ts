// The MCP tools for player webhooks (docs/player-webhooks.md). They act only
// on the calling connection's own subscriptions, need read and play, and are
// listed only on a server whose operator allowed receiver origins
// (ODM_PLAYER_WEBHOOK_ORIGINS): with none allowed, nobody could subscribe, so
// an agent is not shown tools that could only fail.

import type { ConnectionGrant } from "@/lib/agents/grants";
import type { WorkbenchOutcome } from "@/lib/agents/workbench";
import type { McpToolDefinition } from "@/lib/harness/types";
import {
  createPlayerWebhook,
  deletePlayerWebhook,
  listPlayerWebhooks,
  playerWebhooksEnabled,
  playerWebhookState,
} from "@/lib/agents/webhooks";

// The guard a webhook-driven write carries (reserveWebhookWrite).
export const WEBHOOK_GUARD_PROPS = {
  subscriptionId: {
    type: "string",
    description: "For webhook-driven play: your subscription id. Supply together with opportunityId to prevent duplicate/stale submissions.",
  },
  opportunityId: {
    type: "string",
    description: "The current opportunity from odm_get_player_webhook_opportunities. At most one submission per tool per opportunity; identical retries return the saved result.",
  },
};

const WEBHOOK_TOOLS: McpToolDefinition[] = [
  {
    name: "odm_get_player_webhook_opportunities",
    description: "Read the current legal opportunities and lifecycle for one of your webhooks. Check this and the campaign before each webhook-driven write. Old deliveries can be stale.",
    inputSchema: {
      type: "object",
      properties: { subscriptionId: { type: "string" } },
      required: ["subscriptionId"],
      additionalProperties: false,
    },
  },
  {
    name: "odm_subscribe_player_webhook",
    description: "Send signed decision notifications for your active character to an operator-approved HTTPS receiver. Requires read and play. Returns a signingSecret once; save it privately in the receiver, never in chat. A receiver adapter must wake your agent; MCP alone does not. Read current campaign state before acting.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign's id (from odm_list_campaigns)." },
        characterId: { type: "string", description: "The active campaign sheet id, not the library id." },
        url: { type: "string" },
      },
      required: ["campaignId", "characterId", "url"],
      additionalProperties: false,
    },
  },
  {
    name: "odm_list_player_webhooks",
    description: "List this connection's webhook subscriptions and pending/failed delivery counts. Signing secrets are never listed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "odm_unsubscribe_player_webhook",
    description: "Remove one of this connection's webhooks and its delivery history. Play also stops when the connection is revoked, expires, or its active character changes.",
    inputSchema: {
      type: "object",
      properties: { subscriptionId: { type: "string" } },
      required: ["subscriptionId"],
      additionalProperties: false,
    },
  },
];

const playerScopes = (grant: ConnectionGrant) => grant.scopes.includes("read") && grant.scopes.includes("play");

export function webhookTools(grant: ConnectionGrant): McpToolDefinition[] {
  return playerWebhooksEnabled() && playerScopes(grant) ? WEBHOOK_TOOLS : [];
}

export function isWebhookTool(name: string): boolean {
  return WEBHOOK_TOOLS.some((tool) => tool.name === name);
}

// Still answered when delivery is switched off, so a connection can list and
// remove a subscription it made while it was on.
export function webhookToolCall(grant: ConnectionGrant, name: string, args: Record<string, unknown>): WorkbenchOutcome {
  if (!playerScopes(grant)) {
    return { text: "Webhooks need read and play scopes.", isError: true };
  }
  try {
    if (name === "odm_subscribe_player_webhook") {
      if (typeof args.campaignId !== "string" || typeof args.characterId !== "string" || typeof args.url !== "string") {
        throw new Error("Supply campaignId, characterId and url.");
      }
      const created = createPlayerWebhook(grant, { campaignId: args.campaignId, characterId: args.characterId, url: args.url });
      return { text: JSON.stringify(created), isError: false, campaignId: args.campaignId };
    }
    if (name === "odm_list_player_webhooks") {
      return { text: JSON.stringify({ subscriptions: listPlayerWebhooks(grant.id) }), isError: false };
    }
    if (typeof args.subscriptionId !== "string") {
      throw new Error("Supply subscriptionId.");
    }
    if (name === "odm_get_player_webhook_opportunities") {
      return { text: JSON.stringify(playerWebhookState(grant, args.subscriptionId)), isError: false };
    }
    return { text: JSON.stringify({ removed: deletePlayerWebhook(grant.id, args.subscriptionId) }), isError: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : "Webhook request failed.", isError: true };
  }
}
