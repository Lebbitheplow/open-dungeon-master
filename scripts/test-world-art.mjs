// World pack art: the key scheme, the loader's lift, the summary's cover,
// and the render list a pack turns into. Pure, no GPU, no database.
import assert from "node:assert/strict";
import { register } from "node:module";
register("./lib/register-alias.mjs", import.meta.url);

const {
  artSlug,
  packArtKey,
  packArtUrl,
  packArtSlots,
  packCharacterArtKey,
  MAX_PACK_ART_BYTES,
  PACK_ART_KEY,
} = await import("../src/lib/worlds/art.ts");
const { worldPackSchema, summarizePack } = await import("../src/lib/worlds/types.ts");
const { withArtLifted } = await import("../src/lib/worlds/index.ts");
const { worldArtJobs, sceneStyleFor, BOSS_CR_FLOOR } = await import("./world-art-set.mjs");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

// A valid 1x1 WebP, the smallest picture the schema accepts.
const PIXEL_WEBP =
  "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

function manifest(overrides = {}) {
  return {
    id: "art_world",
    name: "Art World",
    blurb: "A world used only by this test.",
    inspiredBy: "Nothing.",
    franchise: "Test",
    baseGenre: "high_fantasy",
    theme: "A world used only by this test",
    version: "1.2.0",
    races: [{ id: "human", name: "Townsfolk", blurb: "Plain." }],
    classes: [{ id: "fighter", name: "Sellsword", blurb: "Paid." }],
    monsters: [
      { slug: "goblin", name: "Ditch Goblin", cr: 0.25, type: "humanoid", blurb: "Small." },
      { slug: "adult-red-dragon", name: "The Ember", cr: 17, type: "dragon", blurb: "Big." },
    ],
    locations: [{ name: "Saint Odo's Well", blurb: "Deep." }],
    factions: [{ name: "The Guild", blurb: "Rich." }],
    ...overrides,
  };
}

test("artSlug folds names to file-safe stems and keys are derived from them", () => {
  assert.equal(artSlug("Saint Odo's Well"), "saint-odo-s-well");
  assert.equal(artSlug("  Über  Städte! "), "uber-stadte");
  assert.equal(artSlug("---"), "");
  assert.equal(packArtKey("cover"), "cover");
  assert.equal(packArtKey("cover", "ignored"), "cover");
  assert.equal(packArtKey("monster", "adult-red-dragon"), "monster-adult-red-dragon");
  assert.equal(packArtKey("race", "variant_human"), "race-variant-human");
  assert.equal(packArtKey("location", "Saint Odo's Well"), "location-saint-odo-s-well");
  assert.equal(packArtKey("location", "!!!"), "", "an unfoldable name yields no key rather than a bare kind");
  for (const key of ["cover", "monster-adult-red-dragon", "location-saint-odo-s-well"]) {
    assert.match(key, PACK_ART_KEY);
  }
  for (const bad of ["", "-lead", "UPPER", "a/b", "a b", "../x", "x".repeat(81)]) {
    assert.doesNotMatch(bad, PACK_ART_KEY, `${JSON.stringify(bad)} passed the key pattern`);
  }
});

test("packArtUrl points at the art route with the version as a cache-buster", () => {
  assert.equal(packArtUrl("berserk", "cover"), "/api/worlds/berserk/art/cover");
  assert.equal(packArtUrl("berserk", "cover", "1.1.0"), "/api/worlds/berserk/art/cover?v=1.1.0");
});

test("packArtSlots lists the cover first, then what the pack names, in a stable order", () => {
  const slots = packArtSlots(worldPackSchema.parse(manifest()));
  assert.deepEqual(
    slots.map((slot) => slot.key),
    [
      "cover",
      "race-human",
      "class-fighter",
      "monster-goblin",
      "monster-adult-red-dragon",
      "location-saint-odo-s-well",
      "faction-the-guild",
    ],
  );
  assert.equal(slots[3].kind, "monster");
  assert.equal(slots[3].ref, "goblin");
});

test("a character resolves to the class picture first, then the race, then nothing", () => {
  const keys = ["race-human", "class-fighter"];
  assert.equal(packCharacterArtKey(keys, { race: "human", class: "fighter" }), "class-fighter");
  assert.equal(packCharacterArtKey(keys, { race: "human", class: "wizard" }), "race-human");
  assert.equal(packCharacterArtKey(keys, { race: "elf", class: "wizard" }), null);
  assert.equal(packCharacterArtKey([], { race: "human", class: "fighter" }), null);
});

