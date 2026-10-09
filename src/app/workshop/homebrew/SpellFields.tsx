"use client";

import { SectionHead } from "@/components/ui/SectionHead";
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
import { CLASS_IDS, SPELL_SCHOOLS } from "@/app/workshop/homebrew/types";
import {
  CASTING_TIMES,
  SPELL_COMPONENTS,
  SPELL_DURATIONS,
  SPELL_RANGES,
} from "@/lib/workshop/pickers";
import { SPELL_SCHOOL_BLURBS, glossaryFor } from "@/lib/help/terms";
import { SpellMechFields } from "@/app/workshop/homebrew/SpellMechFields";
import type { Data } from "@/app/workshop/homebrew/draft";

// The spell form. The description is the part the engine reads its damage
// out of, the same way it reads the SRD's, so the form shows what it found
// there rather than asking for the dice a second time. The block underneath
// is the part prose cannot state: how the spell resolves, which save, what
// condition or buff it applies.

export function SpellFields({ data, onChange }: { data: Data; onChange: (next: Data) => void }) {
  const set = (patch: Data) => onChange({ ...data, ...patch });
  const desc = String(data.desc ?? "");
  const read = {
    dice: baseDamageDice(desc),
    heal: baseHealingDice(desc),
    save: saveAbilityFor(desc),
    half: halfOnSaveFor(desc),
    type: damageTypeFor(desc),
  };

  return (
    <div className="space-y-3">
      <SectionHead title="The casting" glyph="rest-spell-slot" className="mb-1" />
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
        <SectionHead title="Classes that can learn it" glyph="tab-characters" className="mb-1" />
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

      <p className="panel rounded-lg px-3 py-2 text-xs text-stone-400">
        <span className="font-display tracking-wide text-amber-200/70">From the description the engine reads: </span>
        {read.dice ? `${read.dice}${read.type ? ` ${read.type}` : ""} damage` : read.heal ? `heals ${read.heal}` : "no dice"}
        {read.save ? `, ${read.save.toUpperCase()} save${read.half ? ", half on a success" : ""}` : ""}.
        {!read.dice && !read.heal ? " Write it as \"takes 3d6 fire damage\" and it will." : ""}
      </p>

      <SpellMechFields data={data} onChange={onChange} />
    </div>
  );
}
