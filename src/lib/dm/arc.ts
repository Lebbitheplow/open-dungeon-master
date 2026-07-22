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
  applyActDetail,
  applyArcDelta,
  applyArcUpgrade,
  applySagaChain,
  completeBeat,
  applyArcEnrichment,
  applyArcExtension,
  arcExhausted,
  extractPreviousResolution,
  lengthProfile,
  needsEnrichment,
  needsSagaUpgrade,
  nextSketchAct,
  parseActDetailJson,
  parseArcDeltaJson,
  parseArcEnrichmentJson,
  parseArcExtensionJson,
  parseSagaJson,
  parseSagaUpgradeJson,
  renderArcForPrompt,
  sagaComplete,
  type LengthProfile,
  type StoryArc,
} from "@/lib/dm/arc-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestDmMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { setDmStatus } from "@/lib/dm/status";

// Story-arc generation and upkeep. The arc is the DM's secret spine: a saga
// sized by the lead's campaign-length setting is generated once at campaign
// activation (for every campaign, whether or not AI story setup wrote the
// premise) and refreshed with a small clamped delta at each chapter close.
// The other passes hang off that same heartbeat: a v1 campaign gets its
// cast/event layers filled in once, a v2 campaign gets its saga tier once,
// a party that finished the current act gets the next sketch detailed into
// real beats, and a party that finished the whole saga gets a sequel saga
// instead of quietly losing its [NOW] marker. Every failure path is a
// silent no-op: the campaign falls back to dm_outline (or nothing) and
// generation retries at the next chapter close.

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

// Party-composition planning lines: pets, and AI companions the saga should
// plan moments for. A beastmaster's wolf or a drakewarden's drake is a
// promise the story ought to keep, so saga-scale generation (initial,
// upgrade, and sequel passes) is told explicitly to plan around them. The
// per-chapter refresh skips this to stay cheap; classes, subclasses, and
// backstories already ride along in worldContext's party roster.
const PET_PLANNING: Record<string, string> = {
  familiar:
    "plan a moment where the familiar matters (a scouting reveal, a creature only it can approach, a threat to it)",
  beast_companion:
    "plan encounters with notable beasts and at least one moment that tests the bond with the companion",
  drake: "plan draconic creatures, lore, or foes that resonate with the drake bond",
  other: "plan a moment where this creature companion matters",
};

function partyCompositionContext(campaignId: string): string {
  const lines: string[] = [];
  for (const sheet of listSheets(campaignId)) {
    if (sheet.isCompanion) {
      lines.push(
        `- ${sheet.name} is an AI ${sheet.companionKind === "guest" ? "guest ally" : "party companion"}${sheet.personality ? ` (personality: ${sheet.personality.slice(0, 120)})` : ""}: give them a personal stake somewhere in the saga.`,
      );
      continue;
    }
    const build = `${sheet.subclass ? `${sheet.subclass} ` : ""}${sheet.class}`;
    for (const pet of sheet.pets ?? []) {
      lines.push(
        `- ${sheet.name} is a ${build} with a ${pet.kind.replace("_", " ")} ("${pet.name}", ${pet.form}): ${PET_PLANNING[pet.kind] ?? PET_PLANNING.other}.`,
      );
    }
  }
  if (!lines.length) {
    return "";
  }
  return `Party composition notes; the plan must keep these promises (tie at least one boss, ally, or event to each line):\n${lines.join("\n")}`;
}

const EVENT_SHAPE =
  '{"kind": "npc_encounter"|"ally"|"twist"|"betrayal"|"deadline"|"discovery"|"setpiece", "name": string, "detail": string, "trigger": string, "actHint": int|null}';

// Shared by every prompt that can propose events. Both rules exist because
// the model broke them in verification: it wrote "Beat 5 occurs" as a
// trigger, and it wrote a "twist" that merely restated the antagonist line
// the DM already has in front of it.
const EVENT_RULES = `Two rules for every event you write. trigger is something that HAPPENS IN THE STORY and that the DM can recognise at the table ("the first time the party sleeps outside the walls", "when they open the reliquary"); it may never be a beat, act, chapter, or turn number, and never the word "beat" followed by a number. A twist or betrayal must reveal something that is NOT already stated in the premise, the stakes, the antagonist line, or any beat; if the DM already knows it, it reveals nothing and is not a twist.`;

const BOSS_SHAPE = '{"name": string, "detail": string}';

// The full saga JSON shape, shared by initial generation and sequel
// chaining (the chain adds one extra field in front).
const SAGA_SHAPE = `{"title": string, "premise": string, "stakes": string, "antagonist": string, "actPlan": [{"milestone": string, "boss": ${BOSS_SHAPE}, "allies": string[], "hooks": string[]}], "act1Beats": string[], "finale": string, "finaleBoss": ${BOSS_SHAPE}, "cast": [{"name": string, "role": string, "agenda": string}], "events": [${EVENT_SHAPE}], "subArcs": [{"name": string, "goal": string, "hook": string, "beats": string[]}]}`;