test("the schema accepts art as image data URLs and refuses anything else", () => {
  assert.ok(worldPackSchema.safeParse(manifest({ art: { cover: PIXEL_WEBP } })).success);
  for (const bad of [
    { cover: "https://example.invalid/cover.webp" },
    { cover: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    { cover: "data:text/html;base64,PGI+" },
    { "../etc": PIXEL_WEBP },
    { Cover: PIXEL_WEBP },
  ]) {
    assert.ok(!worldPackSchema.safeParse(manifest({ art: bad })).success, `${JSON.stringify(bad)} was accepted`);
  }
  // Whatever a manifest claims about artKeys is ignored downstream, but the
  // field still has to be well-formed.
  assert.ok(!worldPackSchema.safeParse(manifest({ artKeys: ["../x"] })).success);
});

test("the loader lifts art out of the pack, fills artKeys, and drops oversized pictures", () => {
  const big = `data:image/webp;base64,${Buffer.alloc(MAX_PACK_ART_BYTES + 1, 1).toString("base64")}`;
  const parsed = worldPackSchema.parse(
    manifest({ art: { cover: PIXEL_WEBP, "monster-goblin": PIXEL_WEBP, "race-human": big }, artKeys: ["lie"] }),
  );
  const { pack, art } = withArtLifted(parsed);
  assert.deepEqual(pack.art, {}, "inline art survived the lift");
  assert.deepEqual(pack.artKeys, ["cover", "monster-goblin"]);
  assert.equal(art.get("cover")?.mime, "image/webp");
  assert.ok(art.get("cover")?.bytes.length > 0);
  assert.equal(art.get("race-human"), undefined, "an oversized picture was kept");
  // Everything else on the pack is untouched.
  assert.equal(pack.name, "Art World");
  assert.equal(pack.monsters.length, 2);
});

test("a summary carries the cover URL only when the pack has a cover", () => {
  const withCover = withArtLifted(worldPackSchema.parse(manifest({ art: { cover: PIXEL_WEBP } }))).pack;
  assert.equal(summarizePack(withCover).cover, "/api/worlds/art_world/art/cover?v=1.2.0");
  const without = withArtLifted(worldPackSchema.parse(manifest({ art: { "race-human": PIXEL_WEBP } }))).pack;
  assert.equal(summarizePack(without).cover, "");
  assert.equal(summarizePack(worldPackSchema.parse(manifest())).cover, "");
});

test("the render list has one job per slot, from the pack's own words, with bosses framed as bosses", () => {
  const pack = worldPackSchema.parse(manifest());
  const canonical = { race: () => "human", class: () => "fighter", monster: (slug) => slug.replace(/-/g, " ") };
  const jobs = worldArtJobs(pack, canonical, { slots: packArtSlots(pack), packArtKey });
  assert.equal(jobs.length, packArtSlots(pack).length);
  assert.deepEqual(jobs.map((job) => job.key), packArtSlots(pack).map((slot) => slot.key));
  const byKey = new Map(jobs.map((job) => [job.key, job]));
  assert.equal(byKey.get("cover").aspect, "landscape");
  assert.equal(byKey.get("location-saint-odo-s-well").aspect, "landscape");
  assert.equal(byKey.get("race-human").aspect, "square");
  assert.match(byKey.get("race-human").prompt, /Townsfolk, a human/);
  assert.match(byKey.get("class-fighter").prompt, /Sellsword, a fighter/);
  assert.match(byKey.get("monster-goblin").prompt, /Ditch Goblin, a humanoid creature like a goblin/);
  assert.ok(pack.monsters[1].cr >= BOSS_CR_FLOOR);
  assert.match(byKey.get("monster-adult-red-dragon").prompt, /towering, menacing creature/i);
  assert.doesNotMatch(byKey.get("monster-goblin").prompt, /towering/i);
  for (const job of jobs) {
    assert.ok(job.prompt.length > 40, `${job.key} prompt is empty`);
    assert.match(job.negative, /watermark/);
    assert.doesNotMatch(job.prompt, /\.\./, `${job.key} prompt has a doubled full stop`);
  }
  // Scenes get a scene style, not the portrait one.
  assert.equal(sceneStyleFor(pack), "painted fantasy landscape, warm light, rich colour");
  assert.match(byKey.get("cover").prompt, /painted fantasy landscape/);
});

console.log(`test-world-art: ${passed} passed`);
