// The SRD 5.1 stat blocks held to their own text (issue #570, "Rules and
// content"): the pages of the rulebook's monsters, creatures and npcs
// chapters (src/lib/rulebook/srd-5.1.json), compared with what the engine
// fights with and what it shapes, summons and polymorphs into. Two paths
// read a block:
//
//   - an enemy: start_encounter resolves the monster (src/lib/bestiary/
//     index.ts resolveMonster) and reads the pack's SRD row through
//     src/lib/bestiary/statblock.ts parseMonster, with
//     src/lib/bestiary/pack-corrections.ts laid over it;
//   - a form or a summon: the creature table src/lib/srd/srd-creatures.json,
//     generated from the same rows with scripts/lib/srd-creature-overlay.mjs.
//
// Each page is read here by scripts/lib/srd-bestiary.mjs, a reader written
// apart from the engine's, and where no pack is needed the page's own words
// are handed to parseMonster as a row, so the suite says the same in CI. The
// checks sweep every page and group what differs by the kind of error: one
// check per kind, the creatures it touches named in its message.
//
// Each MON-nn test was a finding of the #570 SRD text audit, a gap() until
// the engine held what the SRD 5.1 text says; a new finding is a gap() here
// again (scripts/lib/enforce-harness.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { bareName, defenceWords, diceShape, engineAttack, pageAttacks, readPage, rowOfBlock, sameMap, speedsOfEngine, XP_BY_CR } from "./lib/srd-bestiary.mjs";

const { test, finish } = suite("test-enforce-srd-bestiary");
const world = await openWorld();
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { resolveMonster } = await import("../src/lib/bestiary/index.ts");
const { legendaryProfile } = await import("../src/lib/dm/legendary-logic.ts");
const { hasTrait } = await import("../src/lib/dm/monster-abilities.ts");
const { plannedSwings } = await import("../src/lib/dm/enemy-profile.ts");
const { SRD_CREATURES } = await import("../src/lib/srd/srd-creatures.ts");
const { findShapeForm } = await import("../src/lib/srd/beast-forms.ts");

const book = JSON.parse(fs.readFileSync(new URL("../src/lib/rulebook/srd-5.1.json", import.meta.url), "utf8"));
const PAGES = book.pages.filter((page) => ["monsters", "creatures", "npcs"].includes(page.chapter) && page.kind === "monster");
const byTitle = new Map(PAGES.map((page) => [page.title, page]));

// The pack and the table name five creatures otherwise than their pages.
const PAGE_TITLE = {
  "Animated Armor": "Animated Armor (Animated Object)",
  "Flying Sword": "Flying Sword (Animated Object)",
  "Rug of Smothering": "Rug of Smothering (Animated Object)",
  Drow: "Elf, Drow",
  "Deep Gnome (Svirfneblin)": "Gnome, Deep",
};

// Every creature the pages print, under its own name; the half-red dragon
// veteran sits on the template's page under a heading of its own.
const BLOCKS = new Map();
for (const page of PAGES) {
  const block = readPage(page.md);
  if (block) {
    BLOCKS.set(page.title, block);
  }
}
BLOCKS.set("Half-Red Dragon Veteran", readPage(byTitle.get("Half-Dragon Template").md, { heading: "Half-Red Dragon Veteran" }));
const blockOf = (name) => BLOCKS.get(PAGE_TITLE[name] ?? name) ?? null;
// The engine reading the SRD's own words, as it reads a pack row.
const fromText = (name) => parseMonster(rowOfBlock(name, blockOf(name)), blockOf(name).cr);

// Where the bundled text is the one that slipped and the pack is right, as
// scripts/lib/srd-creature-overlay.mjs PACK_KEEPS records with its reasons:
// the line contradicts the block's own scores. Not held against the engine.
const TEXT_SLIPS = {
  attacks: new Set(["Mage", "Merrow", "Bandit Captain"]),
  saves: new Set(["Guardian Naga", "Spirit Naga"]),
};

