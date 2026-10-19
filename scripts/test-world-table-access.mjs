// The campaign's world at the table (audit WF-10): the World tab mounts
// WorldForge on the campaign's own records, through the same
// /api/campaigns/[campaignId]/world routes the workshop uses. Those routes
// are the whole privacy of the world, hidden truths, secrets and keepers
// included, so this pins who they answer: the DM seats at a table a person
// runs, the party lead of an AI campaign, and nobody else. Every route
// under world/ is found on disk and asked by every other seat, so a route
// added later is held to the same rule without this file changing.
//
// One route is the players' on purpose: the party's Atlas (GET
// world/atlas/party, src/lib/worldforge/party-atlas.ts) answers every
// member with the maps the DM has shown. It is named here, so no other
// route can join it by accident, and it is still asked: it must answer a
// member and never say a secret.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { call, seats, signOut } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-table-access");

const human = await openWorld({ gameSettings: { dmMode: "human" } });
const seat = await seats(human);
const ai = await openWorld();
ai.addHero({ name: "Lead's hero" });
const aiPlayer = ai.addUser("player");
ai.addHero({ name: "Player's hero", user: aiPlayer });

const worldRoute = await human.route("campaigns/[campaignId]/world");
const entitiesRoute = await human.route("campaigns/[campaignId]/world/entities");
const { worldView } = await import("../src/lib/db/world-forge.ts");

// Every route module under world/, by its name as world.route() takes it.
// From this file's place, since the test world works in a scratch folder.
const apiDir = fileURLToPath(new URL("../src/app/api/", import.meta.url));
const worldDir = path.join(apiDir, "campaigns", "[campaignId]", "world");
function routeNames(dir) {
  const names = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) names.push(...routeNames(full));
    else if (entry.name === "route.ts") names.push(path.relative(apiDir, dir).split(path.sep).join("/"));
  }
  return names;
}
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
// A body for the methods that take one; a GET goes without.
const bodyFor = (method, body) => (method === "GET" ? undefined : body);
const routes = [];
const PARTY_READS = new Set(["campaigns/[campaignId]/world/atlas/party GET"]);
const forParty = (route) => PARTY_READS.has(`${route.name} ${route.method}`);
for (const name of routeNames(worldDir)) {
  const mod = await human.route(name);
  for (const method of METHODS) {
    if (typeof mod[method] === "function") routes.push({ name, method, mod });
  }
}

// An entry and a secret to be kept from the players.
human.signIn(seat.dm);
const made = await call(entitiesRoute, "POST", { typeId: "t_character", name: "The Warden" }, { campaignId: human.campaignId });
assert.equal(made.status, 200, JSON.stringify(made.json));
const wardenRef = made.json.entity.ref;
const secret = { id: "sec_codes", title: "The warden sold the codes", subject: wardenRef, notes: "To the smugglers.", knownBy: [wardenRef], partyKnows: false };
const patched = await call(worldRoute, "PATCH", { secrets: [secret] }, { campaignId: human.campaignId });
assert.equal(patched.status, 200, JSON.stringify(patched.json));

const params = (campaignId) => ({ campaignId, ref: wardenRef });

await test("every world route is found, so the sweep below covers them all", async () => {
  // world, entities, one entry, its play fields and fight, AI, bindings,
  // import and export at the time of writing.
  assert.ok(routes.length >= 9, `found ${routes.length}: ${routes.map((route) => `${route.method} ${route.name}`).join(", ")}`);
  assert.ok(routes.some((route) => route.name.endsWith("/world") && route.method === "GET"));
  assert.ok(routes.some((route) => route.name.endsWith("/world/export") && route.method === "GET"));
});

await test("a player at a human-run table is refused by every world route, and nothing changes", async () => {
  const before = JSON.stringify(worldView(human.campaignId));
  for (const user of [seat.player, seat.lead, seat.bare]) {
    for (const route of routes) {
      human.signIn(user);
      const answer = await call(route.mod, route.method, bodyFor(route.method, { secrets: [], name: "Leak", typeId: "t_other" }), params(human.campaignId));
      assert.equal(answer.status, forParty(route) ? 200 : 403, `${user.username} ${route.method} ${route.name}: ${answer.status}`);
      assert.doesNotMatch(JSON.stringify(answer.json), /sold the codes|smugglers/, `${route.method} ${route.name} said the secret`);
    }
  }
  assert.equal(JSON.stringify(worldView(human.campaignId)), before, "a refused call wrote nothing");
});

await test("a stranger is told there is no such campaign, and a signed-out caller is asked to sign in", async () => {
  for (const route of routes) {
    human.signIn(seat.stranger);
    const stranger = await call(route.mod, route.method, bodyFor(route.method, {}), params(human.campaignId));
    assert.equal(stranger.status, 404, `stranger ${route.method} ${route.name}`);
    signOut();
    const nobody = await call(route.mod, route.method, bodyFor(route.method, {}), params(human.campaignId));
    assert.equal(nobody.status, 401, `nobody ${route.method} ${route.name}`);
  }
});

await test("the DM and the co-DM read the whole world, secrets and keepers included", async () => {
  for (const user of [seat.dm, seat.assistant]) {
    human.signIn(user);
    const answer = await call(worldRoute, "GET", undefined, { campaignId: human.campaignId });
    assert.equal(answer.status, 200, `${user.username}: ${JSON.stringify(answer.json)}`);
    assert.ok(answer.json.entities.some((entity) => entity.ref === wardenRef));
    assert.deepEqual(answer.json.doc.secrets.map((entry) => entry.title), ["The warden sold the codes"]);
  }
});

await test("the lead of an AI campaign reads and writes its world; a player there is refused", async () => {
  ai.signIn(ai.owner);
  const read = await call(worldRoute, "GET", undefined, { campaignId: ai.campaignId });
  assert.equal(read.status, 200, JSON.stringify(read.json));
  const wrote = await call(entitiesRoute, "POST", { typeId: "t_location", name: "Gullhaven" }, { campaignId: ai.campaignId });
  assert.equal(wrote.status, 200, JSON.stringify(wrote.json));
  ai.signIn(aiPlayer);
  for (const route of routes) {
    const answer = await call(route.mod, route.method, bodyFor(route.method, {}), { campaignId: ai.campaignId, ref: wrote.json.entity.ref });
    assert.equal(answer.status, forParty(route) ? 200 : 403, `AI-table player ${route.method} ${route.name}: ${answer.status}`);
  }
});

finish();
