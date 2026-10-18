"use client";

import { Download, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import { genreName } from "@/lib/worlds/plugin-filter";
import type { RegistryEntry, WorldPackSummary } from "@/lib/worlds/types";
import { PluginThumb } from "./PluginThumb";

// The plugin browser's two kinds of entry: a pack the registry offers, as a
// card with its picture on top, and a pack already on this server, as a row
// with its picture beside it so a long shelf stays scannable.

function Byline({ version, author, extra }: { version: string; author: string; extra?: string }) {
  return (
    <span className="text-[11px] text-stone-500">
      v{version}
      {author ? ` · ${author}` : ""}
      {extra ? ` · ${extra}` : ""}
    </span>
  );
}

function GenreLine({ genre, edition }: { genre: string; edition?: string }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.12em] text-stone-500">
      {genreName(genre)}
      {edition ? ` · ${edition}` : ""}
    </p>
  );
}

export function AvailablePluginCard({
  entry,
  busy,
  onInstall,
}: {
  entry: RegistryEntry;
  busy: boolean;
  onInstall: () => void;
}) {
  return (
    <li className="plate-row" data-layout="stack">
      <PluginThumb src={entry.thumbnail} genre={entry.baseGenre} seed={entry.id} className="w-full" />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 font-display text-amber-100">{entry.name}</span>
        <Byline version={entry.version} author={entry.author} />
      </div>
      <GenreLine genre={entry.baseGenre} edition={entry.edition} />
      <p className="text-xs text-stone-400">{entry.blurb}</p>
      <UnofficialPackNotice rightsHolder={entry.rightsHolder} inspiredBy={entry.inspiredBy} variant="inline" />
      <div className="mt-auto flex items-center gap-2 pt-1">
        <button type="button" onClick={onInstall} disabled={busy} className={cn(ui.btnSmall, "text-xs")}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          Install
        </button>
      </div>
    </li>
  );
}

export function InstalledPluginRow({
  pack,
  update,
  busy,
  onUpdate,
  onRemove,
}: {
  pack: WorldPackSummary;
  // The registry's listing of this pack, for an Update and, when the pack
  // carries no cover of its own, its thumbnail.
  update?: RegistryEntry;
  busy: boolean;
  onUpdate: () => void;
  onRemove: () => void;
}) {
  const outdated = Boolean(update && update.version !== pack.version);
  return (
    <li className="plate-row flex-nowrap items-start">
      <PluginThumb
        src={pack.cover || update?.thumbnail}
        genre={pack.baseGenre}
        seed={pack.id}
        className="w-24 sm:w-36"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="min-w-0 font-display text-amber-100">{pack.name}</span>
          <Byline version={pack.version} author={pack.author} extra={pack.source === "bundled" ? "bundled" : ""} />
        </div>
        <GenreLine genre={pack.baseGenre} edition={pack.edition} />
        <p className="text-xs text-stone-400">{pack.blurb}</p>
        <UnofficialPackNotice rightsHolder={pack.rightsHolder} inspiredBy={pack.inspiredBy} variant="inline" />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {outdated ? (
            <button type="button" onClick={onUpdate} disabled={busy} className={cn(ui.btnSmall, "text-xs")}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              Update to v{update?.version}
            </button>
          ) : null}
          {pack.source === "installed" ? (
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              className={cn(ui.btnSmall, "text-xs hover:border-red-500/50 hover:text-red-400")}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              Remove
            </button>
          ) : outdated ? null : (
            <p className="text-[11px] text-stone-500">Ships with the app and cannot be removed.</p>
          )}
        </div>
      </div>
    </li>
  );
}
