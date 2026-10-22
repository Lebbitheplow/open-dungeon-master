"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { AddFromList } from "@/components/ui/AddFromList";
import { Field, SelectField, ToggleChips } from "@/app/workshop/homebrew/fields";
import { addChip, rowIcon } from "@/app/workshop/kit";
import type { Data } from "@/app/workshop/homebrew/draft";
import { textKey } from "@/lib/language/text-logic";
import { ALL_SKILLS } from "@/lib/content/mechanics";
import { TOOL_PROFICIENCIES } from "@/lib/workshop/pickers";
import { engineRunsFeature, FEATURE_CLASSES, type CatalogFeature } from "@/lib/workshop/feature-catalog";
import { classFeatureCatalog } from "@/lib/workshop/class-feature-catalog";
import {
  ABILITIES,
  ARMOR_TRAINING,
  HIT_DICE,
  LIST_ABILITY,
  NONMETAL_SHIELDS,
  SPELL_LISTS,
  WEAPON_TRAINING,
  blankClassData,
  type ClassFeatureRow,
} from "@/lib/homebrew/class-data";
import { SRD_WEAPONS, weaponNamed } from "@/lib/srd/weapons";

// A class: the numbers every class has (hit die, saves, skills, training,
// how it casts), the level its subclass is picked at, and its features by
// level. Kept, it is a class to the engines at once (src/lib/homebrew/
// class-data.ts): the builder offers it, a level-up grants its features, and
// a feature borrowed from a published class keeps the name the engine runs
// it by. Loaded only when a class is opened (HomebrewEditor), so the
// catalog it borrows from stays out of the workshop's first load.

type Flat = { level: number; feature: ClassFeatureRow };

const capital = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const ABILITY_LABELS = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;
const SKILL_LABELS = Object.fromEntries(ALL_SKILLS.map((id) => [id, id.replace(/_/g, " ")])) as Record<string, string>;
const CASTING = [
  { value: "none", label: "Casts no spells" },
  { value: "full", label: "Full caster: spells to 9th level, as a wizard" },
  { value: "half", label: "Half caster: from 2nd level, to 5th, as a paladin" },
  { value: "pact", label: "Pact magic: few slots, back on a short rest, as a warlock" },
] as const;
// The lists whose own class learns its spells for good.
const LEARNS = new Set(["bard", "ranger", "sorcerer", "warlock"]);

// Whether any class the engines know runs a feature of this name.
function engineTag(name: string): string | null {
  for (const classId of FEATURE_CLASSES) {
    const tag = engineRunsFeature(classId, name);
    if (tag) return tag;
  }
  return null;
}

