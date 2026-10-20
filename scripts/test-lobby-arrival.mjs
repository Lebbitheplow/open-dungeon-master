// The table sees a player arrive (backlog F27): a character seated while the
// lobby is open raises "Thornwick takes a seat" for everyone in it, from the
// sheets the campaign stream already keeps. The baseline never replays,
// companions are not arrivals, the banner leaves on its own unless the
// device is still, and Dismiss or Escape skips it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const arrival = await import("../src/app/campaigns/[campaignId]/arrival.ts");
const { ArrivalBanner, ArrivalCard } = await import("../src/app/campaigns/[campaignId]/ArrivalBanner.tsx");

// Line endings as git wrote them: a Windows checkout reads CRLF, and the
// multi-line patterns below are written with \n.
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const sheet = (id, name, extra = {}) => ({
  id,
  name,
  race: "hill_dwarf",
  class: "Fighter",
  gender: "",
  portrait: null,
  isCompanion: false,
  ...extra,
});
const mara = sheet("s1", "Mara", { race: "human", class: "Wizard" });
const thornwick = sheet("s2", "Thornwick", { raceLabel: "Hill dwarf" });
const wolf = sheet("s3", "Grey wolf", { isCompanion: true });

await test("the sheets present when the lobby opens are the baseline and never replay", () => {
  const start = arrival.startArrivals([mara, wolf]);
  assert.deepEqual(start, { known: ["s1"], queue: [] }, "companions are not seats");
  assert.equal(arrival.seeSheets(start, [mara, wolf]), start, "the same sheets: nothing happened, same state");
});

await test("a player seating a character triggers one arrival", () => {
  const start = arrival.startArrivals([mara]);
  const seated = arrival.seeSheets(start, [mara, thornwick]);
  assert.equal(seated.queue.length, 1);
  assert.equal(seated.queue[0].id, "s2");
  assert.equal(arrival.arrivalLine(seated.queue[0]), "Thornwick takes a seat");
  assert.equal(arrival.arrivalDetail(seated.queue[0]), "Hill dwarf · Fighter", "ancestry and class");
  assert.equal(arrival.arrivalDetail(sheet("x", "Ash", { race: "half_elf", class: "Rogue" })), "half elf · Rogue", "no label: the id, readable");
  // The next stream update to the same sheet (an edit, a ready) is not news.
  const edited = arrival.seeSheets(seated, [mara, { ...thornwick, level: 2 }]);
  assert.equal(edited, seated, "the same sheet again does not arrive twice");
  const dismissed = arrival.dismissArrival(seated);
  assert.deepEqual(dismissed.queue, [], "dismissed");
  assert.equal(arrival.seeSheets(dismissed, [mara, thornwick]), dismissed, "and does not come back");
});

await test("a companion joining the party is not a player taking a seat", () => {
  const start = arrival.startArrivals([mara]);
  assert.equal(arrival.seeSheets(start, [mara, wolf]), start);
});

await test("arrivals queue, one at a time, and a busy lobby keeps the latest", () => {
  let state = arrival.startArrivals([]);
  const many = Array.from({ length: 6 }, (_, index) => sheet(`p${index}`, `Player ${index}`));
  state = arrival.seeSheets(state, many);
  assert.equal(state.queue.length, arrival.ARRIVAL_QUEUE);
  assert.equal(state.queue[0].id, `p${6 - arrival.ARRIVAL_QUEUE}`, "the oldest are dropped");
  state = arrival.dismissArrival(state);
  assert.equal(state.queue[0].id, `p${7 - arrival.ARRIVAL_QUEUE}`, "the next one shows");
  assert.equal(arrival.dismissArrival(arrival.startArrivals([])).queue.length, 0, "dismissing nothing is harmless");
});

