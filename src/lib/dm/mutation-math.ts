// Pure clamp math for DM-driven sheet mutations. No imports so the node
// test runner (scripts/test-mutations.mjs) can import it directly as TS.

export type SlotState = { max: number; used: number };
export type EquipmentRow = { name: string; qty: number; slug?: string };

// Server-side ceiling on DM sheet edits so no amount of prompting (public, or
// on the private whisper line) can talk the DM into a cheat: an extra level, a
// huge HP or gold jump, an ability past 20, hand-set XP. Legitimate modest
// story changes (a rename, a curse, a single lead-directed level) still pass;
// real advancement happens through the player's own level-up flow in the app.
// xpTargetLevel is levelForXp(patch.xp), computed by the caller so this module
// stays import-free; leave it undefined when the patch does not set xp.
export function sheetBuffViolation(
  sheet: { name: string; level: number; maxHp: number; gold: number },
  patch: { level?: number; maxHp?: number; gold?: number; abilities?: Record<string, number> },
  xpTargetLevel?: number,
): string | null {
  if (typeof patch.level === "number" && patch.level > sheet.level + 1) {
    return `A character gains at most one level at a time, and a level-up is applied through the player's own choices in the app. ${sheet.name} stays at level ${sheet.level}.`;
  }
  if (typeof xpTargetLevel === "number" && xpTargetLevel > sheet.level + 1) {
    return `Experience is earned through play with award_xp, not set by hand; ${sheet.name}'s XP is unchanged.`;
  }
  if (typeof patch.maxHp === "number" && patch.maxHp > sheet.maxHp + 12 * Math.max(1, sheet.level)) {
    return `${sheet.name}'s maximum HP cannot jump that far from a single change; larger gains come from leveling up in the app.`;
  }
  if (typeof patch.gold === "number" && patch.gold - sheet.gold > 1000) {
    return `Coin moves through purchases, loot, and roll_treasure, not a direct sheet edit; ${sheet.name}'s gold is unchanged.`;
  }
  if (patch.abilities) {
    for (const [ability, score] of Object.entries(patch.abilities)) {
      if (typeof score === "number" && score > 20) {
        return `Ability scores cap at 20 here; leave ${sheet.name}'s ${ability.toUpperCase()} at 20 or lower.`;
      }
    }
  }
  return null;
}

// Damage soaks temp HP first; HP floors at 0. Returns the new pools plus
// how much was absorbed and whether the character dropped.
export function applyDamageMath(currentHp: number, tempHp: number, amount: number) {
  const damage = Math.max(0, Math.floor(amount));
  const absorbed = Math.min(tempHp, damage);
  const remaining = damage - absorbed;
  const newHp = Math.max(0, currentHp - remaining);
  return {
    currentHp: newHp,
    tempHp: tempHp - absorbed,
    absorbed,
    dropped: newHp === 0 && currentHp > 0 && damage > 0,
    // Damage beyond what reached 0 HP; the massive-damage instant-death
    // rule compares this against max HP.
    overkill: Math.max(0, remaining - currentHp),
  };
}

// Damage taken while Wild Shaped: temp HP soaks first, then the beast
// form's own pool, and only what is left over reaches the druid's real hit
// points, reverting them mid-blow.
export function wildShapeDamageMath(beastHp: number, tempHp: number, amount: number) {
  const damage = Math.max(0, Math.floor(amount));
  const absorbed = Math.min(tempHp, damage);
  const remaining = damage - absorbed;
  const toBeast = Math.min(beastHp, remaining);
  const left = beastHp - toBeast;
  return {
    beastHp: left,
    tempHp: tempHp - absorbed,
    absorbed,
    // What spills into the druid's own hit points once the form drops.
    carryover: remaining - toBeast,
    reverted: left <= 0 && damage > 0,
  };
}

// Healing caps at max HP; a character at 0 stabilizes and rises.
export function healMath(currentHp: number, maxHp: number, amount: number) {
  const healing = Math.max(0, Math.floor(amount));
  return { currentHp: Math.min(maxHp, currentHp + healing) };
}

// Gold floors at 0; returns the actual applied delta.
export function goldMath(gold: number, delta: number) {
  const next = Math.max(0, gold + Math.trunc(delta));
  return { gold: next, applied: next - gold };
}

// Spending a slot needs a free one; returns null when none remain.
export function spendSlotMath(slot: SlotState | undefined | null): SlotState | null {
  if (!slot || slot.used >= slot.max) {
    return null;
  }
  return { max: slot.max, used: slot.used + 1 };
}

// Remove qty of an item; partial removal adjusts, zero removes the row.
// Returns null when the item is absent.
export function removeItemMath(equipment: EquipmentRow[], name: string, qty: number) {
  const index = equipment.findIndex(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (index < 0) {
    return null;
  }
  const item = equipment[index];
  const removed = Math.min(item.qty, Math.max(1, Math.floor(qty)));
  const next = [...equipment];
  if (item.qty - removed <= 0) {
    next.splice(index, 1);
  } else {
    next[index] = { ...item, qty: item.qty - removed };
  }
  return { equipment: next, removed };
}

// Add qty of an item, merging with an existing row by name.
export function grantItemMath(equipment: EquipmentRow[], name: string, qty: number) {
  const amount = Math.max(1, Math.floor(qty));
  const index = equipment.findIndex(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (index < 0) {
    return { equipment: [...equipment, { name, qty: amount }] };
  }
  const next = [...equipment];
  next[index] = { ...next[index], qty: next[index].qty + amount };
  return { equipment: next };
}
