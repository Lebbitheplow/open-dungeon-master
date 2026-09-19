"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { Select, optionsFrom } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { DeskCard } from "@/app/campaigns/[campaignId]/DmConsoleParts";
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
    <DeskCard glyph="tab-journal" title="Write down what happened">
      <p className="mb-2 text-[11px] leading-snug text-stone-400">
        Anything you narrated out loud. A sentence or two is enough, and it is
        what the chapter summaries, the recap and the export are built from.
      </p>

      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value.slice(0, BEAT_MAX_CHARS))}
        rows={3}
        placeholder="They talked the reeve out of the toll and learned the mill burned last winter."
        aria-label="What happened"
        className={cn(ui.input, "resize-y")}
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Select
          value={kind}
          onChange={setKind}
          options={optionsFrom<BeatKind>(BEAT_KINDS.map((option) => [option, BEAT_KIND_LABELS[option]]))}
          label="Kind of beat"
          size="sm"
          className="w-auto min-w-[10rem] max-w-full"
        />

        <button
          type="button"
          onClick={draft}
          disabled={drafting || saving}
          title="Reads what the players typed, what the dice did and what changed on the sheets, then writes a draft for you to edit."
          aria-busy={drafting}
          className={cn(ui.btnSmall, "min-h-10 text-xs")}
        >
          {drafting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Draft it for me
        </button>

        {canExpand ? (
          <span
            title="The AI says your line to the table as full prose. Your own words stay as the first take, one click away on the message."
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-stone-600/60 bg-stone-900/50 px-2.5 text-xs text-stone-300"
          >
            <GameIcon icon={{ kind: "glyph", key: "cue-horn" }} size="size-5" />
            Say it aloud
            <Switch on={expand} onChange={setExpand} label="Say it aloud" />
          </span>
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
          aria-busy={saving}
          className={cn(ui.btnPrimary, "ml-auto")}
        >
          {saving ? "Recording..." : "Record it"}
        </button>
      </div>

      {error ? <p className="motion-shake mt-1.5 text-xs text-red-400">{error}</p> : null}

      {beats.length ? (
        <ul className="stagger mt-3 space-y-1 border-t border-amber-500/15 pt-2">
          {beats.slice(0, 3).map((beat) => (
            <li key={beat.id} className="text-[11px] leading-snug text-stone-400">
              <span className="font-display tracking-wide text-amber-200/80">{BEAT_KIND_LABELS[beat.kind] ?? "Beat"}:</span>{" "}
              {beat.body.length > 140 ? `${beat.body.slice(0, 140)}...` : beat.body}
            </li>
          ))}
        </ul>
      ) : null}
    </DeskCard>
  );
}
