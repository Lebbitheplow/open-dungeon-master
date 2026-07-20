// Pure clamp math for DM-driven sheet mutations. No imports so the node
// test runner (scripts/test-mutations.mjs) can import it directly as TS.

export type SlotState = { max: number; used: number };
export type EquipmentRow = { name: string; qty: number; slug?: string };

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
