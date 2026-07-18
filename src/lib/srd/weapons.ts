// SRD 5.1 weapon table plus pure helpers that turn class weapon-proficiency
// terms (["simple","martial"] or specific names like "longswords") into
// starting-weapon picks and suggestion lists for the character builder.
// Alias-free on purpose so test scripts can import it directly.

export type SrdWeapon = {
  name: string;
  category: "simple" | "martial";
  kind: "melee" | "ranged";
  damage: string;
};

export const SRD_WEAPONS: SrdWeapon[] = [
  { name: "Club", category: "simple", kind: "melee", damage: "1d4 bludgeoning" },
  { name: "Dagger", category: "simple", kind: "melee", damage: "1d4 piercing" },
  { name: "Greatclub", category: "simple", kind: "melee", damage: "1d8 bludgeoning" },
  { name: "Handaxe", category: "simple", kind: "melee", damage: "1d6 slashing" },
  { name: "Javelin", category: "simple", kind: "melee", damage: "1d6 piercing" },
  { name: "Light Hammer", category: "simple", kind: "melee", damage: "1d4 bludgeoning" },
  { name: "Mace", category: "simple", kind: "melee", damage: "1d6 bludgeoning" },
  { name: "Quarterstaff", category: "simple", kind: "melee", damage: "1d6 bludgeoning" },
  { name: "Sickle", category: "simple", kind: "melee", damage: "1d4 slashing" },
  { name: "Spear", category: "simple", kind: "melee", damage: "1d6 piercing" },
  { name: "Light Crossbow", category: "simple", kind: "ranged", damage: "1d8 piercing" },
  { name: "Dart", category: "simple", kind: "ranged", damage: "1d4 piercing" },
  { name: "Shortbow", category: "simple", kind: "ranged", damage: "1d6 piercing" },
  { name: "Sling", category: "simple", kind: "ranged", damage: "1d4 bludgeoning" },
  { name: "Battleaxe", category: "martial", kind: "melee", damage: "1d8 slashing" },
  { name: "Flail", category: "martial", kind: "melee", damage: "1d8 bludgeoning" },
  { name: "Glaive", category: "martial", kind: "melee", damage: "1d10 slashing" },
  { name: "Greataxe", category: "martial", kind: "melee", damage: "1d12 slashing" },
  { name: "Greatsword", category: "martial", kind: "melee", damage: "2d6 slashing" },
  { name: "Halberd", category: "martial", kind: "melee", damage: "1d10 slashing" },
  { name: "Lance", category: "martial", kind: "melee", damage: "1d12 piercing" },
  { name: "Longsword", category: "martial", kind: "melee", damage: "1d8 slashing" },
  { name: "Maul", category: "martial", kind: "melee", damage: "2d6 bludgeoning" },
  { name: "Morningstar", category: "martial", kind: "melee", damage: "1d8 piercing" },
  { name: "Pike", category: "martial", kind: "melee", damage: "1d10 piercing" },
  { name: "Rapier", category: "martial", kind: "melee", damage: "1d8 piercing" },
  { name: "Scimitar", category: "martial", kind: "melee", damage: "1d6 slashing" },
  { name: "Shortsword", category: "martial", kind: "melee", damage: "1d6 piercing" },
  { name: "Trident", category: "martial", kind: "melee", damage: "1d6 piercing" },
  { name: "War Pick", category: "martial", kind: "melee", damage: "1d8 piercing" },
  { name: "Warhammer", category: "martial", kind: "melee", damage: "1d8 bludgeoning" },
  { name: "Whip", category: "martial", kind: "melee", damage: "1d4 slashing" },
  { name: "Blowgun", category: "martial", kind: "ranged", damage: "1 piercing" },
  { name: "Hand Crossbow", category: "martial", kind: "ranged", damage: "1d6 piercing" },
  { name: "Heavy Crossbow", category: "martial", kind: "ranged", damage: "1d10 piercing" },
  { name: "Longbow", category: "martial", kind: "ranged", damage: "1d8 piercing" },
  { name: "Net", category: "martial", kind: "ranged", damage: "0 (restrains)" },
];

