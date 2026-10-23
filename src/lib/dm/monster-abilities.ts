import type { ToolError } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { REGENERATION_NAME } from "@/lib/dm/regeneration-text";
import { parseSaveEffect, type SaveEffect } from "@/lib/dm/save-effect";

// A monster's special actions as numbers the engine runs (SRD 5.1,
// Monsters): the save, DC and dice an ability prints, whether it recharges
// on a d6 or is limited to so many a day, and the spellcasting a block
// lists. Pure: statblock.ts reads a pack row through it, the tools read a
// stored block through it, and the per-fight ledger of what has been spent
// lives on the encounter's legendary state (legendary-logic.ts), which the
// functions here take and return. No database, no dice: the callers roll.
// The save clause is read in save-effect.ts, spellcasting in
// monster-spellcasting.ts and Regeneration in regeneration-text.ts; their
// readers are exported from here too, where the engine has always found them.

export { CONDITION_WORDS, SAVE_DC, conditionName, parseSaveEffect, type SaveEffect } from "@/lib/dm/save-effect";
export {
  findMonsterSpell,
  mergeSpellcasting,
  parseSpellcasting,
  spellOfAction,
  type MonsterSpell,
  type MonsterSpellcasting,
} from "@/lib/dm/monster-spellcasting";
export { parseRegeneration, REGENERATION_STOPPED, regenerationOf, type Regeneration } from "@/lib/dm/regeneration-text";

export type MonsterAbility = SaveEffect & {
  // The name without its tags: "Fire Breath", not "Fire Breath (Recharge 5-6)".
  name: string;
  // The lowest d6 face that brings it back: 5 for "Recharge 5-6".
  recharge?: number;
  // Uses a day. A fight is shorter than a day, so this is uses a fight; with
  // perRest, uses a rest ("Springspike Shield (5/rest)").
  perDay?: number;
  // "Recharges after a Short or Long Rest": once a fight.
  perRest?: boolean;
  // "(Recharge Special)": the block says what brings it back (a meal, a
  // charge of magic), which the server does not track, so it is once a fight.
  rechargeSpecial?: boolean;
  // "Sneak Attack (1/Turn)", "Ruthless (1/Round)".
  oncePer?: "turn" | "round";
  // The limit it shares with the other abilities of the same group: a
  // dragon's "Breath Weapons (Recharge 5-6)" prints two breaths, and using
  // either spends the one recharge. Absent on an ability with its own limit.
  group?: string;
  // What a legendary action costs, when the line is one.
  legendaryCost?: number;
  // Printed among the block's Bonus Actions: the creature's bonus action,
  // beside its action, once a round (src/lib/dm/enemy-casting.ts).
  bonusAction?: boolean;
  // A second save the same use forces ("Each creature in that area must also
  // succeed on a DC 18 Wisdom saving throw or ..."): the ability it is read
  // as, run on the same turn its parent was (src/lib/dm/enemy-casting.ts).
  partOf?: string;
};

// The tags a name carries for its limits and costs, which are not part of
// what the ability is called: "(Recharge 5-6)", "(Recharges: Short/Long
// Rest)", "(1/Day, While Bloodied)", "(Costs 2 Actions; Roc Form Only)",
// "(1/Turn)", "(Dust Form Only; Recharge 5-6)", Tome of Beasts 3's cost "(2)" and
// Tome of Beasts' "(2 actions)",
// and A5e's spell levels, "(5th-Level; V, S, Concentration)".
const TAGS =
  /\s*\((?:[^()]*?\b(?:recharges?|costs?\s+\d\s+actions?|\d+\s*\/\s*(?:day|rest|turn|round|week|hour)|\d+\s+minutes?\s*\/\s*day|\d(?:st|nd|rd|th)-level|cantrip)\b[^()]*|\d(?:\s+actions?\b[^()]*)?)(?:\)|$)\s*/gi;

