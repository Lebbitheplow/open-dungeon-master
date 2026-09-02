"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { shellShare, type ShellShare, type ShellShareStatus } from "@/lib/shell-host";

// Sharing the app's own world from inside the game. A lobby is where a
// campaign becomes something other people join, so opening one (autoStart)
// puts the world on the internet without a separate trip to the app's home
// screen; the invite dialog then shows the address and the off switch.
// Outside the apps everything here is inert: share is null and supported
// stays false.

// window.odmShell is set once before any page script runs and never changes.
const subscribeNever = () => () => {};

export function useShellShare(autoStart: boolean) {
  const share = useSyncExternalStore<ShellShare | null>(subscribeNever, shellShare, () => null);
  const [status, setStatus] = useState<ShellShareStatus | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!share) return;
    let live = true;
    share
      .status()
      .then((current) => {
        if (live) setStatus(current);
      })
      .catch(() => undefined);
    const unsubscribe = share.subscribe((next) => {
      if (live) setStatus(next);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [share]);

  // No optimistic "starting" here: both apps report that state through the
  // subscription within a moment, and the desktop app only answers once the
  // tunnel is up.
  const start = useCallback(async () => {
    if (!share) return;
    const next = await share.start().catch(() => null);
    if (next) setStatus(next);
  }, [share]);

  const stop = useCallback(async () => {
    if (!share) return;
    const next = await share.stop().catch(() => null);
    if (next) setStatus(next);
  }, [share]);

  // The outcome arrives through the subscription above, so the effect only
  // asks and touches no state itself.
  useEffect(() => {
    if (!autoStart || !share || !status?.supported || attempted.current) return;
    if (status.state !== "stopped") return;
    attempted.current = true;
    void share.start().catch(() => undefined);
  }, [autoStart, share, status]);

  return { supported: !!status?.supported, status, start, stop };
}
