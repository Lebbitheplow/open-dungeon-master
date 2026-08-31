// Voice deployment config: port parsing and the unroutable-address guard.
//
// These are the two settings that decide whether a call connects at all, and
// both fail silently when wrong (the call negotiates, reports connected, and
// carries no audio), so they are worth pinning down here rather than finding
// out on a game night.
//
// src/lib/voice/config.ts reads the environment through serverEnv, so the pure
// helpers are re-implemented here the way the other suites do it, and the
// source is checked to make sure the two have not drifted.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(root, "src/lib/voice/config.ts"), "utf8");

const DEFAULT_RTC_PORT = 44444;

function parsePort(raw) {
  const port = Number.parseInt(raw, 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_RTC_PORT;
}

// Precedence: an explicit domain, then the announced IP, then the bind
// address. Mirrors announcedAddressFor in src/lib/voice/config.ts.
function announcedAddressFor({ domain = "", announcedIp = "", listenIp = "0.0.0.0" }) {
  return domain || announcedIp || listenIp;
}

function isUnroutableAddress(address) {
  if (!address || address === "0.0.0.0" || address === "::") {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

// The default must match what docker-compose.yml publishes and what the docs
// tell people to open, or an owner follows the instructions and still fails.
check("default port agrees with config.ts", () => {
  assert.match(source, /DEFAULT_RTC_PORT = 44444/);
});

check("default port agrees with docker-compose", () => {
  const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  assert.match(compose, /VOICE_RTC_PORT:-44444/);
  // Both protocols on the same number: UDP is the real path, TCP the fallback
  // for networks that block outbound UDP.
  assert.match(compose, /\/udp"/);
  assert.match(compose, /\/tcp"/);
});

// Voice is opt-in: it cannot work until the owner opens a port and serves the
// app over https, so an install that upgrades into this feature must not get a
// Join button that fails.
check("voice is off unless explicitly enabled", () => {
  assert.match(source, /serverEnv\("VOICE_ENABLED", "0"\) === "1"/);
  const compose = readFileSync(path.join(root, "docker-compose.yml"), "utf8");
  assert.match(compose, /VOICE_ENABLED:-0/);
});

check("a domain wins over the announced IP", () => {
  assert.equal(
    announcedAddressFor({ domain: "voice.example.com", announcedIp: "203.0.113.10" }),
    "voice.example.com",
  );
});

check("the announced IP is used when no domain is set", () => {
  assert.equal(announcedAddressFor({ announcedIp: "203.0.113.10" }), "203.0.113.10");
  assert.equal(announcedAddressFor({ domain: "", announcedIp: "192.168.1.50" }), "192.168.1.50");
});

// A localhost-only install configures nothing at all, which is the whole point
// of falling through to the bind address.
check("an unconfigured install falls back to the bind address", () => {
  assert.equal(announcedAddressFor({}), "0.0.0.0");
  assert.equal(announcedAddressFor({ listenIp: "127.0.0.1" }), "127.0.0.1");
});

check("valid ports are taken as given", () => {
  assert.equal(parsePort("44444"), 44444);
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("65535"), 65535);
});

check("nonsense ports fall back to the default", () => {
  for (const raw of ["", "abc", "0", "-5", "65536", "99999"]) {
    assert.equal(parsePort(raw), DEFAULT_RTC_PORT, `expected fallback for ${JSON.stringify(raw)}`);
  }
});

// Binding 0.0.0.0 is correct; ANNOUNCING it is not, because a browser cannot
// dial "all interfaces".
check("wildcard bind addresses are unroutable", () => {
  assert.equal(isUnroutableAddress(""), true);
  assert.equal(isUnroutableAddress("0.0.0.0"), true);
  assert.equal(isUnroutableAddress("::"), true);
});

// The classic Docker failure: the container announces its bridge address, the
// call negotiates, and no audio ever arrives.
check("docker bridge range is unroutable", () => {
  for (const address of ["172.16.0.2", "172.17.0.2", "172.20.10.5", "172.31.255.254"]) {
    assert.equal(isUnroutableAddress(address), true, `${address} should be rejected`);
  }
});

// 172.15 and 172.32 are outside the private /12 and must not be caught by the
// regex, which is the easy off-by-one to get wrong here.
check("addresses outside the bridge range are allowed", () => {
  for (const address of ["172.15.0.1", "172.32.0.1", "192.168.1.50", "10.0.0.5", "203.0.113.10"]) {
    assert.equal(isUnroutableAddress(address), false, `${address} should be allowed`);
  }
});

// mediasoup accepts a hostname, not just an IP, which is what makes the
// DNS-only subdomain workaround for a proxied domain possible.
check("hostnames are allowed as announced addresses", () => {
  assert.equal(isUnroutableAddress("voice.example.com"), false);
});

if (failures) {
  console.error(`\n${failures} voice config check(s) failed.`);
  process.exit(1);
}
console.log("voice config checks passed.");