function sagaFieldRules(profile: LengthProfile): string {
  return `title: a name for the whole saga.
actPlan: ${profile.actsText} acts, ordered, escalating to the finale. Each entry is a SKETCH of one act: milestone is one sentence saying what the act accomplishes; boss names the major set-piece fight the act builds toward, with one sentence of detail; allies is 0 to 2 planned companion or temporary-ally encounters for the act; hooks is 0 to 2 ways the act touches a specific party member's abilities, pets, or backstory. Later acts stay sketches on purpose; they are detailed one act at a time when the party reaches them, so keep them broad enough to survive whatever the table does first.
act1Beats: 3 to 5 ordered beats for act 1 ONLY, one short sentence each. Never number them yourself, and do not write beats for any later act.
finaleBoss: the last act's boss is the saga's final boss; repeat them here.
cast: 2 to 4 recurring NPCs the campaign returns to, each with a concrete name and something they personally want. The antagonist may be one of them.
events: 4 to 6 planned special moments, most of them placed in the first two acts (actHint); later acts get their events when they are detailed. Use the kinds: a recurring NPC turning up (npc_encounter), a temporary ally or companion joining the party (ally), a revelation that reframes what came before (twist), someone the party trusted turning on them (betrayal), a clock that forces a choice (deadline), a find that opens a new road (discovery), or a memorable staged scene (setpiece). actHint is a soft placement only.
subArcs: ${profile.subArcsText} opening quest- or dungeon-scale threads; name and goal are player-safe and may appear in a quest log, hook is a DM-only secret tying the quest to the main story, beats are 2 to 4 expected steps.`;
}

const SAGA_STYLE_RULES = `Name concrete people, factions, and places instead of roles ("Vicar Osseth", "the Ashen Concord", "the drowned undercroft"), and stay consistent with any premise or outline you are given, carrying any twists it already names into events. Hook at least one boss, event, or cast member to each party member's own background, abilities, or backstory, and keep every promise in the party composition notes when they are given. Every string under 200 characters. Players never see any of this.`;

function sagaGenerateSystem(profile: LengthProfile): string {
  return `You plot the secret story saga an AI Dungeon Master will steer a long D&D 5e campaign by. It is a loose guideline of people and events to keep the story moving, not a script: the table will wander, and the DM must be able to improvise around it.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: ${SAGA_SHAPE}

${sagaFieldRules(profile)}

${EVENT_RULES}

${SAGA_STYLE_RULES}`;
}

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
    const profile = lengthProfile(campaign.gameSettings.campaignLength);
    const context = [
      worldContext(campaignId),
      partyCompositionContext(campaignId),
      campaign.dmOutline
        ? `The DM's existing secret outline; keep the arc consistent with it:\n${campaign.dmOutline}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const { message, error } = await requestDmMessage(
      campaign.settings,
      [
        { role: "system", content: sagaGenerateSystem(profile) },
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
    const arc = parseSagaJson(raw, profile);
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
        ? {
            note: nextSketchAct(advanced.arc)
              ? "That act is complete; the next act will be planned at the chapter break. Play a breather or transition scene until then."
              : "That was the saga's last beat; what comes next will be plotted at the chapter break. Play the aftermath.",
          }
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

const REFRESH_SYSTEM = `You maintain the AI DM's secret story arc between chapters of a D&D 5e campaign. Keep it brief and answer quickly. Compare the arc with what actually happened in the chapter that just closed and reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beatsDone": int[], "beatsSkipped": int[], "beatAnnotations": [{"beat": int, "detail": string}], "beatRewrites": [{"beat": int, "text": string}], "activeBeat": int|null, "subArcUpdates": [{"id": string, "status": "active"|"resolved"|"abandoned", "resolution": string}], "newSubArcs": [{"name": string, "goal": string, "hook": string, "beats": string[]}], "eventsFired": string[], "eventsDropped": string[], "newEvents": [${EVENT_SHAPE}], "castUpdates": [{"id": string, "notes": string, "status": "active"|"gone"}], "newCast": [{"name": string, "role": string, "agenda": string, "notes": string}], "sketchUpdates": [{"act": int, "milestone": string, "boss": ${BOSS_SHAPE}|null, "allies": string[]}]}

Be conservative. Empty arrays are a correct answer when little changed.
- beatsDone: mark a main beat done only if the chapter clearly accomplished it. Never renumber existing beats.
- beatsSkipped: use only when the party's own choices made a beat genuinely moot and it will never happen. This is how a story that went its own way keeps moving instead of stalling on a beat nobody will reach.
- beatAnnotations: at most 3. Attach what the table specifically did to the beat it touched, so later scenes can call back to it by name ("they let Marl go free and he owes them"). This is the normal way play changes the main beats; the beat's own text stays exactly as written.
- beatRewrites: at most 2, and ONLY when the players killed, exposed, or permanently altered the very thing a not-yet-played beat depends on, so the beat as written can no longer happen at all; rewrite it to the nearest beat that CAN happen. Prefer beatsSkipped plus a new sub-arc when the story merely went around a beat. Never rewrite a done or skipped beat, or a beat from a past act.
- eventsFired: ids of planned events the chapter actually delivered. eventsDropped: ids the story has moved past or made impossible. Dropping an event that no longer fits is correct and expected, not a failure.
- newEvents: at most 2, only for genuinely new special moments the players' own choices have set up.
- castUpdates: notes record how an NPC now stands with the party; status "gone" when they die or leave for good. newCast: at most 2, for people the players made important.
- newSubArcs: at most 2, only for genuinely new threads.
- sketchUpdates: at most 2, only for FUTURE acts (listed as "ahead, sketch only") whose plan this chapter invalidated, for example when the party already slew a planned boss. Set boss to null if the planned boss is gone, or name the replacement.

${EVENT_RULES}

If the story has drifted from the arc, do not rewrite the arc; annotate the beats, drop the events that no longer fit, and add or update a sub-arc that steers play back toward the current main beat.`;

const ACT_DETAIL_SYSTEM = `The party of a D&D 5e campaign has finished the current act of the AI DM's secret story arc, and the next act exists only as a sketch. Write that act's real beats now, growing out of what the table actually did. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"beats": string[], "milestone": string, "finale": string, "bossEvent": ${EVENT_SHAPE}|null, "newEvents": [${EVENT_SHAPE}], "newCast": [{"name": string, "role": string, "agenda": string}]}

