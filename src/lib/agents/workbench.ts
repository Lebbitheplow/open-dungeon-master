// The tools a connected agent gets (a player's own Claude Code, Codex or any
// MCP client). Each tool is one web route, called over loopback as the
// player with a short-lived login session (src/lib/agents/grants.ts). So an
// agent can do exactly what the player could do in the browser, through the
// same membership, lead and DM-seat checks, the same validation and the same
// events, and nothing else. There is no second copy of the permissions to
// drift, which is the whole reason it is built this way.
//
// Deliberately absent, on every scope: backend URLs and API keys (the story
// settings route), accounts and passwords, the admin panel, backup and
// restore, and raw sheet edits. Those stay in the browser.

import { harnessMcpUrl } from "@/lib/harness/bridge";
import { grantSessionToken, grantUser, type AgentScope, type ConnectionGrant } from "@/lib/agents/grants";
import type { McpToolDefinition } from "@/lib/harness/types";

// Claude Code drops tool results over roughly 25K tokens; staying well under
// it keeps a big campaign snapshot readable rather than silently lost.
const MAX_RESULT_CHARS = 60_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Args = Record<string, unknown>;

type WorkbenchTool = {
  name: string;
  scope: AgentScope;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  // Extra body fields are passed through to the route, which validates them.
  open?: boolean;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: (args: Args) => string;
  body?: (args: Args) => unknown;
  // Guard evaluated before the call, e.g. an explicit confirm.
  check?: (args: Args) => string | null;
};

const campaignIdProp = { campaignId: { type: "string", description: "The campaign's id (from odm_list_campaigns)." } };

function pick(args: Args, keys: string[]): Args {
  const out: Args = {};
  for (const key of keys) {
    if (args[key] !== undefined) {
      out[key] = args[key];
    }
  }
  return out;
}

function without(args: Args, keys: string[]): Args {
  const out: Args = { ...args };
  for (const key of keys) {
    delete out[key];
  }
  return out;
}

function seg(value: unknown): string {
  const text = String(value ?? "");
  if (!ID.test(text)) {
    throw new Error("That id is not valid.");
  }
  return encodeURIComponent(text);
}

const needConfirm = (args: Args) => (args.confirm === true ? null : "This cannot be undone. Call again with confirm: true.");

