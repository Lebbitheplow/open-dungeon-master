"use client";

import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS } from "@/lib/genres";
import type { Genre } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

// Step 2: the setting, its custom description, the premise and theme notes.
// Cover art is only pointed at from here: the upload and the AI painter live
// in the campaign's details dialog, because a cover needs a campaign row to
// hang off, and duplicating the picker here would mean two upload paths.
export function WorldStep({
  draft,
  patch,
  gates,
  onPickGenre,
}: StepProps & {
  // Picking a bare genre by hand leaves the pack, so the dialog owns the
  // handler that does both.
  onPickGenre: (genre: Genre) => void;
}) {
  const showsAiFill = gates.aiNarrates && draft.aiStorySetup;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <FieldLabel className="mb-1.5">Setting</FieldLabel>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GENRE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPickGenre(preset.id)}
              title={preset.blurb}
              className={cn(
                "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                draft.genre === preset.id
                  ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                  : "border-stone-800 text-stone-400 hover:border-stone-600",
              )}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-stone-500">
          {GENRE_PRESETS.find((preset) => preset.id === draft.genre)?.blurb}
        </p>
        {draft.genre === "custom" ? (
          <textarea
            value={draft.customGenreText}
            onChange={(event) => patch({ customGenreText: event.target.value })}
            rows={2}
            maxLength={500}
            placeholder="Describe the world and tone in your own words..."
            className={cn(inputClass, "mt-2")}
          />
        ) : null}
      </div>

      <label className="block">
        <FieldLabel>
          Premise (optional{showsAiFill ? "; the AI fills this in if left blank" : ""})
        </FieldLabel>
        <textarea
          value={draft.description}
          onChange={(event) =>
            patch({ description: event.target.value, descriptionTouched: true })
          }
          rows={2}
          maxLength={500}
          className={inputClass}
        />
      </label>

      <label className="block">
        <FieldLabel>World or theme notes</FieldLabel>
        <input
          value={draft.theme}
          onChange={(event) => patch({ theme: event.target.value, themeTouched: true })}
          maxLength={120}
          placeholder="Low-magic gritty, homebrew fey court, neon-drenched megacity..."
          className={inputClass}
        />
      </label>

      <div className="flex items-start gap-3 rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <ImageIcon className="mt-0.5 size-4 shrink-0 text-amber-300/70" aria-hidden="true" />
        <div>
          <span className="block text-stone-300">Cover art</span>
          <p className="mt-0.5 text-xs text-stone-500">
            You can add cover art from the campaign&apos;s details once it exists.
          </p>
        </div>
      </div>
    </div>
  );
}
