// Structured spell mechanics: what a spell actually resolves as, so the
// cast tools derive the save, the half-on-save rule, the damage type, the
// condition applied, and the buff granted from data instead of trusting the
// model's arguments.
//
// Three layers, first hit wins:
//   1. `mech` blocks authored per spell in authored-spells.json.
//   2. MECH_OVERRIDES (spell-mech-overrides.ts), for the widely played SRD
//      spells whose effect (a buff, a named condition) cannot be parsed from
//      prose, or is parsed wrong.
//   3. The prose parsers in spell-scaling.ts, which read the SRD's regular
//      phrasing. content/index.ts spellMechanicsFor combines all three.
//
// Pure and dependency-light so scripts/test-spell-mechanics.mjs can exercise
// every branch without the content database.

import { ROUND_CEILING } from "@/lib/schemas/condition-meta";
import authoredSpellsJson from "@/lib/srd/authored-spells.json";
import {
  attackKindFor,
  baseDamageDice,
  baseHealingDice,
  conditionAppliedFor,
  damageTypeFor,
  halfOnSaveFor,
  saveAbilityFor,
} from "@/lib/srd/spell-scaling";
import { MECH_OVERRIDES } from "@/lib/srd/spell-mech-overrides";
import type { SpellMech } from "@/lib/srd/spell-mech-types";

export type { SpellAura, SpellCondition, SpellMech } from "@/lib/srd/spell-mech-types";
export { MECH_OVERRIDES };

type AuthoredSpellRow = {
  name: string;
  level: number;
  concentration?: boolean;
  duration?: string;
  desc: string;
  higher_level?: string;
  mech?: SpellMech;
};

const AUTHORED_SPELLS = (authoredSpellsJson as unknown as { spells: AuthoredSpellRow[] }).spells;

