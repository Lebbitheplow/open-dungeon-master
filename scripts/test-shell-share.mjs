// What the lobby reads out of the app's share status: a room code the table
// registry refused (another device claimed it first) is flagged only while
// the world is actually shared, and apps that do not report it flag nothing.
import assert from "node:assert/strict";
import { roomCodeRefused } from "../src/lib/shell-host.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const running = { supported: true, state: "running", url: "https://x.example", mode: "named", error: "", lanUrl: "" };

test("a refused code is flagged while the world is shared", () => {
  assert.equal(roomCodeRefused({ ...running, refusedCodes: ["ABCD2345"] }, "abcd2345 "), true);
  assert.equal(roomCodeRefused({ ...running, refusedCodes: ["ABCD2345"] }, "EFGH6789"), false);
});

test("an app that reports nothing, or a plain browser, flags nothing", () => {
  assert.equal(roomCodeRefused(running, "ABCD2345"), false);
  assert.equal(roomCodeRefused(null, "ABCD2345"), false);
  assert.equal(roomCodeRefused({ ...running, refusedCodes: "ABCD2345" }, "ABCD2345"), false);
});

test("a stopped share or a remote server's pages flag nothing", () => {
  assert.equal(roomCodeRefused({ ...running, state: "stopped", refusedCodes: ["ABCD2345"] }, "ABCD2345"), false);
  assert.equal(roomCodeRefused({ ...running, supported: false, refusedCodes: ["ABCD2345"] }, "ABCD2345"), false);
});

console.log(`shell share: ${passed} tests passed`);
