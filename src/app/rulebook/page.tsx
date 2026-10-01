"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppHeader } from "@/components/AppHeader";
import { RulebookReader } from "@/components/rulebook/RulebookReader";
import { currentQuery, replaceAddress } from "@/lib/navigation";
import { shellHost } from "@/lib/shell-host";

// /rulebook: the whole SRD 5.1 as a book, for players and game masters alike.
// ?page=combat&at=grappling opens straight onto a passage; a plain visit
// opens the cover onto wherever this device last left off.

const noSubscribe = () => () => undefined;
const NONE = { page: "", at: "" };

// The address the reader arrived with, read once per visit: the page writes
// its own address as it turns, and that must not reopen the book.
let arrival: { page: string; at: string } | null = null;
function arrivalQuery() {
  if (!arrival) {
    const query = currentQuery();
    arrival = { page: query.get("page") ?? "", at: query.get("at") ?? "" };
  }
  return arrival;
}

export default function RulebookPage() {
  // Read on the client only: the server renders the closed cover, and a deep
  // link takes it away before the first paint.
  const { page, at } = useSyncExternalStore(noSubscribe, arrivalQuery, () => NONE);
  useEffect(
    () => () => {
      arrival = null;
    },
    [],
  );

  // The address follows the page, so a reload or a shared link lands on it.
  // Not inside the apps: their router crossfades every change of address,
  // which would fight the turning leaf.
  const remember = useCallback((id: string, anchor?: string) => {
    if (shellHost()) return;
    const query = new URLSearchParams({ page: id });
    if (anchor) query.set("at", anchor);
    replaceAddress(`/rulebook?${query}`);
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-[92rem] flex-1 flex-col px-3 pb-4 pt-4 sm:px-6 sm:pt-6">
      <AppHeader className="mb-4" />
      <RulebookReader
        // Remounts once, when hydration finds a deep link; never on a turn.
        key={page ? "deep" : "plain"}
        startAt={page || undefined}
        startAnchor={at || undefined}
        cover={!page}
        onPageChange={remember}
      />
    </main>
  );
}
