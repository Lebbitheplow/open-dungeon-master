"use client";

import type { CSSProperties, ReactNode } from "react";
import { CampaignCover } from "@/components/CampaignCover";
import { cn } from "@/lib/cn";
import { CAMPAIGN_DIFFICULTY_HINTS } from "@/lib/campaign-types";
import { genrePreset } from "@/lib/genres";
import { DM_MODE_LABELS } from "@/lib/schemas/game-settings-options";
import type { WorldPackSummary } from "@/lib/worlds/types";
import type { StepProps } from "@/app/create-campaign/draft";
import { coverSheet } from "@/app/create-campaign/cover-sheet";
import { featuresOn } from "@/app/create-campaign/table-sheet";

// Step 6: the cover the campaign will wear, assembled from the choices behind
// it, then the six read-back rows. The cover is CampaignCover with no art, the
// same tile the home screen draws until somebody paints one from the lobby.
// The warnings that block creation live here too, next to the button that
// they block.
export function ReviewStep({
  draft,
  gates,
  active,
  selectedPack,
  error,
}: StepProps & {
  // True while this is the step on screen; the cover assembles on arrival.
  active: boolean;
  selectedPack: WorldPackSummary | null;
  error: string;
}) {
  const { solo, storyKnownMissing } = gates;
  const preset = genrePreset(draft.genre);
  const sheet = coverSheet(draft, gates, selectedPack?.name ?? null);

  return (
    <div className={cn("space-y-4 text-sm", active && "cc-live")}>
      <div className="cc-review">
        <div className="cc-cover">
          <div className="cc-cover-art rounded-xl">
            <CampaignCover cover={null} title={sheet.title} genre={draft.genre} />
            <span className="cc-cover-caption">
              <span className="cc-cover-genre">{preset.name}</span>
              <span className="cc-cover-title">{sheet.title}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1 px-1 pb-1 pt-2.5">
            <span className="cc-prose text-[12.5px] leading-snug text-stone-300">{sheet.theme}</span>
            <span className="cc-note">{sheet.meta}</span>
          </div>
          <span className="cc-stamp" aria-hidden="true">
            <span className="cc-stamp-top">{sheet.difficulty}</span>
            <span className="cc-stamp-sub">{sheet.stampSub}</span>
          </span>
        </div>

        <div className="flex min-w-0 flex-[1_1_18rem] flex-col gap-2.5">
          <dl className="cc-readback">
            <Row label="Runs the game" index={0} gold>
              {DM_MODE_LABELS[draft.dmMode]}
            </Row>
            <Row label="Setting" index={1}>
              {sheet.setting}
            </Row>
            <Row label="Party" index={2}>
              {sheet.party}
            </Row>
            <Row label="Difficulty" index={3}>
              {sheet.difficulty}
            </Row>
            <Row label="Dice" index={4}>
              {sheet.dice}
            </Row>
            <Row label="Table features" index={5} gold>
              {featuresOn(draft, gates)} on
            </Row>
          </dl>
          <p className="text-stone-400">
            {solo
              ? "You'll drop into the lobby next to ready up."
              : "You'll drop into the lobby next to share an invite code and ready up."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[CAMPAIGN_DIFFICULTY_HINTS[draft.difficulty], ...sheet.chips].map((chip, index) => (
              <span
                key={chip}
                className="cc-review-chip"
                style={{ "--cc-delay": `${420 + index * 60}ms` } as CSSProperties}
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
      </div>

      {solo && storyKnownMissing ? (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-amber-200">
          A solo adventure needs the AI storyteller, and this server does not have one. Ask the
          server owner to set up an AI backend first.
        </p>
      ) : null}
      {error ? <p className="motion-shake text-red-400">{error}</p> : null}
    </div>
  );
}

// The rows cascade in at 70 ms steps once the step is on screen.
function Row({
  label,
  index,
  gold = false,
  children,
}: {
  label: string;
  index: number;
  gold?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="cc-readback-row" style={{ "--cc-delay": `${index * 70}ms` } as CSSProperties}>
      <dt>{label}</dt>
      <dd data-ink={gold ? "gold" : undefined}>{children}</dd>
    </div>
  );
}
