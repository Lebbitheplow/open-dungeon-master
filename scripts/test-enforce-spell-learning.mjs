// How a spell list grows: what a level-up, the DM's learn_spell and the
// spells route let onto a caster's sheet.
//
// The rules (SRD 5.1, each class's Spellcasting feature): a spell learned or
// prepared is on the class's own spell list and of a level the class has
// slots for; on gaining a level a bard, sorcerer, warlock or ranger learns
// what the Spells Known column adds and may replace ONE spell they know with
// another; cantrips are never replaced; a wizard adds two wizard spells to
// the spellbook per level and prepares only from the book; a wizard copying
// a found spell needs it to be a wizard spell of a level they can prepare,
// two hours and 50 gp per spell level; the spellcasting ability is the
// class's, not the player's pick; a domain's or an oath's spells are always
// prepared and do not count against the number prepared; a cantrip a race
// grants is known on top of the class's cantrips; a class with no
// Spellcasting feature has no spell list at all.
//
// The counts themselves are scripts/test-enforce-spell-counts.mjs, preparing
// through the spells route is scripts/test-enforce-player-patch.mjs, and a
// multiclass level-up's picks are scripts/test-enforce-multiclass-levelup.mjs.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { cleric, sorcerer, wizard } from "./lib/enforce-spells.mjs";

const { test, finish } = suite("test-enforce-spell-learning");
const world = await openWorld();
const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
const spellsRoute = await world.route("campaigns/[campaignId]/sheet/spells");
const { subclassSpellsFor } = await import("../src/lib/srd/features.ts");

async function call(mod, method, userId, campaignId, body) {
  world.signIn({ id: userId });
  const request = new Request("http://test/", {
    method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve({ campaignId }) });
  return { status: response.status, json: await response.json() };
}

// A character with the experience to level, and the level-up a player's
// client would send: the next level and the spell lists as `change` leaves
// them. Returns what came back and the sheet before and after.
async function levelUp(hero, change) {
  const table = await openWorld();
  const sheet = table.addHero(hero);
  table.patch(sheet.id, { xp: 355000 });
  const before = table.sheet(sheet.id);
  const lists = before.spellcasting ? { ...before.spellcasting, ...change(before.spellcasting) } : change(null);
  const out = await call(sheetRoute, "PATCH", sheet.userId, table.campaignId, {
    level: before.level + 1, spellcasting: lists,
  });
  return { out, before, after: table.sheet(sheet.id), table };
}

// The level-up must be refused and the sheet left as it was.
function assertRefused({ out, before, after }, label) {
  assert.ok(out.status >= 400, `${label}: the level-up answered ${out.status}`);
  assert.equal(JSON.stringify(after), JSON.stringify(before), `${label}: the sheet changed`);
}

// ---- a level-up, held ----

await test("a level-up cannot add a spell above what the new level's slots reach", async () => {
  assertRefused(
    await levelUp(wizard(5), (lists) => ({ prepared: [...lists.prepared.slice(0, 7), "Wish"] })),
    "Wish prepared at 6th level",
  );
  assertRefused(
    await levelUp(wizard(5), (lists) => ({ spellbook: [...lists.spellbook, "Cone of Cold"] })),
    "Cone of Cold written at 6th level",
  );
  assertRefused(
    await levelUp(sorcerer(5), (lists) => ({ known: [...lists.known, "Banishment"] })),
    "Banishment known at 6th level",
  );
});

await test("a wizard writes two spells in the book for a level, not three", async () => {
  const three = await levelUp(wizard(5), (lists) => ({ spellbook: [...lists.spellbook, "Fly", "Slow", "Counterspell"] }));
  assertRefused(three, "three new spells");
  const two = await levelUp(wizard(5), (lists) => ({ spellbook: [...lists.spellbook, "Fly", "Slow"] }));
  assert.equal(two.out.status, 200, JSON.stringify(two.out.json).slice(0, 200));
  assert.deepEqual(two.after.spellcasting.spellbook, ["Detect Magic", "Identify", "Fly", "Slow"]);
  assert.deepEqual(two.after.spellcasting.prepared, two.before.spellcasting.prepared, "written is not prepared");
});

