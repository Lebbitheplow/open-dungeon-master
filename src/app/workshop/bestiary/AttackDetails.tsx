"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { CONDITIONS, DAMAGE_TYPES } from "@/lib/bestiary/kit";
import { BLOCK_LIMITS, SAVE_ABILITY_IDS } from "@/lib/bestiary/block-check";
import { SIZES } from "@/lib/bestiary/monster-draft";
import type { EnemyAttack } from "@/lib/bestiary/statblock";
import type { OnHitRider } from "@/lib/bestiary/attack-text";
import { Field, FieldLabel, OptionalStepper, addChip, rowIcon } from "@/app/workshop/kit";

// The half of an attack line the engine reads besides its bonus and dice
// (src/lib/dm/enemy-profile.ts, enemy-attack.ts, enemy-hit.ts): whether it
// is a melee or ranged swing, its reach and range in feet, the dice that
// ride the hit under their own damage type, and what a hit does besides
// damage, a save, a condition, a grapple's escape DC. Opened from the attack
// row; everything is optional and an attack without any of it swings as
// before.

const MODE_OPTIONS = [
  { value: "", label: "Unstated" },
  { value: "melee", label: "Melee" },
  { value: "ranged", label: "Ranged" },
  { value: "both", label: "Melee or thrown" },
];

const SAVE_OPTIONS = [
  { value: "", label: "No save" },
  ...SAVE_ABILITY_IDS.map((ability) => ({ value: ability as string, label: `${ability.toUpperCase()} save` })),
];

const SIZE_OPTIONS = [{ value: "", label: "Any size" }, ...SIZES.map((size) => ({ value: size as string, label: `${size} or smaller` }))];

type Patch = Partial<EnemyAttack>;

function withoutUnset<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}

