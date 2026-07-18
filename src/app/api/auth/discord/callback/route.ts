import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { currentUser, startSession } from "@/lib/auth";
import { getGlobalConfig } from "@/lib/db/app-settings";
import {
  countUsers,
  createDiscordUser,
  getUserByDiscordId,
  getUserByUsername,
  linkDiscordId,
  setUserAdmin,
} from "@/lib/db/users";
import { OAUTH_COOKIE, discordCredentials, discordRedirectUri } from "@/lib/discord-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relative Location: the browser resolves it against the public URL it is
// actually on, so this works identically behind a reverse proxy.
function redirect(_requestUrl: string, path: string) {
  return new Response(null, {
    status: 302,
    headers: { Location: path },
  });
}

// The user only sees a generic "sign-in failed"; the specific step and
// upstream response land in the server journal for the operator.
function fail(requestUrl: string, reason: string, detail?: unknown) {
  console.error(`[discord-oauth] ${reason}`, detail ?? "");
  return redirect(requestUrl, "/?error=discord");
}

// Derive a valid local username from the Discord profile: allowed charset,
// 3-24 chars, unique (suffixed with random chars on collision).
function deriveUsername(globalName: string, discordUsername: string, discordId: string): string {
  let base = (globalName || discordUsername).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24);
  if (base.length < 3) {
    base = `discord-${discordId.slice(-6)}`;
  }
  if (!getUserByUsername(base)) {
    return base;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${base.slice(0, 19)}-${randomBytes(3).toString("base64url").slice(0, 4)}`;
    if (!getUserByUsername(candidate)) {
      return candidate;
    }
  }
  return `discord-${discordId.slice(-12)}`;
}

export async function GET(request: Request) {
  const credentials = discordCredentials();
  if (!credentials) {
    return fail(request.url, "callback hit while Discord is not configured");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";

  const cookieStore = await cookies();
  const stored = cookieStore.get(OAUTH_COOKIE)?.value;
  cookieStore.delete(OAUTH_COOKIE);
  let link = false;
  try {
    const parsed = JSON.parse(stored || "{}") as { state?: string; link?: boolean };
    if (!code || !parsed.state || parsed.state !== state) {
      return fail(request.url, "state mismatch or missing code", {
        hasCode: Boolean(code),
        hasCookie: Boolean(stored),
      });
    }
    link = parsed.link === true;
  } catch {
    return fail(request.url, "unreadable oauth state cookie");
  }

  // Exchange the code, then fetch the Discord profile (identify scope).
  let discordId = "";
  let discordUsername = "";
  let globalName = "";
  try {
    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: discordRedirectUri(request),
      }),
    });
    if (!tokenResponse.ok) {
      return fail(
        request.url,
        `token exchange failed (${tokenResponse.status}) — usually a wrong client secret`,
        await tokenResponse.text().catch(() => ""),
      );
    }
    const token = (await tokenResponse.json()) as { access_token?: string };
    if (!token.access_token) {
      return fail(request.url, "token response had no access_token");
    }
    const profileResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!profileResponse.ok) {
      return fail(request.url, `profile fetch failed (${profileResponse.status})`);
    }
    const profile = (await profileResponse.json()) as {
      id?: string;
      username?: string;
      global_name?: string | null;
    };
    discordId = profile.id || "";
    discordUsername = profile.username || "";
    globalName = profile.global_name || "";
  } catch (error) {
    return fail(request.url, "network error reaching Discord", error);
  }
  if (!discordId) {
    return fail(request.url, "profile response had no id");
  }

  // Link mode: attach Discord to the logged-in account.
  if (link) {
    const me = await currentUser();
    if (!me) {
      return fail(request.url, "link requested but no logged-in session");
    }
    const existing = getUserByDiscordId(discordId);
    if (existing && existing.id !== me.id) {
      return redirect(request.url, "/settings?error=discord_taken");
    }
    linkDiscordId(me.id, discordId);
    return redirect(request.url, "/settings?linked=1");
  }

  // Sign-in: an account already linked to this Discord id.
  const existing = getUserByDiscordId(discordId);
  if (existing) {
    await startSession(existing.id);
    return redirect(request.url, "/");
  }

  // New account via Discord. Mirrors /api/auth/register: blocked when
  // signups are disabled, and the very first account becomes admin.
  const isFirstUser = countUsers() === 0;
  if (!isFirstUser && !getGlobalConfig().signupsEnabled) {
    return redirect(request.url, "/?error=signups_disabled");
  }
  const username = deriveUsername(globalName, discordUsername, discordId);
  const user = createDiscordUser(username, discordId);
  if (isFirstUser) {
    setUserAdmin(user.id, true);
  }
  await startSession(user.id);
  return redirect(request.url, "/");
}