await test("a domain's spells are always prepared and outside the number prepared", async () => {
  // SRD 5.1, Life Domain: Bless and Cure Wounds at 1st level, Lesser
  // Restoration and Spiritual Weapon at 3rd, Beacon of Hope and Revivify at 5th.
  const domain = ["Bless", "Cure Wounds", "Lesser Restoration", "Spiritual Weapon", "Beacon of Hope", "Revivify"];
  assert.deepEqual([...subclassSpellsFor("cleric", "Life Domain", 5)].sort(), [...domain].sort());
  // A 6th level cleric with Wisdom 18 prepares 6 + 4.
  const own = ["Healing Word", "Bane", "Guiding Bolt", "Detect Magic", "Hold Person", "Silence", "Aid", "Dispel Magic", "Daylight", "Sanctuary"];
  const life = cleric(5, { subclass: "Life Domain", spellcasting: { prepared: [...domain, ...own.slice(0, 9)] } });
  const full = await levelUp(life, () => ({ prepared: [...domain, ...own] }));
  assert.equal(full.out.status, 200, JSON.stringify(full.out.json).slice(0, 200));
  assert.equal(full.after.spellcasting.prepared.length, 16);
  assertRefused(await levelUp(life, () => ({ prepared: [...domain, ...own, "Command"] })), "an eleventh spell of the cleric's own");
  // Without the domain the same sixteen are six too many.
  assertRefused(
    await levelUp(cleric(5, { spellcasting: { prepared: own.slice(0, 9) } }), () => ({ prepared: [...domain, ...own] })),
    "sixteen spells with no domain",
  );
});

await test("outside a level-up a player's spell lists are not theirs to write", async () => {
  const table = await openWorld();
  const sheet = table.addHero(sorcerer(5));
  const before = JSON.stringify(table.sheet(sheet.id));
  const out = await call(sheetRoute, "PATCH", sheet.userId, table.campaignId, {
    spellcasting: { ...sheet.spellcasting, known: ["Fly"] },
  });
  assert.equal(out.status, 403);
  assert.equal(JSON.stringify(table.sheet(sheet.id)), before);
});

// ---- a level-up, not held ----

await test(
  "A spell learned or prepared at a level-up is on the class's own spell list: a sorcerer does not learn Cure Wounds.",
  async () => {
    assertRefused(await levelUp(sorcerer(5), (lists) => ({ known: [...lists.known, "Cure Wounds"] })), "a sorcerer learning Cure Wounds");
  },
);

await test(
  "A wizard prepares only spells written in the spellbook, and a level adds two to the book.",
  async () => {
    const thin = wizard(5, { spellcasting: { prepared: ["Magic Missile"], spellbook: ["Magic Missile"] } });
    assertRefused(
      await levelUp(thin, () => ({ prepared: ["Magic Missile", "Fly", "Slow", "Counterspell", "Haste", "Fireball"] })),
      "five spells prepared that were never written",
    );
  },
);

await test(
  "A sorcerer has the spells the Spells Known column gives and no others.",
  async () => {
    assertRefused(
      await levelUp(sorcerer(5), (lists) => ({
        known: [...lists.known, "Fly"],
        prepared: ["Counterspell", "Slow", "Web", "Sleep", "Shatter", "Burning Hands", "Misty Step"],
      })),
      "a sorcerer with seven spells known and seven more prepared",
    );
  },
);

await test(
  "The cantrips a caster knows are cantrips.",
  async () => {
    assertRefused(await levelUp(wizard(5), () => ({ cantrips: ["Fire Bolt", "Fireball", "Wish"] })), "Fireball and Wish as cantrips");
  },
);

await test(
  "On gaining a level a sorcerer may replace one spell they know with another.",
  async () => {
    assertRefused(
      await levelUp(sorcerer(5), () => ({ known: ["Burning Hands", "Mage Armor", "Sleep", "Scorching Ray", "Misty Step", "Fly", "Counterspell"] })),
      "six spells replaced and one learned",
    );
  },
);

