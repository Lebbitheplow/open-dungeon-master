"use client";

import { Check, DatabaseBackup, Download, Loader2, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/ui/ConfirmDialog";

// Verified backups of the campaign state, mirroring scripts/odm-backup.mjs
// and scripts/odm-restore.mjs. An archive holds the encrypted database plus
// uploads, generated media, models and .env.server, so it carries the
// encryption key: treat it like a password.
type BackupEntry = {
  name: string;
  sizeBytes: number;
  createdAt: string;
  sha256: string;
};

type Proof = { campaigns: number; users: number; messages: number };

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function AdminBackupSection() {
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [dir, setDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyName, setBusyName] = useState("");
  const [verified, setVerified] = useState<Record<string, Proof>>({});
  const [restoredName, setRestoredName] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/backup")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setBackups(data?.backups ?? []);
        if (data?.dir) setDir(data.dir);
      })
      .catch(() => setBackups([]));
  }, []);

  async function create() {
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/admin/backup", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the backup.");
        return;
      }
      setBackups((current) => [data.backup, ...(current ?? [])].filter((entry, index, all) => all.findIndex((e) => e.name === entry.name) === index));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  async function verify(name: string) {
    setBusyName(name);
    setError("");
    try {
      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "verify" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "This archive failed verification.");
        return;
      }
      setVerified((current) => ({ ...current, [name]: data.proof }));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyName("");
    }
  }

  async function restore(name: string) {
    const sure = await appConfirm(
      `Restore ${name}? Everything now on this server — campaigns, accounts, uploads and settings — is replaced by the contents of this archive. Restart the server immediately afterwards; anything played before the restart is lost.`,
      { title: "Restore this backup?", actionLabel: "Restore", tone: "danger" },
    );
    if (!sure) return;
    setBusyName(name);
    setError("");
    try {
      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mode: "live" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "The restore failed.");
        return;
      }
      setRestoredName(name);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyName("");
    }
  }

  async function remove(name: string) {
    const sure = await appConfirm(`Delete the backup ${name}? The archive and its fingerprint go away.`, {
      title: "Delete this backup?",
      actionLabel: "Delete",
      tone: "danger",
    });
    if (!sure) return;
    const response = await fetch(`/api/admin/backup/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (response.ok) {
      setBackups((current) => (current ?? []).filter((entry) => entry.name !== name));
    }
  }

  if (backups === null) {
    return <div className="skeleton-block mt-3 h-16 rounded-xl" aria-label="Loading backups" />;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        A backup snapshots the encrypted campaign database, uploads, generated media, models and
        server settings into one archive. The archive carries the database encryption key, so keep
        it like a password: whoever holds it can read every campaign.{" "}
        {dir ? <span className="font-mono text-stone-600">{dir}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={create} disabled={creating} aria-busy={creating} className={ui.btnSmall}>
          {creating ? <Loader2 className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" />}
          Take backup now
        </button>
        {creating ? (
          <span className="text-xs text-stone-500">Snapshotting the database and packing the archive…</span>
        ) : null}
      </div>
      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}
      {restoredName ? (
        <p role="status" className="live-in text-sm text-amber-300">
          <TriangleAlert className="mr-1 inline size-4" />
          Restored {restoredName}. Restart the server now to load it; play continued before the
          restart is lost.
        </p>
      ) : null}
      {backups.length === 0 ? (
        <EmptyState art="scrolls" size="sm" title="No backups yet. Take one before a big session, or restore one you made with scripts/odm-backup.mjs." />
      ) : (
        <ul className="stagger space-y-2">
          {backups.map((backup) => (
            <li key={backup.name} className="plate-row flex-wrap gap-2">
              <span className="truncate font-mono text-xs text-stone-300" title={backup.name}>
                {backup.name}
              </span>
              <span className="text-xs tabular-nums text-stone-500">{formatSize(backup.sizeBytes)}</span>
              <span className="text-xs text-stone-500">{new Date(backup.createdAt).toLocaleString()}</span>
              {verified[backup.name] ? (
                <span
                  className="live-in inline-flex items-center gap-1 text-xs text-emerald-400"
                  title={`integrity ok — ${verified[backup.name].campaigns} campaigns, ${verified[backup.name].users} users, ${verified[backup.name].messages} messages`}
                >
                  <ShieldCheck className="size-3.5" />
                  verified
                </span>
              ) : null}
              {restoredName === backup.name ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                  <Check className="size-3.5" /> restored
                </span>
              ) : null}
              <span className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => verify(backup.name)}
                  disabled={busyName === backup.name}
                  aria-busy={busyName === backup.name}
                  title="Verify integrity and open the encrypted database without touching anything"
                  className={ui.btnSmall}
                >
                  {busyName === backup.name ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  {verified[backup.name] ? "Re-verify" : "Verify"}
                </button>
                {verified[backup.name] && restoredName !== backup.name ? (
                  <button
                    type="button"
                    onClick={() => restore(backup.name)}
                    disabled={busyName === backup.name}
                    title="Replace this server's state with the archive"
                    className={cn(ui.btnSmall, "hover:border-red-500/50 hover:text-red-400")}
                  >
                    Restore
                  </button>
                ) : null}
                <a
                  href={`/api/admin/backup/${encodeURIComponent(backup.name)}`}
                  download={backup.name}
                  title="Download the archive"
                  className={ui.btnSmall}
                >
                  <Download className="size-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => remove(backup.name)}
                  title={`Delete ${backup.name}`}
                  aria-label={`Delete ${backup.name}`}
                  className={cn(ui.btnSmall, "px-2 hover:border-red-500/50 hover:text-red-400")}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
              {backup.sha256 ? (
                <span className="w-full truncate font-mono text-[10px] text-stone-600" title={backup.sha256}>
                  sha256 {backup.sha256.slice(0, 16)}…
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
