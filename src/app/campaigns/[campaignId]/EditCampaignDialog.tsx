"use client";

import { Loader2, Pencil } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Dialog } from "@/components/ui/Dialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper as KitStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  CAMPAIGN_DIFFICULTIES,
  CAMPAIGN_DIFFICULTY_HINTS,
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

// A group of fields under a painted glyph and a rule that wipes in.
function Group({ glyph, title, children }: { glyph: string; title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-3">
      <legend className="lobby-head mb-3 w-full">
        <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-7" />
        <span className="lobby-head-title">{title}</span>
        <span className="lobby-head-rule motion-rule" aria-hidden="true" />
      </legend>
      {children}
    </fieldset>
  );
}

// The kit stepper under its visible label. The field is still a real number
// input with the same bounds, so typing a value works as it always did.
function NumberStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="block">
      <span className="mb-1 block text-stone-400">{label}</span>
      <KitStepper label={label} value={value} min={min} max={max} onChange={onChange} />
    </div>
  );
}

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
    // Same reason: the preview falls back to the generic plate without it.
    genre?: string;
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
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title="Edit campaign"
      icon={<Pencil className="size-4 text-amber-300" />}
      width="w-[min(94vw,32rem)]"
    >
      <form onSubmit={submit} className="space-y-6 text-sm">
        <Group glyph="tab-story" title="The story">
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
            <span className="mb-1 flex items-baseline justify-between text-stone-400">
              Premise
              <span className="text-[11px] text-stone-500">{description.length}/500</span>
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
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
        </Group>

        <Group glyph="tab-party" title="The table">
          <div className="grid grid-cols-2 gap-3">
            <NumberStepper label="Players" value={maxPlayers} min={1} max={8} onChange={setMaxPlayers} />
            <NumberStepper label="Start level" value={startingLevel} min={1} max={20} onChange={setStartingLevel} />
          </div>
          <div>
            <span className="mb-1 block text-stone-400">Difficulty</span>
            <SegmentedControl
              size="sm"
              label="Difficulty"
              className="w-full"
              options={CAMPAIGN_DIFFICULTIES.map((value) => ({ value, label: value }))}
              value={difficulty}
              onChange={setDifficulty}
            />
            <p key={difficulty} className="motion-tab mt-1.5 text-xs text-stone-500">
              {CAMPAIGN_DIFFICULTY_HINTS[difficulty]}
            </p>
          </div>
        </Group>

        <Group glyph="tab-handout" title="Cover art">
          <CampaignCover
            cover={cover}
            title={title || campaign.title}
            genre={campaign.genre}
            seed={campaign.id}
            status={coverStatus}
          />
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
          <div className="flex flex-wrap gap-2">
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
            <p className="motion-shake text-xs text-red-400">The cover did not paint. Try again, or upload one.</p>
          ) : null}
          {coverError ? <p className="motion-shake text-xs text-red-400">{coverError}</p> : null}
        </Group>

        {error ? <p className="motion-shake text-red-400">{error}</p> : null}
        <button type="submit" disabled={busy} className={cn(ui.btnPrimary, "w-full")}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save changes
        </button>
      </form>
    </Dialog>
  );
}
