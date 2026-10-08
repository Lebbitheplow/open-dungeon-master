// What the combat feats do at the table, read from sheet.feats (issue #125:
// Great Weapon Master, Sharpshooter, Spell Sniper, Elemental Adept, Gunner,
// Crossbow Expert's shot in melee, Mage Slayer, Defensive Duelist, Dungeon
// Delver were words on the sheet and nothing more). Pure: the attack and
// cast engines ask these and apply the answers.
import { holdsFeat } from "@/lib/srd/feat-effects";
import { SRD_WEAPONS } from "@/lib/srd/weapons";

type FeatHolder = { feats?: string[]; features?: Array<{ name: string }> };
type ChoiceHolder = FeatHolder & { featChoices?: Record<string, { damageType?: string } | undefined> | null };

// The once-per-turn key a melee crit or kill leaves on the budget, which
// lets Great Weapon Master's bonus-action attack through (pc-attack-options.ts).
export const GREAT_WEAPON_MASTER_READY = "great weapon master";

export const ELEMENTAL_ADEPT_TYPES = ["acid", "cold", "fire", "lightning", "thunder"];

// ---- the power attack: -5 to hit, +10 damage ----

// Which feat lets this attack trade accuracy for damage, or why none does.
// Great Weapon Master: a heavy melee weapon the character is proficient
// with. Sharpshooter: a ranged weapon.
export function powerAttackFeat(
  sheet: FeatHolder,
  attack: { weaponAttack: boolean; ranged: boolean; heavy: boolean; proficient: boolean },
): { feat: string } | { refused: string } {
  const gwm = holdsFeat(sheet, "Great Weapon Master");
  const sharp = holdsFeat(sheet, "Sharpshooter");
  if (!gwm && !sharp) {
    return { refused: "the -5/+10 trade belongs to Great Weapon Master (a heavy melee weapon) and Sharpshooter (a ranged weapon), and this character has neither." };
  }
  if (!attack.weaponAttack) {
    return { refused: "the -5/+10 trade is for weapon attacks; a spell attack cannot take it." };
  }
  if (attack.ranged) {
    return sharp ? { feat: "Sharpshooter" } : { refused: "Great Weapon Master's trade is for melee attacks with a heavy weapon; a ranged attack needs Sharpshooter." };
  }
  if (!gwm) {
    return { refused: "Sharpshooter's trade is for ranged weapon attacks; a melee attack needs Great Weapon Master." };
  }
  if (!attack.heavy || !attack.proficient) {
    return { refused: "Great Weapon Master's trade needs a heavy melee weapon the character is proficient with." };
  }
  return { feat: "Great Weapon Master" };
}

export const POWER_ATTACK_TO_HIT = -5;
export const POWER_ATTACK_DAMAGE = 10;

// ---- range, cover and loading ----

// Sharpshooter: no disadvantage at long range, and half or three-quarters
// cover is no cover, on ranged weapon attacks.
export function shotIgnoresLongRange(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Sharpshooter");
}

export function shotIgnoresCover(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Sharpshooter");
}

// Spell Sniper: an attack-roll spell's range doubles and it ignores half
// and three-quarters cover.
export function spellIgnoresCover(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Spell Sniper");
}

export function spellRangeFactor(sheet: FeatHolder): number {
  return holdsFeat(sheet, "Spell Sniper") ? 2 : 1;
}

// Crossbow Expert and Gunner: a hostile creature within 5 feet imposes no
// disadvantage on ranged attack rolls, and the loading property is ignored.
export function shootsFreelyInMelee(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Crossbow Expert") || holdsFeat(sheet, "Gunner");
}

// ---- Elemental Adept ----

// The feature a feat's damage-type pick is written as on the sheet
// ("Elemental Adept: fire"), the way a draconic ancestry or a Spell Mastery
// pick is: the table's copy of a sheet keeps no featChoices.
const ELEMENT_FEATURE = /^elemental adept:\s*(acid|cold|fire|lightning|thunder)$/i;

export function elementalAdeptFeatureName(damageType: string): string {
  return `Elemental Adept: ${damageType.trim().toLowerCase()}`;
}

