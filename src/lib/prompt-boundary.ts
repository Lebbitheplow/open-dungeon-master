// The heading that closes the campaign-static part of the DM's system prompt.
// src/lib/dm/prompt.ts buildDmSystem puts it after the rules that change only
// with the campaign's settings, as a paragraph of its own; below it come the
// DM-cover countdown, the rules that switch on and off during play and the
// game state. To every model it is a plain heading; the Claude Code adapter
// (src/lib/harness/adapters/claude.ts) swaps it for Claude Code's cache
// boundary, so the text above it is cached across turns.
// Renaming it is safe; removing it from prompt.ts silently turns that caching
// off, which scripts/test-harness-logic.mjs catches. No imports, so the DM and
// harness tiers share it without importing each other.
export const THIS_TURN_HEADING = "=== THIS TURN ===";

// Opens the part of the game state that changes from one turn to the next
// (src/lib/dm/prompt.ts buildGameStateBlock); it runs to the end of the
// system prompt, so the rules and the standing state before it stay the same
// from turn to turn. Every model reads that part last: an agent program after
// the transcript (src/lib/harness/render.ts renderTurn), a chat model after
// the history (prompt.ts momentAfterHistory). It repeats the game state's
// framing, so the part still reads as authoritative there.
export const THIS_MOMENT_HEADING = "=== GAME STATE, THIS MOMENT (authoritative; never contradict) ===";

// Closes the turn-to-turn part when a chat model reads it after the history:
// the newest player line is then no longer the last thing the model reads,
// and on the default local model (Qwen3.6-35B) that cost the roll on an
// explicit search in two of three scripted runs, narrated as found or not
// found with no dice. An agent program's opening message ends on the same
// instruction (src/lib/harness/render.ts renderTurn).
export const MOMENT_INSTRUCTION =
  "It is your turn as the Game Master. Resolve what the players just did with your tools, then write the narration.";

// A system prompt cut at THIS_MOMENT_HEADING: the text before it, and the
// turn-to-turn part from the heading on ("" when the prompt has none).
export function splitAtMoment(text: string): { standing: string; moment: string } {
  const at = text.indexOf(THIS_MOMENT_HEADING);
  return at < 0 ? { standing: text, moment: "" } : { standing: text.slice(0, at).trimEnd(), moment: text.slice(at) };
}
