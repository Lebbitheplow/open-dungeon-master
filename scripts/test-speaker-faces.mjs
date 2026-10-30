// The faces the story log gives the people who speak in it
// (src/lib/speaker-faces.ts), and that the transcript draws them: a
// character speaking inside the narration wears their portrait, else the
// painted plate for their class and race, never a bare letter; an NPC's face
// still comes only from the public cast; a player's own line puts their
// avatar between the portrait and the plate. Each list is the order the
// transcript falls back through when a picture fails to load (useFaceChain),
// so a deleted upload gives way to the plate instead of a broken image.
import assert from "node:assert/strict";
import { register } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

register("./lib/register-jsx.mjs", import.meta.url);

const { speakerFaces, playerFaces } = await import("../src/lib/speaker-faces.ts");
const { characterPlaceholder, avatarPlaceholder } = await import("../src/lib/placeholders.ts");
const { DmContent } = await import("../src/app/campaigns/[campaignId]/MessageContent.tsx");
const { PlayerMessage } = await import("../src/app/campaigns/[campaignId]/MessageParts.tsx");
const { transcriptSheets } = await import("../src/app/campaigns/[campaignId]/departing.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const sheet = (id, more = {}) => ({ id, userId: `u-${id}`, name: id, race: "dwarf", class: "fighter", gender: "", level: 3, portrait: null, ...more });
const brannoc = sheet("Brannoc", { portrait: { url: "/uploads/brannoc.webp" } });
const ysolde = sheet("Ysolde", { race: "elf", class: "wizard" });
const sheetsById = new Map([brannoc, ysolde].map((entry) => [entry.id, entry]));
const plate = (entry) => characterPlaceholder({ race: entry.race, class: entry.class, gender: entry.gender });
const pc = (entry) => ({ kind: "pc", id: entry.id, name: entry.name });

test("a character with a portrait speaks with it, and falls back to their plate", () => {
  assert.deepEqual(speakerFaces(pc(brannoc), sheetsById), ["/uploads/brannoc.webp", plate(brannoc)]);
});

test("a character with no portrait speaks with the plate for their class and race", () => {
  const faces = speakerFaces(pc(ysolde), sheetsById);
  assert.deepEqual(faces, [plate(ysolde)]);
  assert.match(faces[0], /\/assets\/placeholders\/character-class\/wizard-/);
});

test("an NPC gets no face from the party's sheets, even one sharing a sheet's id", () => {
  assert.equal(speakerFaces({ kind: "npc", id: brannoc.id, name: "Brannoc" }, sheetsById), undefined);
  assert.equal(speakerFaces({ kind: "monster", id: "goblin", name: "Goblin" }, sheetsById), undefined);
});

test("a character whose sheet this viewer does not hold gets none", () => {
  assert.equal(speakerFaces({ kind: "pc", id: "someone-else", name: "Wren" }, sheetsById), undefined);
});

test("a player's own line: portrait, then their avatar, then the plate", () => {
  assert.deepEqual(playerFaces({ sheet: brannoc, avatarUrl: "/uploads/avatar.webp", userId: brannoc.userId }), [
    "/uploads/brannoc.webp",
    "/uploads/avatar.webp",
    plate(brannoc),
  ]);
  assert.deepEqual(playerFaces({ sheet: ysolde, avatarUrl: undefined, userId: ysolde.userId }), [plate(ysolde)]);
  assert.deepEqual(playerFaces({ sheet: undefined, avatarUrl: null, userId: "u-1" }), [avatarPlaceholder("u-1")]);
  assert.deepEqual(playerFaces({}), []);
});

// The transcript itself, rendered: the faces above are the ones it draws.
const imgSources = (markup) => [...markup.matchAll(/<img[^>]*src="([^"]+)"/g)].map((match) => match[1]);

test("the narration draws a character's portrait or plate, the cast's face for an NPC, a letter for an unpainted one", () => {
  const lines = [
    { line: "Not a word to the guard.", speaker: { kind: "npc", id: "npc-marla", name: "Marla Venn" } },
    { line: "Then we go tonight.", speaker: pc(ysolde) },
    { line: "I will carry the lantern.", speaker: pc(brannoc) },
    { line: "Mind the step.", speaker: { kind: "npc", id: "npc-tobb", name: "Old Tobb" } },
  ];
  const content = lines.map((entry) => `"${entry.line}"`).join(" Then: ");
  const cast = [
    { id: "npc-marla", name: "Marla Venn", portraitUrl: "/uploads/marla.webp", hasVoice: false },
    { id: "npc-tobb", name: "Old Tobb", portraitUrl: "", hasVoice: false },
  ];
  const markup = renderToStaticMarkup(createElement(DmContent, { content, rollsById: new Map(), sheetsById, cast, lines }));
  assert.deepEqual(imgSources(markup), ["/uploads/marla.webp", plate(ysolde), "/uploads/brannoc.webp"]);
  assert.match(markup, />O<\/span>/, "Old Tobb, unpainted, keeps his initial");
});

test("a player's line draws the first of their faces in the medallion", () => {
  const message = { id: "m1", characterId: brannoc.id, userId: brannoc.userId, authorType: "player", content: "I nod.", createdAt: new Date().toISOString() };
  // The face only: the class emblem on the medallion's rim is a picture too.
  const faceSources = (markup) => [...markup.matchAll(/sheet-medallion-face"><img[^>]*src="([^"]+)"/g)].map((match) => match[1]);
  const render = (sheets, members) =>
    faceSources(
      renderToStaticMarkup(
        createElement(PlayerMessage, { message, mine: false, sheets, sheetsById: new Map(sheets.map((entry) => [entry.id, entry])), membersById: new Map(members.map((member) => [member.userId, member])) }),
      ),
    );
  assert.deepEqual(render([brannoc], []), ["/uploads/brannoc.webp"]);
  const unpainted = { ...brannoc, portrait: null };
  assert.deepEqual(render([unpainted], [{ userId: brannoc.userId, avatar: { url: "/uploads/avatar.webp" } }]), ["/uploads/avatar.webp"]);
  assert.deepEqual(render([unpainted], []), [plate(brannoc)]);
});

// A companion who left the party (0.31.1 playtest): her sheet is no longer
// among the party's, and her lines lost their face to a letter, while a card
// the player had played for her read as the player's own.
const krag = sheet("Krag", { userId: "u-player", race: "bhain-kwai", class: "fighter" });
const tamsin = sheet("Tamsin", { userId: "u-player", race: "human", class: "ranger" });
const goneRow = { sheetId: tamsin.id, name: "Tamsin", how: "Walked out on the party", at: "", portraitUrl: "", race: "human", class: "ranger", gender: "" };

test("the story log keeps a departed companion's sheet: a Gone row, a dimming card, and the party's own first", () => {
  const byId = transcriptSheets([krag], [], [goneRow]);
  assert.equal(byId.get(tamsin.id)?.name, "Tamsin");
  assert.deepEqual(speakerFaces(pc(tamsin), byId), [plate(tamsin)]);
  assert.equal(transcriptSheets([krag], [{ sheet: tamsin, how: "", at: 0 }], []).get(tamsin.id), tamsin);
  assert.equal(transcriptSheets([{ ...tamsin, name: "Tamsin, back" }], [], [goneRow]).get(tamsin.id)?.name, "Tamsin, back");
  assert.equal(transcriptSheets([krag], [], [{ ...goneRow, sheetId: undefined }]).size, 1, "an older server's row names no sheet");
});

test("a card played for a companion stays hers after she leaves, never the author's other character", () => {
  const message = { id: "m2", characterId: tamsin.id, userId: "u-player", authorType: "player", content: "I attack the captain with my Longbow.", createdAt: new Date().toISOString() };
  const render = (byId) =>
    renderToStaticMarkup(createElement(PlayerMessage, { message, mine: true, sheets: [krag], sheetsById: byId, membersById: new Map() }));
  const kept = render(transcriptSheets([krag], [], [goneRow]));
  assert.match(kept, /session-speaker[^>]*>Tamsin</);
  assert.doesNotMatch(kept, />Krag</);
  assert.doesNotMatch(render(new Map([[krag.id, krag]])), />Krag</, "an unknown character is not the author's");
  // A line from before characterId still finds its author's sheet.
  const old = renderToStaticMarkup(createElement(PlayerMessage, { message: { ...message, characterId: null }, mine: true, sheets: [krag], sheetsById: new Map(), membersById: new Map() }));
  assert.match(old, /session-speaker[^>]*>Krag</);
});

console.log(`test-speaker-faces: ${passed} tests passed.`);