function BorrowFeature({ onPick, taken }: { onPick: (feature: CatalogFeature) => void; taken: Set<string> }) {
  const [query, setQuery] = useState("");
  const all = classFeatureCatalog();
  const results = useMemo(() => {
    const wanted = textKey(query);
    if (wanted.length < 2) return [];
    return all.filter((entry) => textKey(entry.name).includes(wanted) || textKey(entry.subclass).includes(wanted)).slice(0, 24);
  }, [all, query]);
  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-stone-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Borrow a feature from any class: extra attack, sneak attack, wild shape..."
          aria-label="Find a published class or subclass feature to borrow"
          className={cn(ui.input, "w-full pl-7 text-sm")}
        />
      </div>
      {results.length ? (
        <ul className="reveal stagger-up max-h-64 space-y-1 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950/60 p-1.5">
          {results.map((entry) => {
            const done = taken.has(textKey(entry.name));
            return (
              <li key={`${entry.classId}/${entry.subclass}/${entry.name}`} className="flex items-start gap-2">
                <button
                  type="button"
                  disabled={done}
                  onClick={() => onPick(entry)}
                  className={cn(ui.btnSmall, addChip, "shrink-0", done && "border-emerald-500/40 text-emerald-200")}
                >
                  {done ? <Check className="size-3" /> : <Plus className="size-3" />} Level {entry.level}
                </button>
                <span className="min-w-0 text-[11px] leading-snug text-stone-400">
                  <span className="text-stone-200">{entry.name}</span> ({capital(entry.classId)}
                  {entry.subclass ? `, ${entry.subclass}` : ""})
                  {entry.text ? ` ${entry.text.slice(0, 140)}${entry.text.length > 140 ? "..." : ""}` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function Features({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const levels = (data.levels ?? {}) as Record<string, ClassFeatureRow[]>;
  const flat: Flat[] = Object.entries(levels)
    .flatMap(([level, features]) => features.map((feature) => ({ level: Number(level), feature })))
    .sort((a, b) => a.level - b.level);
  const write = (next: Flat[]) => {
    const grouped: Record<string, ClassFeatureRow[]> = {};
    for (const row of next) {
      (grouped[String(row.level)] ??= []).push(row.feature);
    }
    set({ levels: grouped });
  };
  const taken = new Set(flat.map((row) => textKey(row.feature.n)));
  return (
    <div className="space-y-1.5 text-sm">
      <SectionHead title="Features by level" glyph="rest-level-up" className="mb-1" />
      {flat.map((row, index) => {
        const tag = row.feature.n.trim() ? engineTag(row.feature.n.trim()) : null;
        return (
          <div key={index} className="live-in grid gap-1.5 rounded-lg border border-stone-800 p-2 sm:grid-cols-[auto_1fr_auto]">
            <NumberStepper
              label="Level"
              value={row.level}
              min={1}
              max={20}
              onChange={(level) => write(flat.map((entry, at) => (at === index ? { ...entry, level: level || 1 } : entry)))}
            />
            <div className="min-w-0 space-y-1">
              <span className="flex flex-wrap items-center gap-2">
                <input
                  value={row.feature.n}
                  aria-label="Feature name"
                  placeholder="Arcane Strike"
                  maxLength={80}
                  onChange={(event) => write(flat.map((entry, at) => (at === index ? { ...entry, feature: { ...entry.feature, n: event.target.value } } : entry)))}
                  className={cn(ui.input, "w-full text-sm sm:w-56")}
                />
                {tag ? (
                  <span className="reveal-pop rounded-full border border-emerald-500/40 px-2 py-0.5 text-[10px] text-emerald-200" title="A feature of this name is run by the server, not just read by the DM.">
                    The engine runs it {tag}
                  </span>
                ) : null}
              </span>
              <textarea
                value={row.feature.d}
                aria-label="What it does"
                placeholder="Once a turn, a weapon hit deals an extra 1d8 force damage."
                maxLength={1500}
                rows={2}
                onChange={(event) => write(flat.map((entry, at) => (at === index ? { ...entry, feature: { ...entry.feature, d: event.target.value } } : entry)))}
                className={cn(ui.input, "w-full resize-y text-sm")}
              />
            </div>
            <button type="button" aria-label={`Remove ${row.feature.n || "feature"}`} onClick={() => write(flat.filter((_, at) => at !== index))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => write([...flat, { level: flat.length ? Math.min(20, flat[flat.length - 1].level + 1) : 1, feature: { n: "", d: "" } }])}
        className={cn(ui.btnSmall, addChip)}
      >
        <Plus className="size-3" /> Add a feature
      </button>
      <BorrowFeature taken={taken} onPick={(entry) => write([...flat, { level: entry.level, feature: { n: entry.name, d: entry.text } }])} />
      <p className="text-[11px] text-stone-500">
        Granted by name as the character reaches each level. A borrowed feature keeps its name so the engine runs it; renaming it makes it words for the DM.
        Ability Score Improvements are counted by name, so keep them where the class should take them.
      </p>
    </div>
  );
}

// The armor categories; a druid's copy keeps its nonmetal shields, shown as
// shields with the rule beneath, and gives it up when shields are turned off.
function ArmorTraining({ armor, onChange }: { armor: string[]; onChange: (armor: string[]) => void }) {
  const nonmetal = armor.includes(NONMETAL_SHIELDS);
  const shown = armor.map((entry) => (entry === NONMETAL_SHIELDS ? "shields" : entry));
  return (
    <Field label="Armor training" hint={nonmetal ? "No metal armor or shields, as the druid." : undefined} plain>
      <ToggleChips
        options={ARMOR_TRAINING}
        selected={shown}
        onChange={(next) => onChange(next.map((entry) => (entry === "shields" && nonmetal ? NONMETAL_SHIELDS : entry)))}
      />
    </Field>
  );
}

// Simple and martial weapons, and weapons by name beside them, the way the
// wizard trains with daggers and the bard with rapiers.
function WeaponTraining({ weapons, onChange }: { weapons: string[]; onChange: (weapons: string[]) => void }) {
  const categories = weapons.filter((entry) => (WEAPON_TRAINING as readonly string[]).includes(entry));
  const named = weapons.filter((entry) => !categories.includes(entry));
  const held = new Set(named.map((entry) => weaponNamed(entry)?.name).filter(Boolean));
  const open = SRD_WEAPONS.filter((weapon) => !categories.includes(weapon.category) && !held.has(weapon.name));
  return (
    <Field label="Weapon training" plain>
      <div className="space-y-1.5">
        <ToggleChips options={WEAPON_TRAINING} selected={categories} onChange={(next) => onChange([...next, ...named])} />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {named.map((weapon) => (
            <span key={weapon} className="live-in inline-flex items-center rounded-md border border-stone-700 pl-2 text-stone-200">
              {weapon}
              <button type="button" aria-label={`Remove ${weapon}`} onClick={() => onChange(weapons.filter((entry) => entry !== weapon))} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <AddFromList
            prompt="Add a weapon"
            className="min-h-10 sm:min-h-0"
            options={open.map((weapon) => ({ value: weapon.name.toLowerCase(), label: weapon.name }))}
            onPick={(weapon) => onChange([...weapons, weapon])}
          />
        </div>
      </div>
    </Field>
  );
}

export function ClassFields({ data, set }: { data: Data; set: (patch: Data) => void }) {
  const blank = blankClassData();
  const saves = (Array.isArray(data.saves) ? data.saves : blank.saves) as string[];
  const skills = (data.skillChoices ?? blank.skillChoices) as { count: number; from: string[] };
  const tools = (Array.isArray(data.tools) ? data.tools : []) as string[];
  const casting = String(data.casterType ?? "none");
  const list = String(data.spellListFrom ?? "wizard") as (typeof SPELL_LISTS)[number];
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Hit die"
          value={String(data.hitDie ?? blank.hitDie)}
          options={HIT_DICE.map((die) => ({ value: String(die), label: `d${die}` }))}
          onChange={(value) => set({ hitDie: Number(value) })}
          hint="Hit points each level: the die, or its average, plus Constitution."
        />
        <Field label="Picks its subclass at level" hint="The builder asks for a subclass at this level; workshop subclasses can be made under this class." plain>
          <NumberStepper label="Level the subclass is picked at" value={Number(data.subclassLevel ?? blank.subclassLevel)} min={1} max={3} onChange={(subclassLevel) => set({ subclassLevel })} />
        </Field>
      </div>

      <Field label="Saving throws" hint={saves.length === 2 ? "Proficient in these two." : "Pick two."} plain>
        <ToggleChips
          options={ABILITIES}
          selected={saves}
          labels={ABILITY_LABELS}
          onChange={(next) => set({ saves: next.length > 2 ? next.slice(-2) : next })}
        />
      </Field>

      <Field label="Skills" hint={`A character picks ${skills.count} of the ${skills.from.length} marked.`} plain>
        <div className="space-y-1.5">
          <NumberStepper label="Skills a character picks" value={skills.count} min={0} max={6} onChange={(count) => set({ skillChoices: { ...skills, count } })} />
          <ToggleChips options={ALL_SKILLS} selected={skills.from} labels={SKILL_LABELS} onChange={(from) => set({ skillChoices: { ...skills, from } })} />
        </div>
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <ArmorTraining armor={(data.armor ?? []) as string[]} onChange={(armor) => set({ armor })} />
        <WeaponTraining weapons={(data.weapons ?? []) as string[]} onChange={(weapons) => set({ weapons })} />
      </div>

      <Field label="Tools" hint={tools.length ? undefined : "None. A class like the rogue starts with thieves' tools."} plain>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {tools.map((tool) => (
            <span key={tool} className="live-in inline-flex items-center rounded-md border border-stone-700 pl-2 text-stone-200">
              {tool}
              <button type="button" aria-label={`Remove ${tool}`} onClick={() => set({ tools: tools.filter((entry) => entry !== tool) })} className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}>
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          <AddFromList
            prompt="Add a tool"
            className="min-h-10 sm:min-h-0"
            options={TOOL_PROFICIENCIES.filter((tool) => !tools.some((entry) => textKey(entry) === textKey(tool))).map((tool) => ({ value: tool.toLowerCase(), label: tool }))}
            onPick={(tool) => set({ tools: [...tools, tool] })}
          />
        </div>
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <SelectField
          label="Spellcasting"
          value={casting}
          options={CASTING.map((option) => ({ ...option }))}
          onChange={(casterType) =>
            set(
              casterType === "none"
                ? { casterType, spellListFrom: null, spellAbility: null }
                : { casterType, spellListFrom: list, spellAbility: data.spellAbility ?? LIST_ABILITY[list] },
            )
          }
        />
        {casting !== "none" ? (
          <SelectField
            label="Spell list"
            value={list}
            options={SPELL_LISTS.map((value) => ({ value, label: `The ${value}'s` }))}
            onChange={(spellListFrom) => set({ spellListFrom, spellAbility: LIST_ABILITY[spellListFrom] })}
            hint={LEARNS.has(list) ? "Learns its spells for good, as that class does." : "Prepares its spells each day, as that class does."}
          />
        ) : null}
        {casting !== "none" ? (
          <SelectField
            label="Casts with"
            value={String(data.spellAbility ?? LIST_ABILITY[list])}
            options={(["int", "wis", "cha"] as const).map((value) => ({ value, label: ABILITY_LABELS[value] }))}
            onChange={(spellAbility) => set({ spellAbility })}
          />
        ) : null}
      </div>

      <Features data={data} set={set} />
    </div>
  );
}
