"use client";

import { ArrowLeft, CircleHelp, Copy, Hammer, Loader2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { IconChip, ui } from "@/lib/ui";
import { DEFAULT_TARGET_PARTY } from "@/lib/workshop/kind";
import { ImportBundleButton } from "@/app/workshop/ImportBundleButton";
import { WorkshopHelpDialog } from "@/components/WorkshopHelpDialog";
import type { WorkshopSummary } from "@/app/workshop/types";

// The shelf. A workshop is a place to build maps, NPCs, monsters, story and
// rules before any table exists, and to import them into a campaign later
// (docs/workshop-plan.md). Each one stands alone: nothing here requires
// finishing anything else first.

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
      window.location.href = `/workshop/${data.workshop.id}`;
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
      !window.confirm(
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
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <header className="mb-8">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-200"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <div className="flex items-center gap-3">
          <IconChip icon={Hammer} size="size-10" iconSize="size-5" />
          <div>
            <h1 className="font-display text-xl tracking-wide text-amber-50">Workshop</h1>
            <p className="text-sm text-stone-500">
              Build maps, NPCs, monsters, story and rules before the table exists. Import any of
              it when you start a campaign.
            </p>
          </div>
          <button
            type="button"
            aria-label="How workshops work"
            onClick={() => setHelpOpen(true)}
            className="ml-auto self-start rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300"
          >
            <CircleHelp className="size-4" />
          </button>
        </div>
      </header>
      <WorkshopHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <section className="mb-6">
        {creating ? (
          <form onSubmit={create} className={`${ui.card} space-y-3 p-4`}>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-400">Name</span>
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
              <span className="mb-1 block text-xs text-stone-400">Building for a party of</span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={size}
                  onChange={(event) => setSize(Number(event.target.value))}
                  className={`${ui.input} w-20`}
                />
                <span className="text-sm text-stone-400">characters at level</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={level}
                  onChange={(event) => setLevel(Number(event.target.value))}
                  className={`${ui.input} w-20`}
                />
              </div>
              <span className="mt-1 block text-xs text-stone-500">
                The encounter calculator and the odds preview budget against this. Change it
                anytime.
              </span>
            </div>
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
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
            <button type="button" onClick={() => setCreating(true)} className={ui.btnPrimary}>
              <Plus className="size-4" /> New workshop
            </button>
            <ImportBundleButton />
          </div>
        )}
      </section>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-stone-500" />
        </div>
      ) : workshops.length ? (
        <ul className="space-y-3">
          {workshops.map((workshop) => (
            <li key={workshop.id} className={`${ui.cardHover} group flex items-center gap-3 p-4`}>
              <Link href={`/workshop/${workshop.id}`} className="min-w-0 flex-1">
                <p className="truncate font-display tracking-wide text-amber-50">
                  {workshop.title}
                </p>
                <p className="text-sm text-stone-500">
                  Party of {workshop.gameSettings.targetParty.size} at level{" "}
                  {workshop.gameSettings.targetParty.level}
                </p>
              </Link>
              <button
                type="button"
                disabled={cloningId === workshop.id}
                onClick={() => clone(workshop)}
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
                onClick={() => remove(workshop)}
                aria-label={`Delete ${workshop.title}`}
                className={ui.iconAction}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className={`${ui.card} p-8 text-center`}>
          <IconChip icon={Hammer} className="mx-auto mb-3" />
          <p className="text-stone-400">No workshops yet.</p>
          <p className="mt-1 text-sm text-stone-500">
            A workshop is yours alone. Nothing in it reaches a table until you import it.
          </p>
        </div>
      )}
    </main>
  );
}
