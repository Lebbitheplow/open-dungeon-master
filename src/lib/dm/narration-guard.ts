import type { Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { requestDmMessage } from "@/lib/dm/model";
import { extractStoryText } from "@/lib/story-prompt";
import { fakeRollMarkerRegex } from "@/lib/dm/tool-text";
import { buildCorrectionPrompt, checkNarration } from "@/lib/dm/engine-boundary";

// The DB/model rim of the engine-boundary guard. All the matching lives in
// dm/engine-boundary.ts (pure); this file only decides what to do about a
// detection, and its answer is deliberately small: ask the model to fix its
// own prose, once, inside the turn's existing call budget.
//
// Never touches mechanical state. The dice, the hit points, and the slots
// already resolved through their tools before the narration existed; a
// contradiction is a prose bug, so only prose is ever changed. When the budget
// is gone, or the rewrite is no better, the original narration stands and the
// contradiction is logged rather than papered over.

export async function enforceEngineBoundary(
  campaign: Campaign,
  turn: DmTurn,
  callsRemaining: number,
  sheets: readonly CharacterSheet[],
): Promise<void> {
  if (!campaign.gameSettings.narrationGuard) {
    return;
  }
  const narration = turn.narrationParts.join("\n\n").trim();
  if (!narration) {
    return;
  }
  const partyNames = sheets.map((sheet) => sheet.name);
  const contradictions = checkNarration({
    conversation: turn.conversation,
    narration,
    partyNames,
  });
  if (!contradictions.length) {
    return;
  }

  const summary = contradictions.map((entry) => entry.detail).join("; ");
  if (callsRemaining < 1) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: narration contradicts the resolved outcomes, but the model-call budget is spent (${summary})`,
    );
    return;
  }

  // The narration is echoed back explicitly: a turn that ended on a pure
  // narration call never pushed that assistant message into the conversation,
  // so without this the model would be asked to rewrite prose it cannot see and
  // would invent a fresh scene instead.
  const { message, error } = await requestDmMessage(
    campaign.settings,
    [
      ...turn.conversation,
      { role: "assistant", content: narration },
      { role: "user", content: buildCorrectionPrompt(contradictions) },
    ],
    // No tools: this call exists to rewrite prose, and a tool call here would
    // resolve mechanics a second time.
    { tools: [], toolChoice: "none", thinking: false },
  );
  turn.callIndex += 1;
  if (error) {
    console.warn(`[engine-boundary] turn ${turn.id}: correction call failed (${summary})`);
    return;
  }

  const corrected = extractStoryText(message?.content)
    .replace(fakeRollMarkerRegex(), "")
    .trim();
  // A stub reply ("Understood.") technically contradicts nothing; the table
  // would rather have the flawed paragraph it already watched stream in.
  if (corrected.length < Math.min(120, Math.floor(narration.length / 3))) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: correction came back too short to use (${summary})`,
    );
    return;
  }
  // A rewrite is only an improvement if it actually removes contradictions. A
  // model that swapped one wrong claim for another keeps its original text,
  // which at least the table already saw streaming.
  const remaining = checkNarration({
    conversation: turn.conversation,
    narration: corrected,
    partyNames,
  });
  if (remaining.length >= contradictions.length) {
    console.warn(
      `[engine-boundary] turn ${turn.id}: correction did not resolve the contradiction (${summary})`,
    );
    return;
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
    return;
  }
  turn.narrationParts.push(corrected);
}
