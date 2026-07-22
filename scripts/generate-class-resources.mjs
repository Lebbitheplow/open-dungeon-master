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

// The typed effect the description states, when its phrasing is one the
// server can execute (src/lib/srd/class-resources.ts effectFromFx). Healing,
// saves with damage/conditions, area bursts, teleports, invisibility, and
// flight all read reliably; everything else stays narrative guidance.
const FX_ABILITIES = /(STR|DEX|CON|INT|WIS|CHA)/;
const FX_CONDITIONS =
  /(blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|restrained|stunned|prone)/i;

function parseFx(desc) {
  const text = desc;
  // Healing: "an ally regains 3d6 + WIS HP", "regain 10 + level HP".
  const heal =
    /regains?\s+(\d+(?:d\d+)?)\s*(?:\+\s*(WIS|CHA|CON|INT|STR|DEX|level))?\s*(?:HP|hit points)/i.exec(
      text,
    );
  if (heal) {
    const dice = `${heal[1]}${heal[2] ? `+${heal[2].toLowerCase()}` : ""}`;
    const selfHeal = /\byou\b[^.]{0,40}regain|regain[^.]{0,20}\byour\b/i.test(text) &&
      !/all(y|ies)|creature|touch/i.test(text.slice(0, text.indexOf(heal[0])));
    return selfHeal ? { kind: "heal_self", dice } : { kind: "heal_target", dice };
  }
  // An inspiration-style handed die: "gains a d6 to add to one attack,
  // check, or save".
  const inspire = /gains?\s+a\s+(d\d+)\b[^.]{0,60}(?:add|attack|check|save)/i.exec(text);
  if (inspire) {
    return { kind: "inspire", die: inspire[1].toLowerCase() };
  }
  // Save-based effects, single-target or area. Both phrasings: "a Wisdom
  // save" and "saves (WIS)".
  const save =
    new RegExp(`${FX_ABILITIES.source}\\w*\\s+sav`, "i").exec(text) ??
    new RegExp(`sav(?:e|es|ing)?\\s*\\(${FX_ABILITIES.source}\\)`, "i").exec(text);
  if (save) {
    const ability = save[1].toLowerCase();
    // The healing branch has already claimed its dice, so the first dice
    // expression here is the effect's damage ("deals 4d10 necrotic",
    // "10d10 necrotic (CON save halves)").
    const dice = /(\d+d\d+)/.exec(text)?.[1];
    const condition = FX_CONDITIONS.exec(text)?.[1]?.toLowerCase();
    const area = /each creature|cone|line\b|radius|burst/i.test(text);
    if (area && dice) {
      return { kind: "aoe", dice, save: ability };
    }
    if (dice || condition) {
      return {
        kind: "enemy_save",
        save: ability,
        ...(condition ? { condition } : {}),
        ...(dice ? { dice } : {}),
      };
    }
  }
  // Teleports: "teleport up to 60 ft".
  const teleport = /teleport[^.]{0,40}?(\d+)\s*(?:ft|feet)/i.exec(text);
  if (teleport) {
    return { kind: "teleport", feet: Number(teleport[1]) };
  }
  // Invisibility and flight land as their tracked conditions.
  if (/turns? invisible|become(?:s)? invisible|\binvisibility\b/i.test(text)) {
    return { kind: "buff", condition: "invisible", rounds: 10 };
  }
  if (/fly(?:ing)? speed/i.test(text)) {
    return { kind: "buff", condition: "flying", rounds: 10 };
  }
  return undefined;
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
            const fx = parseFx(feat.d);
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
              ...(fx ? { fx } : {}),
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
