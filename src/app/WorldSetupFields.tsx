"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import {
  WORLD_LORE_CATEGORIES,
  type WorldLoreCategory,
} from "@/lib/dm/world-lore-logic";

// Optional world-building block for the campaign creator: house rules and
// starting world-lore entries, drafted client-side and posted to the rules
// and lore endpoints right after the campaign row exists. Everything here
// stays editable later in the lobby and session panels.

export type LoreDraft = {
  category: WorldLoreCategory;
  title: string;
  body: string;
};

const CATEGORY_LABELS: Record<WorldLoreCategory, string> = {
  geography: "Geography",
  factions: "Factions",
  history: "History",
  magic: "Magic",
  culture: "Culture",
  religion: "Religion",
  other: "Other",
};

// Posts the drafts after creation; failures are silent (the lobby panels
// can re-enter anything that was lost).
export async function submitWorldSetup(
  campaignId: string,
  houseRules: string,
  loreDrafts: LoreDraft[],
) {
  const jobs: Promise<unknown>[] = [];
  if (houseRules.trim()) {
    jobs.push(
      fetch(`/api/campaigns/${campaignId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: houseRules }),
      }).catch(() => undefined),
    );
  }
  for (const draft of loreDrafts) {
    if (!draft.title.trim() || !draft.body.trim()) {
      continue;
    }
    jobs.push(
      fetch(`/api/campaigns/${campaignId}/lore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: draft.category, title: draft.title, body: draft.body }),
      }).catch(() => undefined),
    );
  }
  await Promise.all(jobs);
}

export function WorldSetupFields({
  houseRules,
  setHouseRules,
  loreDrafts,
  setLoreDrafts,
}: {
  houseRules: string;
  setHouseRules: (text: string) => void;
  loreDrafts: LoreDraft[];
  setLoreDrafts: (drafts: LoreDraft[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const filled =
    (houseRules.trim() ? 1 : 0) + loreDrafts.filter((draft) => draft.title.trim()).length;

  function patchDraft(index: number, patch: Partial<LoreDraft>) {
    setLoreDrafts(
      loreDrafts.map((draft, draftIndex) =>
        draftIndex === index ? { ...draft, ...patch } : draft,
      ),
    );
  }

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-stone-300"
      >
        {open ? (
          <ChevronDown className="size-3.5 text-stone-500" />
        ) : (
          <ChevronRight className="size-3.5 text-stone-500" />
        )}
        <span className="font-medium">World building</span>
        <span className="text-xs text-stone-500">
          optional{filled ? `, ${filled} item${filled === 1 ? "" : "s"}` : ""}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 border-t border-stone-800/70 p-3">
          <label className="block">
            <span className="mb-1 block text-xs text-stone-400">House rules</span>
            <textarea
              value={houseRules}
              onChange={(event) => setHouseRules(event.target.value)}
              rows={4}
              maxLength={20_000}
              placeholder={
                "Your table's rulings, grouped under headings, e.g.\n\nPotions:\nDrinking a potion is a bonus action."
              }
              className={ui.input}
            />
            <span className="mt-1 block text-xs text-stone-500">
              The DM is reminded of the relevant rules each turn. Editable later in Setup.
            </span>
          </label>

          <div>
            <span className="mb-1 block text-xs text-stone-400">World lore</span>
            <div className="space-y-2">
              {loreDrafts.map((draft, index) => (
                <div
                  key={index}
                  className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 p-2"
                >
                  <div className="flex gap-1.5">
                    <select
                      value={draft.category}
                      onChange={(event) =>
                        patchDraft(index, {
                          category: event.target.value as WorldLoreCategory,
                        })
                      }
                      className={cn(ui.input, "w-32 shrink-0")}
                    >
                      {WORLD_LORE_CATEGORIES.map((category) => (
                        <option key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </option>
                      ))}
                    </select>
                    <input
                      value={draft.title}
                      onChange={(event) => patchDraft(index, { title: event.target.value })}
                      maxLength={120}
                      placeholder="Title (The Ashen League, The Sundering...)"
                      className={ui.input}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setLoreDrafts(loreDrafts.filter((_, draftIndex) => draftIndex !== index))
                      }
                      title="Remove this entry"
                      className="shrink-0 rounded p-1 text-stone-500 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <textarea
                    value={draft.body}
                    onChange={(event) => patchDraft(index, { body: event.target.value })}
                    rows={2}
                    maxLength={4000}
                    placeholder="What is established about it..."
                    className={ui.input}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setLoreDrafts([...loreDrafts, { category: "geography", title: "", body: "" }])
                }
                className="flex items-center gap-1 rounded border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900"
              >
                <Plus className="size-3" /> Add lore entry
              </button>
            </div>
            <span className="mt-1 block text-xs text-stone-500">
              Places, factions, and history the DM treats as canon. Grows anytime from the lobby
              and the Facts tab.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
