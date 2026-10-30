import { noteTurnCall, turnCallOptions } from "@/lib/dm/turn-fit";
import { buildLinePrompt } from "@/lib/dm/safety-logic";
import { lineViolations } from "@/lib/dm/safety-lines-logic";
import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { requestDmMessage } from "@/lib/dm/model";
import { extractStoryText } from "@/lib/story-prompt";
import { stripToolText } from "@/lib/dm/tool-text";
import {
  buildCorrectionPrompt,
  guardOutcomes,
  ruleClaims,
  type Contradiction,
  type ResolvedOutcomes,
} from "@/lib/dm/engine-boundary";
import { claimKindsFor, withoutSentences, type ClaimKind, type NarrationClaim, type PartRead } from "@/lib/dm/claims-logic";
import { hasQuotedLine, type SpokenLine } from "@/lib/dm/speech";
import { guardGate, liveStateFor, readClaims, turnOverFor } from "@/lib/dm/claims";
import type { GuardKind, GuardOutcome, GuardReport } from "@/lib/narrator-quality";

// The DB/model rim of the engine-boundary guard. The ruling lives in
// dm/engine-boundary.ts (pure) and the reading in dm/claims.ts; this file
// only decides what to do about a detection, and its answer is deliberately
// small: ask the model to fix its own prose, once.
//
// That one call is held in reserve outside the turn's four-call budget. The
// turns most likely to contradict their results are the busy ones (an
// attack, the extra attack, end_turn and the enemies), and those are exactly
// the turns that end with the budget spent; a guard that could only log
// there would miss the turns it exists for.
//
// Never touches mechanical state. The dice, the hit points, and the slots
// already resolved through their tools before the narration existed; a
// contradiction is a prose bug, so only prose is ever changed. When the
// rewrite is no better, the original narration stands and the contradiction
// is logged rather than papered over.
//
// Its reads also say who speaks each quoted line of the narration that
// stands, which the turn stores with the message (src/lib/dm/speech.ts).

// The claim kinds the guard rules on for this turn, from engine state alone.
export function guardKinds(
  campaign: Campaign,
  outcomes: ResolvedOutcomes,
  sheets: readonly CharacterSheet[],
): ClaimKind[] {
  return claimKindsFor({
    ...guardGate(campaign, outcomes, sheets),
    rollAsk: false,
    fightStart: false,
    unrolled: false,
    speech: false,
  });
}

// What the narration contradicts, who speaks its quoted lines, and whose
// waiting turn it hands on (claims.ts turnOverFor): the claims already read
// with each part (the turn loop reads every reply it keeps), plus one read
// of the parts no read covered, ruled against the turn's outcomes and the
// encounter as it now stands.
async function readNarration(
  campaign: Campaign,
  turn: DmTurn,
  sheets: readonly CharacterSheet[],
  parts: readonly string[],
  partReads: ReadonlyMap<string, PartRead>,
): Promise<{ contradictions: Contradiction[]; lines: SpokenLine[]; handedOn: string | null; deeds: DeedClaim[]; unread: boolean }> {
  const outcomes = guardOutcomes(turn.conversation, liveStateFor(campaign.id), campaign.gameSettings.tableLanguage);
  const kinds = guardKinds(campaign, outcomes, sheets);
  const waiting = turnOverFor(campaign.id, turn);
  const asked: ClaimKind[] = waiting ? [...kinds, "turn_over"] : kinds;
  const wanted = (part: string): ClaimKind[] => (hasQuotedLine(part) ? [...asked, "speaker"] : asked);
  // A part read before this turn's outcomes gave the guard more to check (an
  // attack resolved after its prose was read) was never asked those kinds,
  // so it is read again with all of them, and that read replaces its own.
  const covered = (part: string) => {
    const read = partReads.get(part);
    return read && wanted(part).every((kind) => read.kinds.includes(kind)) ? read : null;
  };
  const known = parts.flatMap((part) => covered(part)?.claims ?? []);
  const unread = parts.filter((part) => !covered(part));
  // A reading that failed, here or when the part was read in the loop,
  // checked nothing: with kinds to rule on, the guard says so (issue #460).
  let failedRead = parts.some((part) => covered(part)?.unread);
  const read = await readClaims(campaign, {
    label: `turn ${turn.id}`,
    text: unread.join("\n\n"),
    kinds: [...new Set(unread.flatMap(wanted))],
    outcomes,
    sheets,
    onUnread: () => {
      failedRead = true;
    },
  });
  const claims = [...known, ...read];
  return {
    contradictions: ruleClaims(
      claims.filter((claim) => kinds.includes(claim.kind) && claim.kind !== "deed"),
      outcomes,
    ),
    lines: claims.flatMap((claim) => (claim.kind === "speaker" ? [{ line: claim.line, speaker: claim.speaker }] : [])),
    handedOn: waiting && claims.some((claim) => claim.kind === "turn_over") ? waiting : null,
    // A deed is no contradiction: the turn notes the ones nothing recorded
    // (src/lib/dm/deed-claims.ts).
    deeds: claims.flatMap((claim) => (claim.kind === "deed" ? [claim] : [])),
    unread: failedRead && kinds.length > 0,
  };
}

