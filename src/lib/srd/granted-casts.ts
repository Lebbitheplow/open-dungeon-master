// Spells a character casts through something other than their class's spell
// lists: an Eldritch Invocation or a racial trait (issue #570, the SRD text
// audit, CLS-17, CLS-18, CLS-23 and CLS-24). Before this the cast guard read
// only the sheet's lists, so a warlock's Armor of Shadows was refused as a
// spell they do not know, and a tiefling fighter's Infernal Legacy as a cast
// by someone with no Spellcasting feature.
//
// SRD 5.1, warlock, Eldritch Invocations: "You can cast mage armor on
// yourself at will, without expending a spell slot or material components"
// (and the other at-will ones), and "You can cast bane once using a warlock
// spell slot. You can't do so again until you finish a long rest" (and the
// other once-a-rest ones). Tiefling, Infernal Legacy: "you can cast the
// hellish rebuke spell as a 2nd-level spell once with this trait and regain
// the ability to do so when you finish a long rest ... Charisma is your
// spellcasting ability for these spells." High elf, Cantrip: "Intelligence
// is your spellcasting ability for it."
//
// Pure: the cast guard (src/lib/dm/cast-guard.ts), the spell DC and attack
// (src/lib/srd/index.ts) and the counters (class-resources.ts) read it.
import type { Ability } from "@/lib/schemas/sheet";
import { chosenOptions } from "@/lib/srd/options";
import { innateSpellAbility, innateSpellsFor, racialCantripAbility } from "@/lib/srd/racial-grants";
import { racialCantripsOf, type RacialCantripChoices } from "@/lib/srd/racial-cantrips";
import { asciiSlugOf, textKey } from "@/lib/language/text-logic";

export type GrantedCast = {
  // The invocation or trait that grants the cast.
  source: string;
  spell: string;
  // "free": no slot is spent (at will, or a trait's once a day); "slot": a
  // warlock spell slot pays, as for any cast.
  slot: "free" | "slot";
  // The once-a-long-rest counter, when the grant has one.
  counter?: string;
  // The level the spell is cast at, when the grant names one.
  castAt?: number;
  // The casting ability, when it is not the class's.
  ability?: Ability;
  // Cast on the caster only ("on yourself").
  selfOnly?: boolean;
  // No material component is needed.
  noMaterial?: boolean;
  // What the GM still holds of the grant.
  note?: string;
};

type InvocationSpell = Omit<GrantedCast, "source" | "counter"> & { invocation: string };

// The SRD 5.1 invocations that cast a spell.
const INVOCATION_SPELLS: InvocationSpell[] = [
  { invocation: "Armor of Shadows", spell: "Mage Armor", slot: "free", selfOnly: true, noMaterial: true },
  { invocation: "Ascendant Step", spell: "Levitate", slot: "free", selfOnly: true, noMaterial: true },
  { invocation: "Beast Speech", spell: "Speak with Animals", slot: "free" },
  { invocation: "Chains of Carceri", spell: "Hold Monster", slot: "free", noMaterial: true, note: "Chains of Carceri targets a celestial, fiend or elemental only, and not the same creature again until a long rest." },
  { invocation: "Eldritch Sight", spell: "Detect Magic", slot: "free" },
  { invocation: "Fiendish Vigor", spell: "False Life", slot: "free", castAt: 1, selfOnly: true, noMaterial: true },
  { invocation: "Mask of Many Faces", spell: "Disguise Self", slot: "free" },
  { invocation: "Master of Myriad Forms", spell: "Alter Self", slot: "free" },
  { invocation: "Misty Visions", spell: "Silent Image", slot: "free", noMaterial: true },
  { invocation: "Otherworldly Leap", spell: "Jump", slot: "free", selfOnly: true, noMaterial: true },
  { invocation: "Visions of Distant Realms", spell: "Arcane Eye", slot: "free" },
  { invocation: "Whispers of the Grave", spell: "Speak with Dead", slot: "free" },
  { invocation: "Bewitching Whispers", spell: "Compulsion", slot: "slot" },
  { invocation: "Dreadful Word", spell: "Confusion", slot: "slot" },
  { invocation: "Minions of Chaos", spell: "Conjure Elemental", slot: "slot" },
  { invocation: "Mire the Mind", spell: "Slow", slot: "slot" },
  { invocation: "Sculptor of Flesh", spell: "Polymorph", slot: "slot" },
  { invocation: "Sign of Ill Omen", spell: "Bestow Curse", slot: "slot" },
  { invocation: "Thief of Five Fates", spell: "Bane", slot: "slot" },
];