await test("the banner leaves on its own only where motion is allowed", () => {
  assert.equal(arrival.arrivalStays({ lowEffects: false, reducedMotion: false }), false, "with motion: auto-hides");
  assert.equal(arrival.arrivalStays({ lowEffects: true, reducedMotion: false }), true, "Effects low: waits for Dismiss");
  assert.equal(arrival.arrivalStays({ lowEffects: false, reducedMotion: true }), true, "reduced motion: waits for Dismiss");
  assert.ok(arrival.ARRIVAL_MS >= 3000 && arrival.ARRIVAL_MS <= 6000, "a few seconds");
  const source = read("src/app/campaigns/[campaignId]/ArrivalBanner.tsx");
  assert.match(source, /if \(!current \|\| still \|\| held\) return;\n\s+const timer = window\.setTimeout\(skip, ARRIVAL_MS\);/, "no timer while still or held");
  assert.match(source, /useEscapeToSkip\(Boolean\(current\), skip\);/, "Escape dismisses it");
});

await test("a still banner shows Dismiss and takes no focus; a moving one has no button", () => {
  const card = (still) =>
    renderToStaticMarkup(createElement(ArrivalCard, { arrival: thornwick, still, onDismiss() {}, onHold() {} }));
  const kept = card(true);
  assert.match(kept, /<button type="button" class="moment-arrival-dismiss">Dismiss<\/button>/, `a named Dismiss: ${kept}`);
  assert.match(kept, /data-still="true"/, "drawn still");
  assert.doesNotMatch(kept, /autofocus|tabindex/i, "nothing pulls focus to it");
  const moving = card(false);
  assert.doesNotMatch(moving, /<button/, "with motion it leaves on its own");
  assert.doesNotMatch(moving, /data-still/);
  assert.match(moving, /Thornwick takes a seat/);
  assert.match(moving, /Hill dwarf · Fighter/);
  assert.match(moving, /<img[^>]*alt="Thornwick"|alt="Thornwick"/, "with the face");
  assert.doesNotMatch(moving, /role="dialog"|aria-modal|moment-stage/, "a banner, not a modal");
});

await test("one polite announcement, from a region that is always there", () => {
  const empty = renderToStaticMarkup(createElement(ArrivalBanner, { sheets: [mara, thornwick] }));
  assert.equal(empty, '<p role="status" class="sr-only"></p>', "the baseline: a quiet, mounted region");
  const source = read("src/app/campaigns/[campaignId]/ArrivalBanner.tsx");
  assert.equal((source.match(/role="status"/g) ?? []).length, 1, "one live region");
  assert.match(source, /<span className="min-w-0 flex-1" aria-hidden="true">/, "the card's words are not read twice");
});

await test("the lobby raises it from the stream's sheets, with no new channel", () => {
  const lobby = read("src/app/campaigns/[campaignId]/Lobby.tsx");
  assert.match(lobby, /<ArrivalBanner sheets=\{sheets\} \/>/, "fed the sheets the lobby already has");
  assert.match(
    lobby,
    /<div className="relative order-1">\s*<LobbyHero[\s\S]*?\/>\s*<ArrivalBanner sheets=\{sheets\} \/>\s*<\/div>/,
    "it rides on the lobby card, not over the grid",
  );
  const stream = read("src/app/campaigns/[campaignId]/useCampaignStream.ts");
  assert.match(stream, /case "sheet_updated": \{[\s\S]*?next\.sheets = upsertBy\(state\.sheets, sheet/, "a seat lands through sheet_updated");
  const banner = read("src/app/campaigns/[campaignId]/ArrivalBanner.tsx");
  assert.doesNotMatch(banner, /EventSource|fetch\(|setInterval/, "the banner opens nothing of its own");

  const css = read("src/app/styles/moments.css");
  assert.match(css, /\.moment-arrival\[data-still\],\n\[data-effects="low"\] \.moment-arrival \{ animation: none; \}/, "Effects low: no animation");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /\.moment-arrival \{ animation: none;/, "reduced motion: no animation");
  const rule = css.slice(css.indexOf(".moment-arrival {"), css.indexOf("}", css.indexOf(".moment-arrival {")));
  assert.match(rule, /position: absolute;/, "anchored to the lobby card");
  assert.match(rule, /max-width: calc\(100% - 1\.5rem\);/, "never wider than the card");
  assert.doesNotMatch(rule, /pointer-events: none/, "it can be held and dismissed");
  assert.match(css, /\.moment-arrival-dismiss \{[^}]*min-height: 44px;/, "a finger-sized Dismiss");
});

console.log(`${passed} lobby arrival checks passed`);
