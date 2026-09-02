"use client";

import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

// The bell: out-of-game news (sessions planned, moved, called off; someone
// can't make it; reminders and the idle-table nudge). Live over the
// account-wide SSE stream (/api/notifications/stream), with the 60s poll
// kept as the fallback so a dead stream costs a minute of latency, not
// news. Opening the panel marks everything read; the dots in the open panel
// still show what was new.

type BellNotification = {
  id: string;
  campaignId: string;
  kind: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BellNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  // Newest createdAt already seen; null until the first fetch lands so the
  // backlog on page load is never announced as news.
  const newestSeenRef = useRef<string | null>(null);
  // Permission is requested once per mount, on the first real notification
  // rather than on page load, so the browser prompt arrives when the user
  // can see why it is asking.
  const askedRef = useRef(false);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // System notifications for what arrived since the last look. Quiet by
  // design: nothing on the first load, nothing while the panel is open, and
  // nothing while the tab is visible (the badge is already in view).
  const announce = useCallback((list: BellNotification[]) => {
    const baseline = newestSeenRef.current;
    newestSeenRef.current = list[0]?.createdAt ?? "";
    if (baseline === null) {
      return;
    }
    const fresh = list.filter((item) => !item.readAt && item.createdAt > baseline);
    if (fresh.length === 0 || typeof Notification === "undefined") {
      return;
    }
    if (Notification.permission === "default") {
      if (!askedRef.current) {
        askedRef.current = true;
        void Notification.requestPermission().catch(() => undefined);
      }
      return;
    }
    if (Notification.permission !== "granted") {
      return;
    }
    if (openRef.current || document.visibilityState !== "hidden") {
      return;
    }
    for (const item of fresh.slice(0, 3)) {
      try {
        new Notification("Open Dungeon Master", { body: item.body, tag: item.id });
      } catch {
        // No notification daemon on this platform; the badge still shows.
      }
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications");
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      const list: BellNotification[] = data.notifications ?? [];
      setItems(list);
      setUnread(Number(data.unread) || 0);
      announce(list);
    } catch {
      // Offline; the next poll retries.
    }
  }, [announce]);

  useEffect(() => {
    // Deferred a tick: load sets state, and state changes must not launch
    // synchronously from an effect body.
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // The live channel: a contentless ping whenever the inbox changes; the
  // fetch above stays the source of truth. Reconnection is manual (close,
  // wait, redial) so a signed-out or dead stream never burns retries in the
  // browser's tight built-in loop.
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      if (stopped) {
        return;
      }
      source = new EventSource("/api/notifications/stream");
      source.addEventListener("notice", () => void load());
      source.onerror = () => {
        source?.close();
        retry = setTimeout(connect, 15_000);
      };
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      clearTimeout(retry);
    };
  }, [load]);

  // Click-away and Escape close it, same manners as the voice dock.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    const opening = !open;
    setOpen(opening);
    if (opening && unread > 0) {
      setUnread(0);
      void fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative rounded-lg border border-stone-800 bg-stone-900/60 p-2 text-stone-300 transition-colors hover:text-amber-200"
      >
        <Bell className="size-4" />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-stone-950">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-stone-800 bg-stone-950/95 p-2 shadow-xl backdrop-blur">
          {items.length === 0 ? (
            <p className="p-3 text-sm text-stone-500">Nothing yet. Quiet week.</p>
          ) : (
            <ul className="max-h-96 space-y-1 overflow-y-auto">
              {items.map((item) => (
                <li
                  key={item.id}
                  className={cn(
                    "rounded-lg p-2 text-sm text-stone-300",
                    !item.readAt && "bg-stone-900/80",
                  )}
                >
                  <p>{item.body}</p>
                  <p className="text-xs text-stone-600">{ago(item.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
