// Properties every identity lookup keeps, generated over each table it reads:
// a record is found by its whole name in any spelling textKey folds (case,
// curly apostrophes, hyphens, spacing), and a name with a word added, or one
// word of a longer name, finds nothing, or a record that name is a whole
// spelling of ("Plate" from "Half Plate" is Plate). A record's spellings are
// its name, the name without its bracket note or "+N", the book's comma order,
// the English plurals and the aliases its table lists.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-name-properties");
const world = await openWorld({ campaign: { maxPlayers: 10 } });
const { textKey } = await import("../src/lib/language/text-logic.ts");
const { pluralForms } = await import("../src/lib/srd/name-forms.ts");
const { withoutBonus } = await import("../src/lib/srd/item-row.ts");
const { SRD_WEAPONS, WEAPON_ALIASES, weaponNamed } = await import("../src/lib/srd/weapons.ts");
const { SRD_ARMOR } = await import("../src/lib/srd/armor-table.ts");
const { armorNamed } = await import("../src/lib/srd/armor.ts");
const { magicItemNamed } = await import("../src/lib/srd/magic-items.ts");
const { SRD_GEAR, matchGear, catalogName } = await import("../src/lib/srd/adventuring-gear.ts");
const { POISONS, findPoison } = await import("../src/lib/srd/afflictions.ts");
const { CONDITION_EFFECTS, conditionEffectsFor } = await import("../src/lib/srd/condition-effects.ts");
const { MOUNTS, mountProfile } = await import("../src/lib/srd/mounts.ts");
const { BEAST_FORMS, findBeastForm } = await import("../src/lib/srd/beast-forms.ts");
const { SUMMON_FORMS, findSummonForm } = await import("../src/lib/srd/summon-forms.ts");
const { FEATURE_EFFECTS, effectsFor } = await import("../src/lib/srd/feature-effects.ts");
const { holdsFeature } = await import("../src/lib/srd/trait-rules.ts");
const { optionsOfKind, optionFeatureName } = await import("../src/lib/srd/options.ts");
const { attackNamed } = await import("../src/lib/dm/enemy-profile.ts");
const { findMonsterAbility, abilityKey, findMonsterSpell } = await import("../src/lib/dm/monster-abilities.ts");
const { legendaryProfile, pickLairOption, spendLegendaryAction } = await import("../src/lib/dm/legendary-logic.ts");
const { resolvePrepRef } = await import("../src/lib/dm/prep-logic.ts");
const { parseMonster } = await import("../src/lib/bestiary/statblock.ts");
const { getContentDb } = await import("../src/lib/content/db.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { insertFaction, findFactionByName } = await import("../src/lib/db/factions.ts");
const { insertShop, findShopByName } = await import("../src/lib/db/shops.ts");
const { insertKnownLocation, getLocationByName } = await import("../src/lib/db/locations.ts");
const { upsertNpc, getNpcByName } = await import("../src/lib/db/npcs.ts");
const magicItems = (await import("../src/lib/classes/magic-items.json", { with: { type: "json" } })).default.items;

// Spellings textKey folds into one key: the lookup must not care which. A
// hyphen goes only before a letter: before a digit it is a sign ("-1").
const variants = (name) => [
  name,
  name.toUpperCase(),
  name.toLowerCase(),
  name.replace(/'/g, "’"),
  name.replace(/ (?=\p{L})/gu, "-"),
  `  ${name.replace(/ /g, "   ")} `,
];

// A record's own spellings, as keys: as written, without a bracket note or a
// "+N", in the book's comma order, and the plurals of each.
function ownKeys(...names) {
  const keys = new Set();
  for (const name of names) {
    const bare = name.replace(/\s*\([^()]*\)\s*$/, "");
    const comma = /^([^,]+),\s*(.+)$/.exec(bare);
    for (const form of [name, bare, withoutBonus(name), ...(comma ? [`${comma[2]} ${comma[1]}`] : [])]) {
      for (const key of [textKey(form), textKey(form.replace(/['‘’ʼ´]/g, ""))]) {
        for (const plural of pluralForms(key)) {
          keys.add(plural);
          keys.add(plural.replace(/ /g, ""));
        }
      }
    }
  }
  return keys;
}

// Names that are no record's: one word added in front or behind, and each
// word of a name of two or more.
function strangers(name) {
  const words = textKey(name).split(" ");
  return [
    ...["Old", "Dinner", "Copper"].map((word) => `${word} ${name}`),
    ...["Lite", "board", "soda"].map((word) => `${name} ${word}`),
    ...(words.length > 1 ? words : []),
  ];
}

// The two properties over one table. `find` takes a name and returns the
// record or null; `keysOf` a record's whole spellings; `same` whether two
// records are the one a name means (two rows may share a spelling).
function holdsProperties(family, records, { nameOf, find, keysOf, same = (a, b) => a === b, skip = () => false }) {
  const problems = [];
  for (const record of records) {
    const name = nameOf(record);
    for (const written of variants(name)) {
      const found = find(written);
      if (!found || !(same(found, record) || keysOf(found).has(textKey(name)))) {
        problems.push(`${family}: ${JSON.stringify(written)} found ${found ? JSON.stringify(nameOf(found)) : "nothing"}, not ${JSON.stringify(name)}`);
      }
    }
    for (const stranger of strangers(name)) {
      if (skip(stranger)) {
        continue;
      }
      const found = find(stranger);
      if (found && !keysOf(found).has(textKey(stranger))) {
        problems.push(`${family}: ${JSON.stringify(stranger)} (from ${JSON.stringify(name)}) found ${JSON.stringify(nameOf(found))}`);
      }
    }
  }
  assert.deepEqual(problems.slice(0, 40), [], `${problems.length} problems`);
  return records.length;
}

await test("SRD weapons, armour, magic items, gear and poisons: the whole name finds the row; another name finds none.", () => {
  holdsProperties("weapon", SRD_WEAPONS, {
    nameOf: (weapon) => weapon.name,
    find: weaponNamed,
    keysOf: (weapon) => ownKeys(weapon.name, ...(WEAPON_ALIASES[weapon.name] ?? [])),
  });
  holdsProperties("weapon (catalog)", SRD_WEAPONS, {
    nameOf: (weapon) => weapon.name,
    find: (name) => SRD_WEAPONS.find((weapon) => weapon.name === catalogName(name)) ?? null,
    keysOf: (weapon) => ownKeys(weapon.name, ...(WEAPON_ALIASES[weapon.name] ?? [])),
  });
  const armorKeys = (armor) => ownKeys(armor.name, ...["armor", "armour"].flatMap((word) => [`${armor.name} ${word}`, `${word} ${armor.name}`]));
  holdsProperties("armor", SRD_ARMOR, { nameOf: (armor) => armor.name, find: armorNamed, keysOf: armorKeys });
  holdsProperties("magic item", magicItems, {
    nameOf: (item) => item.name,
    find: magicItemNamed,
    keysOf: (item) => ownKeys(item.name, ...(item.aliases ?? [])),
    same: (a, b) => a.name === b.name,
  });
  holdsProperties("gear", SRD_GEAR, { nameOf: (gear) => gear.name, find: matchGear, keysOf: (gear) => ownKeys(gear.name, ...(gear.aliases ?? [])) });
  holdsProperties("gear (catalog)", SRD_GEAR, {
    nameOf: (gear) => gear.name,
    find: (name) => [...SRD_GEAR, ...SRD_WEAPONS, ...SRD_ARMOR].find((row) => row.name === catalogName(name)) ?? null,
    keysOf: (row) => ownKeys(row.name, ...(row.aliases ?? []), ...(WEAPON_ALIASES[row.name] ?? []), `${row.name} armor`),
  });
  holdsProperties("poison", POISONS, { nameOf: (poison) => poison.name, find: findPoison, keysOf: (poison) => ownKeys(poison.name) });
});

await test("conditions, features, feats and option picks: the whole name or with a bracket note; never a name that holds it.", () => {
  const terms = CONDITION_EFFECTS.flatMap((row) => row.match.map((term) => ({ term, row })));
  holdsProperties("condition", terms, {
    nameOf: (entry) => entry.term,
    find: (name) => {
      const row = conditionEffectsFor(name);
      return row ? { term: row.match[0], row } : null;
    },
    same: (a, b) => a.row === b.row,
    keysOf: (entry) => new Set(entry.row.match.flatMap((term) => [textKey(term), textKey(term.replace(/\s*\([^()]*\)\s*$/, ""))])),
  });
  const features = FEATURE_EFFECTS.flatMap((def) => def.match.map((term) => ({ term, def })));
  holdsProperties("feature", features, {
    nameOf: (entry) => entry.term,
    find: (name) => {
      const hit = effectsFor({ class: features.find((entry) => textKey(entry.term) === textKey(name))?.def.classes?.[0] ?? "fighter", features: [{ name }] })[0];
      return hit ? { term: hit.def.match[0], def: hit.def } : null;
    },
    same: (a, b) => a.def === b.def,
    keysOf: (entry) => new Set(entry.def.match),
  });
  const named = [...new Set(features.map((entry) => entry.term))];
  holdsProperties("held feature", named, {
    nameOf: (term) => term,
    find: (name) => named.find((term) => holdsFeature({ features: [{ name }] }, term)) ?? null,
    keysOf: (term) => new Set([textKey(term)]),
  });
  for (const kind of ["maneuver", "invocation", "metamagic", "discipline"]) {
    const options = optionsOfKind(kind).map((option) => option.n);
    holdsProperties(kind, options, {
      nameOf: (option) => option,
      find: (name) => options.find((option) => holdsFeature({ features: [{ name: optionFeatureName(kind, name) }] }, option)) ?? null,
      keysOf: (option) => new Set([textKey(option)]),
    });
  }
});

await test("creature forms and mounts: the whole name; never a creature whose name holds it.", () => {
  const formKeys = (form) => ownKeys(form.name);
  holdsProperties("beast form", BEAST_FORMS, { nameOf: (form) => form.name, find: findBeastForm, keysOf: formKeys });
  holdsProperties("summon form", SUMMON_FORMS, { nameOf: (form) => form.name, find: findSummonForm, keysOf: formKeys, same: (a, b) => a.name === b.name });
  holdsProperties("mount", MOUNTS, { nameOf: (mount) => mount.name, find: mountProfile, keysOf: (mount) => new Set([textKey(mount.name), mount.slug]) });
});

await test("a pack monster's attacks, abilities, spells and legendary actions: the whole name; never the one that holds a word of it.", () => {
  if (!world.hasPack) {
    return;
  }
  const rows = getContentDb().prepare("SELECT slug, data_json, cr FROM monsters ORDER BY document_slug, slug").all();
  let attacks = 0;
  let abilities = 0;
  let spells = 0;
  let legendary = 0;
  for (const row of rows) {
    const stats = parseMonster(JSON.parse(row.data_json), row.cr);
    const attackKey = (name) => textKey(name.replace(/\([^)]*\)/g, ""));
    attacks += holdsProperties(`${row.slug} attack`, stats.attacks, {
      nameOf: (attack) => attack.name,
      find: (name) => attackNamed(stats.attacks, name),
      same: (a, b) => attackKey(a.name) === attackKey(b.name),
      keysOf: (attack) => new Set([textKey(attack.name), attackKey(attack.name)]),
    });
    const held = [...(stats.specials ?? [])];
    abilities += holdsProperties(`${row.slug} ability`, held, {
      nameOf: (ability) => ability.name,
      find: (name) => findMonsterAbility(stats, name),
      same: (a, b) => abilityKey(a.name) === abilityKey(b.name),
      keysOf: (ability) => new Set([abilityKey(ability.name)]),
    });
    spells += holdsProperties(`${row.slug} spell`, stats.spellcasting?.spells ?? [], {
      nameOf: (spell) => spell.name,
      find: (name) => findMonsterSpell(stats.spellcasting, name),
      same: (a, b) => textKey(a.name) === textKey(b.name),
      keysOf: (spell) => new Set([textKey(spell.name)]),
    });
    const profile = legendaryProfile(stats);
    legendary += holdsProperties(`${row.slug} legendary action`, profile?.actions ?? [], {
      nameOf: (action) => action.name,
      find: (name) => {
        const spent = spendLegendaryAction({ actions: 3, resistances: 0 }, profile, name);
        return spent.ok ? spent.action : null;
      },
      same: (a, b) => textKey(a.name) === textKey(b.name),
      keysOf: (action) => new Set([textKey(action.name)]),
    });
  }
  assert.ok(attacks > 4000 && abilities > 1000 && spells > 1000 && legendary > 100, `${attacks} attacks, ${abilities} abilities, ${spells} spells, ${legendary} legendary actions`);
});

await test("a lair option: its whole printed line or its number in the list; never the line that shares a word with it.", () => {
  const options = [
    "Magma erupts from a point on the ground the dragon can see within 120 feet of it, creating a 20-foot-high, 5-foot-radius geyser.",
    "A tremor shakes the lair in a 60-foot radius around the dragon. Each creature other than the dragon on the ground in that area must succeed on a DC 15 Dexterity saving throw or be knocked prone.",
    "Volcanic gases form a cloud in a 20-foot-radius sphere centered on a point the dragon can see within 120 feet of it.",
  ];
  holdsProperties("lair option", options, {
    nameOf: (line) => line,
    find: (name) => pickLairOption(options, name),
    keysOf: (line) => new Set([textKey(line), String(options.indexOf(line) + 1)]),
  });
});

const RECORD_NAMES = {
  english: ["The Reed Court", "Iron Guild", "Rusty Anchor", "Marta Hale", "Old Mill"],
  italian: ["La Corte dei Giunchi", "Gilda del Ferro", "L'Ancora Arrugginita", "Niccolò Ferri", "Il Mulino Vecchio"],
  french: ["La Cour des Roseaux", "Guilde du Fer", "L’Ancre Rouillée", "Élodie Martin", "Le Vieux Moulin"],
  spanish: ["La Corte de los Juncos", "Gremio del Hierro", "El Ancla Oxidada", "José Peña", "El Molino Viejo"],
  german: ["Der Schilfhof", "Eisengilde", "Zum Rostigen Anker", "Jürgen Weiß", "Die Alte Mühle"],
};

await test("a campaign's factions, shops, places, NPCs and prep cards: the whole name, in every table language.", () => {
  for (const [tableLanguage, names] of Object.entries(RECORD_NAMES)) {
    const campaign = createCampaign(world.owner.id, {
      title: `Names ${tableLanguage}`, description: "", theme: "", maxPlayers: 4, startingLevel: 1, difficulty: "normal",
      gameSettings: { tableLanguage },
    });
    // A record answers to its whole name, its article included.
    const termsOf = (name) => new Set([textKey(name)].filter(Boolean));
    const records = (insert, nameOf) => names.map((name) => nameOf(insert(name)));
    const families = [
      ["faction", records((name) => insertFaction(campaign.id, { name }), (faction) => faction.name), (name) => findFactionByName(campaign.id, name)?.name],
      ["shop", records((name) => insertShop(campaign.id, { name }), (shop) => shop.name), (name) => findShopByName(campaign.id, name)?.name],
      ["place", records((name) => insertKnownLocation({ campaignId: campaign.id, name }), (place) => place.name), (name) => getLocationByName(campaign.id, name)?.name],
      ["npc", records((name) => upsertNpc({ campaignId: campaign.id, name }), (npc) => npc.name), (name) => getNpcByName(campaign.id, name)?.name],
    ];
    const cards = names.map((title, index) => ({ cardId: `c${index}`, title }));
    families.push(["prep card", names, (name) => resolvePrepRef(null, cards, name)?.title]);
    for (const [family, held, find] of families) {
      holdsProperties(`${tableLanguage} ${family}`, held, {
        nameOf: (name) => name,
        find: (name) => find(name) ?? null,
        keysOf: termsOf,
        same: (a, b) => a === b,
        skip: (name) => termsOf(name).size === 0,
      });
    }
  }
});

finish();
