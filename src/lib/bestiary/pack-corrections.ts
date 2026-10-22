// Content-pack monster rows that disagree with the SRD 5.1 stat block they
// copy, corrected when the row is read. The pack itself (data/content/
// open5e.sqlite) is left as imported: a reimport would bring the error back,
// so the correction lives here, keyed by the row's document and slug, and
// only the fields named are replaced. `actions` rewrites an action's text
// by its name: a Multiattack that names an attack by a short form of its
// name ("its stinger" for Tail Stinger), since the routine reads attacks by
// their whole name (src/lib/bestiary/attack-text.ts), and an attack line
// whose words are misprinted ("it:" for "Hit:", "escaped DC" for "escape
// DC", "reach 5. ft.").
type Correction = Partial<{
  damage_immunities: string;
  damage_resistances: string;
  damage_vulnerabilities: string;
  condition_immunities: string;
  actions: Record<string, string>;
}>;

const CORRECTIONS: Record<string, Correction> = {
  // SRD 5.1 Skeleton: vulnerable to bludgeoning, immune to poison (the row
  // files poison under resistances).
  "wotc-srd/skeleton": { damage_immunities: "poison", damage_resistances: "" },
  // SRD 5.1 Zombie: immune to poison (the row leaves immunities empty).
  "wotc-srd/zombie": { damage_immunities: "poison" },
  "wotc-srd/purple-worm": { actions: { Multiattack: "The worm makes two attacks: one with its bite and one with its tail stinger." } },
  "blackflag/archdruid_bf": {
    actions: {
      "Thorned Staff":
        "_Melee Weapon Attack:_ +7 to hit, reach 5 ft., one target. _Hit:_ 10 (2d6+3) piercing damage plus 18 (4d8) cold, fire, lightning, poison, or thunder damage (the archdruid's choice).",
    },
  },
  "blackflag/bard_bf": {
    actions: {
      Rapier:
        "_Melee Weapon Attack:_ +6 to hit, reach 5 ft., one target. _Hit:_ 7 (1d8+3) piercing damage plus 13 (3d8) damage of the type determined by Artistic Expression.",
    },
  },
  "tob/mamura": { actions: { Multiattack: "The mamura makes three claw attacks and one whiptail stinger attack." } },
  "tob/star-spawn-of-cthulhu": {
    actions: {
      Multiattack: "The star spawn can use disintegrating gaze if it's available, and also make one crushing claws attack and one dimensional stomp attack.",
    },
  },
  "tob2/forest-emperor": {
    actions: {
      Multiattack:
        "The forest emperor makes two acidic claw attacks and one tail attack. If both claws hit the same target, the target must succeed on a DC 18 Constitution saving throw or its hp maximum is reduced by 7 (2d6) and the forest emperor regains hp equal to this amount. This reduction lasts until the target finishes a long rest. The target dies if this effect reduces its hp maximum to 0.",
    },
  },
  "tob2/animated-bearskin-rug": {
    actions: {
      Envelop:
        "Melee Weapon Attack: +6 to hit, reach 5 ft., one Medium or smaller creature. Hit: The creature is grappled (escape DC 14). Until this grapple ends, the target is restrained, and the rug can't envelop another target.",
    },
  },
  "tob2/ophidiotaur": { actions: { Multiattack: "The ophidiotaur makes two attacks: one with its bite and one with its poisoned glaive." } },
  "tob-2023/crystallinedevil-tob1-2023": { actions: { Multiattack: "The devil makes three Shard Claw attacks." } },
  "tob-2023/ancientwinddragon-tob1-2023": { actions: { Claw: "Melee Weapon Attack: +16 to hit, reach 10 ft., one target. Hit: 16 (2d6 + 9) slashing damage." } },
  "tob-2023/dogmolejuggernaut-tob1-2023": { actions: { Claw: "Melee Weapon Attack: +8 to hit, reach 5 ft., one target. Hit: 12 (3d4 + 5) slashing damage." } },
};

// Some documents shorten what the SRD spells out (Tome of Beasts 3's "DC 13
// Con save" and "for 1 min", Black Flag's "DC 16 CON save"): their
// lines are read spelled out, so the readers (attack-text.ts,
// monster-abilities.ts) know one wording.
const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

function spelledOut(desc: string): string {
  return desc
    .replace(/\bDC\s*(\d{1,2})\s+(str|dex|con|int|wis|cha)(?:[a-z]+|\.)?\s+save\b/gi, (_, dc: string, ability: string) => `DC ${dc} ${ABILITY_NAMES[ability.toLowerCase()]} saving throw`)
    .replace(/\bfor (\d{1,3}) (min|hr)s?\b/g, (_, count: string, unit: string) => `for ${count} ${unit === "min" ? "minute" : "hour"}${count === "1" ? "" : "s"}`);
}

const SECTIONS = ["actions", "bonus_actions", "reactions", "legendary_actions", "special_abilities"];

export function correctedMonsterData(data: Record<string, unknown>): Record<string, unknown> {
  const document = String(data.document__slug ?? data.document_slug ?? "wotc-srd");
  const { actions: texts = {}, ...fields } = CORRECTIONS[`${document}/${String(data.slug ?? "")}`] ?? {};
  const sections = SECTIONS.filter((section) => Array.isArray(data[section])).map((section) => [
    section,
    (data[section] as Array<Record<string, unknown>>).map((entry) => {
      const desc = section === "actions" && Object.hasOwn(texts, String(entry.name)) ? texts[String(entry.name)] : entry.desc;
      return typeof desc === "string" ? { ...entry, desc: spelledOut(desc) } : entry;
    }),
  ]);
  return { ...data, ...fields, ...Object.fromEntries(sections) };
}
