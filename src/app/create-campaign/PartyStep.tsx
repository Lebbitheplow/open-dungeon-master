"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { cn } from "@/lib/cn";
import {
  CAMPAIGN_DIFFICULTIES,
  CAMPAIGN_DIFFICULTY_HINTS,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  type CampaignLengthSetting,
} from "@/lib/schemas/game-settings-options";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const DIFFICULTY_INFO = `Difficulty is guidance to the Dungeon Master, not a damage multiplier: every rule underneath stays 5e. It steers how hard encounters are built and how often a bad roll is allowed to really cost you.\n\n${CAMPAIGN_DIFFICULTIES.map(
  (value) => `**${value}**: ${CAMPAIGN_DIFFICULTY_HINTS[value]}`,
).join("\n\n")}\n\nThe party lead can change it later from the table's settings.`;

const LENGTH_INFO =
  "How far ahead the DM plans the secret story: how many acts the arc spans, and how many villains and threads it seeds at the start.\n\n**Short**: three acts, one focused adventure. A handful of sessions.\n\n**Standard**: four or five acts. The default shape of a campaign.\n\n**Epic**: six to eight acts, several threads running at once.\n\nNo length ever cuts you off. Play past the finale and a sequel saga picks up where the last one ended.";

// Step 3: how many, how strong, how hard, how long, and whose dice. A solo
// table has no player count (maxPlayers is pinned to 1 in the payload), and
// only an AI narrator plans a story arc, so length hides with it.
export function PartyStep({ draft, patch, gates }: StepProps) {
  const { solo, aiNarrates } = gates;
  return (
    <div className="space-y-4 text-sm">
      <div className={cn("grid gap-3", solo ? "grid-cols-2" : "grid-cols-3")}>
        {!solo ? (
          <label className="block">
            <FieldLabel>Players</FieldLabel>
            <input
              type="number"
              min={1}
              max={8}
              value={draft.maxPlayers}
              onChange={(event) => patch({ maxPlayers: Number(event.target.value) })}
              className={inputClass}
            />
          </label>
        ) : null}
        <label className="block">
          <FieldLabel>Start level</FieldLabel>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.startingLevel}
            onChange={(event) => patch({ startingLevel: Number(event.target.value) })}
            className={inputClass}
          />
        </label>
        <label className="block">
          <FieldLabel>
            <span className="flex items-center gap-1">
              Difficulty
              <InfoButton label="Difficulty" text={DIFFICULTY_INFO} />
            </span>
          </FieldLabel>
          <select
            value={draft.difficulty}
            onChange={(event) =>
              patch({ difficulty: event.target.value as CampaignDifficulty })
            }
            className={inputClass}
          >
            {CAMPAIGN_DIFFICULTIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          {/* The chosen tier says what it means without opening anything. */}
          <p className="mt-1 text-xs text-stone-500">
            {CAMPAIGN_DIFFICULTY_HINTS[draft.difficulty]}
          </p>
        </label>
      </div>

      {aiNarrates ? (
        <label className="block">
          <FieldLabel>
            <span className="flex items-center gap-1">
              Campaign length
              <InfoButton label="Campaign length" text={LENGTH_INFO} />
            </span>
          </FieldLabel>
          <select
            value={draft.campaignLength}
            onChange={(event) =>
              patch({ campaignLength: event.target.value as CampaignLengthSetting })
            }
            className={inputClass}
          >
            {CAMPAIGN_LENGTHS.map((value) => (
              <option key={value} value={value}>
                {CAMPAIGN_LENGTH_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            How far the DM plans the story ahead. Any length keeps going if you play past the
            finale: a sequel saga picks up where the last one ended.
          </p>
        </label>
      ) : null}

      <div>
        <FieldLabel className="mb-1.5">Dice</FieldLabel>
        <div className="flex gap-2">
          <ToggleCard
            active={draft.dicePolicy === "digital_only"}
            onClick={() => patch({ dicePolicy: "digital_only" })}
            label="Digital only"
            hint="The server rolls everything"
          />
          <ToggleCard
            active={draft.dicePolicy === "real_allowed"}
            onClick={() => patch({ dicePolicy: "real_allowed" })}
            label="Real dice allowed"
            hint={
              solo
                ? "Roll at your desk and enter the numbers"
                : "Players may opt in to rolling at the table"
            }
          />
        </div>
      </div>
    </div>
  );
}
