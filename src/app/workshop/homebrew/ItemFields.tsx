"use client";

import { Plus, X } from "lucide-react";
import {
  ARMOR_CATEGORIES,
  EFFECT_KINDS,
  GEAR_LIMITS,
  ITEM_KINDS,
  RARITIES,
  WEAPON_CATEGORIES,
  WEAPON_PROPERTIES,
  describeEffect,
  type ItemKind,
} from "@/lib/homebrew/gear";
import { SRD_ARMOR } from "@/lib/srd/armor";
import { SRD_WEAPONS } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import { RECHARGE_TRIGGERS } from "@/lib/workshop/pickers";
import {
  CheckField,
  Field,
  NumberField,
  SelectField,
  TextField,
  ToggleChips,
} from "@/app/workshop/homebrew/fields";
import { DAMAGE_TYPES, input } from "@/app/workshop/homebrew/types";
import type { Data } from "@/app/workshop/homebrew/draft";
import { DAMAGE_TYPE_BLURBS, WEAPON_PROPERTY_BLURBS, glossaryFor } from "@/lib/help/terms";

// "1d8 slashing" as the two things a DM actually decides. A type the list
// does not know (a homebrew "1d6 chitin-shredding") stays in the dice box
// so nothing typed is ever lost.
function splitDamage(damage: string): { dice: string; type: string } {
  const trimmed = damage.trim();
  const match = /^(.*?)\s+([a-z]+)$/i.exec(trimmed);
  if (match && (DAMAGE_TYPES as readonly string[]).includes(match[2].toLowerCase())) {
    return { dice: match[1].trim(), type: match[2].toLowerCase() };
  }
  return { dice: trimmed, type: "" };
}

function joinDamage(dice: string, type: string): string {
  return [dice.trim(), type.trim()].filter(Boolean).join(" ");
}

// The item form: what kind of thing it is, then the block that kind carries.
// A weapon's block is an SRD weapon; an armour's an SRD armour; a magic
// item's the effects magic-items.json speaks. The "start from" rows offer
// the SRD tables themselves, because a +1 longsword is a longsword first.

const KIND_LABELS: Record<ItemKind, string> = {
  weapon: "Weapon",
  armor: "Armour",
  gear: "Gear",
  magic_item: "Magic item",
};

type Weapon = Record<string, unknown>;
type Armor = Record<string, unknown>;

function num(value: unknown): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function WeaponBlock({ weapon, onChange }: { weapon: Weapon; onChange: (next: Weapon) => void }) {
  const set = (patch: Weapon) => onChange({ ...weapon, ...patch });
  const properties = Array.isArray(weapon.properties) ? (weapon.properties as string[]) : [];
  return (
    <div className="space-y-2 rounded-md border border-stone-800 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-stone-500">Weapon</span>
        <select
          value=""
          aria-label="Start from an SRD weapon"
          onChange={(event) => {
            const srd = SRD_WEAPONS.find((entry) => entry.name === event.target.value);
            if (srd) {
              onChange({
                category: srd.category,
                kind: srd.kind,
                damage: srd.damage,
                properties: srd.properties ?? [],
                ...(srd.rangeFt ? { rangeFt: srd.rangeFt } : {}),
              });
            }
          }}
          className={input}
        >
          <option value="">Start from an SRD weapon...</option>
          {SRD_WEAPONS.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name} ({entry.damage})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField
          label="Category"
          value={String(weapon.category ?? "simple")}
          options={WEAPON_CATEGORIES.map((value) => ({ value, label: value }))}
          onChange={(category) => set({ category })}
        />
        <SelectField
          label="Reach"
          value={String(weapon.kind ?? "melee")}
          options={[
            { value: "melee", label: "melee" },
            { value: "ranged", label: "ranged" },
          ]}
          onChange={(kind) => set({ kind })}
        />
        {/* Stored as one string ("1d8 slashing") because that is what the
            weapon engine reads; edited as dice plus a type picked from the
            list the monster editor already offers, so nobody has to spell a
            damage type from memory. */}
        <TextField
          label="Damage dice"
          value={splitDamage(String(weapon.damage ?? "")).dice}
          onChange={(dice) =>
            set({ damage: joinDamage(dice, splitDamage(String(weapon.damage ?? "")).type) })
          }
          placeholder="1d8"
          maxLength={20}
        />
        <SelectField
          label="Damage type"
          value={splitDamage(String(weapon.damage ?? "")).type}
          options={[
            { value: "", label: "Pick a type..." },
            ...DAMAGE_TYPES.map((value) => ({ value, label: value })),
          ]}
          onChange={(type) => set({ damage: joinDamage(splitDamage(String(weapon.damage ?? "")).dice, type) })}
          hint="Slashing, piercing and bludgeoning are the weapon types; the rest are for enchanted blades."
          glossary={{ title: "Damage types", entries: glossaryFor(DAMAGE_TYPES, DAMAGE_TYPE_BLURBS) }}
        />
        <NumberField
          label="Range (ft)"
          value={num(weapon.rangeFt)}
          min={0}
          max={600}
          onChange={(rangeFt) => set({ rangeFt: rangeFt === "" ? undefined : rangeFt })}
        />
      </div>
      <Field
        label="Properties"
        glossary={{ title: "Weapon properties", entries: glossaryFor(WEAPON_PROPERTIES, WEAPON_PROPERTY_BLURBS) }}
      >
        <ToggleChips
          options={WEAPON_PROPERTIES}
          selected={properties}
          onChange={(next) => set({ properties: next })}
        />
      </Field>
    </div>
  );
}

