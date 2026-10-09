import { baseDamageDice, baseHealingDice, damageTypeFor, halfOnSaveFor, saveAbilityFor } from "@/lib/srd/spell-scaling";
import { normalizeSpellMech } from "@/lib/homebrew/gear";
import { mechSpellDamage } from "@/lib/srd/spell-dice";

// The spell editor's preview (src/app/workshop/homebrew/SpellFields.tsx):
// what the engine resolves for a draft, worked out the way the server works
// it out for the saved spell (src/lib/content/index.ts spellDamageFor), so
// the line the DM reads is the one the table rolls.

type Data = Record<string, unknown>;

// What the engine resolves for this draft, as one line, and the places the
// words and the block disagree (the block wins; the words are for players).
export function effectiveSpellPreview(data: Data): { line: string; conflicts: string[] } {
  const desc = String(data.desc ?? "");
  const mech = normalizeSpellMech(data.mech);
  const level = typeof data.level === "number" ? data.level : 1;
  const read = { dice: baseDamageDice(desc), heal: baseHealingDice(desc), save: saveAbilityFor(desc), half: halfOnSaveFor(desc), type: damageTypeFor(desc) };
  const rolled = mechSpellDamage({
    spell: String(data.runsAs ?? ""),
    mech,
    spellLevel: level,
    casterLevel: 1,
    desc,
    higherLevel: String(data.higher_level ?? ""),
  });
  const fromBlock = Boolean(mech?.dice || mech?.darts);
  const dice = rolled?.dice ?? null;
  const type = mech?.damageType ?? read.type;
  const save = mech?.save ?? read.save;
  const half = mech ? Boolean(mech.halfOnSave) : read.half;
  const heals = mech?.resolution === "heal" || (!mech && !dice && read.heal);
  const parts: string[] = [];
  if (mech?.noDamage || mech?.resolution === "utility" || mech?.resolution === "summon") {
    parts.push("rolls no damage (the block says so)");
  } else if (heals) {
    parts.push(`heals ${read.heal ?? "what the block says"}`);
  } else if (dice) {
    parts.push(`${dice}${type ? ` ${type}` : ""} damage at level ${level} (${fromBlock ? "from the block's dice" : "read from the description"})`);
  } else {
    parts.push("no dice");
  }
  if (save) parts.push(`${save.toUpperCase()} save${half ? ", half on a success" : ""}${mech?.save ? " (from the block)" : ""}`);
  if (mech?.resolution === "attack") parts.push("a spell attack roll");
  const conflicts: string[] = [];
  if (fromBlock && read.dice && mech?.dice && read.dice.replace(/\s+/g, "") !== String(mech.dice.base).replace(/\s+/g, "")) {
    conflicts.push(`The description says ${read.dice}, the block ${mech.dice.base}: the table rolls the block's. Change the dice in the block below, or clear them there to read the words.`);
  }
  if (mech?.save && read.save && mech.save !== read.save) {
    conflicts.push(`The description asks a ${read.save.toUpperCase()} save, the block a ${mech.save.toUpperCase()} save: the block's is rolled.`);
  }
  if (mech?.damageType && read.type && mech.damageType !== read.type) {
    conflicts.push(`The description says ${read.type} damage, the block ${mech.damageType}: the block's type is dealt.`);
  }
  if ((mech?.noDamage || mech?.resolution === "utility") && read.dice) {
    conflicts.push(`The description mentions ${read.dice}, but the block deals no damage: none is rolled.`);
  }
  return { line: parts.join(", "), conflicts };
}
