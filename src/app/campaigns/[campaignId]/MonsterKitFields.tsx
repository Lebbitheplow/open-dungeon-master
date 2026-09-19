"use client";

import { Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select as KitSelect } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { OptionGlossary } from "@/components/ui/OptionGlossary";
import type { GlossaryEntry } from "@/lib/help/terms";
import {
  ANCESTRY_OPTIONS,
  CLASS_KIT_OPTIONS,
  MOVEMENT_MODES,
  addTrait,
  applyAncestry,
  applyArmor,
  applyClassChassis,
  addAttack,
  armorOptionsFor,
  classFeatureLines,
  describeChassis,
  findWeapon,
  formatSpeed,
  hasTerm,
  parseSpeed,
  parseTerms,
  subclassOptionsFor,
  toggleTerm,
  weaponAttack,
  weaponOptionsFor,
} from "@/lib/bestiary/kit";
import { MAX_TRAITS, type MonsterDraft } from "@/lib/bestiary/monster-draft";
import { proficiencyBonus } from "@/lib/srd";

// The half of the monster editor that picks rather than types.
//
// Split out of MonsterFields for the reason every panel here is split: that
// file is the fields of a stat block, and this is the catalogue over them.
// Nothing in here decides anything either. Every control below produces an
// ordinary MonsterDraft through src/lib/bestiary/kit.ts, lands in a field
// MonsterFields already renders, and can be renamed, retyped or deleted
// afterwards like anything hand-written.

const input =
  "rounded-md border border-stone-700 bg-stone-950 px-2 py-1 text-xs text-stone-200 focus:border-amber-500/50 focus:outline-none";

const chip =
  "rounded-full border px-2 py-0.5 text-[10px] transition-colors duration-150";

// A term list stored as one comma-joined string. The catalogue is offered as
// chips; anything not in it stays typeable, because a monster immune to
// "sunlight" is a real monster and no list of ours will ever hold every
// answer.
export function TermPicker({
  label,
  value,
  known,
  onChange,
  glossary,
}: {
  label: string;
  value: string;
  known: readonly string[];
  onChange: (value: string) => void;
  // What the known terms mean, one line each, behind a ⓘ in the caption.
  glossary?: readonly GlossaryEntry[];
}) {
  const extras = parseTerms(value).filter(
    (term) => !known.some((entry) => entry.toLowerCase() === term.toLowerCase()),
  );
  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-stone-500">
        {label}
        {glossary ? <OptionGlossary title={label} entries={glossary} /> : null}
      </span>
      <div className="stagger-pop flex flex-wrap gap-1">
        {known.map((term) => {
          const on = hasTerm(value, term);
          return (
            <button
              key={term}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(toggleTerm(value, term))}
              className={cn(
                chip,
                on
                  ? "border-amber-500/50 bg-stone-800 text-amber-100"
                  : "border-stone-700 text-stone-500 hover:text-stone-200",
              )}
            >
              {term}
            </button>
          );
        })}
        {extras.map((term) => (
          <button
            key={term}
            type="button"
            aria-pressed
            onClick={() => onChange(toggleTerm(value, term))}
            title="Your own; click to remove"
            className={cn(chip, "border-amber-500/50 bg-stone-800 text-amber-100")}
          >
            {term}
          </button>
        ))}
      </div>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="or type your own, comma separated"
        className={cn(input, "w-full")}
      />
    </div>
  );
}

// Speed is one printed string ("30, fly 60") because that is what a stat
// block says and what the fight reads. Nobody should have to know the comma
// convention to give a dragon a fly speed.
export function SpeedPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const speeds = parseSpeed(value);
  const set = (mode: "walk" | (typeof MOVEMENT_MODES)[number], feet: number) =>
    onChange(formatSpeed({ ...speeds, [mode]: feet }));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">Speed</span>
      <div className="flex flex-wrap gap-2">
        {(["walk", ...MOVEMENT_MODES] as const).map((mode) => (
          <div key={mode} className="flex flex-col gap-0.5">
            <span className="text-[10px] capitalize text-stone-600">{mode}</span>
            <NumberStepper
              min={0}
              max={999}
              step={5}
              value={speeds[mode] ?? 0}
              onChange={(feet) => set(mode, feet)}
              label={`${mode} speed in feet`}
              size="sm"
            />
          </div>
        ))}
      </div>
      <span className="text-[10px] text-stone-600">Reads as &quot;{value || "0"}&quot;. Zero hides a mode.</span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  // The first row is the "" choice ("Pick one", "None"), still pickable so a
  // choice can be taken back, as the blank option of the old list was.
  options: Array<{ value: string; label: string }>;
  className?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-stone-500">{label}</span>
      <KitSelect value={value} onChange={onChange} options={options} label={label} size="sm" className={className ?? "w-40"} />
    </label>
  );
}