// "Fire Breath (Recharge 5-6)" -> "fire breath": the name two lines are
// matched on.
export function abilityKey(name: string): string {
  return textKey(name.replace(TAGS, " "));
}

// The key a limit is kept under in the ledger: the group's when the ability
// shares one, else its own.
export function limitKey(ability: Pick<MonsterAbility, "name" | "group">): string {
  return abilityKey(ability.group ?? ability.name);
}

// The limits a name's tags print. `legendary`: the line is a legendary
// action, whose bare "(2)" is its cost (Tome of Beasts 3).
function limitsOf(rawName: string, desc: string, legendary: boolean): Partial<MonsterAbility> {
  const out: Partial<MonsterAbility> = {};
  const recharge = /recharges?\s*:?\s*(\d)(?:\s*[-–]\s*6)?\b/i.exec(rawName);
  if (recharge) {
    out.recharge = Math.min(6, Math.max(2, Number(recharge[1])));
  } else if (/recharge special/i.test(rawName)) {
    // "While the hydra has five or more heads, this action has a recharge of 6."
    const printed = /has a recharge of (\d)/i.exec(desc);
    if (printed) {
      out.recharge = Math.min(6, Math.max(2, Number(printed[1])));
    } else {
      out.rechargeSpecial = true;
    }
  }
  const perDay = /(\d+)\s*\/\s*(?:day|week|hour)\b/i.exec(rawName);
  if (perDay) {
    out.perDay = Number(perDay[1]);
  }
  const perRest = /(\d+)\s*\/\s*rest\b/i.exec(rawName);
  if (perRest) {
    out.perRest = true;
    if (Number(perRest[1]) > 1) {
      out.perDay = Number(perRest[1]);
    }
  }
  // "Recharges after a Short or Long Rest", "(Recharge: Short/Long Rest)",
  // "Recharges on a Short or Long Rest", "recharges after 10 minutes" (longer
  // than a fight), "(1 minute/day)": once a fight.
  if (/recharges?\s*(?:after|on|:)\s*(?:a |the )?(?:(?:short|long)(?:\s*(?:or|\/)\s*(?:short|long))?\s+rest|\d+\s+(?:minutes?|hours?))|\d+\s+minutes?\s*\/\s*day/i.test(rawName)) {
    out.perRest = true;
  }
  const once = /\b1\s*\/\s*(turn|round)\b/i.exec(rawName);
  if (once) {
    out.oncePer = once[1].toLowerCase() as "turn" | "round";
  }
  const cost = /costs?\s+(\d)\s+actions?/i.exec(rawName) ?? /\((\d)\s+actions?\b/i.exec(rawName) ?? (legendary ? /\((\d)\)/.exec(rawName) : null);
  if (cost) {
    out.legendaryCost = Number(cost[1]);
  }
  return out;
}

// One action, special or legendary line of a block as an ability. Null when
// the line prints nothing the engine can run (no save, no dice, no limit).
export function parseAbilityText(rawName: string, desc: string, options: { legendary?: boolean } = {}): MonsterAbility | null {
  const name = rawName.replace(TAGS, " ").replace(/\s+/g, " ").trim();
  if (!name) {
    return null;
  }
  const ability: MonsterAbility = { name, ...parseSaveEffect(desc), ...limitsOf(rawName, desc, Boolean(options.legendary)) };
  const runs =
    ability.save || ability.damage || ability.recharge || ability.perDay || ability.perRest || ability.rechargeSpecial || ability.oncePer;
  return runs ? ability : null;
}

// A stored trait line ("Fire Breath (Recharge 5-6): DC 12 Dex save, ..." or
// "Legendary action: Wing Attack (Costs 2 Actions). The dragon ...") as an
// ability, for blocks written by hand or snapshotted before `specials`.
export function abilityFromLine(line: string): MonsterAbility | null {
  const legendary = /^legendary(?: action)?\s*[:.-]/i.test(line);
  const text = line.replace(/^(?:legendary|lair|bonus|reaction|action)(?: action)?\s*[:.-]\s*/i, "");
  const split = /^([^.:]{2,80}?)\s*[.:]\s+([\s\S]*)$/.exec(text.trim());
  if (!split) {
    return null;
  }
  return parseAbilityText(split[1], split[2], { legendary });
}

export type AbilityHolder = {
  specials?: MonsterAbility[];
  traits: string[];
};

// The block's ability by name: the parsed specials first, then the trait
// lines. Matched on the whole name without its tags.
export function findMonsterAbility(stats: AbilityHolder, wanted: string): MonsterAbility | null {
  const key = abilityKey(wanted);
  if (!key) {
    return null;
  }
  const candidates = [
    ...(stats.specials ?? []),
    ...(stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null),
  ];
  return candidates.find((entry) => abilityKey(entry.name) === key) ?? null;
}

// The names a block's abilities go by, for a refusal that says what it has.
export function abilityNames(stats: AbilityHolder): string[] {
  const names = [
    ...(stats.specials ?? []).map((entry) => entry.name),
    ...(stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null).map((entry) => entry.name),
  ];
  return [...new Set(names)];
}

// ---- the per-fight ledger ----

// What one enemy has spent this fight: recharge abilities waiting on their
// d6, uses of a limited ability or innate spell, spell slots by level.
export type AbilityLedger = {
  spent?: string[];
  uses?: Record<string, number>;
  slots?: Record<string, number>;
  // What a legendary action bought and the next ability call spends: an
  // ability's key, or "cantrip" (legendary-tools.ts).
  bought?: string[];
  // When an ability was last used, by its key: the turn ("<round>:<whose
  // turn>", src/lib/db/encounters.ts turnKey) for a once-a-turn ability and
  // the one a second save rides on, "round <n>" for a once-a-round one.
  stamps?: Record<string, string>;
};

// The moment of a fight an ability is used in: the turn's key and the round.
export type AbilityMoment = { turn: string; round: number };

export function normalizeAbilityLedgers(raw: unknown): Record<string, AbilityLedger> {
  const out: Record<string, AbilityLedger> = {};
  if (!raw || typeof raw !== "object") {
    return out;
  }
  const numbers = (value: unknown) =>
    Object.fromEntries(
      Object.entries(value && typeof value === "object" ? (value as Record<string, unknown>) : {})
        .map(([key, count]) => [key, Math.max(0, Number(count) || 0)] as const)
        .filter(([, count]) => count > 0),
    );
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const record = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
    const spent = strings(record.spent);
    const bought = strings(record.bought);
    const uses = numbers(record.uses);
    const slots = numbers(record.slots);
    const stamps = Object.fromEntries(
      Object.entries(record.stamps && typeof record.stamps === "object" ? (record.stamps as Record<string, unknown>) : {}).filter(
        (pair): pair is [string, string] => typeof pair[1] === "string",
      ),
    );
    out[id] = {
      ...(spent.length ? { spent } : {}),
      ...(bought.length ? { bought } : {}),
      ...(Object.keys(uses).length ? { uses } : {}),
      ...(Object.keys(slots).length ? { slots } : {}),
      ...(Object.keys(stamps).length ? { stamps } : {}),
    };
  }
  return out;
}

