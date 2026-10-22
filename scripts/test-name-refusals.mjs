// Every DM tool that finds a record by the name it is sent finds it whole,
// or refuses: a name that is no record's own spelling is answered with the
// records there are, never the record whose name holds a word of it, nor
// the first one, nor a default. The exact name and its textKey variants
// (case, hyphens and underscores, curly apostrophes) are found. The names
// below are written at an Italian, French, Spanish, German and English
// table, since no table had the guess right more often than another.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { monsterKit, ROWS } from "./lib/enforce-monsters.mjs";
import { caster } from "./lib/enforce-spell-kit.mjs";

const { test, finish } = suite("test-name-refusals");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { insertFaction } = await import("../src/lib/db/factions.ts");
const { resolvePrepRef } = await import("../src/lib/dm/prep-logic.ts");
const { pickLairOption } = await import("../src/lib/dm/legendary-logic.ts");
const { findBeastForm } = await import("../src/lib/srd/beast-forms.ts");
const { insertEncounterTemplate } = await import("../src/lib/db/encounter-templates.ts");
const { dispatchAdjudication } = await import("../src/lib/dm/invoke-dispatch.ts");
const { createDmTurn } = await import("../src/lib/db/dm-turns.ts");
const { listSheets } = await import("../src/lib/db/sheets.ts");
const { mountTools } = await import("../src/lib/dm/mount-tools.ts");
const { checkMount } = await import("../src/lib/srd/mounts.ts");
const { lineNamed } = await import("../src/lib/srd/item-row.ts");
const { renameEnemy } = await import("../src/lib/db/encounters.ts");
const { renameTokenByRef } = await import("../src/lib/db/battle-maps.ts");
const { updateGameSettings } = await import("../src/lib/db/campaigns.ts");
const { upsertCurrentLocation } = await import("../src/lib/db/locations.ts");
const { listShops } = await import("../src/lib/db/shops.ts");

// A refusal that names every option given, and changed nothing the test
// can see.
function refused(out, ...options) {
  assert.equal(out.ok, false, `accepted: ${JSON.stringify(out.result ?? {}).slice(0, 200)}`);
  for (const option of options) {
    assert.ok(out.error.includes(option), `the refusal does not name ${option}: ${out.error}`);
  }
}

const accepted = (out) => assert.equal(out.ok, true, out.error);

const fighter = world.addHero({
  name: "Ada", class: "fighter", level: 5, proficiencies: TRAINED,
  equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Dagger", qty: 2 }, { name: "Spada lunga", srdName: "Longsword", qty: 1 }],
});
const ranger = world.addHero({ name: "Bo", class: "ranger", subclass: "beast_master", level: 5, proficiencies: TRAINED });
const cleric = world.addHero({ name: "Cy", class: "cleric", level: 5, proficiencies: TRAINED });

await test("pc_attack: a weapon no line is called is refused with the weapons carried; the line's name, its row's spellings and an improvised object are swung.", async () => {
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.place(enemy.id, 5, 5);
  kit.place(fighter.id, 6, 5);
  for (const name of ["Épée longue", "Espada larga", "Langschwert", "Sword", "Long"]) {
    kit.giveTurn(fighter.id);
    refused(await world.invoke("pc_attack", { characterId: fighter.id, enemyId: enemy.id, weapon: name }), "Longsword", "Dagger", "Spada lunga");
  }
  for (const name of ["longsword", "LONGSWORD", "long sword", "SPADA_LUNGA", "spada-lunga"]) {
    kit.giveTurn(fighter.id);
    world.dice(1, 1);
    accepted(await world.invoke("pc_attack", { characterId: fighter.id, enemyId: enemy.id, weapon: name }));
    world.clearDice();
  }
  kit.giveTurn(fighter.id);
  world.dice(1, 1);
  accepted(await world.invoke("pc_attack", { characterId: fighter.id, enemyId: enemy.id, weapon: "Sedia", improvised: true }));
  world.clearDice();
});

