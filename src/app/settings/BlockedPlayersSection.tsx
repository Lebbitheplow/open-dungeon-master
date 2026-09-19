"use client";

import { ShieldBan } from "lucide-react";
import { useEffect, useState } from "react";
import { UserAvatar, ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
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
      glyph="attitude-hostile"
      intro="Blocked players' table messages are hidden from you, and neither of you can open a private chat or send a friend request. Block someone from their message or from the party list."
    >
      {blocked === null ? (
        <div className="skeleton-block h-12 rounded-xl" aria-label="Loading blocked players" />
      ) : blocked.length === 0 ? (
        <EmptyState art="board" size="sm" title="Nobody blocked." />
      ) : (
        <ul className="stagger space-y-2">
          {blocked.map((entry) => (
            <li key={entry.userId} className="plate-row">
              <span className="medallion">
                <UserAvatar url={entry.avatar?.url} userId={entry.userId} size="size-9" />
              </span>
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
