"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Loader2 } from "lucide-react";
import type { RulebookPageResponse } from "@/lib/rulebook/types";

// Under a page's title: how the table runs what the page describes
// (src/lib/rulebook/crosswalk.ts), and for an entry the workshop can copy,
// a way to start one from it. The copy opens in the newest of the reader's
// workshops (the shelf is theirs in every workshop alike), in the editor for
// its kind, from this entry, unsaved.

const SUPPORT_LABEL: Record<NonNullable<RulebookPageResponse["crosswalk"]>["support"], string> = {
  engine: "The table runs this",
  structured: "Prepared in a workshop tool the table runs",
  editable: "Prepared as words the DM runs",
  reference: "Read here; the DM runs it",
};

export function PagePrep({ data, canStart = true }: { data: RulebookPageResponse; canStart?: boolean }) {
  const crosswalk = data.crosswalk;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const router = useRouter();
  if (!crosswalk) {
    return null;
  }
  async function startFrom() {
    if (!crosswalk?.editor) return;
    setBusy(true);
    setNote("");
    try {
      const body = (await fetch("/api/workshops").then((response) => (response.ok ? response.json() : null))) as { workshops?: Array<{ id: string; updatedAt?: string }> } | null;
      const workshops = [...(body?.workshops ?? [])].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
      if (!workshops.length) {
        setNote("Make a workshop first: your homebrew lives in your workshops.");
        return;
      }
      const system = crosswalk.editor === "monster" ? "bestiary" : "homebrew";
      const start = `${crosswalk.editor}:${data.page.id}`;
      router.push(`/workshop/${workshops[0].id}?system=${system}&start=${encodeURIComponent(start)}`);
    } finally {
      setBusy(false);
    }
  }
  const copyable = canStart && crosswalk.editor && !(crosswalk.editor === "monster" && crosswalk.template);
  return (
    <div className="rb-prep" data-support={crosswalk.support} data-testid="rulebook-prep">
      <p>
        <span className="rb-prep-label">{SUPPORT_LABEL[crosswalk.support]}:</span> {crosswalk.where}
        {crosswalk.template ? <span className="rb-prep-note"> {crosswalk.template === "half-dragon" || crosswalk.template === "npc" ? "" : `(${crosswalk.template})`}</span> : null}
      </p>
      {copyable ? (
        <button type="button" onClick={() => void startFrom()} disabled={busy} className="rb-turn-link rb-prep-start motion-press">
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Hammer className="size-3.5" aria-hidden="true" />}
          {crosswalk.editor === "archetype" ? "Write a subclass for this class" : "Start a workshop copy of this"}
        </button>
      ) : null}
      {note ? <p className="rb-prep-note">{note}</p> : null}
    </div>
  );
}
