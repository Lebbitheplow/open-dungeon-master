// The player's and the DM's screens against what the second visual check
// found (/tmp/odm-enf2/look): every number a card or a chip shows comes from
// the engine's own pure functions, and every picture a screen asks for is a
// file that exists. Pure: no server, no database beyond the content pack
// when one is installed (the spell rows; the baked answers stand in without).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const onDisk = (src) => existsSync(path.join(PUBLIC, src.replace(/^\//, "")));

const { deriveHand, FRESH_TURN } = await import("../src/lib/battlemap/hand.ts");
const { withReactions } = await import("../src/lib/battlemap/hand-react.ts");
const { characterHealthWord } = await import("../src/lib/battlemap/view-stage.ts");
const { healthWord } = await import("../src/lib/battlemap/health-words.ts");
const { allGlyphIds, conditionIconKey, glyphIconKey } = await import("../src/lib/battlemap/condition-glyphs.ts");
const { iconCandidates, iconPath } = await import("../src/lib/icons.ts");
const { describeAdjudicationResult } = await import("../src/lib/dm/catalog-result.ts");
const { knownZoneCells } = await import("../src/lib/battlemap/zone-known.ts");
const { resolveAttackWeapon, weaponAttackProfile } = await import("../src/lib/dm/attack-logic.ts");
const { computeSheetDerived } = await import("../src/lib/srd/index.ts");
const { combatRiders } = await import("../src/lib/srd/feature-effects.ts");
const { findSpellByName, spellDamageFor } = await import("../src/lib/content/index.ts");
const { bundledSpellFacts } = await import("../src/lib/srd/spell-facts.ts");
const { thirdCasterPickRefusal } = await import("../src/app/campaigns/[campaignId]/level-up-preview.ts");
const { isWornGear } = await import("../src/components/sheet/sheet-state.ts");
const { RESOURCE_DEFS } = await import("../src/lib/srd/class-resources.ts");
const { AUTHORED_TABLE } = await import("../src/lib/srd/authored-effects.ts");

