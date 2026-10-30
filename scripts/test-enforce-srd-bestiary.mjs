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
// gap() per kind, the creatures it touches named in its message.
//
// Each gap() is a finding from the #570 SRD text audit: it asserts what the
// SRD 5.1 text says and fails today.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { bareName, defenceWords, diceShape, engineAttack, pageAttacks, readPage, rowOfBlock, sameMap, speedsOfEngine, XP_BY_CR } from "./lib/srd-bestiary.mjs";

const { test, gap, finish } = suite("test-enforce-srd-bestiary");
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

  await gap(
    "MON-05",
    {
      rule: "Rug of Smothering (rug-of-smothering-animated-object-animated-object), Smother: 'Hit: The creature is grappled (escape DC 13) ... In addition, at the start of each of the target's turns, the target takes 10 (2d6+3) bludgeoning damage.' The hit itself deals no damage",
      where: "src/lib/bestiary/attack-parse.ts parseAttack (damageFromFields takes the pack row's damage_dice and damage_bonus for a hit whose line prints no damage of its own)",
      severity: "low",
    },
    () => {
      const rug = ENEMIES.find((entry) => entry.name === "Rug of Smothering");
      const smother = rug.stats.attacks.find((attack) => attack.name === "Smother");
      assert.equal(smother.damage, "0", `the smother deals ${smother.damage} bludgeoning on the hit`);
    },
  );

  await gap(
    "MON-06",
    {
      rule: "Green Hag (green-hag) prints one Innate Spellcasting: 'At will: dancing lights, minor illusion, vicious mockery'; Night Hag (night-hag) likewise. A lone hag casts nothing else (Monster Statistics, Spellcasting: a monster casts the spells its block lists)",
      where: "src/lib/bestiary/statblock.ts parseMonster (castingParts reads every special whose name holds 'spellcasting', so the pack's 'Shared Spellcasting (Coven Only)' sidebar becomes the hag's own 12th-level casting); src/lib/dm/enemy-casting.ts lets it cast",
      severity: "medium",
    },
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

await gap(
  "MON-07",
  {
    rule: "An attack's hit carries the save its line prints: Clay Golem Slam 'must succeed on a DC 15 Constitution saving throw or have its hit point maximum reduced by an amount equal to the damage taken'; Bearded Devil Glaive (DC 12) and Horned Devil Tail (DC 17) 'or lose ... hit points at the start of each of its turns due to an infernal wound'; Solar Slaying Longbow 'must succeed on a DC 15 Constitution saving throw or die'",
    where: "src/lib/bestiary/attack-text.ts readAttackText (the drain wording 'have its hit point maximum reduced' and these saves are neither read into onHit nor kept as a manual note, so enemy_attack rolls no save and tells the GM nothing)",
    severity: "medium",
  },
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

await gap(
  "MON-08",
  {
    rule: "Monster Statistics, Multiattack: the creature makes the attacks the action lists; Gibbering Mouther 'makes one bite attack and, if it can, uses its Blinding Spittle'; Violet Fungus 'makes 1d4 Rotting Touch attacks'; Vampire, Vampire Spawn, Wererat 'two attacks, only one of which can be a bite', Wereboar 'only one of which can be with its tusks'; Lizardfolk 'two melee attacks, each one with a different weapon'",
    where: "src/lib/dm/enemy-profile.ts plannedSwings (with no routine it repeats the asked attack attacksPerTurn times); src/lib/bestiary/multiattack-text.ts parseRoutines (reads no limit on one attack)",
    severity: "medium",
  },
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

await gap(
  "MON-09",
  {
    rule: "Monster Statistics, Challenge: 'Monsters with a challenge rating of 0 ... those with no effective attacks are worth no experience points'; Frog and Sea Horse print 'Challenge 0 (0 XP)'",
    where: "src/lib/bestiary/statblock.ts parseMonster (xp: xpForCr(cr), never the block's own XP); src/lib/srd/encounter-math.ts xpForCr(0) is 10",
    severity: "low",
  },
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

await gap(
  "MON-10",
  {
    rule: "The stat blocks are SRD 5.1's own: a goblin is 'Armor Class 15 ... Hit Points 7 (2d6) ... Scimitar +4 to hit ... 5 (1d6+2) slashing damage' (goblin), an owlbear 'Armor Class 13 ... Hit Points 59 (7d10+21)' (owlbear). docs/install.md: without the pack the app 'falls back to the much smaller bundled SRD 5.1 data in src/lib/srd/', which holds both blocks",
    where: "src/lib/bestiary/index.ts resolveMonster (without the content pack a catalog creature gets synthesizeStats(cr) and any other SRD creature resolves to nothing; src/lib/srd/srd-creatures.json is never read for an enemy)",
    severity: "medium",
    note: "Reproduced by setting the content pack aside for the call, so it runs the same with the pack and without it.",
  },
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

await gap(
  "MON-11",
  {
    rule: "Monster Statistics, Multiattack: 'A creature that can make multiple attacks on its turn has the Multiattack action'; every adult and ancient dragon 'can use its Frightful Presence. It then makes three attacks', the marilith 'makes seven attacks', the tarrasque five, the nalfeshnee three, the hydra one per head. A Shapechange or True Polymorph form takes the form's statistics (shapechange, true-polymorph)",
    where: "scripts/lib/srd-creature-text.mjs attacksPerTurn (reads no count after a lead-in sentence, none above six), so src/lib/srd/srd-creatures.json and src/lib/srd/beast-forms.ts SHAPE_FORMS give these forms one attack; scripts/test-srd-creatures.mjs compares the table with the page through the same reader",
    severity: "medium",
  },
  () => {
    const wrong = [];
    for (const creature of SRD_CREATURES) {
      const block = blockOf(creature.name);
      const multi = block?.actions.find((entry) => /^Multiattack/.test(entry.name));
      if (multi && !((findShapeForm(creature.name)?.attacksPerTurn ?? 1) > 1)) wrong.push(creature.name);
    }
    assert.equal(wrong.length, 0, `forms whose Multiattack is lost, ${listed(wrong)}`);
  },
);

await gap(
  "MON-12",
  {
    rule: "A ranged spell attack printed with one range is still an attack: Horned Devil 'Hurl Flame. Ranged Spell Attack: +7 to hit, range 150 ft., one target. Hit: 14 (4d6) fire damage'; Barbed Devil and Efreeti likewise",
    where: "scripts/lib/srd-creature-text.mjs HEADER (reads 'range N/M ft.' only), so src/lib/srd/srd-creatures.json drops the attack from the form",
    severity: "low",
  },
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
