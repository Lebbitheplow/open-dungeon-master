// What drinking a potion or reading a scroll does, beyond a healing potion's
// dice (src/lib/dm/item-logic.ts): the SRD potions mapped onto the engines
// that already hold the effect, and the spell scroll's rules. use_item asks
// consumableRefusal before anything is spent and applyConsumable once the
// item is used up (src/lib/dm/mutations.ts).
//
// SRD 5.1, Potions: Heroism, 10 temporary hit points and the bless spell for
// an hour; Giant Strength, the Strength score of the giant for an hour;
// Invisibility, invisible for an hour; Resistance, resistance to one damage
// type for an hour; Speed, the haste spell for a minute; Growth and
// Diminution, enlarge or reduce for 1d4 hours; Vitality, all exhaustion gone
// and cured of disease and poison; Poison, 3d6 poison and a DC 13
// Constitution save against being poisoned for an hour.
// Spell Scroll: a spell on your class's list can be read; one of a higher
// level than you can cast needs an ability check with your spellcasting
// ability, DC 10 + the spell's level, and a failure wastes the scroll; a
// spell off your list is unintelligible.

import { coatWithPoison, poisonCoatRefusal } from "@/lib/dm/attack-onhit";
import type { Campaign } from "@/lib/db/campaigns";
import { allocateSeq } from "@/lib/db/campaigns";
import { insertRoll } from "@/lib/db/rolls";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import { removeConditions } from "@/lib/dm/condition-logic";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import { applyPcDamage } from "@/lib/dm/pc-damage";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import { handleSetCondition } from "@/lib/dm/set-condition";
import { checklistSpell } from "@/lib/srd/spell-lists";
import { recordItemCast } from "@/lib/srd/item-cast-credit";
import { afflictCondition, afflictionConditionsFor } from "@/lib/dm/afflictions";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { rollCard } from "@/lib/dm/roll-card";

const GIANTS: Record<string, number> = { hill: 21, frost: 23, stone: 23, fire: 25, cloud: 27, storm: 29 };
const DAMAGE_TYPES = ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"];

type PotionPlan =
  | { kind: "vitality" }
  | { kind: "heroism" }
  | { kind: "giant"; score: number }
  // `hoursDice`: the duration is rolled when the potion is drunk, as a card.
  | { kind: "condition"; condition: string; minutes: number; hoursDice?: string }
  | { kind: "poison" }
  | { kind: "narrated" };

// What a potion's name says it does, or null for anything that is not one
// the engine maps (a healing potion keeps its own path).
export function potionPlan(name: string): PotionPlan | null {
  const lowered = name.toLowerCase();
  if (!/\b(potion|elixir|philter|oil)\b/.test(lowered)) {
    return null;
  }
  if (/vitality|elixir of health/.test(lowered)) {
    return { kind: "vitality" };
  }
  if (/heroism/.test(lowered)) {
    return { kind: "heroism" };
  }
  const giant = /(hill|frost|stone|fire|cloud|storm) giant strength/.exec(lowered);
  if (giant) {
    return { kind: "giant", score: GIANTS[giant[1]] };
  }
  if (/invisibility/.test(lowered)) {
    return { kind: "condition", condition: "invisible", minutes: 60 };
  }
  if (/\bspeed\b/.test(lowered)) {
    return { kind: "condition", condition: "hasted", minutes: 1 };
  }
  if (/growth/.test(lowered)) {
    return { kind: "condition", condition: "enlarged", minutes: 0, hoursDice: "1d4" };
  }
  if (/diminution/.test(lowered)) {
    return { kind: "condition", condition: "reduced", minutes: 0, hoursDice: "1d4" };
  }
  const resisted = DAMAGE_TYPES.find((type) => lowered.includes(type));
  if (/resistance/.test(lowered) && resisted) {
    // The engine's timed resistance to one type (paramResistance).
    return { kind: "condition", condition: `protection from energy (${resisted})`, minutes: 60 };
  }
  if (/potion of poison/.test(lowered)) {
    return { kind: "poison" };
  }
  return /potion/.test(lowered) ? { kind: "narrated" } : null;
}

// The spell a scroll holds: "Spell Scroll (Fireball)", "Scroll of Fireball".
export function scrollSpell(name: string): string | null {
  const match = /spell scroll\s*\(([^)]+)\)/i.exec(name) ?? /^scroll of (.+)$/i.exec(name.trim());
  return match ? match[1].trim() : null;
}

