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

const { checkClaims, claimKindsFor, englishEndsTurn, namedSpeakers, parseReaderReply, readerSystem, renderReaderInput, withoutAsides } = await import(
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
  // So is a turn handed on: it moves the fight, it rules on nothing.
  assert.deepEqual(claimKindsFor({ ...GATE, guard: false, turnOver: true }), ["turn_over"]);
});

await test("A turn handed on is a claim of its own, kept only when it was asked and quotes the narration.", () => {
  const text = "Avery steps back from the goblin. It is now Kara's turn.";
  const base = { text, attackRefs: new Set(), creatureRefs: new Set(), party: new Map(), leveledSpells: new Set(), normalizeSpell: (name) => name, skills: new Set(), spent: new Map(), speakers: new Map() };
  const raw = [{ kind: "turn_over", quote: "It is now Kara's turn." }];
  assert.deepEqual(checkClaims(raw, { ...base, kinds: ["turn_over"] }), raw);
  assert.deepEqual(checkClaims(raw, { ...base, kinds: ["aside"] }), []);
  assert.deepEqual(checkClaims([{ kind: "turn_over", quote: "Bram goes next." }], { ...base, kinds: ["turn_over"] }), []);
  assert.match(readerSystem([], false), /"kind":"turn_over"/);
  assert.match(readerSystem([], false), /headed "Player's words" is asked only for turn_over/);
});

await test("A fight starting is an ambush or a blow begun on the party as well as a call for initiative, and never a threat or a fight between others.", () => {
  const system = readerSystem([], false);
  assert.match(system, /"kind":"fight_start".*a call to roll initiative/);
  assert.match(system, /"kind":"fight_start".*hostile creatures attacking a party character now: an ambush springing on them/);
  assert.match(system, /"kind":"fight_start".*Never for words, threats, demands, warnings or gestures, or weapons drawn or aimed with no attack made yet; a fight between others/);
});

await test("The plain English ways a player ends their turn are read beside the reader, and nothing else is.", () => {
  for (const said of ["I close in on the nearest goblin and attack it, then I end my turn.", "That's my turn.", "Kara ends her turn.", "I'm ending my turn here", "My turn is over."]) {
    assert.equal(englishEndsTurn(said), true, said);
  }
  for (const said of ["I attack the goblin.", "Whose turn is it?", "I wait for my turn.", "It's my turn now, right?"]) {
    assert.equal(englishEndsTurn(said), false, said);
  }
});

