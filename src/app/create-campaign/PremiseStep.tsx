"use client";

import { useMemo } from "react";
import OptionPicker, { type PickerGroup } from "@/app/characters/builder/OptionPicker";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { DM_MODE_HINTS, DM_MODE_LABELS, DM_MODES } from "@/lib/schemas/game-settings-options";
import type { FranchiseGroup, WorldPackSummary } from "@/lib/worlds/types";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

const NO_PACK_INFO =
  "A pre-built world is a coat of paint over the same 5e rules. It renames the races, classes, spells and monsters to fit its setting, tells the Dungeon Master how the place sounds, and floats the peoples and callings that belong there to the top of every picker in the character builder. Nothing is locked: you can still play a wizard in a world that calls them something else.\n\nWithout one you get the plain setting your genre implies, with the whole catalog offered in its own words.";

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
  // Every pack, each with its own blurb behind a ⓘ, so a world can be read
  // before it is chosen instead of after. A franchise with several eras keeps
  // them grouped under its name, exactly as the old <optgroup> did.
  const packGroups = useMemo<PickerGroup[]>(
    () => [
      {
        label: null,
        options: [
          { id: "", name: "No pack (plain setting)", infoText: NO_PACK_INFO },
        ],
      },
      ...franchises.map((group) => ({
        label: group.editions.length === 1 ? null : group.franchise,
        options: group.editions.map((edition) => ({
          id: edition.id,
          name: group.editions.length === 1 ? edition.name : edition.edition || edition.name,
          infoText: edition.blurb,
        })),
      })),
    ],
    [franchises],
  );
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
          <OptionPicker
            value={draft.worldPack}
            groups={packGroups}
            placeholder="No pack (plain setting)"
            className={inputClass}
            onChange={(id) => {
              const next = packs.find((pack) => pack.id === id);
              if (next) {
                onChoosePack(next);
              } else {
                onClearPack();
              }
            }}
          />
          {selectedPack ? (
            <>
              {selectedPack.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={selectedPack.cover}
                  alt=""
                  className="mt-2 aspect-video w-full max-w-sm rounded-lg border border-stone-800 object-cover"
                />
              ) : null}
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
