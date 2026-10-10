// WorldForge's AI tools in the workshop (src/lib/dm/world-ai.ts), against a
// stand-in model that answers the way models do: JSON in a code fence with
// a sentence before it and a raw line break inside a string, a type the
// world does not have, a link word WorldForge does not use, a name the
// world already has. The forge resolves generously and stores strictly,
// only adds, and writes nothing until the DM keeps it; ask answers from the
// world with the DM's own lines; draft is told the hidden truth but never
// to state it; a model that fails is an error, never a crash.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-workshop-worldforge-ai");
const { replyJson, readForgeReply, paintPrompt, worldDigest } = await import("../src/lib/worldforge/forge.ts");
const { forgeFromNotes, askTheWorld, draftEntry } = await import("../src/lib/dm/world-ai.ts");
const { applyForge, importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView } = await import("../src/lib/db/world-forge.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getCampaignById, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");

const FORGE_REPLY = [
  "Here is what I found:",
  "```json",
  JSON.stringify({
    entities: [
      { name: "Captain Orla Venn", type: "character", summary: "Master of the Gull's Wing. She runs salt past the wall.", aliases: ["Orla"], hiddenTruth: "She pays Ivo for the codes." },
      { name: "The Gull's Wing", type: "Ship", summary: "A narrow smuggling sloop.\nFast in the fen channels." },
      { name: "Gullhaven", type: "Location", summary: "A harbour town." },
    ],
    links: [
      { from: "Captain Orla Venn", to: "Ivo Brannock", label: "allied with" },
      { from: "Orla", to: "The Gull's Wing", label: "rules" },
      { from: "Captain Orla Venn", to: "Mira Fenn", label: "hates" },
      { from: "Captain Orla Venn", to: "Nobody Known", label: "friend of" },
    ],
  }).replace('sloop.\\nFast', "sloop.\nFast"),
  "```",
].join("\n");

const requests = [];
let failing = false;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    if (failing) {
      res.writeHead(500).end("down");
      return;
    }
    const system = String(body.messages?.[0]?.content ?? "");
    const content = system.includes("deserves an encyclopedia entry")
      ? FORGE_REPLY
      : system.includes("You keep the lore")
        ? "Ivo Brannock sold the sluice codes; Mira Fenn suspects nothing yet."
        : "The Tidemother is said to keep the drowned. Her lamps burn on the wall.";
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    }
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

