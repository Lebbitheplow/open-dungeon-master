"use client";

import { Check, HeartHandshake, Loader2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { IconChip, PIXEL_ICONS, ui } from "@/lib/ui";
import { PageLoading, PageNotice, PageSection, PageShell } from "@/components/PageShell";

// The server's social circle: accounts are per-server, so these are the
// people at this table's door, not a global roster. Online means their
// notification stream is open somewhere on the server.

type FriendItem = {
  userId: string;
  username: string;
  avatar: { url: string } | null;
  since: string;
  online?: boolean;
};

type FriendsData = {
  friends: FriendItem[];
  incoming: FriendItem[];
  outgoing: FriendItem[];
};

type CampaignOption = {
  id: string;
  title: string;
};

type Note = { text: string; error: boolean };

function Avatar({ friend }: { friend: FriendItem }) {
  return friend.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={friend.avatar.url}
      alt=""
      className="size-9 shrink-0 rounded-full border border-amber-500/30 object-cover"
    />
  ) : (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-stone-700/60 bg-stone-900">
      <UserRound className="size-4 text-stone-500" />
    </span>
  );
}

// Rows inside a section card share one divider rhythm instead of nesting
// a card per person.
const ROW = "flex flex-wrap items-center gap-3 px-5 py-3";

export default function FriendsPage() {
  const [data, setData] = useState<FriendsData>({ friends: [], incoming: [], outgoing: [] });
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  // The add form's outcome ("Request sent." or an error) and per-person
  // outcomes (invite sent, decline failed), each shown next to what caused
  // them rather than in one shared banner.
  const [addNote, setAddNote] = useState<Note | null>(null);
  const [rowNotes, setRowNotes] = useState<Record<string, Note>>({});

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/friends");
      if (response.status === 401) {
        setAuthed(false);
        return;
      }
      if (response.ok) {
        setData(await response.json());
      }
    } catch {
      // Offline; the next poll retries.
    }
  }, []);

  useEffect(() => {
    // Deferred a tick, bell-style: load sets state, and state changes must
    // not launch synchronously from an effect body.
    const first = setTimeout(() => {
      void load().finally(() => setLoading(false));
    }, 0);
    // Online dots go stale as people come and go; refresh on the bell's
    // cadence, cheap enough to not matter.
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (payload?.campaigns) {
          setCampaigns(
            payload.campaigns.map((campaign: CampaignOption) => ({
              id: campaign.id,
              title: campaign.title,
            })),
          );
        }
      })
      .catch(() => undefined);
  }, []);

  function setRowNote(userId: string, text: string, error: boolean) {
    setRowNotes((current) => ({ ...current, [userId]: { text, error } }));
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || sending) {
      return;
    }
    setSending(true);
    setAddNote(null);
    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setAddNote({ text: payload.error ?? "Something went wrong.", error: true });
        return;
      }
      setAddNote({ text: payload.message ?? "Request sent.", error: false });
      setName("");
      void load();
    } finally {
      setSending(false);
    }
  }

  async function respond(userId: string, accept: boolean) {
    const response = await fetch("/api/friends/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, accept }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setRowNote(userId, payload.error ?? "Something went wrong.", true);
      return;
    }
    void load();
  }

  async function unfriend(friend: FriendItem) {
    if (!window.confirm(`Remove ${friend.username} from your friends?`)) {
      return;
    }
    const response = await fetch("/api/friends", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: friend.userId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setRowNote(friend.userId, payload.error ?? "Something went wrong.", true);
      return;
    }
    void load();
  }

  async function invite(userId: string, campaignId: string) {
    const response = await fetch("/api/friends/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendUserId: userId, campaignId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setRowNote(userId, payload.error ?? "Something went wrong.", true);
      return;
    }
    setRowNote(userId, "Invite sent.", false);
  }

  if (!authed) {
    return (
      <PageNotice>
        <Link href="/" className="text-amber-200 hover:text-amber-400">
          Log in
        </Link>{" "}
        to see your friends on this server.
      </PageNotice>
    );
  }

  if (loading) {
    return <PageLoading />;
  }

  return (
    <PageShell
      icon={PIXEL_ICONS.chats}
      title="Friends"
      blurb="People on this server; invite them to your campaigns."
    >
      <PageSection heading="Add a friend">
        <form onSubmit={add} className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Add by exact username"
            maxLength={64}
            aria-label="Username"
            className={ui.input}
          />
          <button type="submit" disabled={sending || !name.trim()} className={ui.btnPrimary}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : null} Add
          </button>
        </form>
        {addNote ? (
          <p className={cn("mt-2 text-sm", addNote.error ? "text-red-400" : "text-emerald-300")}>
            {addNote.text}
          </p>
        ) : null}
      </PageSection>

      {data.incoming.length > 0 ? (
        <PageSection heading="Requests for you" ribbon="Waiting on you" padded={false}>
          <ul className="divide-y divide-stone-800/70">
            {data.incoming.map((request) => (
              <li key={request.userId} className={ROW}>
                <Avatar friend={request} />
                <span className="min-w-0 flex-1 truncate font-medium text-stone-100">
                  {request.username}
                </span>
                {rowNotes[request.userId] ? (
                  <span className="text-xs text-red-400">{rowNotes[request.userId].text}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => respond(request.userId, true)}
                  className={ui.btnSmall}
                >
                  <Check className="size-4 text-emerald-300" /> Accept
                </button>
                <button
                  type="button"
                  onClick={() => respond(request.userId, false)}
                  className={ui.btnSmall}
                >
                  <X className="size-4 text-red-400" /> Decline
                </button>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}

      <PageSection heading="Friends" padded={data.friends.length === 0}>
        {data.friends.length === 0 ? (
          <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
            <IconChip icon={HeartHandshake} size="size-12" iconSize="size-5" />
            <div className="max-w-sm">
              <p className="text-balance font-serif text-2xl text-stone-200">
                No party outside the party yet.
              </p>
              <p className="mt-2 text-pretty text-sm text-stone-500">
                Add someone by their exact username on this server.
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-stone-800/70 pb-2">
            {data.friends.map((friend) => (
              <li key={friend.userId} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar friend={friend} />
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate font-medium text-stone-100">{friend.username}</span>
                    {friend.online ? (
                      <span
                        title="Online now"
                        className="size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.7)]"
                      />
                    ) : null}
                  </span>
                  {campaigns.length > 0 ? (
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) {
                          void invite(friend.userId, event.target.value);
                        }
                      }}
                      aria-label={`Invite ${friend.username} to a campaign`}
                      className={cn(ui.input, "w-auto max-w-40 py-1.5 text-stone-300")}
                    >
                      <option value="">Invite to campaign...</option>
                      {campaigns.map((campaign) => (
                        <option key={campaign.id} value={campaign.id}>
                          {campaign.title}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button type="button" onClick={() => unfriend(friend)} className={ui.btnSmall}>
                    <X className="size-4 text-red-400" /> Unfriend
                  </button>
                </div>
                {rowNotes[friend.userId] ? (
                  <p
                    className={cn(
                      "mt-1.5 pl-12 text-xs",
                      rowNotes[friend.userId].error ? "text-red-400" : "text-emerald-300",
                    )}
                  >
                    {rowNotes[friend.userId].text}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageSection>

      {data.outgoing.length > 0 ? (
        <PageSection heading="Sent requests" padded={false}>
          <ul className="divide-y divide-stone-800/70 pb-2">
            {data.outgoing.map((request) => (
              <li key={request.userId} className={ROW}>
                <Avatar friend={request} />
                <span className="min-w-0 flex-1 truncate text-stone-300">{request.username}</span>
                <span className="text-xs text-stone-500">Waiting</span>
                <button
                  type="button"
                  onClick={() => respond(request.userId, false)}
                  className={ui.btnSmall}
                >
                  <X className="size-4" /> Cancel
                </button>
              </li>
            ))}
          </ul>
        </PageSection>
      ) : null}
    </PageShell>
  );
}
