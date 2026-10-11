// The sound library: the cue catalog's shape, and the rules for changing
// what the table is hearing.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { AMBIENCE_CUES, BED_CUES, MUSIC_CUES, STING_CUES, cueById, cueIds, cueOptions } =
  await import("../src/lib/ambience/catalog.ts");
const {
  EMPTY_AMBIENCE,
  applyAuto,
  describeAmbience,
  inferBedCue,
  inferCue,
  normalizeAmbience,
  sameAmbience,
  setCue,
} = await import("../src/lib/ambience/logic.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("every cue is complete and uniquely named", () => {
  const ids = AMBIENCE_CUES.map((cue) => cue.id);
  assert.equal(new Set(ids).size, ids.length, "two cues share an id");
  assert.ok(BED_CUES.length >= 20, `only ${BED_CUES.length} beds`);
  assert.ok(MUSIC_CUES.length >= 8, `only ${MUSIC_CUES.length} music cues`);
  assert.ok(STING_CUES.length >= 8, `only ${STING_CUES.length} stings`);
  for (const cue of AMBIENCE_CUES) {
    assert.match(cue.id, /^[a-z][a-z_]*$/, `${cue.id} is not a usable tool enum value`);
    assert.ok(cue.label, `${cue.id} has no label`);
    assert.ok(cue.blurb, `${cue.id} has no blurb`);
    assert.ok(cue.search.length > 0, `${cue.id} tells the fetch script nothing to look for`);
    assert.ok(cue.gain > 0 && cue.gain <= 1, `${cue.id} has a nonsense gain`);
    // A bed or a music cue with no keywords can never be inferred, which is
    // half the point of the layer. Stings are only ever asked for by name.
    if (cue.layer !== "sting") {
      assert.ok(cue.keywords.length > 0, `${cue.id} can never be inferred`);
    }
  }
});

test("lookup respects the layer", () => {
  assert.equal(cueById("tavern")?.layer, "bed");
  assert.equal(cueById("battle")?.layer, "music");
  assert.equal(cueById("thunder")?.layer, "sting");
  assert.equal(cueById("no_such_cue"), null);
  assert.equal(cueById(""), null);
  assert.equal(cueIds("bed").length, BED_CUES.length);
  assert.deepEqual(
    cueOptions("music").map((option) => option.value),
    MUSIC_CUES.map((cue) => cue.id),
  );
});

test("a stored row that names nothing readable is silence", () => {
  assert.deepEqual(normalizeAmbience(null), EMPTY_AMBIENCE);
  assert.deepEqual(normalizeAmbience("tavern"), EMPTY_AMBIENCE);
  assert.deepEqual(normalizeAmbience({ bed: "gone_from_the_catalog" }), EMPTY_AMBIENCE);
  // A cue filed under the wrong layer is not a bed, whatever the row says.
  assert.equal(normalizeAmbience({ bed: "battle" }).bed, null);
  assert.equal(normalizeAmbience({ music: "tavern" }).music, null);
});

test("holding a silent layer is dropped on the way in", () => {
  // It would otherwise block every future inference for a layer that is not
  // even playing.
  const state = normalizeAmbience({ bed: null, music: "battle", held: ["bed", "music"] });
  assert.deepEqual(state.held, ["music"]);
});

test("naming a cue changes the layer and leaves the other alone", () => {
  const first = setCue(EMPTY_AMBIENCE, "bed", "tavern", { at: "t1" });
  assert.equal(first.changed, true);
  assert.equal(first.state.bed, "tavern");
  assert.equal(first.state.music, null);
  // The same cue again is not a change, so nothing is announced.
  const again = setCue(first.state, "bed", "tavern");
  assert.equal(again.changed, false);
  const silenced = setCue(first.state, "bed", null);
  assert.equal(silenced.changed, true);
  assert.equal(silenced.state.bed, null);
});

