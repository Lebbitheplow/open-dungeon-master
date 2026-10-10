"use client";

import { useState } from "react";
import type { CharacterSheet } from "@/lib/schemas/sheet";

type CharacterSwitcherProps = {
  campaignId: string;
  sheets: CharacterSheet[];
  selectedId: string;
  initiativeName?: string;
  onError: (error: string) => void;
};

export function CharacterSwitcher({
  campaignId,
  sheets,
  selectedId,
  initiativeName,
  onError,
}: CharacterSwitcherProps) {
  const [busy, setBusy] = useState(false);

  async function select(characterId: string) {
    setBusy(true);
    onError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/sheet/switch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        onError(result.error || "Could not select the character.");
      }
    } catch {
      onError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="z-20 flex flex-wrap items-center gap-2 border-b border-stone-700 bg-stone-950 px-3 py-2">
      <label className="text-sm text-stone-300">
        Your character
        <select
          aria-label="Your character"
          value={selectedId}
          disabled={busy}
          onChange={(event) => void select(event.target.value)}
          className="ml-2 rounded border border-stone-600 bg-stone-900 px-2 py-1 text-stone-100"
        >
          {sheets.map((sheet) => (
            <option key={sheet.id} value={sheet.id}>{sheet.name}</option>
          ))}
        </select>
      </label>
      {initiativeName ? (
        <span className="text-sm text-amber-300">Acting this turn: {initiativeName}</span>
      ) : null}
    </div>
  );
}
