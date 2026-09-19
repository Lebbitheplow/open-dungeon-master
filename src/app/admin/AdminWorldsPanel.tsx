"use client";

import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { GameIcon } from "@/components/ui/GameIcon";
import { SectionHead } from "@/components/ui/SectionHead";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import type { RegistryBundle, RegistryEntry, WorldPackSummary } from "@/lib/worlds/types";
import { forgetPackArt } from "@/lib/worlds/use-pack-art";

// The campaign plugin browser.
//
// World packs are the app's plugin format: a single JSON manifest that renames
// the SRD's races, classes, spells, items and monsters into some other setting
// and tells the DM how that setting sounds. It changes no rules.
//
// Packs built on somebody else's universe are NOT shipped with this app and
// are not covered by its MIT license. They are downloaded from whatever
// registry the operator configured, or added by hand from a file, and they
// carry an explicit non-affiliation notice wherever they appear.
// The same ceiling as MAX_MANIFEST_BYTES in src/lib/worlds/install.ts, which
// this client component cannot import: a pack with its thumbnails aboard is a
// few megabytes, and anything near this is not one.
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

type RegistryState = {
  configured: boolean;
  url?: string;
  error?: string;
  packs: RegistryEntry[];
  bundles?: RegistryBundle[];
  installed: WorldPackSummary[];
};