// The catalogue, aimed at the block. Four independent moves: what it is,
// what it trained as, what it is holding, and which of that class's
// abilities it actually brought.
export function MonsterKitPanel({
  draft,
  onChange,
}: {
  draft: MonsterDraft;
  onChange: (draft: MonsterDraft) => void;
}) {
  const [ancestryId, setAncestryId] = useState("");
  const [classId, setClassId] = useState("");
  const [subclass, setSubclass] = useState("");
  const [level, setLevel] = useState(5);
  const [con, setCon] = useState(14);
  const [armorName, setArmorName] = useState("");
  const [shield, setShield] = useState(false);
  const [weaponName, setWeaponName] = useState("");
  const [weaponMod, setWeaponMod] = useState(3);

  const subclasses = subclassOptionsFor(classId);
  const features = classFeatureLines(classId, subclass, level);
  const chassis = { classId, subclass, level, con, ancestryId };
  const traitsFull = draft.stats.traits.length >= MAX_TRAITS;
  const attacksFull = draft.stats.attacks.length >= 4;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-stone-800 bg-stone-950/50 p-3">
      <h4 className="flex items-center gap-1.5 text-xs text-amber-100">
        <Wand2 className="size-3.5" /> Build it out of the catalogue
      </h4>
      <p className="text-[10px] text-stone-600">
        Everything these add is an ordinary line on the block below: rename it, retune the
        numbers, or delete it. Mix as many classes as you like.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Ancestry"
          value={ancestryId}
          onChange={setAncestryId}
          options={[{ value: "", label: "Pick one" }, ...ANCESTRY_OPTIONS.map((ancestry) => ({ value: ancestry.id as string, label: ancestry.name }))]}
        />
        <button
          type="button"
          disabled={!ancestryId}
          onClick={() => onChange(applyAncestry(draft, ancestryId))}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          Take its size, speed and traits
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Class"
          value={classId}
          onChange={(next) => {
            setClassId(next);
            setSubclass("");
          }}
          options={[{ value: "", label: "Pick one" }, ...CLASS_KIT_OPTIONS.map((klass) => ({ value: klass.id as string, label: klass.name }))]}
        />
        <Select
          label="Subclass"
          value={subclass}
          onChange={setSubclass}
          options={[{ value: "", label: subclasses.length ? "None" : "None available" }, ...subclasses.map((name) => ({ value: name, label: name }))]}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Level</span>
          <NumberStepper min={1} max={20} value={level} onChange={setLevel} label="Level" size="sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">CON</span>
          <NumberStepper min={1} max={30} value={con} onChange={setCon} label="CON" size="sm" />
        </div>
        <button
          type="button"
          disabled={!classId}
          onClick={() => onChange(applyClassChassis(draft, chassis))}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          Take its hit points, saves and swings
        </button>
      </div>
      {classId ? (
        <p className="reveal text-[10px] text-stone-600">{describeChassis(chassis)}</p>
      ) : null}

      {features.length ? (
        <div className="reveal flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">
            Its abilities at that level {traitsFull ? "(trait list full)" : "(click to add)"}
          </span>
          <div className="stagger-pop flex flex-wrap gap-1">
            {features.map((feature) => {
              const on = draft.stats.traits.some(
                (trait) => trait.trim().toLowerCase() === feature.line.toLowerCase(),
              );
              return (
                <button
                  key={`${feature.name}-${feature.level}`}
                  type="button"
                  disabled={on || traitsFull}
                  title={feature.text || `Gained at level ${feature.level}`}
                  onClick={() => onChange(addTrait(draft, feature.line))}
                  className={cn(
                    chip,
                    on
                      ? "border-amber-500/50 bg-stone-800 text-amber-100"
                      : "border-stone-700 text-stone-400 hover:text-amber-100 disabled:opacity-40",
                  )}
                >
                  {on ? null : <Plus className="mr-0.5 inline size-2.5" />}
                  {feature.name}
                  <span className="ml-1 text-stone-600">{feature.level}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Armour"
          value={armorName}
          onChange={setArmorName}
          options={[
            { value: "", label: "Unarmoured" },
            ...armorOptionsFor(classId)
              .filter((armor) => armor.category !== "shield")
              .map((armor) => ({ value: armor.name, label: `${armor.name} (${armor.baseAc})` })),
          ]}
        />
        <label className="flex items-center gap-1.5 pb-1 text-[11px] text-stone-400">
          <Switch on={shield} onChange={setShield} label="Shield" />
          Shield
        </label>
        <button
          type="button"
          onClick={() => onChange(applyArmor(draft, armorName, shield))}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100"
        >
          Set the armour class
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Weapon"
          value={weaponName}
          onChange={setWeaponName}
          className="w-44"
          options={[{ value: "", label: "Pick one" }, ...weaponOptionsFor(classId).map((weapon) => ({ value: weapon.name, label: `${weapon.name} (${weapon.damage})` }))]}
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-stone-500">Ability mod</span>
          <NumberStepper min={0} max={10} value={weaponMod} onChange={setWeaponMod} label="Ability mod" size="sm" />
        </div>
        <button
          type="button"
          disabled={!weaponName || attacksFull}
          onClick={() => {
            const weapon = findWeapon(weaponName);
            if (weapon) {
              onChange(
                addAttack(
                  draft,
                  weaponAttack(weapon, {
                    profBonus: proficiencyBonus(level),
                    abilityMod: weaponMod,
                  }),
                ),
              );
            }
          }}
          className="rounded-md border border-stone-700 px-2 py-1 text-[11px] text-stone-300 hover:text-amber-100 disabled:opacity-40"
        >
          {attacksFull ? "Attack list full" : "Add it as an attack"}
        </button>
        <span className="pb-1 text-[10px] text-stone-600">
          To hit +{proficiencyBonus(level) + Math.max(0, weaponMod)} at level {level}.
        </span>
      </div>
    </div>
  );
}
