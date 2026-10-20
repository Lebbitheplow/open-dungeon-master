// The forge's apply says exactly what was and was not applied (plan M5
// item 1, audit WF-08). Before, a forge preview whose names the world
// already had could not keep its links at all, a link whose end was not
// kept vanished without a word, and a refused entry was counted out but
// never named on screen. Now a links-only apply is a whole apply, and the
// report names every entry, link and name left out, with why. No model is
// called here: the forge's preview is written by hand.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-forge-apply-report");
const { forgeReport } = await import("../src/lib/worldforge/forge.ts");
const { worldView } = await import("../src/lib/db/world-forge.ts");
const { importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { createUser } = await import("../src/lib/db/users.ts");

const world = await openWorld();
const author = createUser(`forger${Date.now().toString(36)}`, "x", { isAdmin: true });
const workshop = createWorkshop(author.id, { title: "The Saltmarch" });
importWorldForge(workshop.id, { id: author.id, isAdmin: true }, JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8")));
const aiRoute = await world.route("campaigns/[campaignId]/world/ai");
const apply = async (body) => {
  world.signIn({ id: author.id });
  const response = await aiRoute.POST(new Request("http://test/", { method: "POST", body: JSON.stringify({ tool: "apply", stubs: [], ...body }) }), { params: Promise.resolve({ campaignId: workshop.id }) });
  return { status: response.status, json: await response.json() };
};
const ref = (name) => worldView(workshop.id).entities.find((entry) => entry.name === name)?.ref;
const linkCount = () => worldView(workshop.id).doc.links.length;
const text = (applied) => forgeReport(applied).lines.map((line) => line.text);

await test("Links alone, between entries the world already has, are applied and reported as such.", async () => {
  const before = { entries: worldView(workshop.id).entities.length, links: linkCount() };
  const { status, json } = await apply({
    entities: [],
    links: [
      { from: ref("Mira Fenn"), to: ref("Gullhaven"), label: "seeks" },
      { from: ref("Ivo Brannock"), to: ref("Mira Fenn"), label: "created" },
    ],
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.created, 0);
  assert.equal(json.links, 2);
  assert.equal(worldView(workshop.id).entities.length, before.entries);
  assert.equal(linkCount(), before.links + 2);
  assert.deepEqual(text(json), ["Added 2 links."]);
  assert.equal(forgeReport(json).partial, false);
});

await test("A partial apply names each entry, link and name it left out, with why.", async () => {
  const { json } = await apply({
    entities: [
      { key: "new:0", name: "Captain Orla Venn", typeId: "t_character", summary: "Master of the Gull's Wing." },
      { key: "new:1", name: "", typeId: "t_other", summary: "A thing with no name." },
    ],
    links: [
      { from: "new:0", to: ref("Ivo Brannock"), label: "allied with" },
      { from: "new:1", to: ref("Gullhaven"), label: "located in", fromName: "The Nameless" },
      { from: "new:0", to: "new:2", label: "rules", toName: "The Gull's Wing" },
      { from: ref("Mira Fenn"), to: ref("Gullhaven"), label: "seeks" },
      { from: "new:0", to: ref("Gullhaven"), label: "haunts" },
      { from: "new:0", to: "new:0", label: "loves" },
    ],
    stubs: ["The Gull's Wing", "The Gull's Wing"],
  });
  assert.equal(json.created, 1);
  assert.deepEqual(json.made.map((row) => row.name), ["Captain Orla Venn"]);
  assert.deepEqual(json.failed, [{ key: "new:1", name: "A nameless entry", error: "An entry needs a name." }]);
  assert.equal(json.links, 1);
  assert.deepEqual(
    json.linksLeft.map((link) => `${link.from} ${link.label} ${link.to}: ${link.why}`),
    [
      `A nameless entry located in Gullhaven: A nameless entry could not be added`,
      `Captain Orla Venn rules The Gull's Wing: The Gull's Wing was not added`,
      `Mira Fenn seeks Gullhaven: the world has it already`,
      `Captain Orla Venn haunts Gullhaven: “haunts” is not a link WorldForge uses`,
      `Captain Orla Venn loves Captain Orla Venn: it links an entry to itself`,
    ],
  );
  assert.equal(json.stubs, 1);
  assert.deepEqual(json.stubsLeft, [{ name: "The Gull's Wing", why: "already in To write" }]);
  const report = forgeReport(json);
  assert.equal(report.partial, true);
  assert.deepEqual(
    report.lines.map((line) => [line.left, line.text.split(":")[0]]),
    [[false, "Added 1 entry and 1 link, and kept 1 name to write."], [false, "New"], [true, "Not added"], [true, "Links not added"], [true, "Names not kept to write"]],
  );
  assert.equal(report.lines[2].text, "Not added: A nameless entry (An entry needs a name).");
});

await test("An apply that adds nothing says so, rather than claiming success.", async () => {
  const { json } = await apply({ entities: [], links: [{ from: ref("Mira Fenn"), to: ref("Gullhaven"), label: "seeks" }] });
  assert.equal(json.links, 0);
  assert.deepEqual(text(json), ["Nothing was added.", "Links not added: Mira Fenn seeks Gullhaven (the world has it already)."]);
});

await test("The forge's page sends every ticked link with its names, and keeps a links-only preview.", () => {
  const view = fs.readFileSync(new URL("../src/app/workshop/world/ForgeView.tsx", import.meta.url), "utf8");
  assert.match(view, /links\.filter\(\(link\) => link\.keep\)\.map\(\(link\) => \(\{ \.\.\.link, fromName: nameOf\(link\.from\), toName: nameOf\(link\.to\) \}\)\)/, "the page still drops links to rows it did not keep");
  assert.match(view, /disabled=\{busy \|\| !\(rows\.some\(\(row\) => row\.keep && !row\.existing\) \|\| links\.some\(\(link\) => link\.keep\)\)\}/, "a links-only preview cannot be kept");
  assert.ok(view.includes("forgeReport("), "the page does not show the full report");
});

world.close();
finish();
