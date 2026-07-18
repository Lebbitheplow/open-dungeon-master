// New-adventurer banner derivation: latest join note without a DM reply.
import assert from "node:assert/strict";
import { JOIN_NOTE_PREFIX, latestUnintroducedJoin } from "../src/lib/campaign-types.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const msg = (seq, authorType, content) => ({ id: `m${seq}`, seq, authorType, content });
const join = (seq, name) => msg(seq, "system", `${JOIN_NOTE_PREFIX}${name} has joined.`);

test("no join notes means no banner", () => {
  assert.equal(latestUnintroducedJoin([msg(1, "dm", "hi"), msg(2, "player", "yo")]), null);
});

test("join note with no DM message after it shows", () => {
  const notice = latestUnintroducedJoin([msg(1, "dm", "scene"), join(2, "Zed"), msg(3, "player", "hello")]);
  assert.equal(notice?.seq, 2);
});

test("a DM message after the join clears it", () => {
  assert.equal(latestUnintroducedJoin([join(2, "Zed"), msg(3, "dm", "Zed walks in.")]), null);
});

test("a DM message before the join does not clear it", () => {
  assert.equal(latestUnintroducedJoin([msg(1, "dm", "scene"), join(2, "Zed")])?.seq, 2);
});

test("latest of several joins wins", () => {
  const notice = latestUnintroducedJoin([join(2, "Zed"), msg(3, "dm", "Zed enters."), join(4, "Pip")]);
  assert.equal(notice?.seq, 4);
});

test("system and player chatter after the join keeps it open", () => {
  const notice = latestUnintroducedJoin([
    join(2, "Zed"),
    msg(3, "system", "something else"),
    msg(4, "player", "welcome!"),
  ]);
  assert.equal(notice?.seq, 2);
});

console.log(`test-join-banner: ${passed} tests passed.`);
