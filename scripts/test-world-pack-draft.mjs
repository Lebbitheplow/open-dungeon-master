// The world pack draft behind the workshop's Plugin tool: the lenient
// schema, the finish that turns it into a pack, the checks the editor
// shows, the merge that pulls a workshop's lore in, the store, and the two
// ways a draft travels (workshop bundle and Duplicate).
//
// The pure half runs first without a database; the store half points
// SQLITE_DB_PATH at a scratch file the way the other db suites do.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-pack-draft-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
process.env.WORLD_PACKS_DIR = path.join(dir, "worlds");

register("./lib/register-alias.mjs", import.meta.url);

const {
  blankDraft,
  draftBytes,
  draftCount,
  draftFromPack,
  exportDraft,
  finishDraft,
  mergePulled,
  worldPackDraftSchema,
} = await import("../src/lib/worlds/draft.ts");
const { checkDraft } = await import("../src/lib/worlds/draft-check.ts");
const { worldPackSchema } = await import("../src/lib/worlds/types.ts");
const { packArtKey } = await import("../src/lib/worlds/art.ts");
const { CLASS_OPTIONS, FEATURE_OPTIONS, RACE_OPTIONS } = await import("../src/lib/worlds/catalog.ts");
const { compileToPack } = await import("../src/lib/workshop/to-pack.ts");
const { workshopBundleSchema, pickBundleKinds, bundleWarnings } = await import("../src/lib/workshop/bundle.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok: ${name}`);
}

const PIXEL_WEBP = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

// A draft with everything the schema requires filled in, and one row of
// each table, so a test can break one thing at a time.
function fullDraft(overrides = {}) {
  return worldPackDraftSchema.parse({
    name: "The Sunken Coast",
    blurb: "A drowned dwarven kingdom and the tide-cults that kept living in it.",
    inspiredBy: "My own",
    franchise: "Sunken Coast",
    baseGenre: "dark_fantasy",
    theme: "Salvage, faith and the things under the water",
    dmFlavor: "x".repeat(220),
    races: [{ id: "hill_dwarf", name: "Deepfolk", blurb: "" }],
    classes: [{ id: "cleric", name: "Tide-priest", blurb: "", castingLabel: "Prayers" }],
    backgrounds: [{ id: "acolyte", name: "Lamp-keeper", blurb: "" }],
    spells: [{ from: "Cure Wounds", name: "Brine-mend", blurb: "" }],
    items: [{ from: "Leather", name: "Sealskin", blurb: "" }],
    features: [{ from: "Sneak Attack", name: "Backstab", blurb: "" }],
    monsters: [{ slug: "giant-rat", name: "Sump rat", cr: 0.125, type: "beast", blurb: "" }],
    factions: [{ name: "The Tide Court", blurb: "Priests who own the water." }],
    locations: [{ name: "Lowharbour", blurb: "The last dry town." }],
    hooks: ["A tide-priest offers to pay for a relic nobody else will touch."],
    glossary: [{ term: "brine-law", meaning: "The Court's word on who may dive." }],
    nameSeeds: { people: ["Aud", "Brannoc"], places: ["Lowharbour"] },
    ...overrides,
  });
}

// ---- the schema ----

test("a blank draft parses and counts nothing", () => {
  const draft = blankDraft("horror");
  assert.equal(draft.baseGenre, "horror");
  assert.equal(draft.name, "");
  assert.equal(draftCount(draft), 0);
  assert.equal(blankDraft("custom").baseGenre, "high_fantasy", "custom is not a pack genre");
});

test("the draft keeps the pack's caps but drops its mins", () => {
  assert.ok(worldPackDraftSchema.safeParse({}).success, "nothing is required");
  assert.ok(!worldPackDraftSchema.safeParse({ blurb: "x".repeat(201) }).success, "blurb cap held");
  assert.ok(!worldPackDraftSchema.safeParse({ art: { "Bad Key": PIXEL_WEBP } }).success, "art keys are checked");
  assert.ok(!worldPackDraftSchema.safeParse({ art: { cover: "data:text/plain;base64,QQ==" } }).success);
});

test("a typed id survives only when it is already a legal pack id", () => {
  assert.equal(worldPackDraftSchema.parse({ id: "sunken_coast" }).id, "sunken_coast");
  assert.equal(worldPackDraftSchema.parse({ id: "Sunken Coast" }).id, "");
  assert.equal(worldPackDraftSchema.parse({ id: "../etc" }).id, "");
});

