"use client";

import { Dices } from "lucide-react";
import { useId, useMemo, type Ref } from "react";
import OptionPicker, { type PickerGroup } from "@/app/characters/builder/OptionPicker";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { DM_MODE_HINTS, DM_MODE_LABELS, DM_MODES } from "@/lib/schemas/game-settings-options";
import type { FranchiseGroup, WorldPackSummary } from "@/lib/worlds/types";
import { FieldLabel, inputClass, ToggleCard } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";
import { rollCampaignTitle } from "@/app/create-campaign/titles";

const NO_PACK_INFO =
  "A pre-built world is a coat of paint over the same 5e rules. It renames the races, classes, spells and monsters to fit its setting, tells the Game Master how the place sounds, and floats the peoples and callings that belong there to the top of every picker in the character builder. Nothing is locked: you can still play a wizard in a world that calls them something else.\n\nWithout one you get the plain setting your genre implies, with the whole catalog offered in its own words.";

// The campaign's name. The essentials step will not go on without one, and
// its held Continue brings the cursor back here.
// The dice roll a title in the genre's own words for someone who would
// rather name the campaign once they know what it is; it stays editable.
export function TitleField({ draft, patch, inputRef }: Pick<StepProps, "draft" | "patch"> & { inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div>
      <label htmlFor="cc-title" className="block">
        <FieldLabel>Title</FieldLabel>
      </label>
      <span className="flex items-center gap-2">
        <input
          id="cc-title"
          ref={inputRef}
          value={draft.title}
          onChange={(event) => patch({ title: event.target.value })}
          required
          maxLength={80}
          placeholder="Curse of the Ash Kingdom"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => patch({ title: rollCampaignTitle(draft.genre, draft.title) })}
          title="Roll a title (you can change it any time)"
          aria-label="Roll a title"
          className="motion-press flex size-11 shrink-0 items-center justify-center rounded-lg border border-stone-700 text-amber-200 transition-colors hover:border-amber-500/50 hover:bg-amber-500/10"
        >
          <Dices className="size-5" aria-hidden="true" />
        </button>
      </span>
      {!draft.title.trim() ? (
        <span className="mt-1 block text-[11px] text-stone-500">Not sure yet? Roll one and rename it later.</span>
      ) : null}
    </div>
  );
}

// Each way to run a table, said from the seat the person creating it takes.
const DM_MODE_ROLES: Record<(typeof DM_MODES)[number], string> = {
  ai: "You play a hero. The AI is the Game Master.",
  steered: "You direct the AI narrator, without a hero of your own.",
  human: "You are the Game Master.",
  assisted: "You are the Game Master, and the AI helps.",
};

// Who holds the DM seat. A server that positively has no AI storyteller
// offers only the human seat; one whose storyteller is not answering keeps
// every seat and says so.
export function DmModeField({ draft, patch, gates }: StepProps) {
  const { storyKnownMissing, storyUnreachable, aiNarrates } = gates;
  return (
    <div>
      <FieldLabel className="mb-1.5">Who runs this table?</FieldLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DM_MODES.filter(
          // "assisted" leans on the same missing backend, so it goes too.
          (mode) => mode === "human" || !storyKnownMissing,
        ).map((mode) => (
          <ToggleCard
            key={mode}
            active={draft.dmMode === mode}
            onClick={() => patch({ dmMode: mode })}
            label={DM_MODE_LABELS[mode]}
            hint={
              <>
                <span className="block text-amber-200/90">{DM_MODE_ROLES[mode]}</span>
                {DM_MODE_HINTS[mode]}
              </>
            }
          />
        ))}
      </div>
      {storyKnownMissing ? (
        <p className="mt-1.5 text-xs text-stone-500">This server has no AI storyteller, so a human runs the table.</p>
      ) : null}
      {storyUnreachable && aiNarrates ? (
        <p className="mt-1.5 text-xs text-amber-300">
          The AI backend is not answering right now. You can still create this campaign, but AI turns will fail
          until it is back.
        </p>
      ) : null}
      {draft.dmMode === "steered" ? (
        <p className="mt-1.5 text-xs text-stone-500">
          You take the steering seat: no character and no party slot. You see the arc, the sheets, the stat blocks
          and the whole map, direct the AI between turns and settle a disputed ruling; the AI narrates every turn,
          and the party lead is a player like any other.
        </p>
      ) : draft.dmMode !== "ai" ? (
        <p className="mt-1.5 text-xs text-stone-500">
          You take the Game Master seat: no character, no party slot, and you see the sheets, the stat blocks
          and the whole map. The server still rolls every die and holds every number.
        </p>
      ) : null}
    </div>
  );
}

// An optional pre-built world. Every pack carries its own blurb behind a ⓘ,
// so a world can be read before it is chosen; a franchise with several eras
// keeps them grouped under its name. Hidden outright when the server has no
// pack installed.
export function WorldPackField({
  draft,
  packs,
  franchises,
  selectedPack,
  onChoosePack,
  onClearPack,
}: Pick<StepProps, "draft"> & {
  packs: WorldPackSummary[];
  franchises: FranchiseGroup[];
  selectedPack: WorldPackSummary | null;
  onChoosePack: (pack: WorldPackSummary) => void;
  onClearPack: () => void;
}) {
  const captionId = useId();
  const packGroups = useMemo<PickerGroup[]>(
    () => [
      { label: null, options: [{ id: "", name: "No pack (plain setting)", infoText: NO_PACK_INFO }] },
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
  if (!franchises.length) {
    return null;
  }
  return (
    <div>
      <FieldLabel>
        <span id={captionId}>Pre-built world (optional)</span>
      </FieldLabel>
      <OptionPicker
        labelledBy={captionId}
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
          A pre-built world renames the races, classes, spells and monsters to fit it, and tells the GM how it
          sounds. Every rule stays 5e.
        </p>
      )}
    </div>
  );
}
