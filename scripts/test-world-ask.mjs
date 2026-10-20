// WorldForge's Ask (audit finding WF-15, M5 item 2 of the WorldForge plan):
// Ask reads passages, found the way search_lore finds them in play, and the
// answer's sources are the passages it cites. The world here is the
// Saltmarch with a long Gullhaven article whose last paragraph holds the
// fact about the harbour bell, a lore entry about lamp oil that no question
// names, and enough other writing about the sea wall that not every match
// fits. A stand-in model answers the way a model told to cite would: it
// reads the numbered passages it was given and cites the one that says what
// it states, plus a number nobody was given.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-ask");
const { askPassages, askMessages, citedPassages, passageLabel, ASK_PASSAGES } = await import("../src/lib/worldforge/ask.ts");
const { askTheWorld } = await import("../src/lib/dm/world-ai.ts");
const { importWorldForge } = await import("../src/lib/db/world-forge-io.ts");
const { worldView, createWorldEntity, updateWorldEntity } = await import("../src/lib/db/world-forge.ts");
const { mentionSegments } = await import("../src/lib/worldforge/text.ts");
const { createWorkshop } = await import("../src/lib/db/workshops.ts");
const { getCampaignById, updateStorySettings } = await import("../src/lib/db/campaigns.ts");
const { getDatabase } = await import("../src/lib/db/core.ts");
const { createUser } = await import("../src/lib/db/users.ts");

const BELL = "The harbour bell of Gullhaven was cast from the melted anchors of the first Saltcoat fleet, and it rings only for drowned wardens.";
const OIL = "Every lamp along the wall burns oil the Kelpwrights of Low Stair render from bladder kelp each autumn, and no other oil will hold its flame in the salt wind.";

// The stand-in: finds the numbered passage that holds what it will state.
const requests = [];
const passageWith = (content, words) => {
  for (const block of content.split("\n\n")) {
    const number = /(?:^|\n)\[(\d+)\] /.exec(block);
    if (number && block.includes(words)) return number[1];
  }
  return "";
};
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    const sent = String(body.messages?.at(-1)?.content ?? "");
    const bell = passageWith(sent, "melted anchors");
    const oil = passageWith(sent, "bladder kelp");
    const content = sent.includes("# The question\nWhat was the harbour bell")
      ? bell
        ? `It was cast from the melted anchors of the first Saltcoat fleet [${bell}], and rings only for drowned wardens [${bell}][99].`
        : "The world does not say."
      : sent.includes("# The question\nWhere does the oil")
        ? oil
          ? `The Kelpwrights of Low Stair render it from bladder kelp each autumn [${oil}].`
          : "The world does not say."
        : "The world does not say what the moon is made of.";
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;

