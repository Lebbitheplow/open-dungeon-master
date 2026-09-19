"use client";

import { Check, Copy, KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { UserAvatar, ui } from "@/lib/ui";
import { KebabMenu } from "@/components/KebabMenu";
import { PageSkeleton } from "@/components/PageSkeleton";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";

type AdminUser = {
  id: string;
  username: string;
  avatar: { url: string } | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  hasDiscord: boolean;
  hasPassword: boolean;
  campaignCount: number;
  createdAt: string;
  // Set while the user has a self-service deletion pending.
  deletionDueAt: string | null;
};

// User management: promote/demote admins, reset passwords (temp password
// shown exactly once), delete accounts. All actions re-checked server-side.
export function AdminUsersPanel({ meId }: { meId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState<{ username: string; password: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/admin/users")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setUsers(data?.users ?? null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(userId: string, run: () => Promise<Response>) {
    setBusyId(userId);
    setError("");
    try {
      const response = await run();
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || "That didn't work.");
        return null;
      }
      return response;
    } finally {
      setBusyId(null);
    }
  }

  async function toggleAdmin(user: AdminUser) {
    const response = await act(user.id, () =>
      fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !user.isAdmin }),
      }),
    );
    if (response) refresh();
  }

  async function resetPassword(user: AdminUser) {
    const response = await act(user.id, () =>
      fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" }),
    );
    if (response) {
      const data = await response.json();
      setTempPassword({ username: user.username, password: data.tempPassword });
      setCopied(false);
      refresh();
    }
  }

  async function keepAccount(user: AdminUser) {
    const response = await act(user.id, () =>
      fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAccount: true }),
      }),
    );
    if (response) refresh();
  }

  async function deleteUser(user: AdminUser) {
    const sure = await appConfirm(
      "Their account, campaigns they own, characters, pictures and private chats are erased right now, with no grace period. Messages they wrote in other people's campaigns stay in those transcripts without their name.",
      { title: `Delete ${user.username}?`, actionLabel: "Delete forever", tone: "danger" },
    );
    if (!sure) return;
    const response = await act(user.id, () =>
      fetch(`/api/admin/users/${user.id}`, { method: "DELETE" }),
    );
    if (response) refresh();
  }

  // Everything that can be done to one account, for the kebab and for the
  // right-click or long press alike. Reset password is also the row's button.
  function actionsFor(user: AdminUser): ContextMenuItem[] {
    const busy = busyId === user.id;
    return [
      {
        id: "admin",
        label: user.isAdmin ? "Remove admin" : "Make admin",
        glyph: "tab-dm",
        disabled: busy,
        onSelect: () => void toggleAdmin(user),
      },
      { id: "reset", label: "Reset password", glyph: "tab-admin", disabled: busy, onSelect: () => void resetPassword(user) },
      ...(user.deletionDueAt
        ? [{ id: "keep", label: "Call off the scheduled deletion", glyph: "rest-hp", disabled: busy, onSelect: () => void keepAccount(user) }]
        : []),
      {
        id: "delete",
        label: user.deletionDueAt ? "Erase now instead of waiting" : "Delete user",
        glyph: "quest-failed",
        tone: "danger" as const,
        separated: true,
        // An admin cannot delete the account they are signed in with.
        disabled: busy || user.id === meId,
        onSelect: () => void deleteUser(user),
      },
    ];
  }

  if (!users) {
    return <PageSkeleton kind="flat" className="px-0 py-2" />;
  }

  return (
    <div className="space-y-4">
      {tempPassword ? (
        <div className="live-in panel ornate rounded-xl border-amber-500/40 p-4">
          <SectionHead title="Temporary password" glyph="tab-admin" />
          <p className="text-sm text-stone-200">
            Temporary password for <span className="text-amber-200">{tempPassword.username}</span>.
            It is shown only once; they must change it at next login.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-lg border border-amber-500/30 bg-stone-950/80 px-3 py-1.5 font-mono text-sm text-amber-100">
              {tempPassword.password}
            </code>
            <button
              type="button"
              className={ui.btnSmall}
              onClick={() => {
                navigator.clipboard.writeText(tempPassword.password);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className={ui.btnSmall} onClick={() => setTempPassword(null)}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}

      <section className="panel texture-noise rounded-xl p-5">
        <SectionHead
          level="h2"
          title="Accounts"
          glyph="tab-party"
          aside={<span className="count-pop tabular-nums">{users.length}</span>}
        />
        <ul className="stagger space-y-2">
          {users.map((user) => {
            const menu = actionsFor(user);
            return (
              <ContextMenu as="li" key={user.id} items={menu} label={user.username} className="plate-row">
                <span className="medallion">
                  <UserAvatar url={user.avatar?.url} userId={user.id} size="size-10" />
                </span>
                <div className="min-w-0 flex-1 basis-40">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm text-stone-100">
                    {user.username}
                    {user.id === meId ? <span className="text-xs text-stone-500">(you)</span> : null}
                    {user.isAdmin ? (
                      <span className="plate-chip">
                        <GameIcon icon={{ kind: "glyph", key: "tab-admin" }} size="size-4" /> Admin
                      </span>
                    ) : null}
                    {user.hasDiscord ? <span className="plate-chip" data-tone="indigo">Discord</span> : null}
                    {user.mustChangePassword ? <span className="plate-chip" data-tone="orange">Reset pending</span> : null}
                    {user.deletionDueAt ? (
                      <span
                        title={`Asked to delete their account; erased on ${new Date(user.deletionDueAt).toLocaleString()}`}
                        className="plate-chip"
                        data-tone="red"
                      >
                        Deletion {new Date(user.deletionDueAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-stone-500">
                    {user.campaignCount} campaign{user.campaignCount === 1 ? "" : "s"} · joined{" "}
                    {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    type="button"
                    title="Reset password"
                    disabled={busyId === user.id}
                    onClick={() => resetPassword(user)}
                    className={ui.btnSmall}
                  >
                    {busyId === user.id ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />} Reset
                  </button>
                  <KebabMenu items={menu} label={`More actions for ${user.username}`} heading={user.username} />
                </div>
              </ContextMenu>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
