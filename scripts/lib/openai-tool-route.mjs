// How OpenAI runs function tools for a model, read from its name, and from
// the 400 it answers when the name did not say. Shared by the server
// (src/lib/dm/sampling-logic.ts) and the backend probe
// (scripts/lib/provider-capability-probe.mjs), so the admin panel's Test
// backend and a campaign turn can never disagree. Dependency-free.
//
// OpenAI's GPT-6 line reasons by default, and on /v1/chat/completions that
// cannot be combined with function tools (issue #129). The line splits:
// - gpt-6-sol and gpt-6-luna accept reasoning_effort "none", which makes
//   tools work on Chat Completions;
// - gpt-6.1-sol and gpt-6-astra do not accept "none" (their floor is "low"),
//   so their tools only work on /v1/responses.
// Everything else (gpt-4.1, gpt-5.x, the o-series) calls tools on Chat
// Completions as it always has.
// Source: https://developers.openai.com/api/docs/guides/latest-model

/** @typedef {"chat" | "chat-no-reasoning" | "responses"} OpenAiToolRoute */

const RESPONSES_ONLY = [/^gpt-6\.1-sol/, /^gpt-6-astra/];
const NEEDS_NO_REASONING = [/^gpt-6-sol/, /^gpt-6-luna/];

/**
 * The route a model's name calls for. Only meaningful for OpenAI's own host:
 * a proxy or a local server naming its model after one of these serves
 * whatever it serves, and learns its route from the first refusal instead.
 * @param {string} model
 * @returns {OpenAiToolRoute}
 */
export function openAiToolRoute(model) {
  const name = String(model ?? "").trim().toLowerCase();
  // A fine-tune is named ft:<base model>:<org>:<suffix>:<id>.
  const base = name.startsWith("ft:") ? (name.split(":")[1] ?? "") : name;
  if (RESPONSES_ONLY.some((pattern) => pattern.test(base))) return "responses";
  if (NEEDS_NO_REASONING.some((pattern) => pattern.test(base))) return "chat-no-reasoning";
  return "chat";
}

/**
 * The route a 400 body asks for, or null when it asks for nothing of the
 * kind. OpenAI spells it out: "Function tools with reasoning_effort are not
 * supported for gpt-6.1-sol in /v1/chat/completions. To use function tools,
 * use /v1/responses or set reasoning_effort to 'none'." Responses wins when
 * both are offered: it carries tools with reasoning left on for every model,
 * where "none" is refused by the models that need Responses anyway.
 * @param {string} body
 * @returns {OpenAiToolRoute | null}
 */
export function toolRouteFromError(body) {
  const text = String(body ?? "").slice(0, 4000);
  if (!text) return null;
  if (/\/v1\/responses|responses api/i.test(text)) return "responses";
  if (/reasoning_effort\s+to\s+['"]none['"]/i.test(text)) return "chat-no-reasoning";
  return null;
}
