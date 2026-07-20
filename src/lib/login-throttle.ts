// Per-username+IP login throttle: after 5 failures inside a 15 minute
// window the pair is locked out for 60s, doubling on each further lockout
// up to 15 minutes. Pure logic with caller-supplied timestamps so the test
// harness can drive the clock; state lives on globalThis to survive dev HMR
// reloads (same pattern as the DM queue).

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const BASE_LOCKOUT_MS = 60 * 1000;
const MAX_LOCKOUT_MS = 15 * 60 * 1000;

type ThrottleEntry = {
  failures: number[];
  lockouts: number;
  blockedUntil: number;
};

declare global {
  var __odmLoginThrottle: Map<string, ThrottleEntry> | undefined;
}

function store(): Map<string, ThrottleEntry> {
  if (!globalThis.__odmLoginThrottle) {
    globalThis.__odmLoginThrottle = new Map();
  }
  return globalThis.__odmLoginThrottle;
}

export function throttleKey(username: string, ip: string) {
  return `${username.trim().toLowerCase()}|${ip}`;
}

function prune(now: number) {
  for (const [key, entry] of store()) {
    const lastFailure = entry.failures[entry.failures.length - 1] ?? 0;
    if (entry.blockedUntil <= now && now - lastFailure > WINDOW_MS) {
      store().delete(key);
    }
  }
}

export function checkLogin(key: string, now = Date.now()): { blocked: boolean; retryAfterSec: number } {
  prune(now);
  const entry = store().get(key);
  if (!entry || entry.blockedUntil <= now) {
    return { blocked: false, retryAfterSec: 0 };
  }
  return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)) };
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const entry = store().get(key) ?? { failures: [], lockouts: 0, blockedUntil: 0 };
  entry.failures = entry.failures.filter((at) => now - at <= WINDOW_MS);
  entry.failures.push(now);
  if (entry.failures.length >= MAX_FAILURES) {
    const lockoutMs = Math.min(BASE_LOCKOUT_MS * 2 ** entry.lockouts, MAX_LOCKOUT_MS);
    entry.lockouts += 1;
    entry.blockedUntil = now + lockoutMs;
    entry.failures = [];
  }
  store().set(key, entry);
}

export function recordLoginSuccess(key: string) {
  store().delete(key);
}
