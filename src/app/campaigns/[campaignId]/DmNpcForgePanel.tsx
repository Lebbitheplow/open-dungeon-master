"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ATTITUDES,
  FIELD_LABELS,
  applyGeneratedField,
  blankDraft,
  describeNpc,
  draftFrom,
  type GeneratableField,
  type NpcDraft,
  type RelationGraph,
} from "@/lib/npcs/forge";
import {
  GOAL_FIELDS,
  PersonalitySliders,
  RelationEditor,
  goalText,
  setGoal,
} from "@/app/campaigns/[campaignId]/NpcFields";

// The NPC forge.
//
// Everything the agency model can hold has been reachable only by the AI
// DM's tools since it was built. This is the form over it, and the two
// things it does that a JSON editor would not are the reason it exists:
// every axis is shown as the word it means, and every relation is shown with
// whether the other person agrees.
//
// Generation is per field. A DM should be able to take the model's sense of
// what somebody wants and throw away its sense of who they are, so there is
// no button that fills the whole form.

type Npc = {
  id: string;
  name: string;
  attitude: string;
  trait: string;
  location: string;
  aliases: string[];
  portraitUrl: string;
  archived: boolean;
  agency: {
    personality: Record<string, number> | null;
    goals: { scene?: string; session?: { text: string; progress: number; target: number }; ambition?: string };
    relations: Array<{ npcName: string; score: number; note?: string }>;
  };
};

