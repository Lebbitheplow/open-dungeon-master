"use client";

import { cn } from "@/lib/cn";
import { InfoButton } from "@/components/ui/InfoDialog";
import {
  BONDS_INFO,
  LIVING_WORLD_INFO,
  NARRATION_GUARD_INFO,
  ROMANCE_INFO,
} from "@/app/campaigns/[campaignId]/GameSettingsPanel";
import { ToggleCard } from "@/app/create-campaign/fields";
import { NarratorFields } from "@/app/create-campaign/NarratorFields";
import type { CampaignDraft, StepProps, WizardGates } from "@/app/create-campaign/draft";

// Which of the table features are switched on, counting only the ones the
// wizard actually showed: a hidden toggle is not a choice the table made.
// The review step reads this so its "n on" agrees with the grid.
export function featuresOn(draft: CampaignDraft, gates: WizardGates): number {
  const { aiNarrates, solo } = gates;
  const bonds = draft.relationships !== "off";
  return [
    aiNarrates && draft.aiStorySetup,
    draft.ttsEnabled,
    draft.mapsEnabled,
    draft.ambienceEnabled,
    draft.ambienceEnabled && draft.ambienceAuto,
    draft.multiclassingEnabled,
    aiNarrates && draft.worldSimulation,
    draft.inventoryApprovals,
    bonds,
    bonds && draft.romance !== "off",
    aiNarrates && draft.narrationGuard,
    !solo && draft.midGameJoinOpen,
    !solo && draft.holdSubmissions,
  ].filter(Boolean).length;
}

// Step 4: the toggle grid, then the AI allies and narrator voice. Voice
// narration and maps stay visible but disabled when the server lacks the
// backend, because they are one server switch away rather than a feature
// this install can never have; the AI-only rows hide when a human narrates.
export function FeelStep(props: StepProps) {
  const { draft, patch, gates } = props;
  const { aiNarrates, solo, ttsAvailable, mapsAvailable } = gates;
  const bonds = draft.relationships !== "off";
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {aiNarrates ? (
          <ToggleCard
            active={draft.aiStorySetup}
            onClick={() => patch({ aiStorySetup: !draft.aiStorySetup })}
            label="AI story setup"
            hint="The DM invents the plot"
          />
        ) : null}
        <ToggleCard
          active={draft.ttsEnabled}
          disabled={!ttsAvailable}
          onClick={() => patch({ ttsEnabled: !draft.ttsEnabled })}
          label="Voice narration"
          hint={ttsAvailable ? "Spoken DM narration" : "No speech service on this server"}
        />
        <ToggleCard
          active={draft.mapsEnabled}
          disabled={!mapsAvailable}
          onClick={() => patch({ mapsEnabled: !draft.mapsEnabled })}
          label="Maps"
          hint={mapsAvailable ? "AI-drawn area maps" : "No image service on this server"}
        />
        <ToggleCard
          active={draft.ambienceEnabled}
          onClick={() => patch({ ambienceEnabled: !draft.ambienceEnabled })}
          label="Ambience"
          hint="Room tone, music and stings"
        />
        {draft.ambienceEnabled ? (
          <ToggleCard
            active={draft.ambienceAuto}
            onClick={() => patch({ ambienceAuto: !draft.ambienceAuto })}
            label="Sound follows the scene"
            hint="Off leaves it to the DM"
          />
        ) : null}
        <ToggleCard
          active={draft.multiclassingEnabled}
          onClick={() => patch({ multiclassingEnabled: !draft.multiclassingEnabled })}
          label="Multiclassing"
          hint="Second classes at level-up"
        />
        {aiNarrates ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.worldSimulation}
              onClick={() => patch({ worldSimulation: !draft.worldSimulation })}
              label="Living world"
              hint="Off-screen schemes and rumors advance on their own"
            />
            <InfoButton
              label="What does Living World do?"
              text={LIVING_WORLD_INFO}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        <ToggleCard
          active={draft.inventoryApprovals}
          onClick={() => patch({ inventoryApprovals: !draft.inventoryApprovals })}
          label="Item offers"
          hint="Players confirm DM loot and gold changes"
        />
        <div className="relative flex">
          <ToggleCard
            active={bonds}
            onClick={() => patch({ relationships: bonds ? "off" : "on" })}
            label="Bonds"
            hint="NPCs remember how each character treated them"
          />
          <InfoButton label="What are Bonds?" text={BONDS_INFO} className="absolute right-1.5 top-1.5" />
        </div>
        {bonds ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.romance !== "off"}
              onClick={() => patch({ romance: draft.romance === "off" ? "on" : "off" })}
              label="Romance"
              hint="Bonds can grow into a relationship"
            />
            <InfoButton
              label="How does Romance work?"
              text={ROMANCE_INFO}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        {aiNarrates ? (
          <div className="relative flex">
            <ToggleCard
              active={draft.narrationGuard}
              onClick={() => patch({ narrationGuard: !draft.narrationGuard })}
              label="Outcome check"
              hint="Narration that contradicts the dice is rewritten"
            />
            <InfoButton
              label="What is the outcome check?"
              text={NARRATION_GUARD_INFO}
              className="absolute right-1.5 top-1.5"
            />
          </div>
        ) : null}
        {!solo ? (
          <ToggleCard
            active={draft.midGameJoinOpen}
            onClick={() => patch({ midGameJoinOpen: !draft.midGameJoinOpen })}
            label="Mid-game joining"
            hint="New players can use the invite code after the start"
          />
        ) : null}
        {!solo ? (
          <ToggleCard
            active={draft.holdSubmissions}
            onClick={() => patch({ holdSubmissions: !draft.holdSubmissions })}
            label="Held responses"
            hint="Nobody acts until the party lead opens the floor"
          />
        ) : null}
      </div>

      <NarratorFields {...props} className={cn(!aiNarrates && !draft.ttsEnabled && "hidden")} />
    </div>
  );
}
