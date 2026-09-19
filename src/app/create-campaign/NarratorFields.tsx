"use client";

import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/Select";
import { TTS_VOICES } from "@/lib/tts-voices";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { COMPANION_LABELS } from "@/lib/schemas/game-settings-options";
import { FieldLabel } from "@/app/create-campaign/fields";
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
          <Select<GameSettings["companions"]>
            value={draft.companions}
            onChange={(companions) => patch({ companions })}
            label="AI allies"
            className="w-full"
            options={(Object.keys(COMPANION_LABELS) as Array<GameSettings["companions"]>).map((mode) => ({ value: mode, label: COMPANION_LABELS[mode] }))}
          />
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
                  <Select<string>
                    value={String(draft.maxCompanions)}
                    onChange={(count) => patch({ maxCompanions: Number(count) })}
                    label="Party members at once"
                    className="w-full"
                    options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: String(count) }))}
                  />
                </label>
              ) : null}
              <label className="block">
                <span className="mb-1 block text-xs text-stone-500">Guests at once</span>
                <Select<string>
                  value={String(draft.maxGuests)}
                  onChange={(count) => patch({ maxGuests: Number(count) })}
                  label="Guests at once"
                  className="w-full"
                  options={[1, 2, 3, 4].map((count) => ({ value: String(count), label: String(count) }))}
                />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.ttsEnabled ? (
        <div className="block">
          <FieldLabel>Narrator voice</FieldLabel>
          <div className="flex items-center gap-2">
            <Select<string>
              value={draft.ttsVoice}
              onChange={(ttsVoice) => patch({ ttsVoice })}
              label="Narrator voice"
              className="min-w-0 grow"
              options={TTS_VOICES.map((voice) => ({ value: voice.id as string, label: voice.label }))}
            />
            <VoicePreviewButton voice={draft.ttsVoice} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
