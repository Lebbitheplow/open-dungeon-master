import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import { getCurrentLocation } from "@/lib/db/locations";
import { populateSettlement } from "@/lib/dm/settlement";
import { SETTLEMENT_SIZES, SETTLEMENT_TERRAINS } from "@/lib/overworld/settlement";

// The generate_settlement tool (docs/vtt-parity-implementation-plan.md
// 12.1): when the party arrives somewhere the world has not written, the
// model asks for a place and the server writes one it can then narrate.

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const SETTLEMENT_TOOL_NAMES = ["generate_settlement"] as const;

export const settlementTools: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "generate_settlement",
      description:
        "Populate the party's current place when nothing is written for it: the server invents its people (added to the cast), its shops (stocked and priced), two rumours as a roll table and a hook only you can read. Call once on arrival somewhere new; then narrate from what comes back and GAME STATE.",
      parameters: {
        type: "object",
        properties: {
          size: { type: "string", enum: [...SETTLEMENT_SIZES] },
          terrain: { type: "string", enum: [...SETTLEMENT_TERRAINS] },
        },
      },
    },
  },
];

const schema = z.object({ size: z.string().optional(), terrain: z.string().optional() });

export function handleGenerateSettlement(campaign: Campaign, rawArguments: string): Record<string, unknown> {
  let args: z.infer<typeof schema>;
  try {
    args = schema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments: generate_settlement takes an optional size and terrain." };
  }
  const location = getCurrentLocation(campaign.id);
  if (!location) {
    return { error: "The party is nowhere yet; call move_party first." };
  }
  const outcome = populateSettlement(campaign, location, { size: args.size, terrain: args.terrain });
  if ("error" in outcome) {
    return outcome;
  }
  const { settlement } = outcome;
  return {
    ok: true,
    place: settlement.name,
    layout: settlement.layoutDescription,
    people: settlement.npcs.map((npc) => `${npc.name} (${npc.role}, ${npc.attitude}): ${npc.trait}`),
    shops: settlement.shops.map((shop) => `${shop.name} (${shop.kind}, kept by ${shop.keeper})`),
    rumours: settlement.rumours.map((entry) => entry.text),
    hook: `${settlement.hook.title}: ${settlement.hook.body}`,
  };
}