test("a guess never overwrites a held layer", () => {
  const held = setCue(EMPTY_AMBIENCE, "bed", "tavern", { hold: true }).state;
  assert.deepEqual(held.held, ["bed"]);
  const guessed = applyAuto(held, { bed: "cave" });
  assert.equal(guessed.changed, false);
  assert.equal(guessed.state.bed, "tavern");
  // A person naming another cue outright still gets their way.
  assert.equal(setCue(held, "bed", "cave").state.bed, "cave");
  // And naming one without hold releases the pin.
  assert.deepEqual(setCue(held, "bed", "cave").state.held, []);
});

test("a guess with no opinion about a layer leaves it alone", () => {
  const state = setCue(EMPTY_AMBIENCE, "music", "tension").state;
  // undefined is "no opinion"; null is "make it silent". They are not the
  // same, and confusing them would have combat music cut the room tone.
  assert.equal(applyAuto(state, { bed: "cave" }).state.music, "tension");
  assert.equal(applyAuto(state, { bed: "cave", music: null }).state.music, null);
});

test("silencing a layer never leaves it held", () => {
  const held = setCue(EMPTY_AMBIENCE, "music", "battle", { hold: true }).state;
  const off = setCue(held, "music", null, { hold: true });
  assert.equal(off.state.music, null);
  assert.deepEqual(off.state.held, []);
});

test("a place description picks the bed a DM would have picked", () => {
  assert.equal(inferBedCue("The Rusted Anchor, a low-beamed tavern by the docks"), "tavern");
  assert.equal(inferBedCue("A dripping cavern, the floor slick with run-off"), "cave");
  assert.equal(inferBedCue("Endless dunes under a white sky"), "desert");
  assert.equal(inferBedCue("The market square, packed with stalls"), "market");
  assert.equal(inferBedCue("A ford across the river, waist deep"), "river");
  assert.equal(inferBedCue("Wind off the sea, gulls over the shore"), "coast");
});

test("the more specific keyword wins", () => {
  // "dark forest" is two words and beats the bare "forest" inside it.
  assert.equal(inferBedCue("a dark forest, older than the road"), "deep_forest");
  assert.equal(inferBedCue("a forest, bright and loud with birds"), "forest");
});

test("a word that merely contains a keyword is not a match", () => {
  // "sea" inside "season", "mine" inside "determined", "camp" in "campaign".
  assert.equal(inferBedCue("the season had just turned"), null);
  assert.equal(inferBedCue("she was determined to go on"), null);
  assert.equal(inferBedCue("a campaign three winters old"), null);
});

test("nothing to hear reads as nothing", () => {
  assert.equal(inferBedCue(""), null);
  assert.equal(inferBedCue("   "), null);
  assert.equal(inferBedCue("He nods once and says nothing."), null);
  assert.equal(inferCue("a low-beamed tavern", "sting"), null);
});

test("music can be read too", () => {
  assert.equal(inferCue("the ambush is sprung", "music")?.cueId, "battle");
  assert.equal(inferCue("a funeral, and nobody speaks", "music")?.cueId, "sorrow");
});

test("sameAmbience compares held sets, not their order", () => {
  const a = { bed: "cave", music: "battle", held: ["bed", "music"], updatedAt: "t1" };
  const b = { bed: "cave", music: "battle", held: ["music", "bed"], updatedAt: "t2" };
  assert.equal(sameAmbience(a, b), true);
  assert.equal(sameAmbience(a, { ...a, bed: "tavern" }), false);
  assert.equal(sameAmbience(a, { ...a, held: ["bed"] }), false);
});

test("the description reads like something a DM would say", () => {
  assert.equal(describeAmbience(EMPTY_AMBIENCE), "The room goes quiet.");
  assert.match(describeAmbience(setCue(EMPTY_AMBIENCE, "bed", "tavern").state), /tavern/);
  const both = applyAuto(EMPTY_AMBIENCE, { bed: "cave", music: "dread" }).state;
  assert.match(describeAmbience(both), /cave.*music/);
});

