"use client";
// The workshop's controls for the standing effects an SRD item's text gives
// beyond a bonus, a set score and a resistance (src/lib/srd/magic-items.ts):
// a raised score (Belt of Dwarvenkind), an immunity (Periapt of Proof
// against Poison), a speed (Winged Boots), a spell attack or DC bonus (Robe
// of the Archmagi), and a weapon's training and damage (Bracers of Archery).
// Without them a copied item lost what it does on a sheet.

import type { ComponentProps } from "react";
import { IMMUNE_CONDITIONS, SPEED_MODES } from "@/lib/homebrew/item-data";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import { textKey } from "@/lib/language/text-logic";
import { CheckField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { DAMAGE_TYPES } from "@/app/workshop/homebrew/types";
import { FieldLabel } from "@/app/workshop/kit";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
const SPEED_LABELS: Record<(typeof SPEED_MODES)[number], string> = { fly: "Flying", swim: "Swimming", climb: "Climbing" };
// The SRD's own weapons, by the key the attack engine matches them on.
const WEAPON_KEYS = SRD_WEAPONS.filter((weapon) => weapon.category === "simple" || weapon.category === "martial").map((weapon) => textKey(weapon.name));
const WEAPON_LABELS = Object.fromEntries(SRD_WEAPONS.map((weapon) => [textKey(weapon.name), weapon.name]));

export const MORE_EFFECT_LABELS = {
  increase_ability: "Raises an ability score",
  immunity: "Damage immunity",
  condition_immunity: "Condition immunity",
  spell_attack_bonus: "Spell attack bonus",
  spell_dc_bonus: "Spell save DC bonus",
  spell_save_advantage: "Advantage on saves against spells",
  speed: "A speed",
  weapon_rider: "Training and damage with weapons",
} as const;

// What a newly picked kind starts as, each the SRD's commonest.
export function startingEffect(kind: MagicItemEffect["kind"]): MagicItemEffect {
  switch (kind) {
    case "set_ability":
      return { kind, ability: "str", score: 19 };
    case "resistance":
      return { kind, types: ["fire"] };
    case "increase_ability":
      return { kind, ability: "con", amount: 2, max: 20 };
    case "immunity":
      return { kind, types: ["poison"] };
    case "condition_immunity":
      return { kind, conditions: ["poisoned"] };
    case "spell_save_advantage":
      return { kind };
    case "speed":
      return { kind, mode: "fly", feet: "walk" };
    case "weapon_rider":
      return { kind, weapons: ["longbow", "shortbow"], ranged: true, damage: 2, proficient: true };
    default:
      return { kind, amount: 1 };
  }
}

// A stepper in a standing effect's row, with its caption in the form's
// caption style. The row is one line of controls, so the caption sits beside
// the figure rather than above it, and the same words name the stepper for a
// screen reader. Without it the Belt of Dwarvenkind's row read "2" and "20"
// with only the summary at its end to say which was which.
export function EffectStepper({ label, ...stepper }: ComponentProps<typeof NumberStepper>) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <NumberStepper label={label} {...stepper} />
    </span>
  );
}

const abilityOptions = ABILITIES.map((ability) => ({
  value: ability,
  label: ability.toUpperCase(),
  icon: { kind: "glyph" as const, key: `ability-${ability}` },
}));

export function MoreEffectFields({ effect, update }: { effect: MagicItemEffect; update: (next: MagicItemEffect) => void }) {
  switch (effect.kind) {
    case "increase_ability":
      return (
        <>
          <span className="w-32">
            <Select value={effect.ability} label="Ability" options={abilityOptions} onChange={(ability) => update({ ...effect, ability })} />
          </span>
          <EffectStepper label="Raised by" value={effect.amount} min={1} max={4} onChange={(amount) => update({ ...effect, amount })} />
          <EffectStepper label="To at most" value={effect.max} min={3} max={30} onChange={(max) => update({ ...effect, max })} />
        </>
      );
    case "immunity":
      return <ToggleChips options={DAMAGE_TYPES} selected={effect.types} onChange={(types) => update({ ...effect, types })} />;
    case "condition_immunity":
      return <ToggleChips options={IMMUNE_CONDITIONS} selected={effect.conditions} onChange={(conditions) => update({ ...effect, conditions })} />;
    case "speed":
      return (
        <>
          <span className="w-36">
            <Select
              value={effect.mode}
              label="Speed"
              options={SPEED_MODES.map((mode) => ({ value: mode, label: SPEED_LABELS[mode] }))}
              onChange={(mode) => update({ ...effect, mode })}
            />
          </span>
          <CheckField
            label="Equal to walking speed"
            checked={effect.feet === "walk"}
            onChange={(on) => update({ ...effect, feet: on ? "walk" : 30 })}
          />
          {effect.feet === "walk" ? null : (
            <EffectStepper label="Feet" value={effect.feet} min={5} max={120} step={5} onChange={(feet) => update({ ...effect, feet })} />
          )}
        </>
      );
    case "weapon_rider":
      return (
        <>
          <ToggleChips options={WEAPON_KEYS} selected={effect.weapons} labels={WEAPON_LABELS} max={8} onChange={(weapons) => update({ ...effect, weapons })} />
          <CheckField label="Trained with them" checked={effect.proficient === true} onChange={(on) => update({ ...effect, proficient: on || undefined })} />
          <EffectStepper label="Extra damage" value={effect.damage ?? 0} min={0} max={3} onChange={(damage) => update({ ...effect, damage: damage || undefined })} />
          <CheckField label="Only at range" checked={effect.ranged === true} onChange={(on) => update({ ...effect, ranged: on || undefined })} />
        </>
      );
    default:
      return null;
  }
}
