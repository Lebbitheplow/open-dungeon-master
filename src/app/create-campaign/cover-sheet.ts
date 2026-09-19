import { genrePreset } from "@/lib/genres";
import type { CampaignDraft, WizardGates } from "@/app/create-campaign/draft";

// The review step's pure half: every line on the cover and in the read-back,
// worked out from the draft. Nothing here is a constant standing in for a
// choice, which is what scripts/test-world-portals.mjs checks.

// An AI narrator plans the arc, so only then is its length a fact worth a
// stamp. The wording matches LENGTH_INFO on the party step.
const LENGTH_SHORT: Record<CampaignDraft["campaignLength"], string> = {
  short: "3 acts",
  standard: "4-5 acts",
  epic: "6-8 acts",
};

export type CoverSheet = {
  title: string;
  theme: string;
  meta: string;
  difficulty: string;
  stampSub: string;
  setting: string;
  party: string;
  dice: string;
  chips: string[];
};

export function coverSheet(
  draft: CampaignDraft,
  gates: Pick<WizardGates, "solo" | "aiNarrates">,
  packName: string | null,
): CoverSheet {
  const { solo, aiNarrates } = gates;
  const preset = genrePreset(draft.genre);
  const genreName = preset.name ?? draft.genre;
  const party = solo
    ? `Solo · level ${draft.startingLevel}`
    : `${draft.maxPlayers} players · level ${draft.startingLevel}`;
  const dice = draft.dicePolicy === "digital_only" ? "Digital only" : "Real dice allowed";
  const chips = [`${preset.climate} sky`];
  if (aiNarrates) {
    chips.push(`${draft.campaignLength} · ${LENGTH_SHORT[draft.campaignLength]}`);
  }
  return {
    // The wizard will not reach this step without a title; the fallback is
    // for the cover that is mounted, off screen, before one is typed.
    title: draft.title.trim() || (solo ? "Untitled adventure" : "Untitled campaign"),
    theme: draft.theme.trim() || "A world of your own description.",
    meta: `${party.toLowerCase()} · ${draft.dicePolicy === "digital_only" ? "digital dice" : "real dice allowed"}`,
    difficulty: draft.difficulty.charAt(0).toUpperCase() + draft.difficulty.slice(1),
    stampSub: aiNarrates ? LENGTH_SHORT[draft.campaignLength] : `level ${draft.startingLevel}`,
    setting: packName ? `${packName} (${genreName})` : genreName,
    party,
    dice,
    chips,
  };
}
