// The Plugin tool's export reads the stored draft, not the one on screen
// (WA-04), so the editor saves first and names the revision that save left
// (the draft's updatedAt). A stored draft changed since, by a second tab, is
// refused with 409 rather than downloaded or installed under the first
// tab's press. An export that names no revision (an older client, a script)
// is read as before.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-plugin-export-revision");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const world = await openWorld();
const { owner } = world;
getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(owner.id);
const id = createWorkshop(owner.id, { title: "Saltmarch" }).id;

const draftRoute = await world.route("workshops/[workshopId]/plugin");
const exportRoute = await world.route("workshops/[workshopId]/plugin/export");
async function call(route, method, body) {
  world.signIn({ id: owner.id });
  const response = await route[method](
    new Request("http://local/", { method, headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }),
    { params: Promise.resolve({ workshopId: id }) },
  );
  return { status: response.status, body: await response.json() };
}
// Two saves in the same millisecond would share a revision; a person's two
// tabs never do, and the test waits the same way.
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function save(name) {
  await tick();
  const stored = (await call(draftRoute, "GET")).body.draft;
  const saved = await call(draftRoute, "PUT", { draft: { ...stored, name } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return saved.body.updatedAt;
}

await test("A draft never stored is revision null, and an export naming null passes the revision gate.", async () => {
  const fresh = await call(draftRoute, "GET");
  assert.equal(fresh.body.updatedAt, null);
  const answer = await call(exportRoute, "POST", { revision: null });
  assert.notEqual(answer.status, 409, JSON.stringify(answer.body));
});

await test("A save answers the revision it left, and an export naming it is built from that copy.", async () => {
  const revision = await save("The Sunken Coast");
  assert.equal(typeof revision, "string");
  const answer = await call(exportRoute, "POST", { revision });
  assert.notEqual(answer.status, 409, JSON.stringify(answer.body));
  // The checks ran on the stored draft: a named but unfinished pack.
  assert.equal(answer.status, 400);
  assert.equal(answer.body.error, "The pack is not finished.");
});

await test("A draft saved again elsewhere refuses the older revision with 409, for Download and Install alike.", async () => {
  const first = await save("The Sunken Coast, tab one");
  const second = await save("The Sunken Coast, tab two");
  assert.notEqual(first, second);
  for (const install of [false, true]) {
    const answer = await call(exportRoute, "POST", { install, revision: first });
    assert.equal(answer.status, 409, JSON.stringify(answer.body));
    assert.match(answer.body.error, /changed somewhere else after this page saved it/);
  }
  const current = await call(exportRoute, "POST", { revision: second });
  assert.notEqual(current.status, 409);
  // A stored draft is never revision null again.
  assert.equal((await call(exportRoute, "POST", { revision: null })).status, 409);
});

await test("An export that names no revision reads the stored draft as before.", async () => {
  const answer = await call(exportRoute, "POST", {});
  assert.notEqual(answer.status, 409, JSON.stringify(answer.body));
});

await test("Start blank takes the draft back to revision null.", async () => {
  await save("Thrown away");
  const cleared = await call(draftRoute, "DELETE");
  assert.equal(cleared.body.updatedAt, null);
  assert.notEqual((await call(exportRoute, "POST", { revision: null })).status, 409);
});

world.close();
finish();