export function elementalAdeptFeatureOf(featureName: string): string | null {
  return ELEMENT_FEATURE.exec(featureName.trim())?.[1]?.toLowerCase() ?? null;
}

// The damage type the character's Elemental Adept names, or null: from the
// feature the sheet holds, or from the builder's picks before the sheet is
// made.
export function elementalAdeptType(sheet: ChoiceHolder): string | null {
  if (!holdsFeat(sheet, "Elemental Adept")) {
    return null;
  }
  for (const feature of sheet.features ?? []) {
    const element = elementalAdeptFeatureOf(feature.name);
    if (element) {
      return element;
    }
  }
  const picked = (sheet.featChoices?.["elemental adept"]?.damageType ?? "").trim().toLowerCase();
  return ELEMENTAL_ADEPT_TYPES.includes(picked) ? picked : null;
}

// Whether a spell's damage of this type gets the feat: resistance ignored
// and every 1 on its dice counted as a 2.
export function elementalAdeptApplies(sheet: ChoiceHolder, damageType: string | null | undefined): boolean {
  const adept = elementalAdeptType(sheet);
  return Boolean(adept && damageType && damageType.trim().toLowerCase() === adept);
}

// The dice expression with a floor of 2 on every die ("8d6+2" to
// "8d6f2+2"); a term that already carries a floor keeps the higher.
export function floorDamageDice(expression: string): string {
  return expression
    .split(/(?=[+-])/)
    .map((term) => {
      const match = /^([+-]?\d{1,3}d\d{1,3}(?:k[hl]\d{1,3})?(?:r\d{1,3})?)(?:f(\d{1,3}))?$/i.exec(term.trim());
      if (!match) {
        return term;
      }
      const floor = Math.max(2, Number(match[2] ?? 0));
      return `${match[1]}f${floor}`;
    })
    .join("");
}

// ---- reactions and traps ----

export function hasMageSlayer(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Mage Slayer");
}

export function hasDungeonDelver(sheet: FeatHolder): boolean {
  return holdsFeat(sheet, "Dungeon Delver");
}

// Dungeon Delver: advantage to notice secret doors and traps, read from
// what the hidden thing is said to be.
export function dungeonDelverNotices(sheet: FeatHolder, about: string | undefined): boolean {
  return hasDungeonDelver(sheet) && /\btraps?\b|\b(?:secret|hidden|concealed) (?:door|passage|panel|compartment)s?\b/i.test(about ?? "");
}

// Defensive Duelist: wielding a finesse weapon the character is proficient
// with, the reaction adds the proficiency bonus to AC against one melee
// attack that hit. Null when the feat or the weapon is missing.
export function defensiveDuelistBonus(
  sheet: FeatHolder & { equipment?: Array<{ name: string; equipped?: boolean }>; proficiencies?: { weapons: string[] } },
  proficiencyBonus: number,
): number | null {
  if (!holdsFeat(sheet, "Defensive Duelist")) {
    return null;
  }
  const lower = (value: string) => value.trim().toLowerCase();
  const wielded = (sheet.equipment ?? []).some((item) => {
    if (item.equipped !== true) {
      return false;
    }
    const weapon = SRD_WEAPONS.find((entry) => lower(item.name).includes(lower(entry.name)));
    return Boolean(weapon?.properties?.includes("finesse"));
  });
  return wielded ? proficiencyBonus : null;
}

// The one-word tag the DM prompt hangs on a feat the server applies, so
// the model routes it through the right tool instead of narrating it.
export function featEngineTag(feat: string): string | null {
  const name = feat.trim().toLowerCase();
  if (name === "great weapon master" || name === "sharpshooter") return "[pc_attack powerAttack]";
  if (name === "defensive duelist" || name === "mage slayer") return "[use_reaction]";
  if (["spell sniper", "elemental adept", "gunner", "crossbow expert", "dungeon delver", "war caster", "tough", "mobile", "heavy armor master", "alert", "observant", "lucky", "dual wielder", "resilient"].includes(name)) return "[server]";
  if (["fey touched", "shadow touched", "magic initiate", "ritual caster"].includes(name)) return "[cast tools]";
  return null;
}
