"use client";

import { Flag, Gauge, Globe2, Settings2, Users, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PIXEL_ICONS, ui } from "@/lib/ui";
import { PageLoading, PageNotice, PageShell } from "@/components/PageShell";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { AdminReportsPanel } from "@/app/admin/AdminReportsPanel";
import { AdminSettingsPanel } from "@/app/admin/AdminSettingsPanel";
import { AdminUsagePanel } from "@/app/admin/AdminUsagePanel";
import { AdminUsersPanel } from "@/app/admin/AdminUsersPanel";
import { AdminWorldsPanel } from "@/app/admin/AdminWorldsPanel";

type Me = {
  id: string;
  username: string;
  avatar?: { url: string } | null;
  isAdmin: boolean;
};

type Tab = "settings" | "worlds" | "users" | "usage" | "reports";

const TABS: SegmentedOption<Tab>[] = [
  { value: "settings", label: "Server settings", icon: Settings2 },
  { value: "worlds", label: "Campaign plugins", icon: Globe2 },
  { value: "users", label: "Users", icon: Users },
  { value: "usage", label: "Usage", icon: Gauge },
  { value: "reports", label: "Reports", icon: Flag },
];

// Server control panel. The page only decides what to render; every admin
// API route re-checks the is_admin flag server-side.
export default function AdminPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("settings");
  // A world one of the apps hosts sets itself up on the app's Story AI
  // screen, so the guided setup is not offered there.
  const [deviceWorld, setDeviceWorld] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .finally(() => setLoading(false));
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setDeviceWorld(data?.deviceWorld === true))
      .catch(() => undefined);
  }, []);

  if (loading) {
    return <PageLoading />;
  }

  if (!me?.isAdmin) {
    return (
      <PageNotice user={me ?? null}>
        Admins only.{" "}
        <Link href="/" className="text-amber-200 hover:text-amber-400">
          Back to campaigns
        </Link>
      </PageNotice>
    );
  }

  return (
    <PageShell
      user={me}
      icon={PIXEL_ICONS.localData}
      glyph="tab-admin"
      title="Admin panel"
      blurb={`Signed in as ${me.username}`}
    >
      {/* Five long labels do not fit 360 px: the row scrolls rather than clipping the last mode. */}
      {/* The same settings, asked one question at a time, with what runs on
          this computer found and filled in (src/app/setup). */}
      {deviceWorld ? null : (
      <div className="panel reveal flex flex-wrap items-center gap-3 rounded-xl px-4 py-3">
        <span className="min-w-0 flex-1 text-sm text-stone-300">
          <span className="block text-stone-100">Guided setup</span>
          <span className="block text-xs text-stone-500">
            Storyteller, pictures, voice, players and your own agent, one question at a time.
          </span>
        </span>
        <Link href="/setup" className={ui.btnSecondary}>
          <Wand2 className="size-4" /> Run it
        </Link>
      </div>
      )}

      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={setTab}
          label="Admin section"
          className="w-max"
        />
      </div>

      <div key={tab} className="motion-tab space-y-4">
        {tab === "settings" ? (
          <AdminSettingsPanel />
        ) : tab === "worlds" ? (
          <AdminWorldsPanel />
        ) : tab === "reports" ? (
          <AdminReportsPanel />
        ) : tab === "usage" ? (
          <AdminUsagePanel />
        ) : (
          <AdminUsersPanel meId={me.id} />
        )}
      </div>
    </PageShell>
  );
}
