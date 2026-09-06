// Portal mode: the desktop and Android apps serve this UI from their own
// bundled copy of the server and forward only the data calls to the host
// the player is visiting. The app plants two cookies on its local origin,
// the host's address and the player's bearer token for it, and src/proxy.ts
// rewrites every data path (the API and the served files) to that host
// with the token as the Authorization header. Pages, scripts, styles and
// static assets stay local, so a tunnel only ever carries game data and
// the controls are always the app's own.
//
// Pure functions, no "@/" imports: scripts/test-portal.mjs loads this file
// straight from disk.

export const PORTAL_ORIGIN_COOKIE = "odm_portal_origin";
export const PORTAL_TOKEN_COOKIE = "odm_portal_token";

// Everything the UI fetches as data rather than as its own code: the API,
// player uploads, generated art and narration, and the ambience library.
export const PORTAL_PREFIXES = ["/api/", "/uploads/", "/generated/", "/generated-audio/", "/ambience/"];

export const PORTAL_LOGOUT_PATH = "/api/auth/logout";

export interface PortalTarget {
  origin: string;
  token: string;
}

// The host's origin as the app planted it: http or https, a host, nothing
// else. Anything with a path, credentials or another scheme is refused, so
// the proxy can only ever be pointed at a server's root.
export function portalOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export function portalFromCookies(
  read: (name: string) => string | undefined,
): PortalTarget | null {
  const origin = portalOrigin(read(PORTAL_ORIGIN_COOKIE));
  const token = (read(PORTAL_TOKEN_COOKIE) ?? "").trim();
  if (!origin || !token || !/^[A-Za-z0-9_-]{16,512}$/.test(token)) return null;
  return { origin, token };
}

export function isPortalPath(pathname: string): boolean {
  return PORTAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function portalTargetUrl(origin: string, pathname: string, search: string): string {
  return `${origin}${pathname}${search}`;
}

// Hop-by-hop and origin-bound headers stay behind; the host sees the
// player's bearer token instead of the app's cookies, and a marker so a
// server can tell a portal request from a browser's.
const DROPPED_HEADERS = new Set([
  "cookie",
  "host",
  "authorization",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailer",
]);

export function forwardHeaders(
  headers: Iterable<[string, string]>,
  token: string,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    if (DROPPED_HEADERS.has(key) || key.startsWith("x-forwarded-") || key.startsWith("x-middleware-")) {
      continue;
    }
    out.push([key, value]);
  }
  out.push(["authorization", `Bearer ${token}`]);
  out.push(["x-odm-portal", "1"]);
  return out;
}