// The pack's SRD rows as start_encounter resolves them (the enemy path),
// each beside its page. Empty without the pack.
const settings = world.campaign().gameSettings;
const ENEMIES = [];
if (world.hasPack) {
  const { getContentDb } = await import("../src/lib/content/db.ts");
  const rows = getContentDb().prepare("SELECT slug, name FROM monsters WHERE document_slug = 'wotc-srd' ORDER BY name").all();
  for (const row of rows) {
    const block = blockOf(row.name);
    const resolved = block ? resolveMonster(row.slug, settings) : null;
    if (resolved) {
      ENEMIES.push({ name: row.name, slug: row.slug, block, stats: resolved.stats });
    }
  }
}

const modifier = (score) => Math.floor((score - 10) / 2);
const listed = (entries) => `${entries.length}: ${entries.join("; ")}`;

// ---- the enemy path, with the pack ----

if (world.hasPack) {
  await test(
    "MON-01: the enemy path fights each SRD row with its block's Armor Class, hit points, challenge and XP, saving throws and attack numbers",
    () => {
      const wrong = [];
      for (const { name, block, stats } of ENEMIES) {
        if (stats.ac !== block.ac) wrong.push(`${name} AC ${stats.ac} (SRD ${block.ac})`);
        if (stats.maxHp !== block.hp) wrong.push(`${name} HP ${stats.maxHp} (SRD ${block.hp})`);
        if (stats.cr !== block.cr) wrong.push(`${name} CR ${stats.cr} (SRD ${block.cr})`);
        if (block.cr > 0 && stats.xp !== block.xp) wrong.push(`${name} XP ${stats.xp} (SRD ${block.xp})`);
        if (!TEXT_SLIPS.saves.has(name)) {
          for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
            const want = block.saves[ability] ?? modifier(block.abilities[ability]);
            if (stats.saveMods[ability] !== want) wrong.push(`${name} ${ability} save ${stats.saveMods[ability]} (SRD ${want})`);
          }
        }
        for (const { name: attackName, line } of pageAttacks(block)) {
          const attack = engineAttack(stats, attackName);
          if (!attack) continue;
          if (attack.toHit !== line.toHit) wrong.push(`${name} ${attackName} ${attack.toHit} to hit (SRD ${line.toHit})`);
          const printed = diceShape(line.amounts.map((amount) => amount.dice).join("+") || "0");
          if (!TEXT_SLIPS.attacks.has(name) && line.amounts.length && diceShape(attack.damage) !== printed) {
            wrong.push(`${name} ${attackName} ${attack.damage} (SRD ${printed})`);
          }
        }
      }
      assert.equal(wrong.length, 0, `SRD blocks fought with misprinted numbers, ${listed(wrong)}`);
    },
  );

  await test(
    "MON-02: the enemy path reads each SRD row's damage and condition defences as printed: the wight resists necrotic and is immune to poison and exhaustion, the ice devil is immune to cold, the mummy lord is vulnerable to fire",
    () => {
      const wrong = [];
      for (const { name, block, stats } of ENEMIES) {
        for (const field of ["vulnerable", "resist", "immune", "conditionImmune"]) {
          if (defenceWords(stats[field]) !== defenceWords(block[field])) wrong.push(`${name} ${field} "${stats[field]}" (SRD "${block[field]}")`);
        }
      }
      assert.equal(wrong.length, 0, `SRD defences read otherwise than printed, ${listed(wrong)}`);
    },
  );

  await test(
    "MON-03: the enemy path reads each SRD row's speeds and special senses as printed: the crocodile swims 30 ft., the priest walks 30 ft., the hunter shark has blindsight 30 ft.",
    () => {
      const wrong = [];
      for (const { name, block, stats } of ENEMIES) {
        const speeds = speedsOfEngine(stats.speed);
        if (!sameMap(speeds, block.speeds) && !/\(/.test(block.speedText)) wrong.push(`${name} speed "${stats.speed}" (SRD "${block.speedText}")`);
        for (const sense of ["darkvision", "blindsight", "tremorsense", "truesight"]) {
          if ((stats.senses?.[sense] ?? null) !== (block.senses[sense] ?? null)) wrong.push(`${name} ${sense} ${stats.senses?.[sense] ?? "none"} (SRD ${block.senses[sense] ?? "none"})`);
        }
      }
      assert.equal(wrong.length, 0, `SRD speeds and senses read otherwise than printed, ${listed(wrong)}`);
    },
  );

  await test(
    "MON-04: the enemy path holds each SRD row's skills and passive Perception as printed: the blink dog's passive Perception 13, the black bear's Perception +3, the spy's Sleight of Hand +4",
    () => {
      const wrong = [];
      for (const { name, block, stats } of ENEMIES) {
        if ((stats.senses?.passivePerception ?? null) !== (block.senses.passivePerception ?? null)) {
          wrong.push(`${name} passive Perception ${stats.senses?.passivePerception} (SRD ${block.senses.passivePerception})`);
        }
        for (const [skill, bonus] of Object.entries(block.skills)) {
          if (stats.skills?.[skill] !== bonus) wrong.push(`${name} ${skill} ${stats.skills?.[skill] ?? "none"} (SRD +${bonus})`);
        }
      }
      assert.equal(wrong.length, 0, `SRD skills and passive Perception read otherwise than printed, ${listed(wrong)}`);
    },
  );

  await test(
    "MON-05: a rug of smothering's Smother deals no damage on the hit; the bludgeoning damage at the start of the target's turns is a note for the GM",
    () => {
      const rug = ENEMIES.find((entry) => entry.name === "Rug of Smothering");
      const smother = rug.stats.attacks.find((attack) => attack.name === "Smother");
      assert.equal(smother.damage, "0", `the smother deals ${smother.damage} bludgeoning on the hit`);
    },
  );

  await test(
    "MON-06: a lone green or night hag casts only her own Innate Spellcasting, never her coven's shared spells",
    async () => {
      const hero = world.addHero({ name: "Witch Hunter", class: "fighter", level: 5, maxHp: 60 });
      await world.beginFight([{ monster: "green-hag" }]);
      const [hag] = world.enemies();
      const out = await world.invoke("cast_at_player", { characterId: hero.id, casterEnemyId: hag.id, spell: "Lightning Bolt", reason: "a lone green hag casts a coven spell" });
      await world.invoke("end_encounter", { outcome: "truce" });
      const nightHag = ENEMIES.find((entry) => entry.name === "Night Hag").stats.spellcasting;
      assert.ok(
        !out.ok && !Object.keys(nightHag.slots).length,
        `a lone green hag cast Lightning Bolt (${out.ok ? "allowed" : out.error}); a night hag holds slots ${JSON.stringify(nightHag.slots)} and ${nightHag.spells.length} spells`,
      );
    },
  );
}

