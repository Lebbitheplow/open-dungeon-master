// What a player can write to a sheet, field by field, and what only the
// engine writes.
//
// Three routes belong to the player: PATCH /sheet (the level-up dialog and
// the cosmetic fields), POST /sheet/usage (the plus and minus buttons) and
// POST /sheet/spells (what a caster has prepared). One belongs to whoever
// runs the story: PATCH /sheets/[sheetId], the correction dialog.
//
// The rules held here:
//   outside a level-up a player writes portrait, notes and backstory and
//   nothing else, whatever the patch schema would parse. The list of fields
//   is read from patchSheetSchema itself, so a field added to the schema is
//   refused here until somebody decides otherwise;
//   the fields the engine owns (death saves, class resources, concentration,
//   condition durations, Wild Shape, exhaustion, pets, the class list and the
//   hit-die pools) and the identity fields are not writable through any
//   player route, alone, beside a cosmetic change or inside a level-up;
//   a prepared caster prepares from their class list (a wizard from the
//   spellbook), up to ability modifier plus level, no spell above what their
//   slots reach, and a newly prepared spell waits for the long rest;
//   a DM's correction is audited, clamped, and undone once.
//
// A player changes nothing on their own sheet that the rules do not give
// them: only the DM or the party lead corrects a sheet, and a comment that
// calls a write "self-service" does not make it legal. So what is held here
// as a test() is what the server refuses or what a DM may do. What a player
// can still write is recorded as findings where it is asked field by field:
// everything a level-up request may carry in test-enforce-patch-fields.mjs
// (patch-<field>) and test-enforce-levelup.mjs, and a counter set back to
// unspent outside a fight in test-enforce-usage-route.mjs. The sheet route
// says the same thing itself: "Ask the party lead to adjust other stats".
import assert from "node:assert/strict";
import { call, seats } from "./lib/enforce-campaign.mjs";
import { openWorld } from "./lib/enforce-world.mjs";
import { abilityMod, suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-enforce-player-patch");
const { patchSheetSchema, fullPatchSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { listRecentAudit } = await import("../src/lib/db/sheet-audit.ts");

const world = await openWorld();
const who = await seats(world);
const params = { campaignId: world.campaignId };
const route = {
  sheet: await world.route("campaigns/[campaignId]/sheet"),
  sheets: await world.route("campaigns/[campaignId]/sheets/[sheetId]"),
  usage: await world.route("campaigns/[campaignId]/sheet/usage"),
  spells: await world.route("campaigns/[campaignId]/sheet/spells"),
  undo: await world.route("campaigns/[campaignId]/audit/[entryId]/undo"),
};

const mine = () => world.sheet(who.sheet.id);
const frozen = (sheet) => {
  return JSON.stringify(Object.fromEntries(Object.entries(sheet).filter(([key]) => key !== "updatedAt")));
};
const patch = (body, user = who.player) => {
  world.signIn(user);
  return call(route.sheet, "PATCH", body, params);
};

// ---- outside a level-up ----

const COSMETIC = ["portrait", "notes", "backstory"];

// A value the schema accepts for each field, so the refusal is the route's
// and not the parser's.
const SAMPLE = {
  currentHp: 30,
  tempHp: 10,
  maxHp: 31,
  ac: 13,
  acOverride: false,
  xp: 300,
  level: 1,
  gold: 1,
  copper: 1,
  conditions: [],
  equipment: [{ name: "Rope", qty: 1 }],
  hitDice: { die: "d10", total: 1, spent: 0 },
  spellcasting: null,
  feats: ["Alert"],
  features: [{ name: "Second Wind", source: "class" }],
  abilities: { str: 11, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  expertise: [],
  subclass: "Champion",
  levelUpClass: "fighter",
  levelUpSkill: "athletics",
  levelUpSpells: ["Shield"],
  levelUpForget: "Shield",
  asiChoices: [{ mode: "plus2", ability: "str" }],
  hpChoice: "average",
};

await test("outside a level-up every field of the patch schema but the cosmetic three is refused", async () => {
  const keys = Object.keys(patchSheetSchema.shape);
  for (const key of COSMETIC) {
    assert.ok(keys.includes(key), `${key} left the schema`);
  }
  const before = frozen(mine());
  for (const key of keys.filter((entry) => !COSMETIC.includes(entry))) {
    assert.ok(key in SAMPLE, `patchSheetSchema gained "${key}": decide whether a player may write it`);
    const body = { [key]: SAMPLE[key] };
    assert.ok(patchSheetSchema.safeParse(body).success, `${key} sample does not parse`);
    const response = await patch(body);
    assert.equal(response.status, 403, `${key}: ${JSON.stringify(response.json)}`);
    // Beside a cosmetic change the whole request is refused, notes included.
    const beside = await patch({ notes: "smuggled", [key]: SAMPLE[key] });
    assert.equal(beside.status, 403, `${key} beside notes`);
    assert.equal(frozen(mine()), before, key);
  }
});

await test("the cosmetic fields keep their bounds", async () => {
  const before = frozen(mine());
  for (const body of [
    { notes: "x".repeat(4001) },
    { backstory: "x".repeat(2001) },
    { portrait: { url: "https://example.com/face.png" } },
    { portrait: { url: "//example.com/face.png" } },
    { portrait: { url: "uploads/face.png" } },
    { notes: 7 },
  ]) {
    const response = await patch(body);
    assert.equal(response.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(frozen(mine()), before);
  }
  const ok = await patch({ notes: "x".repeat(4000), portrait: { url: "/uploads/face.png" } });
  assert.equal(ok.status, 200);
  assert.equal(mine().notes.length, 4000);
  world.patch(who.sheet.id, { notes: "", portrait: null });
});

// ---- what the engine owns ----

// Each is a value fullPatchSheetSchema would accept from a DM.
const ENGINE_OWNED = {
  deathSaves: { successes: 3, failures: 0, stable: true, dead: false },
  concentratingOn: "Haste",
  conditionMeta: { invisible: { rounds: 100 } },
  resources: { second_wind: { max: 9, used: 0 }, rage: { max: 9, used: 0 } },
  wildShape: { form: "Brown Bear", beastHp: 300, beastMaxHp: 300, beastAc: 30 },
  pets: [{ name: "Rex", kind: "other", form: "tarrasque", hp: 300, maxHp: 300, ac: 25, speed: 40 }],
  exhaustion: 0,
  classes: [{ id: "wizard", subclass: "", level: 20 }],
  hitDicePools: [{ classId: "fighter", die: "d12", total: 20, spent: 0 }],
  name: "Renamed",
  race: "dragonborn",
  class: "wizard",
  background: "noble",
  alignment: "CE",
  speed: 120,
  proficiencies: {
    saves: ["str", "dex", "con", "int", "wis", "cha"], skills: ["stealth"], expertise: ["stealth"],
    languages: [], tools: [], armor: ["heavy"], weapons: ["martial"],
  },
};
const ROW_FIELDS = {
  id: "00000000-0000-0000-0000-000000000000",
  userId: who.other.id,
  campaignId: "elsewhere",
  libraryCharacterId: "someone-elses",
  isCompanion: true,
  companionKind: "party",
  personality: "obedient",
};

await test("the engine's fields are fields a DM's correction may write", () => {
  // Otherwise the next three tests would prove only that a typo is ignored.
  for (const [key, value] of Object.entries(ENGINE_OWNED)) {
    assert.ok(fullPatchSheetSchema.safeParse({ [key]: value }).success, key);
    assert.ok(!(key in patchSheetSchema.shape), `${key} is player-patchable`);
  }
});

await test("an engine-owned field sent by a player is dropped, alone or beside a note", async () => {
  world.patch(who.sheet.id, { exhaustion: 2 });
  const before = mine();
  for (const [key, value] of Object.entries({ ...ENGINE_OWNED, ...ROW_FIELDS })) {
    world.patch(who.sheet.id, { notes: before.notes });
    const alone = await patch({ [key]: value });
    assert.equal(alone.status, 200, `${key}: ${JSON.stringify(alone.json)}`);
    assert.equal(frozen(mine()), frozen(before), `${key} alone`);
    const beside = await patch({ notes: `with ${key}`, [key]: value });
    assert.equal(beside.status, 200, key);
    assert.equal(frozen({ ...mine(), notes: before.notes }), frozen(before), `${key} beside a note`);
    assert.equal(mine().notes, `with ${key}`);
  }
  world.patch(who.sheet.id, { exhaustion: 0, notes: "" });
});

await test("an engine-owned field rides no level-up", async () => {
  const table = await openWorld();
  const hero = table.addHero({ class: "fighter", maxHp: 12 });
  assert.equal((await table.invoke("award_xp", { characterIds: [hero.id], amount: 300 })).ok, true);
  assert.equal((await table.invoke("apply_damage", { characterId: hero.id, amount: 12 })).ok, true);
  const fallen = table.sheet(hero.id);
  assert.equal(fallen.currentHp, 0);
  assert.ok(fallen.deathSaves, "the hero is dying");
  // A dying character gains no level, whatever the request carries: a death
  // save track is the death engine's, and a level is not a way round it.
  table.signIn(table.owner);
  const refusedDying = await call(
    route.sheet,
    "PATCH",
    { level: 2, deathSaves: null, currentHp: 12 },
    { campaignId: table.campaignId },
  );
  assert.equal(refusedDying.status, 409, JSON.stringify(refusedDying.json));
  assert.deepEqual(table.sheet(hero.id), fallen);
  // Stabilized and tended: on their feet at 1 hit point, a success on record.
  assert.equal((await table.invoke("heal", { characterId: hero.id, amount: 1, reason: "tended" })).ok, true);
  table.patch(hero.id, {
    deathSaves: { successes: 1, failures: 0, stable: false, dead: false },
    exhaustion: 3,
    conditions: ["poisoned"],
    conditionMeta: { poisoned: { rounds: 5 } },
  });
  const dying = table.sheet(hero.id);

  const leveled = await call(
    route.sheet,
    "PATCH",
    {
      level: 2,
      maxHp: 20,
      hitDice: { die: "d10", total: 2, spent: 0 },
      features: table.sheet(hero.id).features,
      ...ENGINE_OWNED,
      deathSaves: null,
      conditionMeta: {},
      ...ROW_FIELDS,
    },
    { campaignId: table.campaignId },
  );
  assert.equal(leveled.status, 200, JSON.stringify(leveled.json));
  const after = table.sheet(hero.id);
  assert.equal(after.level, 2);
  assert.deepEqual(after.deathSaves, dying.deathSaves);
  assert.equal(after.exhaustion, 3);
  assert.deepEqual(after.conditionMeta, { poisoned: { rounds: 5 } });
  assert.equal(after.concentratingOn, null);
  assert.equal(after.wildShape, null);
  assert.deepEqual(after.pets, []);
  assert.deepEqual(after.classes, []);
  assert.equal(after.hitDicePools, null);
  assert.equal(after.resources.rage, undefined);
  assert.deepEqual(after.resources.second_wind, dying.resources.second_wind);
  for (const key of ["id", "userId", "campaignId", "name", "race", "class", "speed", "isCompanion"]) {
    assert.deepEqual(after[key], dying[key], key);
  }
  assert.deepEqual(after.proficiencies, dying.proficiencies);
});

await test("the usage route takes counts and nothing else", async () => {
  const before = mine();
  world.signIn(who.player);
  const response = await call(
    route.usage,
    "POST",
    // A count a player may spend here (hit dice are spent only at a short
    // rest, test-enforce-usage-route.mjs), beside keys the route never takes.
    { ...ENGINE_OWNED, resources: { second_wind: 1 }, currentHp: 1, gold: 500, level: 5 },
    params,
  );
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const after = mine();
  assert.deepEqual(after.hitDice, before.hitDice);
  assert.deepEqual(after.resources, { second_wind: { max: 1, used: 1 } });
  world.patch(who.sheet.id, { hitDice: before.hitDice, resources: before.resources });
  assert.equal(frozen(mine()), frozen(before));
});

// ---- preparing spells ----

// A cleric 3 with WIS 16 prepares 3 + 3 spells and casts up to 2nd level.
const CLERIC = {
  class: "cleric",
  level: 3,
  abilities: { wis: 16 },
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
    prepared: ["Bless", "Cure Wounds"],
    known: [],
    cantrips: ["Sacred Flame", "Guidance", "Light"],
  },
};

async function caster(hero) {
  const table = await openWorld();
  const sheet = table.addHero(hero);
  table.signIn(table.owner);
  const change = (action, spell, extra = {}) =>
    call(route.spells, "POST", { action, spell, ...extra }, { campaignId: table.campaignId });
  return { table, id: sheet.id, change, lists: () => table.sheet(sheet.id).spellcasting };
}

await test("a newly prepared spell waits for the long rest; an unprepared one is gone at once", async () => {
  const { table, id, change, lists } = await caster(CLERIC);
  const picked = await change("prepare", "Shield of Faith");
  assert.equal(picked.status, 200, JSON.stringify(picked.json));
  assert.deepEqual(lists().prepared, ["Bless", "Cure Wounds"]);
  assert.deepEqual(lists().pending, ["Shield of Faith"]);

  const early = await table.invoke("use_spell_slot", { characterId: id, level: 1, spell: "Shield of Faith" });
  assert.equal(early.ok, false, "cast before the rest");
  assert.equal(lists().slots[1].used, 0);

  const dropped = await change("unprepare", "Bless");
  assert.equal(dropped.status, 200);
  assert.deepEqual(lists().prepared, ["Cure Wounds"]);
  const gone = await table.invoke("use_spell_slot", { characterId: id, level: 1, spell: "Bless" });
  assert.equal(gone.ok, false, "cast after unpreparing");

  assert.equal((await table.invoke("take_rest", { kind: "long" })).ok, true);
  assert.deepEqual(lists().prepared, ["Cure Wounds", "Shield of Faith"]);
  assert.equal(lists().pending, undefined);
  const audit = listRecentAudit(table.campaignId, 10).filter((row) => row.kind === "player_adjust");
  assert.equal(audit.length, 2);
  assert.ok(audit.every((row) => row.actor === "player"));
});

await test("a prepared caster prepares from the class list, within what the slots reach", async () => {
  const { change, lists } = await caster(CLERIC);
  const before = JSON.stringify(lists());
  for (const spell of [
    "Fireball", // a wizard's
    "Magic Missile", // a wizard's, 1st level
    "Spirit Guardians", // a cleric's, but 3rd level: a cleric 3 casts 2nd
    "Revivify",
    "Sacred Flame", // a cantrip
    "Bless", // already prepared
    "Wish Upon A Star", // nobody's
  ]) {
    const response = await change("prepare", spell);
    assert.equal(response.status, 400, `${spell}: ${JSON.stringify(response.json)}`);
    assert.equal(JSON.stringify(lists()), before, spell);
  }
});

await test("no more spells are prepared than ability modifier plus level", async () => {
  const { change, lists } = await caster(CLERIC);
  const cap = abilityMod(16) + 3;
  const picks = ["Shield of Faith", "Guiding Bolt", "Sanctuary", "Hold Person", "Aid", "Silence"];
  const taken = [];
  for (const spell of picks) {
    const response = await change("prepare", spell);
    if (response.status === 200) {
      taken.push(spell);
    } else {
      assert.equal(response.status, 400, spell);
    }
  }
  assert.equal(lists().prepared.length + (lists().pending ?? []).length, cap);
  assert.deepEqual(taken, picks.slice(0, cap - 2));
  // Letting one go makes room for exactly one.
  assert.equal((await change("cancel", taken[0])).status, 200);
  assert.equal((await change("prepare", "Silence")).status, 200);
  assert.equal((await change("prepare", "Aid")).status, 400);
});

await test("a wizard prepares only what is written in the spellbook", async () => {
  const { change, lists } = await caster({
    class: "wizard",
    level: 1,
    abilities: { int: 16 },
    spellcasting: {
      ability: "int",
      slots: { 1: { max: 2, used: 0 } },
      prepared: ["Magic Missile"],
      known: [],
      cantrips: ["Fire Bolt"],
      spellbook: ["Magic Missile", "Shield", "Sleep"],
    },
  });
  assert.equal((await change("prepare", "Burning Hands")).status, 400);
  assert.equal((await change("prepare", "Shield")).status, 200);
  assert.deepEqual(lists().pending, ["Shield"]);
  assert.deepEqual(lists().spellbook, ["Magic Missile", "Shield", "Sleep"]);
});

await test("a caster who knows their spells, and a hero who casts none, prepare nothing", async () => {
  const sorcerer = await caster({
    class: "sorcerer",
    level: 3,
    abilities: { cha: 16 },
    spellcasting: {
      ability: "cha",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 2, used: 0 } },
      prepared: [],
      known: ["Magic Missile", "Shield"],
      cantrips: ["Fire Bolt"],
    },
  });
  const before = JSON.stringify(sorcerer.lists());
  assert.equal((await sorcerer.change("prepare", "Fireball")).status, 400);
  assert.equal((await sorcerer.change("unprepare", "Shield")).status, 400);
  assert.equal(JSON.stringify(sorcerer.lists()), before);

  const fighter = await caster({ class: "fighter" });
  assert.equal((await fighter.change("prepare", "Bless")).status, 403);
  assert.equal(fighter.lists(), null);
  sorcerer.table.signIn(sorcerer.table.owner);
  for (const body of [{}, { action: "learn", spell: "Bless" }, { action: "prepare" }, { action: "prepare", spell: "" }]) {
    const response = await call(route.spells, "POST", body, { campaignId: sorcerer.table.campaignId });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

// ---- the DM's correction ----

const correct = (body, user = who.dm) => {
  world.signIn(user);
  return call(route.sheets, "PATCH", body, { campaignId: world.campaignId, sheetId: who.sheet.id });
};

await test("a correction is clamped, audited under the DM's name, and undone once", async () => {
  const before = mine();
  const response = await correct({ currentHp: 400, gold: 40, reason: "miscounted" });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  // Hit points never pass the maximum, whoever writes them.
  assert.equal(mine().currentHp, before.maxHp);
  assert.equal(mine().gold, 40);
  const [entry] = listRecentAudit(world.campaignId, 1);
  assert.equal(entry.kind, "lead_edit");
  assert.equal(entry.actor, "lead");
  assert.equal(entry.reason, "miscounted");

  world.signIn(who.dm);
  const target = { campaignId: world.campaignId, entryId: entry.id };
  assert.equal((await call(route.undo, "POST", {}, target)).status, 200);
  assert.equal(mine().gold, before.gold);
  assert.equal((await call(route.undo, "POST", {}, target)).status, 400);
  assert.equal(mine().gold, before.gold);
});

await test("a correction keeps the schema's bounds and the attunement cap", async () => {
  const before = frozen(mine());
  for (const body of [
    { currentHp: -1 },
    { maxHp: 0 },
    { maxHp: 501 },
    { level: 21 },
    { level: 0 },
    { gold: -5 },
    { copper: 100 },
    { exhaustion: 7 },
    { abilities: { str: 31, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    { abilities: { str: 0, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    { deathSaves: { successes: 4, failures: 0, stable: false, dead: false } },
    { hitDice: { die: "d20", total: 1, spent: 0 } },
    { classes: [{ id: "a", level: 1 }, { id: "b", level: 1 }, { id: "c", level: 1 }, { id: "d", level: 1 }] },
  ]) {
    const response = await correct(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(frozen(mine()), before);
  }
  const rings = ["one", "two", "three", "four"].map((name) => ({ name: `Ring ${name}`, qty: 1, attuned: true }));
  assert.equal((await correct({ equipment: rings })).status, 200);
  assert.equal(mine().equipment.filter((item) => item.attuned).length, 3);
  world.patch(who.sheet.id, { equipment: [] });
});

await test(
  "A counter never holds more spent than it has, whoever writes it: a correction that says otherwise is held to the counter.",
  async () => {
    const before = mine();
    await correct({
      resources: { second_wind: { max: 1, used: 5 } },
      hitDice: { die: "d10", total: 1, spent: 5 },
    });
    const after = mine();
    world.patch(who.sheet.id, { resources: before.resources, hitDice: before.hitDice });
    assert.ok(
      after.resources.second_wind.used <= after.resources.second_wind.max &&
        after.hitDice.spent <= after.hitDice.total,
      `stored ${JSON.stringify(after.resources.second_wind)} and ${JSON.stringify(after.hitDice)}`,
    );
  },
);

await test("a correction holds every counter together and says what it held", async () => {
  const before = mine();
  const response = await correct({
    resources: { second_wind: { max: 1, used: 1 }, action_surge: { max: 1, used: 9 } },
    spellcasting: {
      ability: "int", prepared: [], known: [], cantrips: [],
      slots: { 1: { max: 2, used: 7 }, 2: { max: 0, used: 1 } },
      pact: { level: 1, max: 1, used: 3 },
    },
    hitDicePools: [{ classId: "fighter", die: "d10", total: 1, spent: 4 }],
    reason: "a miscount",
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  const after = mine();
  world.patch(who.sheet.id, {
    resources: before.resources, spellcasting: before.spellcasting,
    hitDice: before.hitDice, hitDicePools: before.hitDicePools ?? undefined,
  });
  // What was coherent is stored as sent.
  assert.deepEqual(after.resources.second_wind, { max: 1, used: 1 });
  assert.deepEqual(after.resources.action_surge, { max: 1, used: 1 });
  for (const slot of Object.values(after.spellcasting.slots)) {
    assert.ok(slot.used <= slot.max, JSON.stringify(after.spellcasting.slots));
  }
  if (after.spellcasting.pact) {
    assert.ok(after.spellcasting.pact.used <= after.spellcasting.pact.max);
  }
  for (const pool of after.hitDicePools ?? []) {
    assert.ok(pool.spent <= pool.total, JSON.stringify(pool));
  }
  assert.ok(after.hitDice.spent <= after.hitDice.total);
  assert.ok(response.json.held.length >= 3, JSON.stringify(response.json.held));
  // The audit row records what was stored, not what was asked.
  const [entry] = listRecentAudit(world.campaignId, 1);
  assert.equal(entry.kind, "lead_edit");
  assert.equal(entry.reason, "a miscount");
  assert.equal(entry.delta.resources.action_surge.used, 1);
});

await test("a correction keeps a level between 1 and 20, and every correction writes its audit row", async () => {
  const before = frozen(mine());
  for (const level of [0, 21, -3, 2.5]) {
    const response = await correct({ level });
    assert.equal(response.status, 400, String(level));
    assert.equal(frozen(mine()), before);
  }
  const rows = () => listRecentAudit(world.campaignId, 200).filter((entry) => entry.kind === "lead_edit").length;
  const count = rows();
  const gold = mine().gold;
  assert.equal((await correct({ gold: gold + 1 })).status, 200);
  assert.equal((await correct({ alignment: "N" })).status, 200);
  assert.equal(rows(), count + 2);
  world.patch(who.sheet.id, { gold, alignment: JSON.parse(before).alignment });
});

await test("a correction cannot leave hit points above what exhaustion allows", async () => {
  const before = mine();
  world.patch(who.sheet.id, { exhaustion: 4 });
  assert.equal((await correct({ currentHp: before.maxHp })).status, 200);
  const after = mine();
  world.patch(who.sheet.id, { exhaustion: before.exhaustion ?? 0, currentHp: before.currentHp });
  assert.equal(after.currentHp, Math.max(1, Math.floor(before.maxHp / 2)));
});

await test("a player is refused the correction route, for another player's sheet and for their own", async () => {
  for (const user of [who.player, who.other, who.bare, who.lead]) {
    for (const sheetId of [who.sheet.id, who.otherSheet.id]) {
      const before = frozen(world.sheet(sheetId));
      world.signIn(user);
      const response = await call(route.sheets, "PATCH", { gold: 5000, reason: "mine now" }, {
        campaignId: world.campaignId, sheetId,
      });
      assert.equal(response.status, 403, `${user.username} on ${sheetId}`);
      assert.equal(frozen(world.sheet(sheetId)), before);
    }
  }
});

world.close();
finish();
