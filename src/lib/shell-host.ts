// The desktop and Android apps wrap this web UI and expose one small object
// on window before any page script runs. Pages use it to offer a way back
// to the app's own server list, which the app cannot draw over the page
// itself without looking like a browser toolbar.

export interface ShellHost {
  platform: "desktop" | "android";
  // Leaves this server's pages for the app's server picker.
  showServers(): void;
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