await openWorld();
const db = getDatabase();
const admin = createUser(`asker${Date.now().toString(36)}`, "x", { isAdmin: true });
const workshop = createWorkshop(admin.id, { title: "The Saltmarch" });
importWorldForge(workshop.id, { id: admin.id, isAdmin: true }, JSON.parse(fs.readFileSync(new URL("./fixtures/worldforge-saltmarch.json", import.meta.url), "utf8")));
updateStorySettings(workshop.id, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake", utilityModel: "" });
const campaign = () => getCampaignById(workshop.id);
const entity = (name) => worldView(workshop.id).entities.find((entry) => entry.name === name);
const loreType = worldView(workshop.id).doc.types.find((type) => type.shelf === "lore");

// Gullhaven's article: sixty paragraphs about the harbour, then the bell.
const HARBOUR = ["nets", "tar", "gulls", "kelp sheds", "fish market", "ropewalk", "tide stairs", "breakwater", "customs house", "net menders"];
const paragraphs = Array.from({ length: 60 }, (_, at) => `In the ${at + 1}${at ? "th" : "st"} street of the harbour at Gullhaven the ${HARBOUR[at % HARBOUR.length]} crowd the quay, and the townsfolk trade gossip about the weather, the catch, the toll and the price of salt while the boats come in on the evening tide past the old stones of the sea wall.`);
const article = [...paragraphs, BELL].join("\n\n");
updateWorldEntity(workshop.id, entity("Gullhaven").ref, { article });
// The lamp-oil entry no question names, and twenty more entries about the
// sea wall and its lamps that do not say where the oil comes from.
createWorldEntity(workshop.id, { typeId: loreType.id, name: "The Kelpwright Compact", text: `An old bargain between the town and the kelp gatherers.\n\n${OIL}` });
for (let at = 1; at <= 20; at += 1) {
  createWorldEntity(workshop.id, {
    typeId: loreType.id,
    name: `Wall Lore ${at}`,
    text: `The sea wall's ${at}th tower keeps its lamps trimmed at dusk by the wardens.\n\nStorms come over the sea wall in the ${at}th month, and the lamps on the wall are lit early.`,
  });
}
// What lives beside the World and is not the World: a private note a
// player wrote and a tracked fact. Ask is the World's, so neither is read.
db.prepare(
  `INSERT INTO campaign_notes (id, campaign_id, character_id, author_user_id, author_kind, visibility, status, pinned, title, body, seq, created_at, updated_at)
   VALUES ('note-ask', ?, NULL, ?, 'user', 'private', 'active', 0, 'Lamp oil', 'PRIVATE-NOTE the oil for the lamps on the sea wall comes from my uncle', 0, '2026-10-19', '2026-10-19')`,
).run(workshop.id, admin.id);
db.prepare(
  `INSERT INTO world_facts (id, campaign_id, category, subject, fact, known_by, witnessed_by, pinned, status, source, source_seq, created_at, updated_at)
   VALUES ('fact-ask', ?, 'lore', 'lamp oil', 'TRACKED-FACT the oil for the lamps on the sea wall is whale oil', '"all"', '[]', 0, 'active', 'manual', NULL, '2026-10-19', '2026-10-19')`,
).run(workshop.id);

const view = () => worldView(workshop.id);
const named = () => view().entities.map((entry) => ({ ref: entry.ref, name: entry.name, aliases: entry.aliases }));

await test("A fact at the end of a long article is found: the last of its passages is read, cited and shown.", async () => {
  assert.ok(article.indexOf(BELL) > 15_000, "the fact is not near the end of a long article");
  const question = "What was the harbour bell cast from?";
  const result = await askTheWorld(campaign(), question);
  assert.ok(result.answer, result.error);
  const sent = requests.at(-1).messages.at(-1).content;
  assert.ok(sent.includes("melted anchors"), "the passage with the fact was not read");
  assert.equal(result.sources.length, 1, "a source the answer did not cite, or the made-up [99], was shown");
  const [source] = result.sources;
  assert.equal(source.ref, entity("Gullhaven").ref);
  assert.equal(source.part, "article");
  assert.equal(source.at, source.of, "the cited passage is not the article's last");
  assert.ok(source.of > 30, "the long article was not cut into passages");
  assert.ok(source.text.includes("melted anchors of the first Saltcoat fleet"), "the shown passage does not support the answer");
  assert.equal(source.canon, "canon");
  assert.ok(result.refs.includes(entity("Gullhaven").ref));
  // Read but not cited: shown as read, never as a source.
  assert.ok(result.read.length > result.sources.length);
  assert.ok(result.read.every((passage) => passage.text.length <= 400));
});

await test("A topic question that names no entry finds the passage about its topic, and only that passage is the source.", async () => {
  const question = "Where does the oil for the lamps on the sea wall come from?";
  assert.equal(mentionSegments(question, named()).filter((segment) => segment.ref).length, 0, "the question names an entry");
  const result = await askTheWorld(campaign(), question);
  assert.ok(result.answer, result.error);
  assert.match(result.answer, /bladder kelp each autumn \[\d+\]/);
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].ref, entity("The Kelpwright Compact").ref);
  assert.equal(result.sources[0].name, "The Kelpwright Compact");
  assert.ok(result.sources[0].text.includes("render from bladder kelp"), "the shown passage does not support the answer");
  // The best match is the first passage the search ranked, ahead of twenty
  // entries about the wall's lamps.
  const ranked = askPassages(view().doc, view().entities, question, "english");
  assert.ok(ranked.passages.find((passage) => passage.text.includes("bladder kelp")).matched);
});

await test("Matches that do not fit are counted and named, and the model is told so.", async () => {
  const question = "Where does the oil for the lamps on the sea wall come from?";
  const result = await askTheWorld(campaign(), question);
  assert.ok(result.read.length <= ASK_PASSAGES);
  assert.ok(result.omitted.count > 0, "everything fitted: the check proves nothing");
  assert.ok(result.omitted.names.length > 0 && result.omitted.names.length <= 6);
  assert.ok(result.omitted.names.every((name) => view().entities.some((entry) => entry.name === name)));
  const sent = requests.at(-1).messages.at(-1).content;
  assert.match(sent, /\(\d+ more matching passages were left out for space, from [^)]+\.\)/);
  // A tighter budget leaves more out, and still reads the best match.
  const tight = askPassages(view().doc, view().entities, question, "english", 1_500, 30);
  assert.ok(tight.omitted.count > result.omitted.count);
  assert.ok(tight.passages.some((passage) => passage.text.includes("bladder kelp")), "the best match was left out first");
});

