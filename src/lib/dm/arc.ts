import {
  getCampaignById,
  setQuestLog,
  setStoryArc,
} from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listRecentMessages } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";
import { genrePreset } from "@/lib/genres";
import {
  activeBeatNumber,
  activeQuestLines,
  applyArcDelta,
  completeBeat,
  applyArcEnrichment,
  applyArcExtension,
  arcExhausted,
  needsEnrichment,
  parseArcDeltaJson,
  parseArcEnrichmentJson,
  parseArcExtensionJson,
  parseArcJson,
  renderArcForPrompt,
  type StoryArc,
} from "@/lib/dm/arc-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { setDmStatus } from "@/lib/dm/status";

// Story-arc generation and upkeep. The arc is the DM's secret spine: it is
// generated once at campaign activation (for every campaign, whether or not
// AI story setup wrote the premise) and refreshed with a small clamped delta
// at each chapter close. Two other passes hang off that heartbeat: a v1
// campaign gets its cast/event layers filled in once, and a campaign that
// has played past its last beat gets a whole new act instead of quietly
// losing its [NOW] marker. Every failure path is a silent no-op: the
// campaign falls back to dm_outline (or nothing) and generation retries at
// the next chapter close.

function worldContext(campaignId: string): string {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return "";
  }
  const preset = genrePreset(campaign.gameSettings.genre);
  const party = listSheets(campaignId)
    .map(
      (sheet) =>
        `- ${sheet.name}: level ${sheet.level} ${sheet.race} ${sheet.class}${sheet.subclass ? ` (${sheet.subclass})` : ""}, background ${sheet.background || "unknown"}${sheet.backstory ? `\n  backstory: ${sheet.backstory.slice(0, 400)}` : ""}`,
    )
    .join("\n");
  return [
    `Difficulty: ${campaign.difficulty}.`,
    party ? `Party:\n${party}` : "",
    campaign.theme ? `World/theme set by the table: ${campaign.theme}` : "",
    campaign.description ? `Premise: ${campaign.description}` : "",
    campaign.gameSettings.genre === "custom"
      ? campaign.gameSettings.customGenreText
      : `Genre: ${preset.name}. ${preset.dmFlavor} ${preset.nameHints}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function recentChapterLines(campaignId: string): string {
  return listChapters(campaignId)
    .filter((chapter) => chapter.status === "closed")
    .slice(-6)
    .map(
      (chapter) =>
        `${chapter.index}. "${chapter.title}"${chapter.highlights[0] ? ` - ${chapter.highlights[0]}` : ""}`,
    )
    .join("\n");
}

const EVENT_SHAPE =
  '{"kind": "npc_encounter"|"ally"|"twist"|"betrayal"|"deadline"|"discovery"|"setpiece", "name": string, "detail": string, "trigger": string, "actHint": int|null}';

// Shared by every prompt that can propose events. Both rules exist because
// the model broke them in verification: it wrote "Beat 5 occurs" as a
// trigger, and it wrote a "twist" that merely restated the antagonist line
// the DM already has in front of it.
const EVENT_RULES = `Two rules for every event you write. trigger is something that HAPPENS IN THE STORY and that the DM can recognise at the table ("the first time the party sleeps outside the walls", "when they open the reliquary"); it may never be a beat, act, chapter, or turn number, and never the word "beat" followed by a number. A twist or betrayal must reveal something that is NOT already stated in the premise, the stakes, the antagonist line, or any beat; if the DM already knows it, it reveals nothing and is not a twist.`;

const GENERATE_SYSTEM = `You sketch the secret story arc an AI Dungeon Master will steer a long D&D 5e campaign by. It is a loose guideline of people and events to keep the story moving, not a script: the table will wander, and the DM must be able to improvise around it.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"premise": string, "stakes": string, "antagonist": string, "acts": [{"beats": string[]}], "finale": string, "cast": [{"name": string, "role": string, "agenda": string}], "events": [${EVENT_SHAPE}], "subArcs": [{"name": string, "goal": string, "hook": string, "beats": string[]}]}

acts: exactly 3 acts of 3 to 4 beats each, ordered, escalating to the finale. One short sentence per beat. Never number them yourself.
cast: 2 to 4 recurring NPCs the campaign returns to, each with a concrete name and something they personally want. The antagonist may be one of them.
events: 4 to 6 planned special moments spread across the acts. Use the kinds: a recurring NPC turning up (npc_encounter), a temporary ally or companion joining the party (ally), a revelation that reframes what came before (twist), someone the party trusted turning on them (betrayal), a clock that forces a choice (deadline), a find that opens a new road (discovery), or a memorable staged scene (setpiece). actHint is a soft placement only.
subArcs: 2 to 3 opening quest- or dungeon-scale threads; name and goal are player-safe and may appear in a quest log, hook is a DM-only secret tying the quest to the main story, beats are 2 to 4 expected steps.

