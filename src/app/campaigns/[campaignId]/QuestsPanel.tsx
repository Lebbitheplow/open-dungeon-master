"use client";

import { Check, EyeOff, Loader2, Plus, ScrollText, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import type { Quest, QuestStatus } from "@/lib/dm/quest-logic";

// The quest log (docs/vtt-parity-implementation-plan.md 5.7): what the
// arc compiled and what the DM wrote, with objectives the DM ticks by
// hand. Players read the party's; the DM's own rows are marked.

const STATUS_LABEL: Record<QuestStatus, string> = { active: "Active", done: "Done", failed: "Failed", hidden: "Hidden" };

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
    return (
      <p className="flex items-center gap-1 text-[11px] text-stone-500">
        <Loader2 className="size-3 animate-spin" /> Opening the log...
      </p>
    );
  }
  const active = quests.filter((quest) => quest.status === "active");
  const settled = quests.filter((quest) => quest.status !== "active");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <ScrollText className="size-3.5 text-amber-600" /> Quest log
        </p>
        {steersStory && !adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900"
          >
            <Plus className="size-3" /> Write one
          </button>
        ) : null}
      </div>
      {adding ? (
        <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/60 p-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            placeholder="Find the miller's daughter"
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
          />
          <textarea
            value={lines}
            onChange={(event) => setLines(event.target.value)}
            rows={3}
            placeholder={"Objectives, one per line:\nAsk at the mill\nSearch the weir"}
            className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] leading-4 outline-none focus:border-amber-600"
          />
          <div className="flex gap-1.5">
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => void add()}
              className="flex items-center gap-1 rounded border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[11px] text-amber-100 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Add
            </button>
            <button type="button" onClick={() => setAdding(false)} className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500">
              <X className="size-3" /> Cancel
            </button>
          </div>
        </div>
      ) : null}
      {!quests.length ? <p className="text-[11px] italic text-stone-600">Nothing on the log yet.</p> : null}
      <ul className="space-y-1.5">
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
  return (
    <li className={cn("rounded border border-stone-800/70 bg-stone-950/40 p-2", quest.status !== "active" && "opacity-70")}>
      <div className="flex items-center gap-1.5">
        {quest.visibility === "dm" ? <EyeOff className="size-3 shrink-0 text-violet-300" /> : null}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-stone-200">{quest.title}</span>
        {quest.objectives.length ? (
          <span className="text-[10px] text-stone-500">
            {done}/{quest.objectives.length}
          </span>
        ) : null}
        {steersStory ? (
          <select
            value={quest.status}
            onChange={(event) => onPatch({ status: event.target.value })}
            aria-label="Status"
            className="rounded border border-stone-700 bg-stone-900 px-1 py-0.5 text-[10px] text-stone-300"
          >
            {(Object.keys(STATUS_LABEL) as QuestStatus[]).map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{STATUS_LABEL[quest.status]}</span>
        )}
        {steersStory && quest.source === "dm" ? (
          <button type="button" onClick={onRemove} aria-label="Take it off the log" className="rounded p-1 text-stone-600 hover:text-red-300">
            <Trash2 className="size-3" />
          </button>
        ) : null}
      </div>
      {quest.objectives.length ? (
        <ul className="mt-1 space-y-0.5">
          {quest.objectives.map((objective) => (
            <li key={objective.id} className="flex items-center gap-1.5 text-[11px]">
              {steersStory ? (
                <input
                  type="checkbox"
                  checked={objective.done}
                  aria-label={`Done: ${objective.text}`}
                  onChange={(event) =>
                    onPatch({
                      objectives: quest.objectives.map((entry) => (entry.id === objective.id ? { ...entry, done: event.target.checked } : entry)),
                    })
                  }
                  className="accent-amber-400"
                />
              ) : (
                <span className={cn("size-3 rounded-sm border", objective.done ? "border-amber-500 bg-amber-500/70" : "border-stone-600")} />
              )}
              <span className={cn(objective.done ? "text-stone-500 line-through" : "text-stone-300")}>{objective.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {quest.source === "arc" ? <p className="mt-0.5 text-[10px] text-stone-600">From the story</p> : null}
    </li>
  );
}
