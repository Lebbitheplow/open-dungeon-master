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
// restore, and raw sheet edits. Those stay in the browser. A level-up is
// not a raw edit: odm_level_up sends the player's choices and the server
// builds the level from them (src/lib/srd/level-up.ts).

import { listAssignmentsForCharacter } from "@/lib/db/characters";
import { WORLD_LORE_CATEGORIES, type WorldLoreCategory } from "@/lib/dm/world-lore-logic";
import { harnessMcpUrl } from "@/lib/harness/bridge";
import { grantSessionToken, grantUser, type AgentScope, type ConnectionGrant } from "@/lib/agents/grants";
import type { McpToolDefinition } from "@/lib/harness/types";
import { createHash } from "node:crypto";
import {
  boundResultText,
  CAMPAIGN_VIEWS,
  campaignForAgent,
  historyForAgent,
  MAX_RESULT_CHARS,
  MIN_RESULT_CHARS,
  type CampaignView,
} from "@/lib/agents/agent-results";
import { finishWebhookWrite, playerSignalsEnabled, releaseWebhookWrite, reserveWebhookWrite } from "@/lib/agents/webhooks";
import { isWebhookTool, WEBHOOK_GUARD_PROPS, webhookToolCall, webhookTools } from "@/lib/agents/webhook-tools";
import { ASK_SCOPES, ASK_VISIBILITIES, QUESTION_MAX_CHARS } from "@/lib/dm/ask-logic";
import { APPROACH_CHOICES, SECRET_KINDS, SECRET_SKILLS } from "@/lib/dm/pact-logic";

const ID = /^[A-Za-z0-9_-]{1,64}$/;

type Args = Record<string, unknown>;

type ToolMethod = "GET" | "POST" | "PATCH" | "DELETE" | ((args: Args) => "GET" | "POST" | "PATCH" | "DELETE");

