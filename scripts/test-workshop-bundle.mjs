// Sharing a workshop: the bundle format's refusals, and the world pack
// compile's honesty about what it left behind.
//
// What is worth asserting here is almost entirely about the door. A bundle
// is a whole content tree arriving from a stranger, so the claims that
// matter are that a malformed one is refused with a reason, that an
// oversized one is refused by its SIZE rather than by exhausting memory
// proving it malformed, that a limit is a limit, and that the only images
// the format accepts are size-capped PNG/JPEG/WebP data URLs.
//
// The round trip through a real database lives in
// scripts/test-workshop-integration.mjs, which has one.
// See docs/workshop-plan.md phase 9.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const {
  BUNDLE_LIMITS,
  bundleCounts,
  bundleTotal,
  bundleWarnings,
  MAX_BUNDLE_BYTES,
  readBundle,
  resolveEdges,
  workshopBundleSchema,
  WORKSHOP_BUNDLE_KIND,
  WORKSHOP_BUNDLE_VERSION,
} = await import("../src/lib/workshop/bundle.ts");
const { compileToPack, packIdFrom } = await import("../src/lib/workshop/to-pack.ts");
const { BEAT_KINDS } = await import("../src/lib/workshop/board.ts");
const { worldPackSchema } = await import("../src/lib/worlds/types.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function bundle(overrides = {}) {
  return {
    kind: WORKSHOP_BUNDLE_KIND,
    version: WORKSHOP_BUNDLE_VERSION,
    manifest: {
      name: "The Sunken Vault",
      blurb: "A drowned dwarven city.",
      version: "1.0.0",
      author: "Someone",
      homepage: "",
      inspiredBy: "Original work",
      rightsHolder: "",
    },
    genre: "high_fantasy",
    theme: "Drowned halls",
    premise: "The sea took the vault and something else moved in.",
    targetParty: { size: 4, level: 5 },
    houseRulesText: "",
    variantRules: {},
    lore: [],
    locations: [],
    npcs: [],
    encounters: [],
    tables: [],
    maps: [],
    storyboard: [],
    monsters: [],
    ...overrides,
  };
}

function read(overrides = {}) {
  return readBundle(JSON.stringify(bundle(overrides)));
}

// ---- the door ----

test("a valid bundle is read", () => {
  const result = read();
  assert.ok(!("error" in result));
  assert.equal(result.bundle.manifest.name, "The Sunken Vault");
});

test("an empty file is refused", () => {
  assert.match(readBundle("").error, /empty/i);
  assert.match(readBundle("   ").error, /empty/i);
});

test("something that is not JSON is refused as not JSON", () => {
  assert.match(readBundle("this is not json").error, /not JSON/i);
});

test("a world pack is refused as the wrong kind of file", () => {
  // The most likely wrong file somebody drags in is the other format this
  // app writes, so it gets a sentence of its own rather than "invalid".
  const pack = JSON.stringify({ id: "my_world", name: "A world", baseGenre: "high_fantasy" });
  assert.match(readBundle(pack).error, /not a workshop bundle/i);
});

test("a bundle from a different format version is refused by version", () => {
  const future = JSON.stringify({ ...bundle(), version: 99 });
  const error = readBundle(future).error;
  assert.match(error, /version 99/);
  assert.match(error, new RegExp(`version ${WORKSHOP_BUNDLE_VERSION}`));
});

test("an oversized file is refused by its size, before it is parsed", () => {
  // The payload is deliberately not valid JSON. If the size check ran after
  // the parse this would fail with "not JSON", which would mean a huge file
  // was being read into a parser before anything checked how big it was.
  const huge = "x".repeat(MAX_BUNDLE_BYTES + 1);
  const error = readBundle(huge).error;
  assert.match(error, /MB/);
  assert.doesNotMatch(error, /not JSON/i);
});

test("size is measured in bytes, not characters", () => {
  // A multi-byte character is bigger on the wire than it looks in an editor,
  // and a cap that counted characters would let a file through at four times
  // its stated limit.
  const wide = "\u{1F409}".repeat(MAX_BUNDLE_BYTES / 4 + 10);
  assert.ok(wide.length < MAX_BUNDLE_BYTES, "the string is under the cap by character count");
  assert.match(readBundle(wide).error, /MB/, "but over it by bytes");
});

