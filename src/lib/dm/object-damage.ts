// Breaking things: the DMG's object table, a real attack roll against the
// object's armor class, and damage that stays on the object between blows.
//
// SRD 5.1 (Gamemastering, Objects): an object has an Armor Class by its
// material and hit points by its size; objects are immune to poison and
// psychic damage. Before this the tool took the model's damage, rolled no
// attack, and forgot every blow, so a door took whatever cumulative number
// the model remembered to pass.
//
// A named object keeps the damage it has taken on the campaign clock
// (`objects`), so a second blow on "the oak door" adds to the first.

import { z } from "zod";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import type { DmTurn } from "@/lib/db/dm-turns";
import { getClock, setClock } from "@/lib/db/clock";
import { insertRoll, type RollAttacker } from "@/lib/db/rolls";
import { rollAgainst, rollOn } from "@/lib/roll-labels";
import { getSheetById } from "@/lib/db/sheets";
import { isValidExpression, rollExpression, type RollResult } from "@/lib/dice";
import { publishWithSeq } from "@/lib/events";
import { critDamageExpression } from "@/lib/dm/encounter-logic";
import { buildAttackProfile } from "@/lib/dm/pc-attack-profile";
import { objectProfile, type ObjectMaterial, type ObjectSize } from "@/lib/srd/objects";
import { breakWallSection, sectionHit, wallSectionFor } from "@/lib/dm/zone-walls";

export const OBJECT_MATERIALS: ObjectMaterial[] = [
  "cloth", "paper", "rope", "crystal", "glass", "ice", "wood", "bone", "stone", "iron", "steel", "mithral", "adamantine",
];
export const OBJECT_SIZES: ObjectSize[] = ["tiny", "small", "medium", "large"];

const objectSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  material: z.enum(OBJECT_MATERIALS as [ObjectMaterial, ...ObjectMaterial[]]).optional(),
  size: z.enum(OBJECT_SIZES as [ObjectSize, ...ObjectSize[]]).optional(),
  fragile: z.coerce.boolean().optional(),
  damage: z.string().max(30).optional(),
  damageType: z.string().max(30).optional(),
  characterId: z.string().max(80).optional(),
  weapon: z.string().max(80).optional(),
  ac: z.coerce.number().int().min(1).max(30).optional(),
  hp: z.coerce.number().int().min(1).max(1000).optional(),
  reason: z.string().optional(),
});

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);

function publishRoll(campaign: Campaign, turn: DmTurn | null, characterId: string | null, kind: "attack" | "damage", detail: string, result: RollResult, attacker: RollAttacker | null) {
  const roll = insertRoll({ campaignId: campaign.id, characterId, requestedBy: "dm", kind, detail, result, attacker });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  turn?.rollIds.push(roll.id);
}

// Damage a named object has already taken.
export function objectDamageTaken(campaignId: string, name: string): number {
  return getClock(campaignId).objects?.[keyOf(name)] ?? 0;
}

function recordObjectDamage(campaignId: string, name: string, taken: number, broken: boolean) {
  const current = getClock(campaignId);
  const objects = { ...(current.objects ?? {}) };
  if (broken) {
    delete objects[keyOf(name)];
  } else {
    objects[keyOf(name)] = taken;
  }
  const kept = Object.entries(objects).slice(-40);
  setClock(campaignId, { ...current, objects: Object.fromEntries(kept) });
}

