// Writes the facts of each spell into the checklist
// (src/lib/srd/manifest/spells.json), so the engine knows them on a server
// with no content pack: whether a spell is a ritual, whether it takes
// concentration, its casting time, its component letters, the price of a
// costly material, and its range. Facts only, never rules text.
//
// It also sets each SRD spell's class list to the class's own list. The
// pack's list (Open5e's spell_lists) leaves the paladin off nearly every
// spell and folds a subclass's granted spells into its parent class. The
// row's own `dnd_class` text names every class, the paladin included, and its
// `archetype` text names the classes that reach the spell through a subclass
// only. The class list is the first with the second taken away.
//
// And it bakes what the engine reads out of each SRD spell's text into
// src/lib/srd/manifest/spell-mech.json (server side only; the client bundle
// imports the checklist, not this): the parsed mechanics (save, half on a
// save, damage type, condition, attack kind, area) and the dice the spell
// rolls at each slot level, or at each cantrip tier. With no content pack
// the engine reads these, so a server without the pack resolves Fireball
// as 8d6, a DEX save, half on a success, as a server with it does. The
// answers, never the rules text.
//
//   node scripts/annotate-spell-manifest.mjs          rewrite the checklist
//   node scripts/annotate-spell-manifest.mjs --check  exit 1 when it is stale
//
// Needs the content pack (data/content/open5e.sqlite). Spells ODM authored
// itself carry their facts in src/lib/srd/authored-spells.json and only have
// their class names checked here.
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "src/lib/srd/manifest/spells.json");
process.env.CONTENT_DB_PATH ||= path.join(root, "data/content/open5e.sqlite");

const { getContentDb } = await import("../src/lib/content/db.ts");
const { castingTimeFrom, componentLettersFrom, materialCostFrom, rangeFrom } = await import(
  "../src/lib/srd/spell-facts.ts"
);
const { parseSpellMech } = await import("../src/lib/srd/spell-mechanics.ts");
const { scaledSpellDice } = await import("../src/lib/srd/spell-scaling.ts");
const { servedSpellRows } = await import("../src/lib/content/spell-overrides.ts");

const CASTERS = ["artificer", "bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"];
// Other books' names for a class ODM has under its SRD name.
const CLASS_NAMES = { herald: "paladin" };
// Spells a class has on its own SRD 5.1 list AND through one of its
// subclasses. The pack's `archetype` text names the subclass route only, so
// taking it away would take the class's own entry with it.
const BASE_LIST_TOO = {
  "dispel magic": ["cleric"],
  "meld into stone": ["druid"],
};

const db = getContentDb();
if (!db) {
  console.error("No content pack at", process.env.CONTENT_DB_PATH);
  process.exit(2);
}

const srd = new Map(
  db
    .prepare("SELECT name, ritual, concentration, aliases_csv, data_json FROM spells WHERE document_slug = 'wotc-srd'")
    .all()
    .flatMap((row) => {
      const entry = { ...row, data: JSON.parse(row.data_json) };
      const names = [row.name, ...String(row.aliases_csv ?? "").split("|")].filter(Boolean);
      return names.map((name) => [name.trim().toLowerCase(), entry]);
    }),
);

const classWords = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

// The classes a subclass brings the spell to: "Cleric: War, Paladin: Ancients".
const viaSubclass = (text) =>
  [...String(text ?? "").toLowerCase().matchAll(/([a-z]+)\s*:/g)].map((match) => match[1]);

