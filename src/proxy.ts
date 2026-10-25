import { NextResponse, type NextRequest } from "next/server";
import { allowedAppOrigin, appCorsHeaders, extraAppOrigins, isPreflight } from "@/lib/app-cors";
import { describeLimit, judgeBody } from "@/lib/body-limits";
import { maintenanceState } from "@/lib/maintenance";
import { ISOLATION_HEADERS, pagesIsolated } from "@/lib/page-isolation";
import {
  PORTAL_LOGOUT_PATH,
  PORTAL_ORIGIN_COOKIE,
  PORTAL_SIG_COOKIE,
  PORTAL_TOKEN_COOKIE,
  forwardHeaders,
  isPortalPath,
  portalFromCookies,
  portalTargetUrl,
} from "@/lib/portal";

// Two doors for the desktop and Android apps, both on the data paths only:
//
// - App origins (src/lib/app-cors.ts): the apps' native screens call the
//   API directly with a bearer token from a foreign origin, so those
//   origins get CORS headers and their preflights an empty 204.
// - Portal mode (src/lib/portal.ts): when the app that serves this UI has
//   planted a host and a token, signed with the secret it started this
//   server with, every data request is answered by that host instead of
//   this server. A server nobody gave a secret (any hosted one) has no
//   portal at all, whatever cookies a request carries.
//
// Without an app origin or the signed portal cookies nothing here changes.
//
// Uploads, generated pictures and narration audio reach the route that
// checks the login (src/app/api/media) through the rewrites in
// next.config.ts, not from here. A rewrite made here carries an absolute
// address, and Next only keeps it inside the server when that address has
// the origin it thinks it is listening on. A server bound to 127.0.0.1 (the
// world a desktop app hosts) never matches, since the address here always
// says "localhost", so every picture was fetched back over the network from
// itself; behind a tunnel that speaks https that fetch went to its own plain
// http port as TLS and every picture answered 500.

const extra = extraAppOrigins(process.env.ODM_APP_ORIGINS);
const portalSecret = process.env.ODM_PORTAL_SECRET;

// The data paths, where the doors below apply. Every other path is a page or
// a public file, and passes through only for cross-origin isolation, when
// the server's addons call for it (src/lib/page-isolation.ts).
const DATA_ROOTS = ["/api", "/uploads", "/generated", "/generated-audio", "/ambience", "/assets", "/dice-box", "/sidebar-icons"];

function isDataPath(pathname: string): boolean {
  return DATA_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

function isolated(response: NextResponse): NextResponse {
  if (pagesIsolated()) {
    for (const [name, value] of ISOLATION_HEADERS) response.headers.set(name, value);
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!isDataPath(pathname)) return isolated(NextResponse.next());
  const appOrigin = allowedAppOrigin(request.headers.get("origin"), extra);

  if (appOrigin && isPreflight(request.method, request.headers.get("access-control-request-method"))) {
    const preflight = new NextResponse(null, { status: 204 });
    for (const [name, value] of appCorsHeaders(appOrigin)) preflight.headers.set(name, value);
    return preflight;
  }

  // A live restore has replaced the world under this process: nothing is
  // read or written until it restarts (src/lib/maintenance.ts).
  const maintenance = maintenanceState();
  if (maintenance) {
    const stopped = NextResponse.json(
      { error: "This server is restarting after a restore. Try again once it is back.", maintenance: true },
      { status: 503, headers: { "Retry-After": "30" } },
    );
    if (appOrigin) {
      for (const [name, value] of appCorsHeaders(appOrigin)) stopped.headers.set(name, value);
    }
    return stopped;
  }

  // Every route's body budget (src/lib/body-limits.ts), judged on what the
  // request declares, before Next has copied more than that into memory.
  const body = judgeBody(
    request.method,
    pathname,
    request.headers.get("content-length"),
    request.headers.get("transfer-encoding"),
  );
  if (!body.ok) {
    const refused = NextResponse.json(
      {
        error:
          body.status === 413
            ? `That is too large to send here (the limit is ${describeLimit(body.limit)}).`
            : "Send the size of the request with it (Content-Length).",
      },
      { status: body.status, headers: { Connection: "close" } },
    );
    if (appOrigin) {
      for (const [name, value] of appCorsHeaders(appOrigin)) refused.headers.set(name, value);
    }
    return refused;
  }

  let response: NextResponse;
  const target = portalFromCookies((name) => request.cookies.get(name)?.value, portalSecret);
  if (target && isPortalPath(pathname)) {
    const headers = new Headers();
    for (const [name, value] of forwardHeaders(request.headers, target.token)) {
      headers.set(name, value);
    }
    response = NextResponse.rewrite(portalTargetUrl(target.origin, pathname, search), {
      request: { headers },
    });
    // Logging out on the host ends the portal too: the app watches these
    // cookies and returns to its home screen when they go.
    if (pathname === PORTAL_LOGOUT_PATH && request.method === "POST") {
      for (const name of [PORTAL_ORIGIN_COOKIE, PORTAL_TOKEN_COOKIE, PORTAL_SIG_COOKIE]) {
        response.cookies.set(name, "", { path: "/", maxAge: 0 });
      }
    }
  } else {
    response = NextResponse.next();
  }

  if (appOrigin) {
    for (const [name, value] of appCorsHeaders(appOrigin)) response.headers.set(name, value);
  }
  // A PDF the lore panel frames is a page inside an isolated page.
  return isolated(response);
}

// Everything but Next's own build files: the data paths for the doors above,
// the rest for isolation.
export const config = {
  matcher: ["/((?!_next/static/|_next/image).*)"],
};
