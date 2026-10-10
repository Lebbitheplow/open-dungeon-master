import type { SaveAbility } from "@/lib/bestiary/statblock";

// A monster's special actions as numbers the engine runs (SRD 5.1,
// Monsters): the save, DC and dice an ability prints, whether it recharges
// on a d6 or is limited to so many a day, and the spellcasting a block
// lists. Pure: statblock.ts reads a pack row through it, the tools read a
// stored block through it, and the per-fight ledger of what has been spent
// lives on the encounter's legendary state (legendary-logic.ts), which the
// functions here take and return. No database, no dice: the callers roll.

const ABILITY_WORDS: Record<string, SaveAbility> = {
  strength: "str",
  dexterity: "dex",
  constitution: "con",
  intelligence: "int",
  wisdom: "wis",
  charisma: "cha",
};

const DAMAGE_WORDS = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];

const CONDITION_WORDS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "paralyzed", "petrified", "poisoned", "restrained", "stunned", "unconscious",
];

export type MonsterAbility = {
  // The name without its tags: "Fire Breath", not "Fire Breath (Recharge 5-6)".
  name: string;
  // The lowest d6 face that brings it back: 5 for "Recharge 5-6".
  recharge?: number;
  // Uses a day. A fight is shorter than a day, so this is uses a fight.
  perDay?: number;
  // "Recharges after a Short or Long Rest": once a fight.
  perRest?: boolean;
  // What a legendary action costs, when the line is one.
  legendaryCost?: number;
  save?: SaveAbility;
  dc?: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  // "for 1 minute" is 10 rounds; "until the end of its next turn" is 1;
  // "for 1 hour" 600, "for 24 hours" a day's 14400.
  rounds?: number;
  // "until the target finishes a long rest" (a succubus's kiss).
  untilLongRest?: boolean;
  // "until it is removed by the lesser restoration spell", "until freed by
  // greater restoration": no count and no repeat save; a cure ends it.
  lasting?: boolean;
  // The target repeats the save each round to end the condition.
  repeatSave?: boolean;
  // The ability says it is magic ("against this magic"), which Magic
  // Resistance answers.
  magical?: boolean;
};

const TAGS = /\s*\((?:recharge[^)]*|\d+\s*\/\s*day[^)]*|costs?\s+\d\s+actions?|recharges after[^)]*)\)\s*/gi;