await test("pc_attack and sell: a row two lines of other names are listed as is refused naming both, at every table; the line's own name is swung.", async () => {
  const [enemy] = world.enemies();
  for (const [plain, silvered] of [["Spada lunga", "Spada d'argento"], ["Épée longue", "Épée d'argent"], ["Espada larga", "Espada de plata"], ["Langschwert", "Silberschwert"], ["Old sword", "Silver sword"]]) {
    world.patch(fighter.id, { equipment: [{ name: plain, srdName: "Longsword", qty: 1 }, { name: silvered, srdName: "Longsword", tags: ["silvered"], qty: 1 }] });
    kit.giveTurn(fighter.id);
    refused(await world.invoke("pc_attack", { characterId: fighter.id, enemyId: enemy.id, weapon: "Longsword" }), "more than one Longsword", plain, silvered);
    assert.equal(lineNamed(world.sheet(fighter.id).equipment, "Longsword"), -1, plain);
    kit.giveTurn(fighter.id);
    world.dice(1, 1);
    accepted(await world.invoke("pc_attack", { characterId: fighter.id, enemyId: enemy.id, weapon: silvered }));
    world.clearDice();
  }
  world.patch(fighter.id, { equipment: [{ name: "Longsword", qty: 1, equipped: true }, { name: "Dagger", qty: 2 }, { name: "Spada lunga", srdName: "Longsword", qty: 1 }] });
});

await test("enemy_attack: an attack the block has not is refused with its attacks; its own name in any case is swung.", async () => {
  const [enemy] = world.enemies();
  mk.stage(enemy.id, ROWS.adultRedDragon);
  kit.freshRound();
  for (const name of ["Morso", "Morsure", "Mordisco", "Biss", "Tail Spike", "Bites"]) {
    refused(await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id, attack: name }), "Bite", "Claw", "Tail");
  }
  world.dice(1);
  accepted(await world.invoke("enemy_attack", { enemyId: enemy.id, targetCharacterId: fighter.id, attack: "TAIL" }));
  world.clearDice();
});

await test("legendary_action: an action the block lists not is refused with the ones it lists.", async () => {
  const [enemy] = world.enemies();
  for (const name of ["Coda", "Queue", "Cola", "Schwanz", "Tail"]) {
    refused(await world.invoke("legendary_action", { enemyId: enemy.id, action: name }), "Detect", "Tail Attack", "Wing Attack");
  }
  world.dice(20);
  accepted(await world.invoke("legendary_action", { enemyId: enemy.id, action: "detect" }));
  world.clearDice();
});

await test("lair options: a listed option is taken by its number or its whole line, never by a word of it.", () => {
  const options = ["Magma erupts from a point on the ground", "A tremor shakes the lair", "Volcanic gases form a cloud"];
  assert.equal(pickLairOption(options, "2"), options[1]);
  assert.equal(pickLairOption(options, "a TREMOR shakes the lair"), options[1]);
  for (const name of ["Magma", "tremor", "Eruzione di magma", "Gaz volcaniques"]) {
    assert.equal(pickLairOption(options, name), null, `${name} took a lair option`);
  }
});

await test("set_condition and set_enemy_condition: a condition is its whole name, or with a bracket note; a condition's name with words added is refused (\"of the dragon\" is sent as the source); any other word is kept as a story condition, its note naming no SRD condition.", async () => {
  const [enemy] = world.enemies();
  try {
    for (const condition of ["frightened of the dragon", "prone-ish", "grappled by the ogre", "Poisoned badly"]) {
      refused(await world.invoke("set_condition", { characterId: cleric.id, condition }), "sourceEnemyId");
      refused(await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition }), "sourceEnemyId");
    }
    for (const condition of ["spaventato", "effrayé", "asustado", "verängstigt"]) {
      const out = await world.invoke("set_condition", { characterId: cleric.id, condition });
      accepted(out);
      assert.match(out.result.note, /is kept as a story condition: no rule the server knows applies to it\.$/, condition);
      // The description lists the SRD names; listed again here they drew a second call for the SRD condition.
      assert.doesNotMatch(out.result.note, /frightened/, condition);
      accepted(await world.invoke("clear_condition", { characterId: cleric.id, condition }));
    }
    accepted(await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "Prone (from the shove)" }));
    accepted(await world.invoke("set_condition", { characterId: cleric.id, condition: "PRONE" }));
    refused(await world.invoke("clear_condition", { characterId: cleric.id, condition: "pro" }));
    accepted(await world.invoke("clear_condition", { characterId: cleric.id, condition: "Prone" }));
    refused(await world.invoke("clear_enemy_condition", { enemyId: enemy.id, condition: "pron" }));
    accepted(await world.invoke("clear_enemy_condition", { enemyId: enemy.id, condition: "prone" }));
    // "exhaustion 2" is the form the engine writes: exhaustion at that level,
    // on an enemy as on a character.
    const tired = await world.invoke("set_enemy_condition", { enemyId: enemy.id, condition: "Exhaustion 2" });
    accepted(tired);
    assert.ok(world.enemies().find((entry) => entry.id === enemy.id).conditions.includes("exhaustion 2"), JSON.stringify(tired.result));
  } finally {
    await kit.endFight();
  }
});

