"use client";

import { cn } from "@/lib/cn";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { COMPANION_LABELS, type GameSettings } from "@/lib/schemas/game-settings";
import { FieldLabel, inputClass } from "@/app/create-campaign/fields";
import type { StepProps } from "@/app/create-campaign/draft";

// The second half of "the feel": who else the AI brings to the table, and
// what its narrator sounds like. Allies only exist when the AI narrates;
// the voice picker only matters once narration is on.
export function NarratorFields({
  draft,
  patch,
  gates,
  className,
}: StepProps & { className?: string }) {
  const { aiNarrates, solo } = gates;
  return (
    <div className={cn("space-y-4", className)}>
      {aiNarrates ? (
        <div>
          <FieldLabel className="mb-1.5">AI allies</FieldLabel>
          <select
            value={draft.companions}
            onChange={(event) =>
              patch({ companions: event.target.value as GameSettings["companions"] })
            }
            className={inputClass}
          >
            {(Object.keys(COMPANION_LABELS) as Array<GameSettings["companions"]>).map((mode) => (
              <option key={mode} value={mode}>
                {COMPANION_LABELS[mode]}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone-500">
            {solo
              ? "Party members travel with you until dismissed; guests are allies who show up for a scene or a battle and then leave."
              : "Guests are friendly NPCs the DM brings in for a scene or a battle; they fight with real stats and leave when the fight ends. Party members stay until dismissed."}
          </p>
          {draft.companions !== "off" ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              {draft.companions !== "guests" ? (
                <label className="block">
                  <span className="mb-1 block text-xs text-stone-500">Party members at once</span>
                  <select
                    value={draft.maxCompanions}
                    onChange={(event) => patch({ maxCompanions: Number(event.target.value) })}
                    className={inputClass}
                  >
                    {[1, 2, 3, 4].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">Guests at once</span>
                <select
                  value={draft.maxGuests}
                  onChange={(event) => patch({ maxGuests: Number(event.target.value) })}
                  className={inputClass}
                >
                  {[1, 2, 3, 4].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.ttsEnabled ? (
        <div className="block">
          <FieldLabel>Narrator voice</FieldLabel>
          <div className="flex items-center gap-2">
            <select
              value={draft.ttsVoice}
              onChange={(event) => patch({ ttsVoice: event.target.value })}
              className={inputClass}
            >
              {TTS_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
            <VoicePreviewButton voice={draft.ttsVoice} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
