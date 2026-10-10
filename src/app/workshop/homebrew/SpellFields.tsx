"use client";

import { SectionHead } from "@/components/ui/SectionHead";
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
import { effectiveSpellPreview } from "@/lib/workshop/spell-preview";
import { bundledSpellNames, materialCostFrom } from "@/lib/srd/spell-facts";

// The spell form. The description is the part the engine reads its damage
// out of, the same way it reads the SRD's, unless the block underneath says
// otherwise; the preview shows what the table will actually roll and which
// of the two it came from. The block is the part prose cannot state: how the
// spell resolves, which save, what condition or buff it applies.

const RUNS_AS_OPTIONS = bundledSpellNames().map((name) => ({ value: name, label: name }));

export function SpellFields({ data, onChange }: { data: Data; onChange: (next: Data) => void }) {
  const set = (patch: Data) => onChange({ ...data, ...patch });
  const preview = effectiveSpellPreview(data);
  const hasMaterial = /\bM\b/.test(String(data.components ?? "").split("(")[0].toUpperCase());
  const cost = typeof data.materialCostGp === "number" ? data.materialCostGp : null;

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

      {hasMaterial ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TextField
            label="Material"
            className="col-span-2"
            value={String(data.material ?? "")}
            onChange={(material) => {
              // A price in the words fills the price, as the books print it.
              const stated = materialCostFrom(material);
              set({
                material: material || undefined,
                ...(stated.costGp && cost === null ? { materialCostGp: stated.costGp, materialConsumed: stated.consumed || undefined } : {}),
              });
            }}
            maxLength={300}
            placeholder="diamonds worth 300 gp, which the spell consumes"
            hint="What the caster must hold. A component pouch or a focus stands in for one with no price."
          />
          <NumberField
            label="Costs (gp)"
            value={cost ?? ""}
            min={0}
            max={1_000_000}
            onChange={(value) => set({ materialCostGp: value === "" || value === 0 ? undefined : value, ...(value === "" || value === 0 ? { materialConsumed: undefined } : {}) })}
            hint="A priced material must be carried or paid for: the cast guard refuses the spell without it."
          />
          <div className="flex items-end pb-1">
            <CheckField
              label="The spell consumes it"
              checked={data.materialConsumed === true}
              onChange={(materialConsumed) => set({ materialConsumed: materialConsumed && cost ? true : undefined })}
            />
          </div>
        </div>
      ) : null}

      <TextField
        label="Runs as"
        value={String(data.runsAs ?? "")}
        onChange={(runsAs) => set({ runsAs: runsAs.trim() || undefined })}
        maxLength={80}
        suggestions={RUNS_AS_OPTIONS}
        hint="A published spell whose area, summons, reaction or transformation the engines lay for this one under its own name (a renamed Web still webs the board). A copy starts with the spell it was copied from."
      />

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

      <div className="panel space-y-1 rounded-lg px-3 py-2 text-xs text-stone-400">
        <p>
          <span className="font-display tracking-wide text-amber-200/70">What the table resolves: </span>
          {preview.line}.
          {preview.line.startsWith("no dice") ? " Write it as \"takes 3d6 fire damage\", or give the block below its dice." : ""}
        </p>
        {preview.conflicts.map((conflict) => (
          <p key={conflict} className="text-amber-300">{conflict}</p>
        ))}
      </div>

      <SpellMechFields data={data} onChange={onChange} />
    </div>
  );
}
