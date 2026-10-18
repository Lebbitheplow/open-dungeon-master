// One canon policy for every path that hands the world to a model (audit
// WF-14): the narrator's world block and its WORLD LORE block, search_lore,
// and WorldForge's Ask and Draft. A draft is carried and marked, an alternate
// is carried and marked as another telling, a retired record is left out of
// what the table hears and only Ask still reads it, marked. A secret the party
// learned stays known to the narrator as established. The first test is the
// audit's reproduced case: an alternate event reached the narrator as plain
// history.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-world-canon-policy");
const { createWorldEntity, getWorldDoc, saveWorldDoc, worldView } = await import("../src/lib/db/world-forge.ts");
const { readDoc } = await import("../src/lib/worldforge/model.ts");
const { worldForPrompt } = await import("../src/lib/dm/world-prompt.ts");
const { handleSearchLore } = await import("../src/lib/dm/lore-search.ts");
const { buildTurnRetrieval } = await import("../src/lib/dm/context-retrieval.ts");
const forge = await import("../src/lib/worldforge/forge.ts");

const world = await openWorld();
const id = world.campaignId;
const make = (input) => {
  const made = createWorldEntity(id, input);
  assert.ok(made.entity?.ref, JSON.stringify(made));
  return made.entity.ref;
};
const year = (yearNum, calendarId = "cal_tr") => ({ calendarId, yearNum, year: "" });
const event = (eventId, title, when, refs, canon = "canon") => ({ id: eventId, title, body: "", era: "", when, refs, canon });
const patch = (change) => saveWorldDoc(id, readDoc({ ...getWorldDoc(id), ...change(getWorldDoc(id)) }));

const orrin = make({ typeId: "t_character", name: "Captain Orrin", text: "Harbourmaster of the Saltmarch." });
const wenna = make({ typeId: "t_character", name: "Wenna Salt", text: "A net-mender with a long memory." });
const toll = make({ typeId: "t_other", name: "The Old Toll", text: "A harbour toll of three copper bits per hull.", canon: "retired" });
make({ typeId: "t_artifact", name: "The Drowned Crown", text: "A crown of green copper raised from the harbour mud.", canon: "draft" });
make({ typeId: "t_culture", name: "The Second Sun", text: "A people who say a second sun rose over the harbour mud.", canon: "alternate" });

// Two reckonings, so a year reads in its own calendar and converts.
patch((doc) => ({
  calendars: [
    { id: "cal_tr", name: "Tide Reckoning", abbrev: "TR", epochOffset: 1240, notes: "" },
    { id: "cal_af", name: "After Founding", abbrev: "AF", epochOffset: 0, notes: "" },
  ],
  // Entered out of time order on purpose, the alternate and retired ones last.
  events: [
    event("ev_mid", "Orrin breaks the chain", year(55), [orrin]),
    event("ev_old", "Orrin takes the harbour", year(40), [orrin]),
    event("ev_alt", "Orrin drowns at sea", year(99), [orrin], "alternate"),
    event("ev_ret", "Orrin sells the fleet", year(60), [orrin], "retired"),
    event("ev_wenna", "Wenna crowned queen", year(99), [wenna], "alternate"),
  ],
  secrets: [
    { id: "sec_open", title: "The chain was cut from inside", subject: orrin, notes: "", knownBy: [orrin], partyKnows: false },
    { id: "sec_known", title: "Wenna is Orrin's sister", subject: wenna, notes: "They share a mother.", knownBy: [], partyKnows: true },
  ],
  links: [
    ...doc.links,
    { id: "lk_toll", from: orrin, to: toll, label: "guards", veracity: "known", oneway: false },
    { id: "lk_wenna", from: orrin, to: wenna, label: "sibling of", veracity: "known", oneway: false },
  ],
}));

await test("An alternate event never reaches the narrator as plain history (WF-14 world_prompt_alternate_event).", () => {
  const { block } = worldForPrompt(id, { text: "Captain Orrin and Wenna Salt argue at the quay." });
  assert.match(block, /Wenna crowned queen \[alternate\]/, "the alternate event was not tagged");
  assert.match(block, /\[alternate\] another telling, not what happened in this world; never state it as fact\./, "the tag was not explained");
  assert.doesNotMatch(block, /drowns at sea(?! \[alternate\])/, "an alternate event read as history");
  assert.doesNotMatch(block, /sells the fleet/, "a retired event reached the narrator");
});

await test("An entry's history is its settled events, read forward in its own calendar.", () => {
  const { block } = worldForPrompt(id, { text: "Captain Orrin waits." });
  assert.match(block, /history: 40 TR: Orrin takes the harbour; 55 TR: Orrin breaks the chain/, block);
  assert.doesNotMatch(block, /guards The Old Toll|guards \|/, "a tie to a retired entry reached the narrator");
});

