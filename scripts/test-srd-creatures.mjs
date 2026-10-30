// The SRD creature table (src/lib/srd/srd-creatures.json, written by
// scripts/generate-srd-creatures.mjs) held to its sources: every block to
// the SRD 5.1 text the repository carries (src/lib/rulebook/srd-5.1.json),
// which needs no content pack, and, where the pack is present, to the
// pack's own rows and to a fresh run of the generator. Then the lists the
// spells draw from: every creature each one may call is in the table.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire, register } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

register("./lib/register-alias.mjs", import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { attacksPerTurn, packSpeeds, parseAttack, parseRulebookPage, parseSenses, plain } = await import("./lib/srd-creature-text.mjs");
const { CHAIN_FORMS, CORRECTIONS, FAMILIARS, PACK_KEEPS, RULEBOOK_PAGE, sidebarEntry } = await import("./lib/srd-creature-overlay.mjs");
const { SRD_CREATURES } = await import("../src/lib/srd/srd-creatures.ts");
const { SUMMON_FORMS, findSummonForm } = await import("../src/lib/srd/summon-forms.ts");
const { SUMMON_SPELLS, summonPlan } = await import("../src/lib/srd/summon-spells.ts");
const { FAMILIAR_FORMS, findFamiliarForm } = await import("../src/lib/srd/familiar-forms.ts");
const { isValidExpression } = await import("../src/lib/dice.ts");
const { correctedMonsterData } = await import("../src/lib/bestiary/pack-corrections.ts");
const { summonAttackSchema } = await import("../src/lib/schemas/summon.ts");
const names = JSON.parse(readFileSync(join(root, "src/lib/srd/srd-creature-names.json"), "utf8"));
const book = JSON.parse(readFileSync(join(root, "src/lib/rulebook/srd-5.1.json"), "utf8"));
const pages = new Map(book.pages.filter((page) => page.kind === "monster").map((page) => [page.title, page]));
const packPath = process.env.CONTENT_DB_PATH || join(root, "data", "content", "open5e.sqlite");
const hasPack = existsSync(packPath);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const LIMITED = /\((?:recharge|\d+\/day)/i;
// "Multiattack (Vampire Form Only)" is the vampire's Multiattack.
const MULTIATTACK = /^Multiattack\b/i;
// The numbers an attack's two readings share; its manual notes are left
// out, as a rulebook page runs on into the creature's lore.
const numbers = (attack) => {
  const { onHit, ...rest } = attack;
  const rule = { ...onHit };
  delete rule.manual;
  return JSON.stringify({ ...rest, name: rest.name.replace(/\s*\(Bite in Beast Form\)$/i, ""), ...(Object.keys(rule).length ? { onHit: rule } : {}) });
};
const pageOf = (name) => {
  const where = RULEBOOK_PAGE[name] ?? { title: name };
  const page = pages.get(where.title);
  return page ? parseRulebookPage(page.md, where) : null;
};

test("every block is a whole stat block the engines can roll", () => {
  const seen = new Set();
  for (const creature of SRD_CREATURES) {
    assert.ok(!seen.has(creature.name), `duplicate ${creature.name}`);
    seen.add(creature.name);
    assert.ok(creature.hp >= 1 && creature.ac >= 5 && creature.cr >= 0, creature.name);
    assert.ok(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"].includes(creature.size), creature.name);
    // A summon or a form keeps at most four attacks, a pet (a familiar, or a
    // companion beast of CR 1/4 or lower) three, in the schemas every stored
    // sheet is read back through.
    const pet = FAMILIAR_FORMS.some((form) => form.form === creature.name) || (creature.type === "beast" && creature.cr <= 0.25);
    assert.ok(creature.attacks.length <= (pet ? 3 : 4), `${creature.name} has ${creature.attacks.length} attacks`);
    for (const attack of creature.attacks) {
      const stored = summonAttackSchema.safeParse(attack);
      assert.ok(stored.success, `${creature.name} ${attack.name}: ${stored.error?.message}`);
      assert.ok(isValidExpression(attack.damage), `${creature.name} ${attack.name}`);
      // A hit that only lays its effect (a roper's tendril grapples, a
      // guardian naga's spit forces the save) deals no damage of its own.
      assert.ok(attack.type || (attack.damage === "0" && attack.onHit), `${creature.name} ${attack.name} has no damage type`);
      for (const rider of attack.riders ?? []) {
        assert.ok(isValidExpression(rider.dice), `${creature.name} ${attack.name} rider`);
      }
      if (attack.onHit?.damage) {
        assert.ok(isValidExpression(attack.onHit.damage) && attack.onHit.damageType, `${creature.name} ${attack.name} on a hit`);
      }
      if (attack.onHit?.save) {
        assert.ok(attack.onHit.dc && (attack.onHit.damage || attack.onHit.condition || attack.onHit.drainMaxHp), `${creature.name} ${attack.name}: a save that costs nothing`);
      }
    }
    for (const routine of creature.routines ?? []) {
      assert.ok(routine.every((step) => creature.attacks.some((attack) => attack.name === step.attack)), `${creature.name} routine`);
    }
  }
  // The browser's names are the table's.
  assert.deepEqual([...names.beasts, ...names.others].sort(), SRD_CREATURES.map((creature) => creature.name).sort());
});

test("every block holds the numbers the SRD 5.1 prints, with no content pack", () => {
  const problems = [];
  for (const creature of SRD_CREATURES) {
    const page = pageOf(creature.name);
    if (!page) {
      problems.push(`${creature.name}: no SRD 5.1 page`);
      continue;
    }
    const ours = {
      size: creature.size, type: creature.type, cr: creature.cr, ac: creature.ac, hp: creature.hp,
      speeds: creature.speeds, abilities: creature.abilities, saves: creature.saves ?? [], senses: creature.senses ?? {},
      defenses: ["resist", "immune", "vulnerable", "conditionImmune"].map((field) => (creature[field] ?? "").toLowerCase()),
      attacks: creature.attacks.map(numbers).sort(),
      attacksPerTurn: creature.attacksPerTurn ?? 1,
    };
    const multiattack = page.actions.find((action) => MULTIATTACK.test(action.name));
    const pageAttacks = page.actions
      .filter((action) => !sidebarEntry(action.name) && !MULTIATTACK.test(action.name) && !LIMITED.test(action.name))
      .map((action) => parseAttack(action.name, action.desc))
      .filter(Boolean);
    const theirs = {
      size: page.size, type: page.type, cr: page.cr, ac: page.ac, hp: page.hp,
      speeds: page.speeds, abilities: page.abilities, saves: page.saves, senses: page.senses,
      defenses: ["resist", "immune", "vulnerable", "conditionImmune"].map((field) => page[field].toLowerCase()),
      attacks: pageAttacks.map(numbers).sort(),
      attacksPerTurn: multiattack ? attacksPerTurn(multiattack.desc, pageAttacks.map((attack) => attack.name.replace(/\s*\(Bite in Beast Form\)$/i, ""))) : 1,
    };
    // A field the overlay leaves to the pack row, where the SRD text in the
    // repository slipped (srd-creature-overlay.mjs PACK_KEEPS).
    const kept = PACK_KEEPS[creature.name] ?? {};
    for (const field of Object.keys(ours).filter((key) => !kept[key])) {
      if (JSON.stringify(ours[field]) !== JSON.stringify(theirs[field])) {
        problems.push(`${creature.name} ${field}: table ${JSON.stringify(ours[field])}, SRD ${JSON.stringify(theirs[field])}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the table holds every creature the SRD 5.1 lets these spells call or become", () => {
  // Read off the rulebook's pages, not the pack: every creature but the
  // swarms, as True Polymorph and Shapechange may give any of them, under
  // the page the overlay checks it against (the drow is "Elf, Drow").
  const titles = new Set(SRD_CREATURES.map((creature) => (RULEBOOK_PAGE[creature.name] ?? { title: creature.name }).title));
  const missing = [...pages.values()]
    .filter((page) => parseRulebookPage(page.md).type && !/^swarm\b/i.test(page.title))
    .map((page) => page.title)
    .filter((title) => !titles.has(title));
  assert.deepEqual(missing, []);
  assert.equal(SRD_CREATURES.filter((creature) => creature.type === "beast").length, 87);
  assert.ok(SRD_CREATURES.length >= 300, `${SRD_CREATURES.length} creatures`);
  // No creature of another book: Mud and Smoke Mephits are not in SRD 5.1.
  for (const name of ["Mud Mephit", "Smoke Mephit"]) {
    assert.equal(findSummonForm(name), null, name);
  }
});

test("each conjuring spell calls every creature of its kind its slot reaches, and nothing past it", () => {
  for (const spell of SUMMON_SPELLS.filter((entry) => entry.types)) {
    const ceiling = spell.byCr ? spell.byCr[0][0] : (spell.maxCrBySlot?.at(-1)?.[1] ?? spell.maxCr + (spell.crPerSlot ?? 0) * (9 - spell.level));
    for (const creature of SRD_CREATURES.filter((entry) => spell.types.includes(entry.type))) {
      const plan = summonPlan(spell, 9, creature.name);
      assert.equal("error" in plan, creature.cr > ceiling, `${spell.name}: ${creature.name} (CR ${creature.cr})`);
    }
  }
  for (const spell of SUMMON_SPELLS.filter((entry) => entry.forms)) {
    for (const form of spell.forms) {
      assert.ok(SUMMON_FORMS.some((entry) => entry.name === form), `${spell.name}: ${form}`);
    }
  }
});

test("Find Familiar's forms are the spell's list, and Pact of the Chain's four", () => {
  const spell = book.pages.find((page) => page.kind === "spell" && page.title === "Find Familiar");
  const listed = /animal form you choose: ([^.]+)\./.exec(plain(spell.md))[1]
    .replace(/\bor\b/, "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of listed) {
    // "frog (toad)", "fish (quipper)": either word finds the block.
    const [first, second] = entry.replace(")", "").split(" (");
    const form = findFamiliarForm(first);
    assert.ok(form, `${entry} is no familiar form`);
    if (second) {
      assert.equal(findFamiliarForm(second)?.form, form.form, entry);
    }
  }
  assert.equal(FAMILIARS.length, listed.length);
  assert.deepEqual(FAMILIAR_FORMS.filter((form) => form.chainOnly).map((form) => form.form), CHAIN_FORMS);
  // A familiar cannot attack; Pact of the Chain's forms fight with their blocks.
  assert.ok(FAMILIAR_FORMS.filter((form) => !form.chainOnly).every((form) => form.attacks.length === 0));
  assert.ok(FAMILIAR_FORMS.filter((form) => form.chainOnly).every((form) => form.attacks.length > 0));
  // The pet record keeps notes of at most 300 characters, the familiar's own
  // rules after the form's.
  assert.ok(FAMILIAR_FORMS.every((form) => form.notes.length <= 160), "a familiar's notes run long");
});

test("with the content pack: the committed table is what the generator writes, and each block is the pack's row but where the SRD text corrects it", () => {
  if (!hasPack) {
    return;
  }
  const run = spawnSync(process.execPath, [join(root, "scripts/generate-srd-creatures.mjs"), "--check"], { encoding: "utf8", env: { ...process.env, CONTENT_DB_PATH: packPath } });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
  const Database = createRequire(import.meta.url)("better-sqlite3-multiple-ciphers");
  const db = new Database(packPath, { readonly: true, fileMustExist: true });
  const rows = new Map(db.prepare("SELECT name, cr, data_json FROM monsters WHERE document_slug = 'wotc-srd'").all().map((row) => [row.name, row]));
  db.close();
  for (const creature of SRD_CREATURES) {
    const row = rows.get(creature.name);
    assert.ok(row, `${creature.name}: no pack row`);
    // The row as both readers take it, with src/lib/bestiary/pack-corrections.ts
    // laid over it; the overlay's own corrections are names.
    const data = correctedMonsterData(JSON.parse(row.data_json));
    const fix = CORRECTIONS[creature.name] ?? {};
    assert.deepEqual(
      [creature.ac, creature.hp, creature.cr, creature.speeds, creature.senses ?? {}, creature.abilities],
      [
        fix.ac ?? data.armor_class,
        fix.hp ?? data.hit_points,
        fix.cr ?? data.cr ?? row.cr,
        fix.speeds ?? packSpeeds(data.speed),
        fix.senses ?? parseSenses(data.senses),
        { str: data.strength, dex: data.dexterity, con: data.constitution, int: data.intelligence, wis: data.wisdom, cha: data.charisma },
      ],
      creature.name,
    );
    const theirs = (data.actions ?? [])
      .filter((action) => !sidebarEntry(action.name) && !MULTIATTACK.test(action.name) && !LIMITED.test(action.name))
      .map((action) => parseAttack(fix.attackNames?.[action.name] ?? action.name, action.desc))
      .filter(Boolean)
      .map((attack) => ({ ...attack, ...(fix.attackFields?.[attack.name] ?? {}) }));
    assert.deepEqual(creature.attacks.map(numbers).sort(), theirs.map(numbers).sort(), `${creature.name} attacks`);
  }
});

console.log(`test-srd-creatures: ${passed} passed${hasPack ? "" : " (no content pack: the pack comparison skipped)"}`);