await test(
  "A cantrip, once known, is known for good: SRD 5.1 has no rule that replaces one.",
  async () => {
    assertRefused(await levelUp(wizard(5), () => ({ cantrips: ["Acid Splash", "Light", "Mage Hand"] })), "all three cantrips replaced");
  },
);

await test(
  "A wizard's spellcasting ability is Intelligence.",
  async () => {
    const swapped = await levelUp(wizard(5, { abilities: { int: 8, cha: 20 }, spellcasting: { prepared: ["Magic Missile"] } }), () => ({ ability: "cha" }));
    assert.ok(
      swapped.out.status >= 400 || swapped.after.spellcasting.ability === "int",
      `the wizard now casts with ${swapped.after.spellcasting.ability}`,
    );
  },
);

await test(
  "A class with no Spellcasting feature has no spells, cantrips or slots.",
  async () => {
    const out = await levelUp({ class: "fighter", level: 5 }, () => ({
      ability: "int",
      slots: { 1: { max: 4, used: 0 }, 9: { max: 2, used: 0 } },
      known: [],
      prepared: ["Arcane Detonation"],
      cantrips: ["Fire Bolt", "Eldritch Blast"],
    }));
    assert.ok(out.out.status >= 400 || out.after.spellcasting === null, `the fighter now has ${JSON.stringify(out.after.spellcasting)}`);
  },
);

await test(
  "A high elf knows one wizard cantrip from their race, on top of the cantrips their class gives.",
  async () => {
    const elf = wizard(3, {
      race: "high_elf",
      spellcasting: { prepared: ["Magic Missile", "Shield"], cantrips: ["Fire Bolt", "Ray of Frost", "Shocking Grasp", "Light"] },
    });
    const out = await levelUp(elf, (lists) => ({ cantrips: [...lists.cantrips, "Mage Hand"] }));
    assert.equal(out.out.status, 200, out.out.json.error);
  },
);

// ---- the DM's learn_spell ----

const learn = (table, hero, spell, action = "add") =>
  table.invoke("learn_spell", { characterId: hero.id, name: spell, spell, action });

await test("a copied spell is written in the book, and is not castable until prepared and rested on", async () => {
  const table = await openWorld();
  const mage = table.addHero(wizard(5, { gold: 150 }));
  const copied = await learn(table, mage, "Fly");
  assert.equal(copied.ok, true, copied.error);
  const lists = table.sheet(mage.id).spellcasting;
  assert.ok(lists.spellbook.includes("Fly"));
  assert.equal(lists.prepared.includes("Fly"), false);
  assert.equal((await table.invoke("use_spell_slot", { characterId: mage.id, level: 3, spell: "Fly" })).ok, false);
  // The book may hold it; what is prepared is still the limit's.
  const room = await call(spellsRoute, "POST", mage.userId, table.campaignId, { action: "prepare", spell: "Fly" });
  assert.equal(room.status, 400, "eight spells are prepared already, the most a 5th level wizard with Intelligence 16 may");
  await call(spellsRoute, "POST", mage.userId, table.campaignId, { action: "unprepare", spell: "Blur" });
  const picked = await call(spellsRoute, "POST", mage.userId, table.campaignId, { action: "prepare", spell: "Fly" });
  assert.equal(picked.status, 200, JSON.stringify(picked.json));
  assert.equal((await table.invoke("use_spell_slot", { characterId: mage.id, level: 3, spell: "Fly" })).ok, false, "before the rest");
  await table.invoke("take_rest", { kind: "long" });
  const cast = await table.invoke("use_spell_slot", { characterId: mage.id, level: 3, spell: "Fly" });
  assert.equal(cast.ok, true, cast.error);
});

await test("a caster at their Spells Known limit learns nothing more until one is given up", async () => {
  const table = await openWorld();
  const sorc = table.addHero(sorcerer(5));
  const before = JSON.stringify(table.sheet(sorc.id).spellcasting);
  assert.equal((await learn(table, sorc, "Fly")).ok, false);
  assert.equal(JSON.stringify(table.sheet(sorc.id).spellcasting), before);
  assert.equal((await learn(table, sorc, "Blur", "remove")).ok, true);
  assert.equal((await learn(table, sorc, "Fly")).ok, true);
  assert.deepEqual(table.sheet(sorc.id).spellcasting.known, ["Magic Missile", "Shield", "Hold Person", "Fireball", "Haste", "Fly"]);
  assert.equal((await learn(table, sorc, "Counterspell")).ok, false);
});

