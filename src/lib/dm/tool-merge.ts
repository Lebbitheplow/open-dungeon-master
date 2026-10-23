// One tool per intent (issue #471): the handler a call reaches, for every
// door a call comes in by (the AI's turn, the console and the agents'
// invoke route, the delegated AI). src/lib/dm/tool-merge-logic.ts holds the
// retired names and the pure routing; this adds the purchase, whose shop is
// the table's to know.
import type { Campaign } from "@/lib/db/campaigns";
import { tradeCall } from "@/lib/dm/shop-tools";
import { engineCall, mergedCall, type EngineCall, type ToolArgs } from "@/lib/dm/tool-merge-logic";
import type { ToolError } from "@/lib/dm/tool-errors";

// A call by any name, offered or retired, as the engine action that runs it
// and that action's arguments.
export function routeCall(campaign: Campaign, name: string, args: ToolArgs): EngineCall | ToolError {
  const merged = mergedCall(name, args);
  return merged.name === "purchase" ? tradeCall(campaign, merged.args) : engineCall(merged.name, merged.args);
}

// The same for a call whose arguments are still the JSON the caller sent. A
// call this does not change keeps its text as it came; arguments that are
// not a JSON object are left for the handler to refuse, as they always were.
export function routeToolCall(campaign: Campaign, name: string, rawArguments: string): { name: string; rawArguments: string } | { refusal: ToolError } {
  let args: unknown;
  try {
    args = JSON.parse(rawArguments || "{}");
  } catch {
    return { name, rawArguments };
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { name, rawArguments };
  }
  const routed = routeCall(campaign, name, args as ToolArgs);
  if ("error" in routed) {
    return { refusal: routed };
  }
  return routed.name === name && routed.args === args ? { name, rawArguments } : { name: routed.name, rawArguments: JSON.stringify(routed.args) };
}
