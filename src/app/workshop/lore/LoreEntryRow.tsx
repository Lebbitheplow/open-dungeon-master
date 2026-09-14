"use client";

import { EyeOff, Pin, Presentation, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { LoreLinkTarget, LoreMention } from "@/lib/dm/world-lore-logic";
import { LoreEntryActions } from "@/app/workshop/lore/LoreEntryActions";
import { LoreBody } from "@/app/workshop/lore/LoreFields";
import type { LoreEntryView } from "@/app/workshop/lore/types";

// One entry in the campaign's binder list, and the "Mentioned in" line
// under an opened entry (docs/vtt-parity-implementation-plan.md 5.4).

// "Mentioned in" (section 5.4): everything that links this entry, fetched
// when the entry is opened.
export function MentionedIn({
  campaignId,
  entryId,
  onOpen,
}: {
  campaignId: string;
  entryId: string;
  onOpen: (target: LoreLinkTarget) => void;
}) {
  const [mentions, setMentions] = useState<LoreMention[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/lore/${entryId}/backlinks`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { mentions?: LoreMention[] } | null) => {
        if (!cancelled) {
          setMentions(data?.mentions ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, entryId]);
  if (!mentions?.length) {
    return null;
  }
  return (
    <p className="flex flex-wrap items-center gap-1 text-[10px] text-stone-500">
      Mentioned in
      {mentions.map((mention) => (
        <button
          key={`${mention.kind}-${mention.id}`}
          type="button"
          disabled={mention.kind !== "lore"}
          onClick={() => onOpen({ kind: "lore", id: mention.id, name: mention.name })}
          className="rounded border border-stone-800 px-1.5 py-0.5 text-stone-400 enabled:hover:text-amber-200 disabled:cursor-default"
          title={mention.kind}
        >
          {mention.name}
        </button>
      ))}
    </p>
  );
}

export function LoreEntryRow({
  entry,
  steersStory,
  targets,
  onLink,
  campaignId,
  onShow,
  onEdit,
  onPin,
  onDuplicate,
  onDelete,
}: {
  entry: LoreEntryView;
  steersStory: boolean;
  targets: LoreLinkTarget[];
  onLink: (target: LoreLinkTarget) => void;
  campaignId: string;
  onShow?: () => void;
  onEdit: () => void;
  onPin: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="rounded border border-stone-800/70 bg-stone-950/40 p-1.5">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-1.5 text-left"
      >
        {entry.pinned ? <Pin className="size-3 shrink-0 text-amber-400" /> : null}
        {entry.visibility === "dm" ? <EyeOff className="size-3 shrink-0 text-violet-300" /> : null}
        {entry.audience?.length ? <Users className="size-3 shrink-0 text-sky-300" /> : null}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-stone-300">
          {entry.title}
        </span>
      </button>
      {expanded ? (
        <div className="mt-1 space-y-1">
          <LoreBody entry={entry} targets={targets} onLink={onLink} dmView={steersStory} />
          {entry.tags.length ? (
            <p className="text-[10px] text-stone-600">{entry.tags.join(" · ")}</p>
          ) : null}
          <MentionedIn campaignId={campaignId} entryId={entry.id} onOpen={onLink} />
          {onShow ? (
            <button
              type="button"
              onClick={onShow}
              className="flex items-center gap-1 rounded border border-amber-800/70 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-100 hover:bg-amber-900/40"
            >
              <Presentation className="size-3" /> Show this now
            </button>
          ) : null}
          {steersStory ? (
            <LoreEntryActions
              entry={entry}
              onEdit={onEdit}
              onPin={onPin}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
