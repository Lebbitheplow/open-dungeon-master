// What a character sheet shows about the character's state, computed by the
// engine's own functions so the sheet dialog, the party panel and the party
// rail say what the rules engine holds:
//   - hit points against effectiveMaxHp (exhaustion 4 halves the maximum, an
//     Amulet of Health raises it), not the stored maxHp;
//   - speed as the move route counts it: armor and gear (speedFor), then the
//     conditions (effectiveSpeed), then exhaustion (exhaustionSpeed);
//   - the combat state kept beside the conditions: exhaustion with what each
//     level does, concentration, the death track, a readied action and its
//     trigger, Inspiration;
//   - every hit die pool of a multiclass character;
//   - resistances and immunities (pcResistances, pcImmunities);
//   - a magic item's charges, a pending attunement, a curse.
// Pure (no React, no database): scripts/test-hand-engine.mjs drives it.
import {
  describeExhaustion,
  effectiveMaxHp,
  effectiveSpeed,
  exhaustionSpeed,
  incapacitatedBy,
  pcImmunities,
  pcResistances,
} from "@/lib/dm/condition-logic";
import { attunementRefusal } from "@/lib/dm/usage-rules";
import type { CharacterSheet, EquipmentItem } from "@/lib/schemas/sheet";
import { speedFor } from "@/lib/srd";
import { UNLIMITED_USES, resourceDef } from "@/lib/srd/class-resources";
import { chargeMax, chargeRuleOf, chargesLeft } from "@/lib/srd/item-charge-rules";
import { gearDefFor } from "@/lib/srd/magic-gear";
import { matchMagicItem } from "@/lib/srd/magic-items";
import { oneOfKind, wearSlotOf, wornButIdle } from "@/lib/srd/wear-slots";
import { isWorn, matchArmor, wearingIsExplicit } from "@/lib/srd/armor";
import { conditionNote, conditionNoteLine } from "@/lib/battlemap/condition-notes";
import { matchWeapon } from "@/lib/srd/weapons";
import { checkRidersOf } from "@/lib/srd/item-check-riders";
import type { ItemTag } from "@/lib/schemas/item-tags";

// ---- hit points ----

export function maxHpView(sheet: CharacterSheet): { max: number; stored: number; note: string | null } {
  const max = effectiveMaxHp(sheet);
  const exhaustion = sheet.exhaustion ?? 0;
  const note =
    max === sheet.maxHp
      ? null
      : exhaustion >= 4 && max < sheet.maxHp
        ? `Hit point maximum halved by exhaustion ${exhaustion} (${sheet.maxHp} without it).`
        : max > sheet.maxHp
          ? `Raised by worn, attuned gear that sets Constitution (${sheet.maxHp} without it).`
          : `The rules put the maximum at ${max} right now (${sheet.maxHp} on the sheet).`;
  return { max, stored: sheet.maxHp, note };
}

// ---- speed ----

const ZEROING = ["grappled", "restrained", "incapacitated", "paralyzed", "stunned", "unconscious", "petrified"];

export function speedView(
  sheet: CharacterSheet,
  options: { encumbrance?: boolean } = {},
): { speed: number; base: number; notes: string[] } {
  const worn = speedFor(sheet, { encumbrance: options.encumbrance ?? false });
  const conditioned = effectiveSpeed(sheet.conditions, worn);
  const exhaustion = sheet.exhaustion ?? 0;
  const speed = exhaustionSpeed(exhaustion, conditioned);
  const notes: string[] = [];
  if (worn !== sheet.speed) {
    notes.push(`Base ${sheet.speed} ft, ${worn} ft with what they wear and carry.`);
  }
  if (conditioned !== worn) {
    const zeroing = sheet.conditions.find((entry) => ZEROING.includes(entry.trim().toLowerCase()));
    notes.push(zeroing ? `${zeroing}: speed 0.` : `Effects on them change it to ${conditioned} ft.`);
  }
  if (speed !== conditioned) {
    notes.push(`Exhaustion ${exhaustion}: ${exhaustion >= 5 ? "speed 0" : "speed halved"}.`);
  }
  return { speed, base: sheet.speed, notes };
}

// ---- the state beside the conditions ----

export type StateTag = {
  id: "exhaustion" | "concentration" | "dying" | "stable" | "dead" | "readied" | "inspiration" | "incapacitated";
  label: string;
  tone: "harm" | "ward" | "bless" | "neutral";
  note: string;
};