await test("a character with no spellcasting is taught no spell, and nobody forgets what they never knew", async () => {
  const table = await openWorld();
  const soldier = table.addHero({ class: "fighter", level: 5 });
  const mage = table.addHero(wizard(5));
  assert.equal((await learn(table, soldier, "Fire Bolt")).ok, false);
  assert.equal(table.sheet(soldier.id).spellcasting, null);
  assert.equal((await learn(table, mage, "Cure Wounds", "remove")).ok, false);
});

await test("a spell taught in play is on the class list, of a castable level, with room for a cantrip", async () => {
  const table = await openWorld();
  const novice = table.addHero(
    wizard(1, { spellcasting: { prepared: ["Magic Missile"], spellbook: ["Magic Missile"], cantrips: ["Fire Bolt", "Light", "Mage Hand"] } }),
  );
  const sorc = table.addHero(sorcerer(5, { spellcasting: { known: ["Magic Missile", "Shield"] } }));
  const taught = [];
  for (const [hero, spell] of [[novice, "Wish"], [novice, "Cure Wounds"], [novice, "Ray of Frost"], [sorc, "Cure Wounds"], [sorc, "Wish"]]) {
    if ((await learn(table, hero, spell)).ok) {
      taught.push(`${hero.class} ${hero.level}: ${spell}`);
    }
  }
  assert.deepEqual(taught, [], `taught: ${taught.join("; ")}`);
});

await test("copying a spell into the book costs 50 gp and two hours a level", async () => {
  const { getClock } = await import("../src/lib/db/clock.ts");
  const table = await openWorld();
  const mage = table.addHero(wizard(5, { gold: 0, copper: 0 }));
  const clock = JSON.stringify(getClock(table.campaignId));
  const copied = await learn(table, mage, "Fly");
  assert.ok(copied.ok === false, "a wizard with no gold copied a 3rd level spell (150 gp)");
  assert.equal(JSON.stringify(getClock(table.campaignId)), clock);
});

await test(
  "A wizard prepares spells of a level they have slots for.",
  async () => {
    const table = await openWorld();
    const novice = table.addHero(
      wizard(1, { spellcasting: { prepared: ["Magic Missile"], spellbook: ["Magic Missile", "Fireball"] } }),
    );
    const before = JSON.stringify(table.sheet(novice.id).spellcasting);
    const out = await call(spellsRoute, "POST", novice.userId, table.campaignId, { action: "prepare", spell: "Fireball" });
    assert.equal(out.status, 400, `preparing Fireball at 1st level answered ${out.status}`);
    assert.equal(JSON.stringify(table.sheet(novice.id).spellcasting), before);
  },
);

// ---- the DM's console ----

await test("the console's Learn a spell adds the spell named", async () => {
  const table = await openWorld();
  // Copying Fly into the book costs 150 gp, so the wizard carries it. The
  // form sends the spell and the choice to learn it (catalog-party.ts).
  const mage = table.addHero(wizard(5, { gold: 150 }));
  const out = await table.invoke("learn_spell", { characterId: mage.id, action: "add", spell: "Fly" });
  assert.equal(out.ok, true, out.error);
  assert.ok(table.sheet(mage.id).spellcasting.spellbook.includes("Fly"));
});

await test("the console's Spend a slot checks the spell named", async () => {
  const table = await openWorld();
  const mage = table.addHero(wizard(5));
  const before = JSON.stringify(table.sheet(mage.id).spellcasting.slots);
  const out = await table.invoke("use_spell_slot", { characterId: mage.id, level: 1, name: "Cure Wounds" });
  assert.equal(out.ok, false, "a wizard spent a slot on Cure Wounds");
  assert.equal(JSON.stringify(table.sheet(mage.id).spellcasting.slots), before);
});

world.close();
finish();
