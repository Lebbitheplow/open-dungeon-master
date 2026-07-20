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
  const link = new URL(request.url).searchParams.get("link") === "1";
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_COOKIE, JSON.stringify({ state, link }), {
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
