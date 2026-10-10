// What a workshop copy keeps, checked against sources the copy code does not
// produce (docs/workshop-rulebook-audit-pr169.md F03, F05, F09, F13):
//
//   - "Start from" a saved homebrew entry of every kind, renamed, saved and
//     read back, keeps every field the first one had (F03).
//   - A renamed copy of mundane gear weighs what the catalog row says, and
//     a sheet carrying it weighs the same as one carrying the original (F09).
//   - Every trait, action, reaction and legendary action a pack monster row
//     prints, named from the raw row and not from parseMonster, is still on
//     a copy after save and reload, word for word (F05).
//   - The checker finds no rule deviation in the SRD's own spells and magic
//     items: a finding on a published entry would be a false one (F13).
//
// Rows come from the content route the picker calls, with the pack or, with
// no pack, the bundled book's rows the same route serves.
import assert from "node:assert/strict";
import "./lib/enforce-world.mjs";
import { call } from "./lib/enforce-campaign.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { hasPack, openWorld } from "./lib/enforce-world.mjs";

const { test, finish } = suite("test-workshop-start-from");
const { draftFromCatalog, draftFindings } = await import("../src/app/workshop/homebrew/draft.ts");
const { hydrateHomebrewGear } = await import("../src/lib/db/homebrew.ts");
const { lineWeightLb } = await import("../src/lib/srd/encumbrance.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { draftFromData, draftFromStats, draftToData } = await import("../src/lib/bestiary/monster-draft.ts");
const { bundledSpellRows, bundledItemRows } = await import("../src/lib/rulebook/catalog-rows.ts");
const { withMechanics } = await import("../src/lib/workshop/catalog-mechanics.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

const world = await openWorld();
const content = await world.route("content/[kind]");
const homebrew = await world.route("homebrew");

async function search(kind, q, extra = {}) {
  world.signIn(world.owner);
  const query = new URLSearchParams({ q, mechanics: "1", limit: "40", campaign: world.campaignId, ...extra });
  const out = await call(content, "GET", undefined, { kind }, `http://test/api/content/${kind}?${query}`);
  assert.equal(out.status, 200, JSON.stringify(out.json));
  return out.json.results;
}

async function published(kind, names, extra = {}) {
  for (const name of names) {
    const rows = (await search(kind, name, extra)).filter((row) => row.source !== "homebrew" && row.name.toLowerCase() === name.toLowerCase());
    const row = rows.find((entry) => entry.documentSlug === "wotc-srd") ?? rows[0];
    if (row) return row;
  }
  assert.fail(`the catalog has none of ${names.join(", ")} (${hasPack ? "pack" : "no pack"})`);
}

async function keep(kind, name, data) {
  world.signIn(world.owner);
  const out = await call(homebrew, "POST", { kind, name, data });
  assert.equal(out.status, 201, `${name}: ${JSON.stringify(out.json)}`);
  return out.json.entry;
}

// The rules an entry carries: its data less where it came from, with its own
// name written out of it (an item's weapon block carries the item's name).
function rules(entry) {
  const data = { ...entry.data };
  delete data.copiedFrom;
  return JSON.parse(JSON.stringify(data).split(entry.name).join("<name>"));
}

const KINDS = [
  { kind: "spell", route: "spells", names: ["Web"] },
  { kind: "item", route: "items", names: ["Flame Tongue"] },
  { kind: "feat", route: "feats", names: ["Sharpshooter", "Grappler"] },
  { kind: "background", route: "backgrounds", names: ["Acolyte"] },
  { kind: "race", route: "races", names: ["Hill Dwarf", "Dwarf (Hill)"] },
  { kind: "archetype", route: "archetypes", names: ["Champion"], extra: { class: "fighter" } },
  { kind: "hazard", route: "hazards", names: ["Poison Needle"] },
];

for (const { kind, route, names, extra = {} } of KINDS) {
  await test(`F03: "Start from" a saved homebrew ${kind} keeps every field the first copy kept, after save and reload.`, async () => {
    const source = await published(route, names, extra);
    const first = await keep(kind, `${source.name} One`, draftFromCatalog(kind, source, { classSlug: extra.class }).data);
    const [mine] = (await search(route, first.name, extra)).filter((row) => row.source === "homebrew" && row.name === first.name);
    assert.ok(mine, `the picker does not offer the saved ${first.name}`);
    const draft = draftFromCatalog(kind, mine, { classSlug: extra.class });
    assert.equal(draft.data.copiedFrom?.source, "homebrew", "the copy does not remember it came from homebrew");
    assert.equal(draft.data.copiedFrom?.name, first.name);
    const second = await keep(kind, `${source.name} Two`, draft.data);
    assert.deepEqual(rules(second), rules(first), `the second ${kind} lost or changed fields`);
  });
}

await test("F03: what a first copy keeps is the engine's: Flame Tongue's fire, Web's runs-as, a feat's runs-as, a subclass's levels.", async () => {
  const flame = draftFromCatalog("item", await published("items", ["Flame Tongue"]));
  assert.ok(flame.data.weaponRiders || flame.data.weapon || flame.data.effects?.length, "Flame Tongue's copy carries no mechanics");
  const web = draftFromCatalog("spell", await published("spells", ["Web"]));
  assert.equal(web.data.runsAs, "Web");
  assert.equal(web.data.concentration, true, "Web's copy lost its concentration");
  const champion = draftFromCatalog("archetype", await published("archetypes", ["Champion"], { class: "fighter" }), { classSlug: "fighter" });
  assert.ok(Object.keys(champion.data.levels ?? {}).length > 0, "the Champion's copy has no features by level");
});

// ---- weights ----

for (const [name, pounds] of [["Longsword", 3], ["Backpack", 5], ["Rations (1 day)", 2]]) {
  await test(`F09: a renamed copy of the ${name} weighs ${pounds} lb, and two of them weigh what two ${name}s do.`, async () => {
    const row = await published("items", [name]);
    const draft = draftFromCatalog("item", row);
    assert.equal(draft.data.weight, pounds, `the copy weighs ${draft.data.weight}`);
    const entry = await keep("item", `Pack ${name.replace(/[^a-z]/gi, "")} Copy`, draft.data);
    assert.equal(entry.data.weight, pounds, "the saved copy lost its weight");
    const [carried] = hydrateHomebrewGear(world.owner.id, [{ name: entry.name, qty: 2, slug: `homebrew:${entry.id}` }], { campaignId: world.campaignId });
    assert.equal(lineWeightLb(carried), lineWeightLb({ name, qty: 2 }), "the copy and the original weigh differently in a pack");
  });
}

// ---- monsters ----

const RAW_SECTIONS = { special_abilities: "traits", actions: "actions", reactions: "reactions", legendary_actions: "legendary" };
const words = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

await test("F05: every entry a pack monster row prints is on its copy after save and reload, under its section, word for word.", () => {
  if (!hasPack) return;
  const rows = getContentDb().prepare("SELECT name, cr, data_json FROM monsters WHERE document_slug = 'wotc-srd'").all();
  assert.ok(rows.length >= 300, `only ${rows.length} SRD monster rows`);
  const lost = [];
  for (const row of rows) {
    const raw = JSON.parse(row.data_json);
    const parsed = parseMonster(raw, Number(row.cr) || 0);
    const reloaded = draftFromData(`${row.name} Copy`, draftToData(draftFromStats(`${row.name} Copy`, parsed), ""));
    const printed = reloaded.stats.printed ?? { traits: [], actions: [], reactions: [], legendary: [] };
    for (const [field, section] of Object.entries(RAW_SECTIONS)) {
      for (const entry of Array.isArray(raw[field]) ? raw[field] : []) {
        const name = words(entry.name).slice(0, 80);
        const desc = words(entry.desc).slice(0, 4000);
        if (!name || !desc) continue;
        const kept = printed[section].find((ability) => ability.name === name);
        if (!kept || kept.desc !== desc) lost.push(`${row.name}: ${section} "${name}"${kept ? " (text changed)" : ""}`);
      }
    }
  }
  assert.deepEqual(lost, [], `${lost.length} printed entries lost:\n${lost.slice(0, 20).join("\n")}`);
});

await test("F05, F18: a Vampire copied into the bestiary keeps its weaknesses and its escape, names where it came from, and its rulebook page.", async () => {
  if (!hasPack) return;
  // The bestiary is the DM's: a table its owner runs as the human DM.
  const table = await openWorld({ gameSettings: { dmMode: "human" } });
  assert.equal(campaigns.setHumanDm(table.campaignId, table.owner.id), true);
  const bestiary = await table.route("campaigns/[campaignId]/dm/bestiary");
  const [vampire] = getContentDb().prepare("SELECT slug FROM monsters WHERE document_slug = 'wotc-srd' AND name = 'Vampire'").all();
  table.signIn(table.owner);
  const out = await call(bestiary, "POST", { from: "monster", slug: vampire.slug, name: "Count Varga" }, { campaignId: table.campaignId });
  assert.equal(out.status, 201, JSON.stringify(out.json));
  const printed = out.json.monster.draft.stats.printed;
  for (const name of ["Vampire Weaknesses", "Misty Escape", "Spider Climb"]) {
    assert.ok(printed.traits.some((ability) => ability.name === name), `the copy lost ${name}`);
  }
  assert.match(printed.traits.find((ability) => ability.name === "Vampire Weaknesses").desc, /running water/i);
  assert.equal(printed.source.name, "Vampire");
  assert.equal(printed.source.rulebook, "vampire");
});

// ---- the checker on the SRD's own ----

const FALSE_FINDING = /no rules for|not one of the 13 damage types|is not damage the table can roll|stop at \+3|beyond any \+3|above the strongest|largest pool|Strength requirement/;

await test("F13: the checker finds nothing wrong with any of the SRD's 319 spells copied as they are.", () => {
  const rows = hasPack
    ? withMechanics("spells", getContentDb().prepare("SELECT slug, name, level, school, data_json FROM spells WHERE document_slug = 'wotc-srd'").all().map((row) => ({ slug: row.slug, name: row.name, level: row.level, school: row.school, source: "open5e", documentSlug: "wotc-srd", data: JSON.parse(row.data_json) })))
    : withMechanics("spells", bundledSpellRows());
  assert.equal(rows.length, 319, `${rows.length} SRD spells`);
  const wrong = [];
  for (const row of rows) {
    const draft = draftFromCatalog("spell", row);
    for (const finding of draftFindings({ ...draft, name: `${row.name} Test` }, {})) {
      if (finding.level === "error" || (finding.level === "warn" && FALSE_FINDING.test(finding.text))) wrong.push(`${row.name}: ${finding.text}`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} false findings:\n${wrong.slice(0, 20).join("\n")}`);
});

await test("F13: the checker finds nothing wrong with any of the SRD's magic items copied as they are.", () => {
  const rows = hasPack
    ? withMechanics("items", getContentDb().prepare("SELECT slug, name, kind, rarity, data_json FROM items WHERE document_slug = 'wotc-srd' AND kind = 'magic_item'").all().map((row) => ({ slug: row.slug, name: row.name, kind: row.kind, rarity: row.rarity, source: "open5e", documentSlug: "wotc-srd", data: JSON.parse(row.data_json) })))
    : withMechanics("items", bundledItemRows());
  assert.ok(rows.length >= 200, `${rows.length} SRD magic items`);
  const wrong = [];
  for (const row of rows) {
    const draft = draftFromCatalog("item", row);
    for (const finding of draftFindings({ ...draft, name: `${row.name} Test` }, {})) {
      if (finding.level === "error" || (finding.level === "warn" && FALSE_FINDING.test(finding.text))) wrong.push(`${row.name}: ${finding.text}`);
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} false findings:\n${wrong.slice(0, 30).join("\n")}`);
});

world.close();
finish();
