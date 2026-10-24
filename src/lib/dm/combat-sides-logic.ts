// Which side of a fight each combatant is on (issue 503, Phase 6), the pure
// half. Every combatant has a side: the party's or the foes'. A character
// sheet starts on the party's side and an enemy row on the foes'; an
// encounter keeps only the exceptions (`sides`, combatant id to side), so a
// fight with no turncoat, no creature turned and no summon gone wild stores
// nothing at all.
//
// The side a combatant is on now is, in order:
//   1. a domination's: a creature a Dominate spell holds fights on its
//      dominator's side for as long as the charm lasts (the charm's meta
//      names the spell and its caster, so the side follows the condition and
//      ends with it, whichever way it ends);
//   2. the encounter's exception (a companion turned on the party, a summon
//      whose maker lost control of it, a character in a pact);
//   3. its kind's default.
// src/lib/dm/combatant.ts asks these against the table; everything that
// splits the fight into two camps (victory, the party's fall, who an attack
// may target, who flanks, whose aura helps, the token's colour) asks it.
//
// No "@/" imports, so the guard tests can load it directly.

export const COMBAT_SIDES = ["party", "foe"] as const;
export type CombatSide = (typeof COMBAT_SIDES)[number];

// A sheet (a player's character, a companion, a summon) or an enemy row.
export type CombatantKind = "sheet" | "enemy";

// The encounter's exceptions: combatant id to the side it is on, only for
// combatants not on their kind's default side.
export type SideExceptions = Record<string, CombatSide>;

export function isCombatSide(value: unknown): value is CombatSide {
  return value === "party" || value === "foe";
}

export function defaultSide(kind: CombatantKind): CombatSide {
  return kind === "sheet" ? "party" : "foe";
}

export function otherSide(side: CombatSide): CombatSide {
  return side === "party" ? "foe" : "party";
}

export function opposed(a: CombatSide, b: CombatSide): boolean {
  return a !== b;
}

// The side the encounter has a combatant on, before any domination.
export function storedSide(exceptions: SideExceptions, kind: CombatantKind, id: string): CombatSide {
  const side = exceptions[id];
  return isCombatSide(side) ? side : defaultSide(kind);
}

// The exceptions with one combatant moved: a move back to the kind's default
// side takes the entry out, so an encounter where everyone is home stores {}.
export function withSide(exceptions: SideExceptions, kind: CombatantKind, id: string, side: CombatSide): SideExceptions {
  const next: SideExceptions = { ...exceptions };
  if (side === defaultSide(kind)) {
    delete next[id];
  } else {
    next[id] = side;
  }
  return next;
}

// What a stored sides_json holds, with anything that is not a side dropped.
export function normalizeSides(raw: unknown): SideExceptions {
  const out: SideExceptions = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  for (const [id, side] of Object.entries(raw as Record<string, unknown>)) {
    if (id && isCombatSide(side)) {
      out[id] = side;
    }
  }
  return out;
}

// A character sheet seen by the paths that strike, curse and save a foe: an
// enemy-shaped view whose id is the sheet's and whose slug is this
// (src/lib/dm/sheet-foe.ts). The writes those paths make by that id land on
// the sheet, and its damage, saves and Armor Class are the sheet's own.
export const SHEET_FOE_SLUG = "sheet";

export function isSheetFoe(enemy: { slug?: string } | null | undefined): boolean {
  return enemy?.slug === SHEET_FOE_SLUG;
}

// The spells whose charm hands the creature to its caster (SRD 5.1: "you
// can use this telepathic link to issue commands to the creature"). A charm
// from anything else (Charm Person, a vampire's gaze) leaves the creature
// where it was: it is friendly to the charmer, not fighting for them.
const DOMINATIONS = ["dominate person", "dominate beast", "dominate monster"];

export function isDominationSpell(spell: unknown): boolean {
  return typeof spell === "string" && DOMINATIONS.includes(spell.trim().toLowerCase());
}

type ConditionMetaLike = Record<string, { spell?: unknown; source?: unknown } | undefined>;

// Who dominates this creature, by combatant id, or null: a "charmed" whose
// meta names a Dominate spell and its caster.
export function dominatorOf(conditions: readonly string[], meta: ConditionMetaLike | null | undefined): string | null {
  const charmed = conditions.find((entry) => entry.trim().toLowerCase() === "charmed");
  if (!charmed) {
    return null;
  }
  const entry = meta?.[charmed];
  return entry && isDominationSpell(entry.spell) && typeof entry.source === "string" && entry.source ? entry.source : null;
}

// The standing order a dominated creature was given (SRD 5.1: "a simple and
// general course of action, such as 'Attack that creature'"), kept on the
// charm's meta: the creature it was told to attack, or null.
export function dominationOrderOf(conditions: readonly string[], meta: Record<string, Record<string, unknown> | undefined> | null | undefined): string | null {
  const charmed = conditions.find((entry) => entry.trim().toLowerCase() === "charmed");
  const order = charmed ? meta?.[charmed]?.order : undefined;
  return typeof order === "string" && order ? order : null;
}

// A hostile sheet dropping to 0 hit points (the rule this phase decides).
// SRD 5.1, Monsters and Death: most monsters die at 0, but "mighty villains
// and special nonplayer characters are common exceptions; the DM might have
// them fall unconscious and follow the same rules as player characters". A
// character who turns on the party is exactly such a character, and its
// story goes on (a rival who returns, a redemption), so a sheet on the foes'
// side keeps every rule its sheet has: at 0 it falls unconscious and makes
// death saving throws like any character, a blow while it is down is a
// failed save (two on a critical hit), and massive damage kills it. It is out
// of the fight the moment it drops: victory does not wait for it to die, and
// it is left dying or stable at the party's mercy when the fight ends.
export function sheetOutOfFight(sheet: { currentHp: number; deathSaves?: { dead?: boolean } | null }): boolean {
  return sheet.currentHp <= 0 || sheet.deathSaves?.dead === true;
}
