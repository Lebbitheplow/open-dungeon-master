// The three-step campaign creator (docs/campaign-creator-guided-setup-plan.md):
// every table switch is drawn once, every named group lives on the step that
// owns it, the server's limits keep what the person wanted, and the payload
// that leaves is normalized exactly as before the regrouping.
import assert from "node:assert/strict";
import fs from "node:fs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-campaign-creator-flow");

const { DEFAULT_DRAFT } = await import("../src/app/create-campaign/draft.ts");
const { tableSheet } = await import("../src/app/create-campaign/table-sheet.ts");
const { GROUP_STEP } = await import("../src/app/create-campaign/groups.ts");
const { withCapabilities } = await import("../src/app/create-campaign/capabilities.ts");
const { campaignPayload } = await import("../src/app/create-campaign/payload.ts");
const summaries = await import("../src/app/create-campaign/summaries.ts");

const read = (file) => fs.readFileSync(new URL(`../src/app/create-campaign/${file}`, import.meta.url), "utf8");
const essentials = read("EssentialsStep.tsx");
const experience = read("ExperienceStep.tsx");
const narrator = read("NarratorFields.tsx");

const allGates = { solo: false, aiNarrates: true, storyKnownMissing: false, storyUnreachable: false, ttsAvailable: true, mapsAvailable: true };

// The keys={[...]} lists the steps hand to SheetRows.
function drawnKeys(source) {
  return [...source.matchAll(/keys=\{\[([^\]]*)\]\}/g)].flatMap((match) => [...match[1].matchAll(/"(\w+)"/g)].map((key) => key[1]));
}

await test("every switch of the old table sheet is drawn exactly once", () => {
  const every = tableSheet({ ...DEFAULT_DRAFT, ambienceEnabled: true, relationships: "on" }, allGates).flatMap((group) => group.rows.map((row) => row.key));
  assert.equal(every.length, 18, "the table sheet's row count changed; update this test with it");
  // Characters per player is drawn as its three answers side by side
  // (MultiCharacterField), not as a cycling switch.
  const drawn = [
    ...drawnKeys(essentials),
    ...drawnKeys(experience),
    ...drawnKeys(narrator),
    ...(experience.includes("<MultiCharacterField ") ? ["multiCharacter"] : []),
  ];
  for (const key of every) {
    assert.equal(drawn.filter((entry) => entry === key).length, 1, `${key} is drawn ${drawn.filter((entry) => entry === key).length} times`);
  }
  assert.equal(drawn.length, every.length, `a step draws a key the sheet does not have: ${drawn.filter((key) => !every.includes(key))}`);
});

await test("characters per player offers all three answers at once", () => {
  assert.match(experience, /\{ value: "off", label: "One each" \}/);
  assert.match(experience, /\{ value: "one_active", label: "Several, one at a time" \}/);
  assert.match(experience, /\{ value: "all_active", label: "Several, all at once" \}/);
  assert.doesNotMatch(experience, /three-way switch/);
});

await test("a rolled title is in the genre's words and never the one already there", async () => {
  const { rollCampaignTitle } = await import("../src/app/create-campaign/titles.ts");
  let n = 0;
  const steps = () => ((n += 0.137) % 1);
  const first = rollCampaignTitle("cyberpunk", "", steps);
  assert.ok(first.length > 4 && first.length <= 80, first);
  assert.notEqual(rollCampaignTitle("cyberpunk", first, steps), first);
  assert.ok(rollCampaignTitle("unknown-genre", "", steps).length > 4, "an unknown genre falls back to fantasy words");
});

await test("every named group sits on the step that owns it, once", () => {
  const groupsIn = (source) => [...source.matchAll(/groupProps\(groups, "(\w+)"\)/g)].map((match) => match[1]);
  const onEssentials = groupsIn(essentials);
  const onExperience = groupsIn(experience);
  for (const [id, step] of Object.entries(GROUP_STEP)) {
    const where = step === "essentials" ? onEssentials : onExperience;
    assert.equal(where.filter((entry) => entry === id).length, 1, `${id} is not drawn once on ${step}`);
  }
  assert.equal(onEssentials.length + onExperience.length, Object.keys(GROUP_STEP).length);
});

