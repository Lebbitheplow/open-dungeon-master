"use client";

import { EmptyState } from "@/components/EmptyState";
import { CircleHelp, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { headIcon } from "@/app/workshop/kit";
import { PageSkeleton } from "@/components/PageSkeleton";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { workshopPlate } from "@/app/workshop/plates";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { AppHeader } from "@/components/AppHeader";
import { DEFAULT_TARGET_PARTY } from "@/lib/workshop/kind";
import { ImportBundleButton } from "@/app/workshop/ImportBundleButton";
import { WorkshopHelpDialog } from "@/components/WorkshopHelpDialog";
import { GuidedTour } from "@/components/ui/GuidedTour";
import { markTourSeen, tourSeen } from "@/lib/tours/logic";
import { SHELF_TOUR, SHELF_TOUR_ID } from "@/lib/tours/workshop";
import type { WorkshopSummary } from "@/app/workshop/types";
import { navigateTo } from "@/lib/navigation";

// The shelf. A workshop is a place to build maps, NPCs, monsters, story and
// rules before any table exists, and to import them into a campaign later
// (docs/workshop-plan.md). Each one stands alone: nothing here requires
// finishing anything else first.
//
// Every workshop is a tile. The tile is a link; Duplicate and Delete sit on
// top of it as their own buttons, since a button cannot live inside a link.

export default function WorkshopListPage() {
  const [workshops, setWorkshops] = useState<WorkshopSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [size, setSize] = useState(DEFAULT_TARGET_PARTY.size);
  const [level, setLevel] = useState(DEFAULT_TARGET_PARTY.level);
  const [busy, setBusy] = useState(false);
  const [cloningId, setCloningId] = useState("");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [touring, setTouring] = useState(false);

  // The shelf's tour runs once, the first time the shelf is seen with its
  // list drawn. Help replays it.
  useEffect(() => {
    if (loading || tourSeen(window.localStorage, SHELF_TOUR_ID)) return;
    const timer = window.setTimeout(() => setTouring(true), 900);
    return () => clearTimeout(timer);
  }, [loading]);
  function closeTour() {
    markTourSeen(window.localStorage, SHELF_TOUR_ID);
    setTouring(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workshops")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setWorkshops(data.workshops ?? []);
        }
      })
      .catch(() => {
        // transient; the next action reloads
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/workshops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), targetParty: { size, level } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create that workshop.");
        return;
      }
      navigateTo(`/workshop/${data.workshop.id}`);
    } finally {
      setBusy(false);
    }
  }

  // A copy of the workshop and everything in it, board included
  // (src/lib/db/campaign-clone.ts). The usual reason is a second version of
  // the same region without risking the first.
  async function clone(workshop: WorkshopSummary) {
    setCloningId(workshop.id);
    try {
      const response = await fetch(`/api/campaigns/${workshop.id}/clone`, { method: "POST" });
      if (!response.ok) {
        return;
      }
      const listed = await fetch("/api/workshops").catch(() => null);
      if (listed?.ok) {
        const data = await listed.json();
        setWorkshops(data.workshops ?? []);
      }
    } finally {
      setCloningId("");
    }
  }

  async function remove(workshop: WorkshopSummary) {
    if (
      !await appConfirm(
        `Delete "${workshop.title}"? Every map, NPC, table and note in it is lost. Anything already imported into a campaign stays there.`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/workshops/${workshop.id}`, { method: "DELETE" });
    if (response.ok) {
      setWorkshops((current) => current.filter((entry) => entry.id !== workshop.id));
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
      <AppHeader />
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <GameIcon icon={{ kind: "glyph", key: "system-homebrew" }} size="size-12" />
          <div>
            <h1 className="gold-title animate-fade-up font-display text-2xl">Workshop</h1>
            <p className="text-sm text-stone-500">
              Build maps, NPCs, monsters, story and rules before the table exists. Import any of
              it when you start a campaign.
            </p>
          </div>
          <button
            type="button"
            aria-label="How workshops work"
            title="Guides and tours"
            onClick={() => setHelpOpen(true)}
            data-tour="shelf-help"
            className={cn(ui.iconAction, headIcon, "ml-auto self-start")}
          >
            <CircleHelp className="size-4" />
          </button>
        </div>
      </header>
      <WorkshopHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        tours={[
          {
            label: "Tour the shelf",
            detail: "Starting a workshop, importing a bundle, and what the tiles do.",
            onStart: () => setTouring(true),
          },
        ]}
      />
      <GuidedTour open={touring} steps={SHELF_TOUR} onClose={closeTour} />

      <section className="mb-6">
        {creating ? (
          <form onSubmit={create} className={`${ui.card} reveal ornate space-y-3 p-4`}>
            <SectionHead title="New workshop" glyph="system-storyboard" />
            <label className="block">
              <span className="mb-1 block font-display text-[11px] tracking-[0.1em] text-amber-300/85">Name</span>
              <input
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={80}
                placeholder="The Saltmarch campaign, Session zero prep..."
                className={ui.input}
              />
            </label>
            <div>
              <span className="mb-1 block font-display text-[11px] tracking-[0.1em] text-amber-300/85">Building for a party of</span>
              <div className="flex flex-wrap items-center gap-2">
                <NumberStepper label="Party size" min={1} max={8} value={size} onChange={setSize} />
                <span className="text-sm text-stone-400">heroes at level</span>
                <NumberStepper label="Party level" min={1} max={20} value={level} onChange={setLevel} />
              </div>
              <span className="mt-1 block text-xs text-stone-500">
                The encounter calculator and the odds preview budget against this. Change it
                anytime.
              </span>
            </div>
            {error ? <p className="motion-shake text-sm text-red-400">{error}</p> : null}
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !title.trim()} className={ui.btnPrimary}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null} Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setError("");
                }}
                className={ui.btnSecondary}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              data-tour="shelf-new"
              className={ui.btnPrimary}
            >
              <Plus className="size-4" /> New workshop
            </button>
            <div data-tour="shelf-import">
              <ImportBundleButton />
            </div>
          </div>
        )}
      </section>

      {loading ? (
        <PageSkeleton kind="shelf" className="px-0 py-2" />
      ) : workshops.length ? (
        <ul className="stagger-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-tour="shelf-list">
          {workshops.map((workshop) => (
            <ContextMenu
              as="li"
              key={workshop.id}
              className="group relative"
              label={workshop.title}
              // The tile's link and its two buttons again; both stay on the tile.
              items={[
                { id: "open", label: "Open", glyph: "system-storyboard", onSelect: () => navigateTo(`/workshop/${workshop.id}`) },
                { id: "duplicate", label: "Duplicate", glyph: "tab-notes", disabled: cloningId === workshop.id, onSelect: () => void clone(workshop) },
                { id: "delete", label: "Delete", glyph: "quest-failed", tone: "danger", separated: true, onSelect: () => void remove(workshop) },
              ]}
            >
              <Link
                href={`/workshop/${workshop.id}`}
                className={cn(
                  ui.tile,
                  ui.tileHover,
                  "aspect-[5/4] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={workshopPlate(workshop.id)}
                  alt=""
                  loading="lazy"
                  className="aspect-video w-full rounded-lg border border-amber-400/20 object-cover"
                />
                <span className="line-clamp-2 font-display text-[13px] font-semibold tracking-[0.12em] text-amber-50">
                  {workshop.title}
                </span>
                <span className="text-xs text-stone-500">
                  Party of {workshop.gameSettings.targetParty.size} at level{" "}
                  {workshop.gameSettings.targetParty.level}
                </span>
              </Link>
              <div className="absolute right-2 top-2 flex gap-0.5">
                <button
                  type="button"
                  disabled={cloningId === workshop.id}
                  onClick={() => void clone(workshop)}
                  aria-label={`Duplicate ${workshop.title}`}
                  title="Duplicate this workshop and everything in it"
                  className={ui.iconAction}
                >
                  {cloningId === workshop.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => void remove(workshop)}
                  aria-label={`Delete ${workshop.title}`}
                  className={ui.iconAction}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </ContextMenu>
          ))}
        </ul>
      ) : (
        <div className={`${ui.card} ornate p-4`}>
          <EmptyState art="map" title="No workshops yet." hint="A workshop is yours alone. Nothing in it reaches a table until you import it." />
        </div>
      )}
    </main>
  );
}