export function stateTags(sheet: CharacterSheet): StateTag[] {
  const tags: StateTag[] = [];
  const saves = sheet.deathSaves;
  if (saves?.dead) {
    tags.push({ id: "dead", label: "Dead", tone: "harm", note: "Only magic that raises the dead brings them back." });
  } else if (saves && sheet.currentHp <= 0) {
    tags.push(
      saves.stable
        ? { id: "stable", label: "Stable", tone: "neutral", note: "Unconscious at 0 hit points, no longer rolling death saves." }
        : {
            id: "dying",
            label: `Dying ${saves.successes}/${saves.failures}`,
            tone: "harm",
            note: `Death saves: ${saves.successes} success${saves.successes === 1 ? "" : "es"}, ${saves.failures} failure${saves.failures === 1 ? "" : "s"}. Three successes stabilize, three failures kill.`,
          },
    );
  }
  const stopped = incapacitatedBy(sheet.conditions);
  if (stopped && sheet.currentHp > 0) {
    tags.push({ id: "incapacitated", label: `Cannot act (${stopped})`, tone: "harm", note: `${sheet.name} can take no actions or reactions while ${stopped}.` });
  }
  const exhaustion = sheet.exhaustion ?? 0;
  if (exhaustion > 0) {
    tags.push({ id: "exhaustion", label: `Exhaustion ${exhaustion}`, tone: "harm", note: `${describeExhaustion(exhaustion)}. A long rest lowers it by one.` });
  }
  if (sheet.concentratingOn) {
    tags.push({
      id: "concentration",
      label: `Concentrating: ${sheet.concentratingOn}`,
      tone: "bless",
      note: "Damage calls for a CON save (DC 10 or half the damage); another concentration spell, or falling unconscious, ends it.",
    });
  }
  const readied = sheet.conditions.find((entry) => entry.trim().toLowerCase() === "readied");
  if (readied) {
    const trigger = sheet.conditionMeta?.[readied]?.source;
    tags.push({
      id: "readied",
      label: "Readied",
      tone: "ward",
      note: trigger ? `When ${trigger}: the readied attack, with the reaction. It lapses when their next turn starts.` : "An action held for its trigger; it lapses when their next turn starts.",
    });
  }
  const inspiration = sheet.resources?.inspiration;
  if (inspiration && inspiration.used < inspiration.max) {
    tags.push({ id: "inspiration", label: "Inspiration", tone: "bless", note: "Spend it for advantage on one attack, save or check." });
  }
  return tags;
}

// A condition's chip tail from its metadata: "until Kael's turn", "save
// ends (WIS 13)", "from Goblin 2", "3 rounds".
export function conditionDetail(sheet: CharacterSheet, condition: string, nameOf: (id: string) => string | null): string {
  return conditionNoteLine(conditionNote(condition, sheet.conditionMeta?.[condition], nameOf, sheet.id));
}

// ---- hit dice ----

export type HitDiceRow = { label: string; die: string; left: number; total: number };

export function hitDiceRows(sheet: CharacterSheet): HitDiceRow[] {
  const pools = sheet.hitDicePools?.length ? sheet.hitDicePools : null;
  if (!pools) {
    return [{ label: sheet.class, die: sheet.hitDice.die, left: sheet.hitDice.total - sheet.hitDice.spent, total: sheet.hitDice.total }];
  }
  return pools.map((pool) => ({ label: pool.classId, die: pool.die, left: pool.total - pool.spent, total: pool.total }));
}

// "2/3d10 + 1/2d8" for a vital tile.
export function hitDiceLine(sheet: CharacterSheet): string {
  return hitDiceRows(sheet)
    .map((row) => `${row.left}/${row.total}${row.die}`)
    .join(" + ");
}

// ---- defenses ----

export function defensesView(sheet: CharacterSheet): { resist: string; immune: string } {
  return { resist: pcResistances(sheet), immune: pcImmunities(sheet) };
}

// ---- gear ----

export type ItemStatus = {
  // "4/7 charges", or null for an item with none.
  charges: string | null;
  // Asked to attune; the next short or long rest completes it.
  attuning: boolean;
  // Attuned and cursed: the wearer cannot end it.
  cursed: boolean;
  // The engine's refusal for pressing the attune toggle now, or null.
  attuneRefusal: string | null;
};

export function itemStatus(sheet: CharacterSheet, item: EquipmentItem): ItemStatus {
  const rule = chargeRuleOf(item);
  const charges = rule ? `${chargesLeft(item, rule)}/${chargeMax(rule)} charges` : null;
  const cursed = Boolean(item.attuned && gearDefFor(item.name, item.slug)?.cursed);
  const refusal = attunementRefusal(sheet, { [item.name]: { attuned: !(item.attuned || item.attuning) } });
  return { charges, attuning: Boolean(item.attuning), cursed, attuneRefusal: refusal };
}

// ---- counters ----

// How a counter reads on the sheet, by the engine's own table
// (src/lib/srd/class-resources.ts). A counter with no cap (Overchannel)
// counts uses since its rest; a passive one (Signature Spells, Overchannel)
// is spent by the cast itself, so the sheet offers no minus for it.
export type CounterView = { line: string; spendable: boolean; note: string | null };

