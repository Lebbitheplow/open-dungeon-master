// The next turn's prompt start, read by the narrator before the turn asks.
//
// llama.cpp keeps a prompt's start from one request to the next and reads
// only what follows it, but its cache restarts where a message starts (Qwen's
// hybrid layers, gpt-oss's sliding window), and a turn's first message holds
// the rules and the tools. A fight starting or ending, or a companion joining,
// changes that message, and the next turn read the whole prompt again: about
// 35K tokens, a minute on the Framework Desktop and two on a BC-250 (measured
// 385 tokens a second there, 2026-10-23), while the player waited.
//
// So when a turn ends and the next one's first message will differ from what
// the narrator last read, it is sent ahead asking for almost no reply, while
// the table reads and the player types. The turn that follows reuses it; one
// whose first message turned out different stops it and goes as before. It
// never competes with play: it runs as background work, and stops the moment
// any table's turn calls the same narrator (a two-slot server shares one
// cache, and two long prompts do not fit it together).
import { createHash } from "node:crypto";
import { campaignSeats, getCampaignById, listMembers } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { listSheets } from "@/lib/db/sheets";
import { createDmJobControl, runInDmJob, type DmJobControl } from "@/lib/dm/job-control";
import { interactiveInFlight } from "@/lib/dm/inference-gate";
import { requestDmMessage, storyRouteKey } from "@/lib/dm/model";
import { turnRulesMessage } from "@/lib/dm/prompt";
import { relationshipRosterForPrompt } from "@/lib/dm/relationship-tools";
import { endpointKind } from "@/lib/dm/sampling-logic";
import { hasHumanDm } from "@/lib/dm/viewer";
import { serverEnv } from "@/lib/server-env";
import type { StorySettings } from "@/lib/types";

// What the next turn's first call is offered, from the turn machinery
// (src/lib/dm/turn.ts), which this module does not import: the tools for the
// fight state as the turn left it, and the tuning that chose them.
export type NextTurnCall = {
  tools: readonly unknown[];
  thinking: boolean;
  // The compact and short-rules profiles choose tools and rules from the
  // players' words, so nothing can be sent ahead of those.
  wordsDecide: boolean;
};

// The longest a turn waits on a warm-up of its own first message: past it,
// the turn goes and reads the rest itself.
const MAX_TURN_WAIT_MS = 180_000;
const WATCH_MS = 250;

type Warming = { key: string; control: DmJobControl; done: Promise<void>; awaited: boolean };

declare global {
  var __odmTurnHeads: Map<string, string> | undefined;
  var __odmTurnWarmups: Map<string, Warming> | undefined;
}

// What each campaign's narrator last read as a turn's first message.
function heads() {
  return (globalThis.__odmTurnHeads ??= new Map<string, string>());
}

function warmups() {
  return (globalThis.__odmTurnWarmups ??= new Map<string, Warming>());
}

// One key per narrator, model, first message and tool list: two that match
// render the same prompt start.
export function turnHeadKey(settings: StorySettings, rules: string, tools: readonly unknown[]): string {
  return createHash("sha1")
    .update(JSON.stringify([(settings.customBaseUrl || "").trim(), settings.customModel, rules, tools]))
    .digest("hex");
}

// A turn's call went out with this first message: the narrator holds it now.
export function noteTurnHead(campaignId: string, key: string): void {
  heads().set(campaignId, key);
}

// Called by a turn before its first call. A warm-up of the same first
// message is waited for, since it is reading what the turn needs (up to a
// bound); one of another is stopped, so it never holds the turn up.
export async function settleTurnWarmup(campaignId: string, key: string): Promise<void> {
  const warming = warmups().get(campaignId);
  if (!warming) {
    return;
  }
  if (warming.key !== key) {
    warming.control.controller.abort();
    return;
  }
  warming.awaited = true;
  await Promise.race([warming.done, new Promise((resolve) => setTimeout(resolve, MAX_TURN_WAIT_MS).unref?.())]);
}

// Only a local OpenAI-compatible narrator (llama.cpp and its kind) keeps a
// prompt's start this way.
function warmable(settings: StorySettings, next: NextTurnCall): boolean {
  return (
    settings.textProvider === "custom" &&
    Boolean(settings.customModel.trim()) &&
    endpointKind(settings.customBaseUrl) === "local" &&
    !next.wordsDecide
  );
}

// After a turn: sends the next turn's first message ahead when the narrator
// does not hold it. Never throws and is never waited on.
export function warmNextTurn(campaignId: string, next: NextTurnCall): void {
  // DM_TURN_WARMUP=0 sends nothing ahead (the test suites' scripted models
  // answer requests in order, and a warm-up would take a turn's reply).
  if (serverEnv("DM_TURN_WARMUP") === "0") {
    return;
  }
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign || campaign.status !== "active" || hasHumanDm(campaignSeats(campaign))) {
      return;
    }
    if (!warmable(campaign.settings, next)) {
      return;
    }
    const encounter = getActiveEncounter(campaignId);
    const rules = turnRulesMessage({
      campaign,
      members: listMembers(campaignId),
      sheets: listSheets(campaignId),
      relationships: campaign.gameSettings.relationships === "off" ? [] : relationshipRosterForPrompt(campaignId),
      ruleContext: null,
      encounter: encounter ? ({} as never) : null,
    });
    if (!rules) {
      return;
    }
    const { tools } = next;
    const key = turnHeadKey(campaign.settings, rules, tools);
    if (heads().get(campaignId) === key || warmups().get(campaignId)?.key === key) {
      return;
    }
    warmups().get(campaignId)?.control.controller.abort();
    const control = createDmJobControl(campaignId, "work", () => {});
    const routeKey = storyRouteKey(campaign.settings);
    const entry: Warming = { key, control, done: Promise.resolve(), awaited: false };
    // Another table's turn on the same narrator: this gives way at once.
    const watch = setInterval(() => {
      if (!entry.awaited && interactiveInFlight(routeKey) > 0) {
        control.controller.abort();
      }
    }, WATCH_MS);
    watch.unref?.();
    entry.done = runInDmJob(control, () =>
      requestDmMessage(
        campaign.settings,
        [
          { role: "system", content: rules },
          { role: "user", content: "(The table is reading. Wait for the players.)" },
        ],
        {
          tools: [...tools],
          // The same thinking request a turn's first call makes, so the
          // prompt renders the same.
          thinking: next.thinking,
          maxOutputTokens: 1,
          background: true,
          meta: { task: "turn_warmup" },
        },
      ),
    )
      .then((result) => {
        if (!result.error) {
          heads().set(campaignId, key);
        }
      })
      .catch((error) => {
        console.warn(`[dm] campaign ${campaignId}: the next turn's warm-up failed`, error);
      })
      .finally(() => {
        clearInterval(watch);
        if (warmups().get(campaignId) === entry) {
          warmups().delete(campaignId);
        }
      });
    warmups().set(campaignId, entry);
  } catch (error) {
    console.warn(`[dm] campaign ${campaignId}: could not prepare the next turn's warm-up`, error);
  }
}