console.log(`ambience: ${passed} tests passed`);

// ---- the library on disk, the fetch gates, the pack and the player ----

const { nextTrackFile, parseManifest, parseTrackFile } = await import("../src/lib/ambience/library.ts");
const { buildPack, readPack } = await import("../src/lib/ambience/pack.ts");
const { AmbiencePlayer, CROSSFADE_MS, DUCK } = await import("../src/lib/ambience/player.ts");
const { acceptLicense, admit, durationOk, redistributable, relevant, spokenWord } = await import("./lib/ambience-gate.mjs");
const { packable } = await import("../src/lib/ambience/pack.ts");

test("a track file names its cue and its take", () => {
  assert.deepEqual(parseTrackFile("tavern.mp3"), { cueId: "tavern", variant: 1, extension: ".mp3" });
  assert.deepEqual(parseTrackFile("battle-3.ogg"), { cueId: "battle", variant: 3, extension: ".ogg" });
  assert.equal(parseTrackFile("manifest.json"), null);
  assert.equal(parseTrackFile("polka.mp3"), null, "a file for no cue belongs to nothing");
  assert.equal(parseTrackFile("../tavern.mp3"), null, "a path is not a track name");
  assert.equal(parseTrackFile("deep_forest-2.m4a").cueId, "deep_forest");
});

test("the next take takes the lowest free number", () => {
  assert.equal(nextTrackFile("tavern", ".mp3", []), "tavern.mp3");
  assert.equal(nextTrackFile("tavern", ".mp3", ["tavern.ogg"]), "tavern-2.mp3");
  assert.equal(nextTrackFile("tavern", ".mp3", ["tavern.ogg", "tavern-2.mp3", "tavern-4.mp3"]), "tavern-3.mp3");
  assert.equal(nextTrackFile("tavern", ".mp3", ["tavern-2.mp3"]), "tavern.mp3", "the plain name is free");
});

test("the manifest reads in both shapes and skips what is not on disk", () => {
  const onDisk = new Set(["tavern.mp3", "battle.mp3", "battle-2.mp3"]);
  const exists = (file) => onDisk.has(file);
  const old = parseManifest({ tracks: { tavern: { file: "tavern.mp3", title: "Old shape" } } }, exists);
  assert.equal(old.length, 1);
  assert.equal(old[0].url, "/ambience/tavern.mp3");
  assert.equal(old[0].title, "Old shape");
  const tracks = parseManifest(
    {
      tracks: {
        battle: [{ file: "battle.mp3" }, { file: "battle-2.mp3", title: "Second" }, { file: "battle-3.mp3" }],
        cave: [{ file: "cave.mp3" }],
        tavern: [{ file: "battle.mp3" }],
        polka: [{ file: "polka.mp3" }],
      },
    },
    exists,
  );
  assert.deepEqual(
    tracks.map((track) => [track.cueId, track.variant]),
    [["battle", 1], ["battle", 2]],
    "a missing file, a file named for another cue and an unknown cue are all left out",
  );
  assert.equal(tracks[1].title, "Second");
});