${EVENT_RULES}

Name concrete people, factions, and places instead of roles ("Vicar Osseth", "the Ashen Concord", "the drowned undercroft"), and stay consistent with any premise or outline you are given, carrying any twists it already names into events. Hook at least one event or cast member to a party member's own background or backstory. Every string under 200 characters. Players never see any of this.`;

// Runs on the campaign's DM queue at activation (after runStorySetup, so a
// freshly invented premise/outline is already in place) and from the lead's
// regenerate action.
export async function generateStoryArc(
  campaignId: string,
  opts?: { force?: boolean },
) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign || (campaign.storyArc && !opts?.force)) {
      return;
    }
    setDmStatus(campaignId, "plotting_arc");
    const context = [
      worldContext(campaignId),
      campaign.dmOutline
        ? `The DM's existing secret outline; keep the arc consistent with it:\n${campaign.dmOutline}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: GENERATE_SYSTEM },
        { role: "user", content: context },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      if (process.env.DM_DEBUG) {
        const payload = await error
          .clone()
          .json()
          .catch(() => null);
        console.log("[dm-debug] arc generation: model call failed:", JSON.stringify(payload));
      }
      return;
    }
    const raw = typeof message?.content === "string" ? message.content : "";
    const arc = parseArcJson(raw);
    if (!arc) {
      if (process.env.DM_DEBUG) {
        console.log("[dm-debug] arc generation: unparseable reply:", raw.slice(0, 500));
      }
      return;
    }
    setStoryArc(campaignId, arc);
    setQuestLog(campaignId, activeQuestLines(arc));
  } catch (error) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc generation threw:", error);
    }
  } finally {
    setDmStatus(campaignId, "idle");
  }
}

// complete_beat: the DM reports that the story actually reached the [NOW]
// beat. Marks it done, advances the marker, and tells the caller so the
// turn can close the chapter. One beat per turn: the cap stops a confused
// model from burning the whole arc in a single reply, and out-of-order
// numbers are refused with the real active beat so it can correct itself.
export function handleCompleteBeat(
  campaignId: string,
  rawArguments: string,
  alreadyCompleted: boolean,
): { result: Record<string, unknown>; completed: boolean } {
  const campaign = getCampaignById(campaignId);
  if (!campaign?.storyArc) {
    return { result: { error: "This campaign has no story arc yet." }, completed: false };
  }
  if (alreadyCompleted) {
    return {
      result: { error: "A beat was already completed this turn; let the story breathe." },
      completed: false,
    };
  }
  let args: { beat?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { result: { error: "Invalid arguments." }, completed: false };
  }
  const arc = campaign.storyArc;
  const active = activeBeatNumber(arc);
  // A missing or unparseable number means the current beat, which is what
  // the model means the overwhelming majority of the time.
  const requested = Number(args.beat);
  const beatNumber = Number.isInteger(requested) && requested >= 1 ? requested : active;
  if (beatNumber === null) {
    return {
      result: { error: "Every beat of the arc is already finished." },
      completed: false,
    };
  }
  const advanced = completeBeat(arc, beatNumber);
  if (!advanced) {
    return {
      result: {
        error: `Beat ${beatNumber} is not an open beat.`,
        ...(active === null ? {} : { activeBeat: active }),
      },
      completed: false,
    };
  }
  setStoryArc(campaignId, advanced.arc);
  const nextActive = activeBeatNumber(advanced.arc);
  return {
    result: {
      ok: true,
      completedBeat: beatNumber,
      ...(nextActive === null
        ? { note: "That was the last beat; a new act will be plotted." }
        : { nextBeat: advanced.arc.beats[nextActive - 1].text }),
    },
    completed: true,
  };
}

const JUDGE_SYSTEM = `You are checking whether one specific story beat of a D&D campaign has actually happened yet. Answer in one word.

You are given the beat and the most recent play. Reply with ONLY the word YES if the beat has clearly and fully happened in that play, or ONLY the word NO if it has not. Working toward the beat is NO. A beat is YES only when the thing it describes has actually occurred in the narration.`;

// Backstop for complete_beat. The DM reliably NARRATES a beat landing but
// only calls the tool about half the time (measured on qwen3.6-35b), so
// chapter pacing cannot rest on the tool alone. This is one tiny model call
// asking a single yes/no question, and only when a chapter is already long
// enough to close, so a short chapter never pays for it. Any failure is a
// silent NO: the chapter simply stays open until the next check or the cap.
export async function judgeBeatCompleted(campaignId: string): Promise<boolean> {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign?.storyArc) {
      return false;
    }
    const active = activeBeatNumber(campaign.storyArc);
    if (active === null) {
      return false;
    }
    const beat = campaign.storyArc.beats[active - 1];
    const recent = listRecentMessages(campaignId, 8)
      .filter((message) => message.authorType !== "system")
      .map((message) => `${message.authorType === "dm" ? "DM" : "Player"}: ${message.content}`)
      .join("\n\n")
      .slice(-6_000);
    if (!recent) {
      return false;
    }
    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: JUDGE_SYSTEM },
        { role: "user", content: `Beat: ${beat.text}\n\nRecent play:\n${recent}` },
      ],
      { timeoutMs: arcTextTimeoutMs() },
    );
    if (error) {
      return false;
    }
    const raw = stripReasoningArtifacts(
      typeof message?.content === "string" ? message.content : "",
    )
      .trim()
      .toUpperCase();
    const verdict = /^\W*YES\b/.test(raw);
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] beat judge: beat ${active} "${beat.text}" -> ${raw.slice(0, 20)}`);
    }
    if (!verdict) {
      return false;
    }
    // Mark it exactly the way the tool would, so both paths converge.
    const advanced = completeBeat(campaign.storyArc, active);
    if (!advanced) {
      return false;
    }
    setStoryArc(campaignId, advanced.arc);
    return true;
  } catch {
    return false;
  }
}