await test("summon_pet, pet_attack, damage_pet, dismiss_pet: a form, a companion and its attack are found whole, else refused with the ones there are.", async () => {
  for (const form of ["lupo", "loup", "lobo", "Wolfshund", "wolves den"]) {
    refused(await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form }));
  }
  accepted(await world.invoke("summon_pet", { characterId: ranger.id, kind: "beast_companion", form: "WOLF", name: "Zanna" }));
  for (const petName of ["Zan", "Fang", "Croc"]) {
    refused(await world.invoke("damage_pet", { characterId: ranger.id, petName, amount: 1 }), "Zanna");
  }
  accepted(await world.invoke("damage_pet", { characterId: ranger.id, petName: "zanna", amount: 1 }));
  await kit.fight(1);
  const [enemy] = world.enemies();
  kit.place(enemy.id, 5, 5);
  kit.place(ranger.id, 6, 5);
  kit.giveTurn(ranger.id);
  for (const attack of ["Morso", "Morsure", "Mordisco", "Biss"]) {
    refused(await world.invoke("pet_attack", { characterId: ranger.id, petName: "Zanna", targetEnemyId: enemy.id, attack }), "Bite");
  }
  await kit.endFight();
  refused(await world.invoke("dismiss_pet", { characterId: ranger.id, petName: "Zann" }), "Zanna");
  accepted(await world.invoke("dismiss_pet", { characterId: ranger.id, petName: "ZANNA" }));
});

await test("mount_up: a mount no table lists is refused with the mounts; its name in any case is ridden.", async () => {
  for (const mount of ["Cavallo", "Cheval", "Caballo", "Pferd", "horse"]) {
    refused(await world.invoke("mount_up", { characterId: cleric.id, mount }), "Riding horse", "Warhorse");
  }
  accepted(await world.invoke("mount_up", { characterId: cleric.id, mount: "RIDING HORSE" }));
});

await test("mount_up says a listed mount goes in mount by its listed name at any table, and customName is only for an animal no list has.", () => {
  const tool = mountTools.find((entry) => entry.function.name === "mount_up").function;
  assert.match(tool.description, /listed name whatever the table calls it/);
  assert.match(tool.description, /customName, with a speed and a size, is only for an animal no list has/);
  const refusal = checkMount({ ref: "cavallo da galoppo", riderSize: "medium" });
  assert.match(refusal.error, /sent in mount by that name whatever the table calls it/);
});

await test("use_resource: a resource the sheet has not is refused with the ones it has.", async () => {
  for (const resource of ["Canalizzare divinità", "Conduit divin", "Canalizar divinidad", "Göttliche Macht", "Channel"]) {
    refused(await world.invoke("use_resource", { characterId: cleric.id, resource }), "channel_divinity");
  }
  accepted(await world.invoke("use_resource", { characterId: cleric.id, resource: "channel-divinity" }));
  // A ki variant names a technique whole; any other is refused, never the
  // technique whose name holds a word of it, nor a plain spend.
  const monk = world.addHero({ name: "Hu", class: "monk", level: 5, proficiencies: TRAINED });
  for (const variant of ["Shadow Step", "dash", "dodge", "Raffica di colpi", "Déluge de coups"]) {
    refused(await world.invoke("use_resource", { characterId: monk.id, resource: "Ki", variant }), "flurry of blows", "patient defense", "step of the wind");
    assert.equal(world.sheet(monk.id).resources.ki.used, 0, `${variant} spent ki`);
  }
});

await test("use_item: a line no item is called is refused with what is carried.", async () => {
  for (const item of ["Spada", "Épée", "Espada", "Schwert", "Long", "Sword"]) {
    refused(await world.invoke("use_item", { characterId: fighter.id, item }), "Longsword", "Dagger", "Spada lunga");
  }
});

