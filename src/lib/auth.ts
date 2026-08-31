import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import {
  deleteSession,
  getSessionUser,
  insertSession,
  type User,
} from "@/lib/db/users";
import { serverEnv } from "@/lib/server-env";

export const SESSION_COOKIE = "odm_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split("$");
  if (!salt || !hash) {
    return false;
  }
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

// Secure flag for auth cookies: COOKIE_SECURE=1/0 overrides; otherwise on
// whenever the request arrived over https (reverse proxy sets the header).
// Plain LAN http keeps working with the flag off.
export async function cookieSecure(): Promise<boolean> {
  const override = serverEnv("COOKIE_SECURE");
  if (override === "1") return true;
  if (override === "0") return false;
  const proto = ((await headers()).get("x-forwarded-proto") ?? "").split(",")[0].trim();
  return proto === "https";
}

// Reads the token native client apps send instead of the browser cookie.
// Cookie and bearer sessions are the same rows in the sessions table; only
// the transport differs.
async function bearerToken(): Promise<string | null> {
  const header = (await headers()).get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

async function requestToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? (await bearerToken());
}

// Creates a session row and returns the raw token without touching cookies:
// the caller (a native app via /api/auth/token) stores it itself.
export function mintSession(userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  insertSession(hashToken(token), userId, expiresAt.toISOString());
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  insertSession(hashToken(token), userId, expiresAt.toISOString());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession() {
  const token = await requestToken();
  if (token) {
    deleteSession(hashToken(token));
  }
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// Hash of the caller's session token, so password changes can revoke every
// other session while keeping this one alive.
export async function currentSessionTokenHash(): Promise<string | null> {
  const token = await requestToken();
  return token ? hashToken(token) : null;
}

// Returns the logged-in user, or null. Route handlers that require auth
// should 401 on null. Accepts the browser cookie or a bearer token.
export async function currentUser(): Promise<User | null> {
  const token = await requestToken();
  if (!token) {
    return null;
  }
  return getSessionUser(hashToken(token));
}

export function unauthorized() {
  return Response.json({ error: "Not logged in." }, { status: 401 });
}
