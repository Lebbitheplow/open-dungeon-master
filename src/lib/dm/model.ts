import {
  customBackendIsPaid,
  requestCustomMessage,
  requestLocalMessage,
  type ChatMessage,
  type ChatRequestOptions,
  type UpstreamResult,
} from "@/lib/model-client";
import { requestHarnessMessage } from "@/lib/harness/bridge";
import { paidAiAllowedNow, paidAiRefusalResponse } from "@/lib/shared-host";
import { recordUsage } from "@/lib/usage/ledger";
import type { StorySettings } from "@/lib/types";

// Every DM-side model call passes through here, which makes it the one
// place for two pieces of shared-host bookkeeping (src/lib/shared-host.ts):
// the usage ledger, written from what the backend reported, and the paid
// AI policy, which refuses a keyed backend for a table that may not spend
// the host's key before the request goes out.
async function metered(
  role: "story" | "utility",
  call: () => Promise<UpstreamResult>,
): Promise<UpstreamResult> {
  const started = Date.now();
  const result = await call();
  if (result.usage) {
    recordUsage({
      kind: result.usage.backend === "harness" ? "agent" : "text",
      role,
      backend: result.usage.backend,
      model: result.usage.model,
      paid: result.usage.paid,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: Date.now() - started,
    });
  }
  return result;
}

function paidAndRefused(baseUrl: string, apiKey: string): boolean {
  return customBackendIsPaid(baseUrl, apiKey) && !paidAiAllowedNow();
}

// Routes a DM-side model call through the campaign's configured provider.
export function requestDmMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: ChatRequestOptions,
): Promise<UpstreamResult> {
  if (settings.textProvider === "harness") {
    // The agent policy (src/lib/harness/policy.ts) answers for the agent
    // program, inside the bridge.
    return metered("story", () =>
      requestHarnessMessage(messages, options, {
        role: "story",
        campaignId: options.harness?.campaignId,
        catalogue: options.harness?.catalogue,
        turn: options.harness?.turn,
      }),
    );
  }
  if (settings.textProvider === "local") {
    return metered("story", () => requestLocalMessage(settings.localTextModel, messages, options));
  }
  if (paidAndRefused(settings.customBaseUrl, settings.customApiKey)) {
    return Promise.resolve({ error: paidAiRefusalResponse("story") });
  }
  return metered("story", () =>
    requestCustomMessage(
      settings.customBaseUrl,
      settings.customModel,
      settings.customApiKey,
      messages,
      options,
    ),
  );
}

// Mechanical, non-narration work: history compaction, chapter summaries and
// fact extraction, world-arc ticks, lore checks, Ask answers. None of it is
// read as prose, so it runs happily on a small model while the story model
// keeps its weights and prompt cache resident.
//
// Entirely optional. With no utilityModel configured this IS requestDmMessage,
// and a configured-but-unreachable utility model falls back to the story model
// rather than failing the job: a wrong model name in settings must never cost
// a table its chapter summary.
export async function requestUtilityMessage(
  settings: StorySettings,
  messages: ChatMessage[],
  options: ChatRequestOptions,
): Promise<UpstreamResult> {
  const model = (settings.utilityModel ?? "").trim();
  // The server's agent program has its own utility model (chosen beside its
  // story model in the admin panel), so a harness table does its bookkeeping
  // there unless the campaign named a separate local or custom one.
  if (
    settings.utilityProvider === "harness" ||
    (settings.textProvider === "harness" && !model)
  ) {
    return metered("utility", () => requestHarnessMessage(messages, options, { role: "utility" }));
  }
  if (!model) {
    return requestDmMessage(settings, messages, options);
  }

  const result =
    settings.utilityProvider === "local"
      ? await metered("utility", () => requestLocalMessage(model, messages, options))
      : paidAndRefused(settings.utilityBaseUrl, settings.utilityApiKey)
        ? { error: paidAiRefusalResponse("utility") }
        : await metered("utility", () =>
            requestCustomMessage(
              settings.utilityBaseUrl,
              model,
              settings.utilityApiKey,
              messages,
              options,
            ),
          );
  if (!result.error) {
    return result;
  }
  console.error(`[model] utility model "${model}" failed; retrying on the story model`, result.error);
  return requestDmMessage(settings, messages, options);
}