type WorkbenchTool = {
  name: string;
  scope: AgentScope;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  // Extra body fields are passed through to the route, which validates them.
  open?: boolean;
  // A function here lets one tool cover related verbs (create/patch/delete).
  method: ToolMethod;
  path: (args: Args) => string;
  body?: (args: Args) => unknown;
  // Guard evaluated before the call, e.g. an explicit confirm.
  check?: (args: Args) => string | null;
  // Reshapes a successful answer for an agent, under the result cap
  // (src/lib/agents/agent-results.ts). Others are only bounded.
  shape?: (text: string, args: Args) => string;
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
    description: "The live table, current to the newest message: call this first to see what is happening now and what you may do. Read one campaign as you see it at the table (secrets only if you hold the DM seat or steer the story). First the state that decides what you may do now: safety pause, table break, DM status, floor, your caps, pending rolls, encounter, disputes; then the party (with campaign.party.backstory, the table's shared party backstory, which may be empty), then the newest messages that fit, then recent rolls, notes and chapters. history.olderBefore pages back with odm_get_messages. Whispers the DM sent you alone are not here: odm_get_whispers reads them. To read less: view 'status' (may I act, and the newest message), 'recent' (status and the newest messages), 'sheet' (status and your sheets whole) or 'encounter' (status and the fight); sinceSeq returns only messages after a seq you have read (latestSeq from your last read); maxChars caps the reply. Every view keeps the state that decides whether you may act.",
    properties: {
      ...campaignIdProp,
      view: { type: "string", enum: [...CAMPAIGN_VIEWS], description: "How much to read (default full)." },
      sinceSeq: { type: "integer", minimum: 0, description: "Only messages after this seq (latestSeq from your last read)." },
      maxChars: { type: "integer", minimum: MIN_RESULT_CHARS, maximum: MAX_RESULT_CHARS, description: "The most characters the reply may run to." },
    },
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}`,
    shape: (text, a) =>
      campaignForAgent(text, MAX_RESULT_CHARS, {
        ...(typeof a.view === "string" && (CAMPAIGN_VIEWS as readonly string[]).includes(a.view) ? { view: a.view as CampaignView } : {}),
        ...(Number.isSafeInteger(a.sinceSeq) && (a.sinceSeq as number) >= 0 ? { sinceSeq: a.sinceSeq as number } : {}),
        ...(Number.isSafeInteger(a.maxChars) ? { maxChars: a.maxChars as number } : {}),
      }),
  },
  {
    name: "odm_get_messages",
    scope: "read",
    description: "Read a campaign's transcript a page at a time, oldest first within the page. Leave out before for the newest page; pass before = olderBefore (from this tool or odm_get_campaign's history) to read further back. olderBefore is null at the start of the campaign.",
    properties: {
      ...campaignIdProp,
      before: { type: "integer", minimum: 1, description: "Read messages older than this seq." },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "How many messages (default 30)." },
    },
    required: ["campaignId"],
    method: "GET",
    path: (a) => {
      const query = new URLSearchParams();
      for (const key of ["before", "limit"]) {
        if (a[key] !== undefined) {
          if (!Number.isSafeInteger(a[key]) || (a[key] as number) < 1) {
            throw new Error(`${key} must be a whole number above 0.`);
          }
          query.set(key, String(a[key]));
        }
      }
      return `/api/campaigns/${seg(a.campaignId)}/messages${query.size ? `?${query}` : ""}`;
    },
    shape: (text) => historyForAgent(text),
  },
  {
    name: "odm_get_sheet",
    scope: "read",
    description: "Read your active character's sheet at this table as it stands now (HP, conditions, slots, gear). This is the table's copy; odm_get_character reads the library copy, which play does not change until the campaign syncs it.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/sheet`,
  },
  {
    name: "odm_level_up_options",
    scope: "read",
    description: "What your active character's next level offers, before odm_level_up takes it: whether the experience has earned it (ready, notReady), the hit points it adds, and under choices every pick it opens with the exact names to send back: asiChoices, subclass, expertise, featurePicks (fighting styles, invocations, maneuvers), levelUpSkill, training (featChoices) and spells. owedFromEarlierLevels lists picks earlier levels left open, which the next level-up takes. Pass levelUpClass to ask about a level in another class (otherClasses lists them), and subclass to see what a subclass the level owes would open with it (a Battle Master's maneuvers, an Eldritch Knight's spells).",
    properties: {
      ...campaignIdProp,
      levelUpClass: { type: "string", description: "A class id from otherClasses; leave out for the first class." },
      subclass: { type: "string", maxLength: 80, description: "One of choices.subclass.options, to count the picks it opens." },
    },
    required: ["campaignId"],
    method: "GET",
    path: (a) => {
      const query = new URLSearchParams();
      if (a.levelUpClass !== undefined) {
        query.set("class", decodeURIComponent(seg(a.levelUpClass)));
      }
      if (a.subclass !== undefined) {
        query.set("subclass", String(a.subclass).slice(0, 80));
      }
      return `/api/campaigns/${seg(a.campaignId)}/sheet/level-up${query.size ? `?${query}` : ""}`;
    },
  },
  {
    name: "odm_get_whispers",
    scope: "read",
    description: "Read your private line with the Dungeon Master, oldest first: whispers the DM sent you alone (to_player) and your own private messages to the DM (to_dm, answered once a DM turn has read them). The transcript never carries these, so odm_get_campaign does not show them. In the DM seat of a game a person runs, inbox holds the players' private messages.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/whispers`,
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
    description: "Read a campaign's timeline of closed chapters, facts and events. A chapter appears only once it closes, and no messages appear at all, so the play in progress is not here: read odm_get_campaign or odm_get_messages for the latest.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/timeline`,
  },
  {
    name: "odm_lore",
    scope: "read",
    description: "Read a campaign's lore binder entries you can see: authored background, not what is happening at the table now.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/lore`,
  },
  {
    name: "odm_get_facts",
    scope: "read",
    description: "Read a campaign's tracked fact register - what the table has established as true. Party-visible facts unless secrets: true, which needs the DM seat or story authority.",
    properties: { ...campaignIdProp, secrets: { type: "boolean", description: "Include DM-only facts (needs the DM seat or story authority)." } },
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/facts${a.secrets === true ? "?secrets=1" : ""}`,
  },
  {
    name: "odm_get_pact",
    scope: "read",
    description: "Read the pact your character is in, if any: who is in it, who leads, what it plans and when, and your own secret actions. Only yours: nobody else's secret actions, and nothing at all for a character in no pact.",
    properties: campaignIdProp,
    required: ["campaignId"],
    method: "GET",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/pact`,
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
    description: "Act at the table as your character, exactly as typing in the chat box: 'do' is an action, 'say' is speech, 'ooc' is out of character. The Dungeon Master answers in the campaign. A cast that would end your character's running concentration spell is refused with confirmConcentration naming both spells; ask your player, and if they agree send the same action again with concentrationAck set to that object.",
    properties: {
      ...campaignIdProp,
      ...WEBHOOK_GUARD_PROPS,
      content: { type: "string", maxLength: 2000 },
      kind: { type: "string", enum: ["do", "say", "ooc"] },
      concentrationAck: {
        type: "object",
        description: "Your player's yes to ending the running concentration spell, copied from the refusal's confirmConcentration.",
        properties: {
          characterId: { type: "string" },
          current: { type: "string" },
          next: { type: "string" },
        },
        required: ["characterId", "current", "next"],
      },
    },
    required: ["campaignId", "content"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/actions`,
    body: (a) => pick(a, ["content", "kind", "concentrationAck"]),
  },
  {
    name: "odm_ask",
    scope: "play",
    description: "Ask the campaign's records a question (what happened, who someone is). A model writes the answer, waiting behind any narration in progress, so it can be incomplete or wrong, and it is not a view of the table: story questions read facts, chapter summaries and the latest messages (the newest whole where it fits, and the search reaches further back); rules and sheet questions read no messages. For what is happening now, read odm_get_campaign. Private to you unless visibility says otherwise.",
    properties: {
      ...campaignIdProp,
      question: { type: "string", maxLength: QUESTION_MAX_CHARS },
      scope: {
        type: "string",
        enum: ["auto", ...ASK_SCOPES],
        description: "story: the record; rules: this table's house rules; sheet: your character, hit points and recent dice. auto (the default) picks from the question's words.",
      },
      visibility: { type: "string", enum: [...ASK_VISIBILITIES], description: "private (the default), or table to show the question and answer to everyone." },
    },
    required: ["campaignId", "question"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/ask`,
    body: (a) => pick(a, ["question", "scope", "visibility"]),
  },
  {
    name: "odm_whisper_dm",
    scope: "play",
    description: "Send the Dungeon Master a private message as your character (slipping away, a secret plan, a reply to a whisper). The rest of the table does not see it; the DM answers in a whisper you read with odm_get_whispers. At most two may wait unanswered.",
    properties: { ...campaignIdProp, message: { type: "string", maxLength: 500 } },
    required: ["campaignId", "message"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/whispers`,
    body: (a) => pick(a, ["message"]),
  },
  {
    name: "odm_answer_offer",
    scope: "play",
    description:
      "Answer an offer made to your character (odm_get_campaign lists them under itemProposals): approve or decline an item, gold or vitals offer, or an NPC's advance. A pact's approach (ownerOnly, with choices) reaches you alone and nobody else ever sees it: approve with choice join, play_along (pretend to join and watch them), report (tell the party) or refuse.",
    properties: {
      ...campaignIdProp,
      ...WEBHOOK_GUARD_PROPS,
      proposalId: { type: "string", description: "The offer's id from itemProposals." },
      action: { type: "string", enum: ["approve", "decline"] },
      choice: { type: "string", enum: [...APPROACH_CHOICES], description: "A pact's approach only: your answer, sent with approve." },
    },
    required: ["campaignId", "proposalId", "action"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/item-proposals/${seg(a.proposalId)}`,
    body: (a) => pick(a, ["action", "choice"]),
  },
  {
    name: "odm_secret_action",
    scope: "play",
    description:
      "Act in secret as a member of a pact your character is in (odm_get_pact). The table does not see it; the server rolls it where only you and whoever runs the story see, and it comes out when the pact moves or someone catches it. kind: steal (targetId and item; the item leaves its owner's pack now), scheme (something harmless, in text), harm (needs a table set to Turn) or attack (another player's character, when the pact moves in a fight; needs Turn). Refused during a fight, except attack.",
    properties: {
      ...campaignIdProp,
      ...WEBHOOK_GUARD_PROPS,
      kind: { type: "string", enum: [...SECRET_KINDS] },
      text: { type: "string", maxLength: 300, description: "What your character does, in a few words." },
      skill: { type: "string", enum: [...SECRET_SKILLS], description: "scheme or harm: what it is rolled with (theft is always Sleight of Hand)." },
      targetId: { type: "string", description: "steal or attack: the other character's sheet id." },
      item: { type: "string", maxLength: 120, description: "steal: the item's name on that character's sheet." },
    },
    required: ["campaignId", "kind"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/actions`,
    body: (a) => ({ secret: pick(a, ["kind", "text", "skill", "targetId", "item"]) }),
  },
  {
    name: "odm_answer_roll",
    scope: "play",
    description: "Enter the dice you rolled at the table for a roll the Dungeon Master is waiting on (the faces, one number per die), or ask the server to roll it with fallback: 'digital'.",
    properties: {
      ...campaignIdProp,
      ...WEBHOOK_GUARD_PROPS,
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
    properties: { ...campaignIdProp, ...WEBHOOK_GUARD_PROPS },
    required: ["campaignId"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/encounter/end-turn`,
    body: () => ({}),
  },
  {
    name: "odm_pass",
    scope: "play",
    description: "Pass this beat at a table that waits for everyone (tableWait in odm_get_campaign lists who the DM is waiting on): you have nothing to add, so the DM stops waiting on you. Nothing is posted. Refused where the table does not wait, or once you have acted or passed since the last narration.",
    properties: { ...campaignIdProp, ...WEBHOOK_GUARD_PROPS },
    required: ["campaignId"],
    method: "POST",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/pass`,
    body: () => ({}),
  },
  {
    name: "odm_level_up",
    scope: "play",
    description: "Take your active character's next level, as the level-up dialog does: read odm_level_up_options first and send its nextLevel with the picks it lists. The server builds the level from these choices alone (hit points by the table's method, features, slots) and refuses an unearned level or an illegal pick with the reason. A pick left out stays owed for the next level-up. The answer is the new sheet with hpGained.",
    properties: {
      ...campaignIdProp,
      ...WEBHOOK_GUARD_PROPS,
      level: { type: "integer", minimum: 2, maximum: 20, description: "The next level (nextLevel from odm_level_up_options): one level at a time." },
      levelUpClass: { type: "string", description: "The class taking the level; leave out for the first class." },
      hpChoice: { type: "string", enum: ["roll", "average"], description: "Only where the table rolls hit points: average takes the fixed value instead of the server's roll." },
      asiChoices: {
        type: "array",
        maxItems: 7,
        description: 'Up to choices.asiChoices.count: { mode: "plus2", ability }, { mode: "plus1x2", abilities: [a, b] } or { mode: "feat", feat, ability? }. Abilities are str, dex, con, int, wis, cha.',
        items: { type: "object" },
      },
      featChoices: {
        type: "object",
        description: "The picks a feat taken now or a subclass's training leaves open, keyed by its name: { languages, skills, expertise, weapons, tools, armor, cantrips, spells, damageType } as the refusal or choices.training names them.",
      },
      subclass: { type: "string", description: "One of choices.subclass.options." },
      expertise: { type: "array", items: { type: "string" }, maxItems: 6, description: "Skills from choices.expertise.options." },
      featurePicks: {
        type: "array",
        items: { type: "string", maxLength: 80 },
        maxItems: 20,
        description: "Feature names from choices.featurePicks options, exactly as listed (\"Fighting Style: Defense\", \"Invocation: Agonizing Blast\").",
      },
      levelUpSkill: { type: "string", description: "One of choices.levelUpSkill.options (a new class's skill)." },
      levelUpSpells: { type: "array", items: { type: "string" }, maxItems: 20, description: "New cantrips and spells by name, within choices.spells." },
      levelUpForget: { type: "string", description: "A spell a known caster gives up for one of levelUpSpells (choices.spells.mayReplaceOne)." },
    },
    required: ["campaignId", "level"],
    method: "PATCH",
    path: (a) => `/api/campaigns/${seg(a.campaignId)}/sheet`,
    // The level-up's fields and nothing else: the route takes a cosmetic
    // edit on this PATCH too, which this tool does not offer.
    body: (a) => ({
      ...pick(a, ["level", "levelUpClass", "hpChoice", "asiChoices", "featChoices", "subclass", "expertise", "levelUpSkill", "levelUpSpells", "levelUpForget"]),
      ...(Array.isArray(a.featurePicks) && a.featurePicks.length
        ? { features: a.featurePicks.map((name) => ({ name: String(name), source: "choice" })) }
        : {}),
    }),
    check: (a) => (Number.isSafeInteger(a.level) ? null : "Name the next level (nextLevel from odm_level_up_options)."),
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
    name: "odm_write_lore",
    scope: "campaigns",
    description: "Create, patch or delete a campaign lore entry (party lead / story authority; the routes enforce it). Create omits id; delete needs confirm: true and cannot be undone. Text fields only - pictures and PDF attachments need the workshop.",
    properties: {
      ...campaignIdProp,
      action: { type: "string", enum: ["create", "patch", "delete"] },
      id: { type: "string", description: "The entry id (from odm_lore). Required for patch and delete." },
      category: { type: "string", enum: [...WORLD_LORE_CATEGORIES] },
      title: { type: "string", maxLength: 120 },
      body: { type: "string", maxLength: 4000 },
      tags: { type: "array", items: { type: "string" } },
      visibility: { type: "string", enum: ["party", "dm"] },
      pinned: { type: "boolean", description: "Patch only. Pinned entries skip retrieval and ride every DM prompt." },
      confirm: { type: "boolean" },
    },
    required: ["campaignId", "action"],
    method: (a) => (a.action === "create" ? "POST" : a.action === "patch" ? "PATCH" : "DELETE"),
    path: (a) =>
      `/api/campaigns/${seg(a.campaignId)}/lore${a.action !== "create" && typeof a.id === "string" ? `/${seg(a.id)}` : ""}`,
    body: (a) =>
      a.action === "delete"
        ? undefined
        : pick(a, a.action === "patch" ? ["category", "title", "body", "tags", "visibility", "pinned"] : ["category", "title", "body", "tags", "visibility"]),
    check: (a) => {
      if (a.action === "patch") {
        return typeof a.id === "string" ? null : "Patching needs the entry id (from odm_lore).";
      }
      if (a.action === "delete") {
        if (typeof a.id !== "string") return "Deleting needs the entry id (from odm_lore).";
        return needConfirm(a);
      }
      if (!WORLD_LORE_CATEGORIES.includes(a.category as WorldLoreCategory) || typeof a.title !== "string" || !a.title.trim() || typeof a.body !== "string" || !a.body.trim()) {
        return "Creating needs category, title and body.";
      }
      return null;
    },
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
  // The webhook guard fields only mean something where webhooks can exist.
  const guards = playerSignalsEnabled();
  return [
    WHOAMI,
    ...webhookTools(grant),
    ...WORKBENCH_TOOLS.filter((tool) => grant.scopes.includes(tool.scope)).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: "object" as const,
        properties: guards ? tool.properties : without(tool.properties, Object.keys(WEBHOOK_GUARD_PROPS)),
        ...(tool.required ? { required: tool.required } : {}),
        ...(tool.open ? {} : { additionalProperties: false }),
      },
    })),
  ];
}

export function serverOrigin(): string {
  return new URL(harnessMcpUrl()).origin;
}

// Whether one of the player's library characters has a sheet in a campaign.
function seatedAt(userId: string, campaignId: string, characterId: string): boolean {
  return listAssignmentsForCharacter(userId, characterId).some((assignment) => assignment.campaignId === campaignId);
}

export type WorkbenchOutcome ={ text: string; isError: boolean; campaignId?: string };

export async function workbenchCall(grant: ConnectionGrant, name: string, args: Args): Promise<WorkbenchOutcome> {
  if (isWebhookTool(name)) {
    return webhookToolCall(grant, name, args);
  }
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
  // The library tools name no campaign, so the check above never sees them.
  // A pinned connection reaches the library only through the characters
  // seated at its table: it may not add to the library, and may not read,
  // rewrite or delete a character that plays somewhere else or nowhere.
  if (grant.campaignId && tool.name === "odm_create_character") {
    return { text: "This connection is limited to one campaign and cannot add characters to your library.", isError: true };
  }
  if (
    grant.campaignId &&
    typeof args.characterId === "string" &&
    // A malformed id is refused as one when the path is built, below.
    ID.test(args.characterId) &&
    !seatedAt(grant.userId, grant.campaignId, args.characterId)
  ) {
    return { text: "This connection is limited to one campaign, and that character is not in it.", isError: true };
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
  let guarded = false;
  if (["odm_take_action", "odm_answer_roll", "odm_end_turn", "odm_pass", "odm_level_up", "odm_answer_offer", "odm_secret_action"].includes(name) && (args.subscriptionId !== undefined || args.opportunityId !== undefined)) {
    try {
      if (typeof args.subscriptionId !== "string" || typeof args.opportunityId !== "string" || !campaignId) throw new Error("Supply both subscriptionId and opportunityId.");
      const cached = reserveWebhookWrite(grant, { subscriptionId: args.subscriptionId, opportunityId: args.opportunityId,
        campaignId, tool: name, pendingRollId: typeof args.pendingRollId === "string" ? args.pendingRollId : undefined,
        fingerprint: createHash("sha256").update(JSON.stringify([path, body])).digest("hex") });
      if (cached) return cached;
      guarded = true;
    } catch (error) { return { text: error instanceof Error ? error.message : "Submission refused.", isError: true, campaignId }; }
  }
  let response: Response;
  try {
    response = await fetch(`${serverOrigin()}${path}`, {
      method: typeof tool.method === "function" ? tool.method(args) : tool.method,
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
  if (grant.campaignId && tool.name === "odm_list_characters") {
    try {
      const parsed = JSON.parse(text) as { characters?: Array<{ id?: string }> };
      if (Array.isArray(parsed.characters)) {
        const pinned = grant.campaignId;
        parsed.characters = parsed.characters.filter(
          (character) => typeof character.id === "string" && seatedAt(grant.userId, pinned, character.id),
        );
        text = JSON.stringify(parsed);
      }
    } catch {
      // Leave it as the route answered.
    }
  }
  // Held under the agent's result cap as JSON, so a long answer still parses
  // and keeps the fields that matter (src/lib/agents/agent-results.ts).
  text = response.ok && tool.shape ? tool.shape(text, args) : boundResultText(text);
  const result = !response.ok
    ? { text: `HTTP ${response.status}: ${text || response.statusText}`, isError: true, campaignId }
    : { text: text || "{}", isError: false, campaignId };
  if (guarded) {
    const subscriptionId = args.subscriptionId as string;
    const opportunityId = args.opportunityId as string;
    // A refusal (4xx) is answered before the route changes anything, so the
    // opportunity is freed for a corrected submission ("not your turn yet",
    // dice out of range). Anything else is the saved answer for a retry.
    if (response.status >= 400 && response.status < 500) {
      releaseWebhookWrite(subscriptionId, opportunityId, name);
    } else {
      finishWebhookWrite(subscriptionId, opportunityId, name, result);
    }
  }
  return result;
}