export function damageObject(
  campaign: Campaign | null,
  turn: DmTurn | null,
  rawArguments: string,
): Record<string, unknown> {
  let args: z.infer<typeof objectSchema>;
  try {
    args = objectSchema.parse(JSON.parse(rawArguments || "{}"));
  } catch {
    return { error: "Invalid arguments for damage_object." };
  }
  // A section of a Wall of Ice has its own numbers (src/lib/dm/zone-walls.ts).
  const section = campaign && args.name ? wallSectionFor(campaign.id, args.name) : null;
  if (section && "error" in section) {
    return section;
  }
  const profile = objectProfile(args.material ?? "wood", args.size ?? "medium", args.fragile);
  const ac = section?.ac ?? args.ac ?? profile.ac;
  const hp = section?.hp ?? args.hp ?? profile.hp;
  const already = campaign && args.name ? objectDamageTaken(campaign.id, args.name) : 0;

  let dealt: number | null = null;
  let type = (args.damageType ?? "").trim().toLowerCase();
  const notes: string[] = [];
  const sheet = args.characterId ? getSheetById(args.characterId) : null;
  if (args.characterId && (!sheet || (campaign && sheet.campaignId !== campaign.id))) {
    return { error: "Unknown characterId; use one from GAME STATE." };
  }
  if (sheet && campaign) {
    // The character's own attack, from their sheet: the roll has to beat the
    // object's AC before any damage lands.
    const built = buildAttackProfile(campaign.id, sheet, { weapon: args.weapon });
    if ("error" in built) {
      return { error: built.error };
    }
    const attack = rollExpression(`1d20${built.profile.toHit >= 0 ? "+" : ""}${built.profile.toHit}`);
    const striker: RollAttacker = { kind: "sheet", id: sheet.id, name: sheet.name };
    publishRoll(campaign, turn, sheet.id, "attack", rollAgainst(built.profile.weapon, args.name ?? "an object"), attack, striker);
    const natural = attack.natural ?? 0;
    const hit = natural !== 1 && (natural === 20 || attack.total >= ac);
    if (!hit) {
      return {
        ok: true,
        ac,
        hp,
        attack: attack.total,
        hit: false,
        ...(args.name ? { damageTaken: already } : {}),
        note: `The attack (${attack.total}) misses AC ${ac}; the object takes nothing.`,
      };
    }
    const expression = natural === 20 ? critDamageExpression(built.profile.damageExpression) : built.profile.damageExpression;
    const damage = rollExpression(expression);
    publishRoll(campaign, turn, sheet.id, "damage", rollAgainst(built.profile.weapon, args.name ?? "an object"), damage, striker);
    dealt = Math.max(0, damage.total);
    type = type || built.profile.damageType;
  } else if (args.damage) {
    if (/^-?\d+$/.test(args.damage.trim())) {
      dealt = Number(args.damage.trim());
    } else if (isValidExpression(args.damage)) {
      const rolled = rollExpression(args.damage);
      // Harm no character dealt (a hazard, a falling block): nobody's roll.
      if (campaign) {
        publishRoll(campaign, turn, null, "damage", rollOn(type || "damage", [args.name ?? "an object"]), rolled, null);
      }
      dealt = rolled.total;
    } else {
      return { error: `Invalid damage "${args.damage}".` };
    }
  }
  if (dealt !== null && /^(poison|psychic)$/.test(type)) {
    notes.push(`objects are immune to ${type} damage`);
    dealt = 0;
  }
  dealt = section && dealt ? sectionHit(section, dealt, type, notes) : dealt;
  const taken = already + (dealt ?? 0);
  const broken = dealt !== null && taken >= hp;
  if (campaign && args.name && dealt !== null) {
    recordObjectDamage(campaign.id, args.name, taken, broken);
  }
  if (campaign && section && broken) {
    notes.push(breakWallSection(campaign, section));
  }
  return {
    ok: true,
    ac,
    hp,
    ...(dealt !== null ? { damage: dealt, broken } : {}),
    ...(args.name ? { damageTaken: broken ? hp : taken, hpLeft: Math.max(0, hp - taken) } : {}),
    ...(notes.length ? { notes } : {}),
    note:
      dealt === null
        ? `That object has AC ${ac} and ${hp} HP; a hit needs to beat AC ${ac} and enough damage to matter.`
        : broken
          ? `${dealt} damage brings it to ${taken} of its ${hp} HP: it breaks. Narrate it giving way.`
          : `${dealt} damage holds (${taken} of ${hp} HP taken${args.name ? "; the server keeps the count for the next blow" : ""}).`,
  };
}
