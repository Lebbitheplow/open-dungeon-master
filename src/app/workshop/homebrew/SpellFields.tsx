"use client";

import { CONDITIONS } from "@/lib/bestiary/kit";
import { normalizeSpellMech } from "@/lib/homebrew/gear";
import {
  baseDamageDice,
  baseHealingDice,
  damageTypeFor,
  halfOnSaveFor,
  saveAbilityFor,
} from "@/lib/srd/spell-scaling";
import {
  CheckField,
  NumberField,
  SelectField,
  TextField,
  ToggleChips,
} from "@/app/workshop/homebrew/fields";
import { CLASS_IDS, DAMAGE_TYPES, SPELL_SCHOOLS } from "@/app/workshop/homebrew/types";
import {
  CASTING_TIMES,
  SPELL_COMPONENTS,
  SPELL_DURATIONS,
  SPELL_RANGES,
} from "@/lib/workshop/pickers";
import { CONDITION_BLURBS, SPELL_SCHOOL_BLURBS, glossaryFor } from "@/lib/help/terms";
import type { Data } from "@/app/workshop/homebrew/draft";

// The spell form. The description is the part the engine reads its damage
// out of, the same way it reads the SRD's, so the form shows what it found
// there rather than asking for the dice a second time. The block underneath
// is the part prose cannot state: how the spell resolves, which save, what
// condition or buff it applies.

const RESOLUTIONS = [
  { value: "", label: "Let the engine read the prose" },
  { value: "attack", label: "Spell attack roll" },
  { value: "save", label: "Target saves" },
  { value: "auto", label: "Hits without a roll" },
  { value: "heal", label: "Restores hit points" },
  { value: "buff", label: "Grants a condition to allies" },
  { value: "summon", label: "Conjures creatures" },
  { value: "utility", label: "Utility, narrated" },
] as const;

const ABILITY_OPTIONS = [
  { value: "", label: "none" },
  ...(["str", "dex", "con", "int", "wis", "cha"] as const).map((value) => ({ value, label: value.toUpperCase() })),
];

type Mech = Record<string, unknown>;