test("a manifest missing its declarations is refused", () => {
  for (const field of ["name", "blurb", "inspiredBy"]) {
    const manifest = { ...bundle().manifest, [field]: "" };
    const result = read({ manifest });
    assert.ok("error" in result, `an empty ${field} was accepted`);
    assert.match(result.error, new RegExp(field));
  }
});

test("a rights holder is optional, because an original world has none", () => {
  assert.ok(!("error" in read({ manifest: { ...bundle().manifest, rightsHolder: "" } })));
});

test("every per-kind limit is enforced", () => {
  for (const [kind, limit] of Object.entries(BUNDLE_LIMITS)) {
    const rows = Array.from({ length: limit + 1 }, (_unused, index) => rowFor(kind, index));
    const result = read({ [kind]: rows });
    assert.ok("error" in result, `${kind} accepted ${limit + 1} rows past its limit of ${limit}`);
  }
});

function rowFor(kind, index) {
  switch (kind) {
    case "lore":
      return { category: "other", title: `Lore ${index}`, body: "", tags: [] };
    case "locations":
      return { name: `Place ${index}`, layoutDescription: "", connections: [] };
    case "npcs":
      return { name: `Person ${index}` };
    case "encounters":
      return { name: `Fight ${index}` };
    case "tables":
      return { name: `Table ${index}` };
    case "maps":
      return { name: `Map ${index}`, width: 10, height: 10 };
    case "storyboard":
      return { kind: "event", title: `Beat ${index}` };
    default:
      return { name: `Monster ${index}`, stats: {} };
  }
}

test("a string past its length is refused rather than silently clipped", () => {
  const result = read({ lore: [{ category: "other", title: "x".repeat(500), body: "" }] });
  assert.ok("error" in result);
});

test("an unknown beat kind is refused", () => {
  const result = read({ storyboard: [{ kind: "vibes", title: "A card" }] });
  assert.ok("error" in result);
  // And every kind the board defines is accepted, so the two lists cannot
  // drift apart without this failing.
  for (const kind of BEAT_KINDS) {
    assert.ok(!("error" in read({ storyboard: [{ kind, title: "A card" }] })), `${kind} refused`);
  }
});

// A real 1x1 transparent PNG, so the image tests exercise a data URL that
// would actually decode.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("a portrait and a backdrop travel as data URLs", () => {
  const result = read({
    npcs: [{ name: "Someone", portrait: TINY_PNG }],
    maps: [
      {
        name: "A map",
        width: 10,
        height: 10,
        backdrop: TINY_PNG,
        backdropTransform: { scale: 2 },
      },
    ],
  });
  assert.ok(!("error" in result), result.error);
  assert.equal(result.bundle.npcs[0].portrait, TINY_PNG);
  assert.equal(result.bundle.maps[0].backdrop, TINY_PNG);
  assert.deepEqual(result.bundle.maps[0].backdropTransform, { scale: 2 });
});

test("absent images read back as empty strings", () => {
  const result = read({
    npcs: [{ name: "Someone" }],
    maps: [{ name: "A map", width: 10, height: 10 }],
  });
  assert.ok(!("error" in result));
  assert.equal(result.bundle.npcs[0].portrait, "");
  assert.equal(result.bundle.maps[0].backdrop, "");
});

test("an image that is not a PNG/JPEG/WebP data URL is refused", () => {
  // The mime allowlist and the data-URL shape are the whole boundary: a
  // path, a URL, or an SVG (scriptable) must never reach the disk writer.
  for (const bad of [
    "data:image/gif;base64,R0lGODlhAQABAAAAACw=",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "/uploads/legit-looking.png",
    "https://example.com/art.png",
    "data:image/png;base64,not base64!!!",
  ]) {
    const result = read({ npcs: [{ name: "Someone", portrait: bad }] });
    assert.ok("error" in result, `${bad.slice(0, 40)} was accepted`);
  }
});

test("an image over the per-image cap is refused by the schema", () => {
  const oversized = `data:image/png;base64,${"A".repeat(11_300_001)}`;
  const result = read({ npcs: [{ name: "Someone", portrait: oversized }] });
  assert.ok("error" in result);
});