await test("The request lists the kinds, the refs and the narration; the instructions name every skill id.", () => {
  const input = renderReaderInput(
    ["hit", "roll_ask"],
    { creatures: [{ ref: "goblin", display: "Goblin 1" }], party: [{ ref: "c1", name: "Kara" }], speakers: [{ ref: "n1", name: "Marla" }], spent: [] },
    "Kara colpisce il goblin.",
  );
  assert.doesNotMatch(input, /Speaker refs/, "speakers are listed only when asked");
  assert.doesNotMatch(input, /Spent refs/, "spends are listed only when a cast is asked");
  const spent = [{ ref: "s1", name: "Hexblade's Curse", by: "Vesper" }, { ref: "s2", name: "dash", by: "Kara" }];
  assert.doesNotMatch(renderReaderInput(["hit"], { creatures: [], party: [], speakers: [], spent }, "x"), /Spent refs/);
  assert.doesNotMatch(renderReaderInput(["cast"], { creatures: [], party: [], speakers: [], spent: [] }, "x"), /Spent refs/, "nothing spent, nothing listed");
  assert.match(
    renderReaderInput(["cast"], { creatures: [], party: [], speakers: [], spent }, "x"),
    /^Spent refs: "s1" for Hexblade's Curse \(Vesper\), "s2" for dash \(Kara\)$/m,
  );
  assert.match(readerSystem([], false), /Add "spent":SPENT_REF only when/, "a cast can say which spend it describes");
  assert.doesNotMatch(readerSystem([], false), /"spell":"English spell name","spent"/, "spent is no field of the cast template");
  assert.match(readerSystem([], false), /Never for a spell the narration names or says is cast/);

  assert.match(
    renderReaderInput(["speaker"], { creatures: [], party: [], speakers: [{ ref: "n1", name: "Marla Venn", aliases: ["il Capitano"] }, { ref: "c1", name: "Kara" }], spent: [] }, "«Basta», dice il Capitano."),
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
  spent: new Map(),
  speakers: namedSpeakers(
    text,
    new Map([
      ["n1", { kind: "npc", id: "n1", name: "Marla Venn" }],
      ["n2", { kind: "npc", id: "n2", name: "Old Pike" }],
      [mira.id, { kind: "pc", id: mira.id, name: "Mira" }],
    ]),
  ),
});
const ALL = ["hit", "miss", "dies", "downed", "amount", "cast", "fight_start", "roll_ask", "aside", "speaker"];

await test("A claim quoting words the narration does not hold never acts; a quote with other quote marks or spacing does.", () => {
  const text = "La lama di Mira colpisce il goblin. «Morirai», sibila.";
  assert.deepEqual(checkClaims([{ kind: "hit", target: "goblin", quote: "Mira kills the goblin" }], context(text, ALL)), []);
  assert.equal(checkClaims([{ kind: "hit", target: "goblin", quote: "colpisce   il GOBLIN" }], context(text, ALL)).length, 1);
  assert.equal(checkClaims([{ kind: "fight_start", quote: '"Morirai", sibila' }], context(text, ALL)).length, 1);
});

await test("An aside is asked only when the gate says so; its sentences leave the prose and the rest stays, and a passage that was all aside leaves nothing.", () => {
  assert.deepEqual(claimKindsFor({ ...GATE, guard: false, aside: true }), ["aside"]);
  assert.match(readerSystem([], false), /"kind":"aside"/);
  assert.match(readerSystem([], false), /an out-of-character answer to a player/);
  const text = "La nebbia avvolge il molo. «Non stanotte», dice il traghettatore. Prima imposterò l'approdo e l'ora.";
  const claims = checkClaims(
    [
      { kind: "aside", quote: "Prima imposterò l'approdo e l'ora." },
      { kind: "aside", quote: "I'll check the encounter first." },
    ],
    context(text, ["aside"]),
  );
  assert.deepEqual(claims, [{ kind: "aside", quote: "Prima imposterò l'approdo e l'ora." }], "an aside quoting words the prose lacks never acts");
  assert.equal(withoutAsides(text, claims, "italian"), "La nebbia avvolge il molo. «Non stanotte», dice il traghettatore.");
  assert.equal(withoutAsides(text, [], "italian"), text);
  const plan = "**The quay is not on the map yet. I will set the landing first.**";
  assert.equal(withoutAsides(plan, [{ kind: "aside", quote: "The quay is not on the map yet. I will set the landing first." }], "english"), "", "a quote over two sentences cuts both");
});

// Gemma4 e4b, whose reader (the same small model) quoted none of these, sent
// its reply to a correction and its echo of a player's line to the table.
await test("What a small model writes about the turn is cut without the reader; speech and fiction about tools are not.", () => {
  const meta =
    "It appears I made an unwarranted assumption about the combat sequence. Since you declared an action that resulted in damage without a tool call, I will correct this by calling the necessary tool to resolve the attack properly, and then narrate the results based on the tool's output.";
  assert.equal(withoutAsides(meta, [], "english"), "");
  // A small model's English talk about its tools is cut at an English table
  // only; at every other table the reader's asides cut it.
  for (const language of ["italian", "french", "spanish", "german"]) {
    assert.equal(withoutAsides(meta, [], language), meta, language);
  }
  assert.equal(withoutAsides("Bram | attempt to ask the merchant about the coffer's contents.", [], "english"), "", "the player's line echoed in its input format");
  assert.equal(withoutAsides("[Avery | attempt] I search the reeds.\nThe reeds hide nothing but a heron.", [], "english"), "The reeds hide nothing but a heron.");
  assert.equal(withoutAsides("Rain lashes the ford.\n[Table note] Bandit 2 attacks Avery.", [], "english").trim(), "Rain lashes the ford.");
  const speech = 'The innkeeper scowls. "I\'ll call the guards if you touch that tool chest." What do you do?';
  assert.equal(withoutAsides(speech, [], "english"), speech, "a quoted line is speech");
  const tools = "Avery pulls out her thieves' tools and calls softly to Bram. The lock clicks.";
  assert.equal(withoutAsides(tools, [], "english"), tools);
});

// Qwen3.5 9B on the short rules copied the game state into the story: the
// turn order as a list and the board squares it reads.
await test("The turn order recited and the board's squares quoted are cut without the reader; the scene around them stays.", () => {
  const order =
    "The shadows circle, claws drawn.\n\n**Initiative order:**\n1. Shadow Aberration 1 (moves to (7,13))\n2. **Avery (your turn)**\n3. Bram\n\nThe purple mist swirls around the wagons. What do you do?";
  assert.equal(withoutAsides(order, [], "english"), "The shadows circle, claws drawn.\n\nThe purple mist swirls around the wagons. What do you do?");
  const inline = "**Current Initiative:** 1. Shadow 1 (at 7,13) 2. Avery (your turn)\nThe river roars.";
  assert.equal(withoutAsides(inline, [], "english").trim(), "The river roars.");
  const squares = "Avery, you're up. You're currently at (15,1) with the nearest enemy at (7,11). The mist thickens.";
  assert.equal(withoutAsides(squares, [], "english").trim(), "Avery, you're up. The mist thickens.");
  const fiction = "The old map marks two wells, a mill and the ford. The order of the watch changes at dusk.\nInitiative wins fights, the old sergeant says.";
  assert.equal(withoutAsides(fiction, [], "english"), fiction, "words like order and numbers in prose stay");
  // The recited order's English heading is read at an English table only;
  // at every table the board's squares quoted still go.
  for (const language of ["italian", "french", "spanish", "german"]) {
    const ordine = "Le ombre girano attorno.\n\n**Initiative order:**\n1. Ombra 1\n2. Avery\n\nAvery, sei a (15,1). La nebbia si addensa.";
    assert.equal(withoutAsides(ordine, [], language), "Le ombre girano attorno.\n\n**Initiative order:**\n1. Ombra 1\n2. Avery\n\n La nebbia si addensa.", language);
  }
});

await test("A claim of a kind not asked, about a creature the engine does not know, or by someone outside the party never acts.", () => {
  const text = "The ogre falls. The dragon dies. Mira casts Fireball. Vex casts Fireball.";
  const ctx = context(text, ["dies", "cast"]);
  assert.deepEqual(checkClaims([{ kind: "hit", target: "goblin", quote: "The ogre falls." }], ctx), [], "hit was not asked");
  assert.deepEqual(checkClaims([{ kind: "dies", target: "dragon", quote: "The dragon dies." }], ctx), [], "no dragon in this turn");
  assert.deepEqual(checkClaims([{ kind: "dies", target: "ogre", quote: "The ogre falls." }], ctx).length, 1);
  assert.deepEqual(checkClaims([{ kind: "cast", caster: "vex", spell: "Fireball", quote: "Vex casts Fireball." }], ctx), [], "an enemy caster");
  const [fireball] = checkClaims([{ kind: "cast", caster: mira.id, spell: "Fireball (3rd level)", quote: "Mira casts Fireball." }], ctx);
  assert.deepEqual(fireball, { kind: "cast", caster: "Mira", spell: "Fireball (3rd level)", quote: "Mira casts Fireball." });
});

await test("A cast tied to something its own caster spent this turn is that spend, not a spell; tied to anything else it is still a cast.", () => {
  const text = "Un'ombra fredda scivola sul chierico: un marchio nero gli brucia sulla tunica. Mira lo paralizza con un gesto.";
  const ctx = { ...context(text, ["cast"]), spent: new Map([["s1", mira.id], ["s2", "kara-id"]]) };
  const bane = { kind: "cast", caster: mira.id, spell: "Bane", quote: "un marchio nero gli brucia sulla tunica" };
  const hold = { kind: "cast", caster: mira.id, spell: "Hold Person", quote: "Mira lo paralizza con un gesto" };
  assert.deepEqual(checkClaims([{ ...bane, spent: "s1" }], ctx), [], "her own spend");
  assert.equal(checkClaims([{ ...hold, spent: "s2" }], ctx).length, 1, "somebody else's spend");
  assert.equal(checkClaims([{ ...hold, spent: "s9" }], ctx).length, 1, "a spend the turn never made");
  // A reader that fills the field it leaves empty with null.
  assert.equal(checkClaims([{ ...hold, spent: null }], ctx).length, 1, "no spend, written as null");
  assert.deepEqual(checkClaims([{ ...bane, spent: "s1" }, hold], ctx), [{ kind: "cast", caster: "Mira", spell: "Hold Person", quote: hold.quote }]);
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

await test("A roll ask whose empty fields the reader wrote as null is kept as if they were left out.", () => {
  const text = "Mira, roll Perception. Mira, make a Wisdom saving throw, DC 13.";
  const ctx = context(text, ALL);
  const skill = { kind: "roll_ask", character: mira.id, check: "skill", skill: "perception", quote: "Mira, roll Perception." };
  const save = { kind: "roll_ask", character: mira.id, check: "save", ability: "wis", dc: 13, quote: "make a Wisdom saving throw, DC 13" };
  assert.deepEqual(checkClaims([{ ...skill, ability: null, dc: null }], ctx), [skill]);
  assert.deepEqual(checkClaims([{ ...save, skill: null }], ctx), [save]);
  // Null is no skill: a skill check still needs one.
  assert.deepEqual(checkClaims([{ ...skill, skill: null }], ctx), []);
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

const outcomes = guardOutcomes([], null, "english");
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
