"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { CAMPAIGN_DIFFICULTIES, type CampaignDifficulty } from "@/lib/campaign-types";
import type { Campaign } from "@/lib/db/campaigns";

// Party-lead edit of the campaign's core settings, available in the lobby
// and mid-game (the DM prompt reads them fresh each turn); game settings
// (genre, dice, narration) live in GameSettingsPanel.
export function EditCampaignDialog({
  campaign,
  onClose,
}: {
  campaign: Pick<
    Campaign,
    "id" | "title" | "description" | "theme" | "maxPlayers" | "startingLevel" | "difficulty"
  >;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(campaign.title);
  const [description, setDescription] = useState(campaign.description);
  const [theme, setTheme] = useState(campaign.theme);
  const [maxPlayers, setMaxPlayers] = useState(campaign.maxPlayers);
  const [startingLevel, setStartingLevel] = useState(campaign.startingLevel);
  const [difficulty, setDifficulty] = useState<CampaignDifficulty>(campaign.difficulty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          theme: theme.trim(),
          maxPlayers,
          startingLevel,
          difficulty,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not save the campaign settings.");
        return;
      }
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass = ui.input;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto panel rounded-xl p-6">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="font-display text-lg tracking-wide text-amber-50">
              Edit campaign
            </Dialog.Title>
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
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-stone-400">Premise</span>
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
            {error ? <p className="text-red-400">{error}</p> : null}
            <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "w-full")}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save changes
            </button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