test("the gate refuses spoken word, the wrong length and the off-topic", () => {
  assert.ok(spokenWord("LibriVox - Beast in the cave lovecraft sc.ogg"));
  assert.ok(spokenWord("LL-Q1860 (eng)-Flame, not lame-sewer rat.wav"));
  assert.ok(spokenWord("Brussels Communes Audio Wikipedia - Forest.wav"));
  assert.ok(!spokenWord("Rain thunder steps.ogg"));
  assert.ok(relevant("cave ambience water drips", "Dripping cave.ogg"));
  assert.ok(!relevant("cave ambience water drips", "Lully; Minuet from the temple of peace.ogg"));
  assert.ok(durationOk("bed", 0), "an unknown length passes");
  assert.ok(durationOk("bed", 95));
  assert.ok(!durationOk("bed", 12));
  assert.ok(!durationOk("sting", 90), "ninety seconds of thunder is a storm, not a clap");
  assert.ok(durationOk("sting", 3));
  assert.ok(!durationOk("music", 30));
  const licensed = { title: "Cave drips.ogg", author: "x", license: "Public domain (CC0 or PD Mark)", seconds: 120 };
  assert.equal(admit(licensed, { layer: "bed", query: "cave ambience" }).ok, true);
  assert.equal(admit({ ...licensed, license: null }, { layer: "bed", query: "cave ambience" }).why, "licence");
  assert.equal(admit({ ...licensed, title: "Dark cave", categories: "Audio versions of Wikipedia articles" }, { layer: "bed", query: "cave ambience" }).why, "spoken word");
  assert.equal(
    admit({ ...licensed, title: "LibriVox - The cave.ogg" }, { layer: "bed", query: "cave ambience" }).why,
    "spoken word",
  );
  assert.match(admit({ ...licensed, seconds: 5 }, { layer: "bed", query: "cave ambience" }).why, /wrong length/);
});

