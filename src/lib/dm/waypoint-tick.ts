import { getCampaignById, setStoryArc } from "@/lib/db/campaigns";
import { getQuest } from "@/lib/db/quests";
import { listMessagesInSeqRange } from "@/lib/db/messages";
import { latestSeq } from "@/lib/db/campaigns";
import { publishEphemeral } from "@/lib/events";
import { cosine, embed } from "@/lib/embeddings";
import { narratorIsAi } from "@/lib/dm/viewer";
import { requestDmMessage } from "@/lib/dm/model";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import type { StoryArc, Waypoint } from "@/lib/dm/arc-logic";
import {
  activeBeat,
  lexicalMatch,
  matchSignal,
  openWaypoints,
  parseWaypointJudge,
  signalFromToolCall,
  tickWaypoints,
  type WaypointSignal,
} from "@/lib/dm/waypoint-logic";

// Ticking the [NOW] beat's waypoints (issue #31). Two sources, in order of
// trust: the DM's own tool calls, which name the place, person, item,
// objective or foe outright and cost no model call; and the judge, one
// small YES-list call on the chapter's cadence for whatever the tools did
// not catch (a narrative step, or an arrival the DM narrated without
// move_party). A name the tools used is matched lexically first, then by
// the local MiniLM embeddings when the words differ ("Sunken Cathedral"
// against "the drowned cathedral"), so the DM's naming can drift without
// the beat sticking.

// Cosine at which two short names are taken as the same thing. MiniLM puts
// paraphrases of one place well above this and different places well below.
const EMBED_MATCH = 0.62;

type ToolCall = { name: string; rawArguments: string };

// Which open waypoints, if any, the turn's tool calls satisfied. Returns
// the texts ticked, for the caller's debug line. `enemyNames` are the foes
// of the encounter as it stood BEFORE the calls ran, since end_encounter
// has no names of its own.
export async function tickWaypointsFromCalls(
  campaignId: string,
  calls: ToolCall[],
  extra: { enemyNames?: string[] } = {},
): Promise<string[]> {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc || !narratorIsAi(campaign.gameSettings.dmMode) || !calls.length) {
    return [];
  }
  const active = activeBeat(campaign.storyArc);
  if (!active || !openWaypoints(active.beat).length) {
    return [];
  }
  const signals: WaypointSignal[] = [];
  for (const call of calls) {
    const signal = signalFromToolCall(call.name, call.rawArguments, {
      enemyNames: extra.enemyNames,
      objectiveText: call.name === "tick_objective" ? objectiveText(campaignId, call.rawArguments) : undefined,
    });
    if (signal) {
      signals.push(signal);
    }
  }
  if (!signals.length) {
    return [];
  }
  const matched = new Set<number>();
  for (const signal of signals) {
    for (const index of matchSignal(active.beat, signal)) {
      matched.add(index);
    }
  }
  // Whatever the words missed, the meaning may still catch.
  const stillOpen = (active.beat.waypoints ?? [])
    .map((waypoint, index) => ({ waypoint, index }))
    .filter(({ waypoint, index }) => !waypoint.done && waypoint.kind !== "narrative" && !matched.has(index));
  if (stillOpen.length) {
    for (const index of await embeddingMatches(stillOpen, signals)) {
      matched.add(index);
    }
  }
  if (!matched.size) {
    return [];
  }
  return applyTicks(campaignId, campaign.storyArc, active.number, [...matched]);
}

async function embeddingMatches(
  open: Array<{ waypoint: Waypoint; index: number }>,
  signals: WaypointSignal[],
): Promise<number[]> {
  const pairs: Array<{ index: number; kind: string; name: string }> = [];
  for (const signal of signals) {
    for (const name of signal.names) {
      pairs.push(...open.filter((entry) => entry.waypoint.kind === signal.kind).map((entry) => ({ index: entry.index, kind: signal.kind, name })));
    }
  }
  if (!pairs.length) {
    return [];
  }
  try {
    const texts = [...new Set([...open.map((entry) => entry.waypoint.text), ...pairs.map((pair) => pair.name)])];
    const vectors = await embed(texts);
    const vectorOf = new Map(texts.map((text, at) => [text, vectors[at]]));
    const hits = new Set<number>();
    for (const pair of pairs) {
      const waypoint = open.find((entry) => entry.index === pair.index);
      const a = waypoint ? vectorOf.get(waypoint.waypoint.text) : undefined;
      const b = vectorOf.get(pair.name);
      if (a && b && cosine(a, b) >= EMBED_MATCH) {
        hits.add(pair.index);
      }
    }
    return [...hits];
  } catch {
    // No embedder on this install: the words were the whole test.
    return [];
  }
}