// The counter of a once-a-long-rest invocation: "invocation_thief_of_five_fates".
export const INVOCATION_COUNTER_PREFIX = "invocation_";

export function invocationCounterId(invocation: string): string {
  return `${INVOCATION_COUNTER_PREFIX}${asciiSlugOf(invocation)}`;
}

// The once-a-long-rest invocations a sheet holds, with their counters' ids
// and the spell each casts, for the resource table.
export function invocationCounters(features: ReadonlyArray<{ name: string }>): Array<{ id: string; invocation: string; spell: string }> {
  const held = new Set(chosenOptions([...features], "invocation").map(textKey));
  return INVOCATION_SPELLS.filter((row) => row.slot === "slot" && held.has(textKey(row.invocation))).map((row) => ({
    id: invocationCounterId(row.invocation),
    invocation: row.invocation,
    spell: row.spell,
  }));
}

// The invocation a counter id names, for its resource definition.
export function invocationOfCounter(id: string): InvocationSpell | null {
  return INVOCATION_SPELLS.find((row) => invocationCounterId(row.invocation) === id) ?? null;
}

type GrantSheet = {
  race: string;
  level: number;
  features?: ReadonlyArray<{ name: string }>;
  racialChoices?: RacialCantripChoices;
};

// Every spell the sheet casts through an invocation or its race.
export function grantedCastsOf(sheet: GrantSheet): GrantedCast[] {
  const out: GrantedCast[] = [];
  const invocations = new Set(chosenOptions([...(sheet.features ?? [])], "invocation").map(textKey));
  for (const row of INVOCATION_SPELLS) {
    if (invocations.has(textKey(row.invocation))) {
      const { invocation, ...cast } = row;
      out.push({ ...cast, source: invocation, ...(row.slot === "slot" ? { counter: invocationCounterId(invocation) } : {}) });
    }
  }
  const innateAbility = innateSpellAbility(sheet.race);
  for (const innate of innateSpellsFor(sheet.race, sheet.level)) {
    out.push({
      source: "the race's trait",
      spell: innate.name,
      slot: "free",
      ...(innate.counterId ? { counter: innate.counterId } : {}),
      ...(innate.castAt > 0 ? { castAt: innate.castAt } : {}),
      ...(innateAbility ? { ability: innateAbility } : {}),
    });
  }
  const cantripAbility = racialCantripAbility(sheet.race);
  for (const cantrip of racialCantripsOf(sheet.racialChoices)) {
    out.push({ source: "the race's cantrip", spell: cantrip, slot: "free", ...(cantripAbility ? { ability: cantripAbility } : {}) });
  }
  return out;
}

// The grant that casts this spell (any of its names), or null.
export function grantedCastFor(sheet: GrantSheet, names: ReadonlySet<string>): GrantedCast | null {
  return grantedCastsOf(sheet).find((grant) => names.has(textKey(grant.spell))) ?? null;
}

// The ability a race's spell is cast with (a high elf's cantrip, a
// tiefling's Infernal Legacy), or null when the spell is not the race's or
// the race names none.
export function grantedSpellAbility(sheet: GrantSheet, spell: string): Ability | null {
  return grantedCastFor(sheet, new Set([textKey(spell)]))?.ability ?? null;
}