function normalize(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const AUTHORED_MECH = new Map<string, { row: AuthoredSpellRow; mech: SpellMech }>();
for (const row of AUTHORED_SPELLS) {
  if (row.mech) {
    AUTHORED_MECH.set(normalize(row.name), { row, mech: row.mech });
  }
}

// The authored row for a spell name, mech or not (for level/concentration
// when the content database is absent).
export function authoredSpellRow(name: string): AuthoredSpellRow | null {
  const wanted = normalize(name);
  return AUTHORED_SPELLS.find((row) => normalize(row.name) === wanted) ?? null;
}

// Layer 1 + 2: an authored or overridden mechanics row for any of a spell's
// names, or null. Callers pass the canonical name plus aliases.
export function spellMechFor(names: string[]): SpellMech | null {
  // The SRD's names drop the wizard who wrote the spell ("Evard's Black
  // Tentacles" is "Black Tentacles"); a name kept with it finds the same row.
  const bare = names.map((name) => name.replace(/^\s*[a-z]+'s\s+/i, ""));
  for (const name of [...names, ...bare]) {
    const wanted = normalize(name);
    const authored = AUTHORED_MECH.get(wanted);
    if (authored) {
      return authored.mech;
    }
    const override = MECH_OVERRIDES[wanted];
    if (override) {
      return override;
    }
  }
  return null;
}

// Layer 3: mechanics parsed from SRD-regular prose. Null when the text
// yields nothing actionable (a pure-utility spell). `duration` is the row's
// duration line ("Up to 1 minute"), which a parsed condition lasts when the
// text gives it no repeat save.
export function parseSpellMech(input: { desc: string; higherLevel?: string; duration?: string }): SpellMech | null {
  const desc = input.desc;
  const attack = attackKindFor(desc);
  if (attack) {
    const type = damageTypeFor(desc);
    return { resolution: "attack", attack, ...(type ? { damageType: type } : {}) };
  }
  const save = saveAbilityFor(desc);
  if (save) {
    const type = damageTypeFor(desc);
    const condition = conditionAppliedFor(desc);
    const area = areaOf(desc);
    return {
      resolution: "save",
      save,
      halfOnSave: halfOnSaveFor(desc),
      ...(type ? { damageType: type } : {}),
      ...(condition ? { condition: parsedCondition(condition, desc, input.duration) } : {}),
      ...(area ? { area: true, areaFeet: area } : {}),
    };
  }
  if (baseHealingDice(desc)) {
    return { resolution: "heal" };
  }
  const damage = baseDamageDice(desc);
  if (damage && !damageIsTheCastersOwn(desc)) {
    const type = damageTypeFor(desc);
    return { resolution: "auto", ...(type ? { damageType: type } : {}) };
  }
  return null;
}

// How long a condition read from prose lasts. A repeat save only when the
// text grants one ("at the end of each of its turns"); prone lasts until the
// creature stands; anything else lasts the spell's duration, or with no
// duration to read, until something ends it.
function parsedCondition(name: string, desc: string, duration?: string): NonNullable<SpellMech["condition"]> {
  const repeats =
    /end\s+of\s+each\s+of\s+its\s+turns[^.]{0,120}saving\s+throw/i.test(desc) ||
    /repeat\s+the\s+saving\s+throw/i.test(desc) ||
    /saving\s+throw\s+at\s+the\s+end\s+of\s+each\s+of\s+its\s+turns/i.test(desc);
  if (repeats) {
    return { name, saveEnds: true };
  }
  if (name === "prone") {
    return { name };
  }
  const rounds = durationRounds(duration);
  return rounds ? { name, rounds } : { name };
}

// "Up to 1 minute" is 10 rounds, "1 hour" 600, "8 hours" 4800; a day is the
// most a condition counts. Instantaneous and unreadable lines are null.
export function durationRounds(duration?: string): number | null {
  const match = /(\d+)\s+(round|minute|hour|day)s?/i.exec(duration ?? "");
  if (!match) {
    return null;
  }
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const rounds = unit === "round" ? count : unit === "minute" ? count * 10 : unit === "hour" ? count * 600 : count * 14400;
  // Days stay days (Antipathy/Sympathy's ten, Geas's thirty): src/lib/schemas/condition-meta.ts.
  return Math.max(1, Math.min(ROUND_CEILING, rounds));
}

// The size of an area a text describes ("a 20-foot-radius sphere", "a
// 15-foot cone", "a 100-foot line"), in feet, or null for a single target.
export function areaOf(desc: string): number | null {
  const match =
    /(\d+)-foot(?:-radius|-diameter)?[\s-]+(?:radius|cube|cone|line|sphere|square|cylinder|emanation)/i.exec(desc) ??
    /(\d+)-foot[- ]radius/i.exec(desc);
  if (!match) {
    return null;
  }
  const caught = /\b(each|every|all|any)\s+creatures?\b[^.]{0,80}\b(in|within)\b/i.test(desc);
  return caught ? Number(match[1]) : null;
}

// Whether the only damage a text speaks of is what the caster suffers when
// the spell goes wrong ("you and any creature traveling with you each take
// 4d6 force damage"). That is a mishap, not what the spell does to a target.
function damageIsTheCastersOwn(desc: string): boolean {
  const sentences = desc.split(/(?<=[.!?])\s+/).filter((sentence) => /\d+d\d+/.test(sentence) && /damage/i.test(sentence));
  return sentences.length > 0 && sentences.every((sentence) => /\byou\b[^.]{0,80}?\btake\b/i.test(sentence));
}

// How many creatures an area spell with no printed count may take from one
// casting. The area decides who is caught; this only bounds the calls.
export const AREA_SHARES = 20;

// How many attack rolls, darts or targets one casting holds: what the row
// states at the spell's own level, more from a higher slot, and for a cantrip
// that grows with its caster one more at 5th, 11th and 17th level. An area
// spell with no printed count holds everyone in its area.
export function castShares(
  mech: SpellMech | null,
  input: { spellLevel: number; slotLevel: number | null; casterLevel: number },
): number {
  const above = Math.max(0, (input.slotLevel ?? input.spellLevel) - input.spellLevel);
  if (mech?.darts) {
    return mech.darts.count + mech.darts.perSlotLevel * above;
  }
  if (mech?.healPool) {
    return mech.healPool;
  }
  const rule = mech?.attacks ?? mech?.targets ?? null;
  if (!rule) {
    return mech?.area ? AREA_SHARES : 1;
  }
  if ("byCasterLevel" in rule && rule.byCasterLevel) {
    const level = input.casterLevel;
    return rule.count + (level >= 17 ? 3 : level >= 11 ? 2 : level >= 5 ? 1 : 0);
  }
  return rule.count + (rule.perSlotLevel ?? 0) * above;
}