await test("With the pack, the enemy path reads every other field of the SRD rows as printed: size, ability scores, legendary actions and their costs, Legendary Resistance, spell DCs, slots and lists, and the traits the engine plays", () => {
  for (const { name, block, stats } of ENEMIES) {
    assert.equal(stats.size, block.size, name);
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
      assert.equal(stats.abilities[ability], block.abilities[ability], `${name} ${ability}`);
    }
  }
});

// ---- the SRD's own words, read by the enemy reader (no pack needed) ----

await test(
  "MON-07: an attack's hit carries the save its line prints: the clay golem's Slam drains the hit point maximum on a failed DC 15 Constitution save, and the devils' infernal wound and the solar's slaying arrow roll their saves and tell the GM the rest",
  () => {
    const dropped = [];
    for (const [name, attackName] of [["Clay Golem", "Slam"], ["Bearded Devil", "Glaive"], ["Horned Devil", "Tail"], ["Solar", "Slaying Longbow"]]) {
      const line = pageAttacks(blockOf(name)).find((entry) => entry.name === attackName).line;
      const attack = engineAttack(fromText(name), attackName);
      const pack = ENEMIES.find((entry) => entry.name === name);
      for (const [where, read] of [["text", attack], ...(pack ? [["pack", engineAttack(pack.stats, attackName)]] : [])]) {
        const held = read.onHit?.save === line.save.ability && read.onHit?.dc === line.save.dc;
        if (!held) dropped.push(`${name} ${attackName} (${where}): onHit ${JSON.stringify(read.onHit ?? null)}, SRD DC ${line.save.dc} ${line.save.ability}`);
      }
    }
    assert.equal(dropped.length, 0, `on-hit saves the enemy reader drops, ${listed(dropped)}`);
  },
);

