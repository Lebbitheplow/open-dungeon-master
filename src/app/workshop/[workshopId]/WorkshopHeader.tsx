"use client";

import { ArrowLeft, CircleHelp, Copy, Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ui } from "@/lib/ui";
import { ImportBundleButton } from "@/app/workshop/ImportBundleButton";
import type { WorkshopSummary } from "@/app/workshop/types";

// The hub's masthead: the way back to the shelf, the workshop's name
// (editable in place), and the four things that act on the workshop as a
// whole. Duplicate, Delete and Import a bundle speak to the same routes the
// shelf does, so a DM never has to leave the workshop to copy or retire it.

export function WorkshopHeader({
  workshop,
  onRenamed,
  onHelp,
}: {
  workshop: WorkshopSummary;
  onRenamed: (title: string) => void;
  onHelp: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [cloning, setCloning] = useState(false);

  // Inline rename over the PATCH that has existed since the shelf shipped;
  // the title is merged locally rather than replaced with the response so
  // the contents counts already on screen are not clobbered.
  async function saveTitle() {
    const title = titleDraft.trim();
    setRenaming(false);
    if (!title || title === workshop.title) {
      return;
    }
    const response = await fetch(`/api/workshops/${workshop.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (response.ok) {
      onRenamed(title);
    }
  }

  // A copy of the workshop and everything in it, board included
  // (src/lib/db/campaign-clone.ts). From inside a workshop the natural next
  // step is to work on the copy, so that is where this lands.
  async function clone() {
    setCloning(true);
    try {
      const response = await fetch(`/api/campaigns/${workshop.id}/clone`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.campaign?.id) {
        router.push(`/workshop/${data.campaign.id}`);
      }
    } finally {
      setCloning(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Delete "${workshop.title}"? Every map, NPC, table and note in it is lost. Anything already imported into a campaign stays there.`,
      )
    ) {
      return;
    }
    const response = await fetch(`/api/workshops/${workshop.id}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/workshop");
    }
  }

  return (
    <header className="mb-4 space-y-3">
      <Link
        href="/workshop"
        className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-amber-200"
      >
        <ArrowLeft className="size-4" /> All workshops
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <input
            value={titleDraft}
            maxLength={80}
            autoFocus
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void saveTitle();
              }
              if (event.key === "Escape") {
                setRenaming(false);
              }
            }}
            aria-label="Workshop name"
            className="w-full max-w-md rounded-md border border-stone-700 bg-stone-950 px-2 py-1 font-display text-xl tracking-wide text-amber-50"
          />
        ) : (
          <>
            <h1 className="font-display text-xl tracking-wide text-amber-50">{workshop.title}</h1>
            <button
              type="button"
              aria-label="Rename this workshop"
              onClick={() => {
                setTitleDraft(workshop.title);
                setRenaming(true);
              }}
              className="rounded p-1 text-stone-500 hover:text-stone-300"
            >
              <Pencil className="size-3.5" />
            </button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="How workshops work"
            onClick={onHelp}
            className="rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300"
          >
            <CircleHelp className="size-4" />
          </button>
          <button
            type="button"
            disabled={cloning}
            onClick={() => void clone()}
            aria-label={`Duplicate ${workshop.title}`}
            title="Duplicate this workshop and everything in it"
            className="rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-stone-300 disabled:opacity-50"
          >
            {cloning ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            aria-label={`Delete ${workshop.title}`}
            title="Delete this workshop"
            className="rounded-md border border-stone-700 p-1.5 text-stone-500 hover:text-red-300"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>
      <ImportBundleButton label="Import a bundle" className={ui.btnSmall} />
    </header>
  );
}
