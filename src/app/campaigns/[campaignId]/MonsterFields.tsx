"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { CONDITION_BLURBS, DAMAGE_TYPE_BLURBS, glossaryFor } from "@/lib/help/terms";
import {
  MAX_ATTACKS,
  MAX_TRAITS,
  SAVE_ABILITIES,
  SIZES,
  type MonsterDraft,
  type MonsterReadout,
} from "@/lib/bestiary/monster-draft";
import { CONDITIONS, DAMAGE_TYPES } from "@/lib/bestiary/kit";
import { CREATURE_TYPES, creatureTypeOf } from "@/lib/bestiary/statblock";
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
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
      <NumberStepper min={min} max={max} value={value} onChange={onChange} label={label} size="sm" className="w-fit" />
      {hint ? <span className="text-[10px] text-stone-600">{hint}</span> : null}
    </div>
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
  // One list per mounted editor: a fixed id collided when two were open.
  const damageListId = useId();
  const attacks = draft.stats.attacks;
  const setAttacks = (next: typeof attacks) =>
    onChange({ ...draft, stats: { ...draft.stats, attacks: next } });

  return (
    <div className="flex flex-col gap-1.5">
      <datalist id={damageListId}>
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
          <span className="flex items-center gap-1 text-[10px] text-stone-500">
            to hit
            <NumberStepper
              min={-5}
              max={20}
              value={attack.toHit}
              onChange={(toHit) => setAttacks(attacks.map((row, at) => (at === index ? { ...row, toHit } : row)))}
              label={`To hit, ${attack.name || "attack"}`}
              size="sm"
            />
          </span>
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
            list={damageListId}
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
    // A stepper is wider than the bare box it replaced, so the columns are as
    // many as the container holds (the 320px side panel, the workshop's half
    // page); the rows still read in the familiar stat order.
    <div className="stagger-up grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-1">
      {SAVE_ABILITIES.map((ability) => (
        <div key={ability} className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-stone-500">{ability}</span>
          <NumberStepper
            min={-5}
            max={15}
            value={saves[ability]}
            onChange={(next) =>
              onChange({
                ...draft,
                stats: {
                  ...draft.stats,
                  saveMods: { ...saves, [ability]: next },
                },
              })
            }
            label={`${ability.toUpperCase()} save`}
            size="sm"
            className="w-fit"
          />
        </div>
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
          <Select
            value={draft.stats.size ?? "Medium"}
            onChange={(size) => set({ size })}
            options={SIZES.map((size) => ({ value: size as string, label: size }))}
            label="Size"
            size="sm"
            className="w-32"
          />
        </label>
        {/* What it is, in the SRD's fourteen words. This is also the
            thumbnail: every list the monster appears in draws the plate for
            its type until somebody paints it a portrait. */}
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Type</span>
          <Select
            value={creatureTypeOf(draft.stats) as string}
            onChange={(type) => set({ type })}
            options={CREATURE_TYPES.map((type) => ({ value: type as string, label: type.charAt(0).toUpperCase() + type.slice(1) }))}
            label="Type"
            size="sm"
            className="w-32"
          />
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
          glossary={glossaryFor(
            known,
            known === CONDITIONS ? CONDITION_BLURBS : DAMAGE_TYPE_BLURBS,
          )}
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
