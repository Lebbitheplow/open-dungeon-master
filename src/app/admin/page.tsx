"use client";

import { Flag, Globe2, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PIXEL_ICONS } from "@/lib/ui";
import { PageLoading, PageNotice, PageShell } from "@/components/PageShell";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { AdminReportsPanel } from "@/app/admin/AdminReportsPanel";
import { AdminSettingsPanel } from "@/app/admin/AdminSettingsPanel";
import { AdminUsersPanel } from "@/app/admin/AdminUsersPanel";
import { AdminWorldsPanel } from "@/app/admin/AdminWorldsPanel";

type Me = {
  id: string;
  username: string;
  avatar?: { url: string } | null;
  isAdmin: boolean;
};

type Tab = "settings" | "worlds" | "users" | "reports";

const TABS: SegmentedOption<Tab>[] = [
  { value: "settings", label: "Server settings", icon: Settings2 },
  { value: "worlds", label: "Campaign plugins", icon: Globe2 },
  { value: "users", label: "Users", icon: Users },
  { value: "reports", label: "Reports", icon: Flag },
];

// Server control panel. The page only decides what to render; every admin
// API route re-checks the is_admin flag server-side.
export default function AdminPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("settings");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data?.user ?? null))
      .finally(() => setLoading(false));
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
      title="Admin panel"
      blurb={`Signed in as ${me.username}`}
    >
      <SegmentedControl
        options={TABS}
        value={tab}
        onChange={setTab}
        label="Admin section"
        className="w-full sm:w-auto"
      />

      {tab === "settings" ? (
        <AdminSettingsPanel />
      ) : tab === "worlds" ? (
        <AdminWorldsPanel />
      ) : tab === "reports" ? (
        <AdminReportsPanel />
      ) : (
        <AdminUsersPanel meId={me.id} />
      )}
    </PageShell>
  );
}
