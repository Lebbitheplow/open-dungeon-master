// Cross-origin access for the desktop and Android apps' own screens. The
// apps draw the game natively and call this server's API directly with a
// bearer token, from origins a browser treats as foreign: Electron loads
// its page from disk (Origin "null"), Capacitor from https://localhost or
// capacitor://localhost. Those origins, and any an admin lists in
// ODM_APP_ORIGINS, may call the data paths with a bearer header.
//
// No credentials are ever allowed across origins: cookies stay same-site,
// so an allowed origin without a token gets exactly what an anonymous
// visitor gets. Pure functions, no "@/" imports, for scripts/test-app-cors.mjs.

export const DEFAULT_APP_ORIGINS = ["null", "https://localhost", "capacitor://localhost"];

export const APP_CORS_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
export const APP_CORS_HEADERS = "authorization, content-type, last-event-id, x-odm-client";
export const APP_CORS_EXPOSE = "content-type, content-length, content-disposition";

// The origins an ODM_APP_ORIGINS value adds (comma separated), each
// normalized to a bare origin; junk entries are dropped.
export function extraAppOrigins(env: string | undefined): string[] {
  return (env ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      try {
        return new URL(entry).origin;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

// The request's Origin when it is one of the apps', else null (a browser on
// the server's own pages sends none, or its own; neither needs anything).
export function allowedAppOrigin(
  origin: string | null | undefined,
  extra: readonly string[] = [],
): string | null {
  if (!origin) return null;
  if (DEFAULT_APP_ORIGINS.includes(origin) || extra.includes(origin)) return origin;
  return null;
}

export function appCorsHeaders(origin: string): [string, string][] {
  return [
    ["access-control-allow-origin", origin],
    ["access-control-allow-methods", APP_CORS_METHODS],
    ["access-control-allow-headers", APP_CORS_HEADERS],
    ["access-control-expose-headers", APP_CORS_EXPOSE],
    ["access-control-max-age", "86400"],
    ["vary", "Origin"],
  ];
}

export function isPreflight(method: string, requestMethod: string | null | undefined): boolean {
  return method.toUpperCase() === "OPTIONS" && !!requestMethod;
}
