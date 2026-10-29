"use client";

import { Camera, Dices, UserRound } from "lucide-react";
import { useId } from "react";
import { AttractionPicker, CHARACTER_ATTRACTION_HINT } from "@/components/AttractionPicker";
import { InfoButton } from "@/components/ui/InfoDialog";
import { LengthNote } from "@/components/ui/LengthNote";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { GENDERS, type Gender } from "@/lib/gender";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { ui } from "@/lib/ui";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import type { WorldPack } from "@/lib/worlds/types";
import OptionPicker, { type PickerGroup } from "../OptionPicker";
import { rollHeroName } from "../heroNames";
import type { BuilderState } from "../useBuilderState";
import { Field, StepPanel, inputClass } from "./shared";

// The sheet schema's own limits on a backstory and on the hopes for the story
// (src/lib/schemas/sheet.ts HOPES_MAX, checked equal by
// scripts/test-story-hopes.mjs).
const BACKSTORY_MAX = 2000;
const HOPES_MAX = 500;

// The last step before the summary (backlog F4): who the hero is, once the
// player knows what they made. The name (its dice roll a name that fits the
// lineage already chosen), gender (the cards' art follows it), who they are
// drawn to (issue 501), alignment, the portrait and how they look, and
// their story. None of it changes a number on the sheet, so nothing before
// this step waits on it. How they play, the level and the background are
// asked on the steps before.
export function IdentityStep({
  state,
  pack,
  initial,
  paintsPortraits,
  onUploadPortrait,
  alignmentGroups,
  alignmentInfo,
}: {
  state: BuilderState;
  pack: WorldPack | null;
  initial?: CreateSheetInput;
  // Whether this server can paint a portrait at all. Without an image
  // backend the section offers the upload alone and stops promising a
  // painting that would never arrive.
  paintsPortraits: boolean;
  onUploadPortrait: () => void;
  alignmentGroups: PickerGroup[];
  alignmentInfo: string;
}) {
  const { portrait, setPortrait } = state;
  const appearanceId = useId();
  const alignmentId = useId();
  const backstoryId = useId();
  const hopesId = useId();
  // Asked only where the host keeps it: an older host drops the field (an
  // app's screens may be newer than the host they are opened on).
  const asksHopes = hostOffers(useCapabilities(), "storyHopes");
  const keptSaved = Boolean(initial?.portrait && portrait?.url === initial.portrait.url);

  return (
    <div className="space-y-4">
      <StepPanel title="Name your hero" ornate anchor="name">
        <span className="flex items-center gap-2">
          <input
            value={state.name}
            onChange={(event) => state.setName(event.target.value)}
            required
            maxLength={60}
            placeholder={pack?.nameHints || "Thornwick Ashvale"}
            className={inputClass}
            aria-label="Name"
          />
          {/* The name dice: a name that fits the lineage chosen, or the
              world's own people when the table has a pack. */}
          <button
            type="button"
            onClick={() =>
              state.setName(
                rollHeroName({ raceId: state.raceId, packNames: pack?.nameSeeds.people ?? [], current: state.name }),
              )
            }
            aria-label="Roll a name"
            title="Roll a name"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-stone-700 text-amber-200 transition-colors hover:border-amber-500/50 hover:bg-amber-500/10"
          >
            <Dices className="size-5" aria-hidden="true" />
          </button>
        </span>
        {pack?.nameSeeds.people.length ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {pack.nameSeeds.people.slice(0, 8).map((seed) => (
              <button
                key={seed}
                type="button"
                onClick={() => state.setName(seed)}
                className="rounded-md border border-stone-700/70 px-1.5 py-0.5 text-sm text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-100"
              >
                {seed}
              </button>
            ))}
          </span>
        ) : null}
      </StepPanel>

      <StepPanel title="Details">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Gender">
            <Select<Gender>
              value={state.gender}
              onChange={state.setGender}
              label="Gender"
              className="w-full"
              options={[{ value: "", label: "Unspecified" }, ...GENDERS.map((value) => ({ value, label: value }))]}
            />
          </Field>
          <AttractionPicker value={state.attraction} onChange={state.setAttraction} hint={CHARACTER_ATTRACTION_HINT} />
        </div>
      </StepPanel>

      <StepPanel
        title={
          <span className="inline-flex items-center gap-1">
            <span id={alignmentId}>Alignment</span>
            <InfoButton label="Alignment" text={alignmentInfo} />
          </span>
        }
        help="How they tend to act. It changes no number on the sheet."
      >
        <div className="sm:max-w-sm">
          <OptionPicker value={state.alignment} groups={alignmentGroups} labelledBy={alignmentId} className={inputClass} onChange={state.setAlignment} />
        </div>
      </StepPanel>

      <StepPanel title="Portrait (optional)" ornate>
        <div className="flex items-center gap-3">
          {portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait.url}
              // Named for the hero, as the roster names it.
              alt={state.name.trim() || "Your hero's portrait"}
              className="size-16 shrink-0 rounded-lg border border-amber-500/30 object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-stone-700/60 bg-stone-950 text-stone-600">
              <UserRound className="size-6" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* The upload is offered everywhere, whether or not a painter
                  exists: a photo is always a way to give a hero a face. */}
              <button type="button" onClick={onUploadPortrait} className={ui.btnSmall}>
                <Camera className="size-3.5" />
                {portrait ? "Replace photo" : "Upload a photo"}
              </button>
              {/* Clearing the saved portrait means "paint me a new one", which
                  only makes sense where a painter exists. A freshly uploaded
                  photo can always be taken back. */}
              {portrait && (paintsPortraits || !keptSaved) ? (
                <button type="button" onClick={() => setPortrait(null)} className={ui.btnSmall}>
                  {keptSaved ? "Regenerate portrait" : "Remove photo"}
                </button>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs text-stone-500">
              {portrait
                ? paintsPortraits
                  ? "This photo is used as-is; no portrait is painted for you."
                  : "This photo is used as-is."
                : paintsPortraits
                  ? "Add art, or let the AI paint one after you save."
                  : "Upload a photo to give your character a face."}
            </p>
          </div>
        </div>
        <Field label="Appearance" className="mt-4" captionId={appearanceId}>
          <p id={`${appearanceId}-help`} className="mb-2 text-xs text-stone-500">
            {paintsPortraits
              ? "Used to paint your character's portrait if you don't upload a photo."
              : "How your character looks, for the party and the GM to picture."}
          </p>
          <textarea
            value={state.appearance}
            onChange={(event) => state.setAppearance(event.target.value)}
            aria-labelledby={appearanceId}
            aria-describedby={`${appearanceId}-help`}
            rows={2}
            maxLength={500}
            placeholder="Silver hair, weathered face, a scar across one eye..."
            className={cn(inputClass, "resize-y")}
          />
        </Field>
      </StepPanel>

      <StepPanel
        title="Backstory (optional)"
        help="Who were they before the adventure, and whom do they serve: a god, a patron, a cause? The party can read this, and the GM reads all of it and weaves it into the story."
      >
        <textarea
          value={state.backstory}
          onChange={(event) => state.setBackstory(event.target.value)}
          rows={4}
          maxLength={BACKSTORY_MAX}
          placeholder="A disgraced temple guard of the moon goddess, looking for a second chance..."
          className={cn(inputClass, "resize-y")}
          aria-label="Backstory"
          aria-describedby={`${backstoryId}-length`}
        />
        <LengthNote id={`${backstoryId}-length`} length={state.backstory.length} max={BACKSTORY_MAX} from={0.75} />
      </StepPanel>

      {asksHopes ? (
        <StepPanel
          title="Hopes for this story (optional)"
          help="What would you love to see happen? A romance, a rival, a redemption, an old debt paid. Only you and the GM see this. The GM reads it every turn and steers toward it when the story allows. You can change it later from your character sheet."
        >
          <textarea
            value={state.hopes}
            onChange={(event) => state.setHopes(event.target.value)}
            rows={3}
            maxLength={HOPES_MAX}
            placeholder="A romance with the companion who travels with us, and a reckoning with the knight who betrayed me..."
            className={cn(inputClass, "resize-y")}
            aria-label="Hopes for this story"
            aria-describedby={`${hopesId}-length`}
          />
          <LengthNote id={`${hopesId}-length`} length={state.hopes.length} max={HOPES_MAX} from={0.75} />
        </StepPanel>
      ) : null}
    </div>
  );
}