await test("A secret the party learned stays with the narrator as established; an open one stays the DM's.", () => {
  const { block } = worldForPrompt(id, { text: "Wenna Salt mends a net." });
  assert.match(block, /secrets the party has learned[^\n]*\n- Learned: Wenna is Orrin's sister \(about Wenna Salt\): They share a mother\./, block);
  assert.match(block, /- Secret: The chain was cut from inside/);
  assert.doesNotMatch(block, /- Secret: Wenna is Orrin's sister/);
});

await test("The narrator's WORLD LORE marks a draft and an alternate, and leaves a retired entry out.", async () => {
  const { loreBlock } = await buildTurnRetrieval(world.campaign(), [
    { authorType: "player", content: "What do we know of the Old Toll, the Drowned Crown and the Second Sun over the harbour mud?" },
  ]);
  assert.doesNotMatch(loreBlock, /three copper bits/, "a retired lore entry reached the narrator");
  assert.match(loreBlock, /The Drowned Crown \(DRAFT: not settled yet; use it only if it fits, never as established; the party does not know this\)/, loreBlock);
  assert.match(loreBlock, /The Second Sun \(ALTERNATE: another telling, not what happened in this world; never state it as fact; the party does not know this\)/, loreBlock);
});

await test("search_lore leaves retired records out and says what a draft or alternate one is.", async () => {
  const toll = await handleSearchLore(id, JSON.stringify({ query: "Old Toll copper bits per hull" }));
  assert.ok(!toll.results.some((result) => /three copper bits/.test(result.text)), JSON.stringify(toll.results));
  const crowned = await handleSearchLore(id, JSON.stringify({ query: "Wenna crowned queen" }));
  const alt = crowned.results.find((result) => result.source === "worldforge timeline");
  assert.equal(alt?.ref, "99 TR (= 1339 AF): Wenna crowned queen [alternate]", JSON.stringify(crowned.results));
  assert.match(alt.canon ?? "", /^alternate: another telling/);
  const draft = await handleSearchLore(id, JSON.stringify({ query: "Drowned Crown green copper" }));
  for (const source of ["world lore", "worldforge"]) {
    const hit = draft.results.find((result) => result.source === source && /green copper/.test(result.text));
    assert.match(hit?.canon ?? "", /^draft: not settled yet/, `${source}: ${JSON.stringify(draft.results)}`);
  }
  assert.match(draft.note, /canon line is not established/);
  const sister = await handleSearchLore(id, JSON.stringify({ query: "Wenna Orrin sister mother" }));
  const secret = sister.results.find((result) => result.source === "worldforge secret");
  assert.match(secret?.text ?? "", /^the party has learned this/, JSON.stringify(sister.results));
});

await test("Ask reads every record with its canon tag, the settled ones first, and the asked entry's events first.", () => {
  // Forty-five later events would crowd an early asked one out of a timeline
  // read oldest first.
  patch((doc) => ({
    events: [
      ...doc.events,
      ...Array.from({ length: 45 }, (_, index) => event(`ev_fill${index}`, `Market day ${index}`, year(100 + index), [wenna])),
      event("ev_statue", "Orrin's statue raised", year(2000, "cal_af"), [orrin]),
    ],
  }));
  const { doc, entities } = worldView(id);
  const digest = forge.worldDigest(doc, entities, "Tell me about Captain Orrin", 14_000);
  assert.match(digest, /^WorldForge marks what is not canon: \[draft\][^\n]*\[alternate\][^\n]*\[retired\] no longer true in this world\./);
  assert.match(digest, /## The Old Toll \(Other\) \[retired\]/);
  assert.match(digest, /## The Drowned Crown \(Artifact\) \[draft\]/);
  assert.match(digest, /- 99 TR \(= 1339 AF\): Orrin drowns at sea \[alternate\]/);
  assert.match(digest, /- 60 TR \(= 1300 AF\): Orrin sells the fleet \[retired\]/);
  assert.match(digest, /- 2000 AF \(= 760 TR\): Orrin's statue raised/, "the asked entry's latest event fell out of the timeline");
  assert.match(digest, /- Wenna is Orrin's sister: the party has learned this/);
  assert.match(digest, /- The chain was cut from inside \(kept by Captain Orrin\): DM only/);
  const general = forge.worldDigest(doc, entities, "What is going on?", 14_000);
  assert.ok(general.indexOf("## Captain Orrin") < general.indexOf("## The Old Toll"), "a retired entry came before a canon one");
  assert.match(forge.askMessages(digest, "q", "The Saltmarch")[0].content, /tagged \[draft\], \[alternate\] or \[retired\] is not this world's canon/);
});

await test("Draft writes from the same policy: retired ties and events left out, alternate ones tagged.", () => {
  const { doc, entities } = worldView(id);
  const known = forge.draftKnown(doc, entities, entities.find((entry) => entry.ref === orrin)).join("\n");
  assert.doesNotMatch(known, /Old Toll/, "a tie to a retired entry reached Draft");
  assert.doesNotMatch(known, /sells the fleet/, "a retired event reached Draft");
  assert.match(known, /Captain Orrin sibling of Wenna Salt/);
  assert.match(known, /Event, 99 TR \(= 1339 AF\): Orrin drowns at sea \[alternate\]/);
  assert.match(forge.draftMessages({ worldName: "w", name: "n", typeName: "t", known: [], hiddenTruth: "", hint: "" })[0].content, /tagged \[draft\][^\n]*\[alternate\]/);
});

finish();