const stampOf = (ability: Pick<MonsterAbility, "oncePer">, now: AbilityMoment) => (ability.oncePer === "round" ? `round ${now.round}` : now.turn);

// Why an ability cannot be used now, or null when it can. `now` is the
// fight's moment, for an ability limited to once a turn or a round and for a
// second save, which rides on its parent's turn; without it those go
// unchecked, as before.
export function abilityRefusal(creature: string, ability: MonsterAbility, ledger: AbilityLedger | undefined, now?: AbilityMoment): ToolError | null {
  const key = limitKey(ability);
  const label = ability.group ? `${ability.group} (${ability.name})` : ability.name;
  if (ability.partOf && now && ledger?.stamps?.[abilityKey(ability.partOf)] !== now.turn) {
    return { error: `${ability.name} is the second save of ${creature}'s ${ability.partOf}: it comes with that use, on the same turn. Use ${ability.partOf} first.`, retry: true };
  }
  if (ability.recharge && ledger?.spent?.includes(key)) {
    return { error: `${creature}'s ${label} has not recharged: it comes back on a ${ability.recharge === 6 ? "6" : `${ability.recharge} or higher`} on the d6 rolled at the start of its turn. Pick another action.`, retry: true };
  }
  const limit = ability.perDay ?? (ability.perRest || ability.rechargeSpecial ? 1 : 0);
  if (limit && (ledger?.uses?.[key] ?? 0) >= limit) {
    const until = ability.rechargeSpecial
      ? "this fight: its block says what brings it back, and the server holds it to one use"
      : ability.perRest
        ? "until it rests"
        : "today";
    return { error: `${creature} has used ${label} ${limit === 1 ? "already" : `all ${limit} times`} and cannot use it again ${until}. Pick another action.`, retry: true };
  }
  if (ability.oncePer && now && ledger?.stamps?.[key] === stampOf(ability, now)) {
    return { error: `${creature} has used ${label} this ${ability.oncePer} already: it is once a ${ability.oncePer}. Pick another action.`, retry: true };
  }
  return null;
}

