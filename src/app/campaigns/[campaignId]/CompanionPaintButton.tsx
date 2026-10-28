"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { KitButton } from "./PanelKit";

// How long the card watches a painting before it stops asking: the queue is
// shared with every other render on the one GPU (the library's sheet page
// waits as long). The finished face still arrives with the sheet after that.
const POLL_MS = 3_000;
const POLL_LIMIT = 240;

// "Paint a portrait" on a companion's card (issue 569), beside the upload:
// the image model paints a new face from the sheet. Shown only to whoever
// runs the story, and only where the server has an image model (the caller
// decides both). The new face arrives with the sheet over the campaign
// stream; this only says it is coming, or that it failed.
export function CompanionPaintButton({ campaignId, sheet }: { campaignId: string; sheet: CharacterSheet }) {
  // The face the card showed when the button was pressed, or null when no
  // painting was asked for. It is painting until a different face arrives:
  // the old one is cleared first, and the new one comes with the sheet.
  const [pressedOver, setPressedOver] = useState<string | null>(null);
  const [error, setError] = useState("");
  const polls = useRef(0);
  const portraitUrl = sheet.portrait?.url ?? "";
  const painting = pressedOver !== null && (!portraitUrl || portraitUrl === pressedOver);

  useEffect(() => {
    if (!painting) {
      return;
    }
    polls.current = 0;
    const timer = window.setInterval(async () => {
      polls.current += 1;
      if (polls.current > POLL_LIMIT) {
        window.clearInterval(timer);
        setPressedOver(null);
        return;
      }
      const response = await fetch(`/api/campaigns/${campaignId}/companions/${sheet.id}/portrait`, { cache: "no-store" }).catch(() => null);
      const data = response?.ok ? ((await response.json().catch(() => ({}))) as { status?: string | null }) : {};
      if (data.status === "failed") {
        window.clearInterval(timer);
        setPressedOver(null);
        setError("The portrait could not be painted. Try again, or upload one.");
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [painting, campaignId, sheet.id]);

  async function paint() {
    setError("");
    setPressedOver(portraitUrl);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/companions/${sheet.id}/portrait`, { method: "POST" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not start the painting.");
        setPressedOver(null);
      }
    } catch {
      setError("Could not reach the server.");
      setPressedOver(null);
    }
  }

  return (
    <div className="space-y-1">
      <KitButton
        onClick={paint}
        disabled={painting}
        busy={painting}
        title={`The image model paints ${sheet.name} a new face from their sheet${portraitUrl ? ", replacing this one" : ""}.`}
        className="w-full justify-center"
      >
        {painting ? null : <Sparkles className="size-3.5" aria-hidden="true" />}
        {painting ? "Painting portrait…" : portraitUrl ? "Paint a new portrait" : "Paint a portrait"}
      </KitButton>
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
