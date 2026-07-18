"use client";

import { Dices, Hand, Map, Sparkles, UserPlus, Volume2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { GENRE_PRESETS, genrePreset } from "@/lib/genres";
import { TTS_VOICES } from "@/lib/tts-voices";
import type { DicePolicy, GameSettings, Genre } from "@/lib/schemas/game-settings";

// Lobby game-settings section: the party lead edits live (PATCHes propagate to
// everyone over SSE); other players see a read-only summary.
export function GameSettingsPanel({
  campaignId,
  settings,
  isLead,
}: {
  campaignId: string;
  settings: GameSettings;
  isLead: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function patch(update: Partial<GameSettings>) {
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
    } finally {
      setBusy(false);
    }
  }

  const preset = genrePreset(settings.genre);
  const selectClass =
    "rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600";

  if (!isLead) {
    return (
      <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-300">Game settings</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-amber-200" />
            {preset.name}
            {settings.aiStorySetup ? " · AI story setup" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <Dices className="size-3.5 text-amber-200" />
            {settings.dicePolicy === "real_allowed" ? "Real dice allowed" : "Digital dice only"}
          </span>
          <span className="flex items-center gap-1.5">
            <Volume2 className="size-3.5 text-amber-200" />
            {settings.ttsEnabled
              ? `Narration on (${TTS_VOICES.find((voice) => voice.id === settings.ttsVoice)?.label ?? settings.ttsVoice})`
              : "Narration off"}
          </span>
          <span className="flex items-center gap-1.5">
            <Map className="size-3.5 text-amber-200" />
            {settings.mapsEnabled ? "Maps on" : "Maps off"}
          </span>
          <span className="flex items-center gap-1.5">
            <UserPlus className="size-3.5 text-amber-200" />
            {settings.midGameJoinOpen ? "Mid-game joining open" : "Mid-game joining closed"}
          </span>
          <span className="flex items-center gap-1.5">
            <Hand className="size-3.5 text-amber-200" />
            {settings.holdSubmissions ? "Lead opens responses each turn" : "Responses always open"}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-lg border border-stone-800 bg-stone-950/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-stone-300">Game settings</h2>
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Setting</span>
          <select
            value={settings.genre}
            onChange={(event) => patch({ genre: event.target.value as Genre })}
            className={selectClass}
          >
            {GENRE_PRESETS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="text-stone-500">{preset.blurb}</span>
        </div>
        {settings.genre === "custom" ? (
          <div className="flex items-start gap-2">
            <span className="w-16 shrink-0 pt-1 text-stone-500">World</span>
            <textarea
              defaultValue={settings.customGenreText}
              rows={2}
              maxLength={500}
              onBlur={(event) => patch({ customGenreText: event.target.value })}
              placeholder="Describe the world and tone..."
              className="flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 py-1 outline-none focus:border-amber-600"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Dice</span>
          <select
            value={settings.dicePolicy}
            onChange={(event) => patch({ dicePolicy: event.target.value as DicePolicy })}
            className={selectClass}
          >
            <option value="digital_only">Digital only</option>
            <option value="real_allowed">Real dice allowed</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Narration</span>
          <button
            type="button"
            onClick={() => patch({ ttsEnabled: !settings.ttsEnabled })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.ttsEnabled
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            {settings.ttsEnabled ? "On" : "Off"}
          </button>
          {settings.ttsEnabled ? (
            <select
              value={settings.ttsVoice}
              onChange={(event) => patch({ ttsVoice: event.target.value })}
              className={selectClass}
            >
              {TTS_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-stone-500">Extras</span>
          <button
            type="button"
            onClick={() => patch({ aiStorySetup: !settings.aiStorySetup })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.aiStorySetup
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            AI story setup {settings.aiStorySetup ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={() => patch({ mapsEnabled: !settings.mapsEnabled })}
            className={cn(
              "rounded-md border px-2 py-1",
              settings.mapsEnabled
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            Maps {settings.mapsEnabled ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={() => patch({ midGameJoinOpen: !settings.midGameJoinOpen })}
            title="Allow new players to join with the invite code after the adventure starts"
            className={cn(
              "rounded-md border px-2 py-1",
              settings.midGameJoinOpen
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            Mid-game joining {settings.midGameJoinOpen ? "open" : "closed"}
          </button>
          <button
            type="button"
            onClick={() => patch({ holdSubmissions: !settings.holdSubmissions })}
            title="After each DM narration, players cannot act until you allow responses. OOC stays open."
            className={cn(
              "rounded-md border px-2 py-1",
              settings.holdSubmissions
                ? "border-amber-700 bg-amber-950/50 text-amber-200"
                : "border-stone-700 text-stone-400",
            )}
          >
            Held responses {settings.holdSubmissions ? "on" : "off"}
          </button>
        </div>
      </div>
    </section>
  );
}