export function spendAbility(ability: MonsterAbility, ledger: AbilityLedger | undefined, now?: AbilityMoment): AbilityLedger {
  const key = limitKey(ability);
  const next: AbilityLedger = { ...(ledger ?? {}) };
  if (ability.recharge) {
    next.spent = [...new Set([...(next.spent ?? []), key])];
  }
  if (ability.perDay || ability.perRest || ability.rechargeSpecial) {
    next.uses = { ...(next.uses ?? {}), [key]: (next.uses?.[key] ?? 0) + 1 };
  }
  if (now) {
    // The turn it was used, for a once-a-turn limit and for the second save
    // that rides on it.
    next.stamps = { ...(next.stamps ?? {}), [abilityKey(ability.name)]: now.turn, ...(ability.oncePer ? { [key]: stampOf(ability, now) } : {}) };
  }
  return next;
}

// The d6 at the start of the creature's turn for each spent recharge
// ability. `roll` throws one d6. Returns the ledger and a line per roll.
export function rollRecharges(
  creature: string,
  abilities: MonsterAbility[],
  ledger: AbilityLedger | undefined,
  roll: () => number,
): { ledger: AbilityLedger | undefined; lines: string[] } {
  if (!ledger?.spent?.length) {
    return { ledger, lines: [] };
  }
  const lines: string[] = [];
  const spent: string[] = [];
  for (const key of ledger.spent) {
    const ability = abilities.find((entry) => limitKey(entry) === key);
    if (!ability?.recharge) {
      continue;
    }
    const name = ability.group ?? ability.name;
    const face = roll();
    if (face >= ability.recharge) {
      lines.push(`${creature}'s ${name} recharges (d6: ${face}).`);
    } else {
      spent.push(key);
      lines.push(`${creature}'s ${name} does not recharge (d6: ${face}).`);
    }
  }
  const next = { ...ledger };
  if (spent.length) {
    next.spent = spent;
  } else {
    delete next.spent;
  }
  return { ledger: next, lines };
}

// The slot a spell of `level` is cast from: the lowest one left at or above
// it. Null when none is left.
export function slotFor(casting: { slots: Record<string, number> }, ledger: AbilityLedger | undefined, level: number): number | null {
  const levels = Object.keys(casting.slots)
    .map(Number)
    .filter((slot) => slot >= level)
    .sort((a, b) => a - b);
  for (const slot of levels) {
    if ((ledger?.slots?.[String(slot)] ?? 0) < (casting.slots[String(slot)] ?? 0)) {
      return slot;
    }
  }
  return null;
}

