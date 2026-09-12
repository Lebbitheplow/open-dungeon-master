"use client";

import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Server, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { draftBytes, draftFromPack, finishDraft, type WorldPackDraft } from "@/lib/worlds/draft";
import { checkDraft } from "@/lib/worlds/draft-check";
import type { WorldPackSummary } from "@/lib/worlds/summary";
import { MAX_MANIFEST_BYTES } from "@/lib/worlds/types";
import type { SectionProps } from "@/app/workshop/plugin/types";

// The last tab: what is still missing, and the three ways out. Download
// hands over the manifest as a file, the same file Admin, Campaign plugins
// installs from. Install here does that install in one press, for an owner
// who is also this server's admin. Start from a file or an installed world
// goes the other way, reading a pack into the draft to keep editing it.
//
// The checks run in the browser as the draft changes (src/lib/worlds/
// draft-check.ts); the export route runs them again plus the content-pack
// integrity checks, and its problems land in the same list.

function download(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function PublishSection({
  draft,
  onDraft,
  workshopId,
  isAdmin,
  flushSave,
  onClear,
}: SectionProps & {
  workshopId: string;
  isAdmin: boolean;
  // Writes the draft now rather than after the autosave delay, so the
  // export reads what is on screen.
  flushSave: () => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const check = checkDraft(draft);
  const bytes = draftBytes(draft);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [serverProblems, setServerProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [installed, setInstalled] = useState<WorldPackSummary[]>([]);
  const [startFrom, setStartFrom] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/worlds")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { packs?: WorldPackSummary[] } | null) => setInstalled(data?.packs ?? []))
      .catch(() => undefined);
  }, []);

  async function exportPack(install: boolean) {
    setBusy(install ? "install" : "download");
    setError("");
    setNotice("");
    setServerProblems([]);
    try {
      await flushSave();
      const response = await fetch(`/api/workshops/${workshopId}/plugin/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ install }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "That could not be built.");
        setServerProblems(data.problems ?? []);
        return;
      }
      if (install) {
        setNotice(
          `${data.installed?.name ?? "The world"} is installed on this server${data.replaced ? ", replacing the copy that was there" : ""}. It is in the campaign creator now.`,
        );
      } else {
        download(`${data.pack.id}.json`, data.pack);
        setNotice(`Downloaded ${data.pack.id}.json. Hand it to an admin, or install it from Admin, Campaign plugins.`);
      }
      if (data.contentChecked === false) {
        setNotice((current) => `${current} The content pack is not installed here, so monster slugs and spell names were not checked.`);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy("");
    }
  }

  function replaceDraft(next: WorldPackDraft, from: string): boolean {
    if (
      draft.name.trim() &&
      !window.confirm(`Replace the draft "${draft.name}" with ${from}? The current draft is lost.`)
    ) {
      return false;
    }
    onDraft(next);
    setNotice(`Started from ${from}.`);
    return true;
  }

  async function onFile(file: File) {
    setError("");
    if (file.size > MAX_MANIFEST_BYTES) {
      setError("That file is larger than 16 MB, so it is not a world pack.");
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setError("That file is not JSON.");
      return;
    }
    const parsed = draftFromPack(raw);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    replaceDraft(parsed, file.name);
  }

  async function fromInstalled(packId: string) {
    if (!packId) return;
    setBusy("installed");
    setError("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(packId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "That world could not be read.");
        return;
      }
      const parsed = draftFromPack(data.pack);
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      if (replaceDraft({ ...parsed, id: "" }, `the installed world "${data.pack.name}"`)) {
        setNotice(
          `Started from "${data.pack.name}". Its pictures stay with the installed copy; give this one a new name so the two do not share an id.`,
        );
      }
    } finally {
      setBusy("");
      setStartFrom("");
    }
  }

  const id = String(finishDraft(draft).id);
  const ready = check.problems.length === 0;

  return (
    <div className="space-y-4">
      <section className={ui.card + " p-4"}>
        <h3 className="mb-1 flex items-center gap-2 font-display text-base tracking-wide text-amber-200">
          {ready ? <CheckCircle2 className="size-4 text-emerald-400" /> : <AlertTriangle className="size-4 text-amber-400" />}
          {ready ? "Ready to export" : `${check.problems.length} thing${check.problems.length === 1 ? "" : "s"} to fix first`}
        </h3>
        <p className="mb-3 text-[11px] text-stone-500">
          Will install as <span className="text-stone-300">{id}.json</span>, {bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`} of {MAX_MANIFEST_BYTES / 1024 / 1024} MB.
        </p>
        {check.problems.length || serverProblems.length ? (
          <ul className="mb-3 space-y-1">
            {[...check.problems, ...serverProblems].map((problem) => (
              <li key={problem} className="flex gap-2 text-xs text-red-300">
                <span aria-hidden="true">·</span>
                {problem}
              </li>
            ))}
          </ul>
        ) : null}
        {check.advice.length ? (
          <details className="text-xs text-stone-400">
            <summary className="cursor-pointer text-stone-500">
              {check.advice.length} suggestion{check.advice.length === 1 ? "" : "s"} before sharing
            </summary>
            <ul className="mt-2 space-y-1">
              {check.advice.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  {line}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <UnofficialPackNotice rightsHolder={draft.rightsHolder} inspiredBy={draft.inspiredBy.trim() || undefined} />

      <section className={ui.card + " p-4"}>
        <h3 className="mb-3 font-display text-base tracking-wide text-amber-200">Share it</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportPack(false)} disabled={!ready || Boolean(busy)} className={ui.btnPrimary}>
            {busy === "download" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Download the pack
          </button>
          {isAdmin ? (
            <button type="button" onClick={() => void exportPack(true)} disabled={!ready || Boolean(busy)} className={ui.btnSecondary}>
              {busy === "install" ? <Loader2 className="size-4 animate-spin" /> : <Server className="size-4" />}
              Install on this server
            </button>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-stone-500">
          {isAdmin
            ? "Download hands you the manifest as a file for other servers and registries. Install writes it to this server's data directory, where it appears in the campaign creator at once."
            : "The file installs from Admin, Campaign plugins, Install from a file, on any server whose admin trusts it. Only an admin can install here."}
        </p>
        {notice ? <p className="mt-2 text-xs text-amber-200/90">{notice}</p> : null}
        {error ? <p className="mt-2 text-xs text-red-300">{error}</p> : null}
      </section>

      <section className={ui.card + " p-4"}>
        <h3 className="mb-1 font-display text-base tracking-wide text-amber-200">Start from something</h3>
        <p className="mb-3 text-[11px] text-stone-500">
          Read a pack into the draft to keep working on it: one you downloaded, one somebody sent you, or a world installed here.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void onFile(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)} className={cn(ui.btnSmall, "text-xs")}>
            <FileUp className="size-3.5" /> A pack file
          </button>
          {installed.length ? (
            <select
              value={startFrom}
              aria-label="An installed world"
              disabled={busy === "installed"}
              onChange={(event) => {
                setStartFrom(event.target.value);
                void fromInstalled(event.target.value);
              }}
              className="rounded-md border border-stone-700 bg-stone-950 px-1.5 py-1 text-xs text-stone-300 focus:border-amber-500/50 focus:outline-none"
            >
              <option value="">An installed world...</option>
              {installed.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Throw the draft away and start blank? Pictures go with it.")) void onClear();
            }}
            disabled={Boolean(busy)}
            className={cn(ui.btnSmall, "ml-auto text-xs text-red-300/80 hover:text-red-200")}
          >
            <Trash2 className="size-3.5" /> Start blank
          </button>
        </div>
      </section>
    </div>
  );
}
