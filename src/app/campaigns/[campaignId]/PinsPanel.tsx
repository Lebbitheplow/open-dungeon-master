"use client";

import { EmptyState } from "@/components/EmptyState";
import { Pin, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { SectionHead } from "@/components/ui/SectionHead";
import { cn } from "@/lib/cn";
import { KitButton, RowMenu, panelRow } from "./PanelKit";
import { PIN_TOKEN_CAP, pinTokens, totalPinTokens } from "@/lib/dm/pin-logic";

// Pinned memories: excerpts that ride in every prompt, unconditionally.
//
// The gauge is the point of the panel, following NE-P's PinnedMemoriesPanel:
// pins are the one memory mechanism with no eviction, so the table needs to
// see how much of the budget they have spent before the next pin is refused.
// NE-P colours it amber at 70 percent and red at 90; same thresholds here.

type PinRow = {
  id: string;
  messageId: string;
  text: string;
  isFullMessage: boolean;
  createdAt: string;
};

const COLLAPSE_AT = 160;

function PinItem({ pin, onUnpin }: { pin: PinRow; onUnpin: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const long = pin.text.length > COLLAPSE_AT;
  const shown = !expanded && long ? `${pin.text.slice(0, COLLAPSE_AT)}...` : pin.text;

  const jump = () => {
    document.querySelector(`[data-message-id="${pin.messageId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };
  const items: ContextMenuItem[] = [
    { id: "jump", label: "Jump to message", glyph: "tab-log", onSelect: jump },
    ...(long ? [{ id: "expand", label: expanded ? "Show less" : "Show more", glyph: "tab-notes", onSelect: () => setExpanded((value) => !value) }] : []),
    { id: "unpin", label: "Unpin", glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => onUnpin(pin.id) },
  ];

  return (
    <ContextMenu as="li" items={items} label={pin.isFullMessage ? "Full message" : "Excerpt"} className={panelRow}>
      <div className="mb-1 flex items-center gap-1.5">
        <Pin className="size-3.5 shrink-0 text-amber-400" />
        <span className="eyebrow text-[10px] text-amber-300/80">
          {pin.isFullMessage ? "Full message" : "Excerpt"}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-stone-500">
          {pinTokens(pin.text)}t
        </span>
        <KitButton tone="iconDanger" onClick={() => onUnpin(pin.id)} aria-label="Unpin" className="-my-1 shrink-0">
          <Trash2 className="size-3.5" />
        </KitButton>
        <RowMenu items={items} label={pin.isFullMessage ? "Full message" : "Excerpt"} className="-my-1" />
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-stone-300">
        {shown}
      </p>
      <div className="mt-1 flex gap-3">
        {long ? (
          <KitButton tone="link" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Show less" : "Show more"}
          </KitButton>
        ) : null}
        <KitButton tone="link" onClick={jump}>
          Jump to message
        </KitButton>
      </div>
    </ContextMenu>
  );
}

export function PinsPanel({ campaignId, version }: { campaignId: string; version: number }) {
  const [pins, setPins] = useState<PinRow[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/pins`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setPins(data.pins ?? []);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [campaignId, reload, version]);

  const unpin = useCallback(
    async (pinId: string) => {
      await fetch(`/api/campaigns/${campaignId}/pins`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinId }),
      });
      setReload((count) => count + 1);
    },
    [campaignId],
  );

  const used = totalPinTokens(pins);
  const pct = Math.min(100, Math.round((used / PIN_TOKEN_CAP) * 100));

  return (
    <div className="space-y-2">
      <SectionHead
        title="Pinned memories"
        glyph="tab-facts"
        aside={
          <span
            className={cn(
              "font-mono text-[11px]",
              used >= PIN_TOKEN_CAP * 0.9 ? "text-red-400" : used >= PIN_TOKEN_CAP * 0.7 ? "text-amber-400" : "text-stone-500",
            )}
          >
            {used.toLocaleString()} / {PIN_TOKEN_CAP.toLocaleString()}
          </span>
        }
      />
      <div className="h-1.5 overflow-hidden rounded-full bg-stone-800" role="meter" aria-label="Pin budget used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div
          className={cn(
            "bar-ease h-full rounded-full",
            used >= PIN_TOKEN_CAP * 0.9
              ? "bg-red-500"
              : used >= PIN_TOKEN_CAP * 0.7
                ? "bg-amber-400"
                : "bg-amber-500/60",
          )}
          style={{ width: `${Math.max(1, pct)}%` }}
        />
      </div>

      {pins.length ? (
        <ul className="stagger space-y-1.5">
          {pins.map((pin) => (
            <PinItem key={pin.id} pin={pin} onUnpin={unpin} />
          ))}
        </ul>
      ) : (
        <EmptyState size="sm" art="board" title="Nothing pinned. Select text in one of the DM's messages and press the pin icon to put it in front of the DM every turn, whether or not it looks relevant." />
      )}
    </div>
  );
}
