"use client";

import { useState, type ReactNode } from "react";
import { AddFromList } from "@/components/ui/AddFromList";
import { useAutosave, type SaveState } from "@/lib/use-autosave";
import { mapInput } from "@/app/campaigns/[campaignId]/mapUi";
import { PanelHead } from "@/app/campaigns/[campaignId]/mapUi";
import type { PreparedMap } from "@/app/workshop/maps/types";

// The words on a prepared map: name, tags and notes, saved on their own
// 700 ms after the last keystroke (docs/vtt-parity-implementation-plan.md
// section 10.4). One autosave over all three, held by a hook so the name can
// sit in the editor's top bar while the tags and the notes sit in the details
// panel and they still travel in one request. The editor is mounted keyed by
// map id, so a different map starts from its own saved words.

type Words = { name: string; tags: string[]; notes: string };

export type MapWords = {
  words: Words;
  tagText: string;
  state: SaveState;
  flush: () => Promise<unknown> | void;
  setName: (name: string) => void;
  setNotes: (notes: string) => void;
  setTagText: (text: string) => void;
  setTags: (tags: string[]) => void;
};

export function useMapWords(selected: PreparedMap, patch: (body: Record<string, unknown>) => Promise<boolean>): MapWords {
  const [words, setWords] = useState<Words>({ name: selected.name, tags: selected.tags, notes: selected.notes });
  const [tagText, setTagTextState] = useState(selected.tags.join(", "));
  const { state, flush } = useAutosave(words, {
    key: selected.id,
    save: async (value) => {
      const name = value.name.trim() || selected.name;
      return patch({ name, tags: value.tags, notes: value.notes });
    },
  });
  return {
    words,
    tagText,
    state,
    flush,
    setName: (name) => setWords((current) => ({ ...current, name })),
    setNotes: (notes) => setWords((current) => ({ ...current, notes })),
    setTagText: (text) => {
      setTagTextState(text);
      const tags = text
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      setWords((current) => ({ ...current, tags }));
    },
    setTags: (tags) => {
      setWords((current) => ({ ...current, tags }));
      setTagTextState(tags.join(", "));
    },
  };
}

// The name, for the editor's top bar.
export function MapNameField({ words }: { words: MapWords }) {
  return (
    // The field takes its face from this wrapper: the app resets `font` on inputs.
    <span className="min-w-0 flex-1 font-display text-[15px]">
    <input
      value={words.words.name}
      aria-label="Map name"
      maxLength={80}
      onChange={(event) => words.setName(event.target.value)}
      onBlur={() => void words.flush()}
      className="w-full truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 uppercase tracking-[0.08em] text-amber-100 outline-none hover:border-stone-700 focus:border-amber-400/60 focus:bg-stone-950"
    />
    </span>
  );
}

// Tags, notes and the dials that came through as children (theme, light,
// what it sounds like), in the right column.
export function MapDetailsPanel({ words, knownTags, children }: { words: MapWords; knownTags: string[]; children?: ReactNode }) {
  return (
    <section className="space-y-2">
      <PanelHead>Details</PanelHead>
      {children}
      <div className="space-y-1">
        <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Tags</span>
        <input
          value={words.tagText}
          aria-label="Tags"
          placeholder="Tags, comma separated: crypt, undead, act two"
          onChange={(event) => words.setTagText(event.target.value)}
          onBlur={() => void words.flush()}
          className={mapInput}
        />
        <AddFromList
          prompt="Add a tag you already use"
          options={knownTags.filter((tag) => !words.words.tags.includes(tag))}
          onPick={(tag) => words.setTags([...words.words.tags, tag])}
        />
      </div>
      <div className="space-y-1">
        <span className="font-display text-[9px] uppercase tracking-[0.18em] text-stone-500">Notes</span>
        <textarea
          value={words.words.notes}
          aria-label="Notes"
          maxLength={4000}
          onChange={(event) => words.setNotes(event.target.value)}
          onBlur={() => void words.flush()}
          rows={3}
          placeholder="What lives here. Nobody but you reads this."
          className={mapInput}
        />
      </div>
    </section>
  );
}