let passed = 0;
function test(name, fn) {
  try {
    fn();
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
  passed += 1;
}

function sheet(overrides = {}) {
  return {
    id: "s1", campaignId: "c1", userId: "u1", libraryCharacterId: null,
    name: "Kael", race: "human", class: "fighter", subclass: "", background: "", alignment: "", gender: "",
    level: 5, xp: 0,
    abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    maxHp: 44, currentHp: 44, tempHp: 0, ac: 16, acOverride: false, speed: 30,
    hitDice: { die: "d10", total: 5, spent: 0 }, classes: [], hitDicePools: null,
    proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: [], tools: [], armor: [], weapons: ["simple", "martial"] },
    equipment: [], gold: 0, copper: 0, feats: [], features: [], spellcasting: null,
    conditions: [], conditionMeta: {}, resources: {}, wildShape: null, pets: [], exhaustion: 0,
    deathSaves: null, concentratingOn: null, portrait: null, notes: "", backstory: "",
    isCompanion: false, companionKind: null, personality: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}

// The facts the Hand fetches for a spell: the pack's row when installed, the
// bundled checklist otherwise (whose missing prose sends both the card and
// the engine to the same baked answers).
function factsFor(names) {
  const out = {};
  for (const name of names) {
    const entry = findSpellByName(name);
    const bundled = bundledSpellFacts(name);
    const text = (value) => (typeof value === "string" ? value : "");
    out[name.toLowerCase()] = {
      level: entry?.level ?? bundled?.level ?? 1,
      school: entry?.school ?? "",
      castingTime: entry ? text(entry.data.casting_time) : "1 action",
      range: entry ? text(entry.data.range) : "",
      desc: entry ? text(entry.data.desc) : "",
      higherLevel: entry ? text(entry.data.higher_level) : "",
      concentration: entry?.concentration ?? bundled?.concentration ?? false,
    };
  }
  return out;
}

// ---- 1: one Shield while the prompt is up ----

test("the reaction prompt's Shield replaces the prepared Shield card, so the hand shows it once", () => {
  const prompt = [{ id: "reaction:shield", name: "Shield", cost: "reaction", intent: { card: "reaction" } }];
  const hand = [
    { id: "spell:shield", name: "Shield", cost: "reaction", intent: { card: "reaction" } },
    { id: "spell:fire bolt", name: "Fire Bolt", cost: "action", intent: { card: "spell" } },
  ];
  const merged = withReactions(prompt, hand);
  assert.deepEqual(merged.map((card) => card.id), ["reaction:shield", "spell:fire bolt"]);
  assert.equal(withReactions([], hand), hand, "no prompt, the hand as it was");
});

// ---- 3: health words against the effective maximum ----

test("a character at full hit points under exhaustion 4 reads unharmed, not bloodied", () => {
  const tired = sheet({ maxHp: 40, currentHp: 20, exhaustion: 4 });
  assert.equal(healthWord(20, 40), "bloodied", "the stored maximum would say bloodied");
  assert.equal(characterHealthWord(tired), "unharmed");
  assert.equal(characterHealthWord({ ...tired, currentHp: 0 }), "down");
});

// ---- 4: a magic weapon swings as the engine swings it ----

test("an attuned Berserker Axe is an attack card with the engine's die, bonus and riders", () => {
  const brann = sheet({ equipment: [{ name: "Berserker Axe", qty: 1, equipped: true, attuned: true }] });
  const card = deriveHand(brann).find((entry) => entry.id === "attack:berserker axe");
  assert.ok(card, "the axe has a card");
  const resolved = resolveAttackWeapon(brann.equipment, brann.proficiencies.weapons, "Berserker Axe");
  const profile = weaponAttackProfile(computeSheetDerived(brann), brann.proficiencies.weapons, resolved, {
    riders: combatRiders(brann),
    martialArts: false,
  });
  assert.equal(card.toHit, profile.toHit);
  assert.equal(card.damage, profile.damageExpression);
  assert.equal(card.damageType, "slashing");
  assert.equal(profile.magicBonus, 1, "the +1 rides along");
});

// ---- 6 and 7: every picture a screen asks for exists ----

test("the painted icon index matches the icon folders, so no screen asks for a missing file", () => {
  const index = JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "painted-icons.json"), "utf8"));
  for (const [kind, slugs] of Object.entries(index)) {
    const files = readdirSync(path.join(PUBLIC, "assets", "icons", kind))
      .filter((file) => file.endsWith(".webp"))
      .map((file) => file.slice(0, -5))
      .sort();
    assert.deepEqual(slugs, files, `${kind}: painted-icons.json is stale; re-run scripts/generate-icons.mjs --reencode`);
  }
});

test("every Hand card's icon is a file that exists (Search, Escape, Stand up, Flurry of Blows included)", () => {
  const fighter = sheet({ conditions: ["grappled", "prone"], equipment: [{ name: "Longsword", qty: 1 }, { name: "Chain Mail", qty: 1, equipped: true }] });
  const monk = sheet({
    class: "monk",
    features: [{ name: "Martial Arts" }, { name: "Ki" }, { name: "Flurry of Blows" }, { name: "Patient Defense" }, { name: "Step of the Wind" }],
    resources: { ki: { max: 5, used: 0 } },
  });
  const rogue = sheet({ class: "rogue", features: [{ name: "Cunning Action" }, { name: "Sneak Attack" }], equipment: [{ name: "Shortbow", qty: 1 }] });
  const missing = [];
  for (const hero of [fighter, monk, rogue]) {
    for (const card of deriveHand(hero, FRESH_TURN)) {
      const tries = iconCandidates(card.icon);
      if (tries.length && !onDisk(tries[0])) missing.push(`${card.name}: ${tries[0]}`);
      // A basic action has no family to fall back on: its own must exist.
      if (card.icon.kind === "action" && !tries.length) missing.push(`${card.name}: no icon at all`);
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(onDisk(iconPath("action", "search")));
  assert.ok(onDisk(iconPath("action", "escape")));
  assert.ok(onDisk(iconPath("action", "stand-up")));
  assert.ok(onDisk(iconPath("feature", "Flurry of Blows")));
});

test("every feature the Hand deals by name has its own painting, not its class's emblem", () => {
  // An innate spell counter (a tiefling's Hellish Rebuke) is painted as its spell.
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "srd", "manifest", "spells.json"), "utf8"));
  const spellNames = new Set((Array.isArray(manifest) ? manifest : manifest.spells ?? Object.values(manifest)).map((spell) => spell.n.toLowerCase()));
  const names = new Set(["Flurry of Blows", "Uncanny Dodge", "Deflect Missiles", "Slow Fall", "Cutting Words", "Protection"]);
  for (const def of RESOURCE_DEFS) {
    if (def.passive || def.id === "ki" || def.id === "sub_superiority_dice" || def.effect.kind === "recover_slots") continue;
    if (!spellNames.has(def.displayName.toLowerCase())) names.add(def.displayName);
  }
  for (const entry of Object.values(AUTHORED_TABLE)) {
    for (const spend of entry.spends ?? []) if (spend.fight !== "out" && spend.does.kind !== "choose") names.add(spend.name);
    for (const reaction of entry.reactions ?? []) names.add(reaction.name);
  }
  const bare = [...names].filter((name) => !iconCandidates({ kind: "feature", key: name, family: null }).length);
  assert.deepEqual(bare, [], "paint them: node scripts/generate-icons.mjs --only feature");
});

