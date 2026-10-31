// The MCP tools for player webhooks (docs/player-webhooks.md). They act only
// on the calling connection's own subscriptions, need read and play, and are
// listed only on a server where a subscription can be made: an operator
// allowed receiver origins (Admin > Player agents or
// ODM_PLAYER_WEBHOOK_ORIGINS) or turned poll links on. With neither, nobody
// could subscribe, so an agent is not shown tools that could only fail.

import type { ConnectionGrant } from "@/lib/agents/grants";
import type { WorkbenchOutcome } from "@/lib/agents/workbench";
import type { McpToolDefinition } from "@/lib/harness/types";
import {
  createPlayerPollLink,
  createPlayerWebhook,
  deletePlayerWebhook,
  listPlayerWebhooks,
  playerSignalsEnabled,
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
    description: "The current opportunity from odm_get_player_webhook_opportunities. At most one submission per tool per opportunity; identical retries return the saved result. Each step of a combat turn has its own. A refused submission names the opportunity to send its correction with.",
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
    description: "Send signed decision notifications for your active character to an operator-approved HTTPS receiver. Requires read and play. Returns a signingSecret once; save it privately in the receiver, never in chat. If the receiver itself requires an Authorization header (a hosted agent webhook), pass its exact value as authorizationHeader; it is stored like the signing secret, sent on every delivery and never listed back. Other headers a hosted receiver requires (Claude's anthropic-version) go in headers, at most four, with the same treatment. A receiver adapter must wake your agent; MCP alone does not. If nothing can receive requests for you, pass delivery \"poll\" and no url instead (where the admin turned poll links on): you get a pollPath once; put this server's address in front of it and have your hook GET it every minute or so, waking you when wake is true and fingerprint differs from the one it last woke you for. The link is a secret; keep it out of chat. Read current campaign state before acting.",
    inputSchema: {
      type: "object",
      properties: {
        campaignId: { type: "string", description: "The campaign's id (from odm_list_campaigns)." },
        characterId: { type: "string", description: "The active campaign sheet id, not the library id." },
        url: { type: "string", description: "The receiver's HTTPS address. Leave out with delivery \"poll\"." },
        delivery: {
          type: "string",
          enum: ["push", "poll"],
          description: "Optional. \"push\" (the default) sends signed requests to url. \"poll\" makes a secret link your hook checks instead, for an agent nothing can send requests to.",
        },
        authorizationHeader: {
          type: "string",
          maxLength: 1024,
          description: "Optional. Sent verbatim as the Authorization header on every delivery, e.g. 'Bearer <receiver token>'. Printable ASCII, no line breaks.",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string", maxLength: 1024 },
          maxProperties: 4,
          description: "Optional. Up to four more headers sent on every delivery, e.g. { \"anthropic-version\": \"2023-06-01\" }. Not Authorization (use authorizationHeader), framing, cookie, proxy or X-ODM-* headers. Values are never listed back.",
        },
      },
      required: ["campaignId", "characterId"],
      additionalProperties: false,
    },
  },
  {
    name: "odm_list_player_webhooks",
    description: "List this connection's webhook subscriptions and pending/failed delivery counts. Signing secrets and header values are never listed; hasAuthorizationHeader and headerNames say what is set.",
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
  return playerSignalsEnabled() && playerScopes(grant) ? WEBHOOK_TOOLS : [];
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
    if (name === "odm_subscribe_player_webhook" && args.delivery === "poll") {
      if (typeof args.campaignId !== "string" || typeof args.characterId !== "string") {
        throw new Error("Supply campaignId and characterId.");
      }
      if (args.url !== undefined || args.authorizationHeader !== undefined || args.headers !== undefined) {
        throw new Error("A poll link takes no url or headers: nothing is sent to it.");
      }
      const created = createPlayerPollLink(grant, { campaignId: args.campaignId, characterId: args.characterId });
      return { text: JSON.stringify(created), isError: false, campaignId: args.campaignId };
    }
    if (name === "odm_subscribe_player_webhook") {
      if (args.delivery !== undefined && args.delivery !== "push") {
        throw new Error("delivery is \"push\" or \"poll\".");
      }
      if (typeof args.campaignId !== "string" || typeof args.characterId !== "string" || typeof args.url !== "string") {
        throw new Error("Supply campaignId, characterId and url.");
      }
      if (args.authorizationHeader !== undefined && typeof args.authorizationHeader !== "string") {
        throw new Error("authorizationHeader must be a string.");
      }
      const created = createPlayerWebhook(grant, {
        campaignId: args.campaignId,
        characterId: args.characterId,
        url: args.url,
        authorizationHeader: args.authorizationHeader,
        headers: args.headers,
      });
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
