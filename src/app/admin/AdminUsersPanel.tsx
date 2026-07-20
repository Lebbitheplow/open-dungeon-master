"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Copy, KeyRound, Loader2, Shield, ShieldOff, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

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
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

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

  async function deleteUser(user: AdminUser) {
    const response = await act(user.id, () =>
      fetch(`/api/admin/users/${user.id}`, { method: "DELETE" }),
    );
    setDeleting(null);
    if (response) refresh();
  }

  if (!users) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tempPassword ? (
        <div className="panel rounded-xl border-amber-500/40 p-4">
          <p className="text-sm text-stone-200">
            Temporary password for <span className="text-amber-200">{tempPassword.username}</span>.
            It is shown only once; they must change it at next login.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-lg border border-stone-700 bg-stone-950/80 px-3 py-1.5 font-mono text-sm text-amber-100">
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
              <Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="text-xs text-stone-500 hover:text-stone-300"
              onClick={() => setTempPassword(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <section className="texture-noise rounded-xl border border-stone-700/50 bg-stone-950/60 shadow-elev-1">
        <ul className="divide-y divide-stone-800/70">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 p-4">
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatar.url}
                  alt=""
                  className="size-8 rounded-full border border-stone-700 object-cover"
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full border border-stone-700 bg-stone-900">
                  <UserRound className="size-4 text-stone-600" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm text-stone-100">
                  {user.username}
                  {user.id === meId ? <span className="text-xs text-stone-500">(you)</span> : null}
                  {user.isAdmin ? (
                    <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                      Admin
                    </span>
                  ) : null}
                  {user.hasDiscord ? (
                    <span className="rounded border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-indigo-300">
                      Discord
                    </span>
                  ) : null}
                  {user.mustChangePassword ? (
                    <span className="rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-300">
                      Reset pending
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-stone-500">
                  {user.campaignCount} campaign{user.campaignCount === 1 ? "" : "s"} · joined{" "}
                  {new Date(user.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  title={user.isAdmin ? "Remove admin" : "Make admin"}
                  disabled={busyId === user.id}
                  onClick={() => toggleAdmin(user)}
                  className={ui.btnSmall}
                >
                  {user.isAdmin ? <ShieldOff className="size-3.5" /> : <Shield className="size-3.5" />}
                  {user.isAdmin ? "Demote" : "Admin"}
                </button>
                <button
                  type="button"
                  title="Reset password"
                  disabled={busyId === user.id}
                  onClick={() => resetPassword(user)}
                  className={ui.btnSmall}
                >
                  <KeyRound className="size-3.5" /> Reset
                </button>
                <button
                  type="button"
                  title="Delete user"
                  disabled={busyId === user.id || user.id === meId}
                  onClick={() => setDeleting(user)}
                  className={cn(ui.btnSmall, "hover:border-red-500/50 hover:text-red-400")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {deleting ? (
        <AlertDialog.Root open onOpenChange={(open) => !open && setDeleting(null)}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
            <AlertDialog.Content
              className={cn(
                ui.dialog,
                "fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(92vw,24rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto",
              )}
            >
              <AlertDialog.Title className="font-display text-lg tracking-wide text-amber-50">
                Delete {deleting.username}?
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-2 text-xs text-stone-400">
                Their account, campaigns they own, characters, and private chats are permanently
                deleted. Messages they wrote in other people&apos;s campaigns stay in those
                transcripts.
              </AlertDialog.Description>
              <div className="mt-4 flex justify-end gap-2">
                <AlertDialog.Cancel className={ui.btnSmall}>Cancel</AlertDialog.Cancel>
                <button
                  type="button"
                  onClick={() => deleteUser(deleting)}
                  disabled={busyId === deleting.id}
                  className={cn(ui.btnPrimary, "from-red-200 via-red-300 to-red-500 text-red-950")}
                >
                  {busyId === deleting.id ? <Loader2 className="size-4 animate-spin" /> : null}
                  Delete forever
                </button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </div>
  );
}
