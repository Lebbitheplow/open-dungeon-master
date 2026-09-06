// The page's address and its hard navigations. In a browser these are
// window.location and history; inside the desktop or Android app, whose
// native screens draw these pages against the host's API, the app owns
// the address (src/lib/shell-host.ts, navigation) and window.location is
// the app's own page, never to be touched.
import { shellHost } from "./shell-host.ts";

function nav() {
  return shellHost()?.navigation ?? null;
}

export function currentQuery(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(nav()?.location().search ?? window.location.search);
}

export function currentPathname(): string {
  if (typeof window === "undefined") return "/";
  return nav()?.location().pathname ?? window.location.pathname;
}

// A full navigation to another page of this server.
export function navigateTo(url: string): void {
  const app = nav();
  if (app) app.push(url);
  else window.location.href = url;
}

// Rewrites the address without navigating (a consumed ?query=).
export function replaceAddress(url: string): void {
  const app = nav();
  if (app) app.replace(url);
  else window.history.replaceState(window.history.state, "", url);
}

export function reloadPage(): void {
  const app = nav();
  if (app) app.reload();
  else window.location.reload();
}

// The server's origin as this page reaches it: the browser's address, or
// inside the app the host the app is talking to.
export function pageOrigin(): string {
  if (typeof window === "undefined") return "";
  return shellHost()?.hostOrigin ?? window.location.origin;
}
