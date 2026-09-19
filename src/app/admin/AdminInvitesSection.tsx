"use client";

import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";

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
    // A revoked code cannot be brought back, and somebody may be holding it.
    const sure = await appConfirm(`Revoke the invite ${code}? Anyone still holding it will not be able to register with it.`, {
      title: "Revoke this invite?",
      actionLabel: "Revoke",
      tone: "danger",
    });
    if (!sure) return;
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
      <div className="skeleton-block mt-3 h-16 rounded-xl" aria-label="Loading invites" />
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <SectionHead title="Invite codes" glyph="tab-handout" level="h3" aside={<span className="tabular-nums">{invites.length}</span>} />
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
        <div className="text-sm">
          <span className="mb-1 block text-xs font-medium text-stone-400">Uses</span>
          <NumberStepper
            label="Uses"
            min={1}
            max={1000}
            value={maxUses}
            onChange={(next) => setMaxUses(Math.max(1, Math.min(1000, Number(next) || 1)))}
          />
        </div>
        <button type="button" onClick={create} disabled={creating} aria-busy={creating} className={ui.btnSmall}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          New invite
        </button>
      </div>
      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}
      {invites.length === 0 ? (
        <EmptyState art="scrolls" size="sm" title="No invite codes yet. Nobody can register until you create one." />
      ) : (
        <ul className="stagger space-y-2">
          {invites.map((invite) => {
            const exhausted = invite.usedCount >= invite.maxUses;
            return (
              <li
                key={invite.code}
                className="plate-row gap-2"
                data-tone={exhausted ? "muted" : undefined}
              >
                <button
                  type="button"
                  onClick={() => copy(invite.code)}
                  title="Copy the invite code"
                  className={cn(ui.btnSmall, "font-mono text-amber-200")}
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
                  aria-label={`Revoke the invite ${invite.code}`}
                  className={cn(ui.btnSmall, "ml-auto px-2 hover:border-red-500/50 hover:text-red-400")}
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
