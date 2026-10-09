import { spellMechanicsFor } from "@/lib/content";
import { armorInside, magicItemBonus, matchArmor, SRD_ARMOR, type SrdArmor } from "@/lib/srd/armor";
import { checkRidersOf } from "@/lib/srd/item-check-riders";
import { itemSpellsOf } from "@/lib/srd/item-spells";
import { gearBaseName, gearDefFor } from "@/lib/srd/magic-gear";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { matchWeapon, SRD_WEAPONS, type SrdWeapon } from "@/lib/srd/weapons";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

// What the engine runs for a published row, handed to the workshop's "start
// from" pickers (src/app/workshop/homebrew/CatalogStart.tsx) beside the row
// itself, so a copy begins with the mechanics and not just the words. A
// renamed copy otherwise lost everything the engine keys by the published
// name: Web's escape check (the authored and overridden spell blocks), a
// Flame Tongue's fire and its longsword (magic-gear.ts), a Ring of
// Protection's +1 (magic-items.ts), a Wand of Fireballs' charges and spell
// (item-spells.ts), a Stone of Good Luck's +1 to checks.
//
// Asked for with ?mechanics=1 on /api/content/<kind>; the builder's own
// searches never pay for it.

type Row = { name: string; source: string; kind?: string; data: Record<string, unknown> };

export function spellMechanicsOf(row: Row): SpellMech | null {
  if (row.source === "homebrew") {
    return null;
  }
  return spellMechanicsFor({ spell: row.name })?.mech ?? null;
}

const exactWeapon = (name: string): SrdWeapon | null =>
  SRD_WEAPONS.find((weapon) => weapon.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
const exactArmor = (name: string): SrdArmor | null =>
  SRD_ARMOR.find((armor) => armor.name.toLowerCase() === name.trim().toLowerCase()) ?? null;

// The fields a homebrew item's data blob takes (src/lib/homebrew/item-data.ts)
// for a published item, or null for one the engine reads nothing from.
export function itemMechanicsOf(row: Row): Record<string, unknown> | null {
  if (row.source === "homebrew") {
    return null;
  }
  const name = row.name;
  const worn = matchMagicItem(name);
  const named = matchWeapon(name);
  const def = gearDefFor(name, undefined, named?.name ?? matchArmor(name)?.name ?? null);
  const checks = checkRidersOf(name);
  const spells = itemSpellsOf(name);
  const magic = Boolean(worn || def || checks || spells.length || row.kind === "magic_item");
  const out: Record<string, unknown> = {};
  // The mundane block a magic weapon or suit is built on, or the item itself.
  // A name that ends in a weapon or a suit swings or is worn as that one
  // ("Anointing Mace", "Animated Chain Mail"), as the engine reads it.
  const weapon = def?.base?.kind === "weapon" ? (named ?? exactWeapon(gearBaseName(def, "weapon") ?? "")) : def?.base ? null : named;
  const inside = matchArmor(name) ?? armorInside(name);
  const armor =
    def?.base?.kind === "armor"
      ? (inside ?? exactArmor(gearBaseName(def, "armor") ?? ""))
      : def?.base || weapon
        ? null
        : magic && !def?.armor
          ? matchArmor(name)
          : inside;
  out.itemKind = magic ? "magic_item" : weapon ? "weapon" : armor ? "armor" : "gear";
  if (weapon) {
    out.weapon = weapon;
  }
  if (armor) {
    out.armor = armor;
    out.weight = armor.weightLb;
  }
  if (magic) {
    out.requiresAttunement = Boolean(worn?.requiresAttunement ?? def?.requiresAttunement ?? checks?.requiresAttunement);
    out.effects = worn?.effects ?? [];
    if (worn?.attunedBy) {
      out.attunedBy = worn.attunedBy;
    }
    if (worn?.carried || checks?.carried) {
      out.carried = true;
    }
  }
  // "+1" in a name is a bonus the engine reads off the name (armor.ts
  // magicItemBonus); a renamed copy carries it as a rider instead.
  const nameBonus = magicItemBonus(name);
  const weaponRiders = { ...(def?.weapon ?? {}), ...(weapon && nameBonus > (def?.weapon?.bonus ?? 0) ? { bonus: nameBonus } : {}) };
  const armorRiders = { ...(def?.armor ?? {}), ...(armor && nameBonus > (def?.armor?.bonus ?? 0) ? { bonus: nameBonus } : {}) };
  if (Object.keys(weaponRiders).length) {
    out.weaponRiders = weaponRiders;
  }
  if (Object.keys(armorRiders).length) {
    out.armorRiders = armorRiders;
  }
  if (def?.charges) {
    out.charges = def.charges;
  }
  if (def?.cursed) {
    out.cursed = true;
  }
  if (checks && (checks.bonus || checks.skillBonus || checks.advantage)) {
    out.checks = {
      ...(checks.bonus ? { bonus: checks.bonus } : {}),
      ...(checks.skillBonus ? { skillBonus: checks.skillBonus } : {}),
      ...(checks.advantage ? { advantage: checks.advantage } : {}),
    };
  }
  if (spells.length) {
    out.spells = spells;
  }
  return out.itemKind === "gear" && !magic ? null : out;
}

export function withMechanics(kind: string, results: unknown[]): unknown[] {
  if (kind === "spells") {
    return results.map((row) => {
      const mech = spellMechanicsOf(row as Row);
      return mech ? { ...(row as Row), mech } : row;
    });
  }
  if (kind === "items") {
    return results.map((row) => {
      const gear = itemMechanicsOf(row as Row);
      return gear ? { ...(row as Row), gear } : row;
    });
  }
  return results;
}
