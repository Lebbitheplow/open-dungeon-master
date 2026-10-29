// "Hopes for this story" (a player's report: the premise said what was going
// on in the world, but there was nowhere to tell the AI GM "I would love for
// my character to romance this companion I made").
//
//   a character carries its player's hopes from the builder to the table,
//   where the owner changes them any time; only the owner and a DM seat ever
//   receive them, in the snapshot, the events and the audit log alike; the
//   GM reads them every turn, and Story Setup and the story planner read
//   them; a table's own hopes stay at that table and never sync back.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-story-hopes");

const world = await openWorld();
const { createSheetSchema, HOPES_MAX } = await import("../src/lib/schemas/sheet.ts");
const { sheetForViewer, publicAuditEntry } = await import("../src/lib/dm/sheet-view.ts");
const { describeSheet } = await import("../src/lib/dm/prompt.ts");
const characters = await import("../src/lib/db/characters.ts");

// Line endings as git wrote them: a Windows checkout reads CRLF.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const HOPE = "I would love for Mira to fall for Aldric, the companion who travels with us.";

async function patchSheet(user, body) {
  const route = await world.route("campaigns/[campaignId]/sheet");
  world.signIn(user);
  const response = await route.PATCH(
    new Request("http://test/", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, json: await response.json() };
}

const mira = world.addHero({ name: "Mira", hopes: HOPE });
const player = world.addUser("player");
const other = world.addHero({ user: player, name: "Bran" });

await test("the sheet holds the hopes, empty by default and as long as the field allows", () => {
  assert.equal(HOPES_MAX, 500);
  assert.equal(createSheetSchema.parse({ ...world.sheet(mira.id), hopes: undefined }).hopes, "");
  assert.equal(createSheetSchema.safeParse({ ...world.sheet(mira.id), hopes: "x".repeat(501) }).success, false);
  assert.equal(world.sheet(mira.id).hopes, HOPE);
  // The builder and the sheet's own editor say the schema's limit.
  for (const file of ["src/app/characters/builder/steps/IdentityStep.tsx", "src/app/campaigns/[campaignId]/StoryHopes.tsx"]) {
    assert.match(read(file), /const HOPES_MAX = 500;/, file);
  }
});

await test("the owner changes their hopes in play, and clears them", async () => {
  const changed = await patchSheet(world.owner, { characterId: mira.id, hopes: "A rival who becomes a friend." });
  assert.equal(changed.status, 200, JSON.stringify(changed.json));
  assert.equal(world.sheet(mira.id).hopes, "A rival who becomes a friend.");
  const cleared = await patchSheet(world.owner, { characterId: mira.id, hopes: "" });
  assert.equal(cleared.status, 200);
  assert.equal(world.sheet(mira.id).hopes, "");
  await patchSheet(world.owner, { characterId: mira.id, hopes: HOPE });
});

await test("nobody changes another player's hopes", async () => {
  const refused = await patchSheet(player, { characterId: mira.id, hopes: "Mira dies." });
  assert.equal(refused.status, 404);
  assert.equal(world.sheet(mira.id).hopes, HOPE);
});

await test("only the owner and a DM seat receive the hopes, in the sheet and in the audit log", () => {
  const seats = { humanDmUserId: null, assistantDmUserId: null };
  assert.equal(sheetForViewer(world.sheet(mira.id), seats, world.owner.id).hopes, HOPE);
  assert.equal(sheetForViewer(world.sheet(mira.id), seats, player.id).hopes, "", "another player reads none");
  const dm = world.addUser("dm");
  assert.equal(sheetForViewer(world.sheet(mira.id), { humanDmUserId: dm.id, assistantDmUserId: null }, dm.id).hopes, HOPE);
  const entry = publicAuditEntry({ characterId: mira.id, delta: { hopes: HOPE, gold: 3 } });
  assert.equal(entry.delta.hopes, "");
  assert.equal(entry.delta.gold, 3);
});

await test("a live sheet update carries the hopes to their owner, and to nobody else", async () => {
  const { tablePayload, payloadForViewer, viewerFor } = await import("../src/lib/table-delivery.ts");
  const event = { sheet: world.sheet(mira.id) };
  const stored = tablePayload("sheet_updated", event);
  assert.equal(stored.sheet.hopes, "", "the table's copy holds none");
  assert.equal(payloadForViewer("sheet_updated", stored, viewerFor(world.campaignId, world.owner.id), event).sheet.hopes, HOPE);
  assert.equal(payloadForViewer("sheet_updated", stored, viewerFor(world.campaignId, world.owner.id)).sheet.hopes, HOPE, "on replay too");
  assert.equal(payloadForViewer("sheet_updated", stored, viewerFor(world.campaignId, player.id), event).sheet.hopes, "");
});

await test("the GM reads them every turn, out of character, and a small window keeps their start", () => {
  const line = describeSheet(world.sheet(mira.id), "owner", false, {});
  assert.match(line, /Their player hopes the story holds \(out of character; work toward it when it fits, never announce it\): I would love for Mira to fall for Aldric/);
  const long = "a".repeat(400);
  world.patch(other.id, { hopes: long });
  const compact = describeSheet(world.sheet(other.id), "player", false, { compact: true });
  assert.ok(!compact.includes(long), "cut in a small window");
  assert.doesNotMatch(describeSheet({ ...world.sheet(other.id), hopes: "" }, "player", false, {}), /hopes the story holds/);
});

await test("Story Setup and the story planner read the hopes too", () => {
  assert.match(read("src/lib/dm/setup.ts"), /\$\{sheet\.hopes \? `; their player hopes the story holds: \$\{sheet\.hopes\}` : ""\}/);
  assert.match(read("src/lib/dm/arc.ts"), /\$\{sheet\.hopes \? `\\n  their player hopes the story holds: \$\{sheet\.hopes\}` : ""\}/);
});

await test("a library character's hopes start each new table, and a table's own never sync back", () => {
  const third = world.addUser("third");
  const input = createSheetSchema.parse({ ...world.sheet(other.id), name: "Wren", hopes: "To find my brother." });
  const wren = characters.createCharacter(third.id, 1, input);
  // The copy a table takes holds what the library holds.
  const copy = characters.instantiateIntoCampaign(wren.id, world.campaignId, third.id, 1);
  assert.ok(copy && !("error" in copy), JSON.stringify(copy));
  const seated = world.sheets().find((sheet) => sheet.libraryCharacterId === wren.id);
  assert.equal(seated.hopes, "To find my brother.");
  world.patch(seated.id, { hopes: "To bury my brother.", gold: 9 });
  characters.syncProgressToLibrary(seated.id);
  const after = characters.getCharacter(wren.id);
  assert.equal(after.sheet.gold, 9, "progress went back");
  assert.equal(after.sheet.hopes, "To find my brother.", "the table's hopes stayed at the table");
});

await test("the builder asks for them, labelled and counted, and sends them", () => {
  const step = read("src/app/characters/builder/steps/IdentityStep.tsx");
  assert.match(step, /title="Hopes for this story \(optional\)"/);
  assert.match(step, /aria-label="Hopes for this story"/);
  assert.match(step, /<LengthNote id=\{`\$\{hopesId\}-length`\} length=\{state\.hopes\.length\} max=\{HOPES_MAX\}/);
  assert.match(read("src/app/characters/builder/submit.ts"), /hopes: \(state\.hopes \?\? ""\)\.trim\(\),/);
  assert.match(read("src/app/campaigns/[campaignId]/CharacterSheetDialog.tsx"), /sheet\.isCompanion \? null : <StoryHopes sheet=\{sheet\} mine=\{mine\} \/>/);
});

await test("an older host, which drops the field, is never asked for hopes", async () => {
  const { hostOffers } = await import("../src/lib/use-capabilities.ts");
  const { SERVER_FEATURES } = await import("../src/lib/capabilities.ts");
  assert.equal(SERVER_FEATURES.storyHopes, true, "this server says it keeps them");
  const older = { story: { configured: true, reachable: true }, utility: { configured: true }, images: { configured: false, reachable: false, backend: "comfyui" }, tts: { configured: false, reachable: false }, stt: { configured: false }, voice: { enabled: false, mode: "off" } };
  assert.equal(hostOffers(older, "storyHopes"), false);
  assert.equal(hostOffers({ ...older, features: { storyHopes: true } }, "storyHopes"), true);
  assert.match(read("src/app/characters/builder/steps/IdentityStep.tsx"), /const asksHopes = hostOffers\(useCapabilities\(\), "storyHopes"\);[\s\S]*\{asksHopes \? \(\n\s+<StepPanel\n\s+title="Hopes for this story \(optional\)"/);
  assert.match(read("src/app/campaigns/[campaignId]/StoryHopes.tsx"), /const kept = hostOffers\(useCapabilities\(\), "storyHopes"\);\n\s+if \(!kept\) \{\n\s+return null;/);
});

finish();
