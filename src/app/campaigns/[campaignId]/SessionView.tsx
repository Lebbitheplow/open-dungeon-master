"use client";

import { Dices, Loader2, Send, Swords } from "lucide-react";
import { type FormEvent, useState } from "react";
import { cn } from "@/lib/cn";
import { MessageList } from "@/app/campaigns/[campaignId]/MessageList";
import { PartyPanel } from "@/app/campaigns/[campaignId]/PartyPanel";
import type { CampaignState } from "@/app/campaigns/[campaignId]/useCampaignStream";

type InputKind = "do" | "say" | "ooc";

export function SessionView({ state }: { state: CampaignState }) {
  const { campaign, me, sheets, messages, rolls, dmStatus, dmDraft } = state;
  const [input, setInput] = useState("");
  const [kind, setKind] = useState<InputKind>("do");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  if (!campaign || !me) {
    return null;
  }

  const mySheet = sheets.find((sheet) => sheet.userId === me.id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) {
      return;
    }
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaign!.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, kind }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not send your action.");
        return;
      }
      setInput("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  async function adjustHp(delta: number) {
    if (!mySheet) {
      return;
    }
    await fetch(`/api/campaigns/${campaign!.id}/sheet`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentHp: Math.max(0, Math.min(mySheet.maxHp, mySheet.currentHp + delta)),
      }),
    });
  }

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center justify-between border-b border-stone-800 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Swords className="size-5 text-amber-500" />
          <div>
            <h1 className="font-serif font-semibold leading-tight">{campaign.title}</h1>
            <p className="text-xs text-stone-500">
              {campaign.scene || "The adventure unfolds"}
            </p>
          </div>
        </div>
        <a href="/" className="text-sm text-stone-500 hover:text-stone-300">
          All campaigns
        </a>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList
            messages={messages}
            rolls={rolls}
            sheets={sheets}
            dmStatus={dmStatus}
            dmDraft={dmDraft}
          />

          <form onSubmit={submit} className="border-t border-stone-800 p-3">
            <div className="mb-2 flex gap-1.5">
              {(["do", "say", "ooc"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setKind(option)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    kind === option
                      ? "bg-amber-800 text-amber-100"
                      : "bg-stone-900 text-stone-400 hover:text-stone-200",
                  )}
                >
                  {option === "do" ? "Do" : option === "say" ? "Say" : "OOC"}
                </button>
              ))}
              {dmStatus !== "idle" ? (
                <span className="ml-auto flex items-center gap-1.5 text-xs text-stone-500">
                  <Dices className="size-3.5 animate-bounce text-amber-600" />
                  DM at work...
                </span>
              ) : null}
            </div>
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(event);
                  }
                }}
                rows={2}
                placeholder={
                  kind === "do"
                    ? `What does ${mySheet?.name ?? "your character"} do?`
                    : kind === "say"
                      ? `What does ${mySheet?.name ?? "your character"} say?`
                      : "Out-of-character note to the table"
                }
                className="flex-1 resize-none rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm outline-none focus:border-amber-600"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="self-end rounded-md bg-amber-700 p-2.5 text-amber-50 hover:bg-amber-600 disabled:opacity-40"
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              </button>
            </div>
            {error ? <p className="mt-1.5 text-sm text-red-400">{error}</p> : null}
          </form>
        </div>

        <PartyPanel sheets={sheets} meUserId={me.id} onAdjustHp={adjustHp} />
      </div>
    </main>
  );
}
