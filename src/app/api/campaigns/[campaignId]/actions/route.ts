import { z } from "zod";
import { ACTION_MAX_CHARS, textLength, tooLongMessage } from "@/lib/text-limits";
import { resolveActionCharacter } from "@/lib/player-characters";
import { currentPcId } from "@/lib/character-seat";
import { getActiveEncounter } from "@/lib/db/encounters";
import { isErrorResponse, requireVoice } from "@/lib/campaign-api";
import {
  allocateSeq,
  campaignSeats,
  canAct,
  claimRecap,
  getFloor,
  combatOwnsFloor,
} from "@/lib/db/campaigns";
import { countMessages, insertCampaignMessage, listRecentMessages } from "@/lib/db/messages";
import { getSheetById, getSheetForUser, listSheets } from "@/lib/db/sheets";
import { dominatedRefusal } from "@/lib/dm/companion-command";
import { heroFell } from "@/lib/characters/fallen-logic";
import { answerSpotlight } from "@/lib/dm/spotlight-answer";
import { requestDmTurn } from "@/lib/dm/loop";
import { settleTableWait, waitsForTable } from "@/lib/dm/table-wait";
import { holdsPostForTable } from "@/lib/dm/table-wait-logic";
import { coverInEffect } from "@/lib/dm/delegation";
import { hasHumanDm, isPrimaryDm } from "@/lib/dm/viewer";
import { invokeEngine } from "@/lib/dm/invoke";
import { claimNarrationSeq } from "@/lib/dm/narration-slot";
import { enqueueDmJob } from "@/lib/dm/queue";
import { runResumeRecap } from "@/lib/dm/recap";
import { RECAP_AFTER_MS } from "@/lib/dm/session-hold-logic";
import { sessionHoldOn } from "@/lib/dm/session-hold";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { directCardCall, parseMessageIntent } from "@/lib/dm/intent-logic";
import { addressesDm } from "@/lib/dm/ooc-question";
import { spokenLine } from "@/lib/dm/speech";
import { intentRefusal } from "@/lib/dm/intent-check";
import { concentrationSwapFor } from "@/lib/dm/concentration-confirm";
import { inCoordination } from "@/lib/dm/coordination";
import { confirmsSwap, swapQuestion } from "@/lib/dm/concentration-confirm-logic";
import { tableAuthors } from "@/lib/db/homebrew";
import { refuseDuringBreak } from "@/lib/dm/table-break";
import { isSecretActionBody, secretActionResponse } from "@/lib/dm/secret-action-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The length is checked after the shape, so a long move hears its limit
// rather than "Invalid action." (issue 207).
const actionSchema = z.object({
  content: z.string().trim().min(1),
  characterId: z.string().trim().min(1).optional(),
  kind: z.enum(["do", "say", "ooc"]).default("do"),
  // The card the Hand played, beside the sentence it wrote. Optional: typed
  // actions and older clients send none, and a malformed one is dropped
  // rather than refusing the action (src/lib/dm/intent-logic.ts).
  intent: z.unknown().optional(),
  // The player's yes to a cast that ends their running concentration spell
  // (issue 252), naming exactly what they agreed to: it answers only while
  // the character, the running spell and the new one are still those.
  concentrationAck: z
    .object({
      characterId: z.string().trim().min(1).max(80),
      current: z.string().trim().min(1).max(120),
      next: z.string().trim().min(1).max(120),
    })
    .optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireVoice(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const { campaign, user } = context;
  if (campaign.status !== "active") {
    return Response.json({ error: "The adventure has not started yet." }, { status: 400 });
  }

  const selected = getSheetForUser(campaignId, user.id);
  if (!selected) {
    return Response.json({ error: "You need a character to act." }, { status: 400 });
  }

  const raw = await request.json().catch(() => ({}));
  // A secret action (issue 503 Phase 7) is held by the server, never posted.
  if (isSecretActionBody(raw)) {
    return secretActionResponse(campaign, user.id, selected, raw);
  }
  const parsed = actionSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid action." }, { status: 400 });
  }
  if (textLength(parsed.data.content) > ACTION_MAX_CHARS) {
    const what = parsed.data.kind === "say" ? "A line" : parsed.data.kind === "ooc" ? "Table talk" : "A move";
    return Response.json(
      { error: tooLongMessage(what, ACTION_MAX_CHARS, textLength(parsed.data.content)), maxChars: ACTION_MAX_CHARS },
      { status: 400 },
    );
  }

  const { kind } = parsed.data;
  // A table break (src/lib/dm/table-break.ts) stops play where it stands:
  // table talk goes on, nothing in character does, and the floor underneath
  // is left alone so Resume picks up exactly there.
  const paused = kind === "ooc" ? null : refuseDuringBreak(campaignId);
  if (paused) {
    return paused;
  }
  // A character dominated by the other side is the DM's to play until the
  // charm ends (src/lib/dm/companion-command.ts): its player hears why,
  // whoever's turn it is. Table talk is free.
  const named = parsed.data.characterId ? getSheetById(parsed.data.characterId) : null;
  const acting = named && named.campaignId === campaignId && named.userId === user.id ? named : selected;
  const held = kind === "ooc" ? null : dominatedRefusal(campaignId, acting);
  if (held) {
    return Response.json({ error: held, dominated: true }, { status: 409 });
  }
  const intent = kind === "do" ? parseMessageIntent(parsed.data.intent) : null;
  // Floor control: during a spotlight only the named players may act (ooc is
  // always allowed); the floor releases once ALL of them have answered.
  // During a hold nobody may act until the lead releases. This read-modify-
  // write must stay await-free so it is atomic in Node.
  const floor = getFloor(campaignId);
  // A reaction is taken on somebody else's turn (SRD 5.1): a reaction card
  // passes the initiative floor, and the engine's canAct judges it below.
  // The same holds while a person plays the enemies' turns under a hold
  // (src/lib/dm/enemies-due.ts): that is when a Shield or an opportunity
  // attack is wanted most.
  const reactionOffTurn = intent?.card === "reaction" && combatOwnsFloor(floor);
  if (!reactionOffTurn && !canAct(floor, user.id, kind)) {
    if (floor.mode === "hold") {
      // The enemies hold the floor only while some are still owed a turn
      // (src/lib/dm/enemies-due.ts); a hold over a fight with none due is
      // the storyteller's, and says so.
      const enemiesDue = combatOwnsFloor(floor) && (getActiveEncounter(campaignId)?.legendary.due?.length ?? 0) > 0;
      return Response.json(
        {
          error: enemiesDue
            ? "The enemies are taking their turns; the GM hands the turn on. Use OOC for table talk."
            : `The ${campaign.dmUserId ? "GM" : "party lead"} has not opened responses yet. Use OOC for table talk.`,
          floor,
        },
        { status: 409 },
      );
    }
    if (floor.mode === "initiative") {
      return Response.json(
        {
          error: `It is ${floor.currentName || "another character"}'s turn in the initiative order. Use OOC for table talk.`,
          floor,
        },
        { status: 409 },
      );
    }
    const waitingOn =
      floor.mode === "spotlight"
        ? listSheets(campaignId)
            .filter(
              (entry) =>
                floor.userIds.includes(entry.userId) &&
                !floor.respondedUserIds.includes(entry.userId) &&
                !heroFell(entry),
            )
            .map((entry) => entry.name)
            .join(", ")
        : "";
    return Response.json(
      {
        error: waitingOn
          ? `The GM is waiting on ${waitingOn}. Use OOC for table talk.`
          : "It is not your moment to act.",
        floor,
      },
      { status: 409 },
    );
  }

  // Which of the player's characters acts (src/lib/player-characters.ts):
  // the one named, else the one whose turn it is, else the selected one.
  // The floor has already said whether this player may act at all, so a
  // refusal here is only ever about the wrong sibling. The initiative
  // pointer binds only while the fight owns the floor: a table the DM opened
  // mid-fight is free to act as whoever it has selected.
  const actor = resolveActionCharacter({
    sheets: listSheets(campaignId),
    userId: user.id,
    selectedId: selected.id,
    characterId: parsed.data.characterId,
    initiativeId: kind !== "ooc" && combatOwnsFloor(floor) ? currentPcId(getActiveEncounter(campaignId)) : undefined,
    reaction: intent?.card === "reaction",
    multiCharacter: campaign.gameSettings.multiCharacter,
  });
  if ("error" in actor) {
    return Response.json({ error: actor.error, floor }, { status: actor.status });
  }
  const { sheet } = actor;
  // A card the engine would refuse is refused here, with the engine's own
  // reason and before anything is posted, so the Hand never marks spent a
  // card that was never going to resolve (src/lib/dm/intent-check.ts).
  if (intent) {
    const refusal = intentRefusal(campaign, sheet, intent);
    if (refusal) {
      return Response.json({ error: refusal }, { status: 409 });
    }
  }
  // A character in the plan the party is coordinating puts its move there,
  // not straight to the DM (issue 254): the plan resolves as one beat, and a
  // move posted beside it would wake the DM before it. Table talk is free.
  if (kind !== "ooc" && inCoordination(campaignId, sheet.id)) {
    return Response.json(
      { error: `The party is coordinating its next move; put ${sheet.name}'s part in the plan above the box, or ask the lead to set the plan aside.`, coordinating: true },
      { status: 409 },
    );
  }
    // A cast that would end the character's running concentration spell is
  // asked about first (issue 252): nothing is posted, no floor is spent and
  // no DM turn wakes until the player says yes, and the yes is checked
  // against the state now, so an old answer cannot authorise another cast.
  const swap = concentrationSwapFor(sheet, { intent, content: parsed.data.content, kind }, tableAuthors(campaignId));
  if (swap && !confirmsSwap(swap, parsed.data.concentrationAck)) {
    return Response.json(
      { error: swapQuestion(swap, sheet.name), confirmConcentration: { ...swap, characterName: sheet.name } },
      { status: 409 },
    );
  }
  // A card the DM plays for a character they hold, at a table they run (a
  // test fight a person runs, issue 553): the one who would adjudicate it
  // played it, so the engine resolves it now, with the same call an AI turn
  // makes before it narrates (directCardCall), and nothing waits in the DM's
  // queue for the DM. A card the engine cannot resolve whole (a spell, a
  // rider) is posted below and queued as any player's is, for the console.
  const dmSeats = campaignSeats(campaign);
  const direct = intent && kind === "do" && hasHumanDm(dmSeats) && isPrimaryDm(dmSeats, user.id) ? directCardCall(intent, sheet.id) : null;
  if (direct) {
    const resolved = await invokeEngine(campaign, { kind: "human", userId: user.id }, direct);
    if (!resolved.ok) {
      return Response.json({ error: resolved.error }, { status: 409 });
    }
    return Response.json({ resolved: true });
  }
  const spotlightStillWaiting = kind !== "ooc" && answerSpotlight(campaignId, floor, user.id);

  const content =
    kind === "say"
      ? spokenLine(parsed.data.content)
      : kind === "ooc"
        ? `(ooc) ${parsed.data.content}`
        : parsed.data.content;

  const isFirstAction = countMessages(campaignId) === 0;

  // Returning after a long break: enqueue a "Previously..." recap before
  // this action's DM turn (claimRecap makes it at most once per gap).
  const lastMessages = listRecentMessages(campaignId, 1);
  const lastMessage = lastMessages[lastMessages.length - 1];
  // The same gap a session started after a long one is recapped for
  // (src/lib/dm/session-hold-logic.ts).
  const RECAP_IDLE_MS = RECAP_AFTER_MS;
  // Assisted mode, DM stepped away: the AI answers for the counted stretch
  // they handed over, so the branch below is the one that already exists for
  // an AI-run table rather than a third path.
  const covering = coverInEffect(
    campaign.gameSettings.dmMode,
    campaign.gameSettings.dmAssist,
    campaign.dmCover,
  );
  const humanDm = hasHumanDm(campaignSeats(campaign)) && !covering;
  // A person's table gets the recap too: it is a utility call that wakes no
  // DM turn, and recap.ts writes the DM's own secret track for exactly them.
  // Between sessions the recap is the next session's to open with
  // (src/lib/dm/session-hold.ts startSession), not table talk's.
  if (
    lastMessage &&
    !sessionHoldOn(campaignId) &&
    Date.now() - new Date(lastMessage.createdAt).getTime() > RECAP_IDLE_MS &&
    claimRecap(campaignId, lastMessage.seq)
  ) {
    enqueueDmJob(campaignId, () => runResumeRecap(campaignId));
  }

  // A reply to narration still streaming lands after it, not above it: the
  // narration claims the seq before this one (src/lib/dm/narration-slot.ts).
  claimNarrationSeq(campaignId);
  const seq = allocateSeq(campaignId);
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "player",
    userId: user.id,
    characterId: sheet.id,
    content,
    intent,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });

  // OOC table talk does not wake the DM; everything else requests a
  // narration turn, except while a spotlight still waits on other players:
  // the single coalesced turn fires with the last answer and reads all the
  // queued messages. Requests coalesce: rapid actions share one turn (plus
  // at most one follow-up for actions landing mid-turn) instead of stacking.
  //
  // With a person in the DM seat there is no turn to wake. The action is an
  // intent: it sits in the DM's queue until they adjudicate it, and all the
  // table sees is that it landed. The message row and the floor bookkeeping
  // above are identical either way, which is what keeps one transcript.
  //
  // A person's queue takes every action as it lands, a spotlight answer
  // included: the coalescing that waits for the last answer is the AI turn's,
  // and holding answers back from a person lost all but the last of them.
  //
  // Table talk naming "@DM" is a question for the DM and wakes the AI for an
  // out-of-character answer (src/lib/dm/ooc-question.ts); a person in the
  // seat reads it where it lands.
  const askedDm = kind === "ooc" && addressesDm(parsed.data.content);
  if (humanDm ? kind !== "ooc" || isFirstAction : (kind !== "ooc" && !spotlightStillWaiting) || askedDm || isFirstAction) {
    if (humanDm) {
      publishPersisted(campaignId, "dm_intent_queued", {
        messageId: message.id,
        userId: user.id,
        characterId: sheet.id,
        seq,
      });
    } else if (holdsPostForTable({ floorBefore: floor.mode, kind, isFirstAction, waits: waitsForTable(campaign) })) {
      // Wait for the table (src/lib/dm/table-wait.ts): an open-floor post
      // joins the gathering beat, and the one turn that answers it runs when
      // the last present player has acted or passed, or the time runs out.
      // A spotlight answer never lands here: floor is the floor before this
      // post, so the answer that releases a spotlight wakes the DM below.
      if (settleTableWait(campaignId)) {
        requestDmTurn(campaignId);
      }
    } else {
      // Under a running cover, requestDmTurn itself spends one of the DM's
      // handed-over answers per enqueued turn (and none on a coalesced one),
      // so a burst of actions costs the DM one answer and not five.
      requestDmTurn(campaignId);
    }
  }

  return Response.json({ messageId: message.id }, { status: 202 });
}
