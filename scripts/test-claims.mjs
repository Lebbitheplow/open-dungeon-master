// The claims reader (src/lib/dm/claims-logic.ts, src/lib/dm/claims.ts): which
// claims a moment of a turn is asked for, and how a reply is held to the
// narration and the engine's refs before any claim acts. An invented claim
// never acts; a reader that fails or answers nonsense fails open, loudly
// (logged, without the text), and a moment with nothing to ask makes no call.
import assert from "node:assert/strict";
import http from "node:http";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel } from "./lib/enforce-narrator.mjs";
import { READER_PROMPT_START } from "./lib/claims-reader.mjs";

const { test, finish } = suite("test-claims");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });

const { checkClaims, claimKindsFor, namedSpeakers, parseReaderReply, readerSystem, renderReaderInput } = await import(
  "../src/lib/dm/claims-logic.ts"
);
const { leveledSpellNames, readClaims } = await import("../src/lib/dm/claims.ts");
const { guardOutcomes, normalizeSpellName } = await import("../src/lib/dm/engine-boundary.ts");
const campaigns = await import("../src/lib/db/campaigns.ts");

const mira = world.addHero({ name: "Mira", class: "wizard", level: 5, abilities: { int: 16 }, proficiencies: TRAINED });

const GATE = {
  guard: true,
  attacks: false,
  creatures: false,
  numbers: false,
  party: false,
  rollAsk: false,
  fightStart: false,
  unrolled: false,
  speech: false,
};

// ---- the gate ----

await test("Only the kinds engine state can rule on are asked, and nothing is asked when nothing can be.", () => {
  assert.deepEqual(claimKindsFor(GATE), []);
  assert.deepEqual(claimKindsFor({ ...GATE, attacks: true }), ["hit", "miss"]);
  assert.deepEqual(claimKindsFor({ ...GATE, creatures: true, numbers: true }), ["dies", "downed", "amount"]);
  assert.deepEqual(claimKindsFor({ ...GATE, party: true, rollAsk: true, fightStart: true }), ["cast", "fight_start", "roll_ask"]);
  // With the guard off, only what the turn loop acts on itself is asked.
  assert.deepEqual(
    claimKindsFor({ ...GATE, guard: false, attacks: true, creatures: true, numbers: true, party: true }),
    [],
  );
  assert.deepEqual(claimKindsFor({ ...GATE, guard: false, unrolled: true, fightStart: true }), ["amount", "fight_start"]);
  // Who speaks a quoted line is asked whether or not the guard is on.
  assert.deepEqual(claimKindsFor({ ...GATE, guard: false, speech: true }), ["speaker"]);
});

await test("The request lists the kinds, the refs and the narration; the instructions name every skill id.", () => {
  const input = renderReaderInput(
    ["hit", "roll_ask"],
    { creatures: [{ ref: "goblin", display: "Goblin 1" }], party: [{ ref: "c1", name: "Kara" }], speakers: [{ ref: "n1", name: "Marla" }] },
    "Kara colpisce il goblin.",
  );
  assert.doesNotMatch(input, /Speaker refs/, "speakers are listed only when asked");
  assert.match(
    renderReaderInput(["speaker"], { creatures: [], party: [], speakers: [{ ref: "n1", name: "Marla Venn", aliases: ["il Capitano"] }, { ref: "c1", name: "Kara" }] }, "«Basta», dice il Capitano."),
    /^Speaker refs: "n1" for Marla Venn \(also: il Capitano\), "c1" for Kara$/m,
    "each speaker's other names are listed, so a line tagged by one finds them",
  );
  assert.match(input, /^Ask: hit, roll_ask$/m);
  assert.match(input, /"goblin" for Goblin 1/);
  assert.match(input, /"c1" for Kara/);
  assert.match(input, /<<<\nKara colpisce il goblin\.\n>>>/);
  assert.match(readerSystem(["perception", "sleight_of_hand"], false), /SKILL is one of: perception, sleight_of_hand\./);
  // Who speaks is in the instructions only when it is asked, so every other
  // read sends what it did before.
  assert.doesNotMatch(readerSystem([], false), /speaker|SPEAKER_REF/);
  assert.match(readerSystem([], true), /"kind":"speaker"/);
  assert.match(readerSystem([], true), /target, caster, character and ref are a ref/);
  // Asked beside the other kinds, the reader is told to answer for every
  // line; asked alone, it is not.
  assert.match(readerSystem([], true, true), /a speaker claim for every quoted line/);
  assert.equal(readerSystem([], true, false), readerSystem([], true));
  assert.doesNotMatch(readerSystem([], false, true), /speaker/);
  // The fake models answer the reader by how its instructions open.
  assert.ok(readerSystem([], false).startsWith(READER_PROMPT_START));
  assert.ok(readerSystem([], true).startsWith(READER_PROMPT_START));
});

