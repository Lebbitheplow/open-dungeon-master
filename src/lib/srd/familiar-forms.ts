// The shapes a familiar can take (Find Familiar, SRD 5.1) and the four
// Pact of the Chain adds, each with its form's stat block from the SRD
// creature table (src/lib/srd/srd-creatures.ts). summon_pet and cast_buff
// accept these forms (src/lib/dm/pet-tools.ts buildPet); the DM console's
// picker in the browser reads their names alone (srd-creature-names.json).

import { findNamed, namesHolding } from "@/lib/language/text-logic";
import type { SheetPet } from "@/lib/schemas/sheet";
import { CHAIN_FORM_NAMES, FAMILIAR_FORM_NAMES, SRD_CREATURES, senseWords, traitName, type SrdCreature } from "@/lib/srd/srd-creatures";
import { findBeastForm } from "@/lib/srd/beast-forms";

export type FamiliarForm = Pick<SheetPet, "form" | "hp" | "maxHp" | "ac" | "speed" | "notes" | "attacks" | "resist" | "immune" | "vulnerable"> & {
  // The other names the spell gives the form ("toad" for the frog).
  aliases: string[];
  chainOnly?: boolean;
};

// The form's movement, senses and traits by name, short enough for the pet
// record's notes with the familiar's own rules after them.
function familiarNotes(creature: SrdCreature): string {
  const modes = (["fly", "swim", "climb", "burrow"] as const)
    .filter((mode) => creature.speeds[mode])
    .map((mode) => `${mode} ${creature.speeds[mode]} ft.`);
  const parts = [modes.join(", "), senseWords(creature.senses), creature.immune ? `immune to ${creature.immune}` : ""].filter(Boolean);
  const names = creature.traits.map(traitName);
  let notes = [...parts, names.join(", ")].filter(Boolean).join("; ");
  while (notes.length > 150 && names.length) {
    names.pop();
    notes = [...parts, names.join(", ")].filter(Boolean).join("; ");
  }
  return notes ? `${notes.charAt(0).toUpperCase()}${notes.slice(1)}.` : "";
}

// The damage a creature's block resists, is immune or vulnerable to, as a
// pet record keeps it: only the lines the block has.
export function creatureDefenses(creature: Pick<SrdCreature, "resist" | "immune" | "vulnerable">): Pick<SheetPet, "resist" | "immune" | "vulnerable"> {
  return {
    ...(creature.resist ? { resist: creature.resist } : {}),
    ...(creature.immune ? { immune: creature.immune } : {}),
    ...(creature.vulnerable ? { vulnerable: creature.vulnerable } : {}),
  };
}

function familiarForm(creature: SrdCreature, aliases: string[], chainOnly: boolean): FamiliarForm {
  return {
    form: creature.name,
    hp: creature.hp,
    maxHp: creature.hp,
    ac: creature.ac,
    speed: creature.speeds.walk,
    notes: familiarNotes(creature),
    // A familiar cannot attack (Find Familiar); Pact of the Chain's forms
    // fight with their stat blocks' attacks.
    attacks: chainOnly ? creature.attacks.slice(0, 3).map((attack) => ({ ...attack })) : [],
    ...creatureDefenses(creature),
    aliases,
    ...(chainOnly ? { chainOnly: true } : {}),
  };
}

const creatureNamed = (name: string): SrdCreature => {
  const creature = findNamed(SRD_CREATURES, name, (entry) => [entry.name]);
  if (!creature) {
    throw new Error(`The SRD creature table has no ${name} for Find Familiar.`);
  }
  return creature;
};

export const FAMILIAR_FORMS: FamiliarForm[] = [
  ...FAMILIAR_FORM_NAMES.map((entry) => familiarForm(creatureNamed(entry.name), entry.aliases ?? [], false)),
  ...CHAIN_FORM_NAMES.map((name) => familiarForm(creatureNamed(name), [], true)),
];

// The form a caller names, by its whole name or another the spell gives it.
export function findFamiliarForm(term: string): FamiliarForm | null {
  return findNamed(FAMILIAR_FORMS, term, (entry) => [entry.form, ...entry.aliases]);
}

// The forms whose name holds a word a refused name was, for the refusal.
export function familiarFormsHolding(term: string): string[] {
  return namesHolding(FAMILIAR_FORMS, term, (entry) => [entry.form, ...entry.aliases]).map((entry) => entry.form);
}

// The forms a caster can be offered: Pact of the Chain's four with it.
export function familiarOffer(chain: boolean): string {
  return FAMILIAR_FORMS.filter((entry) => chain || !entry.chainOnly).map((entry) => entry.form.toLowerCase()).join(", ");
}

// A pet as the table now builds it: Pact of the Chain's forms stored before
// the creature table carry the attacks this server once invented (the imp's
// sting as one "1d4+3+3d6" roll, its poison no save), so a familiar whose
// form the table knows fights with the table's attacks, and one that cannot
// attack keeps none. Familiars and Beast Master companions stored before the
// pet record kept defenses take their form's (issue 520): an imp shrugs off
// fire again. Read on every load (src/lib/db/sheets.ts), so a sheet saved
// before the fix is right the first time it is read.
export function repairedPets(pets: SheetPet[]): SheetPet[] {
  let changed = false;
  const out = pets.map((pet) => {
    const form = pet.kind === "familiar" ? findFamiliarForm(pet.form) : null;
    const beast = pet.kind === "beast_companion" ? findBeastForm(pet.form) : null;
    if (!form && !beast) {
      return pet;
    }
    let next = pet;
    if (form && JSON.stringify(pet.attacks ?? []) !== JSON.stringify(form.attacks)) {
      next = { ...next, attacks: form.attacks.map((attack) => ({ ...attack })) };
    }
    const defenses = form ? creatureDefenses(form) : creatureDefenses(beast!);
    if ((["resist", "immune", "vulnerable"] as const).some((key) => (pet[key] ?? "") !== (defenses[key] ?? ""))) {
      const { resist: _resist, immune: _immune, vulnerable: _vulnerable, ...rest } = next;
      void _resist;
      void _immune;
      void _vulnerable;
      next = { ...rest, ...defenses };
    }
    if (next !== pet) {
      changed = true;
    }
    return next;
  });
  return changed ? out : pets;
}

// Every form's name, the Pact of the Chain forms included.
export function familiarFormNames(): string[] {
  return FAMILIAR_FORMS.map((entry) => entry.form);
}