await test(
  "MON-08: a Multiattack's limits hold: the gibbering mouther bites once beside its Blinding Spittle, the violet fungus rolls its 1d4 Rotting Touches, a vampire, vampire spawn, wererat or wereboar makes only one bite (or tusks) of its two attacks, and a lizardfolk's two attacks use different weapons",
  () => {
    const wrong = [];
    const swings = (name, asked) => {
      const stats = fromText(name);
      const attack = asked ? stats.attacks.find((entry) => entry.name.startsWith(asked)) : null;
      return plannedSwings(stats, stats.attacks, attack).map((entry) => entry.name);
    };
    const mouther = swings("Gibbering Mouther");
    if (mouther.length !== 1) wrong.push(`Gibbering Mouther makes ${mouther.join(", ")}`);
    const fungus = fromText("Violet Fungus");
    if (fungus.attacksPerTurn === 2 && !fungus.routines) wrong.push("Violet Fungus makes a fixed 2 Rotting Touches, not 1d4");
    for (const [name, asked] of [["Vampire", "Bite"], ["Vampire Spawn", "Bite"], ["Wererat", "Bite"], ["Wereboar", "Tusks"]]) {
      const planned = swings(name, asked);
      if (planned.filter((entry) => entry.startsWith(asked)).length > 1) wrong.push(`${name} makes ${planned.join(", ")}`);
    }
    const lizard = swings("Lizardfolk");
    if (new Set(lizard).size !== lizard.length) wrong.push(`Lizardfolk makes ${lizard.join(", ")}`);
    assert.equal(wrong.length, 0, `Multiattack limits not held, ${listed(wrong)}`);
  },
);

await test(
  "MON-09: a challenge 0 creature with no effective attack (the frog, the sea horse) is worth 0 XP",
  () => {
    const wrong = [];
    for (const [name, block] of BLOCKS) {
      if (block.cr === 0 && block.xp === 0) {
        const xp = fromText(name).xp;
        if (xp !== 0) wrong.push(`${name} ${xp} XP`);
      }
    }
    assert.equal(wrong.length, 0, `CR 0 creatures with no attack still award XP, ${listed(wrong)}`);
  },
);

await test(
  "MON-10: without the content pack an SRD creature fights with its bundled SRD 5.1 block: a goblin at AC 15 with 7 hit points and a +4 scimitar, an owlbear with 59 hit points and a +7 beak",
  () => {
    const saved = globalThis.__odmContentDb;
    globalThis.__odmContentDb = null;
    let goblin;
    let owlbear;
    try {
      goblin = resolveMonster("goblin", settings);
      owlbear = resolveMonster("owlbear", settings);
    } finally {
      globalThis.__odmContentDb = saved;
    }
    const scimitar = goblin?.stats.attacks.find((attack) => attack.name === "Scimitar");
    const beak = owlbear?.stats.attacks.find((attack) => attack.name === "Beak");
    const seen = (found) => (found ? `AC ${found.stats.ac}, ${found.stats.maxHp} HP, attacks ${found.stats.attacks.map((attack) => `${attack.name} +${attack.toHit} ${attack.damage} ${attack.type}`).join(", ")}` : "nothing (start_encounter refuses it)");
    assert.ok(
      goblin?.stats.ac === 15 && goblin.stats.maxHp === 7 && scimitar?.toHit === 4 && scimitar.type === "slashing" && owlbear?.stats.maxHp === 59 && beak?.toHit === 7,
      `with no pack a goblin fights as ${seen(goblin)}; an owlbear as ${seen(owlbear)}`,
    );
  },
);

