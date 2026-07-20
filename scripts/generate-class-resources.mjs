// Reads the custom genre-class feature tables and emits the limited-use
// counters they describe into src/lib/classes/resources.json.
//
// The catalog states uses and recharge in prose ("1/short rest", "2/rest",
// "CON-mod uses per short rest"), which is regular enough to read. The
// OUTPUT IS COMMITTED as data and loaded at runtime; this script is run by
// hand when the catalog changes, never on boot. Re-running it is idempotent.
//
//   node scripts/generate-class-resources.mjs          # write the file
//   node scripts/generate-class-resources.mjs --check  # fail if stale
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const classesDir = join(root, "src", "lib", "classes");
const outPath = join(classesDir, "resources.json");

const ABILITIES = { str: "str", dex: "dex", con: "con", int: "int", wis: "wis", cha: "cha" };

// "Adrenal Override (2 uses)" upgrades "Adrenal Override" rather than being
// a second feature; the suffix is stripped to find what it upgrades.
function baseName(name) {
  return name.replace(/\s*\((?:\d+|[a-z]+)\s+uses?\)\s*$/i, "").trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// How many uses the text grants, and how they come back. Returns null when
// the feature is not a counted resource at all.
function parseUses(desc) {
  const text = desc.toLowerCase();

  // "CON-mod uses per short rest", "uses per long rest equal WIS modifier"
  const abilityMatch =
    /\b(str|dex|con|int|wis|cha)-mod uses? per (short|long) rest/i.exec(text) ||
    /uses? per (short|long) rest equal(?:s|ling)? (?:your )?(str|dex|con|int|wis|cha)/i.exec(text);
  if (abilityMatch) {
    const ability = ABILITIES[(abilityMatch[1].length === 3 ? abilityMatch[1] : abilityMatch[2]).toLowerCase()];
    const recharge = /short/.test(abilityMatch[0]) ? "short" : "long";
    return { uses: 1, ability, recharge };
  }

  // "N/rest", "N/short rest", "N/long rest", "1/day"
  const slash = /(\d+)\s*\/\s*(short rest|long rest|rest|day)/i.exec(text);
  if (slash) {
    const scope = slash[2].toLowerCase();
    return {
      uses: Number(slash[1]),
      ability: null,
      recharge: scope === "long rest" || scope === "day" ? "long" : "short",
    };
  }

  // "N uses per short rest", "recharges twice per short rest"
  const words = { once: 1, twice: 2, "three times": 3, thrice: 3 };
  const per = /(\d+|once|twice|thrice|three times)\s+(?:uses?\s+)?per\s+(short|long)\s+rest/i.exec(text);
  if (per) {
    const raw = per[1].toLowerCase();
    return {
      uses: words[raw] ?? Number(raw) ?? 1,
      ability: null,
      recharge: per[2].toLowerCase(),
    };
  }

  // "once per day", "once per rest each"
  if (/once per day\b/i.test(text)) {
    return { uses: 1, ability: null, recharge: "long" };
  }
  if (/once per rest\b/i.test(text)) {
    return { uses: 1, ability: null, recharge: "short" };
  }
  return null;
}

function collect() {
  const byId = new Map();
  const files = readdirSync(classesDir).filter((name) => name.endsWith("-features.json"));
  for (const file of files.sort()) {
    const parsed = JSON.parse(readFileSync(join(classesDir, file), "utf8"));
    const genre = file.replace("-features.json", "");
    for (const [classId, table] of Object.entries(parsed.classes)) {
      const buckets = [table.levels ?? {}];
      if (table.subclass?.levels) {
        buckets.push(table.subclass.levels);
      }
      for (const levels of buckets) {
        for (const feats of Object.values(levels)) {
          for (const feat of feats) {
            const parsedUses = parseUses(feat.d);
            if (!parsedUses) {
              continue;
            }
            const base = baseName(feat.n);
            const id = `${slugify(genre)}_${slugify(base)}`;
            const isUpgrade = base !== feat.n.trim();
            const existing = byId.get(id);
            if (existing) {
              // An upgrade line raises the count when the character has it.
              if (isUpgrade) {
                existing.upgrades.push({
                  match: feat.n.trim().toLowerCase(),
                  uses: parsedUses.uses,
                });
              }
              if (!existing.classes.includes(classId)) {
                existing.classes.push(classId);
              }
              continue;
            }
            byId.set(id, {
              id,
              displayName: base,
              match: [base.toLowerCase()],
              classes: [classId],
              uses: parsedUses.uses,
              ability: parsedUses.ability,
              recharge: parsedUses.recharge,
              upgrades: isUpgrade ? [{ match: feat.n.trim().toLowerCase(), uses: parsedUses.uses }] : [],
              guidance: feat.d,
            });
          }
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const generated = {
  _note:
    "GENERATED by scripts/generate-class-resources.mjs from the *-features.json catalogs. Do not edit by hand; re-run the script instead.",
  resources: collect(),
};
const serialized = `${JSON.stringify(generated, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = readFileSync(outPath, "utf8");
  if (current !== serialized) {
    console.error("resources.json is stale; re-run node scripts/generate-class-resources.mjs");
    process.exit(1);
  }
  console.log(`resources.json is current (${generated.resources.length} counters).`);
} else {
  writeFileSync(outPath, serialized);
  console.log(`Wrote ${generated.resources.length} counters to src/lib/classes/resources.json`);
}