function ArmorBlock({ armor, onChange }: { armor: Armor; onChange: (next: Armor) => void }) {
  const set = (patch: Armor) => onChange({ ...armor, ...patch });
  const category = String(armor.category ?? "light");
  return (
    <div className="space-y-2 rounded-md border border-stone-800 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-stone-500">Armour</span>
        <select
          value=""
          aria-label="Start from SRD armour"
          onChange={(event) => {
            const srd = SRD_ARMOR.find((entry) => entry.name === event.target.value);
            if (srd) {
              onChange({
                category: srd.category,
                baseAc: srd.baseAc,
                ...(srd.dexCap !== undefined ? { dexCap: srd.dexCap } : {}),
                ...(srd.strengthRequirement ? { strengthRequirement: srd.strengthRequirement } : {}),
                stealthDisadvantage: Boolean(srd.stealthDisadvantage),
                weightLb: srd.weightLb,
              });
            }
          }}
          className={input}
        >
          <option value="">Start from SRD armour...</option>
          {SRD_ARMOR.map((entry) => (
            <option key={entry.name} value={entry.name}>
              {entry.name} (AC {entry.baseAc})
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField
          label="Category"
          value={category}
          options={ARMOR_CATEGORIES.map((value) => ({ value, label: value }))}
          onChange={(next) => set({ category: next })}
        />
        <NumberField
          label={category === "shield" ? "Adds to AC" : "Base AC"}
          value={num(armor.baseAc)}
          min={category === "shield" ? 1 : GEAR_LIMITS.acMin}
          max={category === "shield" ? GEAR_LIMITS.shieldMax : GEAR_LIMITS.acMax}
          onChange={(baseAc) => set({ baseAc: baseAc === "" ? undefined : baseAc })}
        />
        {category === "medium" ? (
          <NumberField
            label="DEX cap"
            value={num(armor.dexCap) === "" ? 2 : num(armor.dexCap)}
            min={0}
            max={5}
            onChange={(dexCap) => set({ dexCap: dexCap === "" ? 2 : dexCap })}
            hint="Medium armour lets this much DEX through."
          />
        ) : null}
        {category === "heavy" || category === "medium" ? (
          <NumberField
            label="Strength needed"
            value={num(armor.strengthRequirement)}
            min={0}
            max={30}
            onChange={(strengthRequirement) =>
              set({ strengthRequirement: strengthRequirement === "" ? undefined : strengthRequirement })
            }
          />
        ) : null}
        <NumberField
          label="Weight (lb)"
          value={num(armor.weightLb)}
          min={0}
          max={500}
          onChange={(weightLb) => set({ weightLb: weightLb === "" ? 0 : weightLb })}
        />
      </div>
      {category !== "shield" ? (
        <CheckField
          label="Disadvantage on Stealth"
          checked={armor.stealthDisadvantage === true}
          onChange={(stealthDisadvantage) => set({ stealthDisadvantage })}
        />
      ) : null}
    </div>
  );
}

const EFFECT_LABELS: Record<(typeof EFFECT_KINDS)[number], string> = {
  ac_bonus: "AC bonus",
  ac_unarmored: "AC bonus while unarmoured",
  save_bonus: "Saving throw bonus",
  set_ability: "Sets an ability score",
  resistance: "Resistance",
};

function EffectsBlock({
  effects,
  onChange,
}: {
  effects: MagicItemEffect[];
  onChange: (next: MagicItemEffect[]) => void;
}) {
  const update = (index: number, next: MagicItemEffect) =>
    onChange(effects.map((effect, at) => (at === index ? next : effect)));
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">
        Standing effects (the engine applies these while the item is worn, and attuned if it needs it)
      </span>
      {effects.map((effect, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1.5">
          <select
            value={effect.kind}
            aria-label="Effect kind"
            onChange={(event) => {
              const kind = event.target.value as (typeof EFFECT_KINDS)[number];
              update(
                index,
                kind === "set_ability"
                  ? { kind, ability: "str", score: 19 }
                  : kind === "resistance"
                    ? { kind, types: ["fire"] }
                    : { kind, amount: 1 },
              );
            }}
            className={input}
          >
            {EFFECT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {EFFECT_LABELS[kind]}
              </option>
            ))}
          </select>
          {"amount" in effect ? (
            <input
              type="number"
              aria-label="Amount"
              value={effect.amount}
              min={-GEAR_LIMITS.bonusMax}
              max={GEAR_LIMITS.bonusMax}
              onChange={(event) => update(index, { ...effect, amount: Number(event.target.value) })}
              className={`${input} w-16`}
            />
          ) : null}
          {effect.kind === "set_ability" ? (
            <>
              <select
                value={effect.ability}
                aria-label="Ability"
                onChange={(event) =>
                  update(index, { ...effect, ability: event.target.value as MagicItemEffect extends { ability: infer A } ? A : never })
                }
                className={input}
              >
                {(["str", "dex", "con", "int", "wis", "cha"] as const).map((ability) => (
                  <option key={ability} value={ability}>
                    {ability.toUpperCase()}
                  </option>
                ))}
              </select>
              <input
                type="number"
                aria-label="Score"
                value={effect.score}
                min={3}
                max={30}
                onChange={(event) => update(index, { ...effect, score: Number(event.target.value) })}
                className={`${input} w-16`}
              />
            </>
          ) : null}
          {effect.kind === "resistance" ? (
            <ToggleChips
              options={DAMAGE_TYPES}
              selected={effect.types}
              onChange={(types) => update(index, { ...effect, types })}
            />
          ) : null}
          <span className="text-[11px] text-stone-500">{describeEffect(effect)}</span>
          <button
            type="button"
            aria-label="Remove effect"
            onClick={() => onChange(effects.filter((_, at) => at !== index))}
            className="rounded-md border border-stone-700 p-1 text-stone-500 hover:text-red-300"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {effects.length < GEAR_LIMITS.effectsMax ? (
        <button
          type="button"
          onClick={() => onChange([...effects, { kind: "ac_bonus", amount: 1 }])}
          className="flex items-center gap-1 rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:bg-stone-900"
        >
          <Plus className="size-3" /> Add an effect
        </button>
      ) : null}
    </div>
  );
}

export function ItemFields({ data, onChange }: { data: Data; onChange: (next: Data) => void }) {
  const set = (patch: Data) => onChange({ ...data, ...patch });
  const itemKind = ITEM_KINDS.includes(data.itemKind as ItemKind) ? (data.itemKind as ItemKind) : "gear";
  const weapon = (data.weapon ?? {}) as Weapon;
  const armor = (data.armor ?? {}) as Armor;
  const effects = Array.isArray(data.effects) ? (data.effects as MagicItemEffect[]) : [];
  const charges = (data.charges ?? {}) as { max?: number; recharge?: string };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SelectField
          label="Kind"
          value={itemKind}
          options={ITEM_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }))}
          onChange={(next) => set({ itemKind: next })}
        />
        <SelectField
          label="Rarity"
          value={String(data.rarity ?? "")}
          options={[{ value: "", label: "mundane" }, ...RARITIES.map((value) => ({ value, label: value }))]}
          onChange={(rarity) => set({ rarity })}
        />
        <TextField label="Cost" value={String(data.cost ?? "")} onChange={(cost) => set({ cost })} placeholder="15 gp" maxLength={40} />
        <NumberField
          label="Weight (lb)"
          value={num(data.weight)}
          min={0}
          max={GEAR_LIMITS.weightMax}
          step={0.5}
          onChange={(weight) => set({ weight: weight === "" ? undefined : weight })}
        />
      </div>

      {itemKind === "weapon" ? <WeaponBlock weapon={weapon} onChange={(next) => set({ weapon: next })} /> : null}
      {itemKind === "armor" ? <ArmorBlock armor={armor} onChange={(next) => set({ armor: next })} /> : null}

      {itemKind === "magic_item" ? (
        <div className="space-y-2 rounded-md border border-stone-800 p-2">
          <div className="flex flex-wrap items-center gap-3">
            <CheckField
              label="Requires attunement"
              checked={data.requiresAttunement === true}
              onChange={(requiresAttunement) => set({ requiresAttunement })}
            />
            <NumberField
              label="Charges"
              value={num(charges.max)}
              min={0}
              max={GEAR_LIMITS.chargesMax}
              onChange={(max) =>
                set({ charges: max === "" || max === 0 ? undefined : { max, recharge: charges.recharge ?? "dawn" } })
              }
              className="w-24"
            />
            {charges.max ? (
              <TextField
                label="Recharge"
                value={charges.recharge ?? "dawn"}
                onChange={(recharge) => set({ charges: { ...charges, recharge } })}
                placeholder="dawn"
                maxLength={80}
                className="w-40"
                suggestions={RECHARGE_TRIGGERS}
              />
            ) : null}
          </div>
          <EffectsBlock effects={effects} onChange={(next) => set({ effects: next })} />
          <div className="flex flex-wrap gap-3">
            <CheckField
              label="It is also a weapon"
              checked={Boolean(data.weapon)}
              onChange={(on) => set({ weapon: on ? { category: "martial", kind: "melee", damage: "1d8 slashing" } : undefined })}
            />
            <CheckField
              label="It is also armour"
              checked={Boolean(data.armor)}
              onChange={(on) => set({ armor: on ? { category: "light", baseAc: 12 } : undefined })}
            />
          </div>
          {data.weapon ? <WeaponBlock weapon={weapon} onChange={(next) => set({ weapon: next })} /> : null}
          {data.armor ? <ArmorBlock armor={armor} onChange={(next) => set({ armor: next })} /> : null}
        </div>
      ) : null}
    </div>
  );
}
