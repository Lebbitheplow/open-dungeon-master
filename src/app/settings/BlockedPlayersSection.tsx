"use client";

import { Loader2, ShieldBan, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";

type Blocked = {
  userId: string;
  username: string;
  avatar: { url: string } | null;
  createdAt: string;
};

// Who this account has blocked on this server, with the way back.
export function BlockedPlayersSection() {
  const [blocked, setBlocked] = useState<Blocked[] | null>(null);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    fetch("/api/profile/blocks")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setBlocked(data?.blocked ?? []));
  }, []);

  async function unblock(userId: string) {
    setBusyId(userId);
    try {
      const response = await fetch("/api/profile/blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) {
        const data = await response.json();
        setBlocked(data.blocked ?? []);
      }
    } finally {
      setBusyId("");
    }
  }

  return (
    <PageSection
      heading="Blocked players"
      intro="Blocked players' table messages are hidden from you, and neither of you can open a private chat or send a friend request. Block someone from their message or from the party list."
    >
      {blocked === null ? (
        <Loader2 className="size-4 animate-spin text-stone-500" />
      ) : blocked.length === 0 ? (
        <p className="text-sm text-stone-500">Nobody blocked.</p>
      ) : (
        <ul className="divide-y divide-stone-800/70">
          {blocked.map((entry) => (
            <li key={entry.userId} className="flex items-center gap-3 py-2">
              {entry.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.avatar.url}
                  alt=""
                  className="size-7 rounded-full border border-stone-700 object-cover"
                />
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900">
                  <UserRound className="size-3.5 text-stone-600" />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-stone-200">
                {entry.username}
              </span>
              <button
                type="button"
                disabled={busyId === entry.userId}
                onClick={() => unblock(entry.userId)}
                className={ui.btnSmall}
              >
                <ShieldBan className="size-3.5" /> Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageSection>
  );
}