export function AdminWorldsPanel() {
  const [state, setState] = useState<RegistryState | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Uncontrolled, seeded from whatever registry is in force and re-keyed when
  // that changes, so an admin edits the live value rather than typing over a
  // blank box. Same shape as the custom-genre textarea in GameSettingsPanel.
  const registryInput = useRef<HTMLInputElement>(null);

  // Reload after an install, a removal, or a registry change. Only ever called
  // from an event handler; the first load is the effect below, which fetches
  // inline and sets state from the callback the way the other panels do.
  const load = useCallback(async () => {
    const response = await fetch("/api/worlds/registry");
    setState(
      response.ok ? await response.json() : { configured: false, packs: [], installed: [] },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/worlds/registry")
      .then((response) =>
        response.ok ? response.json() : { configured: false, packs: [], installed: [] },
      )
      .then((data) => {
        if (!cancelled) {
          setState(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ configured: false, packs: [], installed: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveRegistry() {
    const next = registryInput.current?.value.trim() ?? "";
    setBusyId("registry");
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldRegistryUrl: next }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not save the registry URL.");
        return;
      }
      setNotice(next ? "Registry saved." : "Registry cleared.");
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function install(body: Record<string, unknown>, key: string) {
    setBusyId(key);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/worlds/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not install that world.");
        return;
      }
      setNotice(
        data.replaced
          ? `Updated ${data.pack.name}. Campaigns already using it pick up the new build on their next turn.`
          : `Installed ${data.pack.name}.`,
      );
      forgetPackArt(data.pack?.id);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  // A prepared world (docs/vtt-parity-implementation-plan.md 12.3) lands as
  // a workshop of the installing admin's own.
  async function installBundle(bundle: RegistryBundle) {
    setBusyId(`bundle:${bundle.id}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/worlds/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundleId: bundle.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not install that world.");
        return;
      }
      setNotice(`Installed ${bundle.name} as a workshop (${data.copied} entries). Find it under Workshop.`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(pack: WorldPackSummary) {
    const sure = await appConfirm(`Remove ${pack.name}? Campaigns that used it fall back to their plain setting.`, {
      title: "Remove this world pack?",
      actionLabel: "Remove",
      tone: "danger",
    });
    if (!sure) return;
    setBusyId(pack.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/worlds/${encodeURIComponent(pack.id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not remove that world.");
        return;
      }
      setNotice(`Removed ${pack.name}. Campaigns that used it fall back to their plain setting.`);
      forgetPackArt(pack.id);
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function onFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than 16MB, so it is not a world pack.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That file is not valid JSON.");
      return;
    }
    await install({ pack: parsed }, "upload");
  }

  if (!state) {
    return <PageSkeleton kind="flat" className="px-0 py-2" />;
  }

  const installedIds = new Map(state.installed.map((pack) => [pack.id, pack]));
  const registryById = new Map(state.packs.map((entry) => [entry.id, entry]));
  // An installed pack lives in the "Installed" section below (with its own
  // update control), so keep it out of the download list rather than showing a
  // second, redundant tile for it here.
  const available = state.packs.filter((entry) => !installedIds.has(entry.id));

  return (
    <div className="space-y-4 text-sm">
      <section className={cn(ui.card, "ornate texture-noise p-5")}>
        <SectionHead level="h2" title="Campaign plugins" glyph="system-plugin" />
        <p className="text-xs leading-5 text-stone-400">
          A world pack renames the rules into a setting: its own races, classes, spells, gear,
          monsters, factions and lore, plus a brief telling the DM how that world sounds. Every
          mechanic stays 5e, so a character built in one still works anywhere.
        </p>
        <p className="mt-2 text-xs leading-5 text-stone-500">
          Packs based on an existing universe are community works. They are not distributed with
          Open Dungeon Master, are not covered by its MIT license, and are not endorsed by the
          rights holders of the settings they reference. Installing one is your decision as the
          operator of this server.
        </p>
      </section>

      {error ? <p role="alert" className="motion-shake text-xs text-red-400">{error}</p> : null}
      {notice ? <p role="status" className="live-in text-xs text-amber-200">{notice}</p> : null}

      {state.bundles?.length ? (
        <section className={cn(ui.card, "texture-noise p-5")}>
          <SectionHead title="Prepared worlds" glyph="system-region" aside={<span className="tabular-nums">{state.bundles.length}</span>} />
          <p className="mb-2 text-[11px] text-stone-500">
            A workshop someone else built: cast, places, maps, encounters and lore, ready to run. Installing one creates a workshop of your own from it.
          </p>
          <ul className="stagger-up grid gap-2 sm:grid-cols-2">
            {state.bundles.map((bundle) => (
              <li key={bundle.id} className="plate-row" data-layout="stack">
                <p className="font-display text-sm text-amber-100">{bundle.name}</p>
                <p className="text-[11px] leading-4 text-stone-400">{bundle.blurb}</p>
                <p className="text-[10px] text-stone-500">
                  {bundle.author ? `by ${bundle.author}` : "community work"}
                  {bundle.version ? `, v${bundle.version}` : ""}
                </p>
                {bundle.inspiredBy ? <UnofficialPackNotice inspiredBy={bundle.inspiredBy} rightsHolder={bundle.rightsHolder} /> : null}
                <button
                  type="button"
                  disabled={busyId === `bundle:${bundle.id}`}
                  onClick={() => void installBundle(bundle)}
                  className={cn(ui.btnSmall, "text-xs")}
                >
                  {busyId === `bundle:${bundle.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Install as a workshop
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead title="Install from a file" glyph="tab-handout" />
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset first, so picking the same file twice still fires.
            event.target.value = "";
            if (file) {
              void onFile(file);
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={busyId === "upload"}
          className={cn(ui.btnSmall, "text-xs")}
        >
          {busyId === "upload" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          Choose a pack file
        </button>
        <p className="mt-1 text-[11px] text-stone-500">
          A single .json manifest. It is validated before anything is written, and lands in this
          server&apos;s data directory.
        </p>
      </section>

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead title="Registry" glyph="tab-facts" />
        <div className="flex flex-wrap items-center gap-2">
          <input
            key={state.url ?? ""}
            ref={registryInput}
            defaultValue={state.url ?? ""}
            placeholder="Blank uses the built-in registry"
            aria-label="Registry URL"
            className={cn(ui.input, "min-w-0 flex-1 text-xs")}
          />
          <button
            type="button"
            onClick={saveRegistry}
            disabled={busyId === "registry"}
            className={cn(ui.btnSmall, "text-xs")}
          >
            {busyId === "registry" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Save
          </button>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-stone-500">
          A JSON index of downloadable campaigns, over https. Blank falls through to the
          <span className="font-mono"> WORLD_REGISTRY_URL </span>
          environment variable, and then to the registry built into this app. Point it somewhere
          else to run your own, or set it to
          <span className="font-mono"> off </span>
          to browse nothing at all. Whatever a registry lists is third-party content this project
          neither ships nor vets, and nothing installs until you install it.
        </p>
      </section>

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead title="Available to download" glyph="system-share" aside={available.length ? <span className="tabular-nums">{available.length}</span> : undefined} />
        {!state.configured ? (
          <EmptyState
            art="scrolls"
            size="sm"
            title="This server's registry is turned off."
            hint="Clear the field above to go back to the built-in one, point it at your own, or install a pack from a file."
          />
        ) : state.error ? (
          <p role="alert" className="motion-shake rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
            {state.error}
          </p>
        ) : !state.packs.length ? (
          <EmptyState art="scrolls" size="sm" title="That registry lists no campaigns." />
        ) : !available.length ? (
          <EmptyState art="chest" size="sm" title="Everything this registry offers is already installed." />
        ) : (
          <ul className="stagger space-y-2">
            {available.map((entry) => (
              <li key={entry.id} className="plate-row" data-layout="stack">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 font-display text-amber-100">
                    <GameIcon icon={{ kind: "glyph", key: "system-plugin" }} size="size-6" />
                    {entry.name}
                  </span>
                  <span className="text-[11px] text-stone-500">
                    v{entry.version}
                    {entry.author ? ` · ${entry.author}` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-400">{entry.blurb}</p>
                <UnofficialPackNotice
                  rightsHolder={entry.rightsHolder}
                  inspiredBy={entry.inspiredBy}
                  variant="inline"
                  className="mt-1"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => install({ packId: entry.id }, entry.id)}
                    disabled={busyId === entry.id}
                    className={cn(ui.btnSmall, "text-xs")}
                  >
                    {busyId === entry.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    Install
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(ui.card, "texture-noise p-5")}>
        <SectionHead title="Installed" glyph="system-homebrew" aside={<span className="tabular-nums">{state.installed.length}</span>} />
        {!state.installed.length ? (
          <EmptyState art="map" size="sm" title="No world packs yet. Campaigns run on the built-in settings." />
        ) : (
          <ul className="stagger space-y-2">
            {state.installed.map((pack) => {
              const update = registryById.get(pack.id);
              const outdated = Boolean(update && update.version !== pack.version);
              return (
                <li key={pack.id} className="plate-row" data-layout="stack">
                  {pack.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={pack.cover}
                      alt=""
                      className="mb-2 h-24 w-full rounded-md border border-amber-500/20 object-cover"
                    />
                  ) : null}
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-display text-amber-100">
                      <GameIcon icon={{ kind: "glyph", key: "system-plugin" }} size="size-6" />
                      {pack.name}
                    </span>
                    <span className="text-[11px] text-stone-500">
                      v{pack.version}
                      {pack.author ? ` · ${pack.author}` : ""}
                      {pack.source === "bundled" ? " · bundled" : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-stone-400">{pack.blurb}</p>
                  <UnofficialPackNotice
                    rightsHolder={pack.rightsHolder}
                    inspiredBy={pack.inspiredBy}
                    variant="inline"
                    className="mt-1"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {outdated ? (
                      <button
                        type="button"
                        onClick={() => install({ packId: pack.id }, pack.id)}
                        disabled={busyId === pack.id}
                        className={cn(ui.btnSmall, "text-xs")}
                      >
                        {busyId === pack.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Download className="size-3.5" />
                        )}
                        Update to v{update?.version}
                      </button>
                    ) : null}
                    {pack.source === "installed" ? (
                      <button
                        type="button"
                        onClick={() => remove(pack)}
                        disabled={busyId === pack.id}
                        className={cn(ui.btnSmall, "text-xs hover:border-red-500/50 hover:text-red-400")}
                      >
                        {busyId === pack.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        Remove
                      </button>
                    ) : outdated ? null : (
                      <p className="text-[11px] text-stone-500">
                        Ships with the app and cannot be removed.
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
