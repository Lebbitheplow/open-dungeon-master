// A Pact of the Blade warlock's pact weapon, and the invocations that ride it
// (issue #570, the SRD text audit, CLS-12 to CLS-14). SRD 5.1, warlock:
//
// - Pact of the Blade: "You can use your action to create a pact weapon in
//   your empty hand. You can choose the form that this melee weapon takes
//   each time you create it. You are proficient with it while you wield it.
//   This weapon counts as magical for the purpose of overcoming resistance
//   and immunity to nonmagical attacks and damage."
// - Thirsting Blade: "You can attack with your pact weapon twice, instead of
//   once, whenever you take the Attack action on your turn."
// - Lifedrinker: "When you hit a creature with your pact weapon, the
//   creature takes extra necrotic damage equal to your Charisma modifier
//   (minimum 1)."
//
// Before this nothing read the pact: a blade warlock made one mundane attack
// a turn at every level. Nothing on a sheet says which weapon the pact made
// (it takes any melee form with an action, and a magic weapon can be bound
// to it), so a Pact of the Blade warlock's melee weapon is read as the pact
// weapon. Pure, for the attack engines and the turn budget.
import { chosenOptions } from "@/lib/srd/options";
import { matchWeapon } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";
import type { EquipmentItem } from "@/lib/schemas/sheet";

type Features = { features: ReadonlyArray<{ name: string }> };

function holdsOption(sheet: Features, kind: "pact_boon" | "invocation", name: string): boolean {
  const wanted = textKey(name);
  return chosenOptions([...sheet.features], kind).some((option) => textKey(option) === wanted);
}

export function holdsPactOfTheBlade(sheet: Features): boolean {
  return holdsOption(sheet, "pact_boon", "Pact of the Blade");
}

// Whether a weapon attack is made with the pact weapon: a melee weapon (not
// an unarmed strike or an improvised one) in a Pact of the Blade warlock's
// hand.
export function pactWeaponAttack(
  sheet: Features,
  kind: "weapon" | "spell" | "natural" | "granted",
  profile: { ranged: boolean; unarmed?: boolean; improvised: boolean },
): boolean {
  return kind === "weapon" && !profile.ranged && !profile.unarmed && !profile.improvised && holdsPactOfTheBlade(sheet);
}

// Thirsting Blade's second attack: the warlock holds the invocation and a
// melee weapon to make it with. Extra Attack features do not add together,
// so the caller takes the larger.
export function thirstingBladeAttacks(sheet: Features & { equipment: ReadonlyArray<EquipmentItem> }): number {
  if (!holdsOption(sheet, "invocation", "Thirsting Blade") || !holdsPactOfTheBlade(sheet)) {
    return 0;
  }
  return sheet.equipment.some((item) => item.equipped === true && matchWeapon(item)?.kind === "melee") ? 1 : 0;
}

// Lifedrinker's necrotic rider on a pact weapon hit: the Charisma modifier,
// at least 1. Null without the invocation.
export function lifedrinkerDamage(sheet: Features & { abilities: { cha: number } }): number | null {
  if (!holdsOption(sheet, "invocation", "Lifedrinker")) {
    return null;
  }
  return Math.max(1, Math.floor((sheet.abilities.cha - 10) / 2));
}
