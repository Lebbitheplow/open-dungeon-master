// The hero page after a new character's first save (backlog F23, F26):
// three things to try on a first turn, built from the character's own
// weapons, spells, limited uses and skills through the Hand's cards; the
// reveal line's three rules; where the first save leads, and the account's
// "Don't show this again". Pure, plus a read of the pages that wire it.
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const { freshPlaySheet, threeThingsToTry, revealLine, afterFirstSave } = await import("../src/lib/characters/hero-tips.ts");

const base = {
  subclass: "", alignment: "", gender: "", appearance: "", speed: 30, classes: [], hitDicePools: null,
  gold: 0, copper: 0, feats: [], asiChoices: [], spellcasting: null, portrait: null, notes: "", backstory: "", background: "",
};
const pack = (...names) => names.map((name) => ({ name, qty: 1 }));
const fighter = { id: "f1", name: "Kara", level: 1, sheet: { ...base, name: "Kara", race: "human", class: "fighter",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 }, maxHp: 12, ac: 18, hitDice: { die: "d10", total: 1, spent: 0 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics", "perception"], expertise: [], languages: [], tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] },
  equipment: pack("Chain Mail", "Longsword", "Shield", "Light Crossbow"),
  features: [{ name: "Fighting Style: Dueling", source: "class" }, { name: "Second Wind", source: "class" }] } };
const wizard = { id: "w1", name: "Ilsa", level: 1, sheet: { ...base, name: "Ilsa", race: "high-elf", class: "wizard",
  abilities: { str: 8, dex: 14, con: 13, int: 16, wis: 12, cha: 10 }, maxHp: 7, ac: 12, hitDice: { die: "d6", total: 1, spent: 0 },
  proficiencies: { saves: ["int", "wis"], skills: ["arcana", "history"], expertise: [], languages: [], tools: [], armor: [], weapons: ["dagger", "dart", "sling", "quarterstaff", "light crossbow"] },
  equipment: pack("Quarterstaff", "Spellbook"),
  features: [{ name: "Arcane Recovery", source: "class" }],
  spellcasting: { ability: "int", slots: { "1": { max: 2, used: 0 } }, prepared: ["Magic Missile", "Shield", "Sleep"], known: [], cantrips: ["Fire Bolt", "Mage Hand", "Light"] } } };
const rogue = { id: "r1", name: "Vex", level: 1, sheet: { ...base, name: "Vex", race: "human", class: "rogue",
  abilities: { str: 9, dex: 16, con: 14, int: 13, wis: 11, cha: 15 }, maxHp: 10, ac: 14, hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: { saves: ["dex", "int"], skills: ["stealth", "acrobatics", "perception", "investigation"], expertise: ["stealth", "perception"], languages: [], tools: [], armor: ["light"], weapons: ["simple", "hand crossbow", "longsword", "rapier", "shortsword"] },
  equipment: pack("Rapier", "Shortbow", "Leather", "Dagger"),
  features: [{ name: "Sneak Attack", source: "class" }, { name: "Expertise", source: "class" }] } };
const cleric = { id: "c1", name: "Sera", level: 1, sheet: { ...base, name: "Sera", race: "human", class: "cleric", subclass: "life",
  abilities: { str: 14, dex: 9, con: 15, int: 11, wis: 16, cha: 13 }, maxHp: 10, ac: 16, hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: { saves: ["wis", "cha"], skills: ["medicine", "insight"], expertise: [], languages: [], tools: [], armor: ["light", "medium", "shields"], weapons: ["simple"] },
  equipment: pack("Mace", "Scale Mail", "Shield"),
  features: [],
  spellcasting: { ability: "wis", slots: { "1": { max: 2, used: 0 } }, prepared: ["Cure Wounds", "Bless", "Healing Word"], known: [], cantrips: ["Sacred Flame", "Guidance"] } } };

const fact = (level, castingTime, desc, extra = {}) => ({ level, school: "evocation", castingTime, range: "120 feet", concentration: false, desc, higherLevel: "", ...extra });
const FACTS = {
  "fire bolt": fact(0, "1 action", "You hurl a mote of fire at a creature or object within range. Make a ranged spell attack against the target. On a hit, the target takes 1d10 fire damage."),
  "magic missile": fact(1, "1 action", "You create three glowing darts of magical force. Each dart hits a creature of your choice that you can see within range. A dart deals 1d4 + 1 force damage to its target."),
  shield: fact(1, "1 reaction, which you take when you are hit by an attack", "An invisible barrier of magical force appears and protects you."),
  sleep: fact(1, "1 action", "This spell sends creatures into a magical slumber. Roll 5d8; the total is how many hit points of creatures this spell can affect."),
  "healing word": fact(1, "1 bonus action", "A creature of your choice that you can see within range regains hit points equal to 1d4 + your spellcasting ability modifier."),
  "cure wounds": fact(1, "1 action", "A creature you touch regains a number of hit points equal to 1d8 + your spellcasting ability modifier.", { range: "Touch" }),
  bless: fact(1, "1 action", "You bless up to three creatures of your choice within range.", { concentration: true }),
  "sacred flame": fact(0, "1 action", "Flame-like radiance descends on a creature that you can see within range. The target must succeed on a Dexterity saving throw or take 1d8 radiant damage."),
  guidance: fact(0, "1 action", "You touch one willing creature. Once before the spell ends, the target can roll a d4 and add the number rolled to one ability check of its choice.", { concentration: true, range: "Touch" }),
  "mage hand": fact(0, "1 action", "A spectral, floating hand appears at a point you choose within range."),
  light: fact(0, "1 action", "You touch one object that is no larger than 10 feet in any dimension."),
};