beats: 3 to 5 ordered beats for the new act, one short sentence each, escalating from where play actually stands. Never restate, renumber, or rewrite existing beats.
milestone: the sketch's milestone, revised only if play has changed what this act must accomplish; otherwise repeat it.
bossEvent: the act's planned boss as a set-piece event with a trigger the DM can recognise in the fiction. If play already killed or dissolved the planned boss, name who or what fills that role now; null only if this act genuinely no longer has a boss.
finale: what this act escalates toward.
newEvents: at most 2 additional planned moments for the act; include one ally event if the sketch planned allies. newCast: at most 2.

${EVENT_RULES}

If play has invalidated parts of the sketch (a dead boss, a betrayed ally), adapt the act to what is true now rather than forcing the sketch. Reuse the campaign's existing cast and open threads instead of inventing a fresh world, and honor the party composition notes when they are given. Do NOT re-propose an event the arc already lists. Every string under 200 characters. Players never see this.`;

const UPGRADE_SYSTEM = `An ongoing D&D 5e campaign has a story arc but no saga plan above it. Wrap the existing arc into a longer saga: treat the acts already written as the saga's opening acts and sketch ONLY the acts still ahead. Keep it brief and answer quickly.

Reply with ONLY a strict JSON object, no code fences, shaped exactly: {"title": string, "plannedActs": int, "sketches": [{"milestone": string, "boss": ${BOSS_SHAPE}, "allies": string[], "hooks": string[]}], "finaleBoss": ${BOSS_SHAPE}}

title: a name for the whole saga, existing acts included. sketches: one entry per FUTURE act, in order, escalating toward a new larger finale beyond the arc's current one; each has a one-sentence milestone, a named boss the act builds toward (with one sentence of detail), 0 to 2 planned companion or ally encounters, and 0 to 2 hooks into a specific party member's abilities, pets, or backstory. finaleBoss: the last act's boss. plannedActs: the total number of acts including the ones already written.

You may NOT change, reword, reorder, or renumber the existing beats or acts: those already happened or are in play. Grow the future out of the arc's own antagonist, threats, and unfinished threads, and honor the party composition notes when they are given. Every string under 200 characters. Players never see this.`;

function sagaChainSystem(profile: LengthProfile): string {
  return `The party of a D&D 5e campaign has played the AI DM's secret story saga to its conclusion, and the table is still playing. Plot the SEQUEL saga: a new large story that grows out of the concluded one's consequences.

Reply with ONLY a strict JSON object, no code fences, shaped exactly (the fields after previousResolution form a complete new saga): {"previousResolution": string, ${SAGA_SHAPE.slice(1)}

previousResolution: one line recording how the concluded saga actually ended for the party.
${sagaFieldRules(profile)}

${EVENT_RULES}

Sequel rules: grow the new premise and stakes out of the concluded saga's consequences (a power vacuum, a surviving lieutenant, a debt come due, something the party's own victory unleashed). Never recycle a dead antagonist as the villain again. Reuse surviving cast members the party cares about in cast, and let act 1 open in the aftermath of the finale the party just played. ${SAGA_STYLE_RULES}`;
}

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

