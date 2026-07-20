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
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    deleteSession(hashToken(token));
  }
  cookieStore.delete(SESSION_COOKIE);
}

// Hash of the caller's session token, so password changes can revoke every
// other session while keeping this one alive.
export async function currentSessionTokenHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

// Returns the logged-in user, or null. Route handlers that require auth
// should 401 on null.
export async function currentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  return getSessionUser(hashToken(token));
}

export function unauthorized() {
  return Response.json({ error: "Not logged in." }, { status: 401 });
}
