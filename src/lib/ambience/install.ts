import { installedCounts, installedTracks, rebuildManifest } from "@/lib/ambience/library";
import { installPack, packAssetUrl, PACK_MAX_BYTES } from "@/lib/ambience/pack";

// The sound pack download, for the admin panel: one button, a progress
// figure while it comes down, and the library counts after. Modelled on the
// built-in speech install (src/lib/stt-builtin.ts): nothing downloads until
// an admin asks, the job lives on globalThis so a dev reload does not start
// a second one, and GET reports how far it has got.

type InstallState = {
  status: "idle" | "installing" | "ready" | "error";
  loaded: number;
  total: number;
  error: string;
  url: string;
  result: { installed: number; kept: number } | null;
};

declare global {
  var __odmAmbienceInstall: InstallState | undefined;
}

function state(): InstallState {
  return (globalThis.__odmAmbienceInstall ??= {
    status: "idle",
    loaded: 0,
    total: 0,
    error: "",
    url: "",
    result: null,
  });
}

export type AmbienceLibraryStatus = {
  counts: ReturnType<typeof installedCounts>;
  files: number;
  packUrl: string;
  status: InstallState["status"];
  // 0 to 1 while a pack is downloading.
  progress: number;
  error: string;
  result: InstallState["result"];
};

export function ambienceLibraryStatus(version: string): AmbienceLibraryStatus {
  const current = state();
  const tracks = installedTracks();
  return {
    counts: installedCounts(tracks),
    files: tracks.length,
    packUrl: current.url || packAssetUrl(version),
    status: current.status,
    progress: current.status === "installing" ? (current.total ? Math.min(1, current.loaded / current.total) : 0) : current.status === "ready" ? 1 : 0,
    error: current.error,
    result: current.result,
  };
}

async function download(url: string, onProgress: (loaded: number, total: number) => void): Promise<Buffer> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status}.`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  if (total > PACK_MAX_BYTES) {
    throw new Error("That file is too large to be a sound pack.");
  }
  const chunks: Buffer[] = [];
  let loaded = 0;
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("The download had no body.");
  }
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    loaded += value.byteLength;
    if (loaded > PACK_MAX_BYTES) {
      await reader.cancel();
      throw new Error("That file is too large to be a sound pack.");
    }
    chunks.push(Buffer.from(value));
    onProgress(loaded, total);
  }
  return Buffer.concat(chunks);
}

// Starts the download (or reports the one running) and returns at once.
export function installAmbiencePack(url: string, version: string): AmbienceLibraryStatus {
  const current = state();
  if (current.status === "installing") {
    return ambienceLibraryStatus(version);
  }
  current.status = "installing";
  current.loaded = 0;
  current.total = 0;
  current.error = "";
  current.url = url;
  current.result = null;
  download(url, (loaded, total) => {
    current.loaded = loaded;
    current.total = total;
  })
    .then((buffer) => installPack(buffer))
    .then((result) => {
      current.status = "ready";
      current.result = { installed: result.installed, kept: result.kept };
    })
    .catch((error: unknown) => {
      current.status = "error";
      current.error = error instanceof Error ? error.message : String(error);
      console.error("[ambience] pack install failed", error);
    });
  return ambienceLibraryStatus(version);
}

// Files dropped into the folder by hand show up once the manifest is
// rebuilt; the admin card offers this so nobody has to find the script.
export function rescanAmbienceLibrary(version: string): AmbienceLibraryStatus {
  rebuildManifest();
  return ambienceLibraryStatus(version);
}
