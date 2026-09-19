"use client";

import { ChevronDown, EyeOff, Pin, Presentation, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { RowMenu } from "@/app/workshop/kit";
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
    <p className="flex flex-wrap items-center gap-1 text-[11px] text-stone-500">
      Mentioned in
      {mentions.map((mention) => (
        <button
          key={`${mention.kind}-${mention.id}`}
          type="button"
          disabled={mention.kind !== "lore"}
          onClick={() => onOpen({ kind: "lore", id: mention.id, name: mention.name })}
          className={cn(ui.btnSmall, "px-2 py-1 disabled:cursor-default")}
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
  // The same doors the opened entry shows as buttons, for a right-click, a
  // long press or the kebab, so an entry can be pinned without opening it.
  const items: ContextMenuItem[] = [
    { id: "read", label: expanded ? "Close" : "Read", glyph: "system-lore", onSelect: () => setExpanded((current) => !current) },
    ...(onShow ? [{ id: "show", label: "Show this now", glyph: "tab-handout", onSelect: onShow }] : []),
    ...(steersStory
      ? [
          { id: "edit", label: "Edit", glyph: "tab-notes", onSelect: onEdit },
          { id: "pin", label: entry.pinned ? "Unpin" : "Pin", glyph: "quest-active", onSelect: onPin },
          { id: "duplicate", label: "Duplicate", glyph: "tab-journal", onSelect: onDuplicate },
          { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger" as const, separated: true, onSelect: onDelete },
        ]
      : []),
  ];
  return (
    <ContextMenu as="li" label={entry.title} items={items} className="panel rounded-lg p-2">
      <div className="flex items-center gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left"
      >
        <GameIcon icon={{ kind: "glyph", key: entry.visibility === "dm" ? "quest-hidden" : "system-lore" }} size="size-7" />
        {entry.pinned ? <Pin className="size-3 shrink-0 text-amber-400" /> : null}
        {entry.visibility === "dm" ? <EyeOff className="size-3 shrink-0 text-violet-300" /> : null}
        {entry.audience?.length ? <Users className="size-3 shrink-0 text-sky-300" /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-200">
          {entry.title}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-stone-500 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
      </button>
      {items.length > 2 ? <RowMenu items={items} label={entry.title} /> : null}
      </div>
      {expanded ? (
        <div className="reveal mt-2 space-y-2">
          <LoreBody entry={entry} targets={targets} onLink={onLink} dmView={steersStory} />
          {entry.tags.length ? (
            <p className="reveal text-[11px] text-stone-500">{entry.tags.join(" · ")}</p>
          ) : null}
          <MentionedIn campaignId={campaignId} entryId={entry.id} onOpen={onLink} />
          {onShow ? (
            <button
              type="button"
              onClick={onShow}
              className={cn(ui.btnSecondary, "h-9")}
            >
              <Presentation className="size-3.5" /> Show this now
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
    </ContextMenu>
  );
}