// ---- the checks ----

const context = (text, kinds) => ({
  kinds,
  text,
  attackRefs: new Set(["goblin"]),
  creatureRefs: new Set(["goblin", "ogre"]),
  party: new Map([[mira.id, "Mira"]]),
  leveledSpells: leveledSpellNames(),
  normalizeSpell: normalizeSpellName,
  skills: new Set(["perception", "stealth"]),
  speakers: namedSpeakers(
    text,
    new Map([
      ["n1", { kind: "npc", id: "n1", name: "Marla Venn" }],
      ["n2", { kind: "npc", id: "n2", name: "Old Pike" }],
      [mira.id, { kind: "pc", id: mira.id, name: "Mira" }],
    ]),
  ),
});
const ALL = ["hit", "miss", "dies", "downed", "amount", "cast", "fight_start", "roll_ask", "speaker"];

await test("A claim quoting words the narration does not hold never acts; a quote with other quote marks or spacing does.", () => {
  const text = "La lama di Mira colpisce il goblin. «Morirai», sibila.";
  assert.deepEqual(checkClaims([{ kind: "hit", target: "goblin", quote: "Mira kills the goblin" }], context(text, ALL)), []);
  assert.equal(checkClaims([{ kind: "hit", target: "goblin", quote: "colpisce   il GOBLIN" }], context(text, ALL)).length, 1);
  assert.equal(checkClaims([{ kind: "fight_start", quote: '"Morirai", sibila' }], context(text, ALL)).length, 1);
});

await test("A claim of a kind not asked, about a creature the engine does not know, or by someone outside the party never acts.", () => {
  const text = "The ogre falls. The dragon dies. Mira casts Fireball. Vex casts Fireball.";
  const ctx = context(text, ["dies", "cast"]);
  assert.deepEqual(checkClaims([{ kind: "hit", target: "goblin", quote: "The ogre falls." }], ctx), [], "hit was not asked");
  assert.deepEqual(checkClaims([{ kind: "dies", target: "dragon", quote: "The dragon dies." }], ctx), [], "no dragon in this turn");
  assert.deepEqual(checkClaims([{ kind: "dies", target: "ogre", quote: "The ogre falls." }], ctx).length, 1);
  assert.deepEqual(checkClaims([{ kind: "cast", caster: "vex", spell: "Fireball", quote: "Vex casts Fireball." }], ctx), [], "an enemy caster");
  const [fireball] = checkClaims([{ kind: "cast", caster: mira.id, spell: "Fireball (3rd level)", quote: "Mira casts Fireball." }], ctx);
  assert.deepEqual(fireball, { kind: "cast", caster: "Mira", spell: "fireball", quote: "Mira casts Fireball." });
});

