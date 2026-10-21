// How big a context window the storyteller needs, measured through the
// request fitter (src/lib/dm/request-fit.ts) on qwen3.6-35b and Gemma 4 E4B
// (docs/agent-context-efficiency-audit-2026-10-17.md). The DM's instructions
// and the compact tool set take about 15K tokens before any story is told:
// 16K plays narration, exploration and checks; a fight adds its tools and the
// turn order (about 18K on the narrowest set), so 24K runs fights with room
// to reply; 32K keeps recent turns in view as well. The README, the guided
// setup, the model pickers and the window-too-small refusal all quote these,
// and scripts/test-story-window.mjs keeps the docs saying the same.
//
// Round thousands, as the model catalog counts them, so a model sold as
// "16K" (16,000 tokens) is not told it is short of 16K; the llama-server
// commands the docs give (-c 16384, 24576, 32768) clear each one.
export const MIN_NARRATION_WINDOW = 16_000;
export const MIN_COMBAT_WINDOW = 24_000;
export const RECOMMENDED_WINDOW = 32_000;
// The window the docs' llama-server commands start with (-c 65536): the
// full tool set with a long transcript. The app asks Ollama for no more than
// this unless LOCAL_TEXT_CONTEXT says otherwise (model-client.ts
// localContextTokens).
export const DEFAULT_WINDOW = 65_536;

// llama-server's -c counts in 1,024s (65536 is "64K"), the catalog in
// thousands (128000 is "128K"); each size is named the way it was set.
export function windowLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / (tokens % 1_000 !== 0 && tokens % 1_024 === 0 ? 1_024 : 1_000))}K`;
}

// "A 16K window", "An 8K window".
export function aWindow(tokens: number): string {
  const size = windowLabel(tokens);
  return `${/^(8|11|18)/.test(size) ? "An" : "A"} ${size}`;
}

// The value to start llama-server with (-c) for at least this many tokens.
export function windowFlag(tokens: number): number {
  return Math.ceil(tokens / 1_024) * 1_024;
}

// The one sentence every surface uses for the requirement itself.
export const STORY_WINDOW_NEEDS = `The storyteller needs a context window of at least ${windowLabel(MIN_NARRATION_WINDOW)} tokens to narrate and ${windowLabel(MIN_COMBAT_WINDOW)} to run fights; ${windowLabel(RECOMMENDED_WINDOW)} or more is recommended.`;

export type StoryWindowLevel = "short" | "no-fights" | "tight" | "ok";

// What a table can do in a window, worded for the admin choosing a model.
// Empty text when the window is enough for everything.
export function storyWindowVerdict(tokens: number): { level: StoryWindowLevel; text: string } {
  const size = aWindow(tokens);
  if (tokens < MIN_NARRATION_WINDOW) {
    return {
      level: "short",
      text: `${size} window is too small to narrate: the DM's instructions and tools leave no room for the story. ${STORY_WINDOW_NEEDS}`,
    };
  }
  if (tokens < MIN_COMBAT_WINDOW) {
    return {
      level: "no-fights",
      text: `${size} window narrates and explores, but fights need ${windowLabel(MIN_COMBAT_WINDOW)}: below that a fight turn can be refused for room. ${windowLabel(RECOMMENDED_WINDOW)} or more is recommended.`,
    };
  }
  if (tokens < RECOMMENDED_WINDOW) {
    return {
      level: "tight",
      text: `${size} window plays, fights included, but keeps only the last few turns in view; ${windowLabel(RECOMMENDED_WINDOW)} or more is recommended.`,
    };
  }
  return { level: "ok", text: "" };
}
