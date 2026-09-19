"use client";

import { EmptyState } from "@/components/EmptyState";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { Slider } from "@/components/ui/Slider";
import { LoreImageField } from "@/app/workshop/lore/LoreFields";
import { GlyphChip, KitButton, PanelLoading, panelField, panelRow } from "./PanelKit";
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

// The attitude ladder has five painted faces; anything a pack adds beyond
// them reads as neutral rather than as a broken image.
const ATTITUDE_GLYPHS = new Set(["allied", "friendly", "neutral", "wary", "hostile"]);
const attitudeGlyph = (attitude: string) => `attitude-${ATTITUDE_GLYPHS.has(attitude) ? attitude : "neutral"}`;

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
    return <PanelLoading label="Reading the banners..." />;
  }
  return (
    <div className="space-y-2">
      <SectionHead
        title="Factions"
        glyph="tab-factions"
        aside={
          steersStory && editing === null ? (
            <KitButton
              onClick={() => {
                setDraft(blank());
                setEditing("new");
              }}
            >
              <Plus className="size-3.5" /> Add one
            </KitButton>
          ) : factions.length ? (
            factions.length
          ) : null
        }
      />
      {editing !== null ? (
        <div className="panel reveal space-y-1.5 rounded-lg p-2.5">
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} maxLength={80} placeholder="The Reed Court" aria-label="Faction name" className={panelField} />
          <textarea value={draft.blurb} onChange={(event) => setDraft({ ...draft, blurb: event.target.value })} rows={2} maxLength={400} placeholder="What the table knows of them" aria-label="What the table knows of them" className={panelField} />
          <textarea value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} rows={2} maxLength={400} placeholder="What they want (only you read this)" aria-label="What they want (only you read this)" className={cn(panelField, "border-violet-900/60 focus:border-violet-500/70")} />
          <div data-pill-group="" role="group" aria-label="Attitude" className="flex flex-wrap items-center gap-1">
            {FACTION_ATTITUDES.map((attitude) => (
              <button data-on={draft.attitude === attitude ? "" : undefined} key={attitude} type="button" aria-pressed={draft.attitude === attitude} onClick={() => setDraft({ ...draft, attitude })} className="pk-pill pk-tap motion-press capitalize">
                <GameIcon icon={{ kind: "glyph", key: attitudeGlyph(attitude) }} size="size-4" />
                {attitude}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <span>Power</span>
            <Slider min={0} max={5} value={draft.power} onChange={(power) => setDraft({ ...draft, power })} label="Power" className="min-w-0 flex-1" />
            <span key={draft.power} className="count-pop w-4 text-right tabular-nums text-stone-200">{draft.power}</span>
          </div>
          <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Tags, comma separated" aria-label="Tags, comma separated" className={panelField} />
          <LoreImageField imagePath={draft.portraitPath} onChange={(portraitPath) => setDraft({ ...draft, portraitPath })} />
          <div className="flex gap-1.5">
            <KitButton tone="primary" disabled={busy || !draft.name.trim()} busy={busy} onClick={() => void save()}>
              {editing === "new" ? "Add" : "Save"}
            </KitButton>
            <KitButton onClick={() => setEditing(null)}>
              <X className="size-3.5" /> Cancel
            </KitButton>
          </div>
        </div>
      ) : null}
      {!factions.length && editing === null ? <EmptyState size="sm" art="board" title="No factions yet. The powers of this world are unnamed." /> : null}
      <ul className="stagger space-y-1.5">
        {factions.map((faction) => {
          const items: ContextMenuItem[] = steersStory
            ? [
                { id: "edit", label: "Edit", glyph: "tab-notes", onSelect: () => startEdit(faction) },
                ...Array.from({ length: REPUTATION_MAX - REPUTATION_MIN + 1 }, (_, index) => REPUTATION_MIN + index).map((step, index) => ({
                  id: `standing-${step}`,
                  label: `Standing ${step > 0 ? "+" : ""}${step}: ${reputationLabel(step)}`,
                  glyph: step < 0 ? "attitude-hostile" : step === 0 ? "attitude-neutral" : "attitude-friendly",
                  separated: index === 0,
                  disabled: step === faction.standing,
                  onSelect: () => void setStanding(faction, step),
                })),
                { id: "remove", label: `Remove ${faction.name}`, glyph: "quest-failed", tone: "danger" as const, separated: true, onSelect: () => void remove(faction) },
              ]
            : [];
          return (
            <ContextMenu as="li" key={faction.id} items={items} label={faction.name} className={panelRow}>
              <div className="flex items-start gap-2">
                {faction.portraitPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={faction.portraitPath} alt="" className="size-11 shrink-0 rounded-md border border-amber-500/40 object-cover shadow-[0_2px_8px_rgba(4,2,12,0.5)]" />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-md border border-amber-500/25 bg-stone-900/70">
                    <GameIcon icon={{ kind: "glyph", key: "system-factions" }} size="size-8" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium text-stone-100">
                    <span className="min-w-0 truncate">{faction.name}</span>
                    <GlyphChip glyph={attitudeGlyph(faction.attitude)} className="capitalize">{faction.attitude}</GlyphChip>
                    {faction.power !== undefined ? <span className="text-[11px] font-normal text-violet-300">power {faction.power}</span> : null}
                  </p>
                  {faction.blurb ? <p className="reveal text-xs leading-5 text-stone-400">{faction.blurb}</p> : null}
                  {faction.goal ? <p className="reveal text-xs italic leading-5 text-violet-300/80">Goal: {faction.goal}</p> : null}
                  <div className="mt-1 flex items-center gap-1" title={`The party is ${faction.standingLabel} to them`}>
                    {Array.from({ length: REPUTATION_MAX - REPUTATION_MIN + 1 }, (_, index) => REPUTATION_MIN + index).map((step) => (
                      <button
                        key={step}
                        type="button"
                        disabled={!steersStory}
                        onClick={() => void setStanding(faction, step)}
                        aria-label={`Standing ${step}`}
                        aria-pressed={step === faction.standing}
                        className={cn(
                          "bar-ease h-2.5 w-3.5 rounded-sm enabled:hover:brightness-125 motion-press",
                          step === 0 ? "bg-stone-600" : step < 0 ? (step >= faction.standing ? "bg-red-500/80" : "bg-stone-800") : step <= faction.standing ? "bg-amber-400" : "bg-stone-800",
                        )}
                      />
                    ))}
                    <span key={faction.standing} className="count-pop ml-1 text-[11px] text-stone-400">{reputationLabel(faction.standing)}</span>
                  </div>
                  {faction.members.length ? (
                    <p className="reveal mt-1 text-[11px] text-stone-500">Members: {faction.members.map((member) => member.name).join(", ")}</p>
                  ) : null}
                </div>
                {steersStory ? (
                  <span className="flex shrink-0 flex-col items-center gap-0.5">
                    <KitButton onClick={() => startEdit(faction)}>
                      <Pencil className="size-3" /> Edit
                    </KitButton>
                    <KitButton tone="iconDanger" always onClick={() => void remove(faction)} aria-label={`Remove ${faction.name}`}>
                      <Trash2 className="size-3.5" />
                    </KitButton>
                  </span>
                ) : null}
              </div>
            </ContextMenu>
          );
        })}
      </ul>
    </div>
  );
}