await test("the server's limits keep what the person wanted, and change nothing on a capable server", () => {
  const draft = { ...DEFAULT_DRAFT, dmMode: "steered", ttsEnabled: true };
  const missing = withCapabilities(draft, { story: { configured: false, reachable: false }, images: { configured: true }, tts: { configured: false } });
  assert.equal(missing.draft.dmMode, "human");
  assert.equal(missing.draft.ttsEnabled, false);
  assert.deepEqual(missing.wanted, { dmMode: "steered", ttsEnabled: true });
  const silent = withCapabilities(draft, { story: { configured: true, reachable: false }, images: { configured: false }, tts: { configured: true } });
  assert.equal(silent.draft.dmMode, "human");
  assert.equal(silent.draft.mapsEnabled, true, "maps wait for pictures instead of switching off");
  const capable = withCapabilities(draft, { story: { configured: true, reachable: true }, images: { configured: true }, tts: { configured: true } });
  assert.equal(capable.draft, draft);
  assert.deepEqual(capable.wanted, {});
});

await test("the payload is normalized as it always was", () => {
  const draft = {
    ...DEFAULT_DRAFT,
    title: "  The Ashen Crown ",
    customGenreText: " grim ",
    relationships: "off",
    romance: "on",
    ambienceEnabled: false,
    ambienceAuto: true,
    maxPlayers: 6,
  };
  const ai = campaignPayload(draft, { solo: false, aiNarrates: true });
  assert.equal(ai.title, "The Ashen Crown");
  assert.equal(ai.maxPlayers, 6);
  assert.equal(ai.gameSettings.customGenreText, "grim");
  assert.equal(ai.gameSettings.romance, "off", "romance without bonds");
  assert.equal(ai.gameSettings.ambienceAuto, false, "scene-following without ambience");
  assert.deepEqual(ai.gameSettings.voice, draft.voiceChat);
  assert.ok(!("voiceChat" in ai.gameSettings) && !("houseRules" in ai) && !("loreDrafts" in ai) && !("contentImport" in ai));
  const human = campaignPayload({ ...draft, dmMode: "human" }, { solo: false, aiNarrates: false });
  for (const key of ["aiStorySetup", "narrationGuard", "worldSimulation"]) {
    assert.equal(human.gameSettings[key], false, key);
  }
  assert.equal(human.gameSettings.companions, "off");
  // Solo comes from the entry point: a multiplayer campaign for one is still
  // a multiplayer campaign, and the solo door is one player whatever the count.
  assert.equal(campaignPayload({ ...draft, maxPlayers: 1 }, { solo: false, aiNarrates: true }).maxPlayers, 1);
  assert.equal(campaignPayload({ ...draft, maxPlayers: 6 }, { solo: true, aiNarrates: true }).maxPlayers, 1);
});

await test("the closed groups and the review say what is set, from the draft", () => {
  const draft = { ...DEFAULT_DRAFT };
  assert.match(summaries.narrationSummary(draft, allGates, "Heart"), /^Heart at 1\.00× · the narrator reads the characters$/);
  assert.match(summaries.narrationSummary({ ...draft, ttsAutoCast: true }, allGates, "Heart"), /each speaker gets a voice/);
  assert.match(summaries.narrationSummary({ ...draft, ttsEnabled: false }, allGates, "Heart"), /^Off/);
  assert.match(summaries.narrationSummary(draft, { ...allGates, ttsAvailable: false }, "Heart"), /no speech service/);
  assert.equal(summaries.safetySummary(draft), "Standard · X-card on · no lines or veils · by the book");
  assert.equal(
    summaries.safetySummary({ ...draft, safety: { ...draft.safety, lines: ["a", "b"], veils: ["c"] }, gm: { strictness: "harsh", tone: ["grim"] } }),
    "Standard · X-card on · 2 lines, 1 veil · harsh · grim",
  );
  assert.equal(summaries.customRules(draft), null);
  assert.equal(summaries.customRules({ ...draft, houseRules: "x", variantRules: { ...draft.variantRules, flanking: true } }), "1 variant rule · house rules");
  assert.equal(summaries.variantSummary(draft), "None on · standard rests");
  assert.equal(summaries.playersSummary(draft, { ...allGates, solo: true }), "one character each · changes apply at once");
  assert.equal(summaries.voiceChatSummary({ ...draft, voiceChat: { ...draft.voiceChat, enabled: false } }), "Off");
  assert.match(summaries.prepSummary({ ...draft, contentImport: { ...draft.contentImport, sourceId: "w", select: ["npcs"] } }, "Harbor Prep"), /prep from Harbor Prep/);
});

finish();
