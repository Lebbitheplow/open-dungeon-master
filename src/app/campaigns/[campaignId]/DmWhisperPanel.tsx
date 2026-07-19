"use client";

import { ChevronDown, ChevronRight, Send, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { DmWhisper } from "@/lib/db/dm-whispers";
import type { CharacterSheet } from "@/lib/schemas/sheet";

const PENDING_CAP = 2;

// Private line between this player and the AI DM. DM notes arrive via the
// send_whisper tool; the player can also send the DM private messages (e.g.
// slipping away from the group). Content arrives via the caller-scoped
// whispers API; the shared stream only carries a contentless
// whisper_activity ping, and player messages never touch the table chat.
export function DmWhisperPanel({
  campaignId,
  whispers,
  unread,
  sheets,
  refreshWhispers,
}: {
  campaignId: string;
  whispers: DmWhisper[];
  unread: number;
  sheets: CharacterSheet[];
  refreshWhispers: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Opening the card reads everything; new arrivals while open too.
  useEffect(() => {
    if (!open || unread === 0) {
      return;
    }
    void fetch(`/api/campaigns/${campaignId}/whispers/read`, { method: "POST" }).then(() =>
      refreshWhispers(),
    );
  }, [open, unread, campaignId, refreshWhispers]);

  const pendingCount = whispers.filter(
    (whisper) => whisper.direction === "to_dm" && !whisper.answered,
  ).length;
  const capped = pendingCount >= PENDING_CAP;

  function coRecipients(whisper: DmWhisper): string[] {
    const ownName = sheets.find((sheet) => sheet.id === whisper.characterId)?.name;
    return whisper.recipientNames.filter((name) => name !== ownName);
  }

  function formatWhen(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  async function sendWhisper() {
    const message = draft.trim();
    if (!message || sending || capped) {
      return;
    }
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/whispers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The whisper did not go through.");
        return;
      }
      setDraft("");
      await refreshWhispers();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-600/40 bg-amber-950/20">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-amber-500/70" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-amber-500/70" />
        )}
        <Sparkles className="size-4 shrink-0 text-amber-400" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-amber-200">
          Private line to the DM
        </span>
        {unread > 0 ? (
          <span className="rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1.5 text-[10px] font-semibold text-amber-950 shadow-glow-gold">
            {unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-amber-600/20 px-3 py-2">
          <p className="text-[11px] leading-4 text-amber-500/70">
            Only you and the DM can see this. Whisper here to act in secret; the DM answers
            privately and the table only sees what their characters could.
          </p>
          {whispers.length ? (
            <ul className="space-y-2">
              {whispers.map((whisper) => {
                if (whisper.direction === "to_dm") {
                  return (
                    <li
                      key={whisper.id}
                      className="ml-6 rounded-lg border border-stone-700/60 bg-stone-900/70 px-3 py-2"
                    >
                      <p className="whitespace-pre-wrap text-sm leading-5 text-stone-200">
                        {whisper.content}
                      </p>
                      <p className="mt-1 text-[10px] text-stone-500">
                        {formatWhen(whisper.createdAt)}
                        {" | "}
                        {whisper.answered ? "Seen by the DM" : "Waiting on the DM"}
                      </p>
                    </li>
                  );
                }
                const others = coRecipients(whisper);
                return (
                  <li
                    key={whisper.id}
                    className={cn(
                      "mr-6 rounded-lg border border-amber-600/30 bg-stone-950/60 px-3 py-2",
                      !whisper.read && "border-amber-400/60",
                    )}
                  >
                    <p className="whitespace-pre-wrap text-sm leading-5 text-amber-100">
                      {whisper.content}
                    </p>
                    <p className="mt-1 text-[10px] text-stone-500">
                      {formatWhen(whisper.createdAt)}
                      {others.length ? ` | also sent to ${others.join(", ")}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="space-y-1">
            <div className="flex items-end gap-1.5">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendWhisper();
                  }
                }}
                maxLength={500}
                rows={2}
                disabled={capped || sending}
                placeholder={
                  capped
                    ? "Wait for the DM to answer your last whispers."
                    : "Whisper to the DM..."
                }
                className="min-h-[3rem] flex-1 resize-none rounded-lg border border-stone-700 bg-stone-950/80 px-2.5 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void sendWhisper()}
                disabled={!draft.trim() || capped || sending}
                className="rounded-lg border border-amber-600/40 bg-amber-950/40 p-2 text-amber-300 transition hover:bg-amber-900/40 disabled:opacity-40"
                aria-label="Send private message to the DM"
              >
                <Send className="size-4" />
              </button>
            </div>
            {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