export const WORKBENCH_TOOLS: WorkbenchTool[] = [
  // read
  {
    name: "odm_list_campaigns",
    scope: "read",
    description: "List the campaigns and workshops you belong to.",
    properties: {},
    method: "GET",
    path: () => "/api/campaigns",
  },
  {
    name: "odm_get_campaign",
    scope: "read",
    description: "Read one campaign as you see it at the table: scene, recent messages, party, encounter (secrets only if you hold the DM seat or steer the story).",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}`,
  },
  {
    name: "odm_quests",
    scope: "read",
    description: "Read a campaign's quest log.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/quests`,
  },
  {
    name: "odm_timeline",
    scope: "read",
    description: "Read a campaign's timeline of chapters and events.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/timeline`,
  },
  {
    name: "odm_lore",
    scope: "read",
    description: "Read a campaign's lore binder entries you can see.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/lore`,
  },
  {
    name: "odm_list_characters",
    scope: "read",
    description: "List the characters in your library.",
    properties: {},
    method: "GET",
    path: () => "/api/characters",
  },
  {
    name: "odm_get_character",
    scope: "read",
    description: "Read one of your library characters in full.",
    properties: { characterId: { type: "string" } },
    required: ["characterId"],
    method: "GET",
    path: (a) => `/api/characters/${seg(a.characterId)}`,
  },
  // play
  {
    name: "odm_take_action",
    scope: "play",
    description: "Act at the table as your character, exactly as typing in the chat box: 'do' is an action, 'say' is speech, 'ooc' is out of character. The Dungeon Master answers in the campaign.",
    properties: {
      ...campaignIdProp,
      content: { type: "string", maxLength: 2000 },
      kind: { type: "string", enum: ["do", "say", "ooc"] },
    },
    required: ["campaignId", "content"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/actions`,
    body: (a) => pick(a, ["content", "kind"]),
  },
  {
    name: "odm_ask",
    scope: "play",
    description: "Ask the campaign's records a question (what happened, who someone is). Private to you unless visibility says otherwise.",
    properties: {
      ...campaignIdProp,
      question: { type: "string" },
      scope: { type: "string" },
      visibility: { type: "string" },
    },
    required: ["campaignId", "question"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/ask`,
    body: (a) => pick(a, ["question", "scope", "visibility"]),
  },
  {
    name: "odm_answer_roll",
    scope: "play",
    description: "Enter the dice you rolled at the table for a roll the Dungeon Master is waiting on (the faces, one number per die), or ask the server to roll it with fallback: 'digital'.",
    properties: {
      ...campaignIdProp,
      pendingRollId: { type: "string" },
      dice: { type: "array", items: { type: "integer", minimum: 1, maximum: 100 } },
      fallback: { type: "string", enum: ["digital"] },
    },
    required: ["campaignId", "pendingRollId"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/pending-rolls/${seg(a.pendingRollId)}`,
    body: (a) => (a.fallback === "digital" ? { fallback: "digital" } : { dice: a.dice }),
  },
  {
    name: "odm_end_turn",
    scope: "play",
    description: "End your character's turn in combat.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/encounter/end-turn`,
    body: () => ({}),
  },
  // characters
  {
    name: "odm_create_character",
    scope: "characters",
    description: "Add a character to your library. Pass level, role ('pc' or 'companion') and a full sheet in the same shape odm_get_character returns.",
    properties: { level: { type: "integer", minimum: 1, maximum: 20 }, role: { type: "string" }, sheet: { type: "object" } },
    required: ["level", "sheet"],
    open: true,
    method: "POST",
    path: () => "/api/characters",
    body: (a) => a,
  },
  {
    name: "odm_update_character",
    scope: "characters",
    description: "Replace one of your library characters' sheet (level and sheet, same shape as odm_get_character).",
    properties: { characterId: { type: "string" }, level: { type: "integer" }, sheet: { type: "object" } },
    required: ["characterId", "level", "sheet"],
    method: "PATCH",
    path: (a) => `/api/characters/${seg(a.characterId)}`,
    body: (a) => pick(a, ["level", "sheet"]),
  },
  {
    name: "odm_delete_character",
    scope: "characters",
    description: "Delete one of your library characters. Needs confirm: true.",
    properties: { characterId: { type: "string" }, confirm: { type: "boolean" } },
    required: ["characterId", "confirm"],
    method: "DELETE",
    path: (a) => `/api/characters/${seg(a.characterId)}`,
    check: needConfirm,
  },
  // campaigns (the lead's own)
  {
    name: "odm_create_campaign",
    scope: "campaigns",
    description: "Create a campaign you lead. Pass the same fields the campaign creator does (title, description, theme, maxPlayers, startingLevel, difficulty, gameSettings).",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      theme: { type: "string" },
      maxPlayers: { type: "integer" },
      startingLevel: { type: "integer" },
      difficulty: { type: "string" },
    },
    required: ["title"],
    open: true,
    method: "POST",
    path: () => "/api/campaigns",
    body: (a) => a,
  },
  {
    name: "odm_update_game_settings",
    scope: "campaigns",
    description: "Change a campaign's game rules and table settings (party lead only). Send only what changes: settings left out keep their values, and a group such as variantRules or safety may be sent in part. Story backend and keys cannot be changed here.",
    properties: { ...campaignIdProp },
    required: ["campaignId"],
    open: true,
    method: "PATCH",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/settings`,
    body: (a) => without(a, ["campaignId"]),
  },
  {
    name: "odm_get_invite",
    scope: "campaigns",
    description: "Read a campaign's invite code and link (party lead only).",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/invite`,
  },
  // dm (only works for the person in the DM seat of a human or assisted game)
  {
    name: "odm_dm_catalog",
    scope: "dm",
    description: "List the rules-engine actions the Dungeon Master can take (only in a campaign where you hold the DM seat).",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/dm/invoke`,
  },
  {
    name: "odm_dm_invoke",
    scope: "dm",
    description: "Take one rules-engine action as the Dungeon Master (damage, conditions, encounters, rolls...). The engine resolves it exactly as the DM console does.",
    properties: { ...campaignIdProp, name: { type: "string" }, args: { type: "object" } },
    required: ["campaignId", "name"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/dm/invoke`,
    body: (a) => ({ name: a.name, args: a.args ?? {} }),
  },
  {
    name: "odm_dm_narrate",
    scope: "dm",
    description: "Post narration to the table as the Dungeon Master.",
    properties: { ...campaignIdProp, content: { type: "string", maxLength: 8000 }, speaker: { type: "object" } },
    required: ["campaignId", "content"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/dm/narrate`,
    body: (a) => pick(a, ["content", "speaker"]),
  },
];

const WHOAMI: McpToolDefinition = {
  name: "odm_whoami",
  description: "Who this connection acts as, and what it may do.",
  inputSchema: { type: "object", properties: {} },
};

export function workbenchTools(grant: ConnectionGrant): McpToolDefinition[] {
  return [
    WHOAMI,
    ...WORKBENCH_TOOLS.filter((tool) => grant.scopes.includes(tool.scope)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object" as const,
        properties: tool.properties,
        ...(tool.required ? { required: tool.required } : {}),
        ...(tool.open ? {} : { additionalProperties: false }),
      },
    })),
  ];
}

export function serverOrigin(): string {
  return new URL(harnessMcpUrl()).origin;
}

export type WorkbenchOutcome = { text: string; isError: boolean; campaignId?: string };

export async function workbenchCall(grant: ConnectionGrant, name: string, args: Args): Promise<WorkbenchOutcome> {
  if (name === "odm_whoami") {
    const user = grantUser(grant);
    return {
      text: JSON.stringify({
        username: user?.username,
        connection: grant.name,
        scopes: grant.scopes,
        campaignId: grant.campaignId,
        expiresAt: grant.expiresAt,
      }),
      isError: false,
    };
  }
  const tool = WORKBENCH_TOOLS.find((entry) => entry.name === name);
  if (!tool || !grant.scopes.includes(tool.scope)) {
    return { text: `Unknown tool ${name} for this connection.`, isError: true };
  }
  const campaignId = typeof args.campaignId === "string" ? args.campaignId : undefined;
  // A connection pinned to one campaign may not reach any other.
  if (grant.campaignId && campaignId && campaignId !== grant.campaignId) {
    return { text: "This connection is limited to a different campaign.", isError: true };
  }
  if (grant.campaignId && tool.name === "odm_create_campaign") {
    return { text: "This connection is limited to one campaign and cannot create new ones.", isError: true };
  }
  const refusal = tool.check?.(args);
  if (refusal) {
    return { text: refusal, isError: true, campaignId };
  }
  let path: string;
  try {
    path = tool.path(args);
  } catch (error) {
    return { text: error instanceof Error ? error.message : "Bad arguments.", isError: true, campaignId };
  }
  const body = tool.body?.(args);
  let response: Response;
  try {
    response = await fetch(`${serverOrigin()}${path}`, {
      method: tool.method,
      headers: {
        Authorization: `Bearer ${grantSessionToken(grant)}`,
        Accept: "application/json",
        "x-odm-client": "agent",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    return { text: `The server could not be reached: ${error instanceof Error ? error.message : error}`, isError: true, campaignId };
  }
  let text = await response.text();
  if (grant.campaignId && tool.name === "odm_list_campaigns") {
    try {
      const parsed = JSON.parse(text) as { campaigns?: Array<{ id?: string }> };
      if (Array.isArray(parsed.campaigns)) {
        parsed.campaigns = parsed.campaigns.filter((campaign) => campaign.id === grant.campaignId);
        text = JSON.stringify(parsed);
      }
    } catch {
      // Leave it as the route answered.
    }
  }
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated: ${text.length - MAX_RESULT_CHARS} more characters]`;
  }
  if (!response.ok) {
    return { text: `HTTP ${response.status}: ${text || response.statusText}`, isError: true, campaignId };
  }
  return { text: text || "{}", isError: false, campaignId };
}