const REFRESH_SYSTEM = `You maintain the AI DM's secret story arc between chapters of a D&D 5e campaign. Keep it brief and answer quickly. Compare the arc with what actually happened in the chapter that just closed and reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beatsDone": int[], "beatsSkipped": int[], "beatAnnotations": [{"beat": int, "detail": string}], "activeBeat": int|null, "subArcUpdates": [{"id": string, "status": "active"|"resolved"|"abandoned", "resolution": string}], "newSubArcs": [{"name": string, "goal": string, "hook": string, "beats": string[]}], "eventsFired": string[], "eventsDropped": string[], "newEvents": [${EVENT_SHAPE}], "castUpdates": [{"id": string, "notes": string, "status": "active"|"gone"}], "newCast": [{"name": string, "role": string, "agenda": string, "notes": string}]}

Be conservative. Empty arrays are a correct answer when little changed.
- beatsDone: mark a main beat done only if the chapter clearly accomplished it. Never renumber or rewrite existing beats.
- beatsSkipped: use only when the party's own choices made a beat genuinely moot and it will never happen. This is how a story that went its own way keeps moving instead of stalling on a beat nobody will reach.
- beatAnnotations: at most 3. Attach what the table specifically did to the beat it touched, so later scenes can call back to it by name ("they let Marl go free and he owes them"). This is the ONLY way play changes the main beats; the beat's own text stays exactly as written.
- eventsFired: ids of planned events the chapter actually delivered. eventsDropped: ids the story has moved past or made impossible. Dropping an event that no longer fits is correct and expected, not a failure.
- newEvents: at most 2, only for genuinely new special moments the players' own choices have set up.
- castUpdates: notes record how an NPC now stands with the party; status "gone" when they die or leave for good. newCast: at most 2, for people the players made important.
- newSubArcs: at most 2, only for genuinely new threads.

${EVENT_RULES}

If the story has drifted from the arc, do not rewrite the arc; annotate the beats, drop the events that no longer fit, and add or update a sub-arc that steers play back toward the current main beat.`;

const EXTEND_SYSTEM = `The party has played through every beat of an AI DM's secret story arc for a D&D 5e campaign, and the campaign is still running. Write the next act. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beats": string[], "finale": string, "antagonist": string, "newEvents": [${EVENT_SHAPE}]}

beats: 3 to 4 ordered beats for the new act, one short sentence each, growing out of what the party actually did rather than repeating the old plot. finale: what this act escalates toward. antagonist: keep the existing one if they survived and still matter, otherwise name who steps into the role now (an escalation of the old threat, a survivor with a grudge, or something the party's own victory unleashed). newEvents: at most 2 planned special moments for the new act.

${EVENT_RULES}

Reuse the campaign's existing cast and unfinished threads instead of inventing a fresh world. Do NOT re-propose an event the arc already lists; newEvents is only for moments that do not exist yet. Every string under 200 characters. Players never see this.`;