function cleanClasses(listed) {
  return [...new Set(listed.map((entry) => CLASS_NAMES[entry] ?? entry))]
    .filter((entry) => CASTERS.includes(entry))
    .sort();
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const FACT_KEYS = ["r", "k", "t", "v", "g", "x", "d"];

manifest.spells = manifest.spells.map((spell) => {
  const next = Object.fromEntries(Object.entries(spell).filter(([key]) => !FACT_KEYS.includes(key)));
  const listed = classWords(spell.c);
  const row = [spell.n, ...(spell.a ?? [])].map((name) => srd.get(name.toLowerCase())).find(Boolean);
  if (!row) {
    next.c = cleanClasses(listed).join(",");
    return next;
  }
  const data = row.data;
  const granted = new Set(viaSubclass(data.archetype));
  const kept = BASE_LIST_TOO[spell.n.toLowerCase()] ?? [];
  const own = classWords(data.dnd_class).filter((entry) => !granted.has(entry) || kept.includes(entry));
  // The artificer is not an SRD class; the checklist's word on it stands.
  next.c = cleanClasses([...own, ...listed.filter((entry) => entry === "artificer")]).join(",");
  if (row.ritual === 1) {
    next.r = true;
  }
  if (row.concentration === 1) {
    next.k = true;
  }
  const time = castingTimeFrom(data.casting_time);
  if (time !== "action") {
    next.t = time;
  }
  const letters = componentLettersFrom(data.components);
  next.v = `${letters.verbal ? "V" : ""}${letters.somatic ? "S" : ""}${letters.material ? "M" : ""}`;
  const cost = materialCostFrom(data.material);
  if (letters.material && cost.costGp) {
    next.g = cost.costGp;
    if (cost.consumed) {
      next.x = true;
    }
  }
  const range = rangeFrom(data.range);
  next.d =
    range.kind === "feet" ? range.feet : range.kind === "self" && range.areaFeet ? `self:${range.areaFeet}` : range.kind;
  return next;
});

// ---- the baked mechanics ----
//
// The SRD rows as the engine serves them (src/lib/content/spell-overrides.ts
// corrects a few), each reduced to the answers the resolvers give.
const mechPath = path.join(root, "src/lib/srd/manifest/spell-mech.json");
const served = servedSpellRows(
  db
    .prepare("SELECT * FROM spells")
    .all()
    .map((row) => ({
      slug: row.slug,
      name: row.name,
      documentSlug: row.document_slug,
      level: row.level,
      school: row.school,
      classes: row.classes_csv ? row.classes_csv.split(",") : [],
      ritual: row.ritual === 1,
      concentration: row.concentration === 1,
      aliases: row.aliases_csv ? row.aliases_csv.split("|") : [],
      data: JSON.parse(row.data_json),
    })),
).filter((row) => row.documentSlug === "wotc-srd");

const CANTRIP_TIERS = [1, 5, 11, 17];
const baked = served
  .map((row) => {
    const desc = String(row.data.desc ?? "");
    const higherLevel = String(row.data.higher_level ?? "");
    const mech = parseSpellMech({ desc, higherLevel, duration: String(row.data.duration ?? "") });
    // The dice by cantrip tier ("c5") or by slot level ("3").
    const dice = {};
    if (row.level === 0) {
      for (const casterLevel of CANTRIP_TIERS) {
        const scaled = scaledSpellDice({ spellLevel: 0, desc, higherLevel, casterLevel });
        if (scaled) {
          dice[`c${casterLevel}`] = scaled.dice;
        }
      }
    } else {
      for (let slot = row.level; slot <= 9; slot += 1) {
        const scaled = scaledSpellDice({ spellLevel: row.level, desc, higherLevel, casterLevel: 20, slotLevel: slot });
        if (scaled) {
          dice[String(slot)] = scaled.dice;
        }
      }
    }
    const entry = { n: row.name };
    if (row.aliases.length) {
      entry.a = row.aliases;
    }
    if (mech) {
      entry.m = mech;
    }
    if (Object.keys(dice).length) {
      entry.x = dice;
    }
    return entry;
  })
  .filter((entry) => entry.m || entry.x)
  .sort((a, b) => a.n.localeCompare(b.n));
const mechWritten = `${JSON.stringify(
  {
    _note:
      "Generated by scripts/annotate-spell-manifest.mjs from the SRD 5.1 rows of the content pack: what the engine's parsers read from each spell (m: mechanics, x: dice by slot level or cantrip tier c1/c5/c11/c17), for a server with no pack. Answers only, no rules text.",
    spells: baked,
  },
  null,
  1,
)}\n`;

const written = `${JSON.stringify(manifest, null, 1)}\n`;
const current = fs.readFileSync(manifestPath, "utf8");
const mechCurrent = fs.existsSync(mechPath) ? fs.readFileSync(mechPath, "utf8") : "";
if (process.argv.includes("--check")) {
  if (written !== current || mechWritten !== mechCurrent) {
    console.error("manifest/spells.json or manifest/spell-mech.json is stale: run node scripts/annotate-spell-manifest.mjs");
    process.exit(1);
  }
  console.log(`manifest/spells.json is current (${manifest.spells.length} spells); spell-mech.json (${baked.length} SRD spells).`);
} else {
  fs.writeFileSync(manifestPath, written);
  fs.writeFileSync(mechPath, mechWritten);
  console.log(
    `manifest/spells.json written (${manifest.spells.length} spells, ${srd.size} SRD names read); spell-mech.json (${baked.length} SRD spells).`,
  );
}
