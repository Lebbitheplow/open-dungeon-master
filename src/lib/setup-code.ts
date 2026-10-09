// SECURITY: who may create a server's first account, which becomes its
// admin. "Nobody has signed up yet" proves nothing about who is asking: a
// fresh container publishes its port before anyone has visited it, and
// whoever reached it first used to own it. The first account now needs a
// one-time setup code that only the operator can see, in the server log
// (printed at every start until it is used) or chosen in ODM_SETUP_CODE.
//
// A world one of the apps hosts (ODM_DEVICE_WORLD=1) never mints or prints
// a code: nobody is reading its log. Its shell creates the host's account
// itself the moment it starts the server, and a shell that knows about the
// code hands the server one in ODM_SETUP_CODE and sends
// it back with that first registration, so nobody on the same Wi-Fi can get
// there first. A device world started without one keeps the old behaviour.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { getAppSetting } from "@/lib/db/app-settings";
import { getDatabase, nowIso } from "@/lib/db/core";
import { countUsers, createUser, type User } from "@/lib/db/users";
import { isDeviceWorld, serverEnv } from "@/lib/server-env";

const SETUP_CODE_KEY = "setup_code";
// No 0/O, 1/I/L or U/V, so a code read off a terminal is typed back right.
const ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

// Upper case, separators and spaces dropped, so "abcd efgh-..." still matches.
function normalize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function mint(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    let text = "";
    for (let at = 0; at < GROUP_LENGTH; at += 1) {
      text += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(text);
  }
  return groups.join("-");
}

// Whether this server is waiting for its first account to be claimed with
// the setup code.
export function needsSetup(): boolean {
  return firstAccountTakesCode() && countUsers() === 0;
}

// Whether this server's first account is claimed with a code at all: always
// on a server somebody runs, and on a device world only when its shell
// chose one.
export function firstAccountTakesCode(): boolean {
  return !isDeviceWorld() || Boolean(serverEnv("ODM_SETUP_CODE").trim());
}

// The code that claims the first account: the operator's own when
// ODM_SETUP_CODE is set, otherwise one minted once and kept in the database
// until it is spent. INSERT OR IGNORE makes the first mint atomic.
export function currentSetupCode(): string {
  const chosen = serverEnv("ODM_SETUP_CODE").trim();
  if (chosen) {
    return chosen;
  }
  getDatabase()
    .prepare(`INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`)
    .run(SETUP_CODE_KEY, JSON.stringify(mint()), nowIso());
  return getAppSetting<string>(SETUP_CODE_KEY, "");
}

export function setupCodeMatches(input: string | undefined): boolean {
  const given = normalize(input ?? "");
  const expected = normalize(currentSetupCode());
  if (!given || !expected) {
    return false;
  }
  // Compared as digests so neither the length nor the content leaks by timing.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

// Creates the first account as admin, if the code is right and nobody has
// claimed the server in the meantime; null otherwise. The check, the
// spending of the code and the insert are one transaction, so a replayed or
// concurrent claim finds a user already there and fails.
export function claimFirstAdmin(username: string, passwordHash: string, code: string | undefined): User | null {
  const db = getDatabase();
  return db.transaction((): User | null => {
    if (countUsers() !== 0 || !setupCodeMatches(code)) {
      return null;
    }
    db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(SETUP_CODE_KEY);
    return createUser(username, passwordHash, { isAdmin: true });
  })();
}

// The startup banner. Called once per boot; says nothing once anyone has
// an account, or on a device world (its shell holds the code).
export function announceSetupCode(log: (line: string) => void = console.log) {
  if (isDeviceWorld() || !needsSetup()) {
    return;
  }
  const code = currentSetupCode();
  const chosen = Boolean(serverEnv("ODM_SETUP_CODE").trim());
  const bar = "=".repeat(64);
  log(
    [
      bar,
      " This server has no accounts yet. Create the first one, which",
      " becomes the admin, with this one-time setup code:",
      "",
      `     ${chosen ? "(the code set in ODM_SETUP_CODE)" : code}`,
      "",
      // The link fills the code in and leads on to the guided setup. An
      // operator's own code is never echoed, so its link is the bare address.
      " Or open this link in a browser on this computer:",
      "",
      `     ${setupLink(chosen ? "" : code)}`,
      "",
      " (From another computer, use this server's address in its place.)",
      " It is shown here at every start until the first account exists.",
      bar,
    ].join("\n"),
  );
}

// The address that claims the server: this machine, the port it listens on
// (Next sets PORT once it is listening; the Docker image sets it outright).
export function setupLink(code: string, port = process.env.PORT || "3000"): string {
  return `http://localhost:${port}/${code ? `?setup=${encodeURIComponent(code)}` : ""}`;
}
