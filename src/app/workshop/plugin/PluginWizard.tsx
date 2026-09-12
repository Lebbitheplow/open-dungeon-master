"use client";

import { useState } from "react";
import { Wizard } from "@/components/ui/Wizard";
import type { WorldPackDraft } from "@/lib/worlds/draft";
import { NameFields, OriginFields, VoiceFields, WorldFields } from "@/app/workshop/plugin/IdentityFields";

// Guided setup: the identity of a world pack, one question at a time. The
// steps are the same four field groups the Identity tab shows together; the
// wizard only orders them and asks the last question, whether to pull the
// workshop's own lore into the pack before the person starts on the tables.
//
// The draft edits land as they are typed (the panel autosaves them), so
// closing the wizard halfway loses nothing and the Identity tab shows
// exactly where the person stopped.

export function PluginWizard({
  draft,
  onDraft,
  onDone,
  onCancel,
}: {
  draft: WorldPackDraft;
  onDraft: (next: WorldPackDraft) => void;
  onDone: (pull: boolean) => void;
  onCancel: () => void;
}) {
  const [pull, setPull] = useState(true);
  const props = { draft, onDraft };
  return (
    <Wizard
      title="Set up the world"
      doneLabel="Start building"
      onDone={() => onDone(pull)}
      onCancel={onCancel}
      steps={[
        {
          key: "name",
          title: "What is it called?",
          blurb: "The name and the line under it are what a table sees when it picks a world.",
          content: <NameFields {...props} />,
          canContinue: Boolean(draft.name.trim() && draft.blurb.trim()),
        },
        {
          key: "origins",
          title: "Whose world is it?",
          blurb: "An original world leaves the rights holder empty. A homage names who owns the setting, and every surface that shows the pack says so.",
          content: <OriginFields {...props} />,
          canContinue: Boolean(draft.inspiredBy.trim()),
        },
        {
          key: "world",
          title: "What kind of world?",
          blurb: "The base genre keeps every genre-aware tool working; the theme seeds each new campaign.",
          content: <WorldFields {...props} />,
          canContinue: Boolean(draft.theme.trim()),
        },
        {
          key: "voice",
          title: "How should the narrator sound?",
          blurb: "The brief is the highest-leverage field in the pack. Tone, what magic feels like, what the stakes are, what the narrator must never do.",
          content: <VoiceFields {...props} />,
        },
        {
          key: "fill",
          title: "Fill it from the workshop?",
          blurb: "The lore, places, hook cards and cast already built in this workshop can become the pack's factions, places, hooks, glossary and name seeds.",
          content: (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-stone-800 p-3 text-sm text-stone-300">
              <input
                type="checkbox"
                checked={pull}
                onChange={(event) => setPull(event.target.checked)}
                className="mt-0.5 accent-amber-400"
              />
              <span>
                Pull from this workshop now.
                <span className="mt-1 block text-[11px] text-stone-500">
                  It adds to the pack and never overwrites; you can run it again from the header any time.
                </span>
              </span>
            </label>
          ),
        },
      ]}
    />
  );
}