// What the server did with a spell the prose cast for nothing (castSlotless):
// cast it, rolling something the narration must now follow or not, or
// refused it with the rules' reason.
export type SlotlessCast = { rolled: boolean } | { refused: string };

// What the guard leaves the turn: who speaks the narration's lines, and the
// player's character whose turn the narration that stands hands on.
// And the deeds it shows a party character commit (issue 503), which the
// turn holds against the relationship_beat calls it made. And what the
// guard itself did, for the turn's narrator quality row (issue #460,
// src/lib/narrator-quality.ts GuardOutcome), rather than only a log line.
export type GuardedNarration = { spoken: SpokenLine[]; handedOn: string | null; deeds: DeedClaim[]; guard: GuardReport };

// The contradiction kinds found, and a line crossed, by name only.
function kindsOf(contradictions: readonly Contradiction[], crossed: readonly string[]): GuardKind[] {
  const kinds = new Set<GuardKind>(contradictions.map((entry) => entry.kind));
  if (crossed.length) {
    kinds.add("line");
  }
  return [...kinds];
}

type DeedClaim = Extract<NarrationClaim, { kind: "deed" }>;

// When the rewrite cannot be used, the sentences that contradict the results
// are cut from what the table reads instead: a hit written on a miss, a blow
// nobody rolled, a death that did not happen. A small model's rewrite often
// kept the claim (Qwen3.6-35B at Q2 landed a club on a character whose
// attacker was out of reach, and kept it when asked to fix it). Cut only when
// enough of the story is left to read; otherwise the original stands, as
// before.
function cutContradictions(turn: DmTurn, contradictions: readonly Contradiction[], summary: string): void {
  const quotes = contradictions.map((entry) => entry.clause).filter(Boolean);
  if (!quotes.length) {
    return;
  }
  const before = turn.narrationParts.join("\n\n").trim();
  const parts = turn.narrationParts.map((part) => withoutSentences(part, quotes).trim()).filter(Boolean);
  const after = parts.join("\n\n");
  if (after === before || after.length < Math.min(120, Math.floor(before.length / 3))) {
    return;
  }
  turn.narrationParts.length = 0;
  turn.narrationParts.push(...parts);
  console.warn(`[engine-boundary] turn ${turn.id}: cut the sentences the correction left contradicting (${summary})`);
}

