"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { SectionHead } from "@/components/ui/SectionHead";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { CONDITIONS, DAMAGE_TYPES } from "@/lib/bestiary/kit";
import { BLOCK_LIMITS, SAVE_ABILITY_IDS } from "@/lib/bestiary/block-check";
import type { MonsterDraft } from "@/lib/bestiary/monster-draft";
import type { MonsterAbility } from "@/lib/dm/monster-abilities";
import type { RoutineStep } from "@/lib/bestiary/attack-text";
import { Field, FieldLabel, OptionalStepper, addChip, chip, chipOn, chipRow, rowIcon } from "@/app/workshop/kit";

// The actions with numbers the engine runs (src/lib/dm/enemy-casting.ts,
// legendary-tools.ts): a breath weapon's DC, dice and recharge, a gaze's
// condition, a legendary action's cost; the troll's Regeneration; and the
// Multiattack routine the enemy turn swings. A trait line still carries the
// words; these carry the numbers, so the engine never has to read them out
// of prose.

type Props = { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void };

const RECHARGE_OPTIONS = [
  { value: "", label: "No recharge" },
  { value: "6", label: "Recharge 6" },
  { value: "5", label: "Recharge 5-6" },
  { value: "4", label: "Recharge 4-6" },
];
const SAVE_OPTIONS = [
  { value: "", label: "No save" },
  ...SAVE_ABILITY_IDS.map((ability) => ({ value: ability as string, label: `${ability.toUpperCase()} save` })),
];
const COST_OPTIONS = [
  { value: "", label: "Not legendary" },
  { value: "1", label: "Legendary, 1 action" },
  { value: "2", label: "Legendary, 2 actions" },
  { value: "3", label: "Legendary, 3 actions" },
];

function clean<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}

function AbilityRow({ ability, onChange, onRemove, conditionList, typeList }: {
  ability: MonsterAbility;
  onChange: (next: MonsterAbility) => void;
  onRemove: () => void;
  conditionList: string;
  typeList: string;
}) {
  const set = (patch: Partial<MonsterAbility>) => onChange(clean({ ...ability, ...patch }));
  return (
    <div className="live-in grid gap-2 rounded-lg border border-stone-800 bg-stone-950/50 p-2.5">
      <div className="flex flex-wrap items-end gap-2">
        <Field as="label" label="Name" className="min-w-40 flex-1">
          <input value={ability.name} maxLength={BLOCK_LIMITS.specialName} placeholder="Fire Breath" onChange={(event) => set({ name: event.target.value })} className={ui.input} />
        </Field>
        <Field label="Recharge">
          <span className="block w-36">
            <Select label="Recharge" size="sm" value={ability.recharge ? String(ability.recharge) : ""} onChange={(next) => set({ recharge: next ? Number(next) : undefined })} options={RECHARGE_OPTIONS} />
          </span>
        </Field>
        <Field label="Per day">
          <OptionalStepper label="Uses a day" min={1} max={9} fallback={1} value={ability.perDay} onChange={(perDay) => set({ perDay: perDay === "" ? undefined : perDay })} />
        </Field>
        <Field label="Legendary">
          <span className="block w-44">
            <Select label="Legendary action cost" size="sm" value={ability.legendaryCost ? String(ability.legendaryCost) : ""} onChange={(next) => set({ legendaryCost: next ? Number(next) : undefined })} options={COST_OPTIONS} />
          </span>
        </Field>
        <button type="button" aria-label={`Remove ${ability.name || "ability"}`} onClick={onRemove} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Save">
          <span className="block w-32">
            <Select label="Save" size="sm" value={ability.save ?? ""} onChange={(save) => set({ save: (save || undefined) as MonsterAbility["save"], dc: save ? ability.dc ?? 13 : undefined })} options={SAVE_OPTIONS} />
          </span>
        </Field>
        {ability.save ? (
          <Field label="DC">
            <OptionalStepper label="Save DC" min={1} max={30} fallback={13} value={ability.dc} onChange={(dc) => set({ dc: dc === "" ? 13 : dc })} />
          </Field>
        ) : null}
        <Field as="label" label="Damage">
          <input value={ability.damage ?? ""} placeholder="6d6" onChange={(event) => set({ damage: event.target.value || undefined, damageType: event.target.value ? ability.damageType ?? "fire" : undefined })} className={cn(ui.input, "w-24")} />
        </Field>
        {ability.damage ? (
          <>
            <Field as="label" label="Type">
              <input list={typeList} value={ability.damageType ?? ""} placeholder="fire" onChange={(event) => set({ damageType: event.target.value || undefined })} className={cn(ui.input, "w-28")} />
            </Field>
            <Field label="Half on a success">
              <Switch label="Half damage on a successful save" on={ability.halfOnSave === true} onChange={(on) => set({ halfOnSave: on || undefined })} />
            </Field>
          </>
        ) : null}
        <Field as="label" label="Condition">
          <input list={conditionList} value={ability.condition ?? ""} placeholder="frightened" onChange={(event) => set({ condition: event.target.value.toLowerCase() || undefined })} className={cn(ui.input, "w-32")} />
        </Field>
        {ability.condition ? (
          <>
            <Field label="Rounds">
              <OptionalStepper label="Rounds" min={1} max={100} fallback={10} value={ability.rounds} onChange={(rounds) => set({ rounds: rounds === "" ? undefined : rounds })} />
            </Field>
            <Field label="Save again each turn">
              <Switch label="Repeat the save at the end of each turn" on={ability.repeatSave === true} onChange={(on) => set({ repeatSave: on || undefined })} />
            </Field>
          </>
        ) : null}
        <Field label="Magical">
          <Switch label="Magic Resistance applies" on={ability.magical === true} onChange={(on) => set({ magical: on || undefined })} />
        </Field>
      </div>
    </div>
  );
}