await test("A cantrip cast, an unknown skill or a save with no ability is dropped; a malformed claim drops alone.", () => {
  const text = "Mira casts Fire Bolt. Everyone, roll Perception. Make a save!";
  const ctx = context(text, ALL);
  assert.deepEqual(checkClaims([{ kind: "cast", caster: mira.id, spell: "Fire Bolt", quote: "Mira casts Fire Bolt." }], ctx), []);
  assert.deepEqual(checkClaims([{ kind: "roll_ask", character: "all", check: "skill", skill: "percezione", quote: "roll Perception" }], ctx), []);
  assert.deepEqual(checkClaims([{ kind: "roll_ask", character: "all", check: "save", quote: "Make a save!" }], ctx), []);
  assert.deepEqual(checkClaims([{ kind: "roll_ask", character: "all", check: "save", ability: "wisdom", quote: "Make a save!" }], ctx), []);
  const kept = checkClaims(
    [
      { kind: "amount", value: "eight", of: "damage", quote: "Make a save!" },
      { kind: "teleport", quote: "Make a save!" },
      { kind: "roll_ask", character: "all", check: "skill", skill: "perception", quote: "roll Perception" },
    ],
    ctx,
  );
  assert.deepEqual(kept, [{ kind: "roll_ask", character: "all", check: "skill", skill: "perception", quote: "roll Perception" }]);
});

await test("A speaker claim acts only on a quoted line, a known ref, and a person the prose itself names.", () => {
  const text = "Marla alza lo sguardo. «Sei tornato», dice. Una figura incappucciata sussurra: «Non fidarti di lei.»";
  const ctx = context(text, ALL);
  assert.deepEqual(checkClaims([{ kind: "speaker", ref: "n1", quote: "Sei tornato" }], ctx), [
    { kind: "speaker", line: "Sei tornato", speaker: { kind: "npc", id: "n1", name: "Marla Venn" } },
  ], "a single word of the name, written as a name, names her; the line is stored whole");
  assert.deepEqual(checkClaims([{ kind: "speaker", ref: "n1", quote: "«Sei tornato»" }], ctx), [
    { kind: "speaker", line: "Sei tornato", speaker: { kind: "npc", id: "n1", name: "Marla Venn" } },
  ], "a quote copied with the line's own marks is that line");
  assert.deepEqual(
    checkClaims([{ kind: "speaker", ref: "n1", quote: "«Sei tornato», dice. Una figura incappucciata sussurra: «Non fidarti di lei.»" }], ctx),
    [],
    "a quote spanning two lines is neither",
  );
  assert.deepEqual(checkClaims([{ kind: "speaker", ref: "n1", quote: "Marla alza lo sguardo" }], ctx), [], "not a quoted line");
  assert.deepEqual(checkClaims([{ kind: "speaker", ref: "n9", quote: "Sei tornato" }], ctx), [], "an unknown ref");
  assert.deepEqual(checkClaims([{ kind: "speaker", ref: "n2", quote: "Non fidarti di lei." }], ctx), [], "the hooded figure is not named Pike anywhere");
  assert.deepEqual(
    checkClaims([{ kind: "speaker", ref: "n2", quote: "Fermi!" }], context("Pike grida «Fermi!» e la pike cade.", ALL)).length,
    1,
  );
  assert.deepEqual(
    checkClaims([{ kind: "speaker", ref: "n2", quote: "Fermi!" }], context("La pike cade. «Fermi!»", ALL)),
    [],
    "a word of a name only names someone written as a name",
  );
  assert.deepEqual(checkClaims([{ kind: "speaker", ref: "n1", quote: "Sei tornato" }], context(text, ["hit"])), [], "not asked");
});

await test("A reply is read once at the boundary: fences and stray prose are tolerated, anything else is unreadable.", () => {
  assert.deepEqual(parseReaderReply('```json\n{"claims":[{"kind":"fight_start","quote":"x"}]}\n```'), [{ kind: "fight_start", quote: "x" }]);
  assert.deepEqual(parseReaderReply('Here you go: {"claims":[]} hope it helps'), []);
  assert.equal(parseReaderReply("no claims at all"), null);
  assert.equal(parseReaderReply('{"claim":[]}'), null);
  assert.equal(parseReaderReply("{not json}"), null);
});

// ---- the rim ----