export async function enforceEngineBoundary(
  campaign: Campaign,
  turn: DmTurn,
  sheets: readonly CharacterSheet[],
  // What each kept reply was read for, by its persisted text.
  partReads: ReadonlyMap<string, PartRead>,
  // The tools the turn's calls were sent, kept in the rewrite's prompt so a
  // local narrator's cache holds (src/lib/dm/turn.ts proseOnlyTools).
  tools: readonly unknown[] = [],
  // The cards from the Hand no call carried out, which go back to their
  // players (issue 570, intent-logic.ts returnedCardNote): the story must not
  // tell them happening. Asked whatever the prose says, with the check on.
  returned: readonly string[] = [],
  // Casts a spell the prose cast with nothing behind it, when its caster's
  // player asked for it and their words fix the call (issue 570,
  // src/lib/dm/turn.ts castSlotless): what the engine answered, or null to
  // write it out of the story as before.
  castSlotless?: (cast: NonNullable<Contradiction["cast"]>) => Promise<SlotlessCast | null>,
): Promise<GuardedNarration> {
  const narration = turn.narrationParts.join("\n\n").trim();
  if (!narration) {
    return { spoken: [], handedOn: null, deeds: [], guard: { outcome: "none", kinds: [] } };
  }
  // A line crossed is refused the same way a hit written on a miss is
  // (docs/vtt-parity-implementation-plan.md 9.1), whether or not the
  // outcome check is on: safety is not a setting.
  const lines = campaign.gameSettings.safety?.lines ?? [];
  const crossed = lineViolations(narration, lines, campaign.gameSettings.tableLanguage);
  const read = await readNarration(campaign, turn, sheets, turn.narrationParts, partReads);
  const { lines: spoken, handedOn, deeds, unread } = read;
  const found = kindsOf([...read.contradictions, ...(campaign.gameSettings.narrationGuard ? returned.map(() => ({ kind: "card" as const, detail: "", clause: "" })) : [])], crossed);
  const kept = (outcome: GuardOutcome): GuardedNarration => ({ spoken, handedOn, deeds, guard: { outcome, kinds: found } });
  // A spell the prose cast with nothing behind it, which its player asked
  // for, is cast now rather than written out of the story (issue 570). The
  // rewrite then tells a rolled result as the dice fell; a cast that rolled
  // nothing (a utility spell, a buff on oneself) stands as the prose told
  // it, and a refusal is told instead of the spell.
  let castNow = false;
  const contradictions: Contradiction[] = [];
  for (const entry of read.contradictions) {
    const cast = entry.kind === "spell" && entry.cast && castSlotless ? await castSlotless(entry.cast) : null;
    if (!cast || !entry.cast) {
      contradictions.push(entry);
      continue;
    }
    castNow = true;
    const { caster, spell } = entry.cast;
    if ("refused" in cast) {
      contradictions.push({ kind: "spell", clause: entry.clause, detail: `${caster} could not cast ${spell}: ${cast.refused.replace(/\.$/, "")}. The narration must tell that instead of the spell taking effect` });
    } else if (cast.rolled) {
      contradictions.push({ kind: "spell", clause: entry.clause, detail: `${caster}'s ${spell} has now been cast by the server, as their player asked: its result is the last tool result above. Narrate it from that result (the roll, the save, the damage), not from what you wrote` });
    }
  }
  if (campaign.gameSettings.narrationGuard) {
    contradictions.push(...returned.map((detail) => ({ kind: "card" as const, detail, clause: "" })));
  }
  if (!contradictions.length && !crossed.length) {
    // Nothing found: because nothing was wrong, because the table turned
    // the check off, or because the reader failed and checked nothing; or
    // all it found was a spell the server has now cast as the prose told it.
    return kept(castNow ? "cast" : !campaign.gameSettings.narrationGuard ? "off" : unread ? "unread" : "quiet");
  }

  const summary = [...contradictions.map((entry) => entry.detail), ...crossed.map((line) => `line crossed: ${line}`)].join("; ");

  // The narration is echoed back explicitly: a turn that ended on a pure
  // narration call never pushed that assistant message into the conversation,
  // so without this the model would be asked to rewrite prose it cannot see and
  // would invent a fresh scene instead.
  const rewrite = await requestDmMessage(
    campaign.settings,
    [
      ...turn.conversation,
      { role: "assistant", content: narration },
      {
        role: "user",
        content: [contradictions.length ? buildCorrectionPrompt(contradictions) : "", crossed.length ? buildLinePrompt(crossed) : ""]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    // toolChoice "none": this call exists to rewrite prose, and a tool call
    // here would resolve mechanics a second time (one made anyway is dropped
    // below). It is the reserved call, so it is made whatever the turn's
    // budget has left.
    { tools: [...tools], toolChoice: "none", thinking: false, ...turnCallOptions(campaign, turn, "guard_rewrite") },
  );
  noteTurnCall(turn, "guard_rewrite", [], rewrite);
  const { message, error } = rewrite;
  turn.callIndex += 1;
  if (error) {
    console.warn(`[engine-boundary] turn ${turn.id}: correction call failed (${summary})`);
    cutContradictions(turn, contradictions, summary);
    return kept("call_failed");
  }

  // Tool text the rewrite wrote out (a call it was not offered, as brackets,
  // XML or bare JSON) is stripped like every other narration path does;
  // stripToolText also drops hand-written roll markers.
  const corrected = stripToolText(extractStoryText(message?.content)).trim();
  // A stub reply ("Understood.") technically contradicts nothing; the table
  // would rather have the flawed paragraph it already watched stream in.
  if (corrected.length < Math.min(120, Math.floor(narration.length / 3))) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: correction came back too short to use (${summary})`,
    );
    cutContradictions(turn, contradictions, summary);
    return kept("kept_short");
  }
  // A rewrite is only an improvement if it actually removes contradictions. A
  // model that swapped one wrong claim for another keeps its original text,
  // which at least the table already saw streaming.
  const { contradictions: remaining, lines: respoken, handedOn: rehanded } = await readNarration(campaign, turn, sheets, [corrected], new Map());
  const stillCrossed = lineViolations(corrected, lines, campaign.gameSettings.tableLanguage);
  if (remaining.length + stillCrossed.length >= contradictions.length + crossed.length) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: correction did not resolve the contradiction (${summary})`,
    );
    cutContradictions(turn, contradictions, summary);
    return kept("kept_unresolved");
  }
  // finalize() renders the turn's dice cards between the last narration part
  // and the ones before it, so a multi-part turn keeps that shape: the rewrite
  // splits back at its final paragraph break rather than collapsing to one
  // block and pushing every roll card above the whole message.
  const multiPart = turn.narrationParts.length > 1;
  const paragraphs = corrected.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  turn.narrationParts.length = 0;
  if (multiPart && paragraphs.length > 1) {
    turn.narrationParts.push(
      paragraphs.slice(0, -1).join("\n\n"),
      paragraphs[paragraphs.length - 1],
    );
    return { spoken: respoken, handedOn: rehanded, deeds, guard: { outcome: "rewritten", kinds: found } };
  }
  turn.narrationParts.push(corrected);
  return { spoken: respoken, handedOn: rehanded, deeds, guard: { outcome: "rewritten", kinds: found } };
}