const ENRICH_SYSTEM = `You are adding two planning layers to an AI DM's existing secret story arc for a D&D 5e campaign already in progress. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"cast": [{"name": string, "role": string, "agenda": string}], "events": [${EVENT_SHAPE}], "beatActs": [{"beat": int, "act": int}]}

cast: 2 to 4 recurring NPCs already implied by the arc, each with a concrete name and something they personally want. events: 3 to 5 planned special moments still ahead of the party, using the kinds npc_encounter, ally, twist, betrayal, deadline, discovery, setpiece. beatActs: group the arc's existing beats into 2 or 3 acts by their 1-based number, in order.

${EVENT_RULES}

You may NOT change, reword, reorder, or renumber the existing beats, and you may not contradict beats already marked done: those already happened. Every string under 200 characters. Players never see this.`;

async function arcModelCall(
  campaignId: string,
  system: string,
  user: string,
  label: string,
): Promise<string | null> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    if (process.env.DM_DEBUG) {
      console.log(`[dm-debug] ${label}: model call failed`);
    }
    return null;
  }
  return typeof message?.content === "string" ? message.content : "";
}

// One-time v1 -> v2 upgrade for a campaign already in progress: fills in the
// cast and event layers and tags beats with acts, leaving every beat's text
// and status untouched. Returns the enriched arc, or the original on any
// failure (it retries at the next chapter close).
async function enrichStoryArc(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const raw = await arcModelCall(
    campaignId,
    ENRICH_SYSTEM,
    `Current arc:\n${renderArcForPrompt(arc)}`,
    "arc enrichment",
  );
  if (raw === null) {
    return arc;
  }
  const enrichment = parseArcEnrichmentJson(raw);
  if (!enrichment) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc enrichment: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyArcEnrichment(arc, enrichment);
}

// The party outlasted the plot: append a whole new act rather than leaving
// the arc with no [NOW] beat to steer by.
async function extendStoryArc(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    EXTEND_SYSTEM,
    [
      `Completed arc:\n${renderArcForPrompt(arc)}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    "arc extension",
  );
  if (raw === null) {
    return arc;
  }
  const extension = parseArcExtensionJson(raw);
  if (!extension) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc extension: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyArcExtension(arc, extension);
}

// Runs at chapter close, on the DM queue. Self-healing: a campaign that
// never got an arc (earlier failure, pre-feature campaign) generates one
// here instead, a pre-v2 arc gains its cast and event layers, and an arc
// the party has played to the end grows another act.
export async function refreshStoryArc(
  campaignId: string,
  closedChapter: { index: number; title: string; summary: string; highlights: string[] },
) {
  try {
    const campaign = getCampaignById(campaignId);
    if (!campaign) {
      return;
    }
    if (!campaign.storyArc) {
      await generateStoryArc(campaignId);
      return;
    }
    setDmStatus(campaignId, "plotting_arc");

    let arc = campaign.storyArc;
    if (needsEnrichment(arc)) {
      arc = await enrichStoryArc(campaignId, arc);
    }

    const chapterLines = [
      `Chapter ${closedChapter.index} just closed: "${closedChapter.title}"`,
      closedChapter.summary ? `Summary: ${closedChapter.summary}` : "",
      closedChapter.highlights.length
        ? `Highlights:\n${closedChapter.highlights.map((line) => `- ${line}`).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const raw = await arcModelCall(
      campaignId,
      REFRESH_SYSTEM,
      `Current arc:\n${renderArcForPrompt(arc)}\n\n${chapterLines}`,
      "arc refresh",
    );
    if (raw === null) {
      // The enrichment pass may still have produced something worth keeping.
      if (arc !== campaign.storyArc) {
        setStoryArc(campaignId, arc);
      }
      return;
    }
    const delta = parseArcDeltaJson(raw);
    if (!delta) {
      if (process.env.DM_DEBUG) {
        console.log("[dm-debug] arc refresh: unparseable reply:", raw.slice(0, 500));
      }
      if (arc !== campaign.storyArc) {
        setStoryArc(campaignId, arc);
      }
      return;
    }
    let next = applyArcDelta(arc, delta);
    if (arcExhausted(next)) {
      next = await extendStoryArc(campaignId, next);
    }
    setStoryArc(campaignId, next);
    setQuestLog(campaignId, activeQuestLines(next));
  } catch (error) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] arc refresh threw:", error);
    }
  } finally {
    setDmStatus(campaignId, "idle");
  }
}
