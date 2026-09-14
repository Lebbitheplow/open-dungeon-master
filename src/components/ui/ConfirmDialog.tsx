"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { ui } from "@/lib/ui";

// The app's own confirm and notice (docs/vtt-parity-implementation-plan.md
// section 10.5). window.confirm and window.alert are drawn by the browser,
// look nothing like the table, and the desktop shell does not implement
// every one of them. These ask the same question in the app's dialog,
// from anywhere: `await appConfirm("Delete it?")` resolves true when the
// person chose the action. One ConfirmHost is mounted in the root layout;
// when none is mounted (a screen compiled into the apps without the
// layout) the calls fall back to the browser's own, so nothing is blocked.

type Request =
  | {
      kind: "confirm";
      message: string;
      title: string;
      actionLabel: string;
      tone: "danger" | "plain";
      resolve: (ok: boolean) => void;
    }
  | { kind: "notice"; message: string; title: string; resolve: () => void };

const listeners = new Set<() => void>();
let queue: Request[] = [];
let hosts = 0;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function push(request: Request) {
  queue = [...queue, request];
  emit();
}

function shift() {
  queue = queue.slice(1);
  emit();
}

export type ConfirmOptions = {
  title?: string;
  actionLabel?: string;
  // Danger paints the action ember; plain keeps it gold.
  tone?: "danger" | "plain";
};

export function appConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  if (hosts === 0) {
    return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  }
  return new Promise((resolve) => {
    push({
      kind: "confirm",
      message,
      title: options.title ?? "Are you sure?",
      actionLabel: options.actionLabel ?? "Yes",
      tone: options.tone ?? "danger",
      resolve,
    });
  });
}

export function appNotice(message: string, title = "A word"): Promise<void> {
  if (hosts === 0) {
    if (typeof window !== "undefined") {
      window.alert(message);
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    push({ kind: "notice", message, title, resolve });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ConfirmHost() {
  const current = useSyncExternalStore(subscribe, () => queue[0] ?? null, () => null);
  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  }, []);
  if (!current) {
    return null;
  }
  const close = (ok: boolean) => {
    if (current.kind === "confirm") {
      current.resolve(ok);
    } else {
      current.resolve();
    }
    shift();
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          close(false);
        }
      }}
      title={current.title}
      width="w-[min(92vw,26rem)]"
    >
      <p className="text-sm leading-relaxed text-stone-300">{current.message}</p>
      <div className="mt-5 flex justify-end gap-2">
        {current.kind === "confirm" ? (
          <>
            <button type="button" onClick={() => close(false)} className={ui.btnSmall}>
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => close(true)}
              className={
                current.tone === "danger"
                  ? "rounded-md border border-red-800/70 bg-red-950/50 px-3 py-1.5 text-sm text-red-200 hover:bg-red-950/80"
                  : ui.btnPrimary
              }
            >
              {current.actionLabel}
            </button>
          </>
        ) : (
          <button type="button" autoFocus onClick={() => close(true)} className={ui.btnPrimary}>
            OK
          </button>
        )}
      </div>
    </Dialog>
  );
}
