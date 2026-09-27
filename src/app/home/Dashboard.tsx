"use client";

import { ScrollText } from "lucide-react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { ui } from "@/lib/ui";
import type { SessionUser } from "@/lib/campaign-types";
import { offersStoryModel, useCapabilities, type ClientCapabilities } from "@/lib/use-capabilities";
import { CreateCampaignDialog } from "@/app/CreateCampaignDialog";
import { AccountMenu, AppBrand, AppHomeButton } from "@/components/AccountMenu";
import { DeletionBanner } from "@/components/DeletionBanner";
import { NotificationBell } from "@/components/NotificationBell";
import { HowToPlayDialog } from "@/components/HowToPlayDialog";
import { Tooltip } from "@/components/ui/Tooltip";
import type { WorkshopSummary } from "@/app/workshop/types";
import { YourTables } from "@/app/home/CampaignList";
import { ContinueHero, EmptyHero, FailedHero, LoadingHero, RecapPanel, ScreenBackdrop } from "@/app/home/ContinueHero";
import { HomeFooter } from "@/app/home/HomeFooter";
import { JoinCard } from "@/app/home/JoinCard";
import { HomeMenu } from "@/app/home/QuickTiles";
import { WorkshopSection } from "@/app/home/WorkshopSection";
import { pickContinue, type HomeCampaign } from "@/app/home/types";
import { currentPathname, currentQuery, navigateTo, replaceAddress } from "@/lib/navigation";

// The desktop and Android shells' quick tiles land here with ?new=1 or
// ?new=solo and expect the wizard already open. Read once, at mount, as the
// initial dialog state: Home only mounts the dashboard after the session
// check resolves on the client, so there is no server render to disagree
// with, and no effect has to set state after the fact.
function requestedWizard(): "campaign" | "solo" | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = currentQuery().get("new");
  return value === "solo" ? "solo" : value === "1" ? "campaign" : null;
}

// The home is a title screen (docs: "ODM World Concepts", round 3a): the
// table you were last at fills the screen behind a Continue, the menu runs
// down the left like a game's main menu, the recap and your tables sit
// as raised night panels, and the bench, the sigil and the small print wait
// below the fold. Everything the old dashboard offered is still here; only
// the composition changed.
export function Dashboard({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const [campaigns, setCampaigns] = useState<HomeCampaign[]>([]);
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed list fetch must not read as "no campaigns": the empty-table
  // words are a statement about the account, not about the network.
  const [loadFailed, setLoadFailed] = useState(false);
  // Clone and delete failures, shown beside the save slots.
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
    const query = currentQuery();
    query.delete("new");
    replaceAddress(`${currentPathname()}${query.size ? `?${query}` : ""}`);
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
      !await appConfirm(
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
  // why both rows use it.
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
      // the per-row counts a slot renders, and the clone response is just the
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

  const continueCampaign = loading || loadFailed ? null : pickContinue(campaigns);
  const onCreated = (campaignId: string) => {
    navigateTo(`/campaigns/${campaignId}`);
  };

  return (
    <main className="ts-root bg-starfield">
      <ScreenBackdrop campaign={continueCampaign} />
      <span className="ts-corner ts-corner-tl" aria-hidden="true" />
      <span className="ts-corner ts-corner-tr" aria-hidden="true" />
      <span className="ts-corner ts-corner-bl" aria-hidden="true" />
      <span className="ts-corner ts-corner-br" aria-hidden="true" />

      <div className="ts-page">
        {/* The wordmark may shrink and wrap; the action cluster never does,
            so on a narrow phone (or a large system font) the account menu
            stays on screen instead of being pushed past the right edge. */}
        <header className="ts-header animate-fade-up">
          <AppBrand className="ts-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/ui/book-closed.webp" alt="" className="ts-brand-book" />
            <span className="ts-wordmark">Open Dungeon Master</span>
          </AppBrand>
          <div className="ts-cluster">
            <AppHomeButton />
            <NotificationBell />
            <Tooltip content="What this app is and how a table works" side="bottom">
              <button type="button" onClick={() => setHowToOpen(true)} className={ui.btnSmall} aria-label="How to play">
                <ScrollText className="size-4" />
                <span className="hidden sm:inline">How to play</span>
              </button>
            </Tooltip>
            <span className="ts-username" aria-hidden="true">{user.username}</span>
            <AccountMenu user={user} onLogout={onLogout} />
          </div>
        </header>
        {user.deletionDueAt ? <DeletionBanner dueAt={user.deletionDueAt} className="ts-deletion" /> : null}

        <section className="ts-stage" aria-label="Title screen">
          <div className="ts-stage-left">
            {/* The title block waits for the list: showing "empty table"
                before the answer arrives would flash a lie at every account
                with tables, and a failed fetch is not an empty account either. */}
            {loading ? (
              <LoadingHero />
            ) : loadFailed && campaigns.length === 0 ? (
              <FailedHero
                onRetry={() => {
                  setLoading(true);
                  void refresh();
                }}
              />
            ) : continueCampaign ? (
              <ContinueHero campaign={continueCampaign} userId={user.id} />
            ) : (
              <EmptyHero onNewCampaign={() => setCreateOpen(true)} />
            )}
            <HomeMenu
              onNewCampaign={() => setCreateOpen(true)}
              onSolo={() => setSoloOpen(true)}
              showSolo={offersStoryModel(capabilities)}
              onJoin={focusJoin}
            />
            <DmStatusLine capabilities={capabilities} />
          </div>
          <div className="ts-stage-right">
            {continueCampaign ? <RecapPanel campaign={continueCampaign} /> : null}
            <YourTables
              campaigns={campaigns}
              loading={loading}
              userId={user.id}
              cloningId={cloningId}
              actionError={actionError}
              onClone={clone}
              onDelete={deleteCampaign}
              onNewCampaign={() => setCreateOpen(true)}
            />
          </div>
        </section>

        <section className="ts-below">
          <WorkshopSection workshops={workshops} cloningId={cloningId} onClone={clone} />
          <JoinCard inputRef={joinInputRef} />
          <HomeFooter />
        </section>

        <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
        <CreateCampaignDialog solo open={soloOpen} onOpenChange={setSoloOpen} onCreated={onCreated} />
        <HowToPlayDialog open={howToOpen} onOpenChange={setHowToOpen} />
      </div>
    </main>
  );
}

// "The DM is awake · qwen3.6-35b · v0.23.4": one mono line at the foot of
// the menu, the way a title screen shows its build. The lamp is lit gold
// when the storyteller answers, ember when it is configured but not
// answering, and unlit on a server with no AI storyteller at all.
function DmStatusLine({ capabilities }: { capabilities: ClientCapabilities | null }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.version) setVersion(String(data.version));
      })
      .catch(() => {
        // the line simply omits the version
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const story = capabilities?.story;
  const tone = !capabilities ? "wait" : !story?.configured ? "off" : story.reachable ? "awake" : "dozing";
  const words =
    tone === "wait"
      ? "Waking the DM"
      : tone === "off"
        ? "No AI storyteller · human-run tables"
        : tone === "awake"
          ? "The DM is awake"
          : "The DM is not answering";
  const bits = [words];
  if (story?.model && tone !== "off") bits.push(story.model);
  if (version) bits.push(`v${version}`);
  return (
    <p className={`ts-status ts-status-${tone} ts-reveal`} style={{ animationDelay: "1200ms" }} aria-live="polite">
      <span className="ts-lamp" aria-hidden="true" />
      {bits.join(" · ")}
    </p>
  );
}
