// Cross-origin access for the apps' native screens: which origins count,
// what the extra list accepts, and the headers a response carries.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { allowedAppOrigin, appCorsHeaders, extraAppOrigins, isPreflight } = await import(
  "../src/lib/app-cors.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("the apps' own origins are allowed, browsers on other sites are not", () => {
  assert.equal(allowedAppOrigin("null"), "null");
  assert.equal(allowedAppOrigin("https://localhost"), "https://localhost");
  assert.equal(allowedAppOrigin("capacitor://localhost"), "capacitor://localhost");
  assert.equal(allowedAppOrigin("https://evil.example"), null);
  assert.equal(allowedAppOrigin(""), null);
  assert.equal(allowedAppOrigin(null), null);
  assert.equal(allowedAppOrigin(undefined), null);
});

test("ODM_APP_ORIGINS adds bare origins and ignores junk", () => {
  const extra = extraAppOrigins(" https://app.example/, http://192.168.1.5:3000/path , nope, ");
  assert.deepEqual(extra, ["https://app.example", "http://192.168.1.5:3000"]);
  assert.equal(allowedAppOrigin("https://app.example", extra), "https://app.example");
  assert.equal(allowedAppOrigin("https://other.example", extra), null);
  assert.deepEqual(extraAppOrigins(undefined), []);
});

test("responses name the origin, allow the bearer header, and never credentials", () => {
  const headers = new Map(appCorsHeaders("null"));
  assert.equal(headers.get("access-control-allow-origin"), "null");
  assert.match(headers.get("access-control-allow-headers"), /authorization/);
  assert.match(headers.get("access-control-allow-headers"), /last-event-id/);
  assert.match(headers.get("access-control-allow-methods"), /PATCH/);
  assert.equal(headers.get("vary"), "Origin");
  assert.equal(headers.has("access-control-allow-credentials"), false);
});

test("a preflight is OPTIONS with a requested method", () => {
  assert.equal(isPreflight("OPTIONS", "POST"), true);
  assert.equal(isPreflight("options", "GET"), true);
  assert.equal(isPreflight("OPTIONS", null), false);
  assert.equal(isPreflight("GET", "GET"), false);
});

console.log(`test-app-cors: ${passed} passed`);
