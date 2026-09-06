import { NextResponse, type NextRequest } from "next/server";
import {
  PORTAL_LOGOUT_PATH,
  PORTAL_ORIGIN_COOKIE,
  PORTAL_TOKEN_COOKIE,
  forwardHeaders,
  isPortalPath,
  portalFromCookies,
  portalTargetUrl,
} from "@/lib/portal";

// Portal mode (src/lib/portal.ts): when the app that serves this UI has
// planted a host and a token, every data request is answered by that host
// instead of this server. Without the cookies nothing here changes.

export function proxy(request: NextRequest) {
  const target = portalFromCookies((name) => request.cookies.get(name)?.value);
  if (!target) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  if (!isPortalPath(pathname)) return NextResponse.next();
  const headers = new Headers();
  for (const [name, value] of forwardHeaders(request.headers, target.token)) {
    headers.set(name, value);
  }
  const response = NextResponse.rewrite(portalTargetUrl(target.origin, pathname, search), {
    request: { headers },
  });
  // Logging out on the host ends the portal too: the app watches these
  // cookies and returns to its home screen when they go.
  if (pathname === PORTAL_LOGOUT_PATH && request.method === "POST") {
    for (const name of [PORTAL_ORIGIN_COOKIE, PORTAL_TOKEN_COOKIE]) {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/uploads/:path*",
    "/generated/:path*",
    "/generated-audio/:path*",
    "/ambience/:path*",
  ],
};
