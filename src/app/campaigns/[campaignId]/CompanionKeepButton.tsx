"use client";

import { useState } from "react";
import { BookmarkPlus } from "lucide-react";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { KitButton } from "./PanelKit";

// "Save to my characters" on a lasting companion's card, for whoever runs
// the story (src/lib/characters/keep-companion.ts): a companion the GM wrote
// in is kept in their library, ready for "Bring to a campaign"; one already
// kept there has its level, gear and spells written back. The button says
// which happened, for a moment, as the player's own "Save to library" does.
export function CompanionKeepButton({ campaignId, sheet }: { campaignId: string; sheet: CharacterSheet }) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [said, setSaid] = useState("");
  const [error, setError] = useState("");

  async function keep() {
    setState("saving");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/companions/${sheet.id}/keep`, { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { how?: string; keptLevel?: number | null; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not save them to your characters.");
        setState("idle");
        return;
      }
      setSaid(
        data.how === "saved"
          ? typeof data.keptLevel === "number"
            ? `Gear and notes saved; your library keeps level ${data.keptLevel}.`
            : "Level, gear and spells saved."
          : `${sheet.name} is in your characters.`,
      );
      setState("done");
      setTimeout(() => {
        setState("idle");
        setSaid("");
      }, 4_000);
    } catch {
      setError("Could not reach the server.");
      setState("idle");
    }
  }

  return (
    <div className="space-y-1">
      <KitButton
        onClick={keep}
        disabled={state === "saving"}
        busy={state === "saving"}
        title={`Keep ${sheet.name} in your characters, to bring to another campaign. Their level, gear and spells are saved; saving again updates them.`}
        className="w-full justify-center"
      >
        {state === "saving" ? null : <BookmarkPlus className="size-3.5" aria-hidden="true" />}
        Save to my characters
      </KitButton>
      {said ? (
        <p role="status" className="text-xs text-emerald-300">
          {said}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
