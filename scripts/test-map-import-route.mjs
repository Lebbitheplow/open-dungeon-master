// The map library's import, through the real route handler: one button and
// one `do: "import-uvtt"` take both a Universal VTT export and a Watabou One
// Page Dungeon export (src/lib/dm/map-library.ts tells them apart by shape).
// The converters have their own suites (test-map-uvtt, test-watabou-import);
// this one is about the door in front of them, whose request schema used to
// know only the UVTT shape and refused every One Page Dungeon as "Invalid
// map." before its converter could run.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dungeonFile = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "watabou-dungeon.json"), "utf8"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-map-import-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.chdir(dir);

register("./lib/register-routes.mjs", import.meta.url);

const { createUser } = await import("../src/lib/db/users.ts");
const { mintSession } = await import("../src/lib/auth.ts");

// A URL, not a template literal: Vitest would read the literal as a one-level
// glob, which the nested route paths below never match.
const route = (name) => import(new URL(`../src/app/api/${name}/route.ts`, import.meta.url).href);
const campaignsRoute = await route("campaigns");
const mapsRoute = await route("campaigns/[campaignId]/dm/maps");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

async function call(mod, method, body, params = {}) {
  const request = new Request("http://test/", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() };
}

const dm = createUser("cartographer", "x");
globalThis.__odmTestToken = mintSession(dm.id).token;
// A table its creator runs as a human DM, the seat the map library is for.
const created = await call(campaignsRoute, "POST", { title: "The Sunken Vault", gameSettings: { dmMode: "human" } });
assert.equal(created.status, 201, JSON.stringify(created.json));
const campaignId = created.json.campaign.id;
const importMap = (file, name = "Imported") =>
  call(mapsRoute, "POST", { do: "import-uvtt", name, file }, { campaignId });

await test("a One Page Dungeon export imports through the map library's import", async () => {
  const response = await importMap(dungeonFile, "Sunken Vault");
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const { map } = response.json;
  // The same map the converter's own suite expects from this fixture.
  assert.equal(map.width, 17);
  assert.equal(map.height, 14);
  assert.ok(map.tags.includes("dungeon"), `tags: ${map.tags}`);
  assert.equal(map.terrain[3 * 17 + 7], "+", "the door between the first two rooms is missing");
  assert.match(map.notes, /5 rooms and passages, 2 doors/);
});

await test("a Universal VTT export still imports through the same door", async () => {
  const room = [[{ x: 2, y: 2 }, { x: 6, y: 2 }, { x: 6, y: 6 }, { x: 2, y: 6 }, { x: 2, y: 2 }]];
  const response = await importMap({ resolution: { map_size: { x: 10, y: 8 } }, line_of_sight: room });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.map.width, 10);
  assert.ok(!response.json.map.tags.includes("dungeon"));
});

await test("a One Page Dungeon past the request's bounds is refused before it is read", async () => {
  const rooms = Array.from({ length: 1001 }, (_, i) => ({ x: i % 40, y: Math.floor(i / 40), w: 1, h: 1 }));
  assert.equal((await importMap({ ...dungeonFile, rects: rooms })).status, 400);
  const essay = [{ text: "x".repeat(2001), pos: { x: 1, y: 1 } }];
  assert.equal((await importMap({ ...dungeonFile, notes: essay })).status, 400);
});

await test("a file that is neither export is still refused", async () => {
  assert.equal((await importMap({ title: "No rooms here" })).status, 400);
  assert.equal((await importMap({ ...dungeonFile, rects: [] })).status, 400);
});

removeTempDir(dir);
console.log(`map import route: ${passed} tests passed`);