const texts = (tips) => tips.map((tip) => tip.text);

// ---- F23: three things to try ----

await test("a fighter swings the longsword with Dueling counted, uses Second Wind, and leans on Athletics", () => {
  const tips = threeThingsToTry(freshPlaySheet(fighter), FACTS);
  assert.deepEqual(texts(tips), [
    "Swing your Longsword: +5 to hit, 1d8+5",
    "Use Second Wind as a bonus action: heals 1d10+1",
    "You're good at Athletics (+5): climb, jump or shove a foe",
  ]);
  assert.equal(tips[1].note, "1 use, back after a short rest", "the limited use is explained beside it");
  assert.equal(tips[0].note, "");
});

await test("a wizard leads with the spell that out-hits the staff, and names the slot it spends", () => {
  const tips = threeThingsToTry(freshPlaySheet(wizard), FACTS);
  assert.equal(tips.length, 3);
  assert.equal(tips[0].kind, "spell");
  assert.match(tips[0].text, /^Cast (Magic Missile|Sleep)\b/, "a levelled spell is what the slot is for");
  assert.equal(tips[0].note, "Uses a 1st-level slot: you have 2, back after a long rest");
  assert.equal(tips[1].text, "Swing your Quarterstaff: +1 to hit, 1d6-1");
  assert.equal(tips[2].text, "You're good at Arcana (+5): recall what you know of magic");
  assert.ok(!texts(tips).some((text) => /Shield/.test(text)), "a reaction spell is not a thing to try on your turn");
});

await test("a wizard whose spell facts have not arrived gets no spell tip rather than an invented one", () => {
  const tips = threeThingsToTry(freshPlaySheet(wizard), {});
  assert.ok(tips.every((tip) => tip.kind !== "spell"));
  assert.equal(tips.length, 3);
});

await test("a rogue swings the rapier with Sneak Attack's once a turn beside it, then the expertise skill", () => {
  const tips = threeThingsToTry(freshPlaySheet(rogue), FACTS);
  assert.equal(tips[0].text, "Swing your Rapier: +5 to hit, 1d8+3");
  assert.equal(tips[0].note, "Sneak Attack: +1d6 once a turn, when you have advantage or an ally is beside the target");
  assert.equal(tips[1].text, "You're good at Stealth (+7): sneak ahead", "expertise doubles the bonus, and the best skill comes first");
  assert.equal(tips[2].kind, "skill");
});

await test("a cleric's bonus-action spell is named as one", () => {
  const tips = threeThingsToTry(freshPlaySheet(cleric), FACTS);
  const spell = tips.find((tip) => tip.kind === "spell");
  assert.ok(spell, "a spell tip");
  assert.equal(spell.text, "Cast Healing Word as a bonus action: heals 1d4+3");
  assert.equal(spell.note, "Uses a 1st-level slot: you have 2, back after a long rest");
});

await test("a fighter with no weapon at all still gets a fist, and a bow with nothing to shoot is passed over", () => {
  const bare = threeThingsToTry(freshPlaySheet({ ...fighter, sheet: { ...fighter.sheet, equipment: [] } }), FACTS);
  assert.equal(bare[0].kind, "attack");
  assert.match(bare[0].text, /^Swing your Unarmed strike: \+5 to hit/);
  const archer = { ...rogue, sheet: { ...rogue.sheet, equipment: pack("Shortbow", "Dagger") } };
  const tips = threeThingsToTry(freshPlaySheet(archer), FACTS);
  assert.equal(tips[0].text, "Swing your Dagger: +5 to hit, 1d4+3");
});

await test("the fresh play sheet starts with every use in hand", () => {
  const sheet = freshPlaySheet(fighter);
  assert.deepEqual(sheet.resources.second_wind, { max: 1, used: 0 });
  assert.equal(sheet.currentHp, sheet.maxHp);
});

