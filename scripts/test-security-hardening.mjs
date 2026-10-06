// The repairs for the repository scan in issue 80, each read from stored
// state or from what a route answers:
//
//   a rule chunk belongs to its campaign before anything is written to it;
//   a co-DM cannot hand the game to the AI through the settings route;
//   the record of the DM's hands on the board goes to the DM seats alone;
//   a member muted at the table adds nothing to the transcript;
//   a connection pinned to one campaign reaches only the characters in it;
//   uploads are answered by the route that checks the login, privately
//   cached, and never through a link that leaves the folder;
//   an invite page's cover is served by room code;
//   a picture address handed back by an image endpoint is held to a size
//   and to being a picture;
//   a model cannot run an action the table's settings took off its list.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { LEGAL_FIGHTER, LEGAL_WIZARD, openCreation } from "./lib/enforce-creation.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-security-hardening");

const campaigns = await import("../src/lib/db/campaigns.ts");
const rules = await import("../src/lib/db/rules.ts");
const moderation = await import("../src/lib/db/moderation.ts");
const events = await import("../src/lib/events.ts");

async function ask(mod, method, body, params = {}, url = "http://test/") {
  const request = new Request(url, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  return response;
}

// 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// ---- rule chunks ----

await test("a rule chunk from another table is not found, and not changed", async () => {
  const mine = await openWorld();
  const theirs = await openWorld();
  const [chunk] = rules.setHouseRules(theirs.campaignId, "Flanking gives advantage.");
  assert.ok(chunk?.enabled, "the other table's rule starts enabled");

  const route = await mine.route("campaigns/[campaignId]/rules");
  mine.signIn(mine.owner);
  const response = await ask(route, "PATCH", { chunkId: chunk.id, enabled: false }, { campaignId: mine.campaignId });
  assert.equal(response.status, 404);
  assert.equal(rules.listRuleChunks(theirs.campaignId)[0].enabled, true, "the other table's rule was switched off");

  theirs.signIn(theirs.owner);
  const own = await ask(route, "PATCH", { chunkId: chunk.id, enabled: false }, { campaignId: theirs.campaignId });
  assert.equal(own.status, 200);
  assert.equal(rules.listRuleChunks(theirs.campaignId)[0].enabled, false);
});

// ---- the DM seats ----

const table = await openWorld({ status: "lobby" });
const dm = table.owner;
const coDm = table.addUser("codm");
const player = table.addUser("player");
for (const user of [coDm, player]) {
  const joined = campaigns.joinByInviteCode(user.id, table.campaign().inviteCode);
  assert.ok(!("error" in joined), "could not seat a member");
}
campaigns.setDmMode(table.campaignId, "human", dm.id);
assert.ok(campaigns.setAssistantDm(table.campaignId, coDm.id));
const settingsRoute = await table.route("campaigns/[campaignId]/settings");

await test("a co-DM changes table settings but cannot hand the game to the AI", async () => {
  table.signIn(coDm);
  const handed = await ask(settingsRoute, "PATCH", { dmMode: "ai" }, { campaignId: table.campaignId });
  assert.equal(handed.status, 403);
  assert.equal(table.campaign().gameSettings.dmMode, "human");
  assert.equal(table.campaign().dmUserId, dm.id, "the DM lost the seat");
  assert.equal(table.campaign().assistantDmUserId, coDm.id);

  const other = await ask(settingsRoute, "PATCH", { ambienceEnabled: false }, { campaignId: table.campaignId });
  assert.equal(other.status, 200);
  assert.equal(table.campaign().gameSettings.ambienceEnabled, false);
});

// ---- the board record ----

await test("the DM's board handling is replayed to the DM seats and to nobody else", () => {
  const before = events.listEventsSince(table.campaignId, 0).length;
  events.publishPersisted(table.campaignId, "dm_board_action", { note: "The DM hid the assassin from the party." });
  const seen = (userId) => {
    const types = [];
    events.forEachEventSince(table.campaignId, 0, (event) => types.push(event.type), undefined, userId);
    return types.filter((type) => type === "dm_board_action").length;
  };
  assert.equal(seen(dm.id), 1);
  assert.equal(seen(coDm.id), 1);
  assert.equal(seen(player.id), 0, "a player was replayed the DM's board note");
  assert.equal(events.listEventsSince(table.campaignId, 0).length, before, "the table's view of the log holds it");

  const heard = { dm: 0, player: 0 };
  const offDm = events.subscribe(table.campaignId, (chunk) => (heard.dm += chunk.includes("dm_board_action") ? 1 : 0), dm.id);
  const offPlayer = events.subscribe(table.campaignId, (chunk) => (heard.player += chunk.includes("dm_board_action") ? 1 : 0), player.id);
  events.publishPersisted(table.campaignId, "dm_board_action", { note: "The DM moved the assassin to 4, 7." });
  offDm();
  offPlayer();
  assert.deepEqual(heard, { dm: 1, player: 0 });
});

await test("the DM proper may still hand the game to the AI", async () => {
  table.signIn(dm);
  const handed = await ask(settingsRoute, "PATCH", { dmMode: "ai" }, { campaignId: table.campaignId });
  assert.equal(handed.status, 200);
  assert.equal(table.campaign().gameSettings.dmMode, "ai");
});

// ---- mute ----

await test("a muted member's audio is not transcribed into the table's record", async () => {
  const route = await table.route("campaigns/[campaignId]/voice/transcript");
  assert.ok(moderation.setMemberMuted(table.campaignId, player.id, true));
  table.signIn(player);
  const muted = await ask(route, "POST", {}, { campaignId: table.campaignId });
  assert.equal(muted.status, 403);
  assert.match((await muted.json()).error, /muted/);
  moderation.setMemberMuted(table.campaignId, player.id, false);
  const open = await ask(route, "POST", {}, { campaignId: table.campaignId });
  assert.notEqual(open.status, 403, "an unmuted member is refused as muted");
});

// ---- a connection pinned to one campaign ----

await test("a pinned connection reaches the library only through its table's characters", async () => {
  const creation = await openCreation();
  const seated = await creation.throughLibrary(LEGAL_FIGHTER);
  assert.equal(seated.status, 201, seated.error ?? "");
  creation.world.signIn(creation.player);
  const spare = await creation.call(creation.libraryRoute, "POST", { level: 1, sheet: LEGAL_WIZARD });
  assert.equal(spare.status, 201, JSON.stringify(spare.json));
  const seatedId = seated.character.id;
  const spareId = spare.json.character.id;

  const { createConnectionGrant } = await import("../src/lib/agents/grants.ts");
  const { workbenchCall } = await import("../src/lib/agents/workbench.ts");
  const made = createConnectionGrant({
    userId: creation.player.id,
    name: "pinned",
    scopes: ["read", "characters"],
    campaignId: creation.campaignId,
  });
  assert.ok("grant" in made, JSON.stringify(made));

  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (url, init) => {
    fetched.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return Response.json({ characters: [{ id: seatedId }, { id: spareId }] });
  };
  try {
    for (const [name, args] of [
      ["odm_get_character", { characterId: spareId }],
      ["odm_update_character", { characterId: spareId, level: 1, sheet: {} }],
      ["odm_delete_character", { characterId: spareId, confirm: true }],
      ["odm_create_character", { level: 1, sheet: {} }],
    ]) {
      const refused = await workbenchCall(made.grant, name, args);
      assert.equal(refused.isError, true, `${name} reached a character outside the pinned campaign`);
      assert.match(refused.text, /limited to one campaign/);
    }
    assert.deepEqual(fetched, [], "a refused call still reached the server");

    const read = await workbenchCall(made.grant, "odm_get_character", { characterId: seatedId });
    assert.equal(read.isError, false, read.text);
    const listed = await workbenchCall(made.grant, "odm_list_characters", {});
    assert.deepEqual(JSON.parse(listed.text).characters, [{ id: seatedId }]);
    assert.deepEqual(fetched, [`GET /api/characters/${seatedId}`, "GET /api/characters"]);

    // The same player's unpinned connection keeps the whole library.
    const open = createConnectionGrant({ userId: creation.player.id, name: "open", scopes: ["read"], campaignId: null });
    const whole = await workbenchCall(open.grant, "odm_list_characters", {});
    assert.equal(JSON.parse(whole.text).characters.length, 2);
    assert.equal((await workbenchCall(open.grant, "odm_get_character", { characterId: spareId })).isError, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---- uploads behind the login ----

const media = await table.route("media/[...path]");
const uploads = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(uploads, { recursive: true });
fs.writeFileSync(path.join(uploads, "cover.png"), PNG);

await test("a file under public/ is answered only to somebody signed in, and cached privately", async () => {
  globalThis.__odmTestToken = "";
  const anonymous = await ask(media, "GET", undefined, { path: ["uploads", "cover.png"] });
  assert.equal(anonymous.status, 401);

  table.signIn(player);
  const signedIn = await ask(media, "GET", undefined, { path: ["uploads", "cover.png"] });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.headers.get("content-type"), "image/png");
  assert.match(signedIn.headers.get("cache-control"), /^private,/);
  assert.equal(Buffer.from(await signedIn.arrayBuffer()).equals(PNG), true);

  for (const segments of [["secrets", "cover.png"], ["uploads"], ["uploads", "..", "..", "cover.png"]]) {
    const refused = await ask(media, "GET", undefined, { path: segments });
    assert.equal(refused.status, 404, segments.join("/"));
  }
});

await test("the three login folders are sent to that route by path, never by an absolute address", async () => {
  const { loginMediaRewrites } = await import("../next.config.ts");
  assert.deepEqual(loginMediaRewrites, [
    { source: "/uploads/:path*", destination: "/api/media/uploads/:path*" },
    { source: "/generated/:path*", destination: "/api/media/generated/:path*" },
    { source: "/generated-audio/:path*", destination: "/api/media/generated-audio/:path*" },
  ]);
  const config = (await import("../next.config.ts")).default;
  assert.deepEqual((await config.rewrites()).beforeFiles, loginMediaRewrites);

  // A rewrite made in the proxy is absolute. Next proxies it over the network
  // unless its origin matches the one it is bound to, which a server bound to
  // 127.0.0.1 never does, and behind an https tunnel that request fails.
  const { proxy } = await import("../src/proxy.ts");
  const { NextRequest } = await import("next/server");
  const rewriteOf = (pathname, headers = {}) =>
    proxy(new NextRequest(`http://test${pathname}`, { headers })).headers.get("x-middleware-rewrite");
  for (const pathname of ["/uploads/a.png?w=256", "/generated/b.webp", "/generated-audio/c.mp3", "/assets/d.png", "/api/campaigns"]) {
    assert.equal(rewriteOf(pathname), null, pathname);
    assert.equal(rewriteOf(pathname, { "x-forwarded-proto": "https" }), null, pathname);
  }
});

if (process.platform !== "win32") {
  await test("a link inside the folder that points outside it is not followed", async () => {
    const outside = path.join(process.cwd(), "outside.png");
    fs.writeFileSync(outside, PNG);
    fs.symlinkSync(outside, path.join(uploads, "link.png"));
    table.signIn(player);
    const followed = await ask(media, "GET", undefined, { path: ["uploads", "link.png"] });
    assert.equal(followed.status, 404);
  });
}

await test("an invite page's cover is served by room code, to a guest with no session", async () => {
  campaigns.setCampaignCover(table.campaignId, { id: "cover", url: "/uploads/cover.png" });
  const code = table.campaign().inviteCode;
  globalThis.__odmTestToken = "";
  globalThis.__odmLoginThrottle = new Map();

  const previewRoute = await table.route("campaigns/join/preview");
  const preview = await ask(previewRoute, "GET", undefined, {}, `http://test/api/campaigns/join/preview?code=${code}`);
  assert.equal(preview.status, 200);
  assert.deepEqual((await preview.json()).preview.cover, { url: `/api/campaigns/join/cover/${code}` });

  const coverRoute = await table.route("campaigns/join/cover/[code]");
  const cover = await ask(coverRoute, "GET", undefined, { code });
  assert.equal(cover.status, 200);
  assert.equal(Buffer.from(await cover.arrayBuffer()).equals(PNG), true);
  const wrong = await ask(coverRoute, "GET", undefined, { code: "ZZZZ9999" });
  assert.equal(wrong.status, 404);
});

// ---- a picture address from an image endpoint ----

await test("a picture address an image endpoint hands back is held to a size and to being a picture", async () => {
  process.env.OPENAI_IMAGE_API_KEY = "sk-test";
  process.env.OPENAI_IMAGE_BASE_URL = "http://images.test/v1";
  process.env.OPENAI_IMAGE_MODEL = "dall-e-3";
  const { generateOpenAiImage } = await import("../src/lib/openai-images.ts");
  const realFetch = globalThis.fetch;
  let download;
  globalThis.fetch = async (url, init) => {
    if (init?.method === "POST") {
      return Response.json({ data: [{ url: "http://files.test/picture" }] });
    }
    return download();
  };
  const generated = path.join(process.cwd(), "public", "generated");
  const saved = () => (fs.existsSync(generated) ? fs.readdirSync(generated).length : 0);
  const draw = () => generateOpenAiImage({ prompt: "a quiet harbor", mode: "fast", aspect: "square" });
  try {
    download = () => new Response("<html>not a picture</html>", { headers: { "content-type": "text/html" } });
    await assert.rejects(draw, /not a PNG, JPEG or WebP picture/);
    download = () => new Response(PNG, { headers: { "content-length": String(64 * 1024 * 1024) } });
    await assert.rejects(draw, /too large to be a picture/);
    download = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024));
          },
        }),
      );
    await assert.rejects(draw, /too large to be a picture/);
    assert.equal(saved(), 0, "a refused download was saved");

    download = () => new Response(PNG);
    const image = await draw();
    assert.match(image.url, /^\/generated\/.+\.png$/);
    assert.equal(saved(), 1);
  } finally {
    globalThis.fetch = realFetch;
    for (const name of ["OPENAI_IMAGE_API_KEY", "OPENAI_IMAGE_BASE_URL", "OPENAI_IMAGE_MODEL"]) {
      delete process.env[name];
    }
  }
});

// ---- the model's actions ----

await test("a model cannot run an action the table's settings took off its list", async () => {
  const world = await openWorld({ gameSettings: { worldSimulation: false } });
  const hero = world.addHero({ name: "Kara" });
  const model = await fakeModel();
  try {
    model.pointAt(world);
    const off = call("generate_settlement", { name: "Brindle", size: "village" });
    const on = call("record_event", { summary: "Kara reached the crossroads.", importance: "minor" });
    model.script([reply({ calls: [off, on] }), reply({ text: "The road forks under a grey sky." })]);
    await model.turn(world, "I look around.", hero.id);
    const results = new Map(model.results(model.requests[1]).map((entry) => [entry.id, entry.result]));
    assert.match(results.get(off.id)?.error ?? "", /no action called "generate_settlement"/, JSON.stringify(results.get(off.id)));
    // The action still on the list reached its own handler.
    assert.doesNotMatch(results.get(on.id)?.error ?? "", /no action called/, JSON.stringify(results.get(on.id)));
  } finally {
    model.close();
  }
});

finish();