// SRD 5.1 Spell Scroll table: the save DC and attack bonus by spell level.
export function scrollNumbers(level: number): { saveDc: number; attackBonus: number } {
  if (level <= 2) return { saveDc: 13, attackBonus: 5 };
  if (level <= 4) return { saveDc: 15, attackBonus: 7 };
  if (level <= 6) return { saveDc: 17, attackBonus: 9 };
  if (level <= 8) return { saveDc: 18, attackBonus: 10 };
  return { saveDc: 19, attackBonus: 11 };
}

function classSlugs(sheet: CharacterSheet): string[] {
  const ids = sheet.classes?.length ? sheet.classes.map((entry) => entry.id) : [sheet.class];
  return ids.map((id) => id.trim().toLowerCase());
}

// The highest spell level this character can cast with a slot.
function highestSlotLevel(sheet: CharacterSheet): number {
  const slots = sheet.spellcasting?.slots ?? {};
  const fromSlots = Object.entries(slots)
    .filter(([, slot]) => slot.max > 0)
    .map(([level]) => Number(level));
  const pact = (sheet.spellcasting as { pact?: { level?: number } } | null)?.pact?.level ?? 0;
  return Math.max(0, pact, ...fromSlots);
}

// A refusal that must come before the item is spent: a scroll whose spell
// is not on the reader's class list cannot be read, and stays in the pack.
export function consumableRefusal(sheet: CharacterSheet, itemName: string): string | null {
  // A vial of basic poison needs a weapon to coat (src/lib/dm/attack-onhit.ts).
  const coat = poisonCoatRefusal(sheet, itemName);
  if (coat) {
    return coat;
  }
  const spell = scrollSpell(itemName);
  if (!spell) {
    return null;
  }
  const known = checklistSpell(spell);
  if (!known) {
    return null;
  }
  if (!sheet.spellcasting || !known.classes.some((slug) => classSlugs(sheet).includes(slug))) {
    return `${known.name} is not on ${sheet.name}'s class spell list, so the scroll is unintelligible to them; it stays in the pack for someone who can read it.`;
  }
  // A scroll above what they can cast needs a spellcasting ability check.
  // One that cannot be made at all (no spellcasting ability on the sheet)
  // leaves the scroll unread and whole, rather than spent on a check of 0.
  if (known.level > highestSlotLevel(sheet)) {
    const resolved = resolveRollExpression(
      { kind: "ability_check", ability: sheet.spellcasting.ability, dc: 10 + known.level } as unknown as RollArgs,
      sheet,
    );
    if ("error" in resolved) {
      return `${sheet.name} cannot make the spellcasting ability check a scroll of ${known.name} needs (${resolved.error}); the scroll stays in the pack.`;
    }
  }
  return null;
}

function condition(campaign: Campaign, turnId: string, target: CharacterSheet, name: string, minutes: number, reason: string) {
  const fresh = getSheetById(target.id) ?? target;
  return handleSetCondition(campaign, turnId, fresh, { condition: name, minutes: Math.min(1440, minutes) }, reason, {
    spellEffect: { source: "item" },
  });
}

