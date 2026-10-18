// Processing speed: a provider's paid Fast tier, chosen by the admin per
// role (issue 255). Pure, so the admin panel and the request builders ask
// the same questions, and scripts/test-speed-tier.mjs pins them.
//
// What each connection supports, from the providers' own documentation
// (checked 2026-10-11):
//   - OpenAI's API: `service_tier: "fast"` (or "priority") on Responses and
//     Chat Completions, for the models OpenAI offers it on. Which ones is
//     not read from the name (a list kept here said gpt-4.1 had none; asked
//     on 2026-10-13, OpenAI ran it at "priority"). A refusal drops the field
//     and the call runs at standard speed (said so in the panel,
//     model-client.ts), and the reply's `service_tier` says what ran:
//     "priority" or "fast" when it did, "default" when it was downgraded.
//     About twice the standard price.
//   - Codex (ChatGPT sign-in): the app-server takes `serviceTier` on
//     thread/start for that thread alone, never touching the user's own
//     config.toml, and model/list says which models offer which tiers.
//     2x to 2.5x the usage.
//   - Claude Code: `--settings '{"fastMode":true}'` for that headless
//     session only (v2.1.205 and later), on the models its `initialize`
//     answer marks `supportsFastMode`; paid from usage credits. The Claude
//     API's own `speed: "fast"` is not a connection ODM has, so nothing
//     else here offers it.
//   - Any other OpenAI-compatible server, a local one, OpenRouter, opencode
//     and Grok: no Fast tier ODM can ask for, so none is sent.

export type Speed = "" | "fast";

export type SpeedEligibility = { ok: true } | { ok: false; reason: string };

// Whether a direct API connection may ask for Fast: OpenAI's own host and a
// named model. The admin's choice is for the server's own backend; a
// campaign's own key is never spent at a premium on it.
export function apiSpeedEligibility(input: { endpointKind: string; model: string }): SpeedEligibility {
  if (input.endpointKind !== "openai") {
    return { ok: false, reason: "Fast is offered on OpenAI's own API (api.openai.com). Other OpenAI-compatible servers, OpenRouter and local models have no Fast tier ODM can ask for." };
  }
  if (!input.model.trim()) {
    return { ok: false, reason: "Name the model first; Fast depends on it." };
  }
  return { ok: true };
}

// Whether the agent program may run its model at Fast. Codex and Claude Code
// both say per model (Codex's model/list service tiers, Claude Code's
// supportsFastMode), carried as `fast` on the probed model.
export function agentSpeedEligibility(input: {
  harnessId: string;
  model: string;
  models: ReadonlyArray<{ id: string; fast?: boolean }>;
}): SpeedEligibility {
  if (input.harnessId === "claude" || input.harnessId === "codex") {
    const program = input.harnessId === "claude" ? "Claude Code" : "Codex";
    if (!input.model.trim()) {
      return { ok: false, reason: `Pick the model first; ${program} offers Fast per model.` };
    }
    const listed = input.models.find((model) => model.id === input.model);
    return listed?.fast
      ? { ok: true }
      : { ok: false, reason: `${program} does not list a Fast tier for ${input.model} on this sign-in.` };
  }
  return { ok: false, reason: "This agent program has no Fast setting ODM can choose." };
}

// What a provider's reply says ran, in words: OpenAI answers "priority" for
// Fast on older models and "default" when it downgraded the call.
export function effectiveSpeedWord(tier: string | null | undefined): "fast" | "standard" | null {
  if (!tier) {
    return null;
  }
  const value = tier.trim().toLowerCase();
  if (value === "fast" || value === "priority") {
    return "fast";
  }
  return value ? "standard" : null;
}

// The cost note the admin reads before turning Fast on.
export const FAST_COST_NOTE =
  "Fast answers sooner for about twice the price per token (2x to 2.5x of a Codex or Claude plan's usage, paid from usage credits on Claude). It applies to every campaign this setting serves.";
