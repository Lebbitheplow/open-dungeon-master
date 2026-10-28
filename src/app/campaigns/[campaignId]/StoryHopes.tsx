"use client";

import { useId, useState } from "react";
import { SheetBlock } from "@/components/sheet/SheetParts";
import { LengthNote } from "@/components/ui/LengthNote";
import { cn } from "@/lib/cn";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { ui } from "@/lib/ui";
import { hostOffers, useCapabilities } from "@/lib/use-capabilities";
import { KitButton } from "./PanelKit";

// The sheet schema's limit (src/lib/schemas/sheet.ts HOPES_MAX, checked equal
// by scripts/test-story-hopes.mjs).
const HOPES_MAX = 500;

// "Hopes for this story" on the player's own sheet: what they would love the
// story to hold for this character (a romance, a rival, a redemption), said
// to the GM out of character. Only the owner and a DM seat ever receive the
// text (src/lib/dm/sheet-view.ts). The GM reads it every turn
// (src/lib/dm/prompt.ts describeSheet), so the owner can change it as the
// story changes; the builder's Identity step writes the first one.
export function StoryHopes({ sheet, mine }: { sheet: CharacterSheet; mine: boolean }) {
  const hopes = sheet.hopes ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fieldId = useId();
  // A host from before the field drops it while answering the save as done
  // (an app's screens may be newer than the host they are opened on).
  const kept = hostOffers(useCapabilities(), "storyHopes");
  if (!kept) {
    return null;
  }

  // Someone else's hopes reach this viewer only at a DM seat: read, not edit.
  if (!mine) {
    return hopes ? (
      <SheetBlock className="mt-4" title="Their player's hopes for this story" aside="for the GM">
        <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-300">{hopes}</p>
      </SheetBlock>
    ) : null;
  }

  async function save(text: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${sheet.campaignId}/sheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: sheet.id, hopes: text.trim() }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not save your hopes.");
        return;
      }
      setDraft(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SheetBlock className="mt-4" title="Hopes for this story" aside="only you and the GM see these">
      {draft === null ? (
        <div className="space-y-2">
          {hopes ? (
            <p className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-stone-300">{hopes}</p>
          ) : (
            <p className="text-xs text-stone-400">
              Tell the GM what you would love to see happen: a romance, a rival, a redemption. They read it every
              turn and steer toward it when the story allows.
            </p>
          )}
          <KitButton onClick={() => setDraft(hopes)}>{hopes ? "Change hopes" : "Write your hopes"}</KitButton>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            maxLength={HOPES_MAX}
            autoFocus
            placeholder="A romance with the companion who travels with us, and a reckoning with the knight who betrayed me..."
            aria-label="Hopes for this story"
            aria-describedby={`${fieldId}-length`}
            className={cn(ui.input, "w-full resize-y")}
          />
          <LengthNote id={`${fieldId}-length`} length={draft.length} max={HOPES_MAX} from={0.75} />
          <div className="flex flex-wrap justify-end gap-2">
            <KitButton onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </KitButton>
            <KitButton
              onClick={() => void save(draft)}
              disabled={saving || draft.trim() === hopes}
              busy={saving}
              className="border-amber-500/50 text-amber-100"
            >
              Save hopes
            </KitButton>
          </div>
          {error ? (
            <p role="alert" className="text-xs text-red-300">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </SheetBlock>
  );
}
