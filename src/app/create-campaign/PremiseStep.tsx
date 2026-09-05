"use client";

import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { DM_MODE_HINTS, DM_MODE_LABELS, DM_MODES } from "@/lib/schemas/game-settings";
import type { FranchiseGroup, WorldPackSummary } from "@/lib/worlds/types";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

// Step 1: the name, who holds the DM seat, and an optional pre-built world.
// The pack select is hidden outright when the server has none installed.
export function PremiseStep({
  draft,
  patch,
  gates,
  packs,
  franchises,
  selectedPack,
  onChoosePack,
  onClearPack,
}: StepProps & {
  packs: WorldPackSummary[];
  franchises: FranchiseGroup[];
  selectedPack: WorldPackSummary | null;
  onChoosePack: (pack: WorldPackSummary) => void;
  onClearPack: () => void;
}) {
  const { storyKnownMissing, storyUnreachable, aiNarrates } = gates;
  return (
    <div className="space-y-4 text-sm">
      <label className="block">
        <FieldLabel>Title</FieldLabel>
        <input
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          required
          maxLength={80}
          placeholder="Curse of the Ash Kingdom"
          className={inputClass}
        />
      </label>

      <div>
        <FieldLabel className="mb-1.5">Who runs this table?</FieldLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {DM_MODES.filter(
            // A server that positively has no AI DM (provider "none")
            // offers only the human seat; "assisted" leans on the same
            // missing backend, so it goes too.
            (mode) => mode === "human" || !storyKnownMissing,
          ).map((mode) => (
            <ToggleCard
              key={mode}
              active={draft.dmMode === mode}
              onClick={() => patch({ dmMode: mode })}
              label={DM_MODE_LABELS[mode]}
              hint={DM_MODE_HINTS[mode]}
            />
          ))}
        </div>
        {storyKnownMissing ? (
          <p className="mt-1.5 text-xs text-stone-500">
            This server has no AI storyteller, so a human runs the table.
          </p>
        ) : null}
        {storyUnreachable && aiNarrates ? (
          <p className="mt-1.5 text-xs text-amber-300">
            The AI backend is not answering right now. You can still create this campaign, but
            AI turns will fail until it is back.
          </p>
        ) : null}
        {draft.dmMode !== "ai" ? (
          <p className="mt-1.5 text-xs text-stone-500">
            You take the Dungeon Master seat: no character, no party slot, and you see the
            sheets, the stat blocks and the whole map. The server still rolls every die and holds
            every number.
          </p>
        ) : null}
      </div>

      {franchises.length ? (
        <div>
          <FieldLabel>Pre-built world (optional)</FieldLabel>
          <select
            value={draft.worldPack}
            onChange={(event) => {
              const next = packs.find((pack) => pack.id === event.target.value);
              if (next) {
                onChoosePack(next);
              } else {
                onClearPack();
              }
            }}
            className={inputClass}
          >
            <option value="">No pack (plain setting)</option>
            {franchises.map((group) =>
              // A franchise with one era is a single row. One with several
              // gets an optgroup, so the eras stay grouped under the name
              // without the list needing its own expand step.
              group.editions.length === 1 ? (
                <option key={group.franchise} value={group.editions[0].id}>
                  {group.editions[0].name}
                </option>
              ) : (
                <optgroup key={group.franchise} label={group.franchise}>
                  {group.editions.map((edition) => (
                    <option key={edition.id} value={edition.id}>
                      {edition.edition || edition.name}
                    </option>
                  ))}
                </optgroup>
              ),
            )}
          </select>
          {selectedPack ? (
            <>
              <p className="mt-1 text-xs text-stone-500">{selectedPack.blurb}</p>
              <UnofficialPackNotice
                rightsHolder={selectedPack.rightsHolder}
                inspiredBy={selectedPack.inspiredBy}
                className="mt-1.5"
              />
            </>
          ) : (
            <p className="mt-1 text-xs text-stone-500">
              A pre-built world renames the races, classes, spells and monsters to fit it, and
              tells the DM how it sounds. Every rule stays 5e.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
