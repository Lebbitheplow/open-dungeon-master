// The heading that closes the campaign-static part of the DM's system prompt.
// src/lib/dm/prompt.ts buildDmSystem puts it after the rules that change only
// with the campaign's settings, as a paragraph of its own; below it come the
// DM-cover countdown, the rules that switch on and off during play and the
// game state that changes every turn. To every model it is a plain heading;
// the Claude Code adapter (src/lib/harness/adapters/claude.ts) swaps it for
// Claude Code's cache boundary, so the text above it is cached across turns.
// Renaming it is safe; removing it from prompt.ts silently turns that caching
// off, which scripts/test-harness-logic.mjs catches. No imports, so the DM and
// harness tiers share it without importing each other.
export const THIS_TURN_HEADING = "=== THIS TURN ===";