test("the licence gate takes free licences and refuses the rest", () => {
  assert.ok(acceptLicense("CC0", ""));
  assert.ok(acceptLicense("", "https://creativecommons.org/publicdomain/mark/1.0/"));
  assert.match(acceptLicense("CC BY 4.0", ""), /^CC BY \(/, "attribution is fine: the app keeps the credit");
  assert.match(acceptLicense("CC-BY-SA 3.0", ""), /BY-SA/);
  assert.match(acceptLicense("OGA-BY 3.0", ""), /^OGA-BY/);
  assert.match(acceptLicense("CC0 CC-BY 3.0", ""), /^Public domain/, "the freest of several wins");
  assert.equal(acceptLicense("CC BY-NC 4.0", ""), null, "NC is refused");
  assert.equal(acceptLicense("CC BY-ND 4.0", ""), null, "ND is refused");
  assert.equal(acceptLicense("", ""), null, "a blank licence is refused");
  assert.equal(acceptLicense("CC BY 4.0", "", true), null, "--public-domain-only narrows it");
  assert.ok(acceptLicense("CC0", "", true));
});

test("what may travel in the pack", () => {
  assert.ok(redistributable("Public domain (CC0 or PD Mark)"));
  assert.ok(redistributable("CC BY 4.0 (attribution required)"));
  assert.ok(redistributable("OGA-BY (attribution required)"));
  assert.ok(!redistributable("Declared by the operator"));
  assert.ok(packable({ origin: "fetched", license: "CC BY 4.0 (attribution required)" }));
  assert.ok(packable({ origin: "pack", license: "Public domain (CC0 or PD Mark)" }));
  assert.ok(!packable({ origin: "local", license: "CC0" }), "the operator's own files stay home");
  assert.ok(!packable({ origin: "fetched", license: "Test material, not for release" }));
  assert.ok(!packable({ origin: "generated", license: "Generated locally" }), "takes from a model only when asked");
  assert.ok(packable({ origin: "generated", license: "Generated locally" }, { includeGenerated: true }));
  assert.ok(!packable(undefined));
});

test("spoken word is caught by category and by byline too", () => {
  assert.ok(spokenWord("Duffy's Tavern (film).ogg", "JohnAnkerBow", "Self-published work|Spoken English Wikipedia"));
  assert.ok(spokenWord("Remarks by President Reagan at Raleigh Tavern.mp3"));
  assert.ok(!spokenWord("Crowded Pub", "Bobjt", "CC0|Sound effects"));
  const tagged = { title: "Crowded Pub", author: "Bobjt", license: "Public domain (CC0 or PD Mark)", seconds: 0, tagged: true };
  assert.equal(admit(tagged, { layer: "bed", query: "tavern" }).ok, true, "a source that matched on its tags is not asked for the word");
  assert.equal(admit({ ...tagged, tagged: false }, { layer: "bed", query: "tavern" }).why, "off topic");
  const commons = { title: "Keep the Home Fires Burning.ogg", author: "x", license: "Public domain (CC0 or PD Mark)", seconds: 180 };
  assert.equal(admit({ ...commons, categories: "1914 songs|Ivor Novello" }, { layer: "bed", query: "keep" }).why, "music, not a sound");
  assert.equal(admit({ ...commons, title: "Sunshine Coast rower.ogg", categories: "People of Queensland" }, { layer: "bed", query: "coast" }).why, "not filed as a sound");
  assert.equal(admit({ ...commons, title: "Monplaisir - 07 - desert.ogg", categories: "Free Music Archive|Ambient music" }, { layer: "bed", query: "desert" }).why, "music, not a sound", "an album filed as ambient music is still music");
  assert.equal(admit({ ...commons, title: "Rain thunder steps.ogg", categories: "Audio files of thunder|Sounds of rain" }, { layer: "bed", query: "rain" }).ok, true);
  assert.equal(admit({ ...commons, title: "Plain Antvireo XC249644.mp3", categories: "Xeno-canto|Dysithamnus mentalis (audio)|Audio files of birds" }, { layer: "bed", query: "plain" }).why, "a single species, not a place");
  assert.equal(admit({ ...commons, title: "Rain.ogg", categories: "" }, { layer: "bed", query: "rain" }).why, "not filed as a sound", "an uncategorised upload is no evidence");
  assert.equal(admit({ ...commons, title: "Rain.ogg" }, { layer: "bed", query: "rain" }).ok, true, "a source with no categories is judged on the rest");
});

await (async () => {
  const entries = [
    { file: "battle.mp3", data: Buffer.from("one"), credit: { title: "Battle (take 1)", author: "Made here", license: "Generated", origin: "generated" } },
    { file: "battle-2.mp3", data: Buffer.from("two"), credit: { title: "Battle (take 2)", author: "Made here", license: "Generated", origin: "generated" } },
  ];
  const zip = await buildPack(entries);
  const back = await readPack(zip);
  assert.deepEqual(
    back.map((entry) => [entry.file, entry.data.toString(), entry.credit.title, entry.credit.origin]),
    [["battle.mp3", "one", "Battle (take 1)", "pack"], ["battle-2.mp3", "two", "Battle (take 2)", "pack"]],
  );
  await assert.rejects(buildPack([{ file: "../evil.mp3", data: Buffer.from("x"), credit: {} }]), /not a track file name/);
  // A pack with a stray file and one for a cue this catalog does not know
  // installs what it can.
  const JSZip = (await import("jszip")).default;
  const stray = new JSZip();
  stray.file("README.txt", "hello");
  stray.file("polka.mp3", "oompah");
  stray.file("cave.mp3", "drip");
  const entriesBack = await readPack(await stray.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(entriesBack.map((entry) => entry.file), ["cave.mp3"]);
  await assert.rejects(readPack(await new JSZip().file("README.txt", "x").generateAsync({ type: "nodebuffer" })), /no tracks/);
  passed += 1;
})();

// A pretend <audio>: it plays when asked, reports a duration, and the test
// moves its clock.
function fakeAudioFactory({ refuse = false, duration = 100 } = {}) {
  const made = [];
  const released = [];
  const create = (url) => {
    const listeners = {};
    const audio = {
      src: url,
      loop: false,
      volume: 1,
      currentTime: 0,
      duration,
      paused: true,
      ended: false,
      preload: "",
      play() {
        if (refuse) {
          return Promise.reject(new Error("NotAllowedError"));
        }
        audio.paused = false;
        return Promise.resolve();
      },
      pause() {
        audio.paused = true;
      },
      addEventListener(type, listener) {
        (listeners[type] ??= []).push(listener);
      },
      removeEventListener(type, listener) {
        listeners[type] = (listeners[type] ?? []).filter((entry) => entry !== listener);
      },
      fire(type) {
        for (const listener of listeners[type] ?? []) listener();
      },
    };
    made.push(audio);
    return audio;
  };
  return { made, released, create, release: (audio) => released.push(audio) };
}

function makePlayer(options = {}) {
  let now = 0;
  const fake = fakeAudioFactory(options);
  const player = new AmbiencePlayer({ create: fake.create, release: fake.release, now: () => now });
  const advance = (ms) => {
    now += ms;
    player.tick();
  };
  return { player, fake, advance, clock: () => now };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

await (async () => {
  const { player, fake, advance } = makePlayer();
  player.setTracks({ tavern: ["/ambience/tavern.mp3"], battle: ["/ambience/battle.mp3", "/ambience/battle-2.mp3"] });
  player.setLevels({ master: 1, bed: 1, music: 1, muted: false, ducked: false });
  player.setScene("tavern", null);
  assert.equal(fake.made.length, 0, "nothing plays before a gesture");
  player.setUnlocked(true);
  await flush();
  assert.equal(fake.made.length, 1);
  assert.equal(fake.made[0].src, "/ambience/tavern.mp3");
  assert.equal(fake.made[0].paused, false);
  assert.equal(fake.made[0].volume, 0, "a cue fades in from silence");
  advance(CROSSFADE_MS);
  assert.equal(fake.made[0].volume, cueById("tavern").gain, "landed on the listener's volume times the cue's trim");
  // A cue change crosses: the tavern fades out while the cave comes up.
  player.setTracks({ ...{ tavern: ["/ambience/tavern.mp3"], cave: ["/ambience/cave.mp3"] } });
  player.setScene("cave", null);
  await flush();
  assert.equal(fake.made.length, 2);
  advance(CROSSFADE_MS / 2);
  assert.ok(fake.made[0].volume > 0 && fake.made[0].volume < cueById("tavern").gain, "the old one is on its way down");
  assert.ok(fake.made[1].volume > 0, "the new one is on its way up");
  advance(CROSSFADE_MS);
  assert.equal(fake.made[0].paused, true, "gone once silent");
  assert.ok(fake.released.includes(fake.made[0]), "and let go of");
  assert.equal(player.snapshot().bed.cueId, "cave");
  player.dispose();
  passed += 1;
})();

await (async () => {
  const { player, fake, advance } = makePlayer({ duration: 60 });
  player.setTracks({ battle: ["/ambience/battle.mp3", "/ambience/battle-2.mp3"] });
  player.setLevels({ master: 1, bed: 1, music: 1, muted: false, ducked: false });
  player.setUnlocked(true);
  player.setScene(null, "battle");
  await flush();
  const first = fake.made[0];
  const firstUrl = first.src;
  const snapshot = player.snapshot().music;
  assert.equal(snapshot.takes, 2);
  assert.ok(snapshot.take === 1 || snapshot.take === 2);
  advance(CROSSFADE_MS);
  // Near the end of the take the next one starts under it.
  first.currentTime = 60 - CROSSFADE_MS / 1000 + 0.1;
  advance(50);
  assert.equal(fake.made.length, 2, "the next take started before this one ended");
  assert.notEqual(fake.made[1].src, firstUrl, "and it is the other take");
  advance(CROSSFADE_MS);
  assert.equal(first.paused, true);
  assert.equal(player.snapshot().music.take, fake.made[1].src.endsWith("-2.mp3") ? 2 : 1);
  // Skip goes on to the next one now.
  player.skip("music");
  await flush();
  assert.equal(fake.made.length, 3);
  assert.equal(fake.made[2].src, firstUrl, "two takes alternate");
  // A take that ended while the tab's timers were asleep still hands over.
  advance(CROSSFADE_MS);
  fake.made[2].fire("ended");
  await flush();
  assert.equal(fake.made.length, 4, "ended handed over without waiting for a tick");
  player.dispose();
  passed += 1;
})();

await (async () => {
  const { player, fake, advance } = makePlayer();
  player.setTracks({ tavern: ["/ambience/tavern.mp3"], calm: ["/ambience/calm.mp3"] });
  player.setLevels({ master: 0.5, bed: 1, music: 0.5, muted: false, ducked: false });
  player.setUnlocked(true);
  player.setScene("tavern", "calm");
  await flush();
  advance(CROSSFADE_MS);
  const [bed, music] = fake.made;
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(bed.volume, 0.5 * cueById("tavern").gain), "the room sits at master times its trim");
  assert.ok(near(music.volume, 0.5 * 0.5 * cueById("calm").gain), "the music is halved by its own level");
  player.setLevels({ ducked: true });
  assert.ok(near(bed.volume, 0.5 * cueById("tavern").gain * DUCK), "ducked under narration at once");
  player.setLevels({ ducked: false, muted: true });
  assert.equal(bed.volume, 0);
  assert.equal(music.volume, 0);
  player.setLevels({ muted: false, master: 1 });
  assert.ok(near(bed.volume, cueById("tavern").gain));
  player.dispose();
  assert.equal(bed.paused, true);
  assert.equal(music.paused, true);
  passed += 1;
})();

await (async () => {
  // The scene usually lands before the library does: the cue waits for its
  // files rather than being lost.
  const { player, fake } = makePlayer();
  player.setUnlocked(true);
  player.setScene("tavern", "battle");
  assert.equal(player.snapshot().bed.cueId, null, "nothing to play yet");
  player.setTracks({ tavern: ["/ambience/tavern.mp3"] });
  await flush();
  assert.equal(player.snapshot().bed.cueId, "tavern", "played once its file arrived");
  assert.equal(player.snapshot().music.cueId, null, "a cue with no file stays silent");
  assert.equal(fake.made.length, 1);
  player.setTracks({ tavern: ["/ambience/tavern.mp3"], battle: ["/ambience/battle.mp3"] });
  await flush();
  assert.equal(player.snapshot().music.cueId, "battle", "and comes in when the library grows");
  player.setTracks({});
  assert.equal(player.snapshot().bed.cueId, null, "a library that lost the file goes quiet");
  player.dispose();
  passed += 1;
})();

await (async () => {
  const { player, fake } = makePlayer({ refuse: true });
  player.setTracks({ tavern: ["/ambience/tavern.mp3"] });
  player.setUnlocked(true);
  player.setScene("tavern", null);
  await flush();
  assert.equal(player.snapshot().blocked, true, "a refused play is reported, not swallowed");
  assert.equal(player.snapshot().bed.cueId, "tavern", "and the cue is kept for the next try");
  player.setUnlocked(false);
  player.setUnlocked(true);
  await flush();
  assert.equal(fake.made.length, 2, "an unlock tries again");
  // A cue with no file here is silence, not an error; a sting needs a file
  // and an unlock.
  player.setScene("crypt", null);
  assert.equal(player.snapshot().bed.cueId, null);
  player.sting("thunder");
  assert.equal(fake.made.length, 2, "no file, no sting");
  player.dispose();
  passed += 1;
})();

await (async () => {
  const { player, fake } = makePlayer();
  player.setTracks({ thunder: ["/ambience/thunder.ogg"] });
  player.setLevels({ master: 1, bed: 1, music: 1, muted: false, ducked: false });
  player.setUnlocked(true);
  player.sting("thunder");
  player.sting("thunder");
  player.sting("thunder");
  player.sting("thunder");
  await flush();
  assert.equal(fake.made.length, 3, "stings share a pool of three elements");
  player.setLevels({ muted: true });
  player.sting("thunder");
  assert.equal(fake.made.length, 3, "a muted listener hears no sting");
  player.dispose();
  assert.equal(fake.released.length, 3);
  passed += 1;
})();

console.log(`ambience: ${passed} tests passed (library, gates, pack and player included)`);
