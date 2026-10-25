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
  // Room codes the table registry would not take from this app because
  // another device claimed them first: a friend who types one is not sent
  // here. Absent in apps that do not report it.
  refusedCodes?: string[];
}

// Whether the registry refused this room code while the world is shared.
export function roomCodeRefused(status: ShellShareStatus | null, code: string): boolean {
  if (!status?.supported || status.state !== "running" || !Array.isArray(status.refusedCodes)) {
    return false;
  }
  return status.refusedCodes.includes(code.trim().toUpperCase());
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

// What an app says about itself for a report file (Report a problem): the
// facts the server cannot see. Never an address, a path, a name or a key.
export interface ShellReportFacts {
  version: string;
  // How it was installed: "AppImage", "nsis", "dmg", "android" and so on.
  installKind: string;
  platform: string;
  arch: string;
  os: string;
  runtime: string;
  // How the app shows these pages: "native" for its own screens.
  screens: string;
  // Whether the table is the world this device hosts.
  localWorld: boolean;
}

// The app's answer once the file is saved. saved is false when the person
// backed out of the save dialog or the share sheet; name is what the file
// was saved as, and where is a short place to show ("~/Downloads").
export interface ShellReportSaved {
  saved: boolean;
  name: string;
  where: string;
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
  // Present when the app draws these pages itself (its native screens over
  // the host's API, apps 0.8.0 and up): the address of the page being
  // shown and the navigations, which the app owns because window.location
  // is then the app's own page. src/lib/navigation.ts is the consumer.
  navigation?: {
    location(): { pathname: string; search: string };
    push(url: string): void;
    replace(url: string): void;
    reload(): void;
  };
  // The host these pages are talking to, when the app draws them.
  hostOrigin?: string;
  // The app's own Settings (its audio and dice controls, updates, sharing
  // the device world) and its user guide, laid over the page without
  // taking the table down. Present when the app draws these pages itself
  // (apps 0.15.0 and up); the account menu offers both.
  openSettings?(): void;
  openHelp?(): void;
  // Report a problem (src/components/ReportProblemDialog.tsx through
  // src/lib/shell-report.ts): the app saves the report file itself (the
  // desktop's save dialog, starting in Downloads; the phone's share sheet)
  // and describes itself for the file. Absent in apps up to 0.21.0 and in
  // the apps' web view; the page then saves the file the way a browser
  // does, which both apps already take.
  reportFacts?(): Promise<ShellReportFacts>;
  saveReport?(input: { name: string; text: string }): Promise<ShellReportSaved>;
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
