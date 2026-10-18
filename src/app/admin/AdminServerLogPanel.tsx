"use client";

import { Copy, Download, Search } from "lucide-react";
import { textKey } from "@/lib/language/text-logic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadFailed } from "@/app/campaigns/[campaignId]/PanelKit";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SectionHead } from "@/components/ui/SectionHead";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { Switch } from "@/components/ui/Switch";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { downloadBlob } from "@/lib/download";
import { readLoad, useLoadStatus } from "@/lib/load-state";
import { ui } from "@/lib/ui";
import type { ServerLogEntry, ServerLogPage } from "@/lib/server-log";

type Filter = "all" | "warn" | "error";

const FILTERS: SegmentedOption<Filter>[] = [
  { value: "all", label: "Everything" },
  { value: "warn", label: "Warnings" },
  { value: "error", label: "Errors" },
];

const LEVEL_TONE: Record<ServerLogEntry["level"], string> = {
  debug: "text-stone-500",
  info: "text-stone-300",
  warn: "text-amber-300",
  error: "text-red-300",
};

const KEEP = 2_000;
const POLL_MS = 2_000;

function clock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// The server's recent console, live (issue #383): what a stuck turn, a
// refused model call or a player who cannot connect left in the log, read
// from the admin panel instead of the machine's terminal. Every line still
// goes to the console too; this keeps the last two thousand since the
// server started, with keys and tokens cut out.
export function AdminServerLogPanel() {
  const [entries, setEntries] = useState<ServerLogEntry[]>([]);
  const [meta, setMeta] = useState<Pick<ServerLogPage, "startedAt" | "capacity" | "firstSeq"> | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [note, setNote] = useState("");
  const { loaded, loadError, settle } = useLoadStatus();
  const latest = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const pull = useCallback(async () => {
    const outcome = await readLoad<ServerLogPage>(fetch(`/api/admin/logs?after=${latest.current}`, { cache: "no-store" }), "The server log");
    settle(outcome);
    const page = outcome.payload;
    if (!page) {
      return;
    }
    // A restarted server starts its count again: read it from the top.
    if (page.latestSeq < latest.current) {
      latest.current = 0;
      setEntries([]);
      return;
    }
    latest.current = page.latestSeq;
    setMeta({ startedAt: page.startedAt, capacity: page.capacity, firstSeq: page.firstSeq });
    if (page.entries.length) {
      setEntries((kept) => [...kept, ...page.entries].slice(-KEEP));
    }
  }, [settle]);

  useEffect(() => {
    void pull();
  }, [pull]);

  // Live while following and while the page is in view.
  useEffect(() => {
    if (!follow) {
      return;
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void pull();
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [follow, pull]);

  const shown = useMemo(() => {
    const needle = textKey(query);
    return entries.filter(
      (entry) =>
        (filter === "all" || entry.level === "error" || (filter === "warn" && entry.level === "warn")) &&
        (!needle || textKey(entry.text).includes(needle)),
    );
  }, [entries, filter, query]);

  useEffect(() => {
    if (follow && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [shown, follow]);

  const asText = (lines: ServerLogEntry[]) =>
    lines.map((entry) => `${new Date(entry.at).toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.text}`).join("\n");

  async function copy() {
    setNote((await copyText(asText(shown))) ? `Copied ${shown.length} line${shown.length === 1 ? "" : "s"}.` : "The clipboard refused the copy.");
  }

  async function download() {
    setNote("");
    const response = await fetch("/api/admin/logs?format=text", { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setNote("The log could not be downloaded.");
      return;
    }
    downloadBlob(`odm-server-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`, await response.blob());
  }

  if (!loaded && !loadError) {
    return <PageSkeleton />;
  }

  return (
    <section className="panel reveal space-y-3 rounded-xl p-4">
      <SectionHead
        title="Server log"
        glyph="cue-bell"
        aside={
          <span className="inline-flex items-center gap-2 text-xs text-stone-400">
            Live
            <Switch on={follow} onChange={setFollow} label="Follow the log live" />
          </span>
        }
      />
      <p className="text-xs text-stone-500">
        {meta
          ? `The last ${meta.capacity.toLocaleString()} lines since the server started at ${new Date(meta.startedAt).toLocaleString()}. `
          : ""}
        The server&apos;s console keeps every line as well (the terminal, <code>docker logs</code>, or the desktop
        app&apos;s local-server.log). Keys and tokens are cut out.
      </p>
      {loadError ? <LoadFailed error={loadError} onRetry={() => void pull()} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} size="sm" label="Show" />
        <label className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the log"
            aria-label="Search the log"
            className={cn(ui.input, "py-1.5 pl-8 text-sm")}
          />
        </label>
        <button type="button" onClick={() => void copy()} className={ui.btnSmall} disabled={!shown.length}>
          <Copy className="size-3.5" /> Copy
        </button>
        <button type="button" onClick={() => void download()} className={ui.btnSmall}>
          <Download className="size-3.5" /> Download
        </button>
      </div>
      {note ? <p className="live-in text-xs text-stone-400">{note}</p> : null}
      {shown.length ? (
        <div
          ref={scroller}
          onWheel={() => setFollow(false)}
          className="max-h-[60vh] overflow-auto rounded-lg border border-white/5 bg-black/40 p-2 font-mono text-[11.5px] leading-relaxed"
        >
          {shown.map((entry) => (
            <div key={entry.seq} className={cn("live-in whitespace-pre-wrap break-words", LEVEL_TONE[entry.level])}>
              <span className="select-none text-stone-600">{clock(entry.at)} </span>
              {entry.text}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          art="board"
          size="sm"
          title={entries.length ? "Nothing matches" : "Nothing logged yet"}
          hint={entries.length ? "Try another filter or search." : "Lines appear here as the server writes them."}
        />
      )}
    </section>
  );
}