await test("buy_item, sell_item, haggle: a shop is its whole name; an unknown one, or the name without its article, is refused with the shops; a ware the shelf has not is refused with the shelf.", async () => {
  accepted(await world.invoke("open_shop", { name: "The Rusty Anchor", kind: "general" }));
  for (const shop of ["Rusty", "Anchor", "rusty anchor", "L'ancora arrugginita", "L'Ancre rouillée", "El Ancla Oxidada", "Der rostige Anker"]) {
    refused(await world.invoke("buy_item", { characterId: fighter.id, shop, item: "Torch" }), "The Rusty Anchor");
    refused(await world.invoke("sell_item", { characterId: fighter.id, shop, item: "Dagger" }), "The Rusty Anchor");
    refused(await world.invoke("haggle", { characterId: fighter.id, shop }), "The Rusty Anchor");
  }
  for (const item of ["Corda", "Corde", "Cuerda", "Seil", "Ball"]) {
    refused(await world.invoke("buy_item", { characterId: fighter.id, shop: "THE RUSTY ANCHOR", item }), "On the shelf");
  }
});

await test("faction_note and adjust_reputation: a faction is its whole name; an unknown one, or the name without its article, is refused with the factions.", async () => {
  insertFaction(world.campaignId, { name: "The Reed Court" });
  for (const faction of ["Reed", "Court", "reed court", "La Corte delle Canne", "La Cour des Roseaux", "Die Schilfhof"]) {
    refused(await world.invoke("faction_note", { faction, note: "seen" }), "The Reed Court");
    refused(await world.invoke("adjust_reputation", { faction, delta: 1, reason: "seen" }), "The Reed Court");
  }
  accepted(await world.invoke("faction_note", { faction: "the reed court", note: "seen" }));
  accepted(await world.invoke("adjust_reputation", { faction: "THE REED COURT", delta: 1, reason: "seen" }));
});

await test("read_card: a card is its number, its event id or its whole title; a word of a title finds none.", () => {
  const cards = [
    { cardId: "c1", title: "The keeper's confession", role: "beat" },
    { cardId: "c2", title: "The lighthouse bargain", role: "moment" },
  ];
  const arc = { beats: [{ cardId: "c1" }], events: [{ id: "ev1", cardId: "c2" }] };
  assert.equal(resolvePrepRef(arc, cards, "1")?.cardId, "c1");
  assert.equal(resolvePrepRef(arc, cards, "EV1")?.cardId, "c2");
  for (const ref of ["The keeper’s confession", "the keeper's confession", "THE KEEPER'S CONFESSION"]) {
    assert.equal(resolvePrepRef(arc, cards, ref)?.cardId, "c1", ref);
  }
  for (const ref of ["keeper", "confession", "keeper's confession", "La confessione del guardiano", "lighthouse"]) {
    assert.equal(resolvePrepRef(arc, cards, ref), null, `${ref} found a card`);
  }
});

await test("cast_buff and cast_at_enemy: a spell's variant or condition is its whole name or what its brackets hold; another word is refused with the ones there are.", async () => {
  const wizard = world.addHero({ ...caster("wizard", "int", ["Fire Shield", "Blindness/Deafness"]), name: "Dee" });
  for (const variant of ["Scudo di fuoco (freddo)", "froid", "frío", "Kälte", "cold fire"]) {
    refused(await world.invoke("cast_buff", { characterId: wizard.id, spell: "Fire Shield", variant, level: 4 }), "fire shield (cold)", "fire shield (fire)");
  }
  accepted(await world.invoke("cast_buff", { characterId: wizard.id, spell: "Fire Shield", variant: "COLD", level: 4 }));
  await kit.fight(1);
  try {
    const [enemy] = world.enemies();
    kit.place(enemy.id, 5, 5);
    kit.place(wizard.id, 6, 5);
    for (const condition of ["accecato", "aveuglé", "cegado", "geblendet", "blind"]) {
      kit.giveTurn(wizard.id);
      refused(await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: enemy.id, spell: "Blindness/Deafness", saveAbility: "con", condition, level: 2 }), "blinded", "deafened");
    }
    kit.giveTurn(wizard.id);
    world.dice(1);
    accepted(await world.invoke("cast_at_enemy", { characterId: wizard.id, targetEnemyId: enemy.id, spell: "Blindness/Deafness", saveAbility: "con", condition: "BLINDED", level: 2 }));
    world.clearDice();
  } finally {
    await kit.endFight();
  }
});

