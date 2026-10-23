import os from "node:os";
import { configValue, getGlobalConfig } from "@/lib/app-config";
import { requestPublicOrigin } from "@/lib/server-address";
import { serverEnv } from "@/lib/server-env";

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

// The origin browsers actually reach the app on, which Discord's redirect_uri
// and the agent addresses are built from. The order, and why a stale saved
// Wi-Fi address is passed over, live in requestPublicOrigin.
export function publicOrigin(request: Request): string {
  return requestPublicOrigin({
    savedPublicUrl: getGlobalConfig().publicUrl,
    envPublicUrl: serverEnv("APP_PUBLIC_URL"),
    interfaces: os.networkInterfaces(),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    requestUrl: request.url,
  });
}

export function discordRedirectUri(request: Request): string {
  return `${publicOrigin(request)}/api/auth/discord/callback`;
}
