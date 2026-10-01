// The SRD 5.1 magic weapons and armor, as numbers the engines read. Written
// by hand from each item's own text in the SRD, because a sentence like
// "when you hit a fiend or an undead with it, that creature takes an extra
// 2d10 radiant damage" names a creature type, a die and a damage type that a
// general parser would have to guess at. scripts/generate-magic-items.mjs
// lays these onto the generated rows by the item's name in lower case.
//
// The base item a magic weapon or armor is built on comes from the pack
// row's category ("weapon (any sword)", "armor (plate)"), read by
// categoryBase below; a sheet row whose name says which one ("Flame Tongue
// Scimitar", "Mithral Half Plate") wins over that default.
//
// weapon:
//   bonus        +N to attack and damage rolls
//   bonusVs      a higher bonus against these creature types (Mace of Smiting)
//   damageType   the damage type the weapon deals instead of its own
//   properties   properties the magic adds (Sun Blade's finesse)
//   rangeFt, longRangeFt   thrown range the magic gives (Dwarven Thrower)
//   extra        dice added on every hit: { dice, type ("weapon" = the
//                weapon's own type), vs (creature types), ranged (only on a
//                ranged attack) }
//   critExtra    dice added when the attack roll is a natural 20
// cursed: attuning curses the wearer, and the attunement cannot be ended
//   (nor the item set aside) until remove curse or similar magic.
// armor:
//   bonus             +N to AC
//   noStrength        no Strength requirement (mithral)
//   noStealthPenalty  no disadvantage on Stealth (mithral)
//   proficientAnyway  worn as if trained (Elven Chain)
//   critProof         a critical hit against the wearer is a normal hit
//                     (Adamantine Armor)

const d = (dice, type, extra = {}) => ({ dice, type, ...extra });

export const GEAR_RIDERS = {
  // ---- weapons ----
  "berserker axe": { weapon: { bonus: 1 }, cursed: true },
  "dagger of venom": { weapon: { bonus: 1 } },
  "dancing sword": { weapon: {} },
  defender: { weapon: { bonus: 3 } },
  "dragon slayer": { weapon: { bonus: 1, extra: [d("3d6", "weapon", { vs: ["dragon"] })] } },
  "dwarven thrower": {
    weapon: {
      bonus: 3,
      properties: ["thrown"],
      rangeFt: 20,
      longRangeFt: 60,
      extra: [d("1d8", "weapon", { ranged: true }), d("1d8", "weapon", { ranged: true, vs: ["giant"] })],
    },
  },
  "flame tongue": { weapon: { extra: [d("2d6", "fire")] } },
  "frost brand": { weapon: { extra: [d("1d6", "cold")] } },
  "giant slayer": { weapon: { bonus: 1, extra: [d("2d6", "weapon", { vs: ["giant"] })] } },
  "hammer of thunderbolts": { weapon: { bonus: 1 } },
  "holy avenger": { weapon: { bonus: 3, extra: [d("2d10", "radiant", { vs: ["fiend", "undead"] })] } },
  "javelin of lightning": { weapon: {} },
  "luck blade": { weapon: { bonus: 1 } },
  "mace of disruption": { weapon: { extra: [d("2d6", "radiant", { vs: ["fiend", "undead"] })] } },
  "mace of smiting": {
    weapon: {
      bonus: 1,
      bonusVs: { types: ["construct"], bonus: 3 },
      critExtra: [d("2d6", "bludgeoning"), d("2d6", "bludgeoning", { vs: ["construct"] })],
    },
  },
  "mace of terror": { weapon: {} },
  "nine lives stealer": { weapon: { bonus: 2 } },
  oathbow: { weapon: {} },
  "scimitar of speed": { weapon: { bonus: 2 } },
  "sun blade": {
    weapon: {
      bonus: 2,
      damageType: "radiant",
      properties: ["finesse"],
      extra: [d("1d8", "radiant", { vs: ["undead"] })],
    },
  },
  "sword of life stealing": { weapon: { critExtra: [d("3d6", "necrotic", { notVs: ["construct", "undead"] })] } },
  "sword of sharpness": { weapon: { critExtra: [d("4d6", "slashing")] } },
  "sword of wounding": { weapon: {} },
  "trident of fish command": { weapon: {} },
  "vicious weapon": { weapon: { critExtra: [d("2d6", "weapon")] } },
  "vorpal sword": { weapon: { bonus: 3 } },
  "weapon, +1, +2, or +3": { weapon: {} },

  // ---- armor ----
  "adamantine armor": { armor: { critProof: true } },
  "animated shield": { armor: {} },
  "armor of invulnerability": { armor: {} },
  "armor of resistance": { armor: {} },
  "armor of vulnerability": { armor: {}, cursed: true },
  "arrow-catching shield": { armor: {} },
  "demon armor": { armor: { bonus: 1 }, cursed: true },
  "dragon scale mail": { armor: {} },
  "dwarven plate": { armor: { bonus: 2 } },
  "elven chain": { armor: { bonus: 1, proficientAnyway: true } },
  "glamoured studded leather": { armor: { bonus: 1 } },
  "mithral armor": { armor: { noStrength: true, noStealthPenalty: true } },
  "plate armor of etherealness": { armor: {} },
  "shield of missile attraction": { armor: {}, cursed: true },
  "spellguard shield": { armor: {} },
};

// A daily power that is not a charge in the text ("can't be used again until
// the next dawn") is tracked as one charge that comes back at dawn, so the
// engine can refuse a second use before the dawn the item waits for.
export const DAILY_POWERS = {
  "armor of invulnerability": "resistance becomes immunity to nonmagical damage for 10 minutes",
  "dagger of venom": "the blade drips poison: the next hit forces a DC 15 Constitution save or 2d10 poison and poisoned for 1 minute",
  "dragon scale mail": "sense the nearest dragon of its kind within 30 miles",
  "javelin of lightning": "a 5-foot line of lightning to a target within 120 feet: DC 13 Dexterity save or 4d6 lightning, and the target takes 4d6 lightning on a hit",
  "plate armor of etherealness": "the etherealness spell for 10 minutes",
};

// The base item a pack category names. "weapon (any sword)" is a longsword
// unless the sheet's name says otherwise; "armor (medium or heavy)" is chain
// mail. Ammunition is not a weapon the attack engine swings.
const WEAPON_DEFAULTS = {
  "any sword": "Longsword",
  "any sword that deals slashing damage": "Longsword",
  "any axe or sword": "Longsword",
  "any axe": "Battleaxe",
  any: "Longsword",
  "shortbow or longbow": "Longbow",
};
const ARMOR_DEFAULTS = {
  "medium or heavy": "Chain Mail",
  light: "Leather",
  plate: "Plate",
  shield: "Shield",
};
const titled = (text) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

export function categoryBase(category) {
  const match = /^(weapon|armor)\s*\((.+)\)\s*$/i.exec(String(category ?? "").trim());
  if (!match) {
    return null;
  }
  const kind = match[1].toLowerCase();
  const inner = match[2].trim().toLowerCase();
  if (kind === "weapon") {
    if (/arrow|ammunition|bolt/.test(inner)) {
      return null;
    }
    return { kind, name: WEAPON_DEFAULTS[inner] ?? titled(inner), any: inner in WEAPON_DEFAULTS ? inner : undefined };
  }
  return { kind, name: ARMOR_DEFAULTS[inner] ?? titled(inner), any: inner === "medium or heavy" || inner === "light" ? inner : undefined };
}
