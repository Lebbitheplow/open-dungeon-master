"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  CAMPAIGN_DIFFICULTIES,
  type CampaignCover as CampaignCoverRef,
  type CampaignDifficulty,
} from "@/lib/campaign-types";
import type { Campaign } from "@/lib/db/campaigns";
import { offersImages, useCapabilities } from "@/lib/use-capabilities";
import { CampaignCover, type CoverStatus } from "@/components/CampaignCover";

// Matches the characters page: polls every 2.5 s while a render is queued
// or generating, and gives up after the image backend's own timeout so a
// job the server never resolves cannot poll forever.
const COVER_POLL_MS = 2500;
const COVER_POLL_LIMIT = 240;

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
  > & {
    // Optional because the in-game settings panel hands over a narrower
    // shape than the lobby; the dialog fetches the live cover on open anyway.
    cover?: CampaignCoverRef | null;
  };
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

  // Cover art. The dialog owns its own copy so a change shows here at once;
  // the table's snapshot catches up through campaign_updated.
  const [cover, setCover] = useState<CampaignCoverRef | null>(campaign.cover ?? null);
  const [coverStatus, setCoverStatus] = useState<CoverStatus>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState("");
  const pollCount = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const capabilities = useCapabilities();
  const coverPending = coverStatus === "queued" || coverStatus === "generating";

  // Opening the dialog mid-render (say, after a reload) should still show
  // the spinner, so the first thing it does is ask.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaign.id}/cover`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setCover(data.cover ?? null);
          setCoverStatus(data.status ?? null);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaign.id]);

  useEffect(() => {
    if (!coverPending || pollCount.current >= COVER_POLL_LIMIT) {
      return;
    }
    const id = setTimeout(() => {
      pollCount.current += 1;
      fetch(`/api/campaigns/${campaign.id}/cover`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) {
            setCover(data.cover ?? null);
            setCoverStatus(data.status ?? null);
          }
        })
        .catch(() => {});
    }, COVER_POLL_MS);
    return () => clearTimeout(id);
  }, [campaign.id, coverPending, coverStatus, cover]);

  async function coverRequest(method: "PATCH" | "POST" | "DELETE", body?: unknown) {
    setCoverBusy(true);
    setCoverError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}/cover`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCoverError(data.error || "Could not change the cover.");
        return;
      }
      pollCount.current = 0;
      setCover(data.cover ?? null);
      setCoverStatus(data.status ?? null);
    } catch {
      setCoverError("Could not reach the server.");
    } finally {
      setCoverBusy(false);
    }
  }

  async function uploadCover(file: File) {
    setCoverBusy(true);
    setCoverError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const upload = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const payload = await upload.json().catch(() => ({}));
      if (!upload.ok) {
        setCoverError(payload.error || "That image would not upload.");
        return;
      }
      await coverRequest("PATCH", { imageUrl: payload.url });
    } catch {
      setCoverError("That image would not upload.");
    } finally {
      setCoverBusy(false);
    }
  }

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

            <div>
              <span className="mb-1 block text-stone-400">Cover art</span>
              <CampaignCover cover={cover} title={title || campaign.title} status={coverStatus} />
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) {
                    void uploadCover(file);
                  }
                }}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={coverBusy || coverPending}
                  onClick={() => fileInput.current?.click()}
                  className={ui.btnSmall}
                >
                  Upload
                </button>
                {offersImages(capabilities) ? (
                  <button
                    type="button"
                    disabled={coverBusy || coverPending}
                    onClick={() => void coverRequest("POST")}
                    className={ui.btnSmall}
                  >
                    {coverPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {coverPending ? "Painting" : "Paint one"}
                  </button>
                ) : null}
                {cover ? (
                  <button
                    type="button"
                    disabled={coverBusy || coverPending}
                    onClick={() => void coverRequest("DELETE")}
                    className={ui.btnSmall}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              {coverStatus === "failed" ? (
                <p className="mt-1 text-xs text-red-400">
                  The cover did not paint. Try again, or upload one.
                </p>
              ) : null}
              {coverError ? <p className="mt-1 text-xs text-red-400">{coverError}</p> : null}
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
