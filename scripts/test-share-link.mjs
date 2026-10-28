// Canonical invite link shapes, cross-checked against the deployed /j
// redirector's own parsers so the two cannot drift apart silently.
import assert from "node:assert/strict";
import { buildShareLinks, hostCodeFromOrigin } from "../src/lib/share-link.ts";
import { parseCode, parseServer } from "../workers/j-redirector/src/index.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("publicOrigin wins over the visitor's address", () => {
  const links = buildShareLinks({
    publicOrigin: "https://abc.trycloudflare.com",
    inviteCode: "WXYZ2345",
    fallbackOrigin: "http://127.0.0.1:3000",
  });
  assert.equal(links.origin, "https://abc.trycloudflare.com");
  assert.equal(links.joinUrl, "https://abc.trycloudflare.com/join/WXYZ2345");
  assert.equal(
    links.appUrl,
    "https://opengamemaster.com/j?s=https%3A%2F%2Fabc.trycloudflare.com&c=WXYZ2345",
  );
});

test("falls back to the visitor's address when publicUrl is unset", () => {
  const links = buildShareLinks({
    publicOrigin: "",
    inviteCode: "WXYZ2345",
    fallbackOrigin: "http://192.168.1.5:3000",
  });
  assert.equal(links.joinUrl, "http://192.168.1.5:3000/join/WXYZ2345");
});

test("trailing slashes never leak into links", () => {
  const links = buildShareLinks({
    publicOrigin: "https://odm.example.com/",
    inviteCode: "WXYZ2345",
    fallbackOrigin: "",
  });
  assert.equal(links.joinUrl, "https://odm.example.com/join/WXYZ2345");
  assert.equal(
    links.appUrl,
    "https://opengamemaster.com/j?s=https%3A%2F%2Fodm.example.com&c=WXYZ2345",
  );
});

test("codes are uppercased like the redirector expects", () => {
  const links = buildShareLinks({
    publicOrigin: "https://odm.example.com",
    inviteCode: "wxyz2345",
    fallbackOrigin: "",
  });
  assert.equal(links.joinUrl, "https://odm.example.com/join/WXYZ2345");
});

test("no origin at all yields no links", () => {
  const links = buildShareLinks({ publicOrigin: "", inviteCode: "WXYZ2345", fallbackOrigin: "" });
  assert.equal(links.joinUrl, "");
  assert.equal(links.appUrl, "");
});

test("the /j link round-trips through the redirector's parsers", () => {
  const { appUrl } = buildShareLinks({
    publicOrigin: "https://abc.trycloudflare.com",
    inviteCode: "wxyz2345",
    fallbackOrigin: "",
  });
  const url = new URL(appUrl);
  assert.equal(url.origin, "https://opengamemaster.com");
  assert.equal(url.pathname, "/j");
  assert.equal(parseServer(url.searchParams.get("s")), "https://abc.trycloudflare.com");
  assert.equal(parseCode(url.searchParams.get("c")), "WXYZ2345");
});

test("a brokered address turns into a typeable room code", () => {
  const links = buildShareLinks({
    publicOrigin: "https://play-abcd2345.opengamemaster.com",
    inviteCode: "WXYZ2345",
    fallbackOrigin: "",
  });
  assert.equal(links.roomCode, "ABCD2345-WXYZ2345");
  assert.equal(hostCodeFromOrigin("https://play-abcd2345.opengamemaster.com"), "ABCD2345");
});

test("an address on the old domain still turns into a room code until it lapses", () => {
  // Apps from before the move share at the old domain; the broker names
  // every session in both, so the same room code reaches the host either way.
  assert.equal(hostCodeFromOrigin("https://play-abcd2345.opendungeonmaster.com"), "ABCD2345");
  assert.equal(hostCodeFromOrigin("https://play-abcd2345.opendungeonmaster.com.evil.com"), "");
});

test("any other address has no room code to show", () => {
  for (const publicOrigin of [
    "https://abc.trycloudflare.com",
    "http://192.168.1.5:3000",
    "https://odm.example.com",
    "https://play-abcd2345.evil.com",
  ]) {
    const links = buildShareLinks({ publicOrigin, inviteCode: "WXYZ2345", fallbackOrigin: "" });
    assert.equal(links.roomCode, "", publicOrigin);
    assert.equal(hostCodeFromOrigin(publicOrigin), "", publicOrigin);
  }
});

test("a host code the broker could not have minted is not shown", () => {
  // L is missing from the broker's alphabet, and codes are always eight.
  assert.equal(hostCodeFromOrigin("https://play-abcl2345.opengamemaster.com"), "");
  assert.equal(hostCodeFromOrigin("https://play-abcd234.opengamemaster.com"), "");
});

console.log(`test-share-link: ${passed} tests passed.`);
