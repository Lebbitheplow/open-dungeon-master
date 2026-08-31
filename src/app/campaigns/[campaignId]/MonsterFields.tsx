"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  MAX_ATTACKS,
  MAX_TRAITS,
  SAVE_ABILITIES,
  SIZES,
  type MonsterDraft,
  type MonsterReadout,
} from "@/lib/bestiary/monster-draft";
import { CONDITIONS, DAMAGE_TYPES } from "@/lib/bestiary/kit";
import { SpeedPicker, TermPicker } from "@/app/campaigns/[campaignId]/MonsterKitFields";
import { crLabel, type CrPart } from "@/lib/bestiary/derive-cr";

// The parts of a stat block that are more than one number in a box, split
// out of DmBestiaryPanel the way NpcFields was split out of the NPC forge:
// the panel around them fetches and saves, and these are the fields.
//
// Nothing here decides anything. Every edit produces a draft the server
// re-checks through src/lib/bestiary/monster-draft.ts, which is also where
// the rule that matters lives: a damage expression the dice engine cannot
// roll is refused rather than repaired.

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

export function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn(input, "w-full")}
      />
      {hint ? <span className="text-[10px] text-stone-600">{hint}</span> : null}
    </label>
  );
}

// The attack list. This is where a monster's whole offensive rating comes
// from, and where the only refusal in the editor lives.
export function AttackEditor({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const attacks = draft.stats.attacks;
  const setAttacks = (next: typeof attacks) =>
    onChange({ ...draft, stats: { ...draft.stats, attacks: next } });

  return (
    <div className="flex flex-col gap-1.5">
      <datalist id="monster-damage-types">
        {DAMAGE_TYPES.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
      {attacks.map((attack, index) => (
        <div key={index} className="flex flex-wrap items-center gap-1.5">
          <input
            value={attack.name}
            onChange={(event) =>
              setAttacks(
                attacks.map((row, at) =>
                  at === index ? { ...row, name: event.target.value } : row,
                ),
              )
            }
            placeholder="Bite"
            className={cn(input, "w-28")}
          />
          <label className="flex items-center gap-1 text-[10px] text-stone-500">
            to hit
            <input
              type="number"
              min={-5}
              max={20}
              value={attack.toHit}
              onChange={(event) =>
                setAttacks(
                  attacks.map((row, at) =>
                    at === index ? { ...row, toHit: Number(event.target.value) } : row,
                  ),
                )
              }
              className={cn(input, "w-14")}
            />
          </label>
          <input
            value={attack.damage}
            onChange={(event) =>
              setAttacks(
                attacks.map((row, at) =>
                  at === index ? { ...row, damage: event.target.value } : row,
                ),
              )
            }
            placeholder="2d6+3"
            className={cn(input, "w-24")}
          />
          {/* A list rather than a select: the thirteen types the engine
              knows are one keystroke away, and "chitin-shredding" is still
              typeable for a monster that wants it. */}
          <input
            list="monster-damage-types"
            value={attack.type}
            onChange={(event) =>
              setAttacks(
                attacks.map((row, at) =>
                  at === index ? { ...row, type: event.target.value } : row,
                ),
              )
            }
            placeholder="slashing"
            className={cn(input, "w-24")}
          />
          <button
            type="button"
            onClick={() => setAttacks(attacks.filter((_, at) => at !== index))}
            className="text-stone-600 hover:text-red-300"
            aria-label={`Remove ${attack.name || "attack"}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {attacks.length < MAX_ATTACKS ? (
        <button
          type="button"
          onClick={() =>
            setAttacks([...attacks, { name: "", toHit: 3, damage: "1d6+1", type: "untyped" }])
          }
          className="inline-flex w-fit items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-amber-100"
        >
          <Plus className="size-3" /> Attack
        </button>
      ) : null}
      <p className="text-[10px] text-stone-600">
        The engine picks one attack and swings it as many times as the multiattack allows, capped
        at three. Damage has to be something the dice roller can read.
      </p>
    </div>
  );
}

export function SaveEditor({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const saves = draft.stats.saveMods ?? { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  return (
    // Six abreast needs more width than the 320px side panel has; narrower
    // screens fold to rows that still read in the familiar stat order.
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-6">
      {SAVE_ABILITIES.map((ability) => (
        <label key={ability} className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-stone-500">{ability}</span>
          <input
            type="number"
            min={-5}
            max={15}
            value={saves[ability]}
            onChange={(event) =>
              onChange({
                ...draft,
                stats: {
                  ...draft.stats,
                  saveMods: { ...saves, [ability]: Number(event.target.value) },
                },
              })
            }
            className={cn(input, "w-full")}
          />
        </label>
      ))}
    </div>
  );
}

// Traits are one-line rules text, which is what the engine surfaces to
// whoever is running the monster. Legendary and lair actions go here too:
// the engine has no separate turn for them, so a line a DM will read at the
// table is worth more than a field nothing acts on.
export function TraitEditor({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const traits = draft.stats.traits;
  const setTraits = (next: string[]) =>
    onChange({ ...draft, stats: { ...draft.stats, traits: next } });
  return (
    <div className="flex flex-col gap-1">
      {traits.map((trait, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <input
            value={trait}
            onChange={(event) =>
              setTraits(traits.map((row, at) => (at === index ? event.target.value : row)))
            }
            placeholder="Fire Breath (Recharge 5-6): DC 15 Dex save, 6d6 fire, half on a success"
            className={cn(input, "flex-1")}
          />
          <button
            type="button"
            onClick={() => setTraits(traits.filter((_, at) => at !== index))}
            className="text-stone-600 hover:text-red-300"
            aria-label="Remove trait"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {traits.length < MAX_TRAITS ? (
        <button
          type="button"
          onClick={() => setTraits([...traits, ""])}
          className="inline-flex w-fit items-center gap-1 rounded-md border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400 hover:text-amber-100"
        >
          <Plus className="size-3" /> Trait, legendary action or lair action
        </button>
      ) : null}
    </div>
  );
}

export function SizeAndDefences({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const set = (patch: Partial<MonsterDraft["stats"]>) =>
    onChange({ ...draft, stats: { ...draft.stats, ...patch } });
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Size</span>
          <select
            value={draft.stats.size ?? "Medium"}
            onChange={(event) => set({ size: event.target.value })}
            className={cn(input, "w-32")}
          >
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <SpeedPicker value={draft.stats.speed} onChange={(speed) => set({ speed })} />
      </div>
      {/* The three damage fields offer the thirteen types the fight actually
          resists, and the condition field the fifteen condition-logic.ts
          enforces. Anything else still goes in by hand, because a monster
          immune to "being seen" is a fine monster and no chip list of ours
          will hold every answer. */}
      {(
        [
          ["resist", "Resistant to", DAMAGE_TYPES],
          ["immune", "Immune to", DAMAGE_TYPES],
          ["vulnerable", "Vulnerable to", DAMAGE_TYPES],
          ["conditionImmune", "Condition immunities", CONDITIONS],
        ] as const
      ).map(([field, label, known]) => (
        <TermPicker
          key={field}
          label={label}
          value={draft.stats[field]}
          known={known}
          onChange={(value) => set({ [field]: value })}
        />
      ))}
    </div>
  );
}

// Say why. Every derived number, with the sentence that produced it. A DM
// will not trust a difficulty rating they cannot audit, and the ratings
// worth auditing are exactly the ones that disagree with their instinct.
export function Working({ parts, notes }: { parts: CrPart[]; notes: string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-stone-800 bg-stone-950/60 p-2">
      {parts.map((part) => (
        <div key={part.label} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
          <span className="w-28 shrink-0 text-stone-500">{part.label}</span>
          <span className="w-16 shrink-0 text-amber-100">{part.value}</span>
          <span className="flex-1 text-stone-500">{part.detail}</span>
        </div>
      ))}
      {notes.map((note) => (
        <p key={note} className="text-[10px] text-amber-300/70">
          {note}
        </p>
      ))}
    </div>
  );
}

export function RatingLine({ readout }: { readout: MonsterReadout }) {
  return (
    <p className={cn("text-[11px]", readout.agrees ? "text-stone-500" : "text-amber-300/80")}>
      {readout.agrees
        ? `The numbers agree: CR ${crLabel(readout.statedCr)}.`
        : `Written as CR ${crLabel(readout.statedCr)}; the numbers say CR ${crLabel(
            readout.derived.cr,
          )}.`}
    </p>
  );
}
