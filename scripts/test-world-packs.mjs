// World packs: schema validity, reskin integrity against the real SRD and
// catalog ids, house style, and substance floors.
//
// This suite SCANS the packs directory, the same way the loader does, so a new
// universe is validated the moment its JSON lands and nobody has to edit a
// test to register it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { worldPackSchema, groupByFranchise, summarizePack } = await import(
  "../src/lib/worlds/types.ts"
);
const { GENRES } = await import("../src/lib/schemas/game-settings.ts");
const { findRace, findClass, SRD_BACKGROUNDS } = await import("../src/lib/srd/index.ts");
const { CUSTOM_BACKGROUNDS } = await import("../src/lib/backgrounds/index.ts");
const { SRD_WEAPONS } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor.ts");

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
// Only the BUNDLED directory is checked here. Installed packs live in the
// gitignored data/worlds and are third-party content this repository neither
// ships nor vets; failing the build on somebody's local install would be
// wrong. The loader validates those at read time and skips bad ones.
const packsDir = path.resolve(scriptsDir, "../src/lib/worlds/bundled");
const contentDbPath = path.resolve(scriptsDir, "../data/content/open5e.sqlite");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const files = fs.existsSync(packsDir)
  ? fs.readdirSync(packsDir).filter((file) => file.endsWith(".json")).sort()
  : [];

// Parse everything up front so every later case can assume valid shapes and
// report against the file that actually broke.
const packs = [];
test("every bundled pack parses and validates against the schema", () => {
  assert.ok(files.length > 0, "no bundled world packs found");
  for (const file of files) {
    const full = path.join(packsDir, file);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (error) {
      assert.fail(`${file} is not valid JSON: ${error.message}`);
    }
    const parsed = worldPackSchema.safeParse(raw);
    assert.ok(
      parsed.success,
      `${file} failed validation:\n${parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)}`,
    );
    packs.push({ file, pack: parsed.data });
  }
});

test("each pack id matches its filename and is unique", () => {
  const seenIds = new Set();
  const seenNames = new Set();
  for (const { file, pack } of packs) {
    assert.equal(pack.id, path.basename(file, ".json"), `${file}: id does not match the filename`);
    assert.ok(!seenIds.has(pack.id), `${file}: duplicate pack id ${pack.id}`);
    assert.ok(!seenNames.has(pack.name), `${file}: duplicate pack name ${pack.name}`);
    seenIds.add(pack.id);
    seenNames.add(pack.name);
  }
});

test("a bundled pack is an original work with no third-party rights holder", () => {
  for (const { file, pack } of packs) {
    // Anything shipped in this repository is covered by its MIT license, so
    // it cannot be built on somebody else's setting. Packs that are go in
    // data/worlds via the plugin browser, not here.
    assert.equal(
      pack.rightsHolder,
      "",
      `${file}: a bundled pack must not name a rights holder; ship it as a downloadable plugin instead`,
    );
  }
});

test("baseGenre is a real genre and never custom", () => {
  for (const { file, pack } of packs) {
    assert.ok(GENRES.includes(pack.baseGenre), `${file}: unknown baseGenre ${pack.baseGenre}`);
    // A pack IS the custom description, so falling back to the empty custom
    // preset would throw away the flavor every other genre supplies.
    assert.notEqual(pack.baseGenre, "custom", `${file}: baseGenre must not be custom`);
  }
});

test("a franchise with several editions labels every one of them", () => {
  for (const group of groupByFranchise(packs.map(({ pack }) => summarizePack(pack)))) {
    if (group.editions.length === 1) {
      continue;
    }
    for (const edition of group.editions) {
      assert.ok(
        edition.edition.trim().length > 0,
        `${edition.id}: ${group.franchise} has ${group.editions.length} entries, so each needs an edition label`,
      );
    }
    const labels = group.editions.map((entry) => entry.edition);
    assert.equal(
      new Set(labels).size,
      labels.length,
      `${group.franchise}: duplicate edition labels ${labels.join(", ")}`,
    );
  }
});

test("campaign seeds fit the columns they fill", () => {
  for (const { file, pack } of packs) {
    // campaigns.theme is a 120-char input in the create dialog and
    // campaigns.description is capped at 500 by createCampaignSchema.
    assert.ok(pack.theme.length <= 120, `${file}: theme is longer than 120 chars`);
    assert.ok(pack.premise.length <= 500, `${file}: premise is longer than 500 chars`);
  }
});

test("every reskinned race, class and background id resolves", () => {
  const backgroundIds = new Set([
    ...SRD_BACKGROUNDS.map((entry) => entry.id),
    ...CUSTOM_BACKGROUNDS.map((entry) => entry.id),
  ]);
  for (const { file, pack } of packs) {
    for (const entry of pack.races) {
      assert.ok(findRace(entry.id), `${file}: race id ${entry.id} does not exist`);
    }
    for (const entry of pack.classes) {
      assert.ok(findClass(entry.id), `${file}: class id ${entry.id} does not exist`);
    }
    for (const entry of pack.backgrounds) {
      assert.ok(backgroundIds.has(entry.id), `${file}: background id ${entry.id} does not exist`);
    }
    for (const raceId of pack.companionRaces) {
      assert.ok(findRace(raceId), `${file}: companionRaces entry ${raceId} does not exist`);
    }
  }
});

test("only real casters carry a casting label", () => {
  for (const { file, pack } of packs) {
    for (const entry of pack.classes) {
      const klass = findClass(entry.id);
      if (klass && klass.spellAbility === null) {
        assert.equal(
          entry.castingLabel,
          null,
          `${file}: ${entry.id} is not a caster but sets castingLabel ${entry.castingLabel}`,
        );
      }
    }
  }
});

