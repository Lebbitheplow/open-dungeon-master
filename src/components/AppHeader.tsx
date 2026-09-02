"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { PIXEL_ICONS, PixelTile } from "@/lib/ui";
import { AccountMenu, type AccountMenuUser } from "@/components/AccountMenu";
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
    <header className={cn("mb-6 flex items-center justify-between gap-3", className)}>
      <Link
        href="/"
        className="flex min-w-0 items-center gap-2.5 rounded-md outline-none transition-colors hover:text-amber-200 focus-visible:text-amber-200"
      >
        <PixelTile src={PIXEL_ICONS.story} size="size-8" />
        <span className="text-balance font-display text-base leading-tight tracking-wide text-amber-50 sm:text-lg">
          Open Dungeon Master
        </span>
      </Link>
      {resolved ? (
        <div className="flex shrink-0 items-center gap-2">
          <NotificationBell />
          <AccountMenu user={resolved} />
        </div>
      ) : null}
    </header>
  );
}
