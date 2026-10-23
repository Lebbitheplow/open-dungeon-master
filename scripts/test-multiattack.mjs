// An enemy swings what its Multiattack prints, and its hit lands the type
// the Hit: clause prints (SRD 5.1, Monsters: Multiattack; the Xorn's "three
// claw attacks and one bite attack", the Poisonous Snake's "1 piercing
// damage, and ... taking 5 (2d4) poison damage on a failed save"). The
// blocks come from the pack when it is there and from the SRD text written
// out below when it is not, the way upstream CI runs. With the pack, every
// Multiattack in it is read: the swings planned without an asked attack
// equal the count the text names, and each text no routine or count can be
// read from is pinned with its reason in multiattack-unread.json
// (`node scripts/test-multiattack.mjs --write` rewrites it), and every attack
// line that prints its bonus is read, Tome of Beasts 3's unlabelled ones
// included.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { d20Count, monsterKit } from "./lib/enforce-monsters.mjs";

const { test, finish } = suite("test-multiattack");
const world = await openWorld();
const kit = await combatKit(world);
const mk = await monsterKit(world, kit);
const { getContentDb } = await import("../src/lib/content/db.ts");
const { parseMonster, parseMultiattackCount } = await import("../src/lib/bestiary/statblock.ts");
const { COUNT_WORD, multiattackAlternatives, multiattackItems, multiattackParts, multiattackSentences, parseRoutines } =
  await import("../src/lib/bestiary/multiattack-text.ts");
const { plannedSwings } = await import("../src/lib/dm/enemy-profile.ts");
const { parseAttack } = await import("../src/lib/bestiary/attack-parse.ts");
const { correctedMonsterData } = await import("../src/lib/bestiary/pack-corrections.ts");

