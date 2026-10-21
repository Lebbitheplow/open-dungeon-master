"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import type { PartyState } from "@/lib/dm/party-logic";
import { PARTY_BACKSTORY_MAX } from "@/lib/dm/party-story";
import { offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import { ui } from "@/lib/ui";

// Why this party is together (src/lib/dm/party-story.ts), in the lobby and
// on the table's Party tab. The backstory is optional, and an empty card asks
// for nothing: it says what the box is for and leaves it blank.
//
// It is the players': the lead, a DM seat and anyone with a character here
// may rewrite it, the latest save wins, and the card says who saved last. A save that lands
// while someone is mid-edit does not wipe their text; it tells them, and
// their own save would replace it.
export function PartyStory({
  campaignId,
  party,
  canWrite,
  hasCharacters,
  inPlay = false,
  className,
}: {
  campaignId: string;
  party: Pick<PartyState, "backstory" | "backstoryBy" | "backstoryAt"> | undefined;
  canWrite: boolean;
  // Whether anyone has a character yet: the draft button needs a party.
  hasCharacters: boolean;
  // Past the lobby: the arc is already planned, so the help says what an
  // edit reaches now.
  inPlay?: boolean;
  className?: string;
}) {
  const saved = party?.backstory ?? "";
  const capabilities = useCapabilities();
  const [text, setText] = useState(saved);
  // The stored text this edit started from. When the server's copy moves
  // and the field still holds the old one, the field follows; when it holds
  // the viewer's own unsaved words, it keeps them and says so.
  const [base, setBase] = useState(saved);
  const [overtaken, setOvertaken] = useState(false);
  if (saved !== base) {
    setBase(saved);
    if (text.trim() === base.trim()) {
      setText(saved);
    } else if (text.trim() !== saved.trim()) {
      setOvertaken(true);
    }
  }
  const [busy, setBusy] = useState<"" | "save" | "draft">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  // Focus follows the edit: a control that turns disabled under the keyboard
  // drops focus to the page, and a screen reader loses its place. A finished
  // save or draft returns to the backstory box.
  const backstoryRef = useRef<HTMLTextAreaElement>(null);
  // Set beside the state change, read once the render it causes has
  // committed.
  const focusBackstory = useRef(false);
  useEffect(() => {
    if (!focusBackstory.current) {
      return;
    }
    focusBackstory.current = false;
    backstoryRef.current?.focus();
  });

  const dirty = text.trim() !== saved.trim();

  async function post(body: unknown): Promise<Record<string, unknown> | null> {
    const response = await fetch(`/api/campaigns/${campaignId}/party/backstory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      setError(typeof data.error === "string" ? data.error : "Could not reach the party backstory.");
      return null;
    }
    return data;
  }

  async function save() {
    setBusy("save");
    setError("");
    setNote("");
    try {
      const data = await post({ do: "save", text });
      if (data) {
        setText(text.trim());
        setOvertaken(false);
        setNote(text.trim() ? "Saved. The DM reads it from the next turn." : "Cleared.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
      focusBackstory.current = true;
    }
  }

  async function draft() {
    setBusy("draft");
    setError("");
    setNote("");
    try {
      const data = await post({ do: "draft", current: text });
      if (data && typeof data.text === "string") {
        setText(data.text);
        setNote("A draft from your characters' backstories. Edit it, then save; nothing is kept until you do.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
      focusBackstory.current = true;
    }
  }

  const savedBy = party?.backstoryBy && saved ? party.backstoryBy : "";
  const savedAt = party?.backstoryAt && saved ? new Date(party.backstoryAt) : null;

  return (
    <div className={cn("space-y-3 text-sm", className)} data-party-story>
      <div>
        <span className={ui.sectionEyebrow}>Party backstory</span>
        {canWrite ? (
          <>
            <textarea
              ref={backstoryRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              maxLength={PARTY_BACKSTORY_MAX}
              aria-label="Party backstory"
              placeholder="Optional. How these characters know each other and why they travel together: who owes whom, what they survived, what they are after."
              className={cn(ui.input, "mt-1")}
            />
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-party-backstory-save
                disabled={busy !== "" || !dirty}
                onClick={() => void save()}
                className={cn(ui.btnSmall, "min-h-10")}
              >
                {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {text.trim() || !saved ? "Save backstory" : "Clear backstory"}
              </button>
              {hasCharacters && offersStoryModel(capabilities) ? (
                <button type="button" disabled={busy !== ""} onClick={() => void draft()} className={cn(ui.btnSmall, "min-h-10")}>
                  {busy === "draft" ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Draft from our backstories
                </button>
              ) : null}
              <span className="ml-auto text-[11px] text-stone-500">
                {text.length}/{PARTY_BACKSTORY_MAX}
              </span>
            </div>
          </>
        ) : (
          <p className={cn("mt-1 whitespace-pre-line", saved ? "text-stone-300" : "text-xs text-stone-500")}>
            {saved || "Nobody has written one yet. Build a character here to add to it."}
          </p>
        )}
        {overtaken ? (
          <p role="status" className="mt-1 text-xs text-amber-300">
            {party?.backstoryBy || "Someone"} saved a newer version while you were editing. Your text is still here;
            saving it replaces theirs.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1 text-xs text-red-300">
            {error}
          </p>
        ) : null}
        {/* Always rendered, so a screen reader is already listening when a
            save's confirmation is written into it. */}
        <p role="status" data-party-story-status className={cn("text-xs text-emerald-300/80", note && !error ? "mt-1" : "sr-only")}>
          {note && !error ? note : ""}
        </p>
        <p className="mt-1 text-xs text-stone-500">
          {savedBy ? `Last saved by ${savedBy}${savedAt && !Number.isNaN(savedAt.getTime()) ? ` on ${savedAt.toLocaleDateString()}` : ""}. ` : ""}
          {inPlay
            ? "Optional. The DM reads it from the next turn; the story plan takes it in when the lead regenerates the arc. "
            : "Optional. The DM reads it every turn and the story plan is built around it when the adventure begins. "}
          The lead, the DM and anyone with a character here can edit it; the latest save wins.
        </p>
      </div>
    </div>
  );
}
