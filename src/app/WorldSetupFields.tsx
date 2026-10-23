"use client";

import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
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

// What did not save, so the creator can say so and send only that again:
// the house rules text when it failed, and the lore drafts that failed.
export type WorldSetupLeft = { houseRules: string; loreDrafts: LoreDraft[] };

const posted = (request: Promise<Response>) => request.then((response) => response.ok).catch(() => false);

// Posts the drafts after creation and answers with what did not land. The
// lobby panels can re-enter anything, but only if the person knows it was
// lost: a campaign made without the rules typed for it is not what they made.
export async function submitWorldSetup(
  campaignId: string,
  houseRules: string,
  loreDrafts: LoreDraft[],
): Promise<WorldSetupLeft> {
  const rules = houseRules.trim()
    ? posted(
        fetch(`/api/campaigns/${campaignId}/rules`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: houseRules }),
        }),
      )
    : Promise.resolve(true);
  const drafts = loreDrafts.filter((draft) => draft.title.trim() && draft.body.trim());
  const lore = drafts.map((draft) =>
    posted(
      fetch(`/api/campaigns/${campaignId}/lore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: draft.category, title: draft.title, body: draft.body }),
      }),
    ),
  );
  const [rulesSaved, ...loreSaved] = await Promise.all([rules, ...lore]);
  return { houseRules: rulesSaved ? "" : houseRules, loreDrafts: drafts.filter((_, index) => !loreSaved[index]) };
}

// The same, in words for the person who typed them.
export function worldSetupProblems(left: WorldSetupLeft): string[] {
  return [
    ...(left.houseRules.trim() ? ["The house rules did not save."] : []),
    ...left.loreDrafts.map((draft) => `The lore entry "${draft.title.trim()}" did not save.`),
  ];
}

export function WorldSetupFields({
  houseRules,
  setHouseRules,
  loreDrafts,
  setLoreDrafts,
  collapsible = true,
}: {
  houseRules: string;
  setHouseRules: (text: string) => void;
  loreDrafts: LoreDraft[];
  setLoreDrafts: (drafts: LoreDraft[]) => void;
  // Off where the fields already sit in a named group of their own (the
  // creator's "House rules, lore and prep"): no second toggle inside it.
  collapsible?: boolean;
}) {
  const [toggled, setOpen] = useState(false);
  const open = toggled || !collapsible;
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
    <div className={collapsible ? "rounded-lg border border-stone-800 bg-stone-950/40" : undefined}>
      {collapsible ? (
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
      ) : null}
      {open ? (
        <div className={collapsible ? "space-y-3 border-t border-stone-800/70 p-3" : "space-y-3"}>
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
              The DM is reminded of the relevant rules each turn. Editable later in the table&apos;s Settings.
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
                    <Select<WorldLoreCategory>
                      value={draft.category}
                      onChange={(category) => patchDraft(index, { category })}
                      label="Lore category"
                      className="w-32 shrink-0"
                      options={WORLD_LORE_CATEGORIES.map((category) => ({ value: category, label: CATEGORY_LABELS[category] }))}
                    />
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
