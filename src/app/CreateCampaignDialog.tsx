"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GENRE_PRESETS } from "@/lib/genres";
import { TTS_VOICES } from "@/lib/tts-voices";
import { CAMPAIGN_DIFFICULTIES, type CampaignDifficulty } from "@/lib/campaign-types";
import type { DicePolicy, Genre } from "@/lib/schemas/game-settings";

export function CreateCampaignDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (campaignId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [startingLevel, setStartingLevel] = useState(1);
  const [difficulty, setDifficulty] = useState<CampaignDifficulty>("normal");
  const [genre, setGenre] = useState<Genre>("high_fantasy");
  const [customGenreText, setCustomGenreText] = useState("");
  const [aiStorySetup, setAiStorySetup] = useState(true);
  const [dicePolicy, setDicePolicy] = useState<DicePolicy>("digital_only");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsVoice, setTtsVoice] = useState<string>("af_heart");
  const [mapsEnabled, setMapsEnabled] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          theme: theme.trim(),
          maxPlayers,
          startingLevel,
          difficulty,
          gameSettings: {
            genre,
            customGenreText: customGenreText.trim(),
            aiStorySetup,
            dicePolicy,
            ttsEnabled,
            ttsVoice,
            mapsEnabled,
          },
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the campaign.");
        return;
      }
      onCreated(data.campaign.id);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = ui.input;
  const toggleClass = (active: boolean) =>
    cn(
      "flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
      active
        ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
        : "border-stone-800 text-stone-400 hover:border-stone-600",
    );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[90vh] w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-stone-700 bg-[#130d09] p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-serif text-lg font-semibold">New campaign</Dialog.Title>
            <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="space-y-4 text-sm">
            <label className="block">
              <span className="mb-1 block text-stone-400">Title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
                placeholder="Curse of the Ash Kingdom"
                className={inputClass}
              />
            </label>

            <div>
              <span className="mb-1.5 block text-stone-400">Setting</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GENRE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setGenre(preset.id)}
                    title={preset.blurb}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 text-xs transition-colors",
                      genre === preset.id
                        ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
                        : "border-stone-800 text-stone-400 hover:border-stone-600",
                    )}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {GENRE_PRESETS.find((preset) => preset.id === genre)?.blurb}
              </p>
              {genre === "custom" ? (
                <textarea
                  value={customGenreText}
                  onChange={(event) => setCustomGenreText(event.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Describe the world and tone in your own words..."
                  className={cn(inputClass, "mt-2")}
                />
              ) : null}
            </div>

            <label className="block">
              <span className="mb-1 block text-stone-400">
                Premise (optional{aiStorySetup ? "; the AI fills this in if left blank" : ""})
              </span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                maxLength={500}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-stone-400">World or theme notes</span>
              <input
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                maxLength={120}
                placeholder="Low-magic gritty, homebrew fey court, neon-drenched megacity..."
                className={inputClass}
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className="mb-1 block text-stone-400">Players</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={maxPlayers}
                  onChange={(event) => setMaxPlayers(Number(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">Start level</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={startingLevel}
                  onChange={(event) => setStartingLevel(Number(event.target.value))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as CampaignDifficulty)}
                  className={inputClass}
                >
                  {CAMPAIGN_DIFFICULTIES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <span className="mb-1.5 block text-stone-400">Dice</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDicePolicy("digital_only")}
                  className={toggleClass(dicePolicy === "digital_only")}
                >
                  <span className="block font-medium">Digital only</span>
                  <span className="block text-xs opacity-80">The server rolls everything</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDicePolicy("real_allowed")}
                  className={toggleClass(dicePolicy === "real_allowed")}
                >
                  <span className="block font-medium">Real dice allowed</span>
                  <span className="block text-xs opacity-80">
                    Players may opt in to rolling at the table
                  </span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setAiStorySetup(!aiStorySetup)}
                className={toggleClass(aiStorySetup)}
              >
                <span className="block font-medium">AI story setup</span>
                <span className="block text-xs opacity-80">The DM invents the plot</span>
              </button>
              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={toggleClass(ttsEnabled)}
              >
                <span className="block font-medium">Voice narration</span>
                <span className="block text-xs opacity-80">Spoken DM narration</span>
              </button>
              <button
                type="button"
                onClick={() => setMapsEnabled(!mapsEnabled)}
                className={toggleClass(mapsEnabled)}
              >
                <span className="block font-medium">Maps</span>
                <span className="block text-xs opacity-80">AI-drawn area maps</span>
              </button>
            </div>

            {ttsEnabled ? (
              <label className="block">
                <span className="mb-1 block text-stone-400">Narrator voice</span>
                <select
                  value={ttsVoice}
                  onChange={(event) => setTtsVoice(event.target.value)}
                  className={inputClass}
                >
                  {TTS_VOICES.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {error ? <p className="text-red-400">{error}</p> : null}
            <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "w-full")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Create campaign
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
