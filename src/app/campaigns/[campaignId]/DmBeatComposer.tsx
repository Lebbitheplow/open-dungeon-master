"use client";

import { useState } from "react";
import { Loader2, Megaphone, NotebookPen, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { PushToTalk } from "@/app/campaigns/[campaignId]/PushToTalk";
import {
  BEAT_KINDS,
  BEAT_KIND_LABELS,
  BEAT_MAX_CHARS,
  type BeatKind,
  type BeatSource,
} from "@/lib/dm/beat-logic";
import type { DmBeat } from "@/lib/db/dm-beats";

// Story capture, in the three ways a DM will actually do it: type a sentence,
// speak it, or press the button and edit what comes back.
//
// The drafted path is the one that makes the feature survivable, and it is
// also the one that has to be handled carefully: the draft lands in this box,
// never in the transcript. Recording it is a second, deliberate press.
export function DmBeatComposer({
  campaignId,
  beats,
  canExpand,
}: {
  campaignId: string;
  // Newest first, straight from the campaign snapshot and the stream.
  beats: DmBeat[];
  // Assisted mode with narration delegated: offer to say the beat to the
  // table in full. Per beat rather than per campaign, because a DM wants it
  // on a scene transition and not on "they took the left fork".
  canExpand: boolean;
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<BeatKind>("scene");
  const [source, setSource] = useState<BeatSource>("typed");
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expand, setExpand] = useState(false);
  const [error, setError] = useState("");

  async function draft() {
    setDrafting(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/beats/draft`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not write a draft.");
        return;
      }
      setBody(String(data.draft ?? ""));
      setSource("drafted");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    const text = body.trim();
    if (!text || saving) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/dm/beats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text, kind, source, expand: canExpand && expand }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not record that.");
        return;
      }
      setBody("");
      setSource("typed");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 px-2.5 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <NotebookPen className="size-3.5" />
        Write down what happened
      </p>
      <p className="mb-2 text-[11px] leading-snug text-stone-500">
        Anything you narrated out loud. A sentence or two is enough, and it is
        what the chapter summaries, the recap and the export are built from.
      </p>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, BEAT_MAX_CHARS))}
        rows={3}
        placeholder="They talked the reeve out of the toll and learned the mill burned last winter."
        className="w-full resize-y rounded-md border border-stone-700 bg-stone-950 px-2 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-amber-700 focus:outline-none"
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as BeatKind)}
          className="rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-300 focus:border-amber-700 focus:outline-none"
        >
          {BEAT_KINDS.map((option) => (
            <option key={option} value={option}>
              {BEAT_KIND_LABELS[option]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={draft}
          disabled={drafting || saving}
          title="Reads what the players typed, what the dice did and what changed on the sheets, then writes a draft for you to edit."
          className="inline-flex items-center gap-1.5 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900 disabled:opacity-40"
        >
          {drafting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Draft it for me
        </button>

        {canExpand ? (
          <label
            title="The AI says your line to the table as full prose. Your own words stay as the first take, one click away on the message."
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-700 px-2 py-1 text-xs text-stone-300 hover:bg-stone-900"
          >
            <input
              type="checkbox"
              checked={expand}
              onChange={(event) => setExpand(event.target.checked)}
              className="size-3 accent-amber-600"
            />
            <Megaphone className="size-3.5" />
            Say it aloud
          </label>
        ) : null}

        <PushToTalk
          disabled={drafting || saving}
          onTranscript={(text) => {
            setBody((current) => (current ? `${current.trim()} ${text}` : text));
            setSource("voice");
          }}
        />

        <button
          type="button"
          onClick={save}
          disabled={!body.trim() || saving || drafting}
          className={cn(
            "ml-auto rounded-md border px-2.5 py-1 text-xs disabled:opacity-40",
            "border-amber-700 bg-amber-950/50 text-amber-100 hover:bg-amber-900/50",
          )}
        >
          {saving ? "Recording..." : "Record it"}
        </button>
      </div>

      {error ? <p className="mt-1.5 text-xs text-red-400">{error}</p> : null}

      {beats.length ? (
        <ul className="mt-2 space-y-1 border-t border-stone-800 pt-2">
          {beats.slice(0, 3).map((beat) => (
            <li key={beat.id} className="text-[11px] leading-snug text-stone-500">
              <span className="text-stone-400">{BEAT_KIND_LABELS[beat.kind] ?? "Beat"}:</span>{" "}
              {beat.body.length > 140 ? `${beat.body.slice(0, 140)}...` : beat.body}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
