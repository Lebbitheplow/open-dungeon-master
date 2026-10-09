import type { SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import { clamp, num, text, type Raw } from "@/lib/homebrew/coerce";
import { normalizeRaceData } from "@/lib/homebrew/race-data";
import { normalizeBackgroundData } from "@/lib/homebrew/background-data";
import { GEAR_LIMITS, normalizeItemData, type HomebrewData, type Outcome } from "@/lib/homebrew/item-data";
import { checkSpellMech } from "@/lib/homebrew/spell-mech-schema";
import { engineFeatNamed } from "@/lib/srd/feat-effects";
import type { HomebrewKind } from "@/lib/schemas/homebrew";

// What a homebrew entry means to the engine.
//
// homebrew_entries has always been a loose blob the pickers could search and
// nothing else could read. This module is the other half: the structured
// fields an item, a spell or a character option carries so the same engines
// that run SRD gear run it too, and the one place those fields are checked.
//
// A weapon here is an SrdWeapon, an armour an SrdArmor, a magic item's
// effects the same MagicItemEffect vocabulary magic-items.json uses. No
// second vocabulary on purpose: the armour engine, the attack profile and
// the rider aggregator all read the SRD shapes and never learn a new one.
//
// The snapshot (HomebrewGear) rides on the equipment line of a sheet, in the
// same way a monster's stat block is snapshotted into stat_json when a fight
// starts, and is refreshed from the entry whenever the sheet is read
// (src/lib/db/sheets.ts). So the pure engines take no user id, and an
// item edited in the workshop reaches every sheet that carries it.
//
// Pure by design: no DB and no I/O, so scripts/test-homebrew-gear.mjs drives
// it directly. Items live in item-data.ts and are re-exported here.

export * from "@/lib/homebrew/item-data";

// ---- spells ----

// The whole block (src/lib/homebrew/spell-mech-schema.ts), or null when
// there is none or it does not hold together. Stored rows were checked when
// they were written, so a read only ever drops a row nothing could run.
export function normalizeSpellMech(raw: unknown): SpellMech | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const checked = checkSpellMech(raw);
  return "mech" in checked ? checked.mech : null;
}

export function normalizeSpellData(raw: unknown): Outcome<HomebrewData> {
  const source = (raw ?? {}) as Raw;
  const data: HomebrewData = {
    desc: text(source.desc, GEAR_LIMITS.descMax),
    higher_level: text(source.higher_level, 2_000),
    level: clamp(source.level, 0, 9, 1),
    school: text(source.school, 40).toLowerCase(),
    classes: Array.isArray(source.classes)
      ? [...new Set(source.classes.map((c) => String(c).trim().toLowerCase()).filter(Boolean))].slice(0, 20)
      : [],
    ritual: source.ritual === true,
    concentration: source.concentration === true,
    casting_time: text(source.casting_time, 60) || "1 action",
    range: text(source.range, 60) || "60 feet",
    components: text(source.components, 120) || "V, S",
    duration: text(source.duration, 60) || "Instantaneous",
  };
  if (!data.desc) {
    return { error: "A spell needs a description; the engine reads its damage and save out of it." };
  }
  const block = source.mech as Raw | undefined;
  if (block && typeof block === "object" && block.resolution) {
    const checked = checkSpellMech(block);
    if ("error" in checked) {
      return checked;
    }
    if (checked.mech.resolution === "save" && !checked.mech.save) {
      return { error: "A spell that calls for a save has to say which ability saves." };
    }
    data.mech = checked.mech;
  }
  return { data };
}

// ---- character options ----

function normalizeOptionData(raw: unknown, kind: HomebrewKind): HomebrewData {
  const source = (raw ?? {}) as Raw;
  const data: HomebrewData = { desc: text(source.desc, GEAR_LIMITS.descMax) };
  switch (kind) {
    case "feat": {
      data.prerequisite = text(source.prerequisite, 200);
      // The published feat it runs as, by the name the engines know it by.
      const runsAs = engineFeatNamed(text(source.runsAs, 80));
      if (runsAs) data.runsAs = runsAs;
      break;
    }
    case "background":
      normalizeBackgroundData(source, data);
      break;
    case "race":
      normalizeRaceData(source, data);
      break;
    case "archetype": {
      data.classSlug = text(source.classSlug, 60).toLowerCase();
      const levels: Record<string, Array<{ n: string; d: string }>> = {};
      const rawLevels = (source.levels ?? {}) as Raw;
      for (const [level, features] of Object.entries(rawLevels)) {
        // A level outside the game is dropped, not pulled to 20.
        const at = num(level);
        if (at === null || at < 1 || at > 20 || !Array.isArray(features)) {
          continue;
        }
        const rows = features
          .map((feature) => {
            const row = (feature ?? {}) as Raw;
            return { n: text(row.n, 80), d: text(row.d, 1_500) };
          })
          .filter((feature) => feature.n)
          .slice(0, 8);
        if (rows.length) {
          levels[String(at)] = rows;
        }
      }
      data.levels = levels;
      // Always-prepared spells by class level (a domain's, an oath's), the
      // same shape the bundled tables give theirs.
      const spells: Record<string, string[]> = {};
      for (const [level, names] of Object.entries((source.spells ?? {}) as Raw)) {
        const at = num(level);
        const list = Array.isArray(names) ? [...new Set(names.map((name) => text(name, 60)).filter(Boolean))].slice(0, 6) : [];
        if (at !== null && at >= 1 && at <= 20 && list.length) {
          spells[String(at)] = list;
        }
      }
      if (Object.keys(spells).length) {
        data.spells = spells;
      }
      break;
    }
    default:
      break;
  }
  return data;
}

