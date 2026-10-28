"use client";

import { InfoButton } from "@/components/ui/InfoDialog";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import {
  REROLL_LOW_DEFAULT,
  describeReroll,
  rerollBelowFor,
  rerollChoiceOf,
  type RerollChoice,
} from "@/lib/srd/ability-rerolls";
import { useServerRerollBelow } from "@/app/characters/builder/useTableRules";
import {
  CAMPAIGN_DIFFICULTIES,
  CAMPAIGN_DIFFICULTY_HINTS,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import {
  CAMPAIGN_LENGTH_LABELS,
  CAMPAIGN_LENGTHS,
  HP_METHOD_LABELS,
  HP_METHODS,
  STARTING_WEALTH,
  STARTING_WEALTH_LABELS,
  type CampaignLengthSetting,
  type HpMethodSetting,
  type StartingWealthSetting,
} from "@/lib/schemas/game-settings-options";
import { FieldLabel, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const DIFFICULTY_INFO = `Difficulty is guidance to the Game Master, not a damage multiplier: every rule underneath stays 5e. It steers how hard encounters are built and how often a bad roll is allowed to really cost you.\n\n${CAMPAIGN_DIFFICULTIES.map(
  (value) => `**${value}**: ${CAMPAIGN_DIFFICULTY_HINTS[value]}`,
).join("\n\n")}\n\nThe party lead can change it later from the table's settings.`;

const LENGTH_INFO =
  "How far ahead the GM plans the secret story: how many acts the arc spans, and how many villains and threads it seeds at the start.\n\n**Short**: three acts, one focused adventure. A handful of sessions.\n\n**Standard**: four or five acts. The default shape of a campaign.\n\n**Epic**: six to eight acts, several threads running at once.\n\nNo length ever cuts you off. Play past the finale and a sequel saga picks up where the last one ended.";

// How many, how strong, how hard. A solo table has no player count
// (maxPlayers is pinned to 1 in the payload, from the solo entry point, never
// from the count chosen here).
export function PartyBasics({ draft, patch, gates }: StepProps) {
  const { solo } = gates;
  return (
    <div className={cn("grid gap-3", solo ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
      {!solo ? (
        <div className="block">
          <FieldLabel>Players</FieldLabel>
          <NumberStepper min={1} max={8} value={draft.maxPlayers} onChange={(maxPlayers) => patch({ maxPlayers })} label="Players" />
        </div>
      ) : null}
      <div className="block">
        <FieldLabel>Start level</FieldLabel>
        <NumberStepper min={1} max={20} value={draft.startingLevel} onChange={(startingLevel) => patch({ startingLevel })} label="Start level" />
      </div>
      <label className={cn("block", !solo && "col-span-2 sm:col-span-1")}>
        <FieldLabel>
          <span className="flex items-center gap-1">
            Difficulty
            <InfoButton label="Difficulty" text={DIFFICULTY_INFO} />
          </span>
        </FieldLabel>
        <Select<CampaignDifficulty>
          value={draft.difficulty}
          onChange={(difficulty) => patch({ difficulty })}
          label="Difficulty"
          className="w-full"
          options={CAMPAIGN_DIFFICULTIES.map((value) => ({ value, label: value }))}
        />
        {/* The chosen tier says what it means without opening anything. */}
        <p className="mt-1 text-xs text-stone-500">{CAMPAIGN_DIFFICULTY_HINTS[draft.difficulty]}</p>
      </label>
    </div>
  );
}

// How heroes are built here. Asked at creation because the first characters
// are built before anyone opens the lobby's settings.
export function CharacterRulesFields({ draft, patch, gates }: StepProps) {
  // Named in the "follow the server" choice, so it says what it means.
  const serverRerollBelow = useServerRerollBelow();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <FieldLabel>Hit points per level</FieldLabel>
          <Select<HpMethodSetting>
            value={draft.hpMethod}
            onChange={(hpMethod) => patch({ hpMethod })}
            label="Hit points per level"
            className="w-full"
            options={HP_METHODS.map((value) => ({ value, label: HP_METHOD_LABELS[value] }))}
          />
          <p className="mt-1 text-xs text-stone-500">1st level is always the hit die&apos;s highest face plus Constitution.</p>
        </label>
        <label className="block">
          <FieldLabel>Starting wealth</FieldLabel>
          <Select<StartingWealthSetting>
            value={draft.startingWealth}
            onChange={(startingWealth) => patch({ startingWealth })}
            label="Starting wealth"
            className="w-full"
            options={STARTING_WEALTH.map((value) => ({ value, label: STARTING_WEALTH_LABELS[value] }))}
          />
          <p className="mt-1 text-xs text-stone-500">What a new hero starts with; rolled gold is thrown by the server.</p>
        </label>
        <label className="block sm:col-span-2">
          <FieldLabel>Rolled stats</FieldLabel>
          <Select<"server" | RerollChoice>
            value={draft.abilityRerollBelow === null ? "server" : rerollChoiceOf(draft.abilityRerollBelow)}
            onChange={(choice) =>
              patch({
                abilityRerollBelow:
                  choice === "server" ? null : rerollBelowFor(choice, draft.abilityRerollBelow ?? REROLL_LOW_DEFAULT),
              })
            }
            label="Rolled stats"
            className="w-full"
            options={[
              { value: "server", label: `Follow the server's reroll rule${serverRerollBelow === null ? "" : ` (${describeReroll(serverRerollBelow).toLowerCase()})`}` },
              { value: "keep", label: "The first roll stands" },
              { value: "low", label: `Reroll a roll totalling under ${REROLL_LOW_DEFAULT}` },
              { value: "free", label: "Reroll as often as you like" },
            ]}
          />
          <p className="mt-1 text-xs text-stone-500">
            For 4d6 ability scores rolled here: whether a player may throw the six again. The server rolls them either
            way. Following the server, a player&apos;s six here are the ones from their library; a rule of the
            table&apos;s own gives each player a separate six here.
          </p>
        </label>
      </div>
      <DicePolicyField draft={draft} patch={patch} gates={gates} />
    </div>
  );
}

export function DicePolicyField({ draft, patch, gates }: StepProps) {
  return (
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
          hint={gates.solo ? "Roll at your desk and enter the numbers" : "Players may opt in to rolling at the table"}
        />
      </div>
    </div>
  );
}

// Only an AI narrator plans a story arc, so only then is its length asked.
export function CampaignLengthField({ draft, patch, gates }: StepProps) {
  if (!gates.aiNarrates) {
    return null;
  }
  return (
    <label className="block">
      <FieldLabel>
        <span className="flex items-center gap-1">
          Campaign length
          <InfoButton label="Campaign length" text={LENGTH_INFO} />
        </span>
      </FieldLabel>
      <Select<CampaignLengthSetting>
        value={draft.campaignLength}
        onChange={(campaignLength) => patch({ campaignLength })}
        label="Campaign length"
        className="w-full"
        options={CAMPAIGN_LENGTHS.map((value) => ({ value, label: CAMPAIGN_LENGTH_LABELS[value] }))}
      />
      <p className="mt-1 text-xs text-stone-500">
        How far the GM plans the story ahead. Any length keeps going if you play past the finale: a sequel saga
        picks up where the last one ended.
      </p>
    </label>
  );
}
