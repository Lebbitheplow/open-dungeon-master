// Issue 275, the lobby's Narration row on a text-only server. A fresh
// install set up with no narration opened its first table (Quick start)
// saying "Narration on" with a voice picked, over a note that the server
// had no narration: the new-campaign dialog turns the switch off for
// itself when the server cannot read aloud, but the API's bare create and
// Quick start took the schema default, on. Now every creation path asks
// the server (narrationAvailable), the lobby row reads Off and holds its
// switch while the server's speech is off, and the table's header offers
// no narration volume then.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { standInStoryteller } from "./lib/stand-in-storyteller.mjs";

// An AI-run table through the routes needs a storyteller set up (the routes
// refuse one otherwise, and seat a person when none is named); this one never
// answers.
standInStoryteller();

const world = await openWorld();
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { narrationAvailable } = await import("../src/lib/capabilities.ts");
const { getCampaignById: getCampaign } = await import("../src/lib/db/campaigns.ts");
const { createStarterCampaign } = await import("../src/lib/starter/one-shot.ts");
const { gameSettingsSchema } = await import("../src/lib/schemas/game-settings.ts");

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const post = (name, body) =>
  new Request(`http://localhost/api/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const json = (response) => response.clone().json();
world.signIn(world.owner);

// The seam: zod fills a field's default even through .partial(), so the
// create route carves the narration switch out of its partial to see
// whether the caller said anything, and the schema's own default stays on.
assert.equal(gameSettingsSchema.partial().parse({}).ttsEnabled, true, "partial alone would say on for a caller that said nothing");
assert.equal(gameSettingsSchema.parse({}).ttsEnabled, true, "the schema's own default is still on");
assert.match(read("src/app/api/campaigns/route.ts"), /gameSettingsSchema\.partial\(\)\.extend\(\{ ttsEnabled: z\.boolean\(\)\.optional\(\) \}\)/, "the route leaves the switch unsaid until it decides");

const campaigns = await world.route("campaigns");
const starter = await world.route("starter");

// Speech off (setup's text only, or Admin > Speech): off without a probe.
saveGlobalConfig({ speech: { ttsProvider: "off" } });
assert.equal(await narrationAvailable(), false, "off is off");
let made = await campaigns.POST(post("campaigns", { title: "Text only" }));
assert.equal(made.status, 201, JSON.stringify(await json(made)));
let campaign = getCampaign((await json(made)).campaign.id);
assert.equal(campaign.gameSettings.ttsEnabled, false, "a bare create on a text-only server starts with narration off");
made = await campaigns.POST(post("campaigns", { title: "Said so", gameSettings: { ttsEnabled: true } }));
assert.equal(getCampaign((await json(made)).campaign.id).gameSettings.ttsEnabled, true, "a create that asks for narration keeps it (the dialog's say)");
made = await starter.POST(post("starter", { solo: true }));
assert.equal(made.status, 201, JSON.stringify(await json(made)));
campaign = getCampaign((await json(made)).campaign.id);
assert.equal(campaign.gameSettings.ttsEnabled, false, "Quick start on a text-only server starts with narration off");
console.log("ok: a text-only server's new tables start with narration off, by the API and by Quick start");

// A speech server named by the admin counts as configured (one switch
// away at most), so the switch starts on, as the dialog's own rule says.
saveGlobalConfig({ speech: { ttsProvider: "kokoro", kokoroUrl: "http://127.0.0.1:1" } });
assert.equal(await narrationAvailable(), true, "a named speech server counts");
made = await campaigns.POST(post("campaigns", { title: "Spoken" }));
assert.equal(getCampaign((await json(made)).campaign.id).gameSettings.ttsEnabled, true, "a bare create starts with narration on where the server can read aloud");
made = await starter.POST(post("starter", { solo: false }));
assert.equal(getCampaign((await json(made)).campaign.id).gameSettings.ttsEnabled, true, "so does Quick start");
// The helper's own contract: unsaid, the starter keeps the schema default.
assert.equal(createStarterCampaign(world.owner.id, { solo: true }).gameSettings.ttsEnabled, true);
assert.equal(createStarterCampaign(world.owner.id, { solo: true, narration: false }).gameSettings.ttsEnabled, false);
console.log("ok: where the server can read aloud, new tables start with narration on");

// The lobby's row and the table's header follow the server's speech.
// The panel decides; its Narration group (GameSettingsGroups.tsx) draws the row.
const panel = read("src/app/campaigns/[campaignId]/GameSettingsPanel.tsx") + read("src/app/campaigns/[campaignId]/GameSettingsGroups.tsx");
assert.match(panel, /const narrationOff = capabilities\?\.tts\?\.provider === "off";/);
assert.match(panel, /const narrating = settings\.ttsEnabled && !narrationOff;/);
assert.match(panel, /<SettingToggle label="Narration" on=\{narrating\} disabled=\{narrationOff\}/, "the switch is held while speech is off");
assert.match(panel, /\{narrating \? "On" : narrationOff \? "Off on this server" : "Off"\}/, "the row says why");
assert.match(panel, /narrationOff\s*\? "Narration off on this server"/, "so does the read-only summary");
assert.match(panel, /\{narrating \|\| narrationOff \? <NarrationNote \/> : null\}/, "the note under the row explains the server's switch");
assert.doesNotMatch(panel.replace(/const narrating = settings\.ttsEnabled && !narrationOff;/, ""), /\{settings\.ttsEnabled \?/, "no voice control reads the raw switch any more");
const header = read("src/app/campaigns/[campaignId]/SessionHeader.tsx");
assert.match(header, /const narrates = ttsEnabled && capabilities\?\.tts\?\.provider !== "off";/);
assert.match(header, /\{narrates \? \(\s*<HeaderAudioControl\s*onLabel="Mute narration"/, "no narration volume for a server that reads nothing aloud");
console.log("ok: the lobby's Narration row and the table's header read the server's speech switch");
