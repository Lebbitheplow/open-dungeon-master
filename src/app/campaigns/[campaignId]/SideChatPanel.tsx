"use client";

import { ArrowLeft, Loader2, MessagesSquare, Plus, Send, UserRound, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import type { CampaignMember } from "@/lib/campaign-types";
import type { SideMessage, SideThread } from "@/lib/db/side-chat";

// Private table talk: 1:1 whispers and group side chats. Content lives only
// in the side-chat API; the shared campaign stream carries just a contentless
// "something happened" ping (side_activity), which is what triggers the
// refreshes here. The AI DM never sees any of it.
export function SideChatPanel({
  campaignId,
  members,
  meUserId,
  threads,
  refreshSideChat,
  openThreadRequest,
  onOpenHandled,
}: {
  campaignId: string;
  members: CampaignMember[];
  meUserId: string;
  threads: SideThread[];
  refreshSideChat: () => Promise<void>;
  // Set by "Message" on a party card: open (creating if needed) the 1:1
  // thread with this user.
  openThreadRequest: string | null;
  onOpenHandled: () => void;
}) {
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const openThread = threads.find((thread) => thread.id === openThreadId) ?? null;

  const openDmWith = useCallback(
    async (userId: string) => {
      setError("");
      try {
        const response = await fetch(`/api/campaigns/${campaignId}/side-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "dm", memberUserIds: [userId] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error || "Could not open the chat.");
          return;
        }
        await refreshSideChat();
        setOpenThreadId(data.thread.id);
      } catch {
        setError("Could not reach the server.");
      }
    },
    [campaignId, refreshSideChat],
  );

  useEffect(() => {
    if (!openThreadRequest) {
      return;
    }
    // Deferred so the state updates in openDmWith/onOpenHandled don't run
    // synchronously inside the effect body.
    const timer = setTimeout(() => {
      void openDmWith(openThreadRequest).then(onOpenHandled);
    }, 0);
    return () => clearTimeout(timer);
  }, [openThreadRequest, onOpenHandled, openDmWith]);

  const nameOf = useCallback(
    (userId: string) => members.find((member) => member.userId === userId)?.username ?? "someone",
    [members],
  );

  function threadLabel(thread: SideThread): string {
    if (thread.kind === "dm") {
      const other = thread.memberUserIds.find((id) => id !== meUserId);
      return nameOf(other ?? "");
    }
    return thread.title || thread.memberUserIds.map(nameOf).join(", ");
  }

  if (openThread) {
    return (
      <ThreadView
        campaignId={campaignId}
        thread={openThread}
        label={threadLabel(openThread)}
        members={members}
        meUserId={meUserId}
        refreshSideChat={refreshSideChat}
        onBack={() => setOpenThreadId(null)}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">
          Private chats
        </h3>
        <button type="button" onClick={() => setCreating(true)} className={ui.btnSmall}>
          <Plus className="size-3.5" /> New
        </button>
      </div>
      <p className="text-[11px] leading-4 text-stone-600">
        Only the people in a chat can read it. The Dungeon Master never sees these.
      </p>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {threads.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <MessagesSquare className="size-6 text-stone-700" />
          <p className="text-xs text-stone-600">
            No side chats yet. Whisper a party member from their card, or start one here.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                onClick={() => setOpenThreadId(thread.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2 text-left transition-colors hover:border-amber-500/40"
              >
                {thread.kind === "dm" ? (
                  <UserRound className="size-4 shrink-0 text-stone-500" />
                ) : (
                  <Users className="size-4 shrink-0 text-stone-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-stone-200">
                  {threadLabel(thread)}
                </span>
                {thread.unread > 0 ? (
                  <span className="rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-1.5 text-[10px] font-semibold text-amber-950 shadow-glow-gold">
                    {thread.unread}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <NewChatForm
          campaignId={campaignId}
          members={members.filter((member) => member.userId !== meUserId)}
          onCreated={async (threadId) => {
            setCreating(false);
            await refreshSideChat();
            setOpenThreadId(threadId);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
    </div>
  );
}

function NewChatForm({
  campaignId,
  members,
  onCreated,
  onCancel,
}: {
  campaignId: string;
  members: CampaignMember[];
  onCreated: (threadId: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    if (selected.length === 0) {
      setError("Pick at least one member.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/side-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: selected.length === 1 ? "dm" : "group",
          memberUserIds: selected,
          title: selected.length > 1 ? title.trim() : "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the chat.");
        return;
      }
      await onCreated(data.thread.id);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3">
      <p className="mb-2 text-xs font-medium text-stone-400">Who&apos;s in it?</p>
      <ul className="space-y-1">
        {members.map((member) => (
          <li key={member.userId}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-stone-300 hover:bg-stone-900/60">
              <input
                type="checkbox"
                checked={selected.includes(member.userId)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, member.userId]
                      : current.filter((id) => id !== member.userId),
                  )
                }
                className="size-3.5 accent-amber-400"
              />
              {member.username}
            </label>
          </li>
        ))}
      </ul>
      {selected.length > 1 ? (
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={80}
          placeholder="Group name (optional)"
          className={cn(ui.input, "mt-2 text-sm")}
        />
      ) : null}
      {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-xs text-stone-500 hover:text-stone-300">
          Cancel
        </button>
        <button type="button" onClick={create} disabled={busy} className={ui.btnSmall}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null} Start chat
        </button>
      </div>
    </div>
  );
}

function ThreadView({
  campaignId,
  thread,
  label,
  members,
  meUserId,
  refreshSideChat,
  onBack,
}: {
  campaignId: string;
  thread: SideThread;
  label: string;
  members: CampaignMember[];
  meUserId: string;
  refreshSideChat: () => Promise<void>;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<SideMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastSeqRef = useRef(0);

  const markRead = useCallback(
    async (seq: number) => {
      if (seq <= 0) return;
      await fetch(`/api/campaigns/${campaignId}/side-chat/${thread.id}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lastSeq: seq }),
      }).catch(() => undefined);
      void refreshSideChat();
    },
    [campaignId, thread.id, refreshSideChat],
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/side-chat/${thread.id}/messages?afterSeq=${lastSeqRef.current}`,
      );
      if (!response.ok) return;
      const data = await response.json();
      const fresh = (data.messages ?? []) as SideMessage[];
      if (fresh.length > 0) {
        setMessages((current) => {
          const known = new Set(current.map((message) => message.id));
          return [...current, ...fresh.filter((message) => !known.has(message.id))];
        });
        const maxSeq = fresh[fresh.length - 1].seq;
        lastSeqRef.current = Math.max(lastSeqRef.current, maxSeq);
        void markRead(maxSeq);
      }
    } catch {
      // transient; next side_activity retries
    }
  }, [campaignId, thread.id, markRead]);

  // Initial load, then incremental loads whenever activity bumps the
  // thread's lastSeq past what we have.
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (thread.lastSeq > lastSeqRef.current) {
      void load();
    }
  }, [thread.lastSeq, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/campaigns/${campaignId}/side-chat/${thread.id}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not send.");
        return;
      }
      setInput("");
      const message = data.message as SideMessage;
      setMessages((current) => [...current, message]);
      lastSeqRef.current = Math.max(lastSeqRef.current, message.seq);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  const nameOf = (userId: string) =>
    members.find((member) => member.userId === userId)?.username ?? "someone";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          title="All chats"
          className="rounded p-1 text-stone-500 hover:bg-stone-900 hover:text-stone-300"
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-200">{label}</span>
      </div>
      {thread.kind === "group" ? (
        <p className="mb-2 truncate text-[11px] text-stone-600">
          {thread.memberUserIds.map(nameOf).join(", ")}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {messages.map((message) => {
          const mine = message.authorUserId === meUserId;
          return (
            <div key={message.id} className={cn("flex", mine && "justify-end")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm",
                  mine
                    ? "bg-amber-400/10 text-amber-100"
                    : "bg-stone-900/70 text-stone-200",
                )}
              >
                {!mine ? (
                  <p className="text-[10px] font-medium text-stone-500">
                    {nameOf(message.authorUserId)}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="mt-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-stone-700/70 bg-stone-950/80 p-1.5">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={`Message ${label}`}
            className="flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-stone-200 outline-none"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-lg bg-gradient-to-b from-amber-100 via-amber-200 to-amber-400 p-2 text-amber-950 transition-all duration-150 ease-snap active:scale-95 disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </button>
        </div>
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </form>
    </div>
  );
}