export function AttackDetails({ attack, onChange }: { attack: EnemyAttack; onChange: (next: EnemyAttack) => void }) {
  const conditionList = useId();
  const typeList = useId();
  const set = (patch: Patch) => onChange(withoutUnset({ ...attack, ...patch }));
  const onHit = attack.onHit ?? {};
  const setOnHit = (patch: Partial<OnHitRider>) => {
    const next = withoutUnset({ ...onHit, ...patch });
    set({ onHit: Object.keys(next).length ? next : undefined });
  };
  const riders = attack.riders ?? [];
  const setRiders = (next: typeof riders) => set({ riders: next.length ? next : undefined });

  return (
    <div className="reveal grid gap-3 rounded-lg border border-stone-800 bg-stone-950/50 p-3">
      <datalist id={conditionList}>
        {CONDITIONS.map((condition) => (
          <option key={condition} value={condition} />
        ))}
      </datalist>
      <datalist id={typeList}>
        {DAMAGE_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Kind">
          <span className="block w-40">
            <Select
              label="Melee or ranged"
              size="sm"
              value={attack.mode ?? ""}
              onChange={(mode) => set({ mode: (mode || undefined) as EnemyAttack["mode"] })}
              options={MODE_OPTIONS}
            />
          </span>
        </Field>
        <Field label="Spell attack">
          <Switch label="A spell attack" on={attack.spellAttack === true} onChange={(on) => set({ spellAttack: on || undefined })} />
        </Field>
        <Field label="Reach">
          <OptionalStepper label="Reach in feet" min={5} max={60} step={5} suffix="ft" fallback={5} value={attack.reach} onChange={(reach) => set({ reach: reach === "" ? undefined : reach })} />
        </Field>
        <Field label="Range">
          <span className="flex items-center gap-1">
            <OptionalStepper
              label="Normal range in feet"
              min={5}
              max={1000}
              step={5}
              suffix="ft"
              fallback={30}
              value={attack.range?.normal}
              onChange={(normal) =>
                set({ range: normal === "" ? undefined : { normal, long: Math.max(normal, attack.range?.long ?? normal * 4) } })
              }
            />
            {attack.range ? (
              <>
                <span className="text-[11px] text-stone-500">/</span>
                <OptionalStepper
                  label="Long range in feet"
                  min={attack.range.normal}
                  max={2000}
                  step={5}
                  suffix="ft"
                  fallback={attack.range.normal}
                  value={attack.range.long}
                  onChange={(long) => set({ range: { normal: attack.range!.normal, long: long === "" ? attack.range!.normal : long } })}
                />
              </>
            ) : null}
          </span>
        </Field>
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldLabel>Extra dice on a hit</FieldLabel>
        {riders.map((rider, index) => (
          <div key={index} className="live-in flex flex-wrap items-center gap-1.5">
            <input
              value={rider.dice}
              aria-label="Rider dice"
              placeholder="2d6"
              onChange={(event) => setRiders(riders.map((row, at) => (at === index ? { ...row, dice: event.target.value } : row)))}
              className={cn(ui.input, "w-24")}
            />
            <input
              list={typeList}
              value={rider.type}
              aria-label="Rider damage type"
              placeholder="fire"
              onChange={(event) => setRiders(riders.map((row, at) => (at === index ? { ...row, type: event.target.value } : row)))}
              className={cn(ui.input, "w-28")}
            />
            <button type="button" aria-label="Remove rider" onClick={() => setRiders(riders.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {riders.length < BLOCK_LIMITS.riders ? (
          <button type="button" onClick={() => setRiders([...riders, { dice: "1d6", type: "fire" }])} className={cn(ui.btnSmall, addChip, "w-fit")}>
            <Plus className="size-3" /> Rider dice
          </button>
        ) : null}
        <span className="text-[11px] text-stone-500">Each rider meets its own resistance: a fire rider on a bite is halved by fire resistance, not by piercing.</span>
      </div>

      <div className="grid gap-2">
        <FieldLabel>What a hit does besides damage</FieldLabel>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Save">
            <span className="block w-32">
              <Select label="Save against the hit" size="sm" value={onHit.save ?? ""} onChange={(save) => setOnHit({ save: (save || undefined) as OnHitRider["save"], dc: save ? onHit.dc ?? 13 : undefined })} options={SAVE_OPTIONS} />
            </span>
          </Field>
          {onHit.save ? (
            <Field label="DC">
              <OptionalStepper label="Save DC" min={1} max={30} fallback={13} value={onHit.dc} onChange={(dc) => setOnHit({ dc: dc === "" ? 13 : dc })} />
            </Field>
          ) : null}
          <Field as="label" label="Condition">
            <input list={conditionList} value={onHit.condition ?? ""} placeholder="grappled" onChange={(event) => setOnHit({ condition: event.target.value.toLowerCase() || undefined })} className={cn(ui.input, "w-32")} />
          </Field>
          <Field as="label" label="And also">
            <input list={conditionList} value={onHit.alsoCondition ?? ""} placeholder="restrained" onChange={(event) => setOnHit({ alsoCondition: event.target.value.toLowerCase() || undefined })} className={cn(ui.input, "w-32")} />
          </Field>
          <Field label="Escape DC">
            <OptionalStepper label="Escape DC" min={1} max={30} fallback={13} value={onHit.escapeDc} onChange={(escapeDc) => setOnHit({ escapeDc: escapeDc === "" ? undefined : escapeDc })} />
          </Field>
          <Field label="Rounds">
            <OptionalStepper label="Rounds the condition lasts" min={1} max={100} fallback={10} value={onHit.rounds} onChange={(rounds) => setOnHit({ rounds: rounds === "" ? undefined : rounds })} />
          </Field>
          <Field label="Save again each turn">
            <Switch label="Repeat the save at the end of each turn" on={onHit.repeatSave === true} onChange={(on) => setOnHit({ repeatSave: on || undefined })} />
          </Field>
          <Field label="Works on">
            <span className="block w-40">
              <Select label="Largest size it works on" size="sm" value={onHit.maxSize ?? ""} onChange={(maxSize) => setOnHit({ maxSize: maxSize || undefined })} options={SIZE_OPTIONS} />
            </span>
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field as="label" label="Damage on a failed save">
            <input value={onHit.damage ?? ""} placeholder="3d6" onChange={(event) => setOnHit({ damage: event.target.value || undefined, damageType: event.target.value ? onHit.damageType ?? "poison" : undefined })} className={cn(ui.input, "w-24")} />
          </Field>
          {onHit.damage ? (
            <>
              <Field as="label" label="Type">
                <input list={typeList} value={onHit.damageType ?? ""} placeholder="poison" onChange={(event) => setOnHit({ damageType: event.target.value || undefined })} className={cn(ui.input, "w-28")} />
              </Field>
              <Field label="Half on a success">
                <Switch label="Half damage on a successful save" on={onHit.halfOnSave === true} onChange={(on) => setOnHit({ halfOnSave: on || undefined })} />
              </Field>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