export function counterView(id: string, pool: { max: number; used: number }): CounterView {
  const def = resourceDef(id);
  const rest = def?.recharge === "short" ? "a short or long rest" : "a long rest";
  if (pool.max >= UNLIMITED_USES) {
    return {
      line: pool.used ? `used ${pool.used} time${pool.used === 1 ? "" : "s"} since ${rest}` : `unused since ${rest}`,
      spendable: false,
      note: def?.guidance ?? null,
    };
  }
  return {
    line: `${pool.max - pool.used}/${pool.max}`,
    spendable: !def?.passive,
    note: def?.passive ? "Spent by the server when it is used; back after " + rest + "." : null,
  };
}

// Flying and swimming speeds beside the walking one (SheetDerived.speeds:
// Stormborn, Wind Soul, a raging eagle, Avenging Angel...).
export function otherSpeedsLine(speeds: { fly?: number; swim?: number } | undefined): string[] {
  const out: string[] = [];
  if (speeds?.fly) out.push(`Fly ${speeds.fly} ft`);
  if (speeds?.swim) out.push(`Swim ${speeds.swim} ft`);
  return out;
}

// ---- worn or carried ----

// Whether a gear row offers the wear toggle: only where wearing or holding
// it is something the engines read (a place on the body in
// src/lib/srd/wear-slots.ts, issue 412; isWorn in src/lib/srd/armor.ts; the
// hands in src/lib/dm/cast-rules.ts). Armor or a shield, a weapon, a magic
// item whose effect or check rider works only while worn, and a staff, rod
// or wand held as a focus, known by the rows the sheet already loads (under
// the item's SRD name when it has one) and its stored tags, never by the
// words of its name; a rope, an arrow or a key has nowhere to be worn. The
// item tag table stays on the server: it would double the sheet's share of
// the table page's first load for this one question.
const HELD_FOCI: readonly ItemTag[] = ["staff", "rod", "wand"];

export function isWornGear(item: Pick<EquipmentItem, "name" | "slug" | "srdName" | "tags" | "gear" | "identified">): boolean {
  if (wearSlotOf(item) !== null) {
    return true;
  }
  const name = item.srdName ?? item.name;
  if (item.gear?.armor || item.gear?.weapon || matchArmor(name) || matchWeapon(name) || gearDefFor(name, item.slug)?.base) {
    return true;
  }
  const magic = item.gear?.magic ?? matchMagicItem(name, item.slug);
  const riders = item.gear?.checks ? { carried: item.gear.magic?.carried === true } : checkRidersOf(name);
  if ((magic && !magic.carried) || (riders && !riders.carried)) {
    return true;
  }
  const tags = item.identified === false ? [] : (item.tags ?? item.gear?.tags ?? []);
  return tags.some((tag) => HELD_FOCI.includes(tag));
}

// The rows the sheet offers the wear toggle on: armor and shields, gear whose
// name declares a magic bonus, the magic items, and anything with a place on
// the body (a Cloak of Elvenkind only the check riders know, a workshop
// cloak), so an item's place decides it as much as its magic does.
export function wearableGear(equipment: EquipmentItem[]): EquipmentItem[] {
  return equipment.filter(
    (item) =>
      matchArmor(item.name) !== null ||
      /\+[123]\b/.test(item.name) ||
      matchMagicItem(item.name) !== null ||
      Boolean(item.gear?.magic) ||
      wearSlotOf(item) !== null,
  );
}

// A gear row as the sheet shows it: worn the armor engine's way, and, when
// it is worn but its place is full, the kind that is "one at a time". The
// suit and the shield that count are the ones the armor class counted.
export function gearWornState(
  item: EquipmentItem,
  equipment: EquipmentItem[],
  armor: { armorName: string | null; shieldName: string | null },
): { worn: boolean; idle: string | null } {
  const worn = isWorn(item, equipment);
  const slot = wearSlotOf(item);
  if (!worn || !slot) {
    return { worn, idle: null };
  }
  if (slot === "armor" || slot === "shield") {
    const counted = slot === "armor" ? armor.armorName : armor.shieldName;
    return { worn, idle: counted !== null && counted !== item.name ? oneOfKind(slot) : null };
  }
  const idle = wornButIdle(item, equipment);
  return { worn, idle: idle ? oneOfKind(idle) : null };
}

// Whether a change puts the row on: a wear press, or attuning on a sheet that
// says what it wears (the route wears an item it attunes there).
export function changeWears(item: EquipmentItem, equipment: EquipmentItem[], change: { equipped?: boolean; attuned?: boolean }): boolean {
  if (change.equipped !== undefined) {
    return change.equipped && !isWorn(item, equipment);
  }
  return change.attuned === true && wearingIsExplicit(equipment) && !isWorn(item, equipment);
}