// "Fire Breath (Recharge 5-6)" -> "fire breath": the name two lines are
// matched on.
export function abilityKey(name: string): string {
  return name.replace(TAGS, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function compactDice(raw: string): string {
  return raw.replace(/\s+/g, "");
}

// The rider or effect clause of a line: DC, save, damage, condition and how
// long it lasts. Shared by abilities and by attacks' "Hit:" riders.
export function parseSaveEffect(text: string): Omit<MonsterAbility, "name" | "recharge" | "perDay" | "perRest" | "legendaryCost"> {
  const out: Omit<MonsterAbility, "name"> = {};
  const save = /DC\s*(\d{1,2})\s+(strength|dexterity|constitution|intelligence|wisdom|charisma)\s+saving throw/i.exec(text);
  if (save) {
    out.dc = Number(save[1]);
    out.save = ABILITY_WORDS[save[2].toLowerCase()];
  }
  const dice = [
    ...text.matchAll(
      new RegExp(`\\d+\\s*\\((\\d{1,3}d\\d{1,3}(?:\\s*[+-]\\s*\\d+)?)\\)\\s+(${DAMAGE_WORDS.join("|")})\\s+damage`, "gi"),
    ),
  ];
  if (dice.length) {
    out.damage = dice.map((match) => compactDice(match[1])).join("+");
    out.damageType = dice[0][2].toLowerCase();
  }
  if (/half as much damage on a successful/i.test(text)) {
    out.halfOnSave = true;
  }
  const condition = new RegExp(
    `(?:or|and)\\s+(?:be\\s+|become\\s+|is\\s+)?(knocked prone|${CONDITION_WORDS.join("|")})`,
    "i",
  ).exec(text);
  if (condition) {
    const word = condition[1].toLowerCase();
    out.condition = word === "knocked prone" ? "prone" : word;
  }
  const span = /for (\d{1,3}) (round|minute|hour|day)s?\b/i.exec(text);
  if (/until the end of (?:its|the [a-z' ]+?'s|your) next turn/i.test(text)) {
    out.rounds = 1;
  } else if (span) {
    const count = Number(span[1]);
    const unit = span[2].toLowerCase();
    out.rounds = unit === "round" ? count : unit === "minute" ? count * 10 : unit === "hour" ? count * 600 : count * 14400;
  } else if (/until (?:it|the target|the creature)(?:'s)? (?:finishes|completes) a long rest/i.test(text)) {
    out.untilLongRest = true;
  } else if (/until (?:it is |the (?:target|creature) is )?(?:removed|cured|freed|ended)\b/i.test(text)) {
    out.lasting = true;
  }
  if (/repeat the saving throw/i.test(text)) {
    out.repeatSave = true;
  }
  if (/against this magic|magically/i.test(text)) {
    out.magical = true;
  }
  return out;
}

// One action, special or legendary line of a block as an ability. Null when
// the line prints nothing the engine can run (no save, no dice, no limit).
export function parseAbilityText(rawName: string, desc: string): MonsterAbility | null {
  const name = rawName.replace(TAGS, " ").replace(/\s+/g, " ").trim();
  if (!name) {
    return null;
  }
  const ability: MonsterAbility = { name, ...parseSaveEffect(desc) };
  const recharge = /recharge\s+(\d)(?:\s*[-\u2013]\s*6)?/i.exec(rawName);
  if (recharge) {
    ability.recharge = Math.min(6, Math.max(2, Number(recharge[1])));
  }
  const perDay = /(\d+)\s*\/\s*day/i.exec(rawName);
  if (perDay) {
    ability.perDay = Number(perDay[1]);
  }
  if (/recharges after a (?:short or )?long rest/i.test(rawName)) {
    ability.perRest = true;
  }
  const cost = /costs?\s+(\d)\s+actions?/i.exec(rawName);
  if (cost) {
    ability.legendaryCost = Number(cost[1]);
  }
  const runs =
    ability.save || ability.damage || ability.recharge || ability.perDay || ability.perRest;
  return runs ? ability : null;
}

// A stored trait line ("Fire Breath (Recharge 5-6): DC 12 Dex save, ..." or
// "Legendary action: Wing Attack (Costs 2 Actions). The dragon ...") as an
// ability, for blocks written by hand or snapshotted before `specials`.
export function abilityFromLine(line: string): MonsterAbility | null {
  const text = line.replace(/^(?:legendary|lair|bonus|reaction|action)(?: action)?\s*[:.-]\s*/i, "");
  const split = /^([^.:]{2,80}?)\s*[.:]\s+([\s\S]*)$/.exec(text.trim());
  if (!split) {
    return null;
  }
  return parseAbilityText(split[1], split[2]);
}

export type AbilityHolder = {
  specials?: MonsterAbility[];
  traits: string[];
};

// The block's ability by name: the parsed specials first, then the trait
// lines. Matched on the name without its tags, whole or as a prefix.
export function findMonsterAbility(stats: AbilityHolder, wanted: string): MonsterAbility | null {
  const key = abilityKey(wanted);
  if (!key) {
    return null;
  }
  const candidates = [
    ...(stats.specials ?? []),
    ...(stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null),
  ];
  return (
    candidates.find((entry) => abilityKey(entry.name) === key) ??
    candidates.find((entry) => abilityKey(entry.name).startsWith(key) || key.startsWith(abilityKey(entry.name))) ??
    null
  );
}

// The names a block's abilities go by, for a refusal that says what it has.
export function abilityNames(stats: AbilityHolder): string[] {
  const names = [
    ...(stats.specials ?? []).map((entry) => entry.name),
    ...(stats.traits ?? []).map(abilityFromLine).filter((entry): entry is MonsterAbility => entry !== null).map((entry) => entry.name),
  ];
  return [...new Set(names)];
}

// ---- spellcasting ----

export type MonsterSpell = {
  name: string;
  // 0 for a cantrip; null for an innate spell whose level the block does not
  // print (the spell's own level applies).
  level: number | null;
  // Innate uses a day; absent for at will and for slot spells.
  perDay?: number;
};

export type MonsterSpellcasting = {
  dc?: number;
  attack?: number;
  ability?: SaveAbility;
  casterLevel?: number;
  // Slots by spell level ("1" -> 4).
  slots: Record<string, number>;
  spells: MonsterSpell[];
};

const titleCase = (name: string) =>
  name.replace(/\b([a-z])/g, (_match, letter: string) => letter.toUpperCase()).replace(/\b(Of|The|And|From|To)\b/g, (word) => word.toLowerCase());

function spellNames(list: string): string[] {
  return list
    .replace(/\*/g, "")
    .split(",")
    .map((entry) => entry.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim())
    .filter((entry) => entry && entry.length <= 40)
    .map(titleCase);
}

// "Spellcasting" and "Innate Spellcasting" traits as the numbers they print.
export function parseSpellcasting(desc: string): MonsterSpellcasting | null {
  const text = desc.replace(/\r/g, "");
  const dc = /spell save DC\s*(\d{1,2})/i.exec(text);
  const attack = /([+-]\d{1,2}) to hit with spell attacks/i.exec(text);
  const level = /(\d{1,2})(?:st|nd|rd|th)-level spellcaster/i.exec(text);
  const ability = /spellcasting ability is (strength|dexterity|constitution|intelligence|wisdom|charisma)/i.exec(text);
  const header =
    /(cantrips\s*\(at will\)|(\d)(?:st|nd|rd|th)\s+level\s*\((\d+)\s+slots?\)|at will|(\d+)\s*\/\s*day(?:\s+each)?)\s*:/gi;
  const heads = [...text.matchAll(header)];
  const slots: Record<string, number> = {};
  const spells: MonsterSpell[] = [];
  heads.forEach((head, index) => {
    const start = (head.index ?? 0) + head[0].length;
    const end = index + 1 < heads.length ? (heads[index + 1].index ?? text.length) : text.length;
    const names = spellNames(text.slice(start, end).split("\n")[0]);
    const tag = head[1].toLowerCase();
    if (tag.startsWith("cantrips")) {
      spells.push(...names.map((name) => ({ name, level: 0 })));
    } else if (head[2]) {
      slots[head[2]] = Number(head[3]);
      spells.push(...names.map((name) => ({ name, level: Number(head[2]) })));
    } else if (head[4]) {
      spells.push(...names.map((name) => ({ name, level: null, perDay: Number(head[4]) })));
    } else {
      spells.push(...names.map((name) => ({ name, level: null })));
    }
  });
  if (!spells.length && !dc) {
    return null;
  }
  return {
    ...(dc ? { dc: Number(dc[1]) } : {}),
    ...(attack ? { attack: Number(attack[1]) } : {}),
    ...(ability ? { ability: ABILITY_WORDS[ability[1].toLowerCase()] } : {}),
    ...(level ? { casterLevel: Number(level[1]) } : {}),
    slots,
    spells,
  };
}

export function findMonsterSpell(casting: MonsterSpellcasting | undefined, wanted: string): MonsterSpell | null {
  const key = wanted.trim().toLowerCase();
  return casting?.spells.find((spell) => spell.name.toLowerCase() === key) ?? null;
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
};

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
    out[id] = {
      ...(spent.length ? { spent } : {}),
      ...(bought.length ? { bought } : {}),
      ...(Object.keys(uses).length ? { uses } : {}),
      ...(Object.keys(slots).length ? { slots } : {}),
    };
  }
  return out;
}

// Why an ability cannot be used now, or null when it can.
export function abilityRefusal(creature: string, ability: MonsterAbility, ledger: AbilityLedger | undefined): string | null {
  const key = abilityKey(ability.name);
  if (ability.recharge && ledger?.spent?.includes(key)) {
    return `${creature}'s ${ability.name} has not recharged: it comes back on a ${ability.recharge === 6 ? "6" : `${ability.recharge} or higher`} on the d6 rolled at the start of its turn. Pick another action.`;
  }
  const limit = ability.perDay ?? (ability.perRest ? 1 : 0);
  if (limit && (ledger?.uses?.[key] ?? 0) >= limit) {
    return `${creature} has used ${ability.name} ${limit === 1 ? "already" : `all ${limit} times`} and cannot use it again today. Pick another action.`;
  }
  return null;
}

export function spendAbility(ability: MonsterAbility, ledger: AbilityLedger | undefined): AbilityLedger {
  const key = abilityKey(ability.name);
  const next: AbilityLedger = { ...(ledger ?? {}) };
  if (ability.recharge) {
    next.spent = [...new Set([...(next.spent ?? []), key])];
  }
  if (ability.perDay || ability.perRest) {
    next.uses = { ...(next.uses ?? {}), [key]: (next.uses?.[key] ?? 0) + 1 };
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
    const ability = abilities.find((entry) => abilityKey(entry.name) === key);
    if (!ability?.recharge) {
      continue;
    }
    const face = roll();
    if (face >= ability.recharge) {
      lines.push(`${creature}'s ${ability.name} recharges (d6: ${face}).`);
    } else {
      spent.push(key);
      lines.push(`${creature}'s ${ability.name} does not recharge (d6: ${face}).`);
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
export function slotFor(casting: MonsterSpellcasting, ledger: AbilityLedger | undefined, level: number): number | null {
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
  const key = `spell:${spell.toLowerCase()}`;
  return { ...(ledger ?? {}), uses: { ...(ledger?.uses ?? {}), [key]: (ledger?.uses?.[key] ?? 0) + 1 } };
}

export function spellUsesLeft(ledger: AbilityLedger | undefined, spell: MonsterSpell): number {
  if (!spell.perDay) {
    return Number.POSITIVE_INFINITY;
  }
  return spell.perDay - (ledger?.uses?.[`spell:${spell.name.toLowerCase()}`] ?? 0);
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

// ---- Regeneration ----

// `diesOnlyAtTurnStart`: "The troll dies only if it starts its turn with 0
// hit points and doesn't regenerate" (src/lib/dm/regeneration.ts).
export type Regeneration = { amount: number; stoppedBy: string[]; diesOnlyAtTurnStart?: boolean };

// The condition a creature carries from the damage that stops its
// Regeneration until the start of its next turn.
export const REGENERATION_STOPPED = "regeneration stopped";

// "The troll regains 10 hit points at the start of its turn. If the troll
// takes acid or fire damage, this trait doesn't function at the start of
// the troll's next turn."
export function parseRegeneration(text: string): Regeneration | null {
  const amount = /regains (\d{1,3}) hit points at the start of its turn/i.exec(text);
  if (!amount) {
    return null;
  }
  const stop = /takes ([a-z ,]+?) damage(?: or damage from [^,.]+)?,? this trait doesn't function/i.exec(text);
  const stoppedBy = stop ? DAMAGE_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(stop[1])) : [];
  const diesOnlyAtTurnStart = /dies only if it starts its turn with 0 hit points/i.test(text);
  return { amount: Number(amount[1]), stoppedBy, ...(diesOnlyAtTurnStart ? { diesOnlyAtTurnStart: true } : {}) };
}

// The block's Regeneration: parsed with the block, or read from its trait
// line for a block written by hand.
export function regenerationOf(stats: { regeneration?: Regeneration; traits?: string[] }): Regeneration | null {
  if (stats.regeneration) {
    return stats.regeneration;
  }
  const line = (stats.traits ?? []).find((entry) => /^regeneration\b/i.test(entry.trim()));
  return line ? parseRegeneration(line) : null;
}

// ---- traits the engine reads ----

const TRAIT_FLAGS = {
  magicResistance: /^magic resistance\b/i,
  packTactics: /^pack tactics\b/i,
  nimbleEscape: /^nimble escape\b/i,
  sunlightSensitivity: /^sunlight sensitivity\b/i,
  undeadFortitude: /^undead fortitude\b/i,
  regeneration: /^regeneration\b/i,
  magicWeapons: /^magic weapons\b/i,
} as const;

export type TraitFlag = keyof typeof TRAIT_FLAGS;

// Whether the block carries a named trait. Traits are stored as "Name: text"
// lines, so the name is the start of the line.
export function hasTrait(stats: { traits?: string[] } | undefined, flag: TraitFlag): boolean {
  return (stats?.traits ?? []).some((line) => TRAIT_FLAGS[flag].test(line.trim()));
}

// Trait names statblock.ts keeps whatever the cap on trait lines, because
// the engine reads them.
export const ENGINE_TRAIT_NAMES = /^(magic resistance|pack tactics|nimble escape|sunlight sensitivity|undead fortitude|regeneration|magic weapons|legendary resistance|spellcasting|innate spellcasting|keen (?:sight|hearing|smell|senses)|(?:acid|cold|fire|lightning|thunder) absorption|immutable form|limited magic immunity|martial advantage|surprise attack)\b/i;
