// Canonical invite link shapes, cross-checked against the deployed /j
// redirector's own parsers so the two cannot drift apart silently.
import assert from "node:assert/strict";
import { buildShareLinks } from "../src/lib/share-link.ts";
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
    "https://opendungeonmaster.com/j?s=https%3A%2F%2Fabc.trycloudflare.com&c=WXYZ2345",
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
    "https://opendungeonmaster.com/j?s=https%3A%2F%2Fodm.example.com&c=WXYZ2345",
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
  assert.equal(url.origin, "https://opendungeonmaster.com");
  assert.equal(url.pathname, "/j");
  assert.equal(parseServer(url.searchParams.get("s")), "https://abc.trycloudflare.com");
  assert.equal(parseCode(url.searchParams.get("c")), "WXYZ2345");
});

console.log(`test-share-link: ${passed} tests passed.`);
