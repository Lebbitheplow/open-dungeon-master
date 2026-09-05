"use client";

import { ScrollText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PIXEL_ICONS, PixelTile, ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";
import { offersStoryModel, useCapabilities } from "@/lib/use-capabilities";
import { CreateCampaignDialog } from "@/app/CreateCampaignDialog";
import { AccountMenu } from "@/components/AccountMenu";
import { DeletionBanner } from "@/components/DeletionBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { HowToPlayDialog } from "@/components/HowToPlayDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import type { WorkshopSummary } from "@/app/workshop/types";
import { CampaignList } from "@/app/home/CampaignList";
import { ContinueHero, EmptyHero } from "@/app/home/ContinueHero";
import { HomeFooter } from "@/app/home/HomeFooter";
import { JoinCard } from "@/app/home/JoinCard";
import { QuickTiles } from "@/app/home/QuickTiles";
import { WorkshopSection } from "@/app/home/WorkshopSection";
import { pickContinue, type HomeCampaign } from "@/app/home/types";

// The desktop and Android shells' quick tiles land here with ?new=1 or
// ?new=solo and expect the wizard already open. Read once, at mount, as the
// initial dialog state: Home only mounts the dashboard after the session
// check resolves on the client, so there is no server render to disagree
// with, and no effect has to set state after the fact.
function requestedWizard(): "campaign" | "solo" | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = new URLSearchParams(window.location.search).get("new");
  return value === "solo" ? "solo" : value === "1" ? "campaign" : null;
}

export function Dashboard({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [campaigns, setCampaigns] = useState<HomeCampaign[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed list fetch must not read as "no campaigns": the empty-table
  // hero is a statement about the account, not about the network.
  const [loadFailed, setLoadFailed] = useState(false);
  // Clone and delete failures, shown beside the campaign grid.
  const [actionError, setActionError] = useState("");
  const [cloningId, setCloningId] = useState("");
  const [createOpen, setCreateOpen] = useState(() => requestedWizard() === "campaign");
  const [soloOpen, setSoloOpen] = useState(() => requestedWizard() === "solo");
  const [howToOpen, setHowToOpen] = useState(false);
  const joinInputRef = useRef<HTMLInputElement | null>(null);
  const capabilities = useCapabilities();

  // The query has done its job once the wizard is open; a reload or a share
  // of the address should not reopen it.
  useEffect(() => {
    if (!requestedWizard()) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  // Promise-chain shape for the same reason as refreshWorkshops below: the
  // state lands in callbacks, so the refetch reads as "subscribe to an
  // external system" to React and to the effect linter.
  const refresh = useCallback(
    () =>
      fetch("/api/campaigns")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) {
            setCampaigns(data.campaigns ?? []);
            setLoadFailed(false);
          } else {
            setLoadFailed(true);
          }
        })
        .catch(() => {
          setLoadFailed(true);
        })
        .finally(() => {
          setLoading(false);
        }),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The state lands in a .then callback rather than after an await, so the
  // refetch reads as "subscribe to an external system" to React and to the
  // effect linter, which is what it is. Same shape as ContentImportPicker.
  const refreshWorkshops = useCallback(
    () =>
      fetch("/api/workshops")
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) {
            setWorkshops(data.workshops ?? []);
          }
        })
        .catch(() => {
          // transient; the workshop page itself is one click away
        }),
    [],
  );

  useEffect(() => {
    void refreshWorkshops();
  }, [refreshWorkshops]);

  async function deleteCampaign(campaign: HomeCampaign) {
    if (
      !window.confirm(
        `Delete "${campaign.title}" for everyone? All characters, messages, and story progress are lost. This cannot be undone.`,
      )
    ) {
      return;
    }
    setActionError("");
    const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (response?.ok) {
      setCampaigns((current) => current.filter((entry) => entry.id !== campaign.id));
    } else {
      const data = await response?.json().catch(() => ({}));
      setActionError(data?.error || `Could not delete "${campaign.title}".`);
    }
  }

  // A copy of the world without the play: prep travels, the transcript does
  // not (src/lib/db/campaign-clone.ts). Same call for a workshop, which is
  // why both tiles use it.
  async function clone(id: string) {
    setCloningId(id);
    setActionError("");
    try {
      const response = await fetch(`/api/campaigns/${id}/clone`, { method: "POST" }).catch(
        () => null,
      );
      if (!response?.ok) {
        const data = await response?.json().catch(() => ({}));
        setActionError(data?.error || "Could not make the copy.");
        return;
      }
      const data = await response.json().catch(() => ({}));
      // Refetched rather than pushed onto the list: the list endpoints add
      // the per-row counts a tile renders, and the clone response is just the
      // new row.
      await (data.campaign?.kind === "workshop" ? refreshWorkshops() : refresh());
    } finally {
      setCloningId("");
    }
  }

  function focusJoin() {
    const input = joinInputRef.current;
    if (!input) {
      return;
    }
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
  }

  const continueCampaign = pickContinue(campaigns);
  const onCreated = (campaignId: string) => {
    window.location.href = `/campaigns/${campaignId}`;
  };

  return (
    <main className="bg-starfield flex-1">
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
        {/* The title block may shrink and wrap; the action cluster never does,
            so on a narrow phone (or a large system font) the account menu
            stays on screen instead of being pushed past the right edge. */}
        <header className="mb-8 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <PixelTile src={PIXEL_ICONS.story} />
            <div className="min-w-0">
              <h1 className="text-balance font-display text-lg leading-tight tracking-wide text-amber-50 sm:text-xl">
                Open Dungeon Master
              </h1>
              <p className="truncate text-sm text-stone-500">Signed in as {user.username}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell />
            <Tooltip content="What this app is and how a table works" side="bottom">
              <button type="button" onClick={() => setHowToOpen(true)} className={ui.btnSmall}>
                <ScrollText className="size-4" />
                <span className="hidden sm:inline">How to play</span>
              </button>
            </Tooltip>
            <AccountMenu user={user} onLogout={onLogout} />
          </div>
        </header>
        {user.deletionDueAt ? <DeletionBanner dueAt={user.deletionDueAt} className="mb-6" /> : null}

        {/* The hero waits for the list: showing "empty table" before the
            answer arrives would flash a lie at every account with tables,
            and a failed fetch is not an empty account either. */}
        {!loading && continueCampaign ? (
          <section className="mb-6">
            <ContinueHero campaign={continueCampaign} userId={user.id} />
          </section>
        ) : !loading && !loadFailed && campaigns.length === 0 ? (
          <section className="mb-6">
            <EmptyHero />
          </section>
        ) : null}

        <section className="mb-8">
          <QuickTiles
            onNewCampaign={() => setCreateOpen(true)}
            onSolo={() => setSoloOpen(true)}
            showSolo={offersStoryModel(capabilities)}
            onJoin={focusJoin}
          />
        </section>

        <CampaignList
          campaigns={campaigns}
          loading={loading}
          loadFailed={loadFailed}
          userId={user.id}
          cloningId={cloningId}
          actionError={actionError}
          onRetry={() => {
            setLoading(true);
            void refresh();
          }}
          onClone={clone}
          onDelete={deleteCampaign}
        />

        <WorkshopSection workshops={workshops} cloningId={cloningId} onClone={clone} />

        <JoinCard inputRef={joinInputRef} />

        <HomeFooter />

        <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
        <CreateCampaignDialog solo open={soloOpen} onOpenChange={setSoloOpen} onCreated={onCreated} />
        <HowToPlayDialog open={howToOpen} onOpenChange={setHowToOpen} />
      </div>
    </main>
  );
}
