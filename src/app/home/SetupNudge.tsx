"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";

// The title screen's "finish setting up" card, for an admin whose server has
// no working storyteller and who has neither finished the guided setup nor
// waved it away (src/lib/setup/state.ts decides, server side).
export function SetupNudge({ className }: { className?: string }) {
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/setup")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (live && data?.nudge === true) setShow(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!show) {
    return null;
  }

  function dismiss() {
    setLeaving(true);
    void fetch("/api/admin/setup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "dismissed" }),
    }).catch(() => undefined);
    // The card plays its leave before it goes.
    setTimeout(() => setShow(false), 180);
  }

  return (
    <div
      role="status"
      className={cn(
        "panel flex flex-wrap items-center gap-3 rounded-xl px-4 py-3",
        leaving ? "reveal-leave" : "reveal",
        className,
      )}
    >
      <GameIcon icon={{ kind: "glyph", key: "tab-settings" }} size="size-8" />
      <span className="min-w-0 flex-1 text-sm text-stone-200">
        <span className="block font-medium text-amber-100">Finish setting up your server</span>
        <span className="block text-xs text-stone-400">
          No storyteller is answering yet. The guided setup finds what runs on this computer and takes a few minutes.
        </span>
      </span>
      <span className="flex gap-2">
        <Link href="/setup" className={ui.btnPrimary}>
          Set it up
        </Link>
        <button type="button" onClick={dismiss} className={ui.btnSecondary}>
          Not now
        </button>
      </span>
    </div>
  );
}
