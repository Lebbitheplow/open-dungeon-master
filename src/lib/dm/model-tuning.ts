import type { Campaign } from "@/lib/db/campaigns";
import { getGlobalConfig } from "@/lib/db/app-settings";
import { configuredMaxOutputTokens, storyContextTokens, storyModelParams } from "@/lib/model-client";
import { findCatalogModel } from "@/lib/model-registry/catalog-logic";
import { hostedCatalogModel, modelCatalog } from "@/lib/model-registry/catalog";
import { serverEnv } from "@/lib/server-env";
import { tuneForModel, type CatalogFacts, type ModelTuning } from "@/lib/dm/model-tuning-logic";

// The catalog's word on the model a table's story runs on, or null when
// there is none to go by: an agent program (it runs its own tools), a blank
// model name (the server picks its one model at call time) or a model the
// catalog has never heard of. A hosted provider's row is its own; weights
// served on this machine or the LAN match the catalog loosely by name, so
// their row speaks to what the model does (tools, reasoning) and not to the
// reply cap the local server sets for itself.
function storyCatalogFacts(settings: Campaign["settings"]): CatalogFacts | null {
  if (settings.textProvider === "harness") {
    return null;
  }
  if (settings.textProvider === "local") {
    const row = settings.localTextModel ? findCatalogModel(modelCatalog().providers, settings.localTextModel) : null;
    return row ? { outputTokens: 0, toolCall: row.toolCall, reasoning: row.reasoning } : null;
  }
  const model = (settings.customModel || getGlobalConfig().text.customModel || serverEnv("OPENAI_COMPAT_MODEL") || "").trim();
  if (!model) {
    return null;
  }
  const hosted = hostedCatalogModel(settings.customBaseUrl, model);
  if (hosted) {
    return { outputTokens: hosted.outputTokens, toolCall: hosted.toolCall, reasoning: hosted.reasoning };
  }
  const loose = findCatalogModel(modelCatalog().providers, model);
  return loose ? { outputTokens: 0, toolCall: loose.toolCall, reasoning: loose.reasoning } : null;
}

// What this table's turn changes for its model (src/lib/dm/model-tuning-logic.ts).
// An agent program keeps the environment's switches as before.
export function modelTuningFor(campaign: Campaign, fullToolTokens: number, leanToolTokens?: number): ModelTuning {
  const env = {
    leanTools: process.env.DM_LEAN_TOOLS,
    thinking: process.env.DM_THINKING,
    toolProfile: process.env.DM_TOOL_PROFILE,
    briefRules: process.env.DM_BRIEF_RULES,
  };
  // An agent program reads its whole catalogue once and keeps its own
  // context, so it is offered the full set (or the trimmed one when asked).
  if (campaign.settings.textProvider === "harness") {
    const lean = env.leanTools === "1";
    return { toolProfile: lean ? "lean" : "full", leanTools: lean, briefRules: false, thinking: env.thinking !== "0", outputCap: null, notes: [] };
  }
  return tuneForModel({
    windowTokens: storyContextTokens(campaign.settings),
    fullToolTokens,
    leanToolTokens,
    catalog: storyCatalogFacts(campaign.settings),
    configuredOutputTokens: configuredMaxOutputTokens(),
    parameters: storyModelParams(campaign.settings),
    env,
  });
}