await test("pc_attack: a maneuver is one the sheet picked, by its whole name; a beast form's attack is one the form has. Any other is refused with the ones there are.", async () => {
  const master = world.addHero({ name: "Eve", class: "fighter", subclass: "battle_master", level: 5, proficiencies: TRAINED, equipment: [{ name: "Longsword", qty: 1, equipped: true }] });
  const made = world.sheet(master.id);
  world.patch(master.id, {
    features: [...made.features.filter((feature) => !["Combat Superiority", "Maneuvers"].includes(feature.name)), { name: "Combat Superiority", source: "subclass" }, { name: "Maneuver: Trip Attack", source: "choice" }],
    resources: { ...made.resources, sub_superiority_dice: { max: 4, used: 0 } },
  });
  const bear = findBeastForm("Brown Bear");
  const druid = world.addHero({ name: "Fen", class: "druid", level: 4, proficiencies: TRAINED });
  world.patch(druid.id, { wildShape: { form: bear.name, beastHp: bear.hp, beastMaxHp: bear.hp, beastAc: bear.ac, attacks: bear.attacks } });
  await kit.fight(1);
  try {
    const [enemy] = world.enemies();
    kit.setEnemy(enemy.id, { maxHp: 400 });
    kit.place(enemy.id, 5, 5);
    kit.place(master.id, 6, 5);
    kit.place(druid.id, 5, 6);
    for (const maneuver of ["Trip", "Sgambetto", "Croc-en-jambe", "Derribo", "Attack", "Riposte"]) {
      kit.giveTurn(master.id);
      refused(await world.invoke("pc_attack", { characterId: master.id, enemyId: enemy.id, weapon: "Longsword", maneuver }), "Trip Attack");
    }
    kit.giveTurn(master.id);
    world.dice(15, 4, 5, 20);
    accepted(await world.invoke("pc_attack", { characterId: master.id, enemyId: enemy.id, weapon: "Longsword", maneuver: "trip-attack" }));
    world.clearDice();
    for (const weapon of ["Morso", "Griffes", "Garras", "Biss", "Claw"]) {
      kit.giveTurn(druid.id);
      refused(await world.invoke("pc_attack", { characterId: druid.id, enemyId: enemy.id, weapon }), "Bite", "Claws");
    }
    kit.giveTurn(druid.id);
    world.dice(1, 1);
    accepted(await world.invoke("pc_attack", { characterId: druid.id, enemyId: enemy.id, weapon: "CLAWS" }));
    world.clearDice();
  } finally {
    await kit.endFight();
  }
});

await test("use_reaction: a reaction rule is the one its whole name is; a feature whose name holds another's is its own, and an unknown name is refused with the sheet's features.", async () => {
  world.patch(cleric.id, { features: [...world.sheet(cleric.id).features, { name: "Arcane Protection", source: "story" }] });
  await kit.fight(1);
  try {
    for (const feature of ["Parata", "Parade", "Desvío", "Abwehr", "Arcane"]) {
      refused(await world.invoke("use_reaction", { characterId: cleric.id, feature }), "Arcane Protection");
    }
    // Before, any name holding "protection" ran the Protection style and was
    // refused for want of it.
    const own = await world.invoke("use_reaction", { characterId: cleric.id, feature: "arcane protection" });
    accepted(own);
    assert.doesNotMatch(JSON.stringify(own.result), /Fighting Style/);
  } finally {
    await kit.endFight();
  }
});

await test("use_resource: Draconic Presence charms or frightens as its variant says; any other word, or none, is refused before the points are spent.", async () => {
  const sorc = world.addHero({ ...caster("sorcerer", "cha", [], [], 18, { subclass: "Draconic Bloodline" }), name: "Iris" });
  const before = world.sheet(sorc.id).resources.sorcery_points.used;
  await kit.fight(1);
  try {
    for (const variant of [undefined, "charmy", "charmed", "frightening", "paura", "effroi", "Furcht", "charm and fear"]) {
      refused(await world.invoke("use_resource", { characterId: sorc.id, resource: "Draconic Presence", ...(variant ? { variant } : {}) }), "fear", "charm");
      assert.equal(world.sheet(sorc.id).resources.sorcery_points.used, before, `${variant} spent points`);
    }
  } finally {
    await kit.endFight();
  }
});