// Every kind through one door, so the route and the editor agree on what a
// stored entry looks like. Unknown keys are dropped: the blob used to be
// loose, and a shape nothing reads is a shape nothing can validate.
export function normalizeHomebrewData(
  kind: HomebrewKind,
  raw: unknown,
  name: string,
): Outcome<HomebrewData> {
  switch (kind) {
    case "item":
      return normalizeItemData(raw, name);
    case "spell":
      return normalizeSpellData(raw);
    case "monster": {
      // The bestiary owns monsters (src/lib/bestiary/monster-draft.ts).
      const source = (raw ?? {}) as Raw;
      return { data: { ...source, desc: text(source.desc, GEAR_LIMITS.descMax) } };
    }
    default:
      return { data: normalizeOptionData(raw, kind) };
  }
}

// One line for a row in a list: "martial melee, 1d8 slashing, versatile".
export function describeHomebrew(kind: HomebrewKind, data: Raw): string {
  if (kind === "item") {
    const weapon = data.weapon as SrdWeapon | undefined;
    const armor = data.armor as SrdArmor | undefined;
    const effects = (data.effects as MagicItemEffect[] | undefined) ?? [];
    const parts: string[] = [];
    if (weapon) {
      parts.push(`${weapon.category} ${weapon.kind}`, weapon.damage, ...(weapon.properties ?? []));
    }
    if (armor) {
      parts.push(
        armor.category === "shield" ? `shield +${armor.baseAc}` : `${armor.category} armour, AC ${armor.baseAc}`,
      );
    }
    const weaponRiders = (data.weaponRiders ?? {}) as { bonus?: number; extra?: Array<{ dice: string; type: string }> };
    if (weaponRiders.bonus) {
      parts.push(`+${weaponRiders.bonus} to hit and damage`);
    }
    for (const extra of weaponRiders.extra ?? []) {
      parts.push(`+${extra.dice} ${extra.type === "weapon" ? "damage" : extra.type}`);
    }
    const armorBonus = (data.armorRiders as { bonus?: number } | undefined)?.bonus;
    if (armorBonus) {
      parts.push(`+${armorBonus} AC`);
    }
    for (const effect of effects) {
      parts.push(describeEffect(effect));
    }
    const charges = data.charges as { max?: number | string } | undefined;
    if (charges?.max) {
      parts.push(`${charges.max} charges`);
    }
    const spells = Array.isArray(data.spells) ? (data.spells as Array<{ spell: string }>) : [];
    if (spells.length) {
      parts.push(`casts ${spells.map((entry) => entry.spell).join(", ")}`);
    }
    if (data.requiresAttunement) {
      parts.push("attunement");
    }
    if (data.cursed) {
      parts.push("cursed");
    }
    if (typeof data.rarity === "string" && data.rarity) {
      parts.push(String(data.rarity));
    }
    return parts.join(", ") || String(data.itemKind ?? "gear");
  }
  if (kind === "spell") {
    const level = Number(data.level ?? 0);
    const mech = data.mech as SpellMech | undefined;
    return [
      level === 0 ? "cantrip" : `level ${level}`,
      String(data.school ?? ""),
      mech ? mech.resolution : "",
      data.concentration ? "concentration" : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (kind === "archetype") {
    const levels = Object.keys((data.levels as Raw | undefined) ?? {});
    return [String(data.classSlug ?? ""), levels.length ? `${levels.length} feature levels` : ""]
      .filter(Boolean)
      .join(", ");
  }
  if (kind === "race") {
    return [String(data.size ?? ""), `speed ${(data.speed as Raw | undefined)?.walk ?? 30}`].join(", ");
  }
  if (kind === "background") {
    return String(data.skill_proficiencies ?? "");
  }
  if (kind === "feat") {
    return data.prerequisite ? `needs ${String(data.prerequisite)}` : "";
  }
  return "";
}

export function describeEffect(effect: MagicItemEffect): string {
  switch (effect.kind) {
    case "ac_bonus":
      return `AC ${effect.amount >= 0 ? "+" : ""}${effect.amount}`;
    case "ac_unarmored":
      return `AC ${effect.amount >= 0 ? "+" : ""}${effect.amount} unarmoured`;
    case "save_bonus":
      return `saves ${effect.amount >= 0 ? "+" : ""}${effect.amount}`;
    case "set_ability":
      return `${effect.ability.toUpperCase()} becomes ${effect.score}`;
    case "resistance":
      return `resists ${effect.types.join(", ")}`;
  }
}