export function SpellFields({ data, onChange }: { data: Data; onChange: (next: Data) => void }) {
  const set = (patch: Data) => onChange({ ...data, ...patch });
  const mech = (data.mech ?? {}) as Mech;
  const setMech = (patch: Mech) => {
    const next = { ...mech, ...patch };
    set({ mech: next.resolution ? next : undefined });
  };
  const desc = String(data.desc ?? "");
  const read = {
    dice: baseDamageDice(desc),
    heal: baseHealingDice(desc),
    save: saveAbilityFor(desc),
    half: halfOnSaveFor(desc),
    type: damageTypeFor(desc),
  };
  const block = normalizeSpellMech(mech);
  const condition = (mech.condition ?? {}) as Mech;
  const buff = (mech.buff ?? {}) as Mech;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <NumberField
          label="Level"
          value={typeof data.level === "number" ? data.level : 1}
          min={0}
          max={9}
          onChange={(level) => set({ level: level === "" ? 0 : level })}
          hint="0 is a cantrip."
        />
        <SelectField
          label="School"
          value={String(data.school ?? "evocation")}
          options={SPELL_SCHOOLS.map((value) => ({ value, label: value }))}
          onChange={(school) => set({ school })}
          glossary={{ title: "Schools of magic", entries: glossaryFor(SPELL_SCHOOLS, SPELL_SCHOOL_BLURBS) }}
        />
        <TextField
          label="Casting time"
          value={String(data.casting_time ?? "")}
          onChange={(casting_time) => set({ casting_time })}
          maxLength={60}
          suggestions={CASTING_TIMES}
          hint="How long it takes to cast. Most spells take one action."
        />
        <TextField
          label="Range"
          value={String(data.range ?? "")}
          onChange={(range) => set({ range })}
          maxLength={60}
          suggestions={SPELL_RANGES}
          hint="How far away the target can be. Self means the caster only."
        />
        <TextField
          label="Components"
          value={String(data.components ?? "")}
          onChange={(components) => set({ components })}
          maxLength={120}
          suggestions={SPELL_COMPONENTS}
          hint="V spoken words, S a free hand, M a material (name it after M in brackets)."
        />
        <TextField
          label="Duration"
          value={String(data.duration ?? "")}
          onChange={(duration) => set({ duration })}
          maxLength={60}
          suggestions={SPELL_DURATIONS}
          hint="How long the effect lasts. Concentration spells end when the caster loses focus."
        />
        <div className="col-span-2 flex flex-wrap items-end gap-3">
          <CheckField label="Concentration" checked={data.concentration === true} onChange={(concentration) => set({ concentration })} />
          <CheckField label="Ritual" checked={data.ritual === true} onChange={(ritual) => set({ ritual })} />
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-[10px] uppercase tracking-wide text-stone-500">Classes that can learn it</span>
        <ToggleChips
          options={CLASS_IDS}
          selected={Array.isArray(data.classes) ? (data.classes as string[]) : []}
          onChange={(classes) => set({ classes })}
          labels={Object.fromEntries(
            CLASS_IDS.map((id) => [id, id.charAt(0).toUpperCase() + id.slice(1)]),
          )}
        />
      </div>

      <TextField
        label="At higher levels"
        value={String(data.higher_level ?? "")}
        onChange={(higher_level) => set({ higher_level })}
        placeholder="The damage increases by 1d6 for each slot level above 1st."
        maxLength={2000}
        hint="The engine scales the dice from this sentence when a spell is upcast."
      />

      <p className="rounded-md border border-stone-800 bg-stone-950/60 px-2 py-1.5 text-[11px] text-stone-400">
        <span className="uppercase tracking-wide text-stone-500">From the description the engine reads: </span>
        {read.dice ? `${read.dice}${read.type ? ` ${read.type}` : ""} damage` : read.heal ? `heals ${read.heal}` : "no dice"}
        {read.save ? `, ${read.save.toUpperCase()} save${read.half ? ", half on a success" : ""}` : ""}.
        {!read.dice && !read.heal ? " Write it as \"takes 3d6 fire damage\" and it will." : ""}
      </p>

      <div className="space-y-2 rounded-md border border-stone-800 p-2">
        <SelectField
          label="How it resolves"
          value={String(mech.resolution ?? "")}
          options={RESOLUTIONS}
          onChange={(resolution) => setMech({ resolution: resolution || undefined })}
          hint="Set this and the cast tools trust it over the prose."
        />
        {block ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {block.resolution === "save" ? (
              <>
                <SelectField
                  label="Save"
                  value={String(mech.save ?? "")}
                  options={ABILITY_OPTIONS}
                  onChange={(save) => setMech({ save: save || undefined })}
                />
                <div className="flex items-end pb-1">
                  <CheckField label="Half on a success" checked={mech.halfOnSave === true} onChange={(halfOnSave) => setMech({ halfOnSave })} />
                </div>
              </>
            ) : null}
            {["attack", "save", "auto"].includes(block.resolution) ? (
              <SelectField
                label="Damage type"
                value={String(mech.damageType ?? "")}
                options={[{ value: "", label: "from the prose" }, ...DAMAGE_TYPES.map((value) => ({ value, label: value }))]}
                onChange={(damageType) => setMech({ damageType: damageType || undefined })}
              />
            ) : null}
            {["attack", "save", "auto"].includes(block.resolution) ? (
              <>
                <TextField
                  label="Condition on a hit or failed save"
                  value={String(condition.name ?? "")}
                  onChange={(name) => setMech({ condition: name ? { ...condition, name } : undefined })}
                  placeholder="frightened"
                  maxLength={40}
                  suggestions={CONDITIONS}
                  glossary={{ title: "Conditions", entries: glossaryFor(CONDITIONS, CONDITION_BLURBS) }}
                />
                {condition.name ? (
                  <NumberField
                    label="For rounds"
                    value={typeof condition.rounds === "number" ? condition.rounds : 10}
                    min={1}
                    max={6000}
                    onChange={(rounds) => setMech({ condition: { ...condition, rounds: rounds === "" ? 10 : rounds } })}
                    hint="10 rounds is a minute."
                  />
                ) : null}
              </>
            ) : null}
            {block.resolution === "buff" ? (
              <>
                <TextField
                  label="Condition granted"
                  value={String(buff.condition ?? "")}
                  onChange={(name) => setMech({ buff: { ...buff, condition: name } })}
                  placeholder="blessed"
                  maxLength={40}
                  suggestions={["blessed", "hasted", "shielded", "invisible", "inspired", ...CONDITIONS]}
                />
                <SelectField
                  label="On"
                  value={String(buff.target ?? "self")}
                  options={[
                    { value: "self", label: "the caster" },
                    { value: "ally", label: "one ally" },
                    { value: "allies", label: "several allies" },
                  ]}
                  onChange={(target) => setMech({ buff: { ...buff, target } })}
                />
                <NumberField
                  label="For rounds"
                  value={typeof buff.rounds === "number" ? buff.rounds : 10}
                  min={1}
                  max={6000}
                  onChange={(rounds) => setMech({ buff: { ...buff, rounds: rounds === "" ? 10 : rounds } })}
                />
              </>
            ) : null}
            <TextField
              label="Note for the DM"
              value={String(mech.note ?? "")}
              onChange={(note) => setMech({ note: note || undefined })}
              placeholder="Up to three targets."
              maxLength={200}
              className="col-span-2"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
