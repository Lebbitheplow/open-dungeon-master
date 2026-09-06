// The desktop and Android apps wrap this web UI and expose one small object
// on window before any page script runs. Pages use it to offer a way back
// to the app's own server list, which the app cannot draw over the page
// itself without looking like a browser toolbar, and, on the app's own
// world, to share that world on the internet through the app's tunnel.

// Sharing as the app reports it. supported is false on a remote server's
// pages (only the app's own world can be shared from here) and in a plain
// browser. url is the public https address while running; lanUrl is the
// device's Wi-Fi address when it has one.
export interface ShellShareStatus {
  supported: boolean;
  state: "stopped" | "starting" | "running" | "error";
  url: string;
  mode: "" | "named" | "quick";
  error: string;
  lanUrl: string;
}

export interface ShellShare {
  status(): Promise<ShellShareStatus>;
  // Resolves with a snapshot: the desktop app answers once the tunnel is
  // up, the Android app answers at once with "starting" and reports the
  // outcome to subscribers. Subscribe for the truth either way.
  start(): Promise<ShellShareStatus>;
  stop(): Promise<ShellShareStatus>;
  subscribe(listener: (status: ShellShareStatus) => void): () => void;
}

export interface ShellHost {
  platform: "desktop" | "android";
  // Leaves this server's pages for the app's home screen (its servers,
  // its device world, its settings).
  showServers(): void;
  // Absent in apps older than 0.3.1.
  share?: ShellShare;
  // The phone's share sheet for a link (the app's webview has no Web
  // Share API). Absent on desktop and in apps older than 0.5.1.
  shareLink?(input: { title: string; text: string; url: string }): Promise<boolean>;
}

declare global {
  interface Window {
    odmShell?: ShellHost;
  }
}

// Null in a plain browser and during server rendering.
export function shellHost(): ShellHost | null {
  if (typeof window === "undefined") return null;
  const host = window.odmShell;
  return host && typeof host.showServers === "function" ? host : null;
}

// One way to hand a link to another app, wherever the page runs: the
// browser's own share sheet where it has one, the app's on Android, and
// nothing on a desktop browser or desktop app (the copy button stays).
export type ShareSheet = (input: { title: string; text: string; url: string }) => Promise<boolean>;

export function shareSheet(): ShareSheet | null {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    return async (input) => {
      try {
        await navigator.share(input);
        return true;
      } catch {
        // Dismissing the sheet rejects; nothing to report.
        return false;
      }
    };
  }
  const host = shellHost();
  const link = host?.shareLink;
  return link ? (input) => link.call(host, input) : null;
}

export function shellShare(): ShellShare | null {
  const host = shellHost();
  const share = host?.share;
  return share && typeof share.start === "function" ? share : null;
}
