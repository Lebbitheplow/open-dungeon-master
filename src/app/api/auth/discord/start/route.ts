import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cookieSecure } from "@/lib/auth";
import { OAUTH_COOKIE, discordCredentials, discordRedirectUri } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Kicks off the Discord authorization-code flow. ?link=1 means "attach
// Discord to the already-logged-in account" instead of signing in.
export async function GET(request: Request) {
  const credentials = discordCredentials();
  if (!credentials) {
    return Response.json({ error: "Discord sign-in is not configured." }, { status: 404 });
  }

  const state = randomBytes(16).toString("base64url");
  const params = new URL(request.url).searchParams;
  const link = params.get("link") === "1";
  // Account invite code (invite-only signup mode), carried through the OAuth
  // round trip in the state cookie so the callback can spend it when the
  // sign-in turns out to create a new account.
  const invite = (params.get("invite") ?? "").trim().toUpperCase().slice(0, 40);
  // Where to land after sign-in (e.g. back to /join/CODE). Only a local
  // path is accepted so the cookie can never turn the callback into an
  // open redirect.
  const rawNext = params.get("next") ?? "";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && rawNext.length <= 200 ? rawNext : "";
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_COOKIE, JSON.stringify({ state, link, invite, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: 600,
  });

  const authorize = new URL("https://discord.com/oauth2/authorize");
  authorize.searchParams.set("client_id", credentials.clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "identify");
  authorize.searchParams.set("redirect_uri", discordRedirectUri(request));
  authorize.searchParams.set("state", state);

  return new Response(null, { status: 302, headers: { Location: authorize.toString() } });
}
