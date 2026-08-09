"use client";

import { Check, Loader2, Merge, Pencil, Users, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { MAX_NPC_NAME } from "@/lib/dm/entity-review-logic";

// Lead-only NPC roster hygiene.
//
// entity-logic.ts resolves exact and containment matches on its own and
// refuses to resolve fuzzy ones, on the grounds that "Aldric" and "Alaric"
// are one typo apart and may well be two different people. This is where a
// human settles it. Nothing here is automatic.

type ReviewNpc = {
  id: string;
  name: string;
  aliases: string[];
  attitude: string;
  location: string;
  archived: boolean;
};

type Suggestion = { name: string; matches: string };

export function NpcReviewPanel({ campaignId }: { campaignId: string }) {
  const [npcs, setNpcs] = useState<ReviewNpc[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const url = `/api/campaigns/${campaignId}/npcs/review`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setNpcs(data.npcs ?? []);
        setSuggestions(data.suggestions ?? []);
      }
    } finally {
      setLoaded(true);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error ?? "That did not go through.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("That did not go through.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [url, load],
  );

  const byName = (name: string) => npcs.find((npc) => npc.name === name);

  async function submitRename(npcId: string) {
    const name = draft.trim();
    if (!name) {
      return;
    }
    if (await act({ action: "rename", npcId, name })) {
      setRenaming(null);
      setDraft("");
    }
  }

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 p-3 text-xs text-stone-500">
        <Loader2 className="size-3.5 animate-spin" /> Loading...
      </p>
    );
  }

  return (
    <div className="space-y-3 p-3">
      <div>
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <Users className="size-3.5 text-amber-300" /> NPC roster
        </p>
        <p className="mt-1 text-[11px] leading-4 text-stone-500">
          The DM rarely spells a name the same way twice over fifty turns. Close matches are
          flagged here rather than merged for you, because two similar names are often two
          people. Merging keeps the old spelling as an alias, so nothing already written stops
          resolving.
        </p>
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}

      {suggestions.length ? (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-stone-600">
            Possible duplicates
          </p>
          {suggestions.map((suggestion) => {
            const left = byName(suggestion.name);
            const right = byName(suggestion.matches);
            return (
              <div
                key={`${suggestion.name}|${suggestion.matches}`}
                className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5"
              >
                <p className="text-[11px] leading-4 text-stone-200">
                  <span className="font-medium">{suggestion.name}</span>
                  <span className="text-stone-500"> and </span>
                  <span className="font-medium">{suggestion.matches}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-stone-500">
                  Keep one and fold the other into it, or dismiss if they are two people.
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {left && right ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act({ action: "merge", keepId: left.id, mergeId: right.id })
                        }
                        className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
                      >
                        <Merge className="size-3" /> Keep &ldquo;{left.name}&rdquo;
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void act({ action: "merge", keepId: right.id, mergeId: left.id })
                        }
                        className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
                      >
                        <Merge className="size-3" /> Keep &ldquo;{right.name}&rdquo;
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void act({
                        action: "dismiss",
                        name: suggestion.name,
                        matches: suggestion.matches,
                      })
                    }
                    className={cn(ui.btnSmall, "px-2 py-1 text-[11px]")}
                  >
                    <X className="size-3" /> Different people
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-[11px] leading-4 text-stone-600">
          No close matches to review. New ones appear here as the DM names people.
        </p>
      )}

      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-wide text-stone-600">
          Everyone the campaign is tracking
        </p>
        {!npcs.length ? (
          <p className="text-[11px] text-stone-600">Nobody yet.</p>
        ) : (
          <ul className="space-y-1">
            {npcs.map((npc) => (
              <li
                key={npc.id}
                className="group rounded-lg border border-stone-800 bg-stone-950/40 p-2"
              >
                {renaming === npc.id ? (
                  <div>
                    <input
                      value={draft}
                      autoFocus
                      maxLength={MAX_NPC_NAME}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void submitRename(npc.id);
                        } else if (event.key === "Escape") {
                          setRenaming(null);
                        }
                      }}
                      className={cn(ui.input, "px-2 py-1 text-[11px]")}
                    />
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        disabled={busy || !draft.trim()}
                        onClick={() => void submitRename(npc.id)}
                        className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                      >
                        <Check className="size-3" /> Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenaming(null)}
                        className={cn(ui.btnSmall, "px-2 py-0.5 text-[11px]")}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-4 text-stone-200">
                        {npc.name}
                        {npc.archived ? (
                          <span className="ml-1 text-stone-600">(archived)</span>
                        ) : null}
                      </p>
                      <p className="text-[11px] leading-4 text-stone-500">
                        {npc.attitude}
                        {npc.location ? ` · ${npc.location}` : ""}
                      </p>
                      {npc.aliases.length ? (
                        <p className="mt-0.5 text-[11px] leading-4 text-stone-600">
                          also called {npc.aliases.join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setRenaming(npc.id);
                        setDraft(npc.name);
                        setError("");
                      }}
                      className={cn(ui.iconAction, "p-1")}
                      title="Rename"
                      aria-label={`Rename ${npc.name}`}
                    >
                      <Pencil className="size-3" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