export function AbilitiesEditor({ draft, onChange }: Props) {
  const conditionList = useId();
  const typeList = useId();
  const specials = draft.stats.specials ?? [];
  const setSpecials = (next: MonsterAbility[]) => onChange({ ...draft, stats: { ...draft.stats, specials: next.length ? next : undefined } });
  return (
    <div className="flex flex-col gap-1.5">
      <SectionHead title="Actions the engine runs" glyph="cue-battle" className="mb-0" />
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
      {specials.map((ability, index) => (
        <AbilityRow
          key={index}
          ability={ability}
          conditionList={conditionList}
          typeList={typeList}
          onChange={(next) => setSpecials(specials.map((row, at) => (at === index ? next : row)))}
          onRemove={() => setSpecials(specials.filter((_, at) => at !== index))}
        />
      ))}
      {specials.length < BLOCK_LIMITS.specials ? (
        <button type="button" onClick={() => setSpecials([...specials, { name: "", save: "dex", dc: 13, damage: "4d6", damageType: "fire", halfOnSave: true, recharge: 5 }])} className={cn(ui.btnSmall, addChip, "w-fit")}>
          <Plus className="size-3" /> Breath, gaze or other action
        </button>
      ) : null}
      <span className="text-[11px] text-stone-500">
        The DM spends these through the monster&apos;s turn: the server rolls the save, the dice and the recharge, and a legendary one costs its actions.
      </span>
    </div>
  );
}

