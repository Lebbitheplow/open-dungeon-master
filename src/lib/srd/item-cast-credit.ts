// A spell cast from a magic item, waiting for the tool that resolves it.
//
// SRD 5.1, Magic Items, Spells: a spell cast from an item "doesn't expend any
// of the user's spell slots, and requires no components, unless the item's
// description says otherwise". Reading a spell scroll casts its spell with
// the scroll's own save DC and attack bonus. use_item spends the scroll or the
// charge (src/lib/dm/consumables.ts, src/lib/dm/item-use.ts) and writes a
// credit here; the cast guard (src/lib/dm/cast-guard.ts) takes it back when
// aoe_damage, cast_at_enemy, heal or cast_buff then resolves that spell, so
// the slot is never spent twice, and spellSaveDcFor / spellAttackFor
// (src/lib/srd/index.ts) read the item's numbers while it stands.
//
// Held in memory, per sheet, for a few minutes: long enough for the DM's
// reply to resolve the spell it just paid for, short enough that a scroll
// read and never resolved does not pay for a cast an hour later. A restart
// forgets them, which costs only the old behaviour (the cast spends a slot).

const WINDOW_MS = 5 * 60 * 1000;
// A credit taken by the cast still lends its DC for a minute: the tool that
// resolves the spell may ask for the DC after the cast guard ran.
const NUMBERS_AFTER_USE_MS = 60 * 1000;

export type ItemCast = {
  spell: string;
  level: number;
  item: string;
  saveDc?: number;
  attackBonus?: number;
};

type Credit = ItemCast & { key: string; at: number; usedAt?: number };

const credits = new Map<string, Credit[]>();

export function spellCreditKey(spell: string): string {
  return spell.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function live(sheetId: string, now: number): Credit[] {
  const kept = (credits.get(sheetId) ?? []).filter((credit) =>
    credit.usedAt !== undefined ? now - credit.usedAt <= NUMBERS_AFTER_USE_MS : now - credit.at <= WINDOW_MS,
  );
  if (kept.length) {
    credits.set(sheetId, kept);
  } else {
    credits.delete(sheetId);
  }
  return kept;
}

// use_item just cast `cast.spell` for this character from an item.
export function recordItemCast(sheetId: string, cast: ItemCast, now = Date.now()) {
  const kept = live(sheetId, now).filter((credit) => credit.key !== spellCreditKey(cast.spell) || credit.usedAt !== undefined);
  kept.push({ ...cast, key: spellCreditKey(cast.spell), at: now });
  credits.set(sheetId, kept);
}

// Takes the waiting credit for this spell, if there is one: the cast is paid
// by the item. A dry run only looks.
export function takeItemCast(
  sheetId: string,
  spell: string,
  { dryRun = false, now = Date.now() }: { dryRun?: boolean; now?: number } = {},
): ItemCast | null {
  const key = spellCreditKey(spell);
  const credit = live(sheetId, now).find((entry) => entry.key === key && entry.usedAt === undefined);
  if (!credit) {
    return null;
  }
  if (!dryRun) {
    credit.usedAt = now;
  }
  return { spell: credit.spell, level: credit.level, item: credit.item, saveDc: credit.saveDc, attackBonus: credit.attackBonus };
}

// The item's own numbers for this spell while its credit stands (waiting, or
// taken within the last minute), or null.
export function itemCastNumbers(
  sheetId: string | undefined,
  spell: string,
  now = Date.now(),
): { saveDc?: number; attackBonus?: number } | null {
  if (!sheetId || !spell.trim()) {
    return null;
  }
  const key = spellCreditKey(spell);
  const credit = [...live(sheetId, now)].reverse().find((entry) => entry.key === key);
  return credit ? { saveDc: credit.saveDc, attackBonus: credit.attackBonus } : null;
}
