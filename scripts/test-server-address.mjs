// The address the floating QR button hands out (src/lib/server-address.ts):
// which local-network origins a machine's interfaces yield, and the order
// the button offers the candidates in.

import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { lanOrigins, shareableAddresses, isLoopbackOrigin, livePublicUrl } = await import(
  "../src/lib/server-address.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const interfaces = {
  lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  enp1: [
    { address: "192.168.1.128", family: "IPv4", internal: false },
    { address: "fe80::1", family: "IPv6", internal: false },
  ],
  docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  wlan: [{ address: "169.254.10.4", family: "IPv4", internal: false }],
  tun: [{ address: "100.64.0.9", family: 4, internal: false }],
};

test("lanOrigins keeps routable IPv4 addresses on the request port", () => {
  // docker0 is a container bridge: only this machine can reach it.
  assert.deepEqual(lanOrigins(interfaces, "http:", "3005"), [
    "http://192.168.1.128:3005",
    "http://100.64.0.9:3005",
  ]);
  const bridges = { ...interfaces, "br-e7b446ea28f9": [{ address: "172.19.0.1", family: "IPv4", internal: false }], veth12: [{ address: "172.30.0.1", family: "IPv4", internal: false }] };
  assert.ok(lanOrigins(bridges, "http:", "3005").every((entry) => !entry.includes("172.")));
});

test("lanOrigins drops loopback, IPv6, link-local, and dedups", () => {
  const doubled = { ...interfaces, again: interfaces.enp1 };
  const origins = lanOrigins(doubled, "https", "");
  assert.equal(origins.filter((entry) => entry.includes("192.168.1.128")).length, 1);
  assert.ok(origins.every((entry) => entry.startsWith("https://")));
  assert.ok(origins.every((entry) => !entry.includes("127.0.0.1") && !entry.includes("169.254")));
  assert.ok(origins.every((entry) => !/:\d+$/.test(entry)), "no port when the request had none");
});

test("a saved public URL is only offered while it can be true", () => {
  // A hostname or a public address is taken at its word.
  assert.equal(livePublicUrl("https://abc.trycloudflare.com/", interfaces), "https://abc.trycloudflare.com");
  assert.equal(livePublicUrl("http://203.0.113.9:3005", interfaces), "http://203.0.113.9:3005");
  // A private address this machine holds is fine.
  assert.equal(livePublicUrl("http://192.168.1.128:3005/", interfaces), "http://192.168.1.128:3005");
  // One it does not hold is a leftover from another machine or network.
  assert.equal(livePublicUrl("http://192.168.1.169:3210", interfaces), "");
  assert.equal(livePublicUrl("", interfaces), "");
  assert.equal(livePublicUrl("not a url", interfaces), "");
});

test("isLoopbackOrigin recognises the local names", () => {
  assert.ok(isLoopbackOrigin("http://localhost:3000"));
  assert.ok(isLoopbackOrigin("http://127.0.0.1:3005"));
  assert.ok(!isLoopbackOrigin("http://192.168.1.128:3005"));
  assert.ok(!isLoopbackOrigin("nonsense"));
});

test("a public URL leads, then the LAN when the tab is on loopback", () => {
  assert.deepEqual(
    shareableAddresses({
      publicUrl: "https://abc.trycloudflare.com/",
      lanUrls: ["http://192.168.1.128:3005"],
      current: "http://127.0.0.1:3005",
    }),
    ["https://abc.trycloudflare.com", "http://192.168.1.128:3005", "http://127.0.0.1:3005"],
  );
});

test("the tab's own address leads when it is already reachable", () => {
  assert.deepEqual(
    shareableAddresses({
      publicUrl: "",
      lanUrls: ["http://192.168.1.128:3005", "http://172.17.0.1:3005"],
      current: "http://192.168.1.128:3005",
    }),
    ["http://192.168.1.128:3005", "http://172.17.0.1:3005"],
  );
});

test("with nothing from the server the tab's address is the only answer", () => {
  assert.deepEqual(shareableAddresses({ current: "https://play.example.com" }), [
    "https://play.example.com",
  ]);
});

console.log(`test-server-address: ${passed} passed`);