function objectiveText(campaignId: string, rawArguments: string): string | undefined {
  try {
    const args = JSON.parse(rawArguments || "{}") as { questId?: unknown; objectiveId?: unknown };
    const quest = typeof args.questId === "string" ? getQuest(args.questId) : null;
    if (!quest || quest.campaignId !== campaignId) {
      return undefined;
    }
    const objective = quest.objectives.find((entry) => entry.id === args.objectiveId);
    return objective ? `${quest.title} ${objective.text}` : undefined;
  } catch {
    return undefined;
  }
}

function applyTicks(campaignId: string, arc: StoryArc, beatNumber: number, indexes: number[]): string[] {
  const next = tickWaypoints(arc, beatNumber, indexes);
  if (next === arc) {
    return [];
  }
  setStoryArc(campaignId, next);
  // The lead's arc card refetches on this; players never see the arc.
  publishEphemeral(campaignId, "arc_updated", {});
  const ticked = indexes.map((index) => arc.beats[beatNumber - 1].waypoints?.[index]?.text ?? "").filter(Boolean);
  if (process.env.DM_DEBUG) {
    console.log(`[dm-debug] waypoints ticked on beat ${beatNumber}: ${ticked.join(" | ")}`);
  }
  return ticked;
}

const WAYPOINT_JUDGE_SYSTEM = `You are checking which steps of a D&D story beat have actually happened in the most recent play. You are given the beat, a numbered list of its steps, and the recent play. Reply with ONLY a JSON array of the numbers of the steps that have clearly and fully happened in that play, for example [2] or [1,3]. Working toward a step is not the step. Reply [] if none has.`;

// The backstop: one small call that reads the chapter's play since the
// last beat and ticks whichever open waypoints it shows. Returns the texts
// ticked. Any failure ticks nothing; the tools and the next cadence remain.
export async function judgeWaypoints(campaignId: string, sinceSeq: number): Promise<string[]> {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.storyArc) {
      return [];
    }
    const active = activeBeat(campaign.storyArc);
    if (!active) {
      return [];
    }
    const open = (active.beat.waypoints ?? [])
      .map((waypoint, index) => ({ waypoint, index }))
      .filter(({ waypoint }) => !waypoint.done);
    if (!open.length) {
      return [];
    }
    const recent = listMessagesInSeqRange(campaignId, sinceSeq, latestSeq(campaignId))
      .filter((message) => message.authorType !== "system")
      .slice(-8)
      .map((message) => `${message.authorType === "dm" ? "DM" : "Player"}: ${message.content}`)
      .join("\n\n")
      .slice(-6_000);
    if (!recent) {
      return [];
    }
    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: WAYPOINT_JUDGE_SYSTEM },
        {
          role: "user",
          content: `Beat: ${active.beat.text}\n\nSteps:\n${open
            .map((entry, at) => `${at + 1}. ${entry.waypoint.text}`)
            .join("\n")}\n\nRecent play:\n${recent}`,
        },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      return [];
    }
    const raw = stripReasoningArtifacts(typeof message?.content === "string" ? message.content : "");
    const picked = parseWaypointJudge(raw, open.length).map((at) => open[at].index);
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] waypoint judge: ${raw.slice(0, 40)} -> ${picked.join(",") || "none"}`);
    }
    if (!picked.length) {
      return [];
    }
    return applyTicks(campaignId, campaign.storyArc, active.number, picked);
  } catch {
    return [];
  }
}

// Exported for the lead's own naming of a place or person in a note, and
// for tests: whether a name reads as a waypoint by words alone.
export { lexicalMatch };
