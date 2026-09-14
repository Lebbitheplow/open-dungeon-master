"use client";

import { Flag, Loader2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import { FACTION_ATTITUDES, REPUTATION_MAX, REPUTATION_MIN, reputationLabel, type FactionAttitude } from "@/lib/dm/faction-logic";

// Factions (docs/vtt-parity-implementation-plan.md section 6): a card per
// faction with its crest, its stance, the party's standing on a ladder
// and the members drawn from the cast. Whoever steers the story edits;
// goal and power are theirs alone.

export type FactionView = {
  id: string;
  name: string;
  blurb: string;
  attitude: FactionAttitude;
  tags: string[];
  portraitPath: string;
  standing: number;
  standingLabel: string;
  members: Array<{ id: string; name: string; portraitUrl: string }>;
  goal?: string;
  power?: number;
};

type Draft = { name: string; blurb: string; goal: string; attitude: FactionAttitude; power: number; tags: string; portraitPath: string };

const blank = (): Draft => ({ name: "", blurb: "", goal: "", attitude: "neutral", power: 1, tags: "", portraitPath: "" });

const chip = "rounded-md border px-2 py-0.5 text-[11px]";
const on = "border-amber-700 bg-amber-950/40 text-amber-100";
const off = "border-stone-700 text-stone-400 hover:text-stone-200";

export function FactionsPanel({ campaignId, steersStory, refreshKey = 0 }: { campaignId: string; steersStory: boolean; refreshKey?: number }) {
  const [factions, setFactions] = useState<FactionView[] | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/factions`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: { factions?: FactionView[] }) => {
        if (!cancelled) {
          setFactions(data.factions ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFactions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refreshKey, reload]);

  function startEdit(faction: FactionView) {
    setDraft({
      name: faction.name,
      blurb: faction.blurb,
      goal: faction.goal ?? "",
      attitude: faction.attitude,
      power: faction.power ?? 1,
      tags: faction.tags.join(", "),
      portraitPath: faction.portraitPath,
    });
    setEditing(faction.id);
  }

  async function save() {
    if (!draft.name.trim()) {
      return;
    }
    setBusy(true);
    try {
      const body = { ...draft, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
      const response =
        editing === "new"
          ? await fetch(`/api/campaigns/${campaignId}/factions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
          : await fetch(`/api/campaigns/${campaignId}/factions/${editing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.ok) {
        setEditing(null);
        setReload((current) => current + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(faction: FactionView) {
    if (!(await appConfirm(`Take ${faction.name} out of the world?`, { actionLabel: "Take them out", tone: "danger" }))) {
      return;
    }
    await fetch(`/api/campaigns/${campaignId}/factions/${faction.id}`, { method: "DELETE" });
    setReload((current) => current + 1);
  }

  async function setStanding(faction: FactionView, standing: number) {
    await fetch(`/api/campaigns/${campaignId}/factions/${faction.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ standing }),
    });
    setReload((current) => current + 1);
  }

  if (factions === null) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-stone-500">
        <Loader2 className="size-3 animate-spin" /> Reading the banners...
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <Flag className="size-3.5 text-amber-600" /> Factions
        </p>
        {steersStory && editing === null ? (
          <button
            type="button"
            onClick={() => {
              setDraft(blank());
              setEditing("new");
            }}
            className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:bg-stone-900"
          >
            <Plus className="size-3" /> Add one
          </button>
        ) : null}
      </div>
      {editing !== null ? (
        <div className="space-y-1.5 rounded border border-stone-800 bg-stone-950/60 p-2">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} placeholder="The Reed Court" className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600" />
          <textarea value={draft.blurb} onChange={(event) => setDraft({ ...draft, blurb: event.target.value })} rows={2} maxLength={400} placeholder="What the table knows of them" className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600" />
          <textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} rows={2} maxLength={400} placeholder="What they want (only you read this)" className="w-full rounded border border-violet-900/60 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-violet-600" />
          <div className="flex flex-wrap items-center gap-1">
            {FACTION_ATTITUDES.map((attitude) => (
              <button key={attitude} type="button" aria-pressed={draft.attitude === attitude} onClick={() => setDraft({ ...draft, attitude })} className={cn(chip, draft.attitude === attitude ? on : off)}>
                {attitude}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1 text-[11px] text-stone-500">
              Power
              <input type="range" min={0} max={5} value={draft.power} onChange={(event) => setDraft({ ...draft, power: Number(event.target.value) })} className="w-20 accent-amber-400" />
              {draft.power}
            </label>
          </div>
          <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Tags, comma separated" className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600" />
          <LoreImageField imagePath={draft.portraitPath} onChange={(portraitPath) => setDraft({ ...draft, portraitPath })} />
          <div className="flex gap-1.5">
            <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void save()} className="rounded border border-amber-700 bg-amber-950/50 px-2 py-0.5 text-[11px] text-amber-100 disabled:opacity-50">
              {busy ? <Loader2 className="inline size-3 animate-spin" /> : null} {editing === "new" ? "Add" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-500">
              <X className="size-3" /> Cancel
            </button>
          </div>
        </div>
      ) : null}
      {!factions.length && editing === null ? <p className="text-[11px] italic text-stone-600">No factions yet. The powers of this world are unnamed.</p> : null}
      <ul className="space-y-1.5">
        {factions.map((faction) => (
          <li key={faction.id} className="rounded border border-stone-800/70 bg-stone-950/40 p-2">
            <div className="flex items-start gap-2">
              {faction.portraitPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={faction.portraitPath} alt="" className="size-10 shrink-0 rounded-md border border-amber-800/50 object-cover" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-stone-700 bg-stone-900 font-display text-amber-100">{faction.name.charAt(0)}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-stone-200">
                  <span className="truncate">{faction.name}</span>
                  <span className="rounded border border-stone-700 px-1 text-[10px] capitalize text-stone-400">{faction.attitude}</span>
                  {faction.power !== undefined ? <span className="text-[10px] text-violet-300">power {faction.power}</span> : null}
                </p>
                {faction.blurb ? <p className="text-[11px] leading-4 text-stone-400">{faction.blurb}</p> : null}
                {faction.goal ? <p className="text-[11px] italic text-violet-300/80">Goal: {faction.goal}</p> : null}
                <div className="mt-1 flex items-center gap-1" title={`The party is ${faction.standingLabel} to them`}>
                  {Array.from({ length: REPUTATION_MAX - REPUTATION_MIN + 1 }, (_, index) => REPUTATION_MIN + index).map((step) => (
                    <button
                      key={step}
                      type="button"
                      disabled={!steersStory}
                      onClick={() => void setStanding(faction, step)}
                      aria-label={`Standing ${step}`}
                      className={cn(
                        "h-2 w-3 rounded-sm",
                        step === 0 ? "bg-stone-600" : step < 0 ? (step >= faction.standing ? "bg-red-500/80" : "bg-stone-800") : step <= faction.standing ? "bg-amber-400" : "bg-stone-800",
                      )}
                    />
                  ))}
                  <span className="ml-1 text-[10px] text-stone-500">{reputationLabel(faction.standing)}</span>
                </div>
                {faction.members.length ? (
                  <p className="mt-1 text-[10px] text-stone-500">Members: {faction.members.map((member) => member.name).join(", ")}</p>
                ) : null}
              </div>
              {steersStory ? (
                <span className="flex shrink-0 flex-col gap-1">
                  <button type="button" onClick={() => startEdit(faction)} className="rounded border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-200">
                    Edit
                  </button>
                  <button type="button" onClick={() => void remove(faction)} aria-label={`Remove ${faction.name}`} className="rounded p-1 text-stone-600 hover:text-red-300">
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