test("unknown extra keys do not survive into the parsed bundle", () => {
  const parsed = workshopBundleSchema.parse({ ...bundle(), evil: "payload" });
  assert.equal(parsed.evil, undefined);
});

// ---- counting and warning ----

test("counts and total agree with what is in the bundle", () => {
  const filled = bundle({
    lore: [{ category: "other", title: "A", body: "" }],
    locations: [{ name: "B", layoutDescription: "", connections: [] }],
    npcs: [{ name: "C" }],
  });
  const parsed = workshopBundleSchema.parse(filled);
  assert.equal(bundleCounts(parsed).lore, 1);
  assert.equal(bundleCounts(parsed).encounters, 0);
  assert.equal(bundleTotal(parsed), 3);
});

test("a bundle built on somebody else's setting warns about it", () => {
  const parsed = workshopBundleSchema.parse(
    bundle({ manifest: { ...bundle().manifest, rightsHolder: "Some Studio" } }),
  );
  const warnings = bundleWarnings(parsed);
  assert.ok(warnings.some((line) => line.includes("Some Studio")));
  assert.ok(warnings.some((line) => /not affiliated/i.test(line)));
});

test("a bundle carrying imageless maps says the art did not travel", () => {
  const parsed = workshopBundleSchema.parse(
    bundle({ maps: [{ name: "A map", width: 10, height: 10 }] }),
  );
  assert.ok(bundleWarnings(parsed).some((line) => /No images came along/.test(line)));
});

test("a bundle carrying art warns about the right to share it", () => {
  const parsed = workshopBundleSchema.parse(
    bundle({ npcs: [{ name: "Someone", portrait: TINY_PNG }] }),
  );
  const warnings = bundleWarnings(parsed);
  assert.ok(warnings.some((line) => /1 image/.test(line)));
  assert.ok(warnings.some((line) => /right to share/.test(line)));
  assert.ok(!warnings.some((line) => /No images came along/.test(line)));
});

test("an original bundle with nothing surprising in it warns about nothing", () => {
  assert.deepEqual(bundleWarnings(workshopBundleSchema.parse(bundle())), []);
});

// ---- arrows ----

test("an arrow past the end of the board is dropped", () => {
  assert.deepEqual(resolveEdges([0, 2, 9, -1, 1.5], 3), [0, 2]);
});

test("a duplicated arrow is kept once", () => {
  assert.deepEqual(resolveEdges([1, 1, 1], 3), [1]);
});

// ---- the world pack compile ----

function fullBundle() {
  return workshopBundleSchema.parse(
    bundle({
      lore: [
        { category: "factions", title: "The Deepwardens", body: "They kept the pumps running." },
        { category: "history", title: "The Flood", body: "It came in a single night." },
      ],
      locations: [
        { name: "The Pump Halls", layoutDescription: "Bronze machinery, waist deep.", connections: [] },
      ],
      npcs: [{ name: "Vasska Ironhand" }],
      storyboard: [
        { kind: "hook", title: "A body washes up", body: "Wearing a Deepwarden seal." },
        { kind: "event", title: "The pumps stop", body: "" },
      ],
    }),
  );
}

test("a pack id is always safe for a filename", () => {
  assert.equal(packIdFrom("The Sunken Vault"), "the_sunken_vault");
  // The regex on a pack id is the only thing between a downloaded manifest
  // and an arbitrary write path, so anything that cannot produce a valid one
  // falls back rather than emitting something odd.
  assert.equal(packIdFrom("../../etc/passwd"), "etc_passwd");
  assert.equal(packIdFrom("!!!"), "my_world");
  assert.equal(packIdFrom(""), "my_world");
  assert.equal(packIdFrom("123"), "my_world");
  for (const name of ["The Sunken Vault", "../../etc/passwd", "!!!", "", "123", "a"]) {
    assert.match(packIdFrom(name), /^[a-z][a-z0-9_]{2,49}$/, `${name} produced an unsafe id`);
  }
});

test("lore filed under factions becomes factions, and the rest becomes glossary", () => {
  const { draft } = compileToPack(fullBundle());
  assert.equal(draft.factions.length, 1);
  assert.equal(draft.factions[0].name, "The Deepwardens");
  assert.equal(draft.glossary.length, 1);
  assert.equal(draft.glossary[0].term, "The Flood");
});