test("every condition glyph id resolves to an existing painting", () => {
  const missing = allGlyphIds().filter((id) => !onDisk(iconPath("condition", glyphIconKey({ id }))));
  assert.deepEqual(missing, []);
  for (const condition of ["exhaustion 2", "Hidden", "searing metal", "in a maze", "poisoned weapon", "a story curse"]) {
    assert.ok(onDisk(iconPath("condition", conditionIconKey(condition))), condition);
  }
});

// ---- 8: console result lines read cleanly ----

test("console result lines say each thing once, name the save, and the lair's action", () => {
  const area = describeAdjudicationResult({
    ok: true, dc: 15, saveAbility: "dex", damageRolled: 24,
    results: [{ target: "Goblin 1", success: false, save: 4, damage: 24, health: "dead", dead: true }],
  }).map((line) => line.text);
  assert.ok(area.includes("DEX save, DC 15"), area.join(" | "));
  assert.ok(area.includes("Goblin 1: failed the save (4), 24 damage, dead"), area.join(" | "));
  assert.ok(!area.some((line) => /^Dc:/.test(line)));
  const lair = describeAdjudicationResult({ ok: true, round: 2, note: "The lair acts on initiative 20 of round 2: the ceiling cracks.", lairActions: [] }).map((line) => line.text);
  assert.deepEqual(lair, ["The lair acts on initiative 20 of round 2: the ceiling cracks."]);
  assert.deepEqual(describeAdjudicationResult({ ok: true, round: 3 }).map((line) => line.text), ["Round 3"]);
  assert.ok(describeAdjudicationResult({ ok: true, hp: "4/7", damageType: "sonic" }).some((line) => line.text === "Damage type: sonic"));
});

test("console result lines leave out the orders and ids written for the model", () => {
  const start = describeAdjudicationResult({
    ok: true,
    encounterId: "e1",
    difficulty: "medium for this party",
    map: "A tactical battle map was generated; positions appear in GAME STATE on your next call.",
    surprise: "Surprised: Pell. The server skips their turns for the first round. Narrate the ambush landing.",
    next: "Now call request_roll with kind=initiative for EACH character: Pell (characterId=3107f662-1ffb). Combat begins once every initiative is in.",
  }).map((line) => line.text);
  assert.ok(start.includes("Surprised: Pell. The server skips their turns for the first round."), start.join(" | "));
  assert.ok(start.includes("Waiting on initiative from Pell. Combat begins once every initiative is in."), start.join(" | "));
  assert.ok(!start.some((line) => /characterId|GAME STATE|Narrate|Now call/.test(line)), start.join(" | "));
});

// ---- 11: the level-up picker refuses what the server refuses ----