await test("Ask reads only the World: a player's private note and a tracked fact on the same topic are not sent.", async () => {
  await askTheWorld(campaign(), "Where does the oil for the lamps on the sea wall come from?");
  const sent = JSON.stringify(requests.at(-1).messages);
  assert.ok(!sent.includes("PRIVATE-NOTE"), "a player's private note was sent to the model");
  assert.ok(!sent.includes("TRACKED-FACT"), "a tracked fact was sent with the World");
});

await test("Each passage keeps its canon state: tagged in the prompt, a retired match read after the rest, DM-only lines marked.", () => {
  const { doc, entities } = view();
  const lantern = entities.find((entry) => entry.name === "The Grey Lantern");
  updateWorldEntity(workshop.id, entity("Wall Lore 3").ref, { canon: "retired" });
  updateWorldEntity(workshop.id, entity("Wall Lore 4").ref, { canon: "draft" });
  const after = view();
  const retrieval = askPassages(after.doc, after.entities, "Which lamps on the sea wall are lit early, and is there a lantern?", "english", 100_000, 500);
  const of = (name) => retrieval.passages.filter((passage) => passage.name === name);
  assert.ok(of("Wall Lore 3").length, "Ask stopped reading a retired entry");
  assert.ok(of("Wall Lore 3").every((passage) => passage.canon === "retired"));
  assert.ok(of("Wall Lore 4").every((passage) => passage.canon === "draft" && passageLabel(passage).includes("[draft]")));
  assert.equal(lantern.entry.canon, "alternate");
  assert.ok(of("The Grey Lantern").every((passage) => passage.canon === "alternate"));
  // A retired match is read after every other match: with room for all it
  // is read, with room for some it is the one left out.
  const roomy = askPassages(after.doc, after.entities, "lamps sea wall", "english", 100_000, 500);
  assert.ok(roomy.passages.some((passage) => passage.canon === "retired" && passage.matched));
  const tight = askPassages(after.doc, after.entities, "lamps sea wall", "english", 2_000, 500);
  assert.ok(tight.omitted.count > 0);
  assert.ok(tight.passages.every((passage) => passage.canon !== "retired"), "a retired match took room before a settled one");
  assert.ok(tight.omitted.names.includes("Wall Lore 3") || tight.omitted.others > 0);
  const messages = askMessages(retrieval, "q", "The Saltmarch");
  assert.match(messages[1].content, /^WorldForge marks what is not canon: \[draft\][^\n]*\[alternate\][^\n]*\[retired\] no longer true in this world\./);
  assert.match(messages[0].content, /tagged \[draft\], \[alternate\] or \[retired\] is not this world's canon/);
  assert.match(messages[0].content, /cite the passages it rests on by their numbers/);
  // The DM's own lines are marked as theirs.
  const leak = askPassages(doc, entities, "Who sold the sluice codes?", "english");
  const hidden = leak.passages.find((passage) => passage.part === "hidden" && passage.name === "Ivo Brannock");
  assert.ok(hidden && hidden.dmOnly && passageLabel(hidden).endsWith("hidden truth, DM only"));
  const secret = leak.passages.find((passage) => passage.part === "secret");
  assert.ok(secret && secret.dmOnly && secret.ref === entity("Ivo Brannock").ref);
  updateWorldEntity(workshop.id, entity("Wall Lore 3").ref, { canon: "canon" });
  updateWorldEntity(workshop.id, entity("Wall Lore 4").ref, { canon: "canon" });
});

await test("A question nothing matches still reads the world's cards, none counted as a match; citations are read strictly.", async () => {
  const { doc, entities } = view();
  const none = askPassages(doc, entities, "What is the moon made of?", "english");
  assert.ok(none.passages.length > 0);
  assert.ok(none.passages.every((passage) => !passage.matched && passage.part === "facts"));
  assert.equal(none.omitted.count, 0);
  const result = await askTheWorld(campaign(), "What is the moon made of?");
  assert.deepEqual(result.sources, []);
  const passages = none.passages;
  assert.deepEqual(citedPassages("See [2, 1] and [1][2] and [0] and [x].", passages).map((passage) => passage.n), [2, 1]);
});

server.close();
finish();
