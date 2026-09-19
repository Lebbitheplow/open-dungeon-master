"use client";

import { EmptyState } from "@/components/EmptyState";
import { Check, EyeOff, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import type { Quest, QuestStatus } from "@/lib/dm/quest-logic";
import { GlyphChip, KitButton, PanelLoading, Tick, TickMark, panelField, panelRow } from "./PanelKit";

// The quest log (docs/vtt-parity-implementation-plan.md 5.7): what the
// arc compiled and what the DM wrote, with objectives the DM ticks by
// hand. Players read the party's; the DM's own rows are marked.

const STATUS_LABEL: Record<QuestStatus, string> = { active: "Active", done: "Done", failed: "Failed", hidden: "Hidden" };
const STATUS_GLYPH: Record<QuestStatus, string> = { active: "quest-active", done: "quest-done", failed: "quest-failed", hidden: "quest-hidden" };
const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as QuestStatus[]).map((status) => ({
  value: status,
  label: STATUS_LABEL[status],
  icon: { kind: "glyph" as const, key: STATUS_GLYPH[status] },
}));

export function QuestsPanel({ campaignId, steersStory, refreshKey }: { campaignId: string; steersStory: boolean; refreshKey: number }) {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState("");
  const [busy, setBusy] = useState(false);

  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/quests`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { quests?: Quest[] }) => {
        if (!cancelled) {
          setQuests(data.quests ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuests([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refreshKey, reload]);

  async function patch(questId: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/campaigns/${campaignId}/quests/${questId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { quest?: Quest };
    if (data.quest) {
      const next = data.quest;
      setQuests((current) => (current ?? []).map((quest) => (quest.id === next.id ? next : quest)));
    }
  }

  async function add() {
    if (!title.trim()) {
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/quests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, objectives: lines.split("\n").map((line) => line.trim()).filter(Boolean) }),
      });
      if (response.ok) {
        setTitle("");
        setLines("");
        setAdding(false);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(quest: Quest) {
    if (!(await appConfirm(`Take "${quest.title}" off the log?`, { actionLabel: "Take it off", tone: "danger" }))) {
      return;
    }
    await fetch(`/api/campaigns/${campaignId}/quests/${quest.id}`, { method: "DELETE" });
    setQuests((current) => (current ?? []).filter((entry) => entry.id !== quest.id));
  }

  if (quests === null) {
    return <PanelLoading label="Opening the log..." />;
  }
  const active = quests.filter((quest) => quest.status === "active");
  const settled = quests.filter((quest) => quest.status !== "active");
  return (
    <div className="space-y-2">
      <SectionHead
        title="Quest log"
        glyph="tab-quests"
        aside={
          steersStory && !adding ? (
            <KitButton onClick={() => setAdding(true)}>
              <Plus className="size-3.5" /> Write one
            </KitButton>
          ) : quests.length ? (
            <span className="text-[11px] text-stone-500">{active.length} active</span>
          ) : null
        }
      />
      {adding ? (
        <div className="panel reveal space-y-1.5 rounded-lg p-2.5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="Find the miller's daughter"
            aria-label="Quest title"
            className={panelField}
          />
          <textarea
            value={lines}
            onChange={(event) => setLines(event.target.value)}
            rows={3}
            placeholder={"Objectives, one per line:\nAsk at the mill\nSearch the weir"}
            aria-label="Objectives, one per line"
            className={cn(panelField, "leading-5")}
          />
          <div className="flex gap-1.5">
            <KitButton tone="primary" disabled={busy || !title.trim()} busy={busy} onClick={() => void add()}>
              {busy ? null : <Check className="size-3.5" />} Add
            </KitButton>
            <KitButton onClick={() => setAdding(false)}>
              <X className="size-3.5" /> Cancel
            </KitButton>
          </div>
        </div>
      ) : null}
      {!quests.length ? <EmptyState size="sm" art="scrolls" title="Nothing on the log yet." /> : null}
      <ul className="stagger space-y-1.5">
        {[...active, ...settled].map((quest) => (
          <QuestRow key={quest.id} quest={quest} steersStory={steersStory} onPatch={(body) => void patch(quest.id, body)} onRemove={() => void remove(quest)} />
        ))}
      </ul>
    </div>
  );
}

function QuestRow({
  quest,
  steersStory,
  onPatch,
  onRemove,
}: {
  quest: Quest;
  steersStory: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const done = quest.objectives.filter((objective) => objective.done).length;
  // The same doors as the row's own controls, for a right-click or a long press.
  const items: ContextMenuItem[] = steersStory
    ? [
        ...(Object.keys(STATUS_LABEL) as QuestStatus[]).map((status) => ({
          id: status,
          label: `Mark ${STATUS_LABEL[status].toLowerCase()}`,
          glyph: STATUS_GLYPH[status],
          disabled: quest.status === status,
          onSelect: () => onPatch({ status }),
        })),
        ...(quest.source === "dm"
          ? [{ id: "remove", label: "Take it off the log", glyph: "quest-failed", tone: "danger" as const, separated: true, onSelect: onRemove }]
          : []),
      ]
    : [];
  return (
    <ContextMenu as="li" items={items} label={quest.title} className={cn(panelRow, quest.status !== "active" && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <GameIcon icon={{ kind: "glyph", key: STATUS_GLYPH[quest.status] }} size="size-6" className="shrink-0" />
        {quest.visibility === "dm" ? <EyeOff className="size-3.5 shrink-0 text-violet-300" aria-label="DM only" /> : null}
        <span className="min-w-[9rem] flex-1 text-sm font-medium leading-5 text-stone-100">{quest.title}</span>
        {quest.objectives.length ? (
          <span key={done} className="count-pop text-[11px] tabular-nums text-stone-400">
            {done}/{quest.objectives.length}
          </span>
        ) : null}
        {steersStory ? (
          <Select<QuestStatus>
            value={quest.status}
            onChange={(status) => onPatch({ status })}
            options={STATUS_OPTIONS}
            label="Status"
            size="sm"
            align="end"
            className="pk-w-26"
          />
        ) : (
          <GlyphChip glyph={STATUS_GLYPH[quest.status]}>{STATUS_LABEL[quest.status]}</GlyphChip>
        )}
        {steersStory && quest.source === "dm" ? (
          <KitButton tone="iconDanger" always onClick={onRemove} aria-label="Take it off the log">
            <Trash2 className="size-3.5" />
          </KitButton>
        ) : null}
      </div>
      {quest.objectives.length ? (
        <ul className="reveal mt-1.5 space-y-1">
          {quest.objectives.map((objective) => (
            <li key={objective.id} className="flex items-center gap-2 text-xs">
              {steersStory ? (
                <Tick
                  checked={objective.done}
                  label={`Done: ${objective.text}`}
                  onChange={(checked) =>
                    onPatch({
                      objectives: quest.objectives.map((entry) => (entry.id === objective.id ? { ...entry, done: checked } : entry)),
                    })
                  }
                />
              ) : (
                <TickMark checked={objective.done} />
              )}
              <span className={cn(objective.done ? "text-stone-500 line-through" : "text-stone-300")}>{objective.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {quest.source === "arc" ? <p className="reveal mt-1 text-[11px] text-stone-500">From the story</p> : null}
    </ContextMenu>
  );
}
