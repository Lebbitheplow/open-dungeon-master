// Drives the Worker's fetch handler directly under Node, which shares the
// WHATWG Request/Response the Workers runtime uses. Run: node test.mjs
import assert from "node:assert/strict";
import worker, { parseCode, parseServer } from "./src/index.js";

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
}

const get = (path) => worker.fetch(new Request(`https://opendungeonmaster.com${path}`));

await test("a full invite renders both doors and the real host", async () => {
  const response = get("/j?s=https%3A%2F%2Fabc.trycloudflare.com&c=B63DBZQD");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes("abc.trycloudflare.com"));
  assert.ok(html.includes("B63DBZQD"));
  assert.ok(html.includes("https://abc.trycloudflare.com/join/B63DBZQD"));
  assert.ok(html.includes("odm://join?s=https%3A%2F%2Fabc.trycloudflare.com&amp;c=B63DBZQD"));
});

await test("the short path form carries the code", async () => {
  const html = await get("/j/b63dbzqd?s=https%3A%2F%2Fexample.org").text();
  assert.ok(html.includes("/join/B63DBZQD"), "lowercase code was not accepted and uppercased");
});

await test("a missing server or code degrades to the incomplete page", async () => {
  for (const path of ["/j", "/j?c=B63DBZQD", "/j?s=https%3A%2F%2Fexample.org"]) {
    const html = await get(path).text();
    assert.ok(html.includes("incomplete"), `${path} did not degrade`);
    assert.ok(!html.includes("/join/"), `${path} rendered a join link from nothing`);
  }
});

await test("only http(s) servers survive; scheme and userinfo tricks do not", () => {
  assert.equal(parseServer("https://example.org:3005/some/path"), "https://example.org:3005");
  assert.equal(parseServer("http://192.168.1.50:3005"), "http://192.168.1.50:3005");
  assert.equal(parseServer("javascript:alert(1)"), null);
  assert.equal(parseServer("odm://join"), null);
  assert.equal(parseServer("https://good.example@evil.example/"), null);
  assert.equal(parseServer("not a url"), null);
  assert.equal(parseServer(`https://${"x".repeat(400)}.com`), null);
});

await test("codes are held to the invite alphabet", () => {
  assert.equal(parseCode(" b63dbzqd "), "B63DBZQD");
  assert.equal(parseCode("B63DBZQ1"), null, "1 is not in the alphabet");
  assert.equal(parseCode("B63DBZQO"), null, "O is not in the alphabet");
  assert.equal(parseCode("ABC"), null, "too short");
  assert.equal(parseCode('"><script>'), null);
});

await test("markup in inputs never lands unescaped", async () => {
  const html = await get("/j?s=https%3A%2F%2Fexample.org&c=B63DBZQD").text();
  assert.ok(!html.includes("<script"), "a script tag appeared");
});

await test("anything off /j goes to the downloads", () => {
  const response = worker.fetch(new Request("https://opendungeonmaster.com/other"));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://opendungeonmaster.com/");
});

console.log(`j-redirector: ${passed} checks passed`);
