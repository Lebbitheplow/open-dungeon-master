// Portal mode's pure half: which cookies make a portal, which paths are
// forwarded, and which headers reach the host.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  PORTAL_ORIGIN_COOKIE,
  PORTAL_SIG_COOKIE,
  PORTAL_TOKEN_COOKIE,
  forwardHeaders,
  isPortalPath,
  portalFromCookies,
  portalOrigin,
  portalSignature,
  portalTargetUrl,
} = await import("../src/lib/portal.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-";
const SECRET = "s".repeat(16) + "0123456789abcdef0123456789";
const HOST = "https://host.example";
const SIG = portalSignature(SECRET, HOST, TOKEN);

test("portalOrigin accepts a bare http or https origin and nothing more", () => {
  assert.equal(portalOrigin("https://play-abcd.opengamemaster.com"), "https://play-abcd.opengamemaster.com");
  assert.equal(portalOrigin("http://192.168.1.50:3005/"), "http://192.168.1.50:3005");
  assert.equal(portalOrigin("https://Example.com"), "https://example.com");
  assert.equal(portalOrigin("https://example.com/path"), null);
  assert.equal(portalOrigin("https://example.com/?x=1"), null);
  assert.equal(portalOrigin("https://user:pw@example.com"), null);
  assert.equal(portalOrigin("ftp://example.com"), null);
  assert.equal(portalOrigin("javascript:alert(1)"), null);
  assert.equal(portalOrigin(""), null);
  assert.equal(portalOrigin(undefined), null);
});

test("portalFromCookies needs both cookies and a token-shaped token", () => {
  const jar = { [PORTAL_ORIGIN_COOKIE]: HOST, [PORTAL_TOKEN_COOKIE]: TOKEN, [PORTAL_SIG_COOKIE]: SIG };
  assert.deepEqual(portalFromCookies((name) => jar[name], SECRET), { origin: HOST, token: TOKEN });
  assert.equal(portalFromCookies((name) => ({ ...jar, [PORTAL_TOKEN_COOKIE]: "" })[name], SECRET), null);
  assert.equal(portalFromCookies((name) => ({ ...jar, [PORTAL_TOKEN_COOKIE]: "short" })[name], SECRET), null);
  assert.equal(portalFromCookies((name) => ({ ...jar, [PORTAL_TOKEN_COOKIE]: "bad token!" })[name], SECRET), null);
  assert.equal(portalFromCookies((name) => ({ [PORTAL_TOKEN_COOKIE]: TOKEN })[name], SECRET), null);
  assert.equal(portalFromCookies(() => undefined, SECRET), null);
});

test("a server the app did not start has no portal, whatever the cookies say", () => {
  const jar = { [PORTAL_ORIGIN_COOKIE]: HOST, [PORTAL_TOKEN_COOKIE]: TOKEN, [PORTAL_SIG_COOKIE]: SIG };
  assert.equal(portalFromCookies((name) => jar[name], undefined), null);
  assert.equal(portalFromCookies((name) => jar[name], ""), null);
  assert.equal(portalFromCookies((name) => jar[name], "too-short-a-secret"), null);
});

test("forged cookies are refused: no signature, a wrong one, or one made for another host", () => {
  const base = { [PORTAL_ORIGIN_COOKIE]: HOST, [PORTAL_TOKEN_COOKIE]: TOKEN };
  assert.equal(portalFromCookies((name) => base[name], SECRET), null);
  assert.equal(portalFromCookies((name) => ({ ...base, [PORTAL_SIG_COOKIE]: "x".repeat(43) })[name], SECRET), null);
  const otherSecret = portalSignature("o".repeat(40), HOST, TOKEN);
  assert.equal(portalFromCookies((name) => ({ ...base, [PORTAL_SIG_COOKIE]: otherSecret })[name], SECRET), null);
  // A signature lifted from one host does not carry the request to another,
  // a private address included.
  for (const elsewhere of ["http://127.0.0.1:8080", "http://[::1]:3005", "http://169.254.169.254", "https://host.example:8443"]) {
    const jar = { ...base, [PORTAL_ORIGIN_COOKIE]: elsewhere, [PORTAL_SIG_COOKIE]: SIG };
    assert.equal(portalFromCookies((name) => jar[name], SECRET), null, elsewhere);
  }
  // Nor to the same host with another token.
  const swapped = { ...base, [PORTAL_TOKEN_COOKIE]: TOKEN.replace("a", "b"), [PORTAL_SIG_COOKIE]: SIG };
  assert.equal(portalFromCookies((name) => swapped[name], SECRET), null);
});

test("the signature is made over the normalized origin", () => {
  const jar = { [PORTAL_ORIGIN_COOKIE]: "https://Host.Example/", [PORTAL_TOKEN_COOKIE]: TOKEN, [PORTAL_SIG_COOKIE]: SIG };
  assert.deepEqual(portalFromCookies((name) => jar[name], SECRET), { origin: HOST, token: TOKEN });
});

test("data paths are forwarded, the UI's own are not", () => {
  for (const path of ["/api/campaigns", "/api/auth/me", "/uploads/x.png", "/generated/a/b.png", "/generated-audio/n.mp3", "/ambience/forest.ogg"]) {
    assert.ok(isPortalPath(path), path);
  }
  for (const path of ["/", "/campaigns/abc", "/_next/static/chunk.js", "/dice-box/textures/x.webp", "/sidebar-icons/story.png", "/apis", "/uploadsx"]) {
    assert.ok(!isPortalPath(path), path);
  }
});

test("the target keeps the path and query on the host", () => {
  assert.equal(
    portalTargetUrl("https://host.example", "/api/campaigns/1/events", "?lastSeq=42"),
    "https://host.example/api/campaigns/1/events?lastSeq=42",
  );
});

test("forwardHeaders drops cookies and hop-by-hop headers and adds the bearer", () => {
  const out = forwardHeaders(
    [
      ["Cookie", "odm_session=x; odm_portal_token=y"],
      ["Host", "127.0.0.1:3210"],
      ["Authorization", "Bearer stale"],
      ["Content-Type", "application/json"],
      ["Accept", "text/event-stream"],
      ["X-Forwarded-For", "10.0.0.1"],
      ["x-middleware-subrequest", "proxy"],
      ["Content-Length", "12"],
    ],
    TOKEN,
  );
  const map = new Map(out);
  assert.equal(map.get("cookie"), undefined);
  assert.equal(map.get("host"), undefined);
  assert.equal(map.get("x-forwarded-for"), undefined);
  assert.equal(map.get("x-middleware-subrequest"), undefined);
  assert.equal(map.get("authorization"), `Bearer ${TOKEN}`);
  assert.equal(map.get("content-type"), "application/json");
  assert.equal(map.get("accept"), "text/event-stream");
  assert.equal(map.get("content-length"), "12");
  assert.equal(map.get("x-odm-portal"), "1");
});

console.log(`test-portal: ${passed} passed`);
