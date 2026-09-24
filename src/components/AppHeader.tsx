"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { AccountMenu, AppBrand, AppHomeButton, type AccountMenuUser } from "@/components/AccountMenu";
import { DeletionBanner } from "@/components/DeletionBanner";
import { NotificationBell } from "@/components/NotificationBell";

// Shared top bar for the flat pages (characters, workshop, reference,
// settings, admin): wordmark home, notifications, account menu. The campaign
// table keeps its own dense header, and the home page keeps its hero.
export function AppHeader({
  user,
  className,
}: {
  // Pages that already fetched the user pass it through; pages that never
  // needed one omit the prop and the header asks /api/auth/me itself. null
  // means "known logged out" and skips the fetch.
  user?: AccountMenuUser | null;
  className?: string;
}) {
  const [fetched, setFetched] = useState<AccountMenuUser | null>(null);

  const selfFetch = user === undefined;
  useEffect(() => {
    if (!selfFetch) {
      return;
    }
    let cancelled = false;
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled) {
          setFetched(data?.user ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [selfFetch]);

  const resolved = selfFetch ? fetched : user;

  return (
    // min-h keeps the row the height of the avatar button even before the
    // user resolves, so the page header below never jumps.
    <header className={cn("mb-6", className)}>
      <div className="flex min-h-9 items-center justify-between gap-3">
      {/* The same mark the title screen wears: the closed book and the
          spaced-caps wordmark, in the theme's gold here rather than the
          painting's. */}
      <AppBrand className="app-brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/ui/book-closed.webp" alt="" className="app-brand-book" />
        <span className="app-wordmark">Open Dungeon Master</span>
      </AppBrand>
      {/* The cluster fades into a slot the row already reserves (min-h-9). */}
      {resolved ? (
        <div className="reveal flex shrink-0 items-center gap-2">
          <AppHomeButton />
          <NotificationBell />
          <AccountMenu user={resolved} />
        </div>
      ) : null}
      </div>
      {resolved?.deletionDueAt ? <DeletionBanner dueAt={resolved.deletionDueAt} /> : null}
    </header>
  );
}
