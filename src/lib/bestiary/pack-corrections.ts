// Content-pack monster rows that disagree with the SRD 5.1 stat block they
// copy, corrected when the row is read. The pack itself (data/content/
// open5e.sqlite) is left as imported: a reimport would bring the error back,
// so the correction lives here, keyed by the row's document and slug, and
// only the fields named are replaced. `actions` rewrites an action's text
// by its name, and `special_abilities` a trait's: a Multiattack that names
// an attack by a short form of its name ("its stinger" for Tail Stinger),
// since the routine reads attacks by their whole name
// (src/lib/bestiary/multiattack-text.ts), an attack line whose words are
// misprinted ("it:" for "Hit:", "escaped DC" for "escape DC", "reach 5.
// ft."), and Tome of Beasts 3's spell lists, printed with no commas between
// the spells ("At will: minor illusion silent image"), which no reader can
// split. `legendary_desc` and `legendary_actions` replace the row's own, for
// legendary actions printed run together into one entry or filed under the
// description.
type Correction = Partial<{
  damage_immunities: string;
  damage_resistances: string;
  damage_vulnerabilities: string;
  condition_immunities: string;
  actions: Record<string, string>;
  special_abilities: Record<string, string>;
  legendary_desc: string;
  legendary_actions: Array<{ name: string; desc: string }>;
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
  // The slam prints no type; the 2023 printing of the same creature's is
  // bludgeoning.
  "tob/abominable-beauty": { actions: { Slam: "Melee Weapon Attack: +8 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) bludgeoning damage plus 28 (8d6) fire damage." } },
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
  // Tome of Beasts: the vampire warlock's Misty Step is printed as its
  // legendary description, so the count and the first option were lost.
  "tob/vampire-warlock-variant": {
    legendary_desc:
      "The vampire warlock can take 3 legendary actions, choosing from the options below. Only one legendary action option can be used at a time and only at the end of another creature's turn. The vampire warlock regains spent legendary actions at the start of its turn.",
    legendary_actions: [
      { name: "Misty Step", desc: "The vampire warlock uses misty step." },
      { name: "Unarmed Strike", desc: "The vampire warlock makes one unarmed strike." },
      { name: "Call the Blood (Costs 2 Actions)", desc: "The vampire warlock uses call the blood." },
    ],
  },
  // Creature Codex: options printed run together into the first entry.
  "cc/azi-dahaka": {
    legendary_actions: [
      {
        name: "Control Weather",
        desc: "Azi Dahaka can alter the weather in a 5-mile radius centered on itself. The effect is identical to the control weather spell, except the casting time and effects are immediate.",
      },
      {
        name: "Call Lightning (Costs 2 Actions)",
        desc: "A bolt of lightning flashes down from the clouds to a point Azi Dahaka can see within 100 feet of it. Each creature within 5 feet of that point must make a DC 20 Dexterity saving throw, taking 16 (3d10) lightning damage on a failed save, or half as much damage on a successful one.",
      },
      {
        name: "Wing Attack (Costs 2 Actions)",
        desc: "Azi Dahaka beats its wings. Each creature within 10 feet of the dragon must succeed on a DC 20 Dexterity saving throw or take 12 (2d6 + 5) bludgeoning damage and be knocked prone. Azi Dahaka can then fly up to half its flying speed.",
      },
    ],
  },
  "cc/lord-zombie": {
    legendary_actions: [
      {
        name: "Shambling Hordes",
        desc: "The lord telepathically commands all zombies it controls within 1 mile to immediately move up to half their speed. A zombie that moves out of an enemy's reach because of this movement doesn't provoke an opportunity attack.",
      },
      { name: "Life Drain (Costs 2 Actions)", desc: "The lord makes a life drain attack." },
      { name: "Arise (Costs 3 Actions)", desc: "The lord targets a humanoid corpse within 30 feet, which rises as a zombie under the lord's control." },
    ],
  },
  // Tome of Beasts 3's spell lists, with the commas the printing lost.
  "tob3/akanka": { actions: { Spellcasting: "Cha (DC 13) no material components: At will: minor illusion, silent image\n3/day: major image\n1/day: hallucinatory terrain" } },
  "tob3/alabroza-bloodfiend": { actions: { Spellcasting: "Cha (DC 12) no material components: At will: minor illusion\n3/day ea: detect thoughts, suggestion" } },
  "tob3/angel-kalkydra": { actions: { Spellcasting: "Cha (DC 19) no material components: At will: detect evil and good, light\n3/day ea: daylight, dispel evil and good\n1/day ea: commune, greater restoration" } },
  "tob3/angel-zirnitran": { special_abilities: { Spellcasting: "Wis (DC 21) no material components: At will: detect evil and good, invisibility (self only), legend lore, thaumaturgy\n3/day ea: dispel evil and good, geas (as an action)\n1/day ea: antimagic field, plane shift" } },
  "tob3/angel-shrouded": { actions: { Spellcasting: "Wis (DC 19) no material components: At will: bane, bless, locate creature\n3/day ea: invisibility (self only), healing word (level 5), nondetection" } },
  "tob3/arcane-scavenger": { actions: { Spellcasting: "Int (DC 15) no material components: At will: detect magic, locate object\n3/day ea: counterspell, dispel magic" } },
  "tob3/archon-word": { actions: { Spellcasting: "Cha (DC 13) no material or somatic components: At will: dancing lights, message, true strike\n1/day ea: faerie fire, heroism" } },
  "tob3/aziza": { actions: { Spellcasting: "Wis (DC 12) no material components: At will: druidcraft, guidance\n1/day ea: animal messenger, bless" } },
  "tob3/bannik": { actions: { Spellcasting: "Wis (DC 13) only wand of bound fir required: At will: augury, create or destroy water, fog cloud\n3/day: lesser restoration" } },
  "tob3/bearfolk-thunderstomper": { actions: { Spellcasting: "Cha (DC 15): At will: dancing lights, prestidigitation, vicious mockery\n2/day ea: charm person, disguise self, mirror image\n1/day ea: compulsion, enthrall, freedom of movement, hypnotic pattern" } },
  "tob3/belu": { actions: { Spellcasting: "Cha (DC 14) no material components: At will: entangle, speak with plants, stone shape\n2/day: plant growth" } },
  "tob3/brownie-mystic": { actions: { Spellcasting: "Wis (DC 13) no material components: At will: mending, minor illusion, prestidigitation\n3/day ea: entangle, mirror image\n1/day ea: confusion, conjure animals, dimension door" } },
  "tob3/catonoctrix": { actions: { "Spellcasting (Psionics)": "Int (DC 15) no spell components: At will: detect thoughts, divination\n1/day ea: confusion, scrying, suggestion" } },
  "tob3/cave-sovereign": { actions: { "Spellcasting (Psionics)": "Cha (DC 18) no spell components: At will: detect thoughts, mage hand (the hand is invisible)\n3/day ea: dimension door, telekinesis\n1/day: hallucinatory terrain (as an action)" } },
  "tob3/chimera-royal": { actions: { Spellcasting: "Goat head casts one of the following spells. Cha (DC 18) only verbal components: At will: charm person, dispel magic, mage hand\n3/day ea: bestow curse, enthrall, haste\n1/day: dominate person" } },
  "tob3/devil-infernal-tutor": { actions: { Spellcasting: "Cha (DC 18) no material components: At will: bane, calm emotions, command, detect thoughts, suggestion\n3/day ea: bestow curse, compulsion, enthrall\n1/day ea: geas, modify memory" } },
  "tob3/devil-infernal-tutor-lesser": { actions: { Spellcasting: "Cha (DC 15) no material components: At will: bane, calm emotions, detect thoughts\n3/day ea: command, enthrall, suggestion\n1/day: compulsion" } },
  "tob3/div": { actions: { Spellcasting: "Cha (DC 14) no material components: At will: disguise self, minor illusion\n3/day ea: charm person, suggestion\n1/day ea: dream, fear" } },
  "tob3/dragon-prismatic-adult": { actions: { Spellcasting: "Int (DC 17) no material components: At will: charm person, color spray, dancing lights\n3/day: prismatic spray\n1/day: prismatic wall" } },
  "tob3/dragon-prismatic-ancient": { actions: { Spellcasting: "Int (DC 20) no material components: At will: charm person, dancing lights, prismatic spray\n1/day: prismatic wall" } },
  "tob3/dragon-prismatic-wyrmling": { actions: { Spellcasting: "Int (DC 12) no material components: At will: dancing lights\n1/day ea: charm person, color spray" } },
  "tob3/dragon-prismatic-young": { actions: { Spellcasting: "Int (DC 14) no material components: At will: dancing lights\n3/day ea: charm person, color spray\n1/day: prismatic spray" } },
  "tob3/dread-examiner": { actions: { "Spellcasting (Psionics)": "Cha (DC 22) no spell components: At will: dispel magic, fabricate (as an action), telekinesis\n3/day ea: animate objects, wall of force\n1/day: true polymorph" } },
  "tob3/giant-lantern": { actions: { Spellcasting: "Cha (DC 15) no material components: At will: detect magic, identify (as an action)\n3/day ea: control water, freedom of movement, water breathing" } },
  "tob3/giant-thursir-hearth-priestess": { actions: { Spellcasting: "Wis (DC 13): At will: mending, spare the dying, thaumaturgy\n3/day ea: cure wounds, heat metal\n1/day: haste" } },
  "tob3/gremlin-rum-story-keeper": { actions: { Spellcasting: "Cha (DC 13) no material components: At will: prestidigitation\n3/day ea: charm person, mirror image" } },
  "tob3/hag-brine": { actions: { Spellcasting: "Cha (DC 16) no material components: At will: minor illusion\n3/day ea: charm person, major image\n1/day: control water" } },
  "tob3/hag-floe": { actions: { Spellcasting: "Cha (DC 13) no material components: At will: minor illusion, prestidigitation\n3/day ea: fog cloud, sleep\n1/day: sleet storm" } },
  "tob3/hag-wood": { actions: { Spellcasting: "Wis (DC 17) no material components: At will: charm person, entangle\n3/day: plant growth\n1/day: contagion" } },
  "tob3/npc:-apostle": { actions: { Spellcasting: "Wis (DC 15): At will: guidance, spare the dying, thaumaturgy\n3/day ea: bless, cure wounds (3rd-level), hold person, lesser restoration\n1/day ea: bestow curse, daylight, freedom of movement, mass cure wounds, revivify" } },
  "tob3/npc:-cultist-psychophant": { actions: { "Spellcasting (Psionics)": "Cha (DC 16) no spell components: At will: detect thoughts, mage hand (hand invisible), thaumaturgy\n3/day ea: charm person, suggestion\n1/day ea: levitate, telekinesis" } },
  "tob3/npc:-field-commander": { actions: { Spellcasting: "Cha (DC 16): At will: command, protection from evil and good\n3/day ea: cure wounds (level 3), find steed (as an action)\n1/day: revivify" } },
  "tob3/npc:-first-servant": { actions: { Spellcasting: "Wis (DC 17): At will: bane, protection from evil and good, spare the dying, thaumaturgy\n3/day ea: cure wounds (level 5), dispel evil and good, divination, speak with dead\n1/day ea: commune (as an action), holy aura, resurrection" } },
  "tob3/npc:-infiltrator": { actions: { Spellcasting: "Int (DC 13): At will: mage hand, message, minor illusion\n3/day ea: charm person, sleep\n1/day: invisibility" } },
  "tob3/npc:-merchant-captain": { actions: { Spellcasting: "Cha (DC 15): At will: comprehend languages, mage hand, mending\n3/day ea: calm emotions, enthrall, heroism\n1/day ea: confusion, freedom of movement" } },
  "tob3/npc:-warlock-of-the-genie-lord": { actions: { Spellcasting: "Cha (DC 15). At will: levitate, water breathing\n3/day ea: fire shield, fly, gust of wind\n1/day ea: conjure minor elementals (as an action), wall of stone" } },
  "tob3/phoenixborn-sorcerer": { actions: { Spellcasting: "Cha (DC 13): At will: mage hand, minor illusion, light, prestidigitation\n2/day ea: charm person, continual flame, mage armor\n1/day: dispel magic" } },
  "tob3/rakshasa-myrmidon": { actions: { Spellcasting: "Cha (DC 12) no material components: At will: detect thoughts, disguise self\n2/day: expeditious retreat" } },
  "tob3/rakshasa-pustakam": { actions: { Spellcasting: "Cha (DC 15) no material or somatic components: At will: detect thoughts, mage hand, minor illusion\n3/day ea: command, suggestion" } },
  "tob3/rakshasa-servitor": { actions: { Spellcasting: "Cha (DC 11) no material components: At will: detect thoughts, disguise self\n1/day: cause fear" } },
  "tob3/rakshasa-slayer": { actions: { Spellcasting: "Cha (DC 16) no material components: At will: detect thoughts, disguise self\n3/day: invisibility\n1/day: mislead" } },
  "tob3/savior-lumen": { actions: { Spellcasting: "Cha (DC 14) no material components: At will: floating disk, mending, spare the dying\n3/day ea: gentle repose, knock, sending\n1/day ea: locate creature, passwall" } },
  "tob3/shetani": { actions: { Spellcasting: "Cha (DC 18): At will: charm person, silent image\n3/day ea: major image, suggestion\n1/day ea: mirage arcane (as an action), programmed illusion" } },
  "tob3/trollkin-ragecaster": { actions: { "Spellcasting (Ragecasting Only)": "Cha (DC 15) no material components: At will: thunderwave\n3/day ea: call lightning, fireball\n1/day: fire shield" } },
  "tob3/wilderness-crone": { actions: { Spellcasting: "Wis (DC 15). Prepared: At will: minor illusion, tree stride\n3/day ea: goodberry, hold person, locate animals or plants\n1/day ea: commune with nature, remove curse" } },
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

const DAMAGE_WORDS = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";

// What a bracket's success says, in the words the readers know: "half" is
// half as much damage, "negates" is nothing, "not prone" or "half damage
// and isn't poisoned" names what the success spares.
function successOf(raw: string): string {
  const text = raw.trim().replace(/\.$/, "");
  const half = /^half(?:\s+damage)?\b\s*(?:,?\s*(?:and\s+)?(?:isn't|is not|not|doesn't|does not)\s+(.+))?$/i.exec(text);
  if (half) {
    return `it takes half as much damage on a successful save${half[1] ? ` and is not ${half[1].trim()}` : ""}.`;
  }
  if (/^negates(?: both)?$/i.test(text)) {
    return "it suffers none of it.";
  }
  const spared = /^(?:negates|not|isn't)\s+(.+)$/i.exec(text);
  if (spared) {
    return `it is not ${spared[1].trim()}.`;
  }
  return text ? `${text}.` : "it suffers none of it.";
}

// Tome of Beasts 3 writes a save as a bracket after its effect: "Each
// creature in that area: 36 (8d8) thunder (DC 16 Con half)", "knocked prone
// (DC 16 Str negates)", "Target incapacitated until the end of its next
// turn (DC 16 Con not incapacitated)". Spelled out the SRD's way, the effect
// before the bracket is what a failure does: "... must make a DC 16
// Constitution saving throw. On a failure, 36 (8d8) thunder damage. On a
// success, it takes half as much damage on a successful save."
function bracketSaves(desc: string): string {
  if (!/\(DC\s*\d/i.test(desc)) {
    return desc;
  }
  // "15 ft. away" is no end of a sentence; the effect runs back to one.
  const FT = "․";
  const spelled = desc
    .replace(/\bft\./g, `ft${FT}`)
    .replace(/([^.:]*?)\s*\(DC\s*(\d{1,2})\s+(str|dex|con|int|wis|cha)[a-z]*\.?\s+([^()]*?)\)(\.?)/gi, (whole, effect: string, dc: string, ability: string, outcome: string) => {
      if (/saving throw|\bsave\b/i.test(outcome) || !effect.trim()) {
        return whole;
      }
      // "Target incapacitated until...": the subject makes the save.
      const subject = /^\s*((?:the\s+)?target|it)\s+(?=\S)/i.exec(effect);
      const failure = effect
        .slice(subject ? subject[0].length : 0)
        .trim()
        // "45 (10d8) psychic and is stunned": the dice are damage.
        .replace(new RegExp(`(\\d+\\s*\\(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?\\)\\s+(?:${DAMAGE_WORDS}))\\b(?!\\s+damage)`, "gi"), "$1 damage");
      const lead = subject ? ` ${subject[1]} ` : /^\s/.test(effect) ? " " : "";
      return `${lead}must make a DC ${dc} ${ABILITY_NAMES[ability.toLowerCase()]} saving throw. On a failure, ${failure}. On a success, ${successOf(outcome)}`;
    });
  return spelled.replaceAll(`ft${FT}`, "ft.");
}

function spelledOut(desc: string, document: string): string {
  return (document === "tob3" ? bracketSaves(desc) : desc)
    .replace(/\bDC\s*(\d{1,2})\s+(str|dex|con|int|wis|cha)(?:[a-z]+|\.)?\s+save\b/gi, (_, dc: string, ability: string) => `DC ${dc} ${ABILITY_NAMES[ability.toLowerCase()]} saving throw`)
    .replace(/\bfor (\d{1,3}) (min|hr)s?\b/g, (_, count: string, unit: string) => `for ${count} ${unit === "min" ? "minute" : "hour"}${count === "1" ? "" : "s"}`);
}

const SECTIONS = ["actions", "bonus_actions", "reactions", "legendary_actions", "special_abilities"];

export function correctedMonsterData(data: Record<string, unknown>): Record<string, unknown> {
  const document = String(data.document__slug ?? data.document_slug ?? "wotc-srd");
  const { actions: texts = {}, special_abilities: traitTexts = {}, ...fields } = CORRECTIONS[`${document}/${String(data.slug ?? "")}`] ?? {};
  const base: Record<string, unknown> = { ...data, ...fields };
  const sections = SECTIONS.filter((section) => Array.isArray(base[section])).map((section) => [
    section,
    (base[section] as Array<Record<string, unknown>>).map((entry) => {
      const rewrites = section === "actions" ? texts : section === "special_abilities" ? traitTexts : {};
      const desc = Object.hasOwn(rewrites, String(entry.name)) ? rewrites[String(entry.name)] : entry.desc;
      return typeof desc === "string" ? { ...entry, desc: spelledOut(desc, document) } : entry;
    }),
  ]);
  return { ...base, ...Object.fromEntries(sections) };
}