test("a finished pack reads back as a draft, artKeys dropped, custom genre forgotten", () => {
  const draft = draftFromPack({
    ...fullDraft(),
    artKeys: ["cover"],
    art: { cover: PIXEL_WEBP },
    unknownField: 1,
  });
  assert.ok(!("error" in draft));
  assert.equal(draft.art.cover, PIXEL_WEBP);
  assert.ok(!("artKeys" in draft));
  assert.ok(!("unknownField" in draft));
  assert.equal(draftFromPack({ baseGenre: "custom" }).baseGenre, "high_fantasy");
  assert.ok("error" in draftFromPack({ blurb: "x".repeat(300) }), "a refused field refuses the file");
  assert.ok(!("error" in draftFromPack("not an object")), "a non-object reads as a blank draft");
});

// ---- finish and export ----

test("finishing derives the id, drops blank rows, trims, and prunes orphan art", () => {
  const draft = fullDraft({
    races: [
      { id: "hill_dwarf", name: "  Deepfolk ", blurb: "" },
      { id: "", name: "", blurb: "" },
      { id: "high_elf", name: "", blurb: "" },
    ],
    art: { cover: PIXEL_WEBP, [packArtKey("race", "hill_dwarf")]: PIXEL_WEBP, "monster-nobody": PIXEL_WEBP },
  });
  const pack = finishDraft(draft);
  assert.equal(pack.id, "the_sunken_coast");
  assert.deepEqual(pack.races, [{ id: "hill_dwarf", name: "Deepfolk", blurb: "" }]);
  assert.deepEqual(Object.keys(pack.art).sort(), ["cover", "race-hill-dwarf"]);
  assert.equal(pack.franchise, "Sunken Coast");
  assert.equal(pack.classes[0].castingLabel, "Prayers");
});

test("the franchise falls back to the name and an empty casting label becomes null", () => {
  const pack = finishDraft(fullDraft({ franchise: "", classes: [{ id: "cleric", name: "Tide-priest", blurb: "", castingLabel: "  " }] }));
  assert.equal(pack.franchise, "The Sunken Coast");
  assert.equal(pack.classes[0].castingLabel, null);
});

test("a full draft exports as a pack worldPackSchema accepts", () => {
  const outcome = exportDraft(fullDraft());
  assert.ok("pack" in outcome, "error" in outcome ? outcome.error : "");
  assert.ok(worldPackSchema.safeParse(outcome.pack).success);
  assert.deepEqual(outcome.pack.artKeys, []);
  assert.equal(outcome.pack.id, "the_sunken_coast");
});

test("an unfinished draft exports as the schema's first complaint", () => {
  const outcome = exportDraft(blankDraft());
  assert.ok("error" in outcome);
  assert.match(outcome.error, /name|blurb|inspiredBy/);
});

test("draftCount counts the tables and draftBytes measures the JSON", () => {
  const draft = fullDraft();
  assert.equal(draftCount(draft), 11);
  assert.ok(draftBytes(draft) > 500 && draftBytes(draft) < 5000);
});

// ---- the checks ----

test("a full draft has no problems and only size advice", () => {
  const check = checkDraft(fullDraft());
  assert.deepEqual(check.problems, []);
  assert.ok(check.advice.some((line) => line.includes("races")));
  assert.ok(check.advice.some((line) => line.includes("rights holder")));
  assert.ok(check.advice.some((line) => line.includes("cover")));
});

test("a blank draft lists the identity it lacks", () => {
  const { problems } = checkDraft(blankDraft());
  assert.ok(problems.some((line) => /name/i.test(line)));
  assert.ok(problems.some((line) => /blurb/i.test(line)));
  assert.ok(problems.some((line) => /inspired/i.test(line)));
  assert.ok(problems.some((line) => /theme/i.test(line)));
});