test("places, hooks and name seeds come across", () => {
  const { draft } = compileToPack(fullBundle());
  assert.equal(draft.locations[0].name, "The Pump Halls");
  assert.equal(draft.hooks.length, 1, "only hook cards become hooks");
  assert.match(draft.hooks[0], /body washes up/);
  assert.deepEqual(draft.nameSeeds.people, ["Vasska Ironhand"]);
  assert.deepEqual(draft.nameSeeds.places, ["The Pump Halls"]);
});

test("the reskin tables come out empty, and the compile says so", () => {
  // The honest part. A world pack IS its reskin tables, and a workshop holds
  // none, so a compile that quietly produced an empty pack would be claiming
  // to have done something it did not.
  const { draft, refusals } = compileToPack(fullBundle());
  for (const field of ["races", "classes", "backgrounds", "spells", "items", "features"]) {
    assert.deepEqual(draft[field], [], `${field} was not empty`);
  }
  assert.ok(refusals.some((refusal) => /reskin/i.test(refusal.reason)));
});

test("hand-built monsters are refused with the reason, not silently dropped", () => {
  const withMonsters = workshopBundleSchema.parse(
    bundle({ monsters: [{ name: "Vault Drowner", stats: {} }] }),
  );
  const { draft, refusals } = compileToPack(withMonsters);
  assert.deepEqual(draft.monsters, []);
  const refusal = refusals.find((entry) => entry.field === "monsters");
  assert.ok(refusal, "no refusal was recorded for the monster left behind");
  assert.match(refusal.reason, /slug/);
});

test("scenario content is refused as belonging in the bundle, not the pack", () => {
  const withScenario = workshopBundleSchema.parse(
    bundle({ encounters: [{ name: "Ambush" }], maps: [{ name: "Hall", width: 8, height: 8 }] }),
  );
  const { refusals } = compileToPack(withScenario);
  assert.ok(refusals.some((entry) => /setting, not a scenario/i.test(entry.reason)));
});

test("an empty workshop compiles to nothing and reports it", () => {
  const { filled } = compileToPack(workshopBundleSchema.parse(bundle()));
  assert.equal(filled, 0);
});

test("a compile with no rights holder warns before it is published", () => {
  const { warnings } = compileToPack(fullBundle());
  assert.ok(warnings.some((line) => /rights holder/i.test(line)));
});

test("the compiled draft is a pack the pack schema accepts", () => {
  // The strongest thing this file can assert about the compile: not that the
  // fields look right, but that worldPackSchema itself parses the result. A
  // draft that needed hand-repair before it would load would make the whole
  // compile a waste of a button.
  const parsed = worldPackSchema.safeParse(compileToPack(fullBundle()).draft);
  assert.ok(parsed.success, `the draft failed the pack schema: ${parsed.error?.issues[0]?.message}`);
});

test("a draft built from content past every pack limit still parses", () => {
  const overlong = workshopBundleSchema.parse(
    bundle({
      manifest: { ...bundle().manifest, name: "N".repeat(70), blurb: "B".repeat(200) },
      lore: [
        { category: "factions", title: "F".repeat(200), body: "x".repeat(9_000) },
        { category: "history", title: "H".repeat(200), body: "y".repeat(9_000) },
      ],
      locations: [{ name: "L".repeat(120), layoutDescription: "z".repeat(8_000), connections: [] }],
      npcs: [{ name: "P".repeat(120) }],
      storyboard: [{ kind: "hook", title: "T".repeat(200), body: "b".repeat(4_000) }],
    }),
  );
  const parsed = worldPackSchema.safeParse(compileToPack(overlong).draft);
  assert.ok(parsed.success, `the draft failed the pack schema: ${parsed.error?.issues[0]?.message}`);
});

test("long lore is clipped to the pack's limits and the clipping is announced", () => {
  const wordy = workshopBundleSchema.parse(
    bundle({
      lore: [{ category: "history", title: "A very long title ".repeat(4), body: "x".repeat(900) }],
    }),
  );
  const { draft, warnings } = compileToPack(wordy);
  assert.ok(draft.glossary[0].term.length <= 40);
  assert.ok(draft.glossary[0].meaning.length <= 160);
  assert.ok(warnings.some((line) => /clipped/i.test(line)));
});

console.log(`workshop bundle: ${passed} checks passed`);