export function spendSlot(ledger: AbilityLedger | undefined, slot: number): AbilityLedger {
  const key = String(slot);
  return { ...(ledger ?? {}), slots: { ...(ledger?.slots ?? {}), [key]: (ledger?.slots?.[key] ?? 0) + 1 } };
}

export function spendSpellUse(ledger: AbilityLedger | undefined, spell: string): AbilityLedger {
  const key = `spell:${textKey(spell)}`;
  return { ...(ledger ?? {}), uses: { ...(ledger?.uses ?? {}), [key]: (ledger?.uses?.[key] ?? 0) + 1 } };
}

export function spellUsesLeft(ledger: AbilityLedger | undefined, spell: { name: string; perDay?: number }): number {
  if (!spell.perDay) {
    return Number.POSITIVE_INFINITY;
  }
  return spell.perDay - (ledger?.uses?.[`spell:${textKey(spell.name)}`] ?? 0);
}

// ---- exhaustion on a creature ----

// A creature's exhaustion level, kept as the condition "exhaustion N"
// (set_enemy_condition with level). 0 when it has none; a bare
// "exhaustion" is level 1.
export function enemyExhaustion(conditions: string[]): number {
  for (const entry of conditions) {
    const match = /^exhaustion(?:\s+(\d))?$/i.exec(entry.trim());
    if (match) {
      return Math.min(6, Math.max(1, Number(match[1] ?? 1)));
    }
  }
  return 0;
}

// A creature's walking tiles after its exhaustion: halved from level 2,
// none from level 5 (the table the characters use).
export function exhaustedTiles(conditions: string[], tiles: number): number {
  const level = enemyExhaustion(conditions);
  return level >= 5 ? 0 : level >= 2 ? Math.floor(tiles / 2) : tiles;
}

// The most hit points a creature may have: halved from level 4.
export function enemyHpCap(enemy: { maxHp: number; conditions: string[] }): number {
  return enemyExhaustion(enemy.conditions) >= 4 ? Math.floor(enemy.maxHp / 2) : enemy.maxHp;
}

// ---- traits the engine reads ----

const TRAIT_FLAGS = {
  magicResistance: /^magic resistance\b/i,
  packTactics: /^pack tactics\b/i,
  nimbleEscape: /^nimble escape\b/i,
  // Sunlight Weakness and Hypersensitivity (Black Flag, A5e, the Tomes of
  // Beasts) put its attacks at disadvantage in sunlight as Sensitivity does.
  sunlightSensitivity: /^sunlight (?:sensitivity|weakness|hypersensitivity)\b/i,
  // Weakness puts its saves at disadvantage there too.
  sunlightWeakness: /^sunlight weakness\b/i,
  undeadFortitude: /^undead fortitude\b/i,
  regeneration: REGENERATION_NAME,
  // Tome of Beasts prints it in the singular ("Magic Weapon").
  magicWeapons: /^magic weapons?\b/i,
} as const;

export type TraitFlag = keyof typeof TRAIT_FLAGS;

// Whether the block carries a named trait. Traits are stored as "Name: text"
// lines, so the name is the start of the line.
export function hasTrait(stats: { traits?: string[] } | undefined, flag: TraitFlag): boolean {
  return (stats?.traits ?? []).some((line) => TRAIT_FLAGS[flag].test(line.trim()));
}

// Trait names statblock.ts keeps whatever the cap on trait lines, because
// the engine reads them.
export const ENGINE_TRAIT_NAMES = /^(magic resistance|pack tactics|nimble escape|sunlight (?:sensitivity|weakness|hypersensitivity)|undead fortitude|(?:[a-z'-]+ )?regeneration|magic weapons?|legendary resistance|spellcasting|innate spellcasting|keen (?:sight|hearing|smell|senses|scent)|(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder) absorption|immutable form|limited magic immunity|martial advantage|surprise attack|turn(?:ing)? (?:resistance|defiance|immunity|vulnerability)|turning(?=:))\b/i;
