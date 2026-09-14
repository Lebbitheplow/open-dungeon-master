"use client";

import { useState, type ReactNode } from "react";
import { AddFromList } from "@/components/ui/AddFromList";
import { SaveBadge } from "@/components/ui/SaveBadge";
import { useAutosave } from "@/lib/use-autosave";
import type { PreparedMap } from "@/app/workshop/maps/types";

// The words on a prepared map: name, tags and notes, saved on their own
// 700 ms after the last keystroke with the status beside the name
// (docs/vtt-parity-implementation-plan.md section 10.4). Mounted keyed by
// map id, so a different map starts from its own saved words. The dials
// (theme, light) come through as children and still save on change.

type Words = { name: string; tags: string[]; notes: string };

export function MapDetails({
  selected,
  patch,
  knownTags,
  children,
}: {
  selected: PreparedMap;
  patch: (body: Record<string, unknown>) => Promise<boolean>;
  knownTags: string[];
  children?: ReactNode;
}) {
  const [words, setWords] = useState<Words>({ name: selected.name, tags: selected.tags, notes: selected.notes });
  const [tagText, setTagText] = useState(selected.tags.join(", "));
  const { state, flush } = useAutosave(words, {
    key: selected.id,
    save: async (value) => {
      const name = value.name.trim() || selected.name;
      return patch({ name, tags: value.tags, notes: value.notes });
    },
  });
  const setTags = (tags: string[]) => {
    setWords((current) => ({ ...current, tags }));
    setTagText(tags.join(", "));
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={words.name}
          aria-label="Map name"
          onChange={(event) => setWords((current) => ({ ...current, name: event.target.value }))}
          onBlur={() => void flush()}
          className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
        />
        <SaveBadge state={state} />
        {children}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={tagText}
          aria-label="Tags"
          placeholder="Tags, comma separated: crypt, undead, act two"
          onChange={(event) => {
            setTagText(event.target.value);
            const tags = event.target.value
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean);
            setWords((current) => ({ ...current, tags }));
          }}
          onBlur={() => void flush()}
          className="min-w-40 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />
        <AddFromList
          prompt="Add a tag you already use"
          options={knownTags.filter((tag) => !words.tags.includes(tag))}
          onPick={(tag) => setTags([...words.tags, tag])}
        />
      </div>
      <textarea
        value={words.notes}
        aria-label="Notes"
        onChange={(event) => setWords((current) => ({ ...current, notes: event.target.value }))}
        onBlur={() => void flush()}
        rows={2}
        placeholder="What lives here. Nobody but you reads this."
        className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
      />
    </>
  );
}
