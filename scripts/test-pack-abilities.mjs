// Every monster row in the content pack read the way scripts/test-monster-
// abilities.mjs holds the readers to (issue 473): a save whose failure
// plainly lays a condition carries it, two breaths in one entry share one
// limit, no legendary count is offered as an option, every Spellcasting entry
// gives its spells and every spell is one the pack carries, every limit a name
// prints is read and none stays in a name, and every Regeneration that heals
// at the start of a turn is read. What no reader can take from a row is pinned
// with its reason in pack-abilities-unread.json. CI has no pack: then this
// suite only checks its own pins are well formed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-pack-abilities");
const world = await openWorld();
const pinned = JSON.parse(fs.readFileSync(new URL("./pack-abilities-unread.json", import.meta.url), "utf8"));

await test("Every pinned row carries its reason.", () => {
  for (const [group, entries] of Object.entries(pinned)) {
    for (const [id, reason] of Object.entries(entries)) {
      assert.ok(typeof reason === "string" && reason.trim(), `${group} ${id} needs its reason`);
    }
  }
});

if (world.hasPack) {
  const { getContentDb } = await import("../src/lib/content/db.ts");
  const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
  const { parseAttack } = await import("../src/lib/bestiary/attack-parse.ts");
  const { correctedMonsterData } = await import("../src/lib/bestiary/pack-corrections.ts");
  const { legendaryProfile } = await import("../src/lib/dm/legendary-logic.ts");
  const { SAVE_DC, conditionName } = await import("../src/lib/dm/save-effect.ts");
  const { textKey } = await import("../src/lib/language/text-logic.ts");

  const db = getContentDb();
  const rows = db.prepare("SELECT slug, document_slug, data_json, cr FROM monsters ORDER BY document_slug, slug").all().map((row) => {
    const data = JSON.parse(row.data_json);
    return { id: `${row.document_slug}/${row.slug}`, raw: data, data: correctedMonsterData(data), stats: parseMonster(data, Number(row.cr) || 0) };
  });
  const spellNames = new Set(db.prepare("SELECT name, aliases_csv FROM spells").all().flatMap((row) => [row.name, ...String(row.aliases_csv ?? "").split(",")]).map(textKey).filter(Boolean));
  const entriesOf = (data, sections) => sections.flatMap((section) => (Array.isArray(data[section]) ? data[section] : []).map((entry) => ({ section, name: String(entry?.name ?? ""), desc: String(entry?.desc ?? ""), raw: entry })));
  // The name a reader keys an ability by, without its tags.
  const bare = (name) => textKey(name.replace(/\([^)]*\)?/g, " "));

  const CONDITIONS = "blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|restrained|stunned|unconscious|prone";
  // A save that plainly lays a condition, read here without the reader's own
  // rules: "saving throw or be <condition>", or the next sentence's "On a
  // failure, ... is <condition>".
  const DIRECT = new RegExp(`saving throw or (?:be |become |fall )(?:\\w+ly )?(?:knocked )?(${CONDITIONS})\\b`, "i");
  const NEXT = new RegExp(`^on a fail(?:ure|ed save),? [^.]*?\\b(?:is|are|becomes?|falls?) (?:\\w+ly )?(?:knocked )?(${CONDITIONS})\\b`, "i");

  await test("Every save whose failure plainly lays a condition carries it; each that does not is pinned.", () => {
    const missed = {};
    let checked = 0;
    for (const row of rows) {
      const specials = row.stats.specials ?? [];
      for (const entry of entriesOf(row.data, ["actions", "special_abilities", "legendary_actions"])) {
        if ((entry.section !== "special_abilities" && parseAttack(entry.raw)) || /\((?:cantrip|\d(?:st|nd|rd|th)-level)/i.test(entry.name)) {
          continue;
        }
        const text = entry.desc.replace(/[_*]/g, "").replace(/(\w) {2,}(?=\w)/g, "$1, ");
        const at = text.search(SAVE_DC);
        if (at < 0) {
          continue;
        }
        const [own, next = ""] = text.slice(at).split(/(?<=[.;])\s+/);
        const laid = DIRECT.exec(own) ?? (!/fails? by|DC \d/i.test(next) ? NEXT.exec(next) : null);
        if (!laid) {
          continue;
        }
        checked += 1;
        const wanted = conditionName(laid[1]);
        const mine = specials.filter((ability) => [ability.name, ability.group, ability.partOf].some((name) => name && bare(name) === bare(entry.name)) || text.includes(`${ability.name}.`));
        if (!mine.some((ability) => ability.condition === wanted || (ability.also ?? []).includes(wanted))) {
          missed[`${row.id} ${entry.name}`] = wanted;
        }
      }
    }
    assert.ok(checked > 900, `${checked} saves checked`);
    assert.deepEqual(Object.keys(missed).sort(), Object.keys(pinned.saves).sort());
  });

  await test("Every Breath Weapons entry that prints its breaths gives one ability each, sharing its limit; each that does not is pinned.", () => {
    const unread = [];
    let read = 0;
    for (const row of rows) {
      const header = (row.data.actions ?? []).find((entry) => /^breath weapons?\b/i.test(String(entry?.name ?? "")) && /one of the following/i.test(String(entry?.desc ?? "")));
      if (!header) {
        continue;
      }
      const group = String(header.name).replace(/\s*\(.*$/, "");
      const shared = (row.stats.specials ?? []).filter((ability) => ability.group === group && (ability.recharge || ability.perDay));
      if (shared.length >= 2) {
        read += 1;
      } else {
        unread.push(row.id);
      }
    }
    assert.ok(read > 55, `${read} breath entries read`);
    assert.deepEqual(unread.sort(), Object.keys(pinned.breaths).sort());
  });

  await test("No legendary count is offered as an option, and a block's count is its own (Jotun Giant 1, A5e aboleth 2, zmey by its heads).", () => {
    const offered = [];
    const counts = {};
    for (const row of rows) {
      const profile = legendaryProfile(row.stats);
      offered.push(...(profile?.actions ?? []).filter((action) => /legendary actions?\b/i.test(action.name)).map((action) => `${row.id} ${action.name}`));
      counts[row.id] = profile?.actionsPerRound;
      for (const action of profile?.actions ?? []) {
        assert.ok(action.cost >= 1 && action.cost <= 3, `${row.id} ${action.name}`);
      }
    }
    assert.deepEqual(offered, []);
    assert.deepEqual(
      ["tob/jotun-giant", "menagerie/aboleth-a5e", "menagerie/elder-vampire-a5e", "tob/zmey", "tob/vampire-warlock-variant"].map((id) => counts[id]),
      [1, 2, 1, 3, 3],
    );
    const warlock = legendaryProfile(rows.find((row) => row.id === "tob/vampire-warlock-variant").stats);
    assert.deepEqual(warlock.actions.map((action) => [action.name, action.cost]), [["Misty Step", 1], ["Unarmed Strike", 1], ["Call the Blood", 2]]);
    const vermin = legendaryProfile(rows.find((row) => row.id === "tob-2023/iaaffrat-tob1-2023").stats).actions.find((action) => action.name === "Vermin Breath");
    assert.equal(vermin.cost, 2);
  });

  await test("Every Spellcasting entry gives its spells, from whichever section it is filed in; each that does not is pinned.", () => {
    const unread = [];
    let read = 0;
    for (const row of rows) {
      if (!entriesOf(row.data, ["special_abilities", "actions"]).some((entry) => /spellcasting/i.test(entry.name))) {
        continue;
      }
      if (row.stats.spellcasting?.spells.length) {
        read += 1;
      } else {
        unread.push(row.id);
      }
    }
    assert.ok(read > 550, `${read} blocks with spells`);
    assert.deepEqual(unread.sort(), Object.keys(pinned.spellcasting).sort());
  });

  await test("Every spell a block lists is one the pack carries; each that is not is pinned with what it is.", () => {
    const unknown = new Set();
    for (const row of rows) {
      for (const spell of row.stats.spellcasting?.spells ?? []) {
        if (!spellNames.has(textKey(spell.name))) {
          unknown.add(spell.name);
        }
      }
    }
    assert.deepEqual([...unknown].sort(), Object.keys(pinned.spells).sort());
  });

  await test("Every limit a name prints is read, and no ability keeps it in its name.", () => {
    const unread = [];
    for (const row of rows) {
      const specials = row.stats.specials ?? [];
      for (const ability of specials) {
        assert.ok(!/\((?:recharge|\d+\s*\/|costs?\b|\d\))/i.test(ability.name), `${row.id}: ${ability.name}`);
      }
      for (const entry of entriesOf(row.data, ["actions", "special_abilities", "legendary_actions"])) {
        const tag = /\(([^)]*\b(?:recharges?|\d+\s*\/\s*(?:day|rest|turn|round))\b[^)]*)\)/i.exec(entry.name);
        const ability = tag ? specials.find((candidate) => bare(candidate.name) === bare(entry.name)) : null;
        if (ability && !(ability.recharge || ability.perDay || ability.perRest || ability.rechargeSpecial || ability.oncePer)) {
          unread.push(`${row.id} ${entry.name}`);
        }
      }
    }
    assert.deepEqual(unread, []);
  });

  await test("Every Regeneration that heals at the start of the creature's turn is read.", () => {
    const unread = [];
    let read = 0;
    for (const row of rows) {
      const heals = entriesOf(row.data, ["special_abilities"]).some(
        (entry) => /regeneration/i.test(entry.name) && /\b(?:re)?gains \d+ (?:hit points?|hp)\b(?! for each)/i.test(entry.desc) && /start of|starts its turn/i.test(entry.desc) && !/\bhost\b/i.test(entry.desc),
      );
      if (!heals) {
        continue;
      }
      if (row.stats.regeneration) {
        read += 1;
      } else {
        unread.push(row.id);
      }
    }
    assert.ok(read > 90, `${read} blocks regenerate`);
    assert.deepEqual(unread, []);
  });
}

finish();
