"use client";

import { Download, Loader2, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { UnofficialPackNotice } from "@/components/UnofficialPackNotice";
import type { RegistryEntry, WorldPackSummary } from "@/lib/worlds/types";

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
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

type RegistryState = {
  configured: boolean;
  url?: string;
  error?: string;
  packs: RegistryEntry[];
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
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function remove(pack: WorldPackSummary) {
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
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusyId("");
    }
  }

  async function onFile(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is larger than 2MB, so it is not a world pack.");
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
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  const installedIds = new Map(state.installed.map((pack) => [pack.id, pack]));
  const registryById = new Map(state.packs.map((entry) => [entry.id, entry]));
  // An installed pack lives in the "Installed" section below (with its own
  // update control), so keep it out of the download list rather than showing a
  // second, redundant tile for it here.
  const available = state.packs.filter((entry) => !installedIds.has(entry.id));

  return (
    <div className="space-y-6 text-sm">
      <section className={cn(ui.card, "texture-noise p-5")}>
        <h2 className={ui.sectionEyebrow}>Campaign plugins</h2>
        <p className="mt-2 text-xs leading-5 text-stone-400">
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

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {notice ? <p className="text-xs text-amber-200">{notice}</p> : null}

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-stone-400">
            Install from a file
          </h3>
        </div>
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

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          Registry
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            key={state.url ?? ""}
            ref={registryInput}
            defaultValue={state.url ?? ""}
            placeholder="Blank uses the built-in registry"
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

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          Available to download
        </h3>
        {!state.configured ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs leading-5 text-stone-500">
            This server&apos;s registry is turned off. Clear the field above to go back to the
            built-in one, point it at your own, or install a pack from a file.
          </p>
        ) : state.error ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-red-400">
            {state.error}
          </p>
        ) : !state.packs.length ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-stone-500">
            That registry lists no campaigns.
          </p>
        ) : !available.length ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-stone-500">
            Everything this registry offers is already installed.
          </p>
        ) : (
          <ul className="space-y-2">
            {available.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-stone-800 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-stone-100">{entry.name}</span>
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

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">
          Installed
        </h3>
        {!state.installed.length ? (
          <p className="rounded-md border border-stone-800 p-3 text-xs text-stone-500">
            No world packs yet. Campaigns run on the built-in settings.
          </p>
        ) : (
          <ul className="space-y-2">
            {state.installed.map((pack) => {
              const update = registryById.get(pack.id);
              const outdated = Boolean(update && update.version !== pack.version);
              return (
                <li key={pack.id} className="rounded-lg border border-stone-800 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-stone-100">{pack.name}</span>
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
                        className={cn(ui.btnSmall, "text-xs")}
                      >
                        {busyId === pack.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        Remove
                      </button>
                    ) : outdated ? null : (
                      <p className="text-[11px] text-stone-600">
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
