"use client";

import { LoadFailed } from "@/app/campaigns/[campaignId]/PanelKit";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { BrushCleaning, Check, HardDrive, Loader2, Minimize2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { appConfirm } from "@/components/ui/ConfirmDialog";

// What the server keeps and what it weighs (src/lib/ops/retention.ts). The
// story stays forever; once a day the server clears what nothing reads back
// and hands the space to the disk. Files no row names are only listed here,
// for the admin to remove.
type Report = {
  at: string;
  eventsRemoved: number;
  tracesCleared: number;
  usageRowsMerged: number;
  bytesReclaimed: number;
};

type Stats = {
  databaseBytes: number;
  freePageBytes: number;
  incremental: boolean;
  diskFreeBytes: number;
  eventRows: number;
  usageRows: number;
  traceBytes: number;
  running: boolean;
  report: Report | null;
  nextAt: string | null;
};

type Orphans = { pictures: number; audio: number; bytes: number; sample: string[] };

function formatSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} KB`;
}

const count = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString()} ${value === 1 ? one : many}`;

export function AdminStorageSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [orphans, setOrphans] = useState<Orphans | null>(null);
  const { loadError, settle } = useLoadStatus();
  const [reloads, setReloads] = useState(0);
  const [busy, setBusy] = useState<"" | "tidy" | "compact" | "remove-orphans">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    readLoad<{ stats?: Stats; orphans?: Orphans }>(fetch("/api/admin/storage"), "Storage").then((outcome) => {
      settle(outcome);
      if (outcome.payload) {
        setStats(outcome.payload.stats ?? null);
        setOrphans(outcome.payload.orphans ?? null);
      }
    });
  }, [reloads, settle]);

  async function act(action: "tidy" | "compact" | "remove-orphans") {
    setBusy(action);
    setError("");
    setDone("");
    try {
      const response = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "The server could not do that.");
        return;
      }
      if (data.stats) setStats(data.stats);
      if (data.orphans) setOrphans(data.orphans);
      if (action === "compact" && data.compacted) {
        setDone(`Compacted: ${formatSize(data.compacted.before)} to ${formatSize(data.compacted.after)}.`);
      } else if (action === "remove-orphans" && data.removed) {
        setDone(`Removed ${count(data.removed.removed, "file")}, ${formatSize(data.removed.bytes)}.`);
      } else if (action === "tidy") {
        setDone("Tidied.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  async function compact() {
    const sure = await appConfirm(
      "Compact the database? It is rewritten without its free space, and play pauses while that runs: a second or two for most servers. Afterwards the daily tidy hands freed space back by itself.",
      { title: "Compact the database?", actionLabel: "Compact" },
    );
    if (sure) await act("compact");
  }

  async function removeOrphans() {
    if (!orphans) return;
    const sure = await appConfirm(
      `Remove ${count(orphans.pictures + orphans.audio, "file")} (${formatSize(orphans.bytes)}) that no campaign, account or setting names? A backup taken before now still holds them.`,
      { title: "Remove unused files?", actionLabel: "Remove", tone: "danger" },
    );
    if (sure) await act("remove-orphans");
  }

  if (stats === null && loadError) {
    return <LoadFailed error={loadError} onRetry={() => setReloads((current) => current + 1)} />;
  }

  if (stats === null) {
    return <div className="skeleton-block mt-3 h-16 rounded-xl" aria-label="Loading storage" />;
  }

  const report = stats.report;
  const orphanCount = orphans ? orphans.pictures + orphans.audio : 0;
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-stone-500">
        The story is kept forever: every message, roll, note, sheet, chapter snapshot and GM conversation. Once a day
        the server clears what nothing reads back (live updates older than a reconnecting page replays, prompt traces
        past a week, usage rows past 90 days merged by month with the same totals) and hands the space to the disk.
      </p>
      <ul className="stagger space-y-2">
        <li className="plate-row flex-wrap gap-2">
          <HardDrive className="size-4 text-stone-400" />
          <span className="text-sm text-stone-300">Database</span>
          <span className="text-xs tabular-nums text-stone-500">{formatSize(stats.databaseBytes)}</span>
          {stats.freePageBytes > 0 ? (
            <span className="text-xs tabular-nums text-stone-500">{formatSize(stats.freePageBytes)} free inside</span>
          ) : null}
          <span className={cn("text-xs", stats.incremental ? "text-emerald-400" : "text-amber-300")}>
            {stats.incremental ? "returns space daily" : "compact once to return space daily"}
          </span>
          {stats.diskFreeBytes >= 0 ? (
            <span className="ml-auto text-xs tabular-nums text-stone-500">{formatSize(stats.diskFreeBytes)} free on disk</span>
          ) : null}
        </li>
        <li className="plate-row flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-stone-500">
          <span>{count(stats.eventRows, "live update")}</span>
          <span>{count(stats.usageRows, "usage row")}</span>
          <span>{formatSize(stats.traceBytes)} of prompt traces</span>
        </li>
        <li className="plate-row flex-wrap gap-2 text-xs text-stone-500">
          {stats.running || busy === "tidy" ? (
            <span className="live-in inline-flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" /> Tidying…
            </span>
          ) : report ? (
            <span key={report.at} className="live-in">
              Last tidy {new Date(report.at).toLocaleString()}: {count(report.eventsRemoved, "update")} cleared,{" "}
              {count(report.tracesCleared, "trace")} dropped, {count(report.usageRowsMerged, "usage row")} merged,{" "}
              {formatSize(report.bytesReclaimed)} returned.
            </span>
          ) : (
            <span>No tidy since the server started{stats.nextAt ? `; the first runs at ${new Date(stats.nextAt).toLocaleTimeString()}` : ""}.</span>
          )}
        </li>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => act("tidy")} disabled={Boolean(busy) || stats.running} aria-busy={busy === "tidy"} className={ui.btnSmall}>
          {busy === "tidy" ? <Loader2 className="size-4 animate-spin" /> : <BrushCleaning className="size-4" />}
          Tidy now
        </button>
        <button type="button" onClick={compact} disabled={Boolean(busy) || stats.running} aria-busy={busy === "compact"} className={ui.btnSmall}>
          {busy === "compact" ? <Loader2 className="size-4 animate-spin" /> : <Minimize2 className="size-4" />}
          Compact database
        </button>
        {done ? (
          <span key={done} role="status" className="live-in inline-flex items-center gap-1 text-xs text-emerald-400">
            <Check className="size-3.5" /> {done}
          </span>
        ) : null}
      </div>
      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}
      {orphans ? (
        orphanCount > 0 ? (
          <div className="live-in space-y-2">
            <div className="plate-row flex-wrap gap-2">
              <span className="text-sm text-stone-300">
                {count(orphanCount, "file")} no campaign, account or setting names
              </span>
              <span className="text-xs tabular-nums text-stone-500">{formatSize(orphans.bytes)}</span>
              <button
                type="button"
                onClick={removeOrphans}
                disabled={Boolean(busy)}
                aria-busy={busy === "remove-orphans"}
                className={cn(ui.btnSmall, "ml-auto hover:border-red-500/50 hover:text-red-400")}
              >
                {busy === "remove-orphans" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Remove
              </button>
            </div>
            <ul className="stagger space-y-1 pl-1">
              {orphans.sample.map((url) => (
                <li key={url} className="truncate font-mono text-[11px] text-stone-600" title={url}>
                  {url}
                </li>
              ))}
              {orphanCount > orphans.sample.length ? (
                <li className="text-[11px] text-stone-600">and {count(orphanCount - orphans.sample.length, "more", "more")}</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <p className="live-in text-xs text-stone-500">Every stored picture, document and narration clip is still in use.</p>
        )
      ) : null}
    </div>
  );
}