const outcomes = guardOutcomes([], null);
const read = (kinds, text = "Mira strides in.") =>
  readClaims(world.campaign(), { label: "turn test", text, kinds, outcomes, sheets: world.sheets() });

// Every console.error line while `fn` runs.
async function errorsDuring(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...parts) => lines.push(parts.join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

await test("Nothing to ask, or no text, makes no call.", async () => {
  const model = await fakeModel();
  model.pointAt(world);
  assert.deepEqual(await read([]), []);
  assert.deepEqual(await read(["fight_start"], "   "), []);
  assert.equal(model.readerRequests.length, 0);
  model.claims([[{ kind: "fight_start", quote: "Roll initiative!" }]]);
  assert.deepEqual(await read(["fight_start"], "Roll initiative!"), [{ kind: "fight_start", quote: "Roll initiative!" }]);
  assert.equal(model.readerRequests.length, 1);
  model.close();
});

await test("A reader that fails or answers nonsense counts as claiming nothing, and says so in the log without the text.", async () => {
  // An answer that is no JSON at all.
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "I would rather not." } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pointAt = (baseUrl) =>
    campaigns.updateStorySettings(world.campaignId, { textProvider: "custom", customBaseUrl: baseUrl, customModel: "fake" });
  pointAt(`http://127.0.0.1:${server.address().port}/v1`);
  const secret = "Mira whispers the secret name of the Lich Queen.";
  const unreadable = await errorsDuring(() => read(["fight_start"], secret));
  assert.deepEqual(unreadable.result, []);
  assert.ok(unreadable.lines.some((line) => line.includes("[claims] turn test") && line.includes("unreadable")), unreadable.lines.join("\n"));
  assert.ok(!unreadable.lines.some((line) => line.includes("Lich Queen")), "the narration reached the log");
  server.close();

  // A backend nobody answers on.
  pointAt("http://127.0.0.1:9/v1");
  const failed = await errorsDuring(() => read(["fight_start"], secret));
  assert.deepEqual(failed.result, []);
  assert.ok(failed.lines.some((line) => line.includes("[claims] turn test") && line.includes("failed")), failed.lines.join("\n"));
  assert.ok(!failed.lines.some((line) => line.includes("Lich Queen")), "the narration reached the log");
});

await test("Who speaks is read from the public cast, the party and an NPC the reply itself registers.", async () => {
  const model = await fakeModel();
  model.pointAt(world);
  const npcs = await import("../src/lib/db/npcs.ts");
  const marla = npcs.upsertNpc({ campaignId: world.campaignId, name: "Marla Venn" });
  model.claims([
    [
      { kind: "speaker", ref: marla.id, quote: "Sei tornato" },
      { kind: "speaker", ref: "new:Bruno", quote: "Benvenuti" },
    ],
  ]);
  const claims = await readClaims(world.campaign(), {
    label: "turn test",
    text: "Marla alza lo sguardo: «Sei tornato.» Bruno apre la porta: «Benvenuti.»",
    kinds: ["speaker"],
    outcomes,
    sheets: world.sheets(),
    registering: ["Bruno"],
  });
  assert.deepEqual(claims.map((claim) => [claim.line, claim.speaker.name, claim.speaker.id]), [
    ["Sei tornato.", "Marla Venn", marla.id],
    ["Benvenuti.", "Bruno", ""],
  ]);
  assert.match(model.readerRequests[0].messages[1].content, new RegExp(`^Speaker refs: "${marla.id}" for Marla Venn, "new:Bruno" for Bruno$`, "m"), "only the people the passage names are listed");
  model.claims([]);
  assert.deepEqual(
    await readClaims(world.campaign(), { label: "turn test", text: "Una voce nel buio: «Chi va là?»", kinds: ["speaker"], outcomes, sheets: world.sheets() }),
    [],
  );
  assert.equal(model.readerRequests.length, 0, "a passage naming nobody is not read for its speakers");
  model.close();
});

world.close();
finish();