await openWorld();
const db = getDatabase();
// An admin's workshop keeps its own model address; anyone else's follows the
// server's, which here would be no model at all.
const admin = createUser(`forger${Date.now().toString(36)}`, "x", { isAdmin: true });
const workshop = createWorkshop(admin.id, { title: "The Saltmarch" });
importWorldForge(workshop.id, { id: admin.id, isAdmin: true }, JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8")));
updateStorySettings(workshop.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake", utilityModel: "" });
const campaign = () => getCampaignById(workshop.id);
const entity = (name) => worldView(workshop.id).entities.find((entry) => entry.name === name);

await test("A reply's JSON is found past a fence and a preamble, its raw line breaks escaped.", () => {
  const parsed = replyJson(FORGE_REPLY);
  assert.equal(parsed.entities.length, 3);
  assert.match(parsed.entities[1].summary, /sloop\.\nFast/);
  assert.equal(replyJson("no json here"), null);
});

let preview;
await test("The forge previews, coerced: an unknown type falls to Other, an unknown link word and a link to nobody are dropped, a known name is shown as there.", async () => {
  const before = worldView(workshop.id).entities.length;
  const result = await forgeFromNotes(campaign(), "Orla runs salt past the wall in the Gull's Wing.", "");
  assert.ok(result.preview, result.error);
  preview = result.preview;
  const byName = (name) => preview.entities.find((row) => row.name === name);
  assert.equal(byName("Captain Orla Venn").typeId, "t_character");
  assert.equal(byName("The Gull's Wing").typeId, "t_other");
  assert.equal(byName("Gullhaven").existing, entity("Gullhaven").ref);
  assert.deepEqual(preview.links.map((link) => link.label).sort(), ["allied with", "rules"]);
  assert.equal(preview.links.find((link) => link.label === "allied with").to, entity("Ivo Brannock").ref);
  assert.equal(worldView(workshop.id).entities.length, before, "the preview wrote something");
});

await test("Keeping the ticked rows makes the entries on their shelves, the links, and names to write; what exists is not rewritten.", () => {
  const orla = preview.entities.find((row) => row.name === "Captain Orla Venn");
  const ship = preview.entities.find((row) => row.name === "The Gull's Wing");
  const result = applyForge(workshop.id, { entities: [orla], links: preview.links, stubs: [ship.name] });
  assert.equal(result.created, 1);
  const made = entity("Captain Orla Venn");
  assert.equal(made.shelf, "npc");
  assert.equal(made.tagline, "Master of the Gull's Wing.");
  assert.match(made.entry.article, /runs salt past the wall/);
  assert.equal(made.entry.hiddenTruth, "She pays Ivo for the codes.");
  assert.deepEqual(made.aliases, ["Orla"]);
  const { doc } = worldView(workshop.id);
  assert.ok(doc.links.some((link) => link.from === made.ref && link.to === entity("Ivo Brannock").ref && link.label === "allied with"));
  assert.equal(result.links, 1, "a link to a row that was not kept was written");
  assert.ok(doc.stubs.some((stub) => stub.name === "The Gull's Wing"));
  assert.equal(entity("Gullhaven").text.startsWith("A fishing town"), true, "an existing place was rewritten");
});

await test("Ask answers from the world, hidden truths marked as the DM's, and names the entries it uses.", async () => {
  const result = await askTheWorld(campaign(), "Who sold the codes?");
  assert.ok(result.answer, result.error);
  assert.deepEqual(result.refs.sort(), [entity("Ivo Brannock").ref, entity("Mira Fenn").ref].sort());
  const sent = requests.at(-1).messages.at(-1).content;
  assert.match(sent, /DM only: Ivo sold the sluice codes/);
  assert.match(sent, /# The question\nWho sold the codes\?/);
});

await test("Draft writes from what is known, told the hidden truth but never to state it; nothing is saved.", async () => {
  const result = await draftEntry(campaign(), entity("Ivo Brannock").ref, "short");
  assert.match(result.text, /Tidemother/);
  const sent = requests.at(-1).messages;
  assert.match(sent[0].content, /must never be stated/);
  assert.match(sent[1].content, /Hidden truth \(never state it\): Ivo sold the sluice codes/);
  assert.doesNotMatch(sent[1].content, /fears Mira/, "a hidden link was handed to the draft");
  assert.equal(entity("Ivo Brannock").entry.article, "Keeper of the sea wall at Gullhaven, patient as the tide.");
});

await test("A model that fails is an error to show, never a crash, and writes nothing.", async () => {
  failing = true;
  const before = JSON.stringify(worldView(workshop.id));
  const result = await forgeFromNotes(campaign(), "Anything.", "");
  failing = false;
  assert.ok(result.error);
  assert.equal(JSON.stringify(worldView(workshop.id)), before);
});

await test("The digest keeps to its budget, the asked entries first; paint prompts leave names out.", () => {
  const { doc, entities } = worldView(workshop.id);
  const digest = worldDigest(doc, entities, "Tell me about Mira Fenn", 600);
  assert.ok(digest.length <= 700);
  assert.ok(digest.startsWith("## Mira Fenn"));
  const prompt = paintPrompt("faction", "Faction", "A guild of salt-runners.", "oil painting");
  assert.match(prompt, /Heraldic sigil/);
  assert.doesNotMatch(paintPrompt("npc", "Character", "A warden.", ""), /Ivo/);
});

server.close();
db.prepare("SELECT 1").get();
finish();
