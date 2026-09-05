"use client";

import { Camera, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { formatModifier, proficiencyBonus } from "@/lib/srd";
import { ui } from "@/lib/ui";
import ContentPicker from "../ContentPicker";
import type { RaceOption } from "../useBuilderOptions";
import type { BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { Chip, Field, StepPanel, inputClass } from "./shared";

// Step 6: the portrait, how they look, their story, extra feats, and the
// numbers the sheet will open with. The save button is the wizard footer.
export function FinishStep({
  state,
  derived,
  race,
  initial,
  paintsPortraits,
  onUploadPortrait,
  error,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  race: RaceOption | undefined;
  initial?: CreateSheetInput;
  // Whether this server can paint a portrait at all. Without an image
  // backend the section offers the upload alone and stops promising a
  // painting that would never arrive.
  paintsPortraits: boolean;
  onUploadPortrait: () => void;
  error: string;
}) {
  const { portrait, setPortrait, acOverride, setAcOverride, setHpOverride } = state;
  const { preview, acInfo, ac, effectiveLevel, asiSlotLevels } = derived;
  const keptSaved = Boolean(initial?.portrait && portrait?.url === initial.portrait.url);
  return (
    <div className="space-y-4">
      <StepPanel title="Portrait (optional)" ornate>
        <div className="flex items-center gap-3">
          {portrait?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={portrait.url}
              alt="Character portrait"
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
        <Field label="Appearance" className="mt-4">
          <p className="mb-2 text-xs text-stone-500">
            {paintsPortraits
              ? "Used to paint your character's portrait if you don't upload a photo."
              : "How your character looks, for the party and the DM to picture."}
          </p>
          <textarea
            value={state.appearance}
            onChange={(event) => state.setAppearance(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Silver hair, weathered face, a scar across one eye..."
            className={cn(inputClass, "resize-y")}
          />
        </Field>
      </StepPanel>

      <StepPanel
        title="Backstory (optional)"
        help="Who were they before the adventure? The party can read this, and the DM weaves it into the story."
      >
        <textarea
          value={state.backstory}
          onChange={(event) => state.setBackstory(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="A disgraced temple guard looking for a second chance..."
          className={cn(inputClass, "resize-y")}
          aria-label="Backstory"
        />
      </StepPanel>

      <StepPanel
        title="Additional feats (optional)"
        help={
          asiSlotLevels.length
            ? "Beyond the ability score improvement picks on the Abilities step; racial or homebrew feats go here."
            : undefined
        }
      >
        <ContentPicker
          kind="feats"
          placeholder="Search feats (e.g. alert, tough)"
          onPick={(entry) =>
            state.setFeats((current) =>
              current.includes(entry.name) ? current : [...current, entry.name],
            )
          }
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {state.feats.map((feat) => (
            <Chip
              key={feat}
              label={feat}
              onRemove={() => state.setFeats((current) => current.filter((entry) => entry !== feat))}
            />
          ))}
        </div>
      </StepPanel>

      {preview && race ? (
        <StepPanel title="Derived stats" ornate className="border-amber-500/30">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-stone-300 sm:grid-cols-4">
            <Field label="Max HP">
              <input
                type="number"
                min={1}
                max={500}
                value={preview.maxHp}
                onChange={(event) => setHpOverride(Number(event.target.value) || 1)}
                className={cn(inputClass, "w-20")}
              />
            </Field>
            <Field label={`AC${acOverride === null ? "" : " (pinned)"}`}>
              <input
                type="number"
                min={1}
                max={30}
                value={ac}
                onChange={(event) => setAcOverride(Number(event.target.value) || 10)}
                className={cn(inputClass, "w-20")}
              />
              <span className="mt-1 block text-[11px] text-stone-500">
                {acOverride === null
                  ? (acInfo?.parts.join(" + ") ?? "")
                  : "typed by hand; armor no longer changes it"}
              </span>
              {acOverride === null ? null : (
                <button
                  type="button"
                  onClick={() => setAcOverride(null)}
                  className="mt-1 text-[11px] text-amber-300/80 underline"
                >
                  use my armor instead
                </button>
              )}
            </Field>
            <span className="self-end">Speed {race.speed} ft</span>
            <span className="self-end">Prof {formatModifier(proficiencyBonus(effectiveLevel))}</span>
            <span>Initiative {formatModifier(preview.derived.initiative)}</span>
            <span>Passive Perception {preview.derived.passivePerception}</span>
            {preview.derived.spellSaveDc ? <span>Spell DC {preview.derived.spellSaveDc}</span> : null}
            {preview.derived.spellAttack !== null ? (
              <span>Spell attack {formatModifier(preview.derived.spellAttack)}</span>
            ) : null}
          </div>
        </StepPanel>
      ) : null}

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
