"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PageLoading, PageNotice } from "@/components/PageShell";
import type { MaskedConfig } from "@/app/admin/AdminSettingsFields";
import { SetupWizard, type SetupInfo } from "@/app/setup/SetupWizard";

type Me = { id: string; username: string; isAdmin: boolean; avatar?: { url: string } | null };

// The guided setup (docs: README "Quick start"). A fresh server's first
// account lands here; an admin can come back from the admin panel any time.
// Every API it calls re-checks the admin flag server-side.
export default function SetupPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<MaskedConfig | null>(null);
  const [info, setInfo] = useState<SetupInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    (async () => {
      const user = await fetch("/api/auth/me")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => (data?.user ?? null) as Me | null)
        .catch(() => null);
      if (!live) return;
      setMe(user);
      if (user?.isAdmin) {
        const [settings, setup] = await Promise.all([
          fetch("/api/admin/settings").then((response) => (response.ok ? response.json() : null)).catch(() => null),
          fetch("/api/admin/setup").then((response) => (response.ok ? response.json() : null)).catch(() => null),
        ]);
        if (!live) return;
        if (settings?.config) setConfig(settings.config as MaskedConfig);
        if (setup) setInfo(setup as SetupInfo);
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (loading) {
    return <PageLoading />;
  }

  if (!me?.isAdmin) {
    return (
      <PageNotice user={me}>
        Only the server&apos;s admins can set it up.{" "}
        <Link href="/" className="text-amber-200 hover:text-amber-400">
          Back to campaigns
        </Link>
      </PageNotice>
    );
  }

  // A world one of the apps hosts is set up on the app's Story AI screen.
  if (info?.deviceWorld) {
    return (
      <PageNotice user={me}>
        This world runs inside the app, which sets up its storyteller on its Story AI screen.{" "}
        <Link href="/admin" className="text-amber-200 hover:text-amber-400">
          Open the admin panel
        </Link>
      </PageNotice>
    );
  }

  if (!config || !info) {
    return (
      <PageNotice user={me}>
        The setup could not load this server&apos;s settings.{" "}
        <Link href="/admin" className="text-amber-200 hover:text-amber-400">
          Open the admin panel
        </Link>
      </PageNotice>
    );
  }

  return (
    <main className="su-page bg-starfield">
      <div className="su-shell panel ornate texture-noise shadow-elev-2">
        <SetupWizard config={config} info={info} />
      </div>
    </main>
  );
}
