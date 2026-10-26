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

// Where a character page's "back" leads when it was opened from a
// workshop's Party tool (?from=/workshop/<id>?system=party). Only that
// shape is taken, so a crafted link cannot send the button off the site or
// anywhere else; anything else is null and the page goes back to the library.
export function workshopReturnPath(from: string | null | undefined): string | null {
  return from && /^\/workshop\/[A-Za-z0-9_-]+(\?system=[a-z-]+)?$/.test(from) ? from : null;
}

// A full navigation to another page of this server.
export function navigateTo(url: string): void {
  const app = nav();
  if (app) app.push(url);
  else window.location.href = url;
}

// A view kept in the address (?view=prep), changed without navigating: the
// page stays mounted and useSearchParams follows, because Next keeps it in
// step with a native pushState or replaceState given no state of its own.
// replaceAddress below hands Next its own state back, which Next takes for
// one of its own calls and does not follow. Inside the app its router does
// the same as these.
export function pushView(url: string): void {
  const app = nav();
  if (app) app.push(url);
  else window.history.pushState(null, "", url);
}

export function replaceView(url: string): void {
  const app = nav();
  if (app) app.replace(url);
  else window.history.replaceState(null, "", url);
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
