"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { PartyState } from "@/lib/dm/party-logic";
import { PARTY_BACKSTORY_MAX, PARTY_HOOK_MAX } from "@/lib/dm/party-story";
import { offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import { ui } from "@/lib/ui";

// Why this party is together (src/lib/dm/party-story.ts), in the lobby and
// on the table's Party tab. Both texts are optional, and an empty card asks
// for nothing: it says what the box is for and leaves it blank.
//
// The hook was written at setup and belongs to whoever holds the table's
// settings (the settings route's own rule). The backstory is the players':
// the lead, a DM seat and anyone with a character here may rewrite it, the
// latest save wins, and the card says who saved last. A save that lands
// while someone is mid-edit does not wipe their text; it tells them, and
// their own save would replace it.
export function PartyStory({
  campaignId,
  hook,
  party,
  canWrite,
  canEditHook,
  hasCharacters,
  inPlay = false,
  className,
}: {
  campaignId: string;
  hook: string;
  party: Pick<PartyState, "backstory" | "backstoryBy" | "backstoryAt"> | undefined;
  canWrite: boolean;
  canEditHook: boolean;
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
  const [busy, setBusy] = useState<"" | "save" | "draft" | "hook">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [hookDraft, setHookDraft] = useState<string | null>(null);

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
    }
  }

  async function saveHook() {
    if (hookDraft === null) {
      return;
    }
    setBusy("hook");
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyHook: hookDraft.trim() }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save the party hook.");
        return;
      }
      setHookDraft(null);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  const savedBy = party?.backstoryBy && saved ? party.backstoryBy : "";
  const savedAt = party?.backstoryAt && saved ? new Date(party.backstoryAt) : null;

  return (
    <div className={cn("space-y-3 text-sm", className)} data-party-story>
      {hook || canEditHook ? (
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className={ui.sectionEyebrow}>Party hook</span>
            {canEditHook && hookDraft === null ? (
              <button type="button" data-party-hook-edit onClick={() => setHookDraft(hook)} className="text-xs text-stone-400 hover:text-amber-200">
                {hook ? "Edit" : "Add one"}
              </button>
            ) : null}
          </div>
          {hookDraft !== null ? (
            <div className="mt-1 space-y-2">
              <textarea
                value={hookDraft}
                onChange={(event) => setHookDraft(event.target.value)}
                rows={2}
                maxLength={PARTY_HOOK_MAX}
                aria-label="Party hook"
                placeholder="For example: deserters from the same border company."
                className={ui.input}
              />
              <div className="flex gap-2">
                <button type="button" data-party-hook-save disabled={busy !== ""} onClick={() => void saveHook()} className={ui.btnSmall}>
                  {busy === "hook" ? <Loader2 className="size-3.5 animate-spin" /> : null} Save hook
                </button>
                <button type="button" onClick={() => setHookDraft(null)} className={ui.btnSmall}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className={cn("mt-1", hook ? "text-stone-300" : "text-xs text-stone-500")}>
              {hook || "None. Optional: a line about why the group is together, set before anyone had a character."}
            </p>
          )}
        </div>
      ) : null}

      <div>
        <span className={ui.sectionEyebrow}>Party backstory</span>
        {canWrite ? (
          <>
            <textarea
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
                className={ui.btnSmall}
              >
                {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {text.trim() || !saved ? "Save backstory" : "Clear backstory"}
              </button>
              {hasCharacters && offersStoryModel(capabilities) ? (
                <button type="button" disabled={busy !== ""} onClick={() => void draft()} className={ui.btnSmall}>
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
        {note && !error ? <p className="mt-1 text-xs text-emerald-300/80">{note}</p> : null}
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