test("the checks are the validator's checks", () => {
  const problems = (overrides) => checkDraft(fullDraft(overrides)).problems;
  assert.ok(problems({ races: [{ id: "space_marine", name: "Marine", blurb: "" }] }).some((p) => p.includes("not in the catalog")));
  assert.ok(problems({ races: [{ id: "hill_dwarf", name: "hill_dwarf", blurb: "" }] }).some((p) => p.includes("own id")));
  assert.ok(
    problems({ races: [{ id: "hill_dwarf", name: "A", blurb: "" }, { id: "hill_dwarf", name: "B", blurb: "" }] }).some((p) => p.includes("twice")),
  );
  assert.ok(
    problems({ races: [{ id: "hill_dwarf", name: "Same", blurb: "" }, { id: "high_elf", name: "same", blurb: "" }] }).some((p) => p.includes("both called")),
  );
  assert.ok(problems({ classes: [{ id: "fighter", name: "Blade", blurb: "", castingLabel: "Tricks" }] }).some((p) => p.includes("does not cast")));
  assert.ok(problems({ spells: [{ from: "Cure Wounds", name: "cure wounds", blurb: "" }] }).some((p) => p.includes("renamed to itself")));
  assert.ok(problems({ monsters: [{ slug: "giant-rat", name: "A", cr: 0.125, type: "", blurb: "" }, { slug: "giant-rat", name: "B", cr: 0.125, type: "", blurb: "" }] }).some((p) => p.includes("twice")));
  assert.ok(problems({ alignments: ["XX"] }).some((p) => p.includes("alignment")));
  assert.ok(problems({ hooks: ["A hook — with an em dash"] }).some((p) => p.includes("em dash")));
  assert.ok(problems({ companionRaces: ["nobody"] }).some((p) => p.includes("Companion race")));
  assert.ok(
    problems({ locations: [{ name: "Low Harbour", blurb: "" }, { name: "low-harbour", blurb: "" }] }).some((p) => p.includes("same picture key")),
  );
});

test("the DM brief floor is advice, not a problem", () => {
  const check = checkDraft(fullDraft({ dmFlavor: "short" }));
  assert.deepEqual(check.problems, []);
  assert.ok(check.advice.some((line) => line.includes("DM brief")));
});

// ---- the catalogs ----

test("the pickers offer real ids and every feature name is unique", () => {
  assert.ok(RACE_OPTIONS.some((option) => option.value === "hill_dwarf"));
  assert.ok(CLASS_OPTIONS.find((option) => option.value === "wizard").caster);
  assert.ok(!CLASS_OPTIONS.find((option) => option.value === "fighter").caster);
  const features = FEATURE_OPTIONS();
  assert.ok(features.some((option) => option.value === "Sneak Attack"));
  assert.ok(features.some((option) => option.value === "Darkvision 60 ft"), "racial traits are features too");
  assert.equal(new Set(features.map((option) => option.value)).size, features.length);
});

// ---- pulling from the workshop ----

test("mergePulled adds the compile's flavour and never overwrites", () => {
  const bundle = {
    lore: [
      { category: "factions", title: "The Tide Court", body: "Priests who own the water." },
      { category: "factions", title: "Salvagers' Guild", body: "Divers with debts." },
      { category: "history", title: "The Drowning", body: "When the sea came in." },
    ],
    locations: [{ name: "Lowharbour", layoutDescription: "Different words." }, { name: "The Stair", layoutDescription: "Steps into the dark." }],
    storyboard: [{ kind: "hook", title: "A relic", body: "Nobody will touch it." }],
    npcs: [{ name: "Aud" }, { name: "Cerys" }],
    monsters: [],
    encounters: [],
    maps: [],
    tables: [],
    manifest: { name: "W", blurb: "b", version: "1", author: "", homepage: "", inspiredBy: "me", rightsHolder: "" },
    genre: "dark_fantasy",
    theme: "",
    premise: "",
  };
  const compiled = compileToPack(bundle);
  const before = fullDraft();
  const { draft, added } = mergePulled(before, compiled.draft);
  assert.equal(draft.factions[0].blurb, "Priests who own the water.", "the hand-written faction is kept");
  assert.equal(draft.factions.length, 2);
  assert.equal(draft.locations.length, 2);
  assert.equal(draft.locations[0].blurb, "The last dry town.", "the hand-written place wins");
  assert.equal(draft.hooks.length, 2);
  assert.equal(draft.glossary.length, 2);
  assert.deepEqual(draft.nameSeeds.people, ["Aud", "Brannoc", "Cerys"]);
  assert.equal(added, 1 + 1 + 1 + 1 + 1 + 1);
  assert.equal(draft.theme, before.theme, "a filled theme is left alone");
  const empty = mergePulled(blankDraft(), { theme: "Pulled theme", premise: "Pulled premise" });
  assert.equal(empty.draft.theme, "Pulled theme");
  assert.equal(empty.added, 0);
});

// ---- the bundle carries it ----