test("no reskin is a no-op, and names are unique within their list", () => {
  for (const { file, pack } of packs) {
    for (const key of ["races", "classes", "backgrounds"]) {
      const names = new Set();
      const ids = new Set();
      for (const entry of pack[key]) {
        assert.notEqual(
          entry.name.toLowerCase(),
          entry.id.toLowerCase(),
          `${file}: ${key} entry ${entry.id} renames itself to its own id`,
        );
        assert.ok(!names.has(entry.name.toLowerCase()), `${file}: duplicate ${key} name ${entry.name}`);
        // A repeated id is silent data loss: applyIdReskins builds a Map keyed
        // by id, so the last entry wins and the earlier reskin never renders.
        assert.ok(!ids.has(entry.id), `${file}: duplicate ${key} id ${entry.id}, so one reskin is dead`);
        names.add(entry.name.toLowerCase());
        ids.add(entry.id);
      }
    }
    for (const key of ["spells", "items", "features"]) {
      const names = new Set();
      for (const entry of pack[key]) {
        assert.notEqual(
          entry.name.toLowerCase(),
          entry.from.toLowerCase(),
          `${file}: ${key} entry "${entry.from}" renames itself to the same name`,
        );
        assert.ok(!names.has(entry.name.toLowerCase()), `${file}: duplicate ${key} name ${entry.name}`);
        names.add(entry.name.toLowerCase());
      }
      const sources = pack[key].map((entry) => entry.from.toLowerCase());
      assert.equal(
        new Set(sources).size,
        sources.length,
        `${file}: two ${key} reskins map the same canonical name`,
      );
    }
    const slugs = pack.monsters.map((entry) => entry.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${file}: duplicate monster slugs`);
  }
});

// Walks every string in the parsed pack, so a field added later is covered
// without anyone remembering to extend this case.
function everyString(value, visit, trail = "") {
  if (typeof value === "string") {
    visit(value, trail);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => everyString(entry, visit, `${trail}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      everyString(entry, visit, trail ? `${trail}.${key}` : key);
    }
  }
}

test("no em dashes anywhere in a pack", () => {
  for (const { file, pack } of packs) {
    everyString(pack, (value, trail) => {
      assert.ok(!value.includes("—"), `${file}: em dash in ${trail}`);
    });
  }
});

test("every pack carries enough content to be worth selecting", () => {
  const floors = {
    races: 6,
    classes: 6,
    backgrounds: 4,
    monsters: 15,
    spells: 10,
    items: 6,
    factions: 3,
    locations: 4,
    hooks: 4,
    glossary: 6,
  };
  for (const { file, pack } of packs) {
    for (const [key, floor] of Object.entries(floors)) {
      assert.ok(
        pack[key].length >= floor,
        `${file}: only ${pack[key].length} ${key}, needs at least ${floor}`,
      );
    }
    assert.ok(pack.nameSeeds.people.length >= 6, `${file}: needs at least 6 people name seeds`);
    assert.ok(pack.nameSeeds.places.length >= 6, `${file}: needs at least 6 place name seeds`);
    assert.ok(pack.dmFlavor.length >= 200, `${file}: dmFlavor is too thin to steer the DM`);
  }
});

test("alignment nudges use the codes the builder lists", () => {
  const codes = new Set(["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"]);
  for (const { file, pack } of packs) {
    for (const code of pack.alignments) {
      assert.ok(codes.has(code), `${file}: unknown alignment code ${code}`);
    }
    assert.equal(new Set(pack.alignments).size, pack.alignments.length, `${file}: duplicate alignments`);
  }
});

// Content-pack integrity. Skipped on a fresh clone, exactly as test-bestiary
// does, so the suite still passes before anyone runs the Open5e importer.
if (fs.existsSync(contentDbPath)) {
  const { default: Database } = await import("better-sqlite3-multiple-ciphers");
  const db = new Database(contentDbPath, { readonly: true });
  const crBySlug = new Map(
    db.prepare("SELECT slug, cr FROM monsters").all().map((row) => [row.slug, row.cr]),
  );
  const spellNames = new Set(
    db.prepare("SELECT name FROM spells").all().map((row) => row.name.toLowerCase()),
  );
  const itemNames = new Set(
    db.prepare("SELECT name FROM items").all().map((row) => row.name.toLowerCase()),
  );
  db.close();
  for (const weapon of SRD_WEAPONS) {
    itemNames.add(weapon.name.toLowerCase());
  }
  for (const armor of SRD_ARMOR) {
    itemNames.add(armor.name.toLowerCase());
  }

  test("every monster slug exists in the content pack with a matching CR", () => {
    for (const { file, pack } of packs) {
      for (const entry of pack.monsters) {
        assert.ok(crBySlug.has(entry.slug), `${file}: ${entry.slug} is not in the content pack`);
        assert.equal(
          crBySlug.get(entry.slug),
          entry.cr,
          `${file}: ${entry.slug} cr drifted from the content pack`,
        );
      }
    }
  });

  test("every reskinned spell and item names something real", () => {
    for (const { file, pack } of packs) {
      for (const entry of pack.spells) {
        assert.ok(
          spellNames.has(entry.from.toLowerCase()),
          `${file}: spell "${entry.from}" is not a real spell name`,
        );
      }
      for (const entry of pack.items) {
        assert.ok(
          itemNames.has(entry.from.toLowerCase()),
          `${file}: item "${entry.from}" is not a real weapon, armor or item name`,
        );
      }
    }
  });
} else {
  console.log("note: content pack absent; skipping monster, spell and item integrity checks");
}

console.log(`test-world-packs: ${passed} passed`);