export function RegenerationEditor({ draft, onChange }: Props) {
  const regeneration = draft.stats.regeneration;
  const set = (next: MonsterDraft["stats"]["regeneration"]) => onChange({ ...draft, stats: { ...draft.stats, regeneration: next } });
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <FieldLabel>Regeneration</FieldLabel>
        <Switch label="Regenerates" on={Boolean(regeneration)} onChange={(on) => set(on ? { amount: 10, stoppedBy: ["acid", "fire"] } : undefined)} />
      </span>
      {regeneration ? (
        <div className="reveal flex flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2 text-[11px] text-stone-400">
            Regains
            <NumberStepper size="sm" label="Hit points regained each turn" min={1} max={100} value={regeneration.amount} onChange={(amount) => set({ ...regeneration, amount })} />
            hit points at the start of its turn, unless it took
          </span>
          <div className={cn("stagger-pop", chipRow)}>
            {DAMAGE_TYPES.map((type) => {
              const on = regeneration.stoppedBy.includes(type);
              return (
                <button key={type} type="button" aria-pressed={on} onClick={() => set({ ...regeneration, stoppedBy: on ? regeneration.stoppedBy.filter((entry) => entry !== type) : [...regeneration.stoppedBy, type] })} className={cn(ui.btnSmall, chip, on && chipOn)}>
                  {type}
                </button>
              );
            })}
          </div>
          <span className="flex items-center gap-2 text-[11px] text-stone-400">
            <Switch label="Dies only if it starts its turn at 0 hit points" on={regeneration.diesOnlyAtTurnStart === true} onChange={(on) => set({ ...regeneration, ...(on ? { diesOnlyAtTurnStart: true } : { diesOnlyAtTurnStart: undefined }) })} />
            Dies only if it starts its turn at 0 hit points
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function RoutineEditor({ draft, onChange }: Props) {
  const attacks = draft.stats.attacks;
  const routines = draft.stats.routines ?? [];
  const setRoutines = (next: RoutineStep[][]) => onChange({ ...draft, stats: { ...draft.stats, routines: next.length ? next : undefined } });
  const options = attacks.filter((attack) => attack.name.trim()).map((attack) => ({ value: attack.name, label: attack.name }));
  if (!options.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>Multiattack routine</FieldLabel>
      {routines.map((steps, index) => (
        <div key={index} className="live-in flex flex-wrap items-center gap-1.5 rounded-lg border border-stone-800 p-2 text-[11px] text-stone-400">
          {index > 0 ? <span className="text-stone-500">Or</span> : null}
          {steps.map((step, at) => (
            <span key={at} className="flex items-center gap-1">
              <NumberStepper size="sm" label="How many" min={1} max={10} value={step.count} onChange={(count) => setRoutines(routines.map((row, r) => (r === index ? row.map((entry, s) => (s === at ? { ...entry, count } : entry)) : row)))} />
              <span className="block w-32">
                <Select label="Attack" size="sm" value={step.attack} onChange={(attack) => setRoutines(routines.map((row, r) => (r === index ? row.map((entry, s) => (s === at ? { ...entry, attack } : entry)) : row)))} options={options} />
              </span>
              <button type="button" aria-label="Remove this step" onClick={() => setRoutines(routines.map((row, r) => (r === index ? row.filter((_, s) => s !== at) : row)).filter((row) => row.length))} className={cn(ui.iconAction, "hover:text-red-300")}>
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
          {steps.length < BLOCK_LIMITS.routineSteps ? (
            <button type="button" onClick={() => setRoutines(routines.map((row, r) => (r === index ? [...row, { attack: options[0].value, count: 1 }] : row)))} className={cn(ui.btnSmall, addChip)}>
              <Plus className="size-3" /> Step
            </button>
          ) : null}
        </div>
      ))}
      {routines.length < BLOCK_LIMITS.routines ? (
        <button type="button" onClick={() => setRoutines([...routines, [{ attack: options[0].value, count: Math.max(1, draft.stats.attacksPerTurn ?? 1) }]])} className={cn(ui.btnSmall, addChip, "w-fit")}>
          <Plus className="size-3" /> {routines.length ? "Alternative routine" : "Routine"}
        </button>
      ) : null}
      <span className="text-[11px] text-stone-500">
        &quot;One with its bite and two with its claws&quot;: the enemy turn swings exactly this. Without a routine it swings its best attack as many times as Swings says.
      </span>
    </div>
  );
}