await test("run_prepared_encounter: a prepared fight is its whole name; a word of it, or the name without its article, is refused with the fights there are.", async () => {
  insertEncounterTemplate({
    campaignId: world.campaignId, name: "The Goblins at the Ford", enemies: [{ monster: "goblin", count: 1 }], battlefield: "a ford",
    map: { mapId: null, scene: "river", seed: null, theme: null, ambient: null, width: null, height: null }, notes: "", extras: {}, createdByUserId: world.owner.id,
  });
  const run = (name) => {
    const sheets = listSheets(world.campaignId);
    return dispatchAdjudication("run_prepared_encounter", JSON.stringify({ name }), {
      campaign: world.campaign(), turn: createDmTurn(world.campaignId, [], "ai"), sheets, sheetsById: new Map(sheets.map((sheet) => [sheet.id, sheet])), realDiceUserIds: new Set(),
    });
  };
  for (const name of ["Goblins", "Ford", "goblins at the ford", "I goblin al guado", "Les gobelins du gué", "Die Goblins an der Furt"]) {
    const out = await run(name);
    assert.ok(out.error?.includes("The Goblins at the Ford"), `${name}: ${JSON.stringify(out).slice(0, 200)}`);
  }
  const out = await run("THE GOBLINS AT THE FORD");
  assert.equal(out.error, undefined, JSON.stringify(out).slice(0, 200));
  await kit.endFight();
});

await test("downtime crafting: the tools are a proficiency's whole name; a word of it is refused with the tools they have.", async () => {
  // What a crafted item is worth is the pack's price.
  if (!world.hasPack) {
    return;
  }
  const smith = world.addHero({ name: "Gus", class: "fighter", level: 1, gold: 100, proficiencies: { ...TRAINED, tools: ["Smith's tools"] } });
  for (const tool of ["smith", "tools", "attrezzi da fabbro", "outils de forgeron", "Schmiedewerkzeug"]) {
    refused(await world.invoke("downtime", { days: 1, characterId: smith.id, activity: "crafting", item: "Shield", tool }), "Smith's tools");
  }
  accepted(await world.invoke("downtime", { days: 1, characterId: smith.id, activity: "crafting", item: "Shield", tool: "SMITH’S TOOLS" }));
});

await test("teleport_token and pc_attack: a token or a natural weapon is the whole name as written, at every table; a name with an article before it is another name, never the token or the weapon that is the rest of it.", async () => {
  const [first, second] = (await kit.fight(2), world.enemies());
  // As a prepared encounter names its enemies: the tracker and the board.
  const rename = (enemy, name) => {
    renameEnemy(enemy.id, name);
    renameTokenByRef(kit.map().id, enemy.id, name);
  };
  for (const [language, plain, article, other] of [
    ["english", "Wolf", "The Wolf", "Bear"],
    ["italian", "Lupo", "Il Lupo", "Orso"],
    ["french", "Garde", "La Garde", "Ours"],
    ["spanish", "Guardia", "La Guardia", "Oso"],
    ["german", "Wache", "Die Wache", "Bär"],
  ]) {
    updateGameSettings(world.campaignId, { tableLanguage: language });
    rename(first, plain);
    rename(second, article);
    kit.place(first.id, 2, 2);
    kit.place(second.id, 6, 6);
    accepted(await world.invoke("teleport_token", { tokenName: article, x: 7, y: 7 }));
    assert.deepEqual([kit.token(second.id).x, kit.token(first.id).x], [7, 2], `${language}: ${article}`);
    rename(second, other);
    refused(await world.invoke("teleport_token", { tokenName: article, x: 8, y: 8 }), plain, other);
    assert.equal(kit.token(first.id).x, 2, `${language}: ${article} moved ${plain}`);
  }
  updateGameSettings(world.campaignId, { tableLanguage: "english" });
  // A lineage's claws (src/lib/srd/racial-weapons.ts), on a hero at the board.
  const tabaxi = fighter;
  const features = world.sheet(tabaxi.id).features;
  world.patch(tabaxi.id, { features: [...features, { name: "Claws (1d4 slashing unarmed strike)" }] });
  kit.place(first.id, 5, 5);
  kit.place(tabaxi.id, 6, 5);
  kit.giveTurn(tabaxi.id);
  refused(await world.invoke("pc_attack", { characterId: tabaxi.id, enemyId: first.id, weapon: "her claws" }), "her claws");
  kit.giveTurn(tabaxi.id);
  world.dice(1, 1);
  accepted(await world.invoke("pc_attack", { characterId: tabaxi.id, enemyId: first.id, weapon: "claws" }));
  world.clearDice();
  world.patch(tabaxi.id, { features });
  await kit.endFight();
});

