"use client";

import { Loader2, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { crLabel } from "@/lib/bestiary/derive-cr";
import { addToRoster, formatRoster, parseRoster } from "@/lib/dm/encounter-template-logic";

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

const chip = "rounded-full border px-2 py-0.5 text-[10px] transition-colors duration-150";

// Filling a roster by looking rather than by remembering.
//
// The prepared-encounter box takes the same shorthand the console's "Start a
// fight" takes, which is right, and which also means a DM has to already
// know that a bullywug exists and how it is spelled. This searches what this
// world actually holds (the content pack and every monster this DM has
// built) and appends the pick to the roster the person is writing, leaving
// every line of it typeable.
export function MonsterRosterPicker({
  campaignId,
  roster,
  onChange,
}: {
  campaignId: string;
  roster: string;
  onChange: (roster: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ slug: string; name: string; cr: number }>>([]);
  const [loading, setLoading] = useState(false);

  // Debounced so a search fires on the pause, not the keystroke. Everything
  // that touches state happens in the timer or in a .then, never in the
  // effect body, so this reads to React as subscribing to an external system
  // rather than as a render that sets state.
  useEffect(() => {
    const term = query.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (term.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      fetch(`/api/campaigns/${campaignId}/dm/bestiary?q=${encodeURIComponent(term)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then(
          (
            payload: {
              found: Array<{ slug: string; name: string; cr: number }>;
              monsters: Array<{ draft: { name: string; stats: { cr: number } }; slug: string }>;
            } | null,
          ) => {
            if (cancelled || !payload) {
              return;
            }
            // The DM's own monsters first: a boss built in this workshop is
            // the one they came looking for.
            const mine = payload.monsters
              .filter((monster) =>
                monster.draft.name.toLowerCase().includes(term.toLowerCase()),
              )
              .map((monster) => ({
                slug: monster.slug,
                name: monster.draft.name,
                cr: monster.draft.stats.cr,
              }));
            setResults([...mine, ...payload.found].slice(0, 24));
          },
        )
        .catch(() => {
          // transient; the next keystroke retries
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [campaignId, query]);

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-stone-600" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search monsters to add: goblin, owlbear, the boss you built..."
          className={cn(input, "w-full pl-7")}
        />
        {loading ? (
          <Loader2 className="absolute right-2 top-1.5 size-3.5 animate-spin text-stone-600" />
        ) : null}
      </div>
      {results.length ? (
        <div className="flex flex-wrap gap-1">
          {results.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              onClick={() => onChange(formatRoster(addToRoster(parseRoster(roster), entry.name)))}
              className={cn(chip, "border-stone-700 text-stone-400 hover:text-amber-100")}
            >
              <Plus className="mr-0.5 inline size-2.5" />
              {entry.name}
              <span className="ml-1 text-stone-600">CR {crLabel(entry.cr)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

