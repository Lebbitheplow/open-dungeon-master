// An enemy swings what its Multiattack prints, and its hit lands the type
// the Hit: clause prints (SRD 5.1, Monsters: Multiattack; the Xorn's "three
// claw attacks and one bite attack", the Poisonous Snake's "1 piercing
// damage, and ... taking 5 (2d4) poison damage on a failed save"). The
// blocks come from the pack when it is there and from the SRD text written
// out below when it is not, the way upstream CI runs. With the pack, every
// Multiattack in it is read: the swings planned without an asked attack
// equal the count the text names, and each text no routine or count can be
// read from is pinned with its reason in multiattack-unread.json
// (`node scripts/test-multiattack.mjs --write` rewrites it).
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
  await import("../src/lib/bestiary/attack-text.ts");
const { plannedSwings } = await import("../src/lib/dm/enemy-profile.ts");
const { parseAttack } = await import("../src/lib/bestiary/attack-parse.ts");

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
  assert.deepEqual(readAs("The dragon uses Grasp of Shadows then attacks once with its bite and twice with its claws.", ["Bite", "Claw"]), { routines: null, count: null });
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
// it calls for: the first "<type> damage" there.
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
function printedHitType(desc) {
  const at = desc.indexOf("Hit:");
  const own = at < 0 ? "" : desc.slice(at + 4).split(/\b(?:saving throw|must (?:succeed|make))\b/i)[0];
  return new RegExp(`\\b(${DAMAGE_TYPES.join("|")})\\s+damage`, "i").exec(own)?.[1]?.toLowerCase() ?? null;
}

await test("A hit's own type comes first, a rider's after it: the Flying Snake bites piercing, then poison (SRD 5.1, Flying Snake).", () => {
  const bite = { name: "Bite", desc: "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 1 piercing damage plus 7 (3d4) poison damage.", attack_bonus: 6, damage_bonus: 1 };
  assert.equal(parseAttack(bite)?.type, "piercing/poison");
  assert.equal(parseAttack(SRD["poisonous-snake"].actions[0])?.type.split("/")[0], "piercing");
});

if (world.hasPack) {
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
      // "untyped" is a hit that prints a choice of types ("bludgeoning,
      // piercing, or slashing") or none of its own: read as no type, never
      // as another.
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