function write(campaign: Campaign, sheet: CharacterSheet, patch: Parameters<typeof patchSheet>[1]) {
  const updated = patchSheet(sheet.id, patch);
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// The effect of a potion or scroll just used up, applied to its target.
// Returns what to add to use_item's result, or null when the engine holds
// nothing beyond the item being spent.
export function applyConsumable(
  campaign: Campaign,
  turnId: string,
  user: CharacterSheet,
  target: CharacterSheet,
  itemName: string,
): Record<string, unknown> | null {
  const reason = itemName;
  const spell = scrollSpell(itemName);
  if (spell) {
    return readScroll(campaign, turnId, user, spell);
  }
  const coated = coatWithPoison(campaign, user, itemName);
  if (coated) {
    return coated;
  }
  // Eyebright ointment on the eyes before a long rest keeps sight rot from
  // worsening; three doses cure it (src/lib/dm/afflictions.ts).
  if (/\beyebright\b/i.test(itemName)) {
    afflictCondition(campaign, turnId, target.id, "eyebright ointment", { source: "Eyebright ointment" });
    return { effect: `${target.name}'s eyes are dressed with Eyebright: their sight rot does not worsen after the next long rest.` };
  }
  const plan = potionPlan(itemName);
  if (!plan) {
    return null;
  }
  const sheet = getSheetById(target.id) ?? target;
  switch (plan.kind) {
    case "vitality": {
      // Every disease the engine holds goes too (src/lib/dm/afflictions.ts).
      const cleared = removeConditions(sheet.conditions, sheet.conditionMeta, ["poisoned", "diseased", "disease", ...afflictionConditionsFor(campaign.id, sheet, "disease")]);
      write(campaign, sheet, { exhaustion: 0, conditions: cleared.conditions, conditionMeta: cleared.meta });
      return { effect: `${sheet.name}'s exhaustion is gone, and any poison or disease with it.` };
    }
    case "heroism": {
      write(campaign, sheet, { tempHp: Math.max(sheet.tempHp ?? 0, 10) });
      condition(campaign, turnId, sheet, "blessed", 60, reason);
      return { effect: `${sheet.name} gains 10 temporary hit points and is blessed for an hour.` };
    }
    case "giant": {
      condition(campaign, turnId, sheet, `giant strength (${plan.score})`, 60, reason);
      return { effect: `${sheet.name}'s Strength is ${plan.score} for an hour (if it was lower).` };
    }
    case "condition": {
      const minutes = plan.hoursDice ? 60 * rollCard(campaign, null, sheet.id, "custom", `${itemName}: hours it lasts`, plan.hoursDice, null).total : plan.minutes;
      const applied = condition(campaign, turnId, sheet, plan.condition, minutes, reason);
      return "error" in applied
        ? { effect: `No effect: ${String(applied.error)}` }
        : { effect: `${sheet.name} is ${plan.condition} for ${minutes >= 60 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`}.` };
    }
    case "poison": {
      const damage = rollCard(campaign, null, sheet.id, "damage", `${itemName}: it was poison`, "3d6", null);
      const hurt = applyPcDamage(campaign, turnId, sheet, { amount: damage.total, type: "poison", reason });
      const save = rollSave(campaign, getSheetById(sheet.id) ?? sheet, 13, `${sheet.name}: CON save vs ${itemName}`);
      if (!save.success) {
        condition(campaign, turnId, sheet, "poisoned", 60, reason);
      }
      return { effect: `It was poison: ${damage.total} poison damage${save.success ? "" : ", and poisoned for an hour"}.`, ...hurt };
    }
    default:
      return null;
  }
}

function rollSave(campaign: Campaign, sheet: CharacterSheet, dc: number, detail: string): { success: boolean } {
  const resolved = resolveRollExpression(
    { kind: "saving_throw", ability: "con", dc } as unknown as RollArgs,
    sheet,
    rollExtrasFor(campaign, sheet, "saving_throw"),
  );
  if ("error" in resolved || "autoFail" in resolved) {
    return { success: false };
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const roll = insertRoll({ campaignId: campaign.id, characterId: sheet.id, requestedBy: "dm", kind: "saving_throw", detail, dc, result: outcome });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
  return { success: outcome.total >= dc };
}

// Reading a scroll the reader's class can cast from: a spell above what they
// can cast needs a check against DC 10 + its level first.
function readScroll(campaign: Campaign, turnId: string, reader: CharacterSheet, spell: string): Record<string, unknown> {
  const known = checklistSpell(spell);
  const level = known?.level ?? 1;
  const numbers = scrollNumbers(level);
  const name = known?.name ?? spell;
  if (level > highestSlotLevel(reader) && reader.spellcasting) {
    const dc = 10 + level;
    const resolved = resolveRollExpression(
      { kind: "ability_check", ability: reader.spellcasting.ability, dc } as unknown as RollArgs,
      reader,
      rollExtrasFor(campaign, reader, "ability_check"),
    );
    let total = 0;
    if (!("error" in resolved) && !("autoFail" in resolved)) {
      spendRollCarriers(campaign.id, reader.id, resolved.spendInspiration);
      const outcome = rollExpression(resolved.expression);
      total = outcome.total;
      const roll = insertRoll({ campaignId: campaign.id, characterId: reader.id, requestedBy: "dm", kind: "ability_check", detail: `${reader.name}: reading a scroll of ${name}`, dc, result: outcome });
      publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", { roll, source: "digital" });
    }
    if (total < dc) {
      return {
        spellCast: false,
        effect: `${reader.name} fails to read the scroll of ${name} (check ${total} against DC ${dc}); the magic is lost and the scroll crumbles.`,
      };
    }
  }
  void turnId;
  // The spell is cast from the scroll: the tool that resolves it next spends
  // no slot and uses the scroll's numbers (src/lib/srd/item-cast-credit.ts).
  recordItemCast(reader.id, { spell: name, level, item: `Spell Scroll (${name})`, saveDc: numbers.saveDc, attackBonus: numbers.attackBonus });
  return {
    spellCast: name,
    spellLevel: level,
    saveDc: numbers.saveDc,
    attackBonus: numbers.attackBonus,
    effect: `${reader.name} casts ${name} from the scroll: no spell slot and no material component. Resolve it now with the spell's own tool (aoe_damage, cast_at_enemy, heal, cast_buff) naming ${name}: that cast spends no slot and uses the scroll's save DC ${numbers.saveDc} and attack bonus +${numbers.attackBonus}.`,
  };
}
