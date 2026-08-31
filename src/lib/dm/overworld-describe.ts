import type { Campaign } from "@/lib/db/campaigns";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import {
  OVERWORLD_PARAM_LABELS,
  parseOverworldPlan,
  type OverworldPlan,
} from "@/lib/overworld/logic";

// Describing a region in words.
//
// The overworld is seeded value noise, so a sentence cannot become terrain
// directly: there is no place in the generator for "a chain of islands off a
// storm coast" to go. What a sentence CAN become is the five dials the
// classifier reads (src/lib/overworld/logic.ts) plus a list of names, and
// that is what this asks for. The DM then rerolls seeds against those dials
// until the coastline falls somewhere they like, which is the honest version
// of "describe your world" for a procedural map.

const SYSTEM = [
  "You turn a description of a fantasy region into generator settings for a tile map.",
  'Return STRICT JSON only, no code fences, shaped: {"params": {"seaLevel": number, "mountains": number, "forests": number, "aridity": number, "coastline": number}, "places": [{"name": string, "blurb": string}], "note": string}.',
  "Every parameter is 0 to 1, where 0.5 is ordinary. seaLevel raises the water. mountains raises the peaks. forests spreads woodland. aridity dries the land out, thinning forests and swamps. coastline pulls the shore further inland.",
  "places lists up to six settlements or landmarks the description implies, each with a blurb under 20 words. Invent nothing the description does not suggest; an empty list is a fine answer.",
  "note is one short clause naming the kind of region you built.",
].join(" ");

export type DescribeOutcome = { plan: OverworldPlan } | { error: string };

export async function describeOverworld(
  campaign: Campaign,
  description: string,
): Promise<DescribeOutcome> {
  const text = description.trim().slice(0, 1_000);
  if (!text) {
    return { error: "Describe the region first." };
  }
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Setting: ${campaign.theme || campaign.gameSettings.genre.replace(/_/g, " ")}`,
          `Region: ${text}`,
          `The dials, in order: ${Object.values(OVERWORLD_PARAM_LABELS).join(", ")}.`,
        ].join("\n"),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    return { error: "The model could not be reached." };
  }
  const plan = parseOverworldPlan(stripReasoningArtifacts(String(message?.content ?? "")));
  if (!plan) {
    return { error: "The model returned nothing usable." };
  }
  return { plan };
}
