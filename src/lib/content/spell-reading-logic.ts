// A spell's reading (reading-logic.ts): the hand-written row when one
// exists (spellMechFor), else what parseSpellMech reads from the prose, and
// what the prose holds that the reading lacks. content/index.ts
// spellMechanicsFor plays a spell with exactly this answer.

import { parseSpellMech, spellMechFor, WEAPON_ATTACK, type SpellMech } from "@/lib/srd/spell-mechanics";
import { reading, readingChecked, type EntryReading, type ReadingRow } from "@/lib/content/reading-logic";

const ABILITY = "strength|dexterity|constitution|intelligence|wisdom|charisma";
const DAMAGE_TYPE = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";
const CONDITION =
  "blinded|charmed|deafened|frightened|grappled|incapacitated|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious";

// A save the spell makes someone roll ("must make a Dexterity saving
// throw", "succeed on a Wisdom saving throw"), not one it helps with ("has
// advantage on Wisdom saving throws").
const FORCED_SAVE = new RegExp(
  `\\b(?:must|makes?|to|can|unless|with|gets? a failure on|fails?) (?:it )?(?:make |makes |succeed on |succeeds on |attempt )?an? (?:successful )?(?:DC \\d+ )?(?:${ABILITY}) saving throw\\b|\\ba successful (?:DC \\d+ )?(?:${ABILITY}) saving throw\\b`,
  "i",
);
const SPELL_ATTACK = /\bmake (?:a|one) (?:melee|ranged) spell attack/i;
const TYPED_DAMAGE = new RegExp(`\\d+d\\d+[^.]{0,30}?\\b(?:${DAMAGE_TYPE})\\b\\s+damage`, "i");
const HEALING = /\b(?:regains?|restores?)\b[^.]{0,40}?\d+d\d+[^.]{0,40}?hit points|\bregains? (?:a number of )?hit points equal to/i;
const SAVE_CONDITION = new RegExp(`saving throw,? or (?:be |become |fall |is )?(?:knocked |pushed )?(?:${CONDITION})\\b`, "i");
// A lasting bonus the spell gives ("gains a +2 bonus to AC", "has
// advantage on", "resistance to"), which parseSpellMech never reads: only a
// hand-written row can make a spell a buff.
const BUFF =
  /\b(?:gains?|has|have) (?:a \+\d+ bonus to|advantage on|resistance to)\b|\+\d+ bonus to (?:its |their |your |the target's )?(?:ac|armor class|attack rolls|saving throws|damage rolls)\b|\badds? (?:a )?d\d+ to\b|\ban armor class of \d+/i;

// Typed damage dice the spell deals to someone other than its caster (a
// conjurer's "you take 1d6 psychic damage" is the price, not the spell).
function damagesSomeoneElse(desc: string): boolean {
  return desc
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => TYPED_DAMAGE.test(sentence) && !/\byou\b[^.]{0,80}?\btakes?\b/i.test(sentence));
}

// What the prose plainly holds that a parsed reading does not carry.
export function spellUnread(desc: string, mech: SpellMech | null): string[] {
  const unread: string[] = [];
  const resolution = mech?.resolution ?? null;
  if (SPELL_ATTACK.test(desc) && resolution !== "attack") {
    unread.push("attack");
  }
  if (WEAPON_ATTACK.test(desc) && !mech) {
    unread.push("weapon attack");
  }
  if (FORCED_SAVE.test(desc) && !mech?.save) {
    unread.push("save");
  }
  if (resolution !== "heal" && damagesSomeoneElse(desc)) {
    if (!mech) {
      unread.push("damage");
    } else if (!mech.damageType && (resolution === "attack" || resolution === "save" || resolution === "auto")) {
      unread.push("damage type");
    }
  }
  if (HEALING.test(desc) && !/can't regain hit points/i.test(desc) && resolution !== "heal") {
    unread.push("healing");
  }
  if (SAVE_CONDITION.test(desc) && !mech?.condition) {
    unread.push("condition");
  }
  if (BUFF.test(desc) && resolution !== "buff" && !mech?.buff) {
    unread.push("buff");
  }
  return unread;
}

export function readSpell(row: ReadingRow): EntryReading {
  const desc = String(row.data.desc ?? "");
  const handWritten = spellMechFor([row.name, ...(row.aliases ?? [])]);
  const parsed = handWritten
    ? null
    : parseSpellMech({ desc, higherLevel: String(row.data.higher_level ?? ""), duration: String(row.data.duration ?? "") });
  return reading({
    handWritten,
    parsed,
    unread: handWritten ? [] : spellUnread(desc, parsed),
    checked: readingChecked("spell", row),
  });
}
