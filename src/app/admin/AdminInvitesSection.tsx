"use client";

import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { ui } from "@/lib/ui";

type AccountInvite = {
  code: string;
  note: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
};

// Management for account invite codes, shown inside the Accounts section
// while the signup mode is invite-only. Codes gate account creation, not
// campaign membership; the campaign room code is a different thing.
export function AdminInvitesSection() {
  const [invites, setInvites] = useState<AccountInvite[] | null>(null);
  const [note, setNote] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/invites")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setInvites(data?.invites ?? []))
      .catch(() => setInvites([]));
  }, []);

  async function create() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note, maxUses }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the invite.");
        return;
      }
      setInvites([data.invite, ...(invites ?? [])]);
      setNote("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function remove(code: string) {
    const response = await fetch(`/api/admin/invites/${code}`, { method: "DELETE" });
    if (response.ok) {
      setInvites((current) => (current ?? []).filter((invite) => invite.code !== code));
    }
  }

  async function copy(code: string) {
    if (await copyText(code)) {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(""), 1500);
    }
  }

  if (invites === null) {
    return (
      <div className="mt-3 flex justify-center py-4">
        <Loader2 className="size-4 animate-spin text-stone-500" />
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-stone-800 pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 text-sm">
          <span className="mb-1 block text-xs font-medium text-stone-400">Note (optional)</span>
          <input
            className={ui.input}
            value={note}
            maxLength={200}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Who this invite is for"
          />
        </label>
        <label className="w-24 text-sm">
          <span className="mb-1 block text-xs font-medium text-stone-400">Uses</span>
          <input
            type="number"
            min={1}
            max={1000}
            className={ui.input}
            value={maxUses}
            onChange={(event) =>
              setMaxUses(Math.max(1, Math.min(1000, Number(event.target.value) || 1)))
            }
          />
        </label>
        <button type="button" onClick={create} disabled={creating} className={ui.btnSmall}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          New invite
        </button>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {invites.length === 0 ? (
        <p className="text-xs text-stone-500">
          No invite codes yet. Nobody can register until you create one.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {invites.map((invite) => {
            const exhausted = invite.usedCount >= invite.maxUses;
            return (
              <li
                key={invite.code}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => copy(invite.code)}
                  title="Copy the invite code"
                  className="inline-flex items-center gap-1.5 font-mono text-sm text-amber-200 hover:text-amber-100"
                >
                  {copiedCode === invite.code ? (
                    <Check className="size-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {invite.code}
                </button>
                <span className={exhausted ? "text-xs text-red-400" : "text-xs text-stone-500"}>
                  {invite.usedCount}/{invite.maxUses} used
                </span>
                {invite.note ? (
                  <span className="truncate text-xs text-stone-500">{invite.note}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(invite.code)}
                  title="Revoke this invite"
                  className="ml-auto rounded-md p-1 text-stone-600 hover:text-red-400"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