test("a workshop bundle carries the draft and older bundles read as null", () => {
  const base = {
    kind: "odm.workshop",
    version: 1,
    manifest: { name: "W", blurb: "b", inspiredBy: "me" },
  };
  assert.equal(workshopBundleSchema.parse(base).plugin, null);
  const carried = workshopBundleSchema.parse({ ...base, plugin: fullDraft({ art: { cover: PIXEL_WEBP } }) });
  assert.equal(carried.plugin.name, "The Sunken Coast");
  assert.equal(pickBundleKinds(carried, ["lore"]).plugin, null, "not picked means not carried");
  assert.equal(pickBundleKinds(carried, ["plugin"]).plugin.name, "The Sunken Coast");
  assert.ok(bundleWarnings(carried).some((line) => line.includes("world pack draft") && line.includes("1 picture")));
  assert.ok(!workshopBundleSchema.safeParse({ ...base, plugin: { blurb: "x".repeat(300) } }).success);
});

// ---- the store ----

const { createUser } = await import("../src/lib/db/users.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { copyPackDraft, deletePackDraft, getPackDraft, hasPackDraft, savePackDraft } = await import(
  "../src/lib/db/world-pack-drafts.ts"
);
const { cloneCampaign } = await import("../src/lib/db/campaign-clone.ts");
const { exportWorkshopBundle, importWorkshopBundle } = await import("../src/lib/db/workshop-bundle.ts");
const { deleteCampaign } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");

const user = createUser("packsmith", "hash");
const workshop = createWorkshop(user.id, { title: "Coast prep", description: "", targetParty: { size: 4, level: 3 } });

test("a workshop without a draft answers blank in its genre, and a save rounds trip", () => {
  const blank = getPackDraft(workshop.id, "horror");
  assert.equal(blank.updatedAt, null);
  assert.equal(blank.draft.baseGenre, "horror");
  assert.equal(hasPackDraft(workshop.id), false);
  const saved = savePackDraft(workshop.id, fullDraft({ art: { cover: PIXEL_WEBP } }));
  assert.ok(saved.updatedAt);
  assert.equal(hasPackDraft(workshop.id), true);
  const read = getPackDraft(workshop.id);
  assert.equal(read.draft.name, "The Sunken Coast");
  assert.equal(read.draft.art.cover, PIXEL_WEBP);
  savePackDraft(workshop.id, { ...read.draft, name: "Renamed" });
  assert.equal(getPackDraft(workshop.id).draft.name, "Renamed", "a second save replaces, not duplicates");
});

test("an unreadable column reads as a blank draft rather than a crash", () => {
  getDatabase().prepare(`UPDATE world_pack_drafts SET draft_json = ? WHERE campaign_id = ?`).run("{\"blurb\": \"" + "x".repeat(300) + "\"}", workshop.id);
  assert.equal(getPackDraft(workshop.id).draft.name, "");
  savePackDraft(workshop.id, fullDraft({ art: { cover: PIXEL_WEBP } }));
});

test("Duplicate copies the draft and a bundle carries it across", () => {
  const cloned = cloneCampaign(user.id, workshop.id);
  assert.ok(!("error" in cloned));
  assert.equal(getPackDraft(cloned.campaign.id).draft.name, "The Sunken Coast");
  assert.equal(copyPackDraft("nobody", cloned.campaign.id), false);

  const exported = exportWorkshopBundle(workshop.id, { name: "Coast", blurb: "b", inspiredBy: "me" });
  assert.ok(!("error" in exported));
  assert.equal(exported.bundle.plugin.name, "The Sunken Coast");
  assert.equal(exported.bundle.plugin.art.cover, PIXEL_WEBP);
  const imported = importWorkshopBundle(user.id, workshopBundleSchema.parse(JSON.parse(JSON.stringify(exported.bundle))));
  assert.ok(!("error" in imported));
  assert.equal(getPackDraft(imported.workshopId).draft.name, "The Sunken Coast");

  const empty = createWorkshop(user.id, { title: "Empty", description: "", targetParty: { size: 4, level: 3 } });
  assert.equal(exportWorkshopBundle(empty.id, { name: "E", blurb: "b", inspiredBy: "me" }).bundle.plugin, null);
});

test("deleting the workshop takes the draft with it", () => {
  const doomed = createWorkshop(user.id, { title: "Doomed", description: "", targetParty: { size: 4, level: 3 } });
  savePackDraft(doomed.id, fullDraft());
  deleteCampaign(doomed.id);
  assert.equal(hasPackDraft(doomed.id), false);
  assert.equal(deletePackDraft(workshop.id), true);
  assert.equal(deletePackDraft(workshop.id), false);
});

console.log(`\n${passed} world pack draft checks passed`);
removeTempDir(dir);