test("the level-up picker refuses an Eldritch Knight's second off-school spell with the engine's sentence", () => {
  const schools = { "Charm Person": "enchantment", "Find Familiar": "conjuration", Shield: "abjuration" };
  const base = { classId: "fighter", subclass: "Eldritch Knight", level: 3, known: [], schoolOf: (name) => schools[name] };
  assert.equal(thirdCasterPickRefusal({ ...base, picks: ["Shield"], adding: "Charm Person" }), null);
  assert.match(thirdCasterPickRefusal({ ...base, picks: ["Shield", "Charm Person"], adding: "Find Familiar" }), /An Eldritch Knight of level 3 learns abjuration and evocation spells/);
  assert.equal(thirdCasterPickRefusal({ ...base, classId: "wizard", subclass: "", picks: ["Charm Person"], adding: "Find Familiar" }), null);
});

// ---- 12: players see the spell areas they know ----

test("a player sees a darkness area whole when they cast it, stand in it, or see its edge, and nothing of one they cannot", () => {
  const width = 10;
  const darkness = { cells: [44, 45, 54, 55], casterId: "wren" };
  const explored = new Set([42, 43, 52, 53]);
  assert.deepEqual(knownZoneCells(darkness, explored, width, { characterId: "rook", cell: 0 }), darkness.cells, "the edge is in sight");
  assert.deepEqual(knownZoneCells(darkness, new Set([0, 1]), width, { characterId: "wren", cell: 0 }), darkness.cells, "the caster's own");
  assert.deepEqual(knownZoneCells(darkness, new Set(), width, { characterId: "rook", cell: 45 }), darkness.cells, "standing in it");
  assert.deepEqual(knownZoneCells(darkness, new Set([0, 1]), width, { characterId: "rook", cell: 0 }), [], "far off and unseen");
  assert.deepEqual(knownZoneCells(darkness, explored, width, null), [], "the DM's view filters by its own explored set (all squares)");
});

// ---- 15: only worn gear offers the wear toggle ----

test("a wand or a potion offers no wear toggle; armor, a ring and a magic weapon do", () => {
  assert.equal(isWornGear({ name: "Wand of Magic Missiles" }), false);
  assert.equal(isWornGear({ name: "Potion of Healing" }), false);
  assert.equal(isWornGear({ name: "Chain Mail" }), true);
  assert.equal(isWornGear({ name: "Ring of Protection" }), true);
  assert.equal(isWornGear({ name: "Berserker Axe" }), true);
});

// ---- 16: spell card previews are the engine's dice ----

test("every spell card's dice are the dice the engine rolls (Web and its kin deal none)", () => {
  const names = ["Web", "Heat Metal", "Hypnotic Pattern", "Blindness/Deafness", "Spirit Guardians", "Entangle", "Fireball", "Magic Missile"];
  const cantrips = ["Eldritch Blast", "Shocking Grasp", "Fire Bolt"];
  const caster = sheet({
    class: "wizard",
    level: 5,
    abilities: { str: 8, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
      prepared: names,
      known: [],
      cantrips,
    },
  });
  const cards = deriveHand(caster, FRESH_TURN, { spells: factsFor([...names, ...cantrips]) });
  const wrong = [];
  for (const card of cards.filter((entry) => entry.intent.card === "spell")) {
    const engine = spellDamageFor({ spell: card.name, casterLevel: caster.level, slotLevel: card.intent.slotLevel ?? undefined });
    // A buff's aura (Spirit Guardians) names its dice in the card's line,
    // not as damage the card deals to its target.
    if (card.type === "ward" && engine) {
      if (!card.dice.includes(engine.dice)) wrong.push(`${card.name}: card line ${card.dice} engine ${engine.dice}`);
      continue;
    }
    if (!card.heals && (card.damage ?? null) !== (engine?.dice ?? null)) {
      wrong.push(`${card.name}: card ${card.damage} engine ${engine?.dice ?? null}`);
    }
  }
  assert.deepEqual(wrong, []);
  const web = cards.find((card) => card.name === "Web");
  assert.equal(web.damage, null, "Web deals no damage");
  assert.ok(!/2d4/.test(web.dice), web.dice);
  const grasp = cards.find((card) => card.name === "Shocking Grasp");
  assert.equal(grasp.melee, true, "a touch spell is a melee spell attack");
  assert.equal(grasp.range, "Touch");
});

console.log(`hand-look: ${passed} tests passed`);