// SRD 5.1 text, in the pack's shape.
const SRD = {
  xorn: {
    name: "Xorn", size: "Medium", type: "Elemental", armor_class: 19, hit_points: 73, cr: 5,
    actions: [
      { name: "Multiattack", desc: "The xorn makes three claw attacks and one bite attack." },
      { name: "Bite", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (3d6 + 3) piercing damage.", attack_bonus: 6, damage_dice: "3d6", damage_bonus: 3 },
      { name: "Claw", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 6 (1d6 + 3) slashing damage.", attack_bonus: 6, damage_dice: "1d6", damage_bonus: 3 },
    ],
  },
  "poisonous-snake": {
    name: "Poisonous Snake", size: "Tiny", type: "Beast", armor_class: 13, hit_points: 2, cr: 0.125,
    actions: [
      { name: "Bite", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 1 piercing damage, and the target must make a DC 10 Constitution saving throw, taking 5 (2d4) poison damage on a failed save, or half as much damage on a successful one.", attack_bonus: 5, damage_dice: "2d4" },
    ],
  },
};

// The SRD row by slug: the pack's own when there is one.
function srdRow(slug) {
  const db = getContentDb();
  const row = db?.prepare("SELECT data_json FROM monsters WHERE slug = ?").get(slug);
  return row ? JSON.parse(row.data_json) : SRD[slug];
}

// A monk's Purity of Body: immune to poison damage.
const monk = world.addHero({
  name: "Monk", class: "monk", level: 10, proficiencies: TRAINED, maxHp: 300, ac: 10, acOverride: true,
  features: [{ name: "Purity of Body", source: "class" }],
});
// Out of reach of every swing, so only the d20s roll.
const wall = world.addHero({ name: "Wall", class: "fighter", level: 5, proficiencies: TRAINED, maxHp: 300, ac: 40, acOverride: true });

async function stage(row) {
  await kit.endFight();
  for (const hero of [monk, wall]) {
    world.patch(hero.id, { currentHp: 300, conditions: [], conditionMeta: {} });
  }
  await kit.fight(1);
  const [enemy] = world.enemies();
  mk.stage(enemy.id, row);
  kit.place(enemy.id, 5, 5);
  kit.place(monk.id, 6, 5);
  kit.place(wall.id, 5, 6);
  kit.freshRound();
  return enemy;
}

await test("A Xorn's turn makes three claw swings and one bite (SRD 5.1, Xorn: Multiattack).", async () => {
  const xorn = await stage(srdRow("xorn"));
  const turn = await mk.forced(new Array(8).fill(2), () => world.invoke("enemy_attack", { enemyId: xorn.id, targetCharacterId: wall.id }));
  assert.equal(turn.ok, true, turn.error);
  assert.equal(d20Count(turn.rolled), 4, "the Xorn swung a number of times other than its Multiattack's four");
});

await test("A Poisonous Snake's bite lands its 1 piercing on a poison-immune target; the poison is the save's (SRD 5.1, Poisonous Snake).", async () => {
  const snake = await stage(srdRow("poisonous-snake"));
  const bite = await mk.forced([15, 20, 1, 1], () => world.invoke("enemy_attack", { enemyId: snake.id, targetCharacterId: monk.id }));
  assert.equal(bite.ok, true, bite.error);
  assert.equal(world.sheet(monk.id).currentHp, 299, "the bite's piercing did not land");
});

// The routines and the count a Multiattack line reads as, written
// "Claw x3 + Bite x1" per routine.
function readAs(desc, names) {
  const routines = parseRoutines(desc, names)?.map((routine) => routine.map((step) => `${step.attack} x${step.count}`).join(" + ")) ?? null;
  return { routines, count: parseMultiattackCount(desc) };
}

// SRD 5.1's own lines, so the pins hold without the pack.
const PINNED = [
  ["Xorn", "The xorn makes three claw attacks and one bite attack.", ["Bite", "Claw"], ["Claw x3 + Bite x1"], 4],
  ["Roper", "The roper makes four attacks with its tendrils, uses Reel, and makes one attack with its bite.", ["Bite", "Tendril"], ["Tendril x4 + Bite x1"], 5],
  ["Mummy", "The mummy can use its Dreadful Glare and makes one attack with its rotting fist.", ["Rotting Fist"], ["Rotting Fist x1"], null],
  ["Wight", "The wight makes two longsword attacks or two longbow attacks. It can use its Life Drain in place of one longsword attack.", ["Life Drain", "Longsword", "Longbow"], ["Longsword x2", "Longbow x2"], 2],
  ["Giant Scorpion", "The scorpion makes three attacks: two with its claws and one with its sting.", ["Claw", "Sting"], ["Claw x2 + Sting x1"], 3],
  ["Efreeti", "The efreeti makes two scimitar attacks or uses its Hurl Flame twice.", ["Scimitar", "Hurl Flame"], ["Scimitar x2", "Hurl Flame x2"], 2],
  ["Veteran", "The veteran makes two longsword attacks. If it has a shortsword drawn, it can also make a shortsword attack.", ["Longsword", "Shortsword", "Heavy Crossbow"], ["Longsword x2 + Shortsword x1"], 3],
  ["Dragon Turtle", "The dragon turtle makes three attacks: one with its bite and two with its claws. It can make one tail attack in place of its two claw attacks.", ["Bite", "Claw", "Tail"], ["Bite x1 + Claw x2", "Tail x1"], 3],
  // "stinger" is a word of Tail Stinger, not its name: the line as printed
  // reads no routine; the block reads it corrected (below).
  ["Purple Worm", "The worm makes two attacks: one with its bite and one with its stinger.", ["Bite", "Tail Stinger"], null, 2],
];

for (const [name, desc, names, routines, count] of PINNED) {
  await test(`A ${name}'s Multiattack reads as SRD 5.1 prints it.`, () => {
    assert.deepEqual(readAs(desc, names), { routines, count });
  });
}

await test("A Purple Worm's turn is a bite and a tail stinger: its Multiattack is read with the attack's whole name (SRD 5.1, Purple Worm).", () => {
  const worm = {
    name: "Purple Worm", slug: "purple-worm", document__slug: "wotc-srd", size: "Gargantuan", type: "Monstrosity", armor_class: 18, hit_points: 247, cr: 15,
    actions: [
      { name: "Multiattack", desc: "The worm makes two attacks: one with its bite and one with its stinger." },
      { name: "Bite", desc: "Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 22 (3d8 + 9) piercing damage.", attack_bonus: 9, damage_dice: "3d8", damage_bonus: 9 },
      { name: "Tail Stinger", desc: "Melee Weapon Attack: +9 to hit, reach 10 ft., one creature. Hit: 19 (3d6 + 9) piercing damage, and the target must make a DC 19 Constitution saving throw, taking 42 (12d6) poison damage on a failed save, or half as much damage on a successful one.", attack_bonus: 9, damage_dice: "3d6", damage_bonus: 9 },
    ],
  };
  for (const row of [worm, ...(world.hasPack ? [srdRow("purple-worm")] : [])]) {
    const stats = parseMonster(row, 15);
    assert.deepEqual(plannedSwings(stats, stats.attacks, null).map((swing) => swing.name), ["Bite", "Tail Stinger"]);
  }
});

await test("A Multiattack's groups name the block's attacks by whole name, \"+1\" and a bracket note set aside, either side plural.", () => {
  assert.deepEqual(readAs("The vila makes two shortsword attacks or two shortbow attacks.", ["+1 Shortsword", "+1 Shortbow"]).routines, ["+1 Shortsword x2", "+1 Shortbow x2"]);
  assert.deepEqual(readAs("It makes two talon attacks and one beak attack.", ["Talons (Eagle Form Only)", "Beak (Eagle Form Only)"]).routines, ["Talons (Eagle Form Only) x2 + Beak (Eagle Form Only) x1"]);
  assert.equal(readAs("The devil makes three Claw attacks.", ["Shard Claw (Fiend Form Only)"]).routines, null, "a word of a name named it");
  assert.equal(readAs("The clockwork myrmidon makes one Slam attack and two Heavy Pick attacks.", ["War Pick", "Slam"]).routines, null, "a routine stopped short of a group it could not read");
});

await test("A Multiattack's alternatives are routines of their own; one way to spend the turn is counted.", () => {
  assert.deepEqual(readAs("The doom croaker makes one Peck attack and one Runestaff attack, or it makes two Rune Blast attacks.", ["Peck", "Runestaff", "Rune Blast"]), { routines: ["Peck x1 + Runestaff x1", "Rune Blast x2"], count: 2 });
  assert.deepEqual(readAs("Hraesvelgr makes one Beak attack and two Talon attacks, or he makes three Fist attacks.", ["Beak", "Talons", "Fist"]), { routines: ["Beak x1 + Talons x2", "Fist x3"], count: 3 });
  assert.deepEqual(readAs("The dhampir makes two rapier or two shortbow attacks.", ["Rapier", "Shortbow"]), { routines: ["Rapier x2", "Shortbow x2"], count: 2 });
  assert.deepEqual(readAs("The gug makes two slam attacks, two stomp attacks, or one of each.", ["Slam", "Stomp"]), { routines: ["Slam x2", "Stomp x2"], count: 2 });
  assert.deepEqual(readAs("Three Pitchfork attacks or it makes one Pitchfork attack then uses Grab and Throw.", ["Pitchfork"]).count, 3);
  assert.deepEqual(readAs("The bearfolk makes two attacks with its battleaxe and one with its bite.", ["Battleaxe", "Bite"]), { routines: ["Battleaxe x2 + Bite x1"], count: 3 });
  assert.deepEqual(readAs("The kraken makes three tentacle attacks, each of which it can replace with one use of Fling.", ["Bite", "Tentacle"]), { routines: ["Tentacle x3"], count: 3 });
  // A5e says it with "attacks" as the verb (issue 473).
  assert.deepEqual(readAs("The dragon uses Grasp of Shadows then attacks once with its bite and twice with its claws.", ["Bite", "Claw"]), { routines: ["Bite x1 + Claw x2"], count: 3 });
  assert.deepEqual(readAs("The dragon attacks with its bite and twice with its claws. In place of its bite  it can use Acid Spit.", ["Bite", "Claws"]), { routines: ["Bite x1 + Claws x2"], count: 3 });
  assert.deepEqual(readAs("The aboleth attacks three times with its tentacle.", ["Tentacle"]), { routines: ["Tentacle x3"], count: 3 });
  assert.deepEqual(readAs("The phase monster attacks with its horns and its claws.", ["Horns", "Claws"]), { routines: ["Horns x1 + Claws x1"], count: 2 });
  assert.deepEqual(readAs("The unicorn attacks once with its hooves and once with its horn.", ["Hooves", "Horn"]), { routines: ["Hooves x1 + Horn x1"], count: 2 });
  assert.equal(readAs("The band attacks twice.", ["Slam"]).count, 2);
  // "makes two attacks with its claws": the noun is left alone.
  assert.deepEqual(readAs("The lamassu makes two attacks with its claws.", ["Claws"]), { routines: ["Claws x2"], count: 2 });
  // Tome of Beasts 3 names the attacks with no noun and often no verb.
  assert.deepEqual(readAs("One Bite and two Kicks or three Spit Worms.", ["Bite", "Kick", "Spit Worm"]), { routines: ["Bite x1 + Kick x2", "Spit Worm x3"], count: 3 });
  assert.deepEqual(readAs("Uses its Frightful Presence then one Bite and two Claws.", ["Bite", "Claw"]), { routines: ["Bite x1 + Claw x2"], count: 3 });
  assert.deepEqual(readAs("Horrific Gaze. Then one Bite and two Tail Slaps.", ["Bite", "Tail Slap"]), { routines: ["Bite x1 + Tail Slap x2"], count: 3 });
  assert.deepEqual(readAs("Three Claws.", ["Claw"]), { routines: ["Claw x3"], count: 3 });
  // A name that already says "attacks" keeps it.
  assert.deepEqual(readAs("The dwarf makes two Heavy Pick attacks.", ["Heavy Pick"]), { routines: ["Heavy Pick x2"], count: 2 });
});

// Why a Multiattack reads as no routine: the first group that names no
// attack of the block, or no group at all.
function unreadGroup(desc, names) {
  const counted = new RegExp(`^(?:${COUNT_WORD}|as many)\\s`, "i");
  for (const sentence of multiattackSentences(desc)) {
    for (const part of multiattackParts(sentence)) {
      for (const clause of part.split(/\bmakes?\s+/i).slice(1)) {
        for (const item of multiattackAlternatives(clause).flatMap(multiattackItems)) {
          if (counted.test(item) && !parseRoutines(`makes ${item}.`, names) && !parseRoutines(`makes ${item} attack.`, names)) {
            return `"${item}" names no attack of the block`;
          }
        }
      }
    }
  }
  return "no group names an attack";
}

// The type a Hit: clause prints for the hit itself, before any saving throw
// it calls for: the type beside the number it opens with ("12 (2d8+3)
// piercing and 3 (1d6) fire damage"), else the first "<type> damage" there,
// and of a choice of types ("bludgeoning, piercing, or slashing damage") the
// first named.
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
function printedHitType(desc) {
  const at = desc.indexOf("Hit:");
  const own = at < 0 ? "" : desc.slice(at + 4).replace(/[_*]/g, "").split(/\b(?:saving throw|must (?:succeed|make))\b/i)[0];
  const types = DAMAGE_TYPES.join("|");
  const opening = new RegExp(`^\\s*\\d+\\s*(?:\\([^)]*\\)\\s*)?(${types})\\b`, "i").exec(own);
  return (opening ?? new RegExp(`\\b(${types})\\b(?:,?\\s+(?:or\\s+)?(?:${types})\\b)*\\s+damage`, "i").exec(own))?.[1]?.toLowerCase() ?? null;
}

await test("A hit's own type comes first, a rider's after it: the Flying Snake bites piercing, then poison (SRD 5.1, Flying Snake).", () => {
  const bite = { name: "Bite", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 1 piercing damage plus 7 (3d4) poison damage.", attack_bonus: 6, damage_bonus: 1 };
  assert.equal(parseAttack(bite)?.type, "piercing/poison");
  assert.equal(parseAttack(SRD["poisonous-snake"].actions[0])?.type.split("/")[0], "piercing");
});

await test("A bonus of +0 printed on the line is an attack's (SRD 5.1 Bat, Cat, Crab, Lizard, Rat); a field of 0 with none printed is no attack.", () => {
  const bite = { name: "Bite", desc: "Melee Weapon Attack: +0 to hit, reach 5 ft., one creature. Hit: 1 piercing damage.", damage_bonus: 1 };
  assert.deepEqual(parseAttack(bite), { name: "Bite", toHit: 0, damage: "1", type: "piercing", mode: "melee", reach: 5 });
  assert.equal(parseAttack({ name: "Reel", desc: "The roper pulls each creature grappled by it up to 25 ft. straight toward it.", attack_bonus: 0 }), null);
});

await test("A hit that lays an effect and no damage is an attack: the SRD condition it names is its rider, the rest is the DM's (SRD 5.1 Giant Spider's Web, Lamia's Intoxicating Touch), and the lamia's Multiattack may use the touch.", () => {
  const web = {
    name: "Web (Recharge 5-6)",
    desc: "Ranged Weapon Attack: +5 to hit, range 30/60 ft., one creature. Hit: The target is restrained by webbing. As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success. The webbing can also be attacked and destroyed (AC 10; hp 5; vulnerability to fire damage; immunity to bludgeoning, poison, and psychic damage).",
    attack_bonus: 5,
  };
  const read = parseAttack(web);
  assert.equal(read?.damage, "0");
  assert.equal(read?.onHit?.condition, "restrained");
  assert.deepEqual(read?.onHit?.manual?.[0], "As an action, the restrained target can make a DC 12 Strength check, bursting the webbing on a success.");
  const touch = {
    name: "Intoxicating Touch",
    desc: "Melee Spell Attack: +5 to hit, reach 5 ft., one creature. Hit: The target is magically cursed for 1 hour. Until the curse ends, the target has disadvantage on Wisdom saving throws and all ability checks.",
  };
  const cursed = parseAttack(touch);
  assert.equal(cursed?.damage, "0");
  assert.equal(cursed?.onHit?.condition, undefined);
  assert.deepEqual(cursed?.onHit?.manual, ["The target is magically cursed for 1 hour.", "Until the curse ends, the target has disadvantage on Wisdom saving throws and all ability checks."]);
});

await test("A choice of damage types is its first named; a type left to a trait is untyped, never a rider's; a misprinted average rolls its dice; a rider that holds only sometimes is the DM's, not the hit's.", () => {
  const staff = parseAttack({ name: "Thorned Staff", desc: "Melee Weapon Attack: +7 to hit, reach 5 ft., one target. Hit: 10 (2d6+3) piercing damage plus 18 (4d8) cold, fire, lightning, poison, or thunder damage (the archdruid's choice)." });
  assert.equal(staff?.damage, "2d6+3+4d8");
  assert.equal(staff?.type, "piercing/cold");
  const slam = parseAttack({ name: "Slam", desc: "Melee Weapon Attack: +9 to hit, reach 5 ft., one target. Hit: 21 (3d10+5) bludgeoning, piercing, or slashing damage, as determined by its maker." });
  assert.equal(slam?.type, "bludgeoning");
  const dagger = parseAttack({ name: "Alchemical Dagger", desc: "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 5 (1d4 + 3) piercing damage plus 3 (1d6) damage of the type determined by Apothecary." });
  assert.deepEqual([dagger?.damage, dagger?.type], ["1d4+3+1d6", "piercing/untyped"]);
  const bolt = parseAttack({ name: "Horseman's Bolt", desc: "Ranged Spell Attack: +8 to hit, range 120 ft., one target. Hit: 22 (4d6 + 4) damage of the type defined in Enchanted Weapons." });
  assert.deepEqual([bolt?.damage, bolt?.type], ["4d6+4", "untyped"]);
  const bite = parseAttack({ name: "Bite", desc: "Melee Weapon Attack: +10 to hit, reach 5 ft., one target. Hit: 28 (4d8+5) piercing damage." });
  assert.equal(bite?.damage, "4d8+5");
  const swarm = parseAttack({ name: "Bites", desc: "Melee Weapon Attack: +10 to hit, reach 0 ft., one creature in the swarm's space. Hit: 21 (6d6) piercing damage plus 7 (2d6) poison damage if Ia'Affrat has half of its hit points or fewer." });
  assert.equal(swarm?.damage, "6d6");
  assert.deepEqual(swarm?.onHit?.manual, ["7 (2d6) poison damage if Ia'Affrat has half of its hit points or fewer"]);
});

await test("Tome of Beasts 3's lines, which print no Hit: label, read their bonus, reach or range, damage, riders and save.", () => {
  const axe = parseAttack({ name: "Iron Axe", desc: "Melee Weapon Attack: +8 to hit, 10 ft., one target, 18 (3d8+5) slashing damage." });
  assert.deepEqual(axe, { name: "Iron Axe", toHit: 8, damage: "3d8+5", type: "slashing", mode: "melee", reach: 10 });
  // Read as a pack row is: its shortened save spelled out first.
  const row = correctedMonsterData({ document__slug: "tob3", slug: "test", actions: [{ name: "Bite", desc: "Melee Weapon Attack: +5 to hit, 10 ft., one creature,. 7 (1d8+3) piercing damage + 7 (2d6) poison and the target must make DC 13 Con save or be poisoned for 1 min. The target can re-save at end of each of its turns, success ends effect on itself." }] });
  const bite = parseAttack(row.actions[0]);
  assert.deepEqual([bite?.damage, bite?.type, bite?.onHit?.save, bite?.onHit?.dc, bite?.onHit?.condition, bite?.onHit?.rounds], ["1d8+3+2d6", "piercing/poison", "con", 13, "poisoned", 10]);
  const claws = parseAttack({ name: "Anointed Claws", desc: "Melee Weapon Attack: +10 to hit, 5 ft., one target, 11 (2d6+4) slashing damage and 22 (5d8) radiant." });
  assert.deepEqual([claws?.damage, claws?.type], ["2d6+4+5d8", "slashing/radiant"]);
  const stone = parseAttack({ name: "Skipping Stone", desc: "Ranged Weapon Attack: +9 to hit 20/60' one target 15 (2d8+6) bludgeoning damage." });
  assert.deepEqual([stone?.mode, stone?.range], ["ranged", { normal: 20, long: 60 }]);
  const flame = parseAttack({ name: "Hurl Flame", desc: "Ranged Spell Attack: +5 to hit, 60 ft., one target, 10 (2d6+3) fire." });
  assert.deepEqual([flame?.damage, flame?.type, flame?.range], ["2d6+3", "fire", { normal: 60, long: 60 }]);
  const whip = parseAttack({ name: "Tendril Whip", desc: "Melee Weapon Attack: +9 to hit, 20 ft., one creature,. Target grappled (escape DC 16)." });
  assert.deepEqual([whip?.damage, whip?.reach, whip?.onHit?.condition, whip?.onHit?.escapeDc], ["0", 20, "grappled", 16]);
});

await test("A pack row's misprinted attack line is read as corrected (pack-corrections.ts), not by a reading of the misprint.", () => {
  const claw = { name: "Claw", desc: "Melee Weapon Attack: +16 to hit, reach 10 ft., one target. it: 16 (2d6 + 9) slashing damage." };
  const corrected = correctedMonsterData({ document__slug: "tob-2023", slug: "ancientwinddragon-tob1-2023", actions: [claw] });
  assert.equal(corrected.actions[0].desc, "Melee Weapon Attack: +16 to hit, reach 10 ft., one target. Hit: 16 (2d6 + 9) slashing damage.");
  const rug = correctedMonsterData({
    document__slug: "tob2",
    slug: "animated-bearskin-rug",
    actions: [{ name: "Envelop", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one Medium or smaller creature. Hit: The creature is grappled (escaped DC 14). Until this grapple ends, the target is restrained, and the rug can't envelop another target." }],
  });
  assert.equal(parseAttack(rug.actions[0])?.onHit?.escapeDc, 14);
});

await test("A document's shortened save and duration is read spelled out, by attacks and abilities alike.", () => {
  const hag = parseMonster(
    {
      document__slug: "blackflag",
      slug: "test",
      actions: [{ name: "Poison Spray", desc: "_Ranged Spell Attack:_ +8 to hit, range 60 ft., one target. _Hit:_ 22 (4d8+4) poison damage, and the target must succeed on a DC 16 STR save or be restrained until the end of its next turn." }],
      special_abilities: [{ name: "Stench", desc: "Each creature within 10 feet of it must succeed on a DC 13 Con. save or be poisoned for 1 hr." }],
    },
    5,
  );
  assert.deepEqual(hag.attacks[0].onHit, { save: "str", dc: 16, condition: "restrained", rounds: 1 });
  assert.deepEqual([hag.specials?.[0]?.save, hag.specials?.[0]?.dc, hag.specials?.[0]?.condition, hag.specials?.[0]?.rounds], ["con", 13, "poisoned", 600]);
  assert.equal(correctedMonsterData({ document__slug: "tob3", slug: "test", reactions: [{ name: "Shriek", desc: "DC 12 Wis save or be frightened for 2 mins." }] }).reactions[0].desc, "DC 12 Wisdom saving throw or be frightened for 2 minutes.");
  // An action's name is looked up among the corrections as their own key only.
  assert.equal(correctedMonsterData({ document__slug: "tob3", slug: "test", actions: [{ name: "constructor", desc: "DC 12 Wis save." }] }).actions[0].desc, "DC 12 Wisdom saving throw.");
});

if (world.hasPack) {
await test("Every attack line in the pack that prints its bonus is read, and a hit that prints dice deals them.", () => {
  const rows = getContentDb().prepare("SELECT slug, document_slug, data_json FROM monsters ORDER BY document_slug, slug").all();
  const unread = [];
  const lost = [];
  let read = 0;
  for (const row of rows) {
    const data = correctedMonsterData(JSON.parse(row.data_json));
    for (const action of ["actions", "bonus_actions", "reactions", "legendary_actions"].flatMap((key) => (Array.isArray(data[key]) ? data[key] : []))) {
      const desc = String(action?.desc ?? "").replace(/[_*]/g, "");
      if (!/[+-]\s?\d{1,2} to hit/i.test(desc)) {
        continue;
      }
      const attack = parseAttack(action);
      const id = `${row.document_slug}/${row.slug} ${action.name}`;
      if (!attack) {
        unread.push(id);
        continue;
      }
      read += 1;
      // A hit opening with its dice ("Hit: 7 (1d8 + 3)", or Tome of Beasts
      // 3's "one target, 18 (3d8+5)") deals more than nothing.
      if (attack.damage === "0" && /(?:hit:|one (?:target|creature),?)\s*\d{1,3}\s*\(\s*\d{1,3}d\d/i.test(desc)) {
        lost.push(id);
      }
    }
  }
  assert.ok(read > 5500, `${read} attack lines read`);
  assert.deepEqual(unread, []);
  assert.deepEqual(lost, []);
});

await test("Every Multiattack in the pack plans the swings its text counts; each it cannot read is pinned with its reason.", () => {
  const rows = getContentDb().prepare("SELECT slug, document_slug, data_json, cr FROM monsters ORDER BY document_slug, slug").all();
  const unread = {};
  const short = [];
  for (const row of rows) {
    const data = JSON.parse(row.data_json);
    const multiattack = (Array.isArray(data.actions) ? data.actions : []).find((action) => /^multiattack/i.test(String(action?.name ?? "")));
    if (!multiattack) {
      continue;
    }
    const id = `${row.document_slug}/${row.slug}`;
    const desc = String(multiattack.desc ?? "");
    const stats = parseMonster(data, Number(row.cr) || 0);
    const count = parseMultiattackCount(desc);
    const swings = plannedSwings(stats, stats.attacks, null).filter((swing) => !swing.onlyIfHit).length;
    const reasons = [
      ...(count === null ? ["no count of two or more attacks"] : []),
      ...(!stats.attacks.length
        ? ["no attack line of the block reads"]
        : stats.routines?.length
          ? []
          : [unreadGroup(desc, stats.attacks.map((attack) => attack.name))]),
    ];
    if (reasons.length) {
      unread[id] = reasons.join("; ");
    }
    if (count !== null && stats.attacks.length && swings !== count) {
      short.push(`${id}: ${swings} swings for a count of ${count}`);
    }
  }
  const file = new URL("./multiattack-unread.json", import.meta.url);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(file, `${JSON.stringify(unread, null, 2)}\n`);
  }
  // The manggus counts as many bites as a hydra's heads, and its routine is
  // its giant form's.
  assert.deepEqual(short, ["tob2/manggus: 2 swings for a count of 5"]);
  assert.deepEqual(unread, JSON.parse(fs.readFileSync(file, "utf8")), "a Multiattack reads differently from multiattack-unread.json");
});

await test("Every attack line in the pack with a Hit: clause is typed first by the type that clause prints for the hit, never by a save's.", () => {
  const rows = getContentDb().prepare("SELECT slug, document_slug, data_json FROM monsters ORDER BY document_slug, slug").all();
  const wrong = [];
  let read = 0;
  for (const row of rows) {
    const data = JSON.parse(row.data_json);
    for (const action of ["actions", "bonus_actions", "reactions"].flatMap((key) => (Array.isArray(data[key]) ? data[key] : []))) {
      const printed = printedHitType(String(action?.desc ?? ""));
      const type = printed ? parseAttack(action)?.type : null;
      // "untyped" is a hit that prints no type of its own ("damage of the
      // type determined by Apothecary"): read as no type, never as another.
      if (!type || type === "untyped") {
        continue;
      }
      read += 1;
      if (type.split("/")[0] !== printed) {
        wrong.push(`${row.document_slug}/${row.slug} ${action.name}: ${type}, the hit prints ${printed}`);
      }
    }
  }
  assert.ok(read > 4000, `${read} attack lines read`);
  assert.deepEqual(wrong, []);
});
}

finish();