// One-time v2 -> v3 upgrade for a campaign already in progress: wraps the
// existing acts into a saga sized by the campaign-length setting and
// sketches the acts still ahead. Returns the original arc on any failure
// (it retries at the next chapter close, steering by the v2 render until
// then).
async function upgradeToSaga(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return arc;
  }
  const profile = lengthProfile(campaign.gameSettings.campaignLength);
  const minFuture = Math.max(1, profile.minActs - arc.acts);
  const maxFuture = Math.max(minFuture, profile.maxActs - arc.acts);
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    UPGRADE_SYSTEM,
    [
      `Current arc:\n${renderArcForPrompt(arc)}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
      partyCompositionContext(campaignId),
      `Sketch ${minFuture === maxFuture ? String(minFuture) : `${minFuture} to ${maxFuture}`} future act${maxFuture === 1 ? "" : "s"}.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "saga upgrade",
  );
  if (raw === null) {
    return arc;
  }
  const upgrade = parseSagaUpgradeJson(raw);
  if (!upgrade) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] saga upgrade: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyArcUpgrade(arc, upgrade);
}

// The party finished the current act: turn the next saga sketch into real
// beats, using everything that actually happened on the way here. On any
// failure the arc renders its "act complete, next act being planned"
// steering line and this pass retries at the next chapter close.
async function detailNextAct(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const sketch = nextSketchAct(arc);
  if (!sketch) {
    return arc;
  }
  const sketchLines = [
    `Milestone: ${sketch.milestone}`,
    sketch.boss ? `Planned boss: ${sketch.boss.name}. ${sketch.boss.detail}` : "",
    sketch.allies.length ? `Planned allies: ${sketch.allies.join("; ")}` : "",
    sketch.hooks.length ? `Party hooks: ${sketch.hooks.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    ACT_DETAIL_SYSTEM,
    [
      `Current arc:\n${renderArcForPrompt(arc)}`,
      `The next act's sketch:\n${sketchLines}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
      partyCompositionContext(campaignId),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "act detail",
  );
  if (raw === null) {
    return arc;
  }
  const detail = parseActDetailJson(raw);
  if (!detail) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] act detail: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applyActDetail(arc, detail);
}

// The party played the whole saga to its end: plot the sequel. The old saga
// joins priorSagas and its unresolved threads and surviving cast carry over
// (applySagaChain). On failure the concluded arc stays as-is, its aftermath
// steering line holds the table, and the chain retries at the next close.
async function chainSaga(campaignId: string, arc: StoryArc): Promise<StoryArc> {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return arc;
  }
  const profile = lengthProfile(campaign.gameSettings.campaignLength);
  const chapters = recentChapterLines(campaignId);
  const raw = await arcModelCall(
    campaignId,
    sagaChainSystem(profile),
    [
      `The concluded saga:\n${renderArcForPrompt(arc)}`,
      chapters ? `Chapters the party actually played:\n${chapters}` : "",
      partyCompositionContext(campaignId),
    ]
      .filter(Boolean)
      .join("\n\n"),
    "saga chain",
  );
  if (raw === null) {
    return arc;
  }
  const sequel = parseSagaJson(raw, profile);
  if (!sequel) {
    if (process.env.DM_DEBUG) {
      console.log("[dm-debug] saga chain: unparseable reply:", raw.slice(0, 500));
    }
    return arc;
  }
  return applySagaChain(arc, sequel, extractPreviousResolution(raw));
}

// Runs at chapter close, on the DM queue. Self-healing: a campaign that
// never got an arc (earlier failure, pre-feature campaign) generates one
// here instead, a pre-v2 arc gains its cast and event layers, a pre-v3 arc
// gains its saga tier, a finished act gets the next sketch detailed, and a
// finished saga chains into a sequel. The upgrade/detail/chain passes are
// mutually exclusive per close, so the worst case stays at three model
// calls on the queue.
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
    if (needsSagaUpgrade(arc)) {
      arc = await upgradeToSaga(campaignId, arc);
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
      if (sagaComplete(next)) {
        next = await chainSaga(campaignId, next);
      } else if (nextSketchAct(next)) {
        next = await detailNextAct(campaignId, next);
      } else if (needsSagaUpgrade(next)) {
        // The saga upgrade has not landed yet; the old whole-act extension
        // keeps a saga-less arc moving in the meantime.
        next = await extendStoryArc(campaignId, next);
      }
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
