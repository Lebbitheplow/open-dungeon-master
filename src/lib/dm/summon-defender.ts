// The Battle Smith's steel defender as an ally with its stat block
// (use_resource "Steel Defender"): AC 15 (17 with Improved Defender), hit
// points 2 + the artificer's Intelligence modifier + five times the
// artificer level, Force-Empowered Rend at the artificer's spell attack for
// 1d8 + the proficiency bonus force, acting right after the artificer.
// It is made at the end of a long rest, or rebuilt with the Mending spell or
// an action and a slot after the fight; one at a time.

import { randomUUID } from "node:crypto";
import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter } from "@/lib/db/encounters";
import { computeSheetDerived } from "@/lib/srd";
import { activeAuthored } from "@/lib/srd/authored-effects";
import type { SummonForm } from "@/lib/srd/summon-forms";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { summonRecord } from "@/lib/dm/summon-rules";
import { removeSummon, spawnSummons, summonsOf } from "@/lib/dm/summon-store";

export const STEEL_DEFENDER = "Steel Defender";

// The AC Improved Defender adds (authored effect `defender_upgrade`).
export function defenderUpgrade(sheet: Parameters<typeof activeAuthored>[0]): number {
  return activeAuthored(sheet, "defender_upgrade").reduce((sum, found) => sum + found.effect.ac, 0);
}

export function steelDefenderForm(sheet: CharacterSheet, artificerLevel: number): SummonForm {
  const derived = computeSheetDerived(sheet);
  const int = derived.abilityMods.int;
  const pb = derived.proficiencyBonus;
  return {
    name: STEEL_DEFENDER,
    type: "construct",
    size: "Medium",
    cr: 0,
    ac: 15 + defenderUpgrade(sheet),
    hp: Math.max(1, 2 + int + 5 * artificerLevel),
    speed: 40,
    abilities: { str: 14, dex: 12, con: 14, int: 4, wis: 10, cha: 6 },
    saves: ["dex", "con"],
    attacks: [{ name: "Force-Empowered Rend", toHit: derived.spellAttack ?? 2 + pb + int, damage: `1d8+${pb}`, type: "force" }],
    immune: "poison",
    conditionImmune: "charmed, exhaustion, poisoned",
    traits: `Vigilant (cannot be surprised). Deflect Attack: a reaction imposes disadvantage on an attack against a creature within 5 ft. of it${defenderUpgrade(sheet) ? ", and the attacker takes 1d4 + the artificer's Intelligence modifier force" : ""}. Repair (3/day): an action restores 2d8 + ${pb} hit points to itself or a construct. It acts after the artificer and takes the Dodge action unless commanded (a bonus action).`,
  };
}

// The spend: out of a fight, the defender is (re)built; a new one replaces
// the old.
export function summonSteelDefender(
  campaign: Campaign,
  sheet: CharacterSheet,
  artificerLevel: number,
): { error: string } | { result: Record<string, unknown> } {
  const encounter = getActiveEncounter(campaign.id);
  if (encounter && encounter.status === "active" && (encounter.kind ?? "fight") === "fight") {
    return { error: `${sheet.name}'s steel defender is built at the end of a long rest, or rebuilt after the fight; it cannot be made in the middle of one. Nothing was spent.` };
  }
  const replaced = summonsOf(campaign.id, sheet.id, STEEL_DEFENDER);
  for (const old of replaced) {
    removeSummon(campaign, old);
  }
  const form = steelDefenderForm(sheet, artificerLevel);
  const record = summonRecord(form, {
    spell: STEEL_DEFENDER,
    casterId: sheet.id,
    casterName: sheet.name,
    concentration: false,
    castId: randomUUID().slice(0, 8),
  });
  // Its saves and checks carry the artificer's proficiency bonus.
  const pbLevel = sheet.level;
  const [made] = spawnSummons(campaign, sheet, {
    form,
    count: 1,
    record,
    rounds: null,
    slotLevel: null,
    initiative: "caster",
    overrides: { level: pbLevel },
  });
  return {
    result: {
      summoned: made ? { characterId: made.id, name: made.name, hp: `${made.currentHp}/${made.maxHp}`, ac: made.ac } : null,
      creature: `${form.name}: ${form.hp} HP, AC ${form.ac}, speed 40 ft. Force-Empowered Rend +${form.attacks[0].toHit} (${form.attacks[0].damage} force).`,
      ...(replaced.length ? { replaced: "The old defender is gone; one at a time." } : {}),
      note: "The steel defender is an ally on the board, acting right after its artificer; it attacks with pc_attack under its own characterId.",
    },
  };
}