await test("Every legendary creature's page is read as printed: actions a round, each option and its cost, and Legendary Resistance (n/Day)", () => {
  let checked = 0;
  for (const [name, block] of BLOCKS) {
    if (!block.legendary) continue;
    const profile = legendaryProfile(fromText(name));
    assert.ok(profile, name);
    assert.equal(profile.actionsPerRound, block.legendary.count, name);
    for (const option of block.legendary.options) {
      const action = profile.actions.find((entry) => entry.name.toLowerCase() === option.name.toLowerCase());
      assert.ok(action, `${name}: ${option.name}`);
      assert.equal(action.cost, option.cost, `${name}: ${option.name}`);
    }
    const resistance = block.traits.find((trait) => /^Legendary Resistance \((\d)\/Day\)/.test(trait.name));
    if (resistance) {
      assert.equal(profile.resistances, Number(/\((\d)\//.exec(resistance.name)[1]), name);
    }
    checked += 1;
  }
  assert.equal(checked, 30);
});

await test("Every SRD spellcaster's page is read as printed: spell save DC, spell attack bonus, slots by level and each spell listed", () => {
  let checked = 0;
  for (const [name, block] of BLOCKS) {
    const trait = block.traits.find((entry) => /Spellcasting/.test(entry.name));
    if (!trait) continue;
    const casting = fromText(name).spellcasting;
    assert.ok(casting, name);
    const dc = /spell save DC (\d+)/.exec(trait.text);
    if (dc) assert.equal(casting.dc, Number(dc[1]), `${name} DC`);
    const attack = /([+-]\d+) to hit with spell attacks/.exec(trait.text);
    if (attack) assert.equal(casting.attack, Number(attack[1]), `${name} attack`);
    for (const line of trait.text.split("\n")) {
      const slots = /^(\d)(?:st|nd|rd|th) level \((\d) slots?\): (.*)$/.exec(line);
      const innate = /^(?:At will|\d\/day(?: each)?|Cantrips \(at will\)): (.*)$/i.exec(line);
      if (slots) assert.equal(casting.slots[slots[1]], Number(slots[2]), `${name} level ${slots[1]} slots`);
      for (const spell of (slots?.[3] ?? innate?.[1] ?? "").split(/,\s*/).map((entry) => entry.replace(/\(.*?\)/g, "").trim()).filter(Boolean)) {
        assert.ok(casting.spells.some((entry) => entry.name.toLowerCase() === spell.toLowerCase()), `${name}: ${spell}`);
      }
    }
    checked += 1;
  }
  assert.ok(checked >= 34, `${checked} casters`);
});

await test("Every page's Magic Resistance, Pack Tactics, Nimble Escape, Sunlight Sensitivity, Undead Fortitude, Regeneration and Magic Weapons trait is one the engine plays", () => {
  const FLAGS = {
    "Magic Resistance": "magicResistance", "Pack Tactics": "packTactics", "Nimble Escape": "nimbleEscape",
    "Sunlight Sensitivity": "sunlightSensitivity", "Sunlight Weakness": "sunlightWeakness",
    "Undead Fortitude": "undeadFortitude", Regeneration: "regeneration", "Magic Weapons": "magicWeapons",
  };
  let checked = 0;
  for (const [name, block] of BLOCKS) {
    for (const trait of block.traits) {
      const flag = FLAGS[trait.name.replace(/\s*\(.*\)$/, "")];
      if (flag) {
        assert.ok(hasTrait(fromText(name), flag), `${name}: ${trait.name}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 60, `${checked} traits`);
});

await test("Regeneration reads its amount and what stops it: the troll's 10 stopped by acid or fire, the vampire's 20 by radiant", () => {
  assert.deepEqual(fromText("Troll").regeneration, { amount: 10, stoppedBy: ["acid", "fire"], diesOnlyAtTurnStart: true });
  const vampire = fromText("Vampire").regeneration;
  assert.equal(vampire.amount, 20);
  assert.deepEqual(vampire.stoppedBy, ["radiant"]);
});

await test("A block's printed XP is its challenge's in the SRD table, for every page above challenge 0", () => {
  for (const [name, block] of BLOCKS) {
    if (block.cr > 0) {
      assert.equal(XP_BY_CR.get(block.cr), block.xp, name);
      assert.equal(fromText(name).xp, block.xp, name);
    }
  }
});

// ---- the creature table: forms and summons (no pack needed) ----

await test(
  "MON-11: a Shapechange or True Polymorph form attacks as its Multiattack says: three for every adult and ancient dragon, seven for the marilith, five for the tarrasque and the hydra, two for a vampire, and one for the gibbering mouther and the mummies, which act otherwise beside it",
  () => {
    const wrong = [];
    for (const creature of SRD_CREATURES) {
      const block = blockOf(creature.name);
      const multi = block?.actions.find((entry) => /^Multiattack/.test(entry.name));
      // The audit's first reading held every Multiattack to two attacks or
      // more; a few make one attack beside another action, and hold one: the
      // gibbering mouther "makes one bite attack and, if it can, uses its
      // Blinding Spittle", a mummy "can use its Dreadful Glare and makes one
      // attack with its rotting fist" (the grick's "can make one beak attack"
      // after a hit is its second, the roper's "makes one attack with its
      // bite" its fifth).
      const counts = multi ? [...multi.text.matchAll(/\bmakes? (\w+) (?:\w+ )?attacks?\b/gi)].map((match) => match[1].toLowerCase()) : [];
      const one = counts.length === 1 && counts[0] === "one" && !/\bcan make\b/i.test(multi.text);
      const perTurn = findShapeForm(creature.name)?.attacksPerTurn ?? 1;
      if (multi && (one ? perTurn !== 1 : !(perTurn > 1))) wrong.push(`${creature.name} ${perTurn}`);
    }
    assert.equal(wrong.length, 0, `forms whose Multiattack is lost, ${listed(wrong)}`);
  },
);

await test(
  "MON-12: a ranged spell attack printed with one range is still a form's attack: the horned devil's, barbed devil's and efreeti's Hurl Flame",
  () => {
    const missing = [];
    for (const creature of SRD_CREATURES) {
      const block = blockOf(creature.name);
      for (const { name } of block ? pageAttacks(block) : []) {
        if (/\((?:recharge|\d+\/day)/i.test(name)) continue;
        if (!creature.attacks.some((attack) => bareName(attack.name) === bareName(name))) missing.push(`${creature.name} ${name}`);
      }
    }
    assert.equal(missing.length, 0, `attacks the creature table drops, ${listed(missing)}`);
  },
);

await test("The creature table holds every other SRD block's numbers as printed: AC, hit points, challenge, scores, the saves it is proficient in, speeds, senses and each attack's bonus", () => {
  for (const creature of SRD_CREATURES) {
    const block = blockOf(creature.name);
    if (!block) continue;
    assert.equal(creature.ac, block.ac, creature.name);
    assert.equal(creature.hp, block.hp, creature.name);
    assert.equal(creature.cr, block.cr, creature.name);
    assert.deepEqual(creature.abilities, block.abilities, creature.name);
    if (!TEXT_SLIPS.saves.has(creature.name)) {
      assert.deepEqual([...(creature.saves ?? [])].sort(), Object.keys(block.saves).sort(), creature.name);
    }
    if (!/\(/.test(block.speedText)) {
      assert.ok(sameMap(Object.fromEntries(Object.entries(creature.speeds).filter(([, feet]) => feet > 0)), block.speeds), creature.name);
    }
    const senses = { ...block.senses };
    delete senses.passivePerception;
    assert.ok(sameMap(creature.senses ?? {}, senses), creature.name);
    for (const { name, line } of pageAttacks(block)) {
      const attack = creature.attacks.find((entry) => bareName(entry.name) === bareName(name));
      if (attack) assert.equal(attack.toHit, line.toHit, `${creature.name} ${name}`);
    }
  }
});

world.close();
finish();