// Curated shortlists so category proficiencies suggest familiar picks
// instead of the whole table.
const SIMPLE_SHORTLIST = ["Quarterstaff", "Spear", "Mace", "Dagger", "Light Crossbow", "Shortbow"];
const MARTIAL_SHORTLIST = ["Longsword", "Greatsword", "Battleaxe", "Rapier", "Shortsword", "Longbow"];

const byName = new Map(SRD_WEAPONS.map((weapon) => [normalize(weapon.name), weapon]));

// "Longswords" / "quarterstaffs" / "Hand crossbows" -> canonical lookup key.
function normalize(term: string) {
  return term.trim().toLowerCase().replace(/s$/, "");
}

function parseProfs(weaponProfs: string[]) {
  let simple = false;
  let martial = false;
  const specific: SrdWeapon[] = [];
  const seen = new Set<string>();
  for (const raw of weaponProfs) {
    const term = raw.trim().toLowerCase();
    if (!term) {
      continue;
    }
    if (term.includes("simple")) {
      simple = true;
      continue;
    }
    if (term.includes("martial")) {
      martial = true;
      continue;
    }
    const weapon = byName.get(normalize(term));
    if (weapon && !seen.has(weapon.name)) {
      seen.add(weapon.name);
      specific.push(weapon);
    }
  }
  return { simple, martial, specific };
}

// Average roll of "XdY ..." for ranking picks; flat numbers pass through.
function damageScore(weapon: SrdWeapon) {
  const dice = weapon.damage.match(/^(\d+)d(\d+)/);
  if (dice) {
    return (Number(dice[1]) * (Number(dice[2]) + 1)) / 2;
  }
  const flat = weapon.damage.match(/^(\d+)/);
  return flat ? Number(flat[1]) : 0;
}

// Later entries win ties so finesse-flavored lists (bard/rogue) land on the
// rapier rather than the longsword.
function bestOf(weapons: SrdWeapon[]) {
  let best: SrdWeapon | undefined;
  for (const weapon of weapons) {
    if (!best || damageScore(weapon) >= damageScore(best)) {
      best = weapon;
    }
  }
  return best;
}

function get(name: string) {
  const weapon = byName.get(normalize(name));
  if (!weapon) {
    throw new Error(`Unknown SRD weapon: ${name}`);
  }
  return weapon;
}

// One melee and one ranged starting weapon for the class, or [] when the
// proficiency list implies none.
export function defaultLoadout(weaponProfs: string[]): SrdWeapon[] {
  const { simple, martial, specific } = parseProfs(weaponProfs);
  if (!simple && !martial && !specific.length) {
    return [];
  }
  const melee = martial
    ? get("Longsword")
    : (bestOf(specific.filter((weapon) => weapon.kind === "melee")) ??
      (simple ? get("Mace") : undefined));
  const ranged = martial
    ? get("Longbow")
    : (bestOf(specific.filter((weapon) => weapon.kind === "ranged")) ??
      (simple ? get("Light Crossbow") : undefined));
  const loadout: SrdWeapon[] = [];
  if (melee) {
    loadout.push(melee);
  }
  if (ranged && ranged !== melee) {
    loadout.push(ranged);
  }
  return loadout;
}

// Proficient weapons worth offering as one-click adds: specific
// proficiencies first, then the martial and simple shortlists.
export function suggestWeapons(weaponProfs: string[], limit = 8): SrdWeapon[] {
  const { simple, martial, specific } = parseProfs(weaponProfs);
  const out: SrdWeapon[] = [];
  const seen = new Set<string>();
  const push = (weapon: SrdWeapon) => {
    if (!seen.has(weapon.name) && out.length < limit) {
      seen.add(weapon.name);
      out.push(weapon);
    }
  };
  for (const weapon of specific) {
    push(weapon);
  }
  if (martial) {
    for (const name of MARTIAL_SHORTLIST) {
      push(get(name));
    }
  }
  if (simple) {
    for (const name of SIMPLE_SHORTLIST) {
      push(get(name));
    }
  }
  return out;
}
