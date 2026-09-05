"use client";

import type { ReactNode } from "react";
import { GENRE_PRESETS } from "@/lib/genres";
import { DM_MODE_LABELS } from "@/lib/schemas/game-settings";
import type { WorldPackSummary } from "@/lib/worlds/types";
import { featuresOn } from "@/app/create-campaign/FeelStep";
import type { StepProps } from "@/app/create-campaign/draft";

// Step 6: the choices that shape the table, read back before the row is
// made. The warnings that block creation live here too, next to the button
// that they block.
export function ReviewStep({
  draft,
  gates,
  selectedPack,
  error,
}: StepProps & {
  selectedPack: WorldPackSummary | null;
  error: string;
}) {
  const { solo, storyKnownMissing } = gates;
  const genreName = GENRE_PRESETS.find((preset) => preset.id === draft.genre)?.name ?? draft.genre;
  const setting = selectedPack ? `${selectedPack.name} (${genreName})` : genreName;
  const party = solo
    ? `Solo · level ${draft.startingLevel}`
    : `${draft.maxPlayers} players · level ${draft.startingLevel}`;
  const dice = draft.dicePolicy === "digital_only" ? "Digital only" : "Real dice allowed";
  const difficulty = draft.difficulty.charAt(0).toUpperCase() + draft.difficulty.slice(1);

  return (
    <div className="space-y-4 text-sm">
      <dl className="divide-y divide-stone-800/80 rounded-lg border border-stone-800 bg-stone-950/40">
        <Row label="Runs the game">{DM_MODE_LABELS[draft.dmMode]}</Row>
        <Row label="Setting">{setting}</Row>
        <Row label="Party">{party}</Row>
        <Row label="Difficulty">{difficulty}</Row>
        <Row label="Dice">{dice}</Row>
        <Row label="Table features">{featuresOn(draft, gates)} on</Row>
      </dl>
      <p className="text-stone-400">
        {solo
          ? "You'll drop into the lobby next to ready up."
          : "You'll drop into the lobby next to share an invite code and ready up."}
      </p>
      {solo && storyKnownMissing ? (
        <p className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-amber-200">
          A solo adventure needs the AI storyteller, and this server does not have one. Ask the
          server owner to set up an AI backend first.
        </p>
      ) : null}
      {error ? <p className="text-red-400">{error}</p> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-stone-500">{label}</dt>
      <dd className="min-w-0 truncate text-right text-stone-200">{children}</dd>
    </div>
  );
}