await test("open_shop: a name that holds a shop standing here, or that its name holds, is refused naming it, at every table; its whole name reopens it, and a name of its own opens a new shop.", async () => {
  for (const [language, place, shop, part, longer, other] of [
    ["italian", "Pietrafonda", "Bottega di Marla", "Marla", "La Bottega di Marla", "Fucina del Nano"],
    ["french", "Roche-Grise", "Échoppe de Marla", "Marla", "L'Échoppe de Marla", "Forge du Nain"],
    ["spanish", "Piedragris", "Tienda de Marla", "Marla", "La Tienda de Marla", "Fragua del Enano"],
    ["german", "Grauenstein", "Marlas Laden", "Laden", "Der Marlas Laden", "Zwergenschmiede"],
    ["english", "Greystone", "Marla's Shop", "Marla", "The Marla's Shop", "Dwarven Forge"],
  ]) {
    updateGameSettings(world.campaignId, { tableLanguage: language });
    upsertCurrentLocation({ campaignId: world.campaignId, name: place });
    accepted(await world.invoke("open_shop", { name: shop, kind: "general", size: "village" }));
    for (const name of [part, longer]) {
      refused(await world.invoke("open_shop", { name, kind: "general", size: "village" }), shop, "Nothing was opened");
    }
    const again = await world.invoke("open_shop", { name: shop.toUpperCase(), kind: "general", size: "village" });
    accepted(again);
    assert.equal(again.result?.reopened, true, `${language}: the whole name did not reopen ${shop}`);
    accepted(await world.invoke("open_shop", { name: other, kind: "smith", size: "village" }));
  }
  updateGameSettings(world.campaignId, { tableLanguage: "english" });
  const names = listShops(world.campaignId).map((entry) => entry.name);
  for (const unwanted of ["Marla", "Laden", "La Bottega di Marla", "The Marla's Shop"]) {
    assert.ok(!names.includes(unwanted), `a second shop "${unwanted}" was opened`);
  }
});

await test("an enemy or character ref that is none of the fight's or the party's is refused with the living enemies or the party by name and id, so the retry is one call.", async () => {
  await kit.fight(3);
  const [kept, other, felled] = world.enemies();
  kit.setEnemy(felled.id, { currentHp: 1 });
  accepted(await world.invoke("damage_enemy", { enemyId: felled.id, amount: 5, damageType: "bludgeoning" }));
  assert.equal(kit.enemy(felled.id).status, "dead");
  const party = listSheets(world.campaignId);
  const lists = (out, field, ref, records) => {
    refused(out, `Unknown ${field} "${ref}"`, ...records.map((record) => `${record.name} (${record.id})`));
  };
  const living = [kept, other].map((enemy) => ({ id: enemy.id, name: kit.enemy(enemy.id).displayName }));
  const enemyCalls = [
    ["pc_attack", "targetEnemyId", { characterId: fighter.id, weapon: "Longsword" }],
    ["cast_at_enemy", "targetEnemyId", { characterId: party.find((sheet) => sheet.name === "Dee").id, spell: "Blindness/Deafness", saveAbility: "con" }],
    ["enemy_attack", "enemyId", { targetCharacterId: fighter.id }],
    ["damage_enemy", "enemyId", { amount: 3, damageType: "fire" }],
    ["enemy_flees", "enemyId", {}],
    ["set_enemy_condition", "enemyId", { condition: "prone" }],
    ["declare_intent", "actor", { verb: "attack" }],
  ];
  for (const ref of ["goblin-9", felled.id.slice(0, 8)]) {
    for (const [tool, field, args] of enemyCalls) {
      kit.giveTurn(fighter.id);
      lists(await world.invoke(tool, { ...args, [field]: ref }), field, ref, living);
    }
  }
  const out = await world.invoke("enemy_attack", { enemyId: kept.id, targetCharacterId: "Ady" });
  lists(out, "targetCharacterId", "Ady", party);
  for (const [tool, args] of [
    ["pc_attack", { targetEnemyId: kept.id, weapon: "Longsword" }],
    ["take_action", { action: "dodge" }],
    ["end_turn", {}],
    ["mount_up", { mount: "Riding horse" }],
  ]) {
    lists(await world.invoke(tool, { ...args, characterId: "Ady" }), "characterId", "Ady", party);
  }
});

finish();
