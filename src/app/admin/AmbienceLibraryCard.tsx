"use client";

import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageSection } from "@/components/PageShell";
import { ui } from "@/lib/ui";

// The sound library in the admin panel: how much of the catalog has audio,
// one button that installs the release's sound pack, and a rescan for files
// dropped into public/ambience by hand. Polls while a pack comes down, the
// way the built-in speech card does.

type Counts = Record<"bed" | "music" | "sting", { installed: number; total: number; files: number }>;

type Status = {
  counts: Counts;
  files: number;
  packUrl: string;
  status: "idle" | "installing" | "ready" | "error";
  progress: number;
  error: string;
  result: { installed: number; kept: number } | null;
};

async function request(method: "GET" | "POST", body?: Record<string, unknown>): Promise<Status | string> {
  try {
    const response = await fetch("/api/admin/ambience", {
      method,
      cache: "no-store",
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = (await response.json()) as Status & { error?: string };
    if (!response.ok) {
      return data.error ?? `The server answered ${response.status}.`;
    }
    return data;
  } catch {
    return "The server could not be reached.";
  }
}

const LAYER: Array<{ key: keyof Counts; label: string }> = [
  { key: "bed", label: "Rooms" },
  { key: "music", label: "Music" },
  { key: "sting", label: "Sounds" },
];

export function AmbienceLibraryCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");

  const apply = useCallback((result: Status | string) => {
    if (typeof result === "string") {
      setError(result);
    } else {
      setError("");
      setStatus(result);
    }
  }, []);

  useEffect(() => {
    void request("GET").then(apply);
  }, [apply]);

  const installing = status?.status === "installing";
  useEffect(() => {
    if (!installing) {
      return;
    }
    const timer = window.setInterval(() => void request("GET").then(apply), 1500);
    return () => window.clearInterval(timer);
  }, [installing, apply]);

  const percent = Math.round((status?.progress ?? 0) * 100);
  const total = status ? LAYER.reduce((sum, layer) => sum + status.counts[layer.key].total, 0) : 0;
  const have = status ? LAYER.reduce((sum, layer) => sum + status.counts[layer.key].installed, 0) : 0;

  return (
    <PageSection
      id="admin-ambience"
      heading="Sound library"
      glyph="tab-ambience"
      intro="The rooms, music and one-shot sounds every table can play: public-domain and Creative Commons recordings, credited on the licenses page. The library ships with the game; a newer sound pack from a release can be installed here, and the server can fetch more (docs/configuration.md)."
    >
      <div className="space-y-4">
        {status ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {LAYER.map((layer) => {
              const count = status.counts[layer.key];
              const share = count.total ? count.installed / count.total : 0;
              return (
                <div key={layer.key} className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className={ui.sectionEyebrow}>{layer.label}</span>
                    <span className="text-sm text-stone-200">
                      {count.installed} of {count.total}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-800">
                    <div className="h-full rounded-full bg-amber-400/80 transition-[width] duration-500" style={{ width: `${Math.round(share * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    {count.files} {count.files === 1 ? "file" : "files"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void request("POST", { action: "install", ...(url.trim() ? { url: url.trim() } : {}) }).then(apply)}
            disabled={!status || installing}
            className={ui.btnPrimary}
          >
            {installing ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {installing ? `Installing ${percent}%` : have && have === total ? "Reinstall the sound pack" : "Install a sound pack"}
          </button>
          <button type="button" onClick={() => void request("POST", { action: "rescan" }).then(apply)} disabled={!status || installing} className={ui.btnSecondary}>
            Rescan the folder
          </button>
          {status?.status === "ready" && status.result ? (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-300">
              <Check className="size-4" aria-hidden="true" />
              {status.result.installed} tracks installed{status.result.kept ? `, ${status.result.kept} already here` : ""}
            </span>
          ) : null}
          {status?.status === "error" ? (
            <span className="inline-flex items-center gap-1 text-sm text-red-300">
              <X className="size-4" aria-hidden="true" />
              {status.error}
            </span>
          ) : null}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">
            Pack URL. Blank takes this release&apos;s own pack{status ? ` (${status.packUrl})` : ""}.
          </span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://.../ambience-pack.zip"
            className={ui.input}
            disabled={installing}
          />
        </label>
        <p className="text-xs leading-5 text-stone-500">
          Tracks dropped into public/ambience by hand show up after a rescan (tavern.mp3, or tavern-2.mp3 for a second take).
          On the server, npm run fetch-ambience resolves the library from OpenGameArt, Kevin MacLeod&apos;s catalogue,
          Wikimedia Commons, Freesound and the Internet Archive.
        </p>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
      </div>
    </PageSection>
  );
}