export function DmNpcForgePanel({ campaignId }: { campaignId: string }) {
  const [npcs, setNpcs] = useState<Npc[]>([]);
  const [graph, setGraph] = useState<RelationGraph>({ nodes: [], edges: [] });
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<NpcDraft>(blankDraft());
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState<GeneratableField | "">("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is.
  const load = useCallback(
    () =>
      fetch(`/api/campaigns/${campaignId}/dm/npcs`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { npcs: Npc[]; graph: RelationGraph } | null) => {
          if (payload) {
            setNpcs(payload.npcs);
            setGraph(payload.graph);
          }
        })
        .catch(() => {
          // transient; the next action reloads
        }),
    [campaignId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = npcs.find((npc) => npc.id === selectedId) ?? null;

  function open(npc: Npc | null) {
    setError("");
    if (!npc) {
      setSelectedId("");
      setDraft(blankDraft());
      return;
    }
    setSelectedId(npc.id);
    setDraft(draftFrom(npc as Parameters<typeof draftFrom>[0]));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const url = selected
        ? `/api/campaigns/${campaignId}/dm/npcs/${selected.id}`
        : `/api/campaigns/${campaignId}/dm/npcs`;
      const response = await fetch(url, {
        method: selected ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That did not save.");
        return;
      }
      await load();
      if (!selected && payload.npc) {
        setSelectedId(payload.npc.id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/npcs/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/dm/npcs/${selected.id}`, { method: "DELETE" });
      open(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // A second copy of the SAVED person, not of the edits on screen, so half a
  // rewrite in the form never leaks into the copy. The server refuses a name
  // clash, which is why the copy announces itself in its name.
  async function duplicate() {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const base = draftFrom(selected as Parameters<typeof draftFrom>[0]);
      const response = await fetch(`/api/campaigns/${campaignId}/dm/npcs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: { ...base, name: `${base.name} (copy)`.slice(0, 80) } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "That could not be copied.");
        return;
      }
      await load();
      const created = (
        payload as { npc?: Parameters<typeof draftFrom>[0] & { id: string } }
      ).npc;
      if (created) {
        setSelectedId(created.id);
        setDraft(draftFrom(created));
      }
    } finally {
      setBusy(false);
    }
  }

  // One field, never the whole person. Nothing is written: the suggestion
  // lands in the draft on screen and the DM keeps it or types over it.
  async function suggest(field: GeneratableField) {
    setGenerating(field);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/npcs/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field,
          name: draft.name,
          trait: draft.trait,
          location: draft.location,
          attitude: draft.attitude,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "The model had nothing to say.");
        return;
      }
      setDraft((current) => applyGeneratedField(current, field, String(payload.text ?? "")));
    } finally {
      setGenerating("");
    }
  }

  async function uploadPortrait(file: File) {
    setBusy(true);
    setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const upload = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, name: file.name, type: file.type }),
      });
      const payload = await upload.json().catch(() => ({}));
      if (!upload.ok) {
        setError(payload.error || "That image would not upload.");
        return;
      }
      await patch({ portraitUrl: payload.url });
    } catch {
      setError("That image would not upload.");
    } finally {
      setBusy(false);
    }
  }

  const others = npcs.filter((npc) => npc.id !== selectedId).map((npc) => npc.name);
  const generateButton = (field: GeneratableField) => (
    <button
      type="button"
      disabled={generating !== "" || busy}
      title={`Ask the model for ${FIELD_LABELS[field].toLowerCase()}`}
      onClick={() => void suggest(field)}
      className="flex shrink-0 items-center gap-1 rounded-md border border-stone-700 px-1.5 py-0.5 text-[10px] text-stone-400 hover:text-amber-200 disabled:opacity-40"
    >
      {generating === field ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Sparkles className="size-3" />
      )}
      Suggest
    </button>
  );

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/40 px-2.5 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
          <Users className="size-3.5" />
          The cast
        </p>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => open(null)}
            className={cn(
              "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
              selectedId === ""
                ? "border-amber-700 bg-amber-950/50 text-amber-100"
                : "border-stone-700 text-stone-400 hover:text-stone-200",
            )}
          >
            <UserPlus className="size-3" /> Someone new
          </button>
          {npcs.map((npc) => (
            <button
              key={npc.id}
              type="button"
              title={describeNpc(draftFrom(npc as Parameters<typeof draftFrom>[0]))}
              onClick={() => open(npc)}
              className={cn(
                "flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]",
                npc.id === selectedId
                  ? "border-amber-700 bg-amber-950/50 text-amber-100"
                  : "border-stone-700 text-stone-400 hover:text-stone-200",
                npc.archived && "opacity-50",
              )}
            >
              {npc.portraitUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={npc.portraitUrl} alt="" className="size-4 rounded-full object-cover" />
              ) : null}
              {npc.name}
            </button>
          ))}
        </div>
        {npcs.length === 0 ? (
          <p className="text-[11px] text-stone-500">
            Nobody written yet. Everything here also fills itself in as the party meets people.
          </p>
        ) : null}
      </section>

      <section className="space-y-2 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Their name"
            className="min-w-32 flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-sm text-stone-200"
          />
          <select
            value={draft.attitude}
            onChange={(event) =>
              setDraft({ ...draft, attitude: event.target.value as NpcDraft["attitude"] })
            }
            className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300"
          >
            {ATTITUDES.map((attitude) => (
              <option key={attitude} value={attitude}>
                {attitude === "hostile"
                  ? "Hostile to the party"
                  : attitude === "friendly"
                    ? "Friendly to the party"
                    : "Indifferent"}
              </option>
            ))}
          </select>
        </div>

        <input
          value={draft.location}
          onChange={(event) => setDraft({ ...draft, location: event.target.value })}
          placeholder="Where they are usually found"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />

        <input
          value={draft.aliases.join(", ")}
          onChange={(event) =>
            setDraft({
              ...draft,
              aliases: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean),
            })
          }
          placeholder="Other names they answer to, separated by commas"
          className="w-full rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
        />

        <div className="flex items-start gap-1.5">
          <textarea
            value={draft.trait}
            onChange={(event) => setDraft({ ...draft, trait: event.target.value })}
            rows={2}
            placeholder="What a player notices about them first"
            className="flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
          />
          {generateButton("trait")}
        </div>
      </section>

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-wide text-stone-500">Who they are</p>
          {generateButton("personality")}
        </div>
        <PersonalitySliders draft={draft} onChange={setDraft} />
      </section>

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="text-[11px] uppercase tracking-wide text-stone-500">What they want</p>
        {GOAL_FIELDS.map(([field, placeholder]) => (
          <div key={field} className="flex items-center gap-1.5">
            <input
              value={goalText(draft, field)}
              onChange={(event) => setDraft(setGoal(draft, field, event.target.value))}
              placeholder={placeholder}
              className="flex-1 rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300"
            />
            {field === "session" && draft.goals.session ? (
              <span className="shrink-0 text-[10px] text-stone-600">
                {draft.goals.session.progress}/{draft.goals.session.target}
              </span>
            ) : null}
            {generateButton(field)}
          </div>
        ))}
        <p className="text-[10px] text-stone-600">
          The middle one advances on background dice at the end of a chapter, so its progress is
          the engine&apos;s to move, not yours.
        </p>
      </section>

      <section className="space-y-1.5 rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
        <p className="text-[11px] uppercase tracking-wide text-stone-500">
          How they feel about other people
        </p>
        <RelationEditor draft={draft} graph={graph} others={others} onChange={setDraft} />
      </section>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy || !draft.name.trim()}
          onClick={() => void save()}
          className="rounded-md border border-amber-700 bg-amber-950/50 px-2 py-1 text-xs text-amber-100 disabled:opacity-40"
        >
          {busy ? <Loader2 className="inline size-3 animate-spin" /> : null} Save them
        </button>
        {selected ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadPortrait(file);
                }
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <ImageIcon className="size-3" /> {selected.portraitUrl ? "Replace face" : "Add a face"}
            </button>
            <button
              type="button"
              disabled={busy}
              title="Render one on the shared media queue"
              onClick={() => void patch({ draft, generatePortrait: true })}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <Sparkles className="size-3" /> Paint one
            </button>
            <button
              type="button"
              disabled={busy}
              title={
                selected.archived
                  ? "Put them back in the DM's prompt"
                  : "Keep them, but take them out of the DM's prompt"
              }
              onClick={() => void patch({ archived: !selected.archived })}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-400 hover:bg-stone-900 disabled:opacity-50"
            >
              {selected.archived ? (
                <>
                  <ArchiveRestore className="size-3" /> Bring back
                </>
              ) : (
                <>
                  <Archive className="size-3" /> Set aside
                </>
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              aria-label={`Duplicate ${selected.name}`}
              onClick={() => void duplicate()}
              className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-50"
            >
              <Copy className="size-3" /> Duplicate
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="ml-auto flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-500 hover:text-red-300 disabled:opacity-50"
            >
              <Trash2 className="size-3" /> Forget them
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  );
}
