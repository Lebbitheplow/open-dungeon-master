import { configValue, getGlobalConfig } from "@/lib/app-config";

export const OAUTH_COOKIE = "odm_oauth";

// Discord sign-in is on only when both halves of the app credentials
// resolve (admin panel first, then env). identify scope only; no email.
export function discordCredentials(): { clientId: string; clientSecret: string } | null {
  const cfg = getGlobalConfig().discord;
  const clientId = configValue(cfg.clientId, "DISCORD_CLIENT_ID");
  const clientSecret = configValue(cfg.clientSecret, "DISCORD_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

// The origin browsers actually reach the app on. Behind a reverse proxy the
// request URL is the internal address (127.0.0.1:3005), which would make the
// OAuth redirect_uri mismatch what's registered with Discord. Resolution:
// admin panel Public URL > APP_PUBLIC_URL env var > X-Forwarded-Proto/Host
// headers > request origin.
export function publicOrigin(request: Request): string {
  const configured = configValue(getGlobalConfig().publicUrl, "APP_PUBLIC_URL")
    .trim()
    .replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    return `${proto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export function discordRedirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/auth/discord/callback`;
}