await test("a sheet stored before some fields existed still deals its tips", () => {
  const older = { ...fighter.sheet };
  for (const field of ["classes", "hitDicePools", "feats"]) delete older[field];
  const tips = threeThingsToTry(freshPlaySheet({ ...fighter, sheet: { ...older, proficiencies: { ...older.proficiencies, expertise: undefined } } }), FACTS);
  assert.equal(tips[0].text, "Swing your Longsword: +5 to hit, 1d8+5");
});

// ---- F26: the reveal line ----

await test("the reveal line names an AC of 18 or more first", () => {
  assert.equal(revealLine(freshPlaySheet(fighter)), "AC 18 at level 1, the party's wall");
  const tank = freshPlaySheet({ ...fighter, level: 3, sheet: { ...fighter.sheet, ac: 19 } });
  assert.equal(revealLine(tank), "AC 19 at level 3, the party's wall");
});

await test("then a caster's spell DC of 13 or more, worded by the casting ability", () => {
  assert.equal(revealLine(freshPlaySheet(wizard)), "Spell DC 13, the sharpest mind at the table");
  assert.equal(revealLine(freshPlaySheet(cleric)), "Spell DC 13, the steadiest will at the table");
  const brilliant = freshPlaySheet({ ...wizard, level: 5, sheet: { ...wizard.sheet, abilities: { ...wizard.sheet.abilities, int: 18 } } });
  assert.equal(revealLine(brilliant), "Spell DC 15, the sharpest mind at the table");
});

await test("a weak caster's DC is not praised; the highest score speaks instead", () => {
  const dabbler = freshPlaySheet({ ...wizard, sheet: { ...wizard.sheet, abilities: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 } } });
  assert.equal(revealLine(dabbler), "Dexterity 15, quick hands and quicker feet");
});

await test("otherwise the highest score, with the SRD's order breaking a tie", () => {
  assert.equal(revealLine(freshPlaySheet(rogue)), "Dexterity 16, quick hands and quicker feet");
  const even = freshPlaySheet({ ...rogue, sheet: { ...rogue.sheet, abilities: { str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 } } });
  assert.equal(revealLine(even), "Strength 15, the strongest arm in the room");
});

// ---- when it shows ----

await test("the first save leads to the hero page unless the player turned it off", () => {
  assert.equal(afterFirstSave("abc", false), "/characters/abc/ready");
  assert.equal(afterFirstSave("abc", true), "/characters");
});

await test("a new character's save reads the account's choice and routes through afterFirstSave", () => {
  const page = read("src/app/characters/new/page.tsx");
  assert.match(page, /settings\?\.skipHeroPage === true/, "the account's answer, and only a true one, skips it");
  assert.match(page, /navigateTo\(id \? afterFirstSave\(id, skipHeroPage\.current\) : "\/characters"\)/);
});

await test("an edit never shows the hero page", () => {
  const edit = read("src/app/characters/[characterId]/edit/page.tsx");
  assert.doesNotMatch(edit, /afterFirstSave|\/ready/);
});

await test("the account remembers 'Don't show this again'", () => {
  assert.match(read("src/app/api/profile/route.ts"), /skipHeroPage: z\.boolean\(\)\.optional\(\)/);
  assert.match(read("src/lib/db/users.ts"), /skipHeroPage\?: boolean;/);
  const ready = read("src/app/characters/[characterId]/ready/page.tsx");
  assert.match(ready, /JSON\.stringify\(\{ settings: \{ skipHeroPage: next \} \}\)/, "the checkbox patches the account");
  assert.match(ready, /setSkip\(!next\)/, "a refused save puts the box back");
});

await test("the hero page is a persistent text page with its own focused heading", () => {
  const ready = read("src/app/characters/[characterId]/ready/page.tsx");
  assert.match(ready, /<h1\s[^>]*ref=\{heading\}[^>]*tabIndex=\{-1\}/s, "the heading can take focus");
  assert.match(ready, /heading\.current\?\.focus\(\)/, "and takes it on arrival");
  assert.match(ready, /Three things to try on your turn/);
  assert.match(ready, /Don&apos;t show this again/);
  assert.match(ready, />\s*<GameIcon[^>]*\/> Bring to a table\s*</s);
  assert.match(ready, /<Link href="\/characters"[^>]*>\s*Done\s*<\/Link>/s);
  assert.match(ready, /<UseInCampaignDialog/, "Bring to a table opens the existing join flow");
  assert.doesNotMatch(ready, /navigateTo\(|router\.push|setTimeout\(\(\) => set(Seating|Character)\(null\)/, "nothing moves the player on by itself");
  assert.match(ready, /const motion = lowEffects \? "" : "reveal"/, "its entrance follows the Effects setting");
  assert.match(ready, /<CharacterPortrait/, "the placeholder shows while the portrait paints");
});

console.log(`${passed} hero page checks passed`);
