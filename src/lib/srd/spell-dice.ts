// The dice a spell rolls once its mechanics row is known: the one rule the
// engine's spellDamageFor (src/lib/content/index.ts) and the Hand's spell
// cards (src/lib/battlemap/hand-spells.ts) both read, so a card never shows
// dice the engine would not roll. The row decides first (Magic Missile's
// darts, an authored dice line, a spell that deals no damage whatever its
// prose mentions, such as Web's burning strands); the prose is parsed only
// when the row says nothing; the baked SRD answers cover a server with no
// content pack. Pure, no database.
import { bakedSpellDamage } from "@/lib/content/baked-spells";
import type { SpellMech } from "@/lib/srd/spell-mech-types";
import { addDice, scaledSpellDice } from "@/lib/srd/spell-scaling";

export function mechSpellDamage(input: {
  spell: string;
  mech: SpellMech | null;
  spellLevel: number;
  casterLevel: number;
  slotLevel?: number;
  // Magic Missile: how many of the darts are meant, all of them when absent.
  darts?: number;
  // The spell's own text, when a pack or the authored layer has it.
  desc: string;
  higherLevel: string;
}): { dice: string; note: string } | null {
  const { mech, spellLevel } = input;
  const slotLevel = Math.max(spellLevel, Math.floor(input.slotLevel ?? spellLevel));
  if (mech?.hitPointPool) {
    // A pool of hit points is not damage.
    return null;
  }
  if (mech?.darts) {
    const held = mech.darts.count + mech.darts.perSlotLevel * (slotLevel - spellLevel);
    const thrown = Math.max(1, Math.min(held, Math.floor(input.darts ?? held)));
    const [die, flat] = mech.darts.each.split("+");
    const sides = die.split("d")[1];
    return {
      dice: `${thrown}d${sides}${flat ? `+${Number(flat) * thrown}` : ""}`,
      note: `${thrown} of ${held} darts of ${mech.darts.each}`,
    };
  }
  if (mech?.dice) {
    const above = Math.max(0, slotLevel - mech.dice.baseLevel);
    const dice = mech.dice.perSlotLevel ? addDice(mech.dice.base, mech.dice.perSlotLevel, above) : mech.dice.base;
    return { dice, note: above ? `upcast to level ${slotLevel}: ${dice}` : `${dice} at its base level` };
  }
  // A spell that deals no damage whatever its text mentions in passing
  // (Web's burning strands), and one that restores a number rather than
  // dice (Heal), roll nothing here.
  if (mech?.resolution === "utility" || mech?.resolution === "summon" || mech?.noDamage || mech?.healing || mech?.healPool || mech?.revive) {
    return null;
  }
  if (!input.desc) {
    // No pack and no authored text: the answers baked from the SRD row.
    const baked = bakedSpellDamage(input.spell, spellLevel, input.casterLevel, slotLevel);
    return baked ? { dice: baked.dice, note: baked.note } : null;
  }
  return scaledSpellDice({
    spellLevel,
    desc: input.desc,
    higherLevel: input.higherLevel,
    casterLevel: input.casterLevel,
    slotLevel: input.slotLevel,
  });
}
