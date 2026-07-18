"use client";

import { Loader2, X } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import { suggestedSpellCount } from "@/lib/content/mechanics";
import type { Ability, AbilityScores, AsiChoice, CreateSheetInput } from "@/lib/schemas/sheet";
import {
  SRD_SKILLS,
  abilityMod,
  computeSheetDerived,
  formatModifier,
  proficiencyBonus,
  spellSlotsFor,
  suggestedStartingHp,
} from "@/lib/srd";
import { ASI_LEVELS, applyAsiChoices } from "@/lib/srd/asi";
import { defaultLoadout, suggestWeapons } from "@/lib/srd/weapons";
import AbilityEditor, { type AbilityMethod, type AbilityState } from "./AbilityEditor";
import AsiFeatEditor from "./AsiFeatEditor";
import ContentPicker from "./ContentPicker";
import EquipmentSection from "./EquipmentSection";
import { useArchetypes, useBuilderOptions } from "./useBuilderOptions";

const ALIGNMENTS = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"];

export type BuilderResult = { level: number; sheet: CreateSheetInput };

// Full character creation form: Open5e races/classes/subclasses/backgrounds
// (SRD fallback), three ability-score methods, spell/equipment/feat pickers,
// live derived stats. Used by /characters/new and the campaign flow.
export default function CharacterBuilder({
  fixedLevel,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  fixedLevel?: number;
  submitLabel: string;
  onSubmit: (result: BuilderResult) => void;
  busy: boolean;
  error: string;
}) {
  const { races, classes, backgrounds, packInstalled } = useBuilderOptions();

  const [name, setName] = useState("");
  const [alignment, setAlignment] = useState("N");
  const [level, setLevel] = useState(fixedLevel ?? 1);
  const [raceId, setRaceId] = useState("");
  const [classId, setClassId] = useState("");
  const [subclass, setSubclass] = useState("");
  const [backgroundId, setBackgroundId] = useState("");
  const [method, setMethod] = useState<AbilityMethod>("standard");
  const [scores, setScores] = useState<AbilityState>({
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [spells, setSpells] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<Array<{ name: string; qty: number; slug?: string }>>([]);
  // Auto-added class weapons the user explicitly removed; reset on class change.
  const [removedAutoNames, setRemovedAutoNames] = useState<string[]>([]);
  const [feats, setFeats] = useState<string[]>([]);
  // One slot per ASI threshold the effective level has earned; kept full
  // length so lowering and re-raising the level restores earlier picks.
  const [asiChoices, setAsiChoices] = useState<Array<AsiChoice | null>>([]);
  const [backstory, setBackstory] = useState("");
  const [gold, setGold] = useState(15);
  const [hpOverride, setHpOverride] = useState<number | null>(null);
  const [acOverride, setAcOverride] = useState<number | null>(null);
  const [localError, setLocalError] = useState("");

  const race = races.find((entry) => entry.id === raceId) ?? races[0];
  const klass = classes.find((entry) => entry.id === classId) ?? classes[0];
  const background = backgrounds.find((entry) => entry.id === backgroundId) ?? backgrounds[0];
  const archetypes = useArchetypes(klass?.id ?? "");
  const effectiveLevel = fixedLevel ?? level;
  const asiSlotLevels = useMemo(
    () => ASI_LEVELS.filter((threshold) => effectiveLevel >= threshold),
    [effectiveLevel],
  );
  const activeAsiChoices = useMemo(
    () => asiSlotLevels.map((_, index) => asiChoices[index] ?? null),
    [asiSlotLevels, asiChoices],
  );

  // Base scores after racial bonuses, before level ASIs; what the ASI cards
  // build on.
  const baseAbilities = useMemo<AbilityScores | null>(() => {
    if (!race || Object.values(scores).some((value) => value === null)) {
      return null;
    }
    const final = { ...(scores as Record<Ability, number>) };
    for (const [ability, bonus] of Object.entries(race.asi)) {
      final[ability as Ability] += bonus ?? 0;
    }
    return final as AbilityScores;
  }, [scores, race]);

  const abilities = useMemo<AbilityScores | null>(
    () => (baseAbilities ? applyAsiChoices(baseAbilities, activeAsiChoices) : null),
    [baseAbilities, activeAsiChoices],
  );

  const preview = useMemo(() => {
    if (!abilities || !race || !klass || !background) {
      return null;
    }
    const proficiencies = {
      saves: klass.saves,
      skills: [...new Set([...chosenSkills, ...background.skills])],
      languages: race.languages,
      tools: [] as string[],
      armor: klass.armor,
      weapons: klass.weapons,
    };
    const derived = computeSheetDerived({
      abilities,
      level: effectiveLevel,
      proficiencies,
      spellcasting: klass.spellAbility
        ? { ability: klass.spellAbility, slots: {}, prepared: [], known: [] }
        : null,
    });
    const maxHp =
      hpOverride ?? suggestedStartingHp(klass.id, race.id, abilities.con, effectiveLevel);
    const ac = acOverride ?? 10 + derived.abilityMods.dex;
    return { proficiencies, derived, maxHp, ac };
  }, [abilities, race, klass, background, chosenSkills, effectiveLevel, hpOverride, acOverride]);

  // Class-appropriate starting weapons ride along automatically (removable
  // chips) so no character begins the adventure unarmed.
  const autoLoadout = useMemo(() => (klass ? defaultLoadout(klass.weapons) : []), [klass]);
  const suggestedWeapons = useMemo(() => (klass ? suggestWeapons(klass.weapons) : []), [klass]);
  const fullEquipment = useMemo(() => {
    const manualNames = new Set(equipment.map((item) => item.name));
    const auto = autoLoadout
      .filter((weapon) => !removedAutoNames.includes(weapon.name) && !manualNames.has(weapon.name))
      .map((weapon) => ({ name: weapon.name, qty: 1 }));
    return [...auto, ...equipment];
  }, [equipment, autoLoadout, removedAutoNames]);

  function addEquipmentItem(entry: { name: string; qty?: number; slug?: string }) {
    setEquipment((current) => {
      const existing = current.find((item) => item.name === entry.name);
      if (existing) {
        return current.map((item) =>
          item.name === entry.name ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [...current, { name: entry.name, qty: entry.qty ?? 1, slug: entry.slug }];
    });
  }

  function removeEquipmentItem(name: string) {
    if (equipment.some((item) => item.name === name)) {
      setEquipment((current) => current.filter((item) => item.name !== name));
    } else {
      setRemovedAutoNames((removed) =>
        removed.includes(name) ? removed : [...removed, name],
      );
    }
  }

  const spellAdvice =
    klass?.spellAbility && abilities
      ? suggestedSpellCount(klass.id, effectiveLevel, abilityMod(abilities[klass.spellAbility]))
      : null;
  const maxSpellLevel = useMemo(() => {
    if (!klass || klass.casterType === "none") {
      return 0;
    }
    const slots = spellSlotsFor(klass.id, effectiveLevel);
    return Object.keys(slots).reduce((top, slotLevel) => Math.max(top, Number(slotLevel)), 0);
  }, [klass, effectiveLevel]);

  function toggleSkill(skillId: string) {
    if (!klass || !background) {
      return;
    }
    setChosenSkills((current) =>
      current.includes(skillId)
        ? current.filter((entry) => entry !== skillId)
        : current.length < klass.skillChoices.count
          ? [...current, skillId]
          : current,
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!abilities || !preview || !race || !klass || !background) {
      setLocalError("Assign all six ability scores first.");
      return;
    }
    if (!name.trim()) {
      setLocalError("Give your character a name.");
      return;
    }
    const unresolvedSlot = activeAsiChoices.findIndex((choice) => choice === null);
    if (unresolvedSlot !== -1) {
      setLocalError(
        `Resolve your level ${asiSlotLevels[unresolvedSlot]} ability score improvement first.`,
      );
      return;
    }
    setLocalError("");
    const resolvedAsiChoices = activeAsiChoices.filter(
      (choice): choice is AsiChoice => choice !== null,
    );
    const asiFeats = resolvedAsiChoices.flatMap((choice) =>
      choice.mode === "feat" ? [choice.feat] : [],
    );
    const slots = Object.fromEntries(
      Object.entries(spellSlotsFor(klass.id, effectiveLevel)).map(([slotLevel, max]) => [
        slotLevel,
        { max, used: 0 },
      ]),
    );
    const isKnownCaster = ["bard", "sorcerer", "warlock", "ranger"].includes(klass.id);
    onSubmit({
      level: effectiveLevel,
      sheet: {
        name: name.trim(),
        race: race.id,
        class: klass.id,
        subclass,
        background: background.id,
        alignment,
        abilities,
        maxHp: preview.maxHp,
        ac: preview.ac,
        portrait: null,
        speed: race.speed,
        hitDice: {
          die: `d${klass.hitDie}` as "d6" | "d8" | "d10" | "d12",
          total: effectiveLevel,
          spent: 0,
        },
        proficiencies: preview.proficiencies,
        equipment: fullEquipment,
        gold,
        feats: [...new Set([...asiFeats, ...feats])],
        asiChoices: resolvedAsiChoices,
        spellcasting: klass.spellAbility
          ? {
              ability: klass.spellAbility,
              slots,
              prepared: isKnownCaster ? [] : spells,
              known: isKnownCaster ? spells : [],
            }
          : null,
        notes: "",
        backstory: backstory.trim(),
      },
    });
  }

  if (!races.length || !classes.length || !backgrounds.length) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" />
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-sm text-stone-200 outline-none focus:border-amber-300";
  const chip = (label: string, onRemove: () => void, homebrew = false) => (
    <span
      key={label}
      className={cn(
        "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        homebrew ? "border-amber-800 bg-amber-950/40 text-amber-200" : "border-stone-700 bg-stone-900 text-stone-200",
      )}
    >
      {label}
      <button type="button" onClick={onRemove} className="text-stone-500 hover:text-red-400">
        <X className="size-3" />
      </button>
    </span>
  );

  return (
    <form onSubmit={submit} className="space-y-6 text-sm">
      {!packInstalled ? (
        <p className="rounded-md border border-stone-800 bg-stone-900/60 p-3 text-xs text-stone-400">
          Content pack not installed; showing SRD 5.1 basics only. Run
          <span className="font-mono"> node scripts/import-open5e.mjs</span> on the server
          for the full Open5e catalog.
        </p>
      ) : null}

      <section className="panel ornate grid gap-3 rounded-xl p-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-stone-400">Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} className={inputClass} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-stone-400">Alignment</span>
            <select value={alignment} onChange={(event) => setAlignment(event.target.value)} className={inputClass}>
              {ALIGNMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">Level</span>
            {fixedLevel ? (
              <span className="block rounded-md border border-stone-800 bg-stone-950 px-3 py-2 text-stone-400">
                {fixedLevel} (campaign)
              </span>
            ) : (
              <select value={level} onChange={(event) => setLevel(Number(event.target.value))} className={inputClass}>
                {Array.from({ length: 20 }, (_, index) => index + 1).map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            )}
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-stone-400">Race</span>
          <select value={race?.id ?? ""} onChange={(event) => setRaceId(event.target.value)} className={inputClass}>
            {races.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          {race?.note ? <span className="mt-1 line-clamp-2 block text-xs text-stone-500">{race.note}</span> : null}
        </label>
        <label className="block">
          <span className="mb-1 block text-stone-400">Class</span>
          <select
            value={klass?.id ?? ""}
            onChange={(event) => { setClassId(event.target.value); setChosenSkills([]); setSubclass(""); setSpells([]); setRemovedAutoNames([]); }}
            className={inputClass}
          >
            {classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          {klass ? (
            <span className="mt-1 block text-xs text-stone-500">
              d{klass.hitDie} hit die · saves {klass.saves.map((save) => save.toUpperCase()).join(", ")}
              {klass.spellAbility ? ` · ${klass.spellAbility.toUpperCase()} caster` : ""}
            </span>
          ) : null}
        </label>
        {archetypes.length ? (
          <label className="block">
            <span className="mb-1 block text-stone-400">Subclass</span>
            <select value={subclass} onChange={(event) => setSubclass(event.target.value)} className={inputClass}>
              <option value="">None yet</option>
              {archetypes.map((entry) => <option key={entry.id} value={entry.name}>{entry.name}</option>)}
            </select>
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-stone-400">Background</span>
          <select value={background?.id ?? ""} onChange={(event) => setBackgroundId(event.target.value)} className={inputClass}>
            {backgrounds.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
          {background?.skills.length ? (
            <span className="mt-1 block text-xs text-stone-500">
              Grants {background.skills.map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name ?? skillId).join(", ")}
            </span>
          ) : null}
        </label>
      </section>

      <AbilityEditor
        method={method}
        onMethodChange={setMethod}
        scores={scores}
        onScoresChange={setScores}
        racialBonus={race?.asi ?? {}}
      />

      {asiSlotLevels.length ? (
        <AsiFeatEditor
          slotLevels={asiSlotLevels}
          baseScores={baseAbilities}
          choices={activeAsiChoices}
          onChange={(next) =>
            setAsiChoices((current) => {
              const merged = [...current];
              next.forEach((choice, index) => {
                merged[index] = choice;
              });
              return merged;
            })
          }
        />
      ) : null}

      {klass ? (
        <section className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-2 text-xs text-amber-200/90">Class skills (pick {klass.skillChoices.count})</h2>
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId);
              const fromBackground = background?.skills.includes(skillId) ?? false;
              const selected = chosenSkills.includes(skillId);
              return (
                <button
                  key={skillId}
                  type="button"
                  onClick={() => toggleSkill(skillId)}
                  disabled={fromBackground}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    fromBackground
                      ? "border-stone-800 bg-stone-900 text-stone-500"
                      : selected
                        ? "border-amber-700 bg-amber-950 text-amber-200"
                        : "border-stone-700 text-stone-300 hover:bg-stone-900",
                  )}
                >
                  {skill?.name ?? skillId}
                  {fromBackground ? " (background)" : ""}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {klass?.spellAbility ? (
        <section className="panel rounded-xl p-4">
          <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Spells</h2>
          <p className="mb-2 text-xs text-stone-500">
            {spellAdvice
              ? `Suggested: ${spellAdvice.count} ${spellAdvice.label} at level ${effectiveLevel}. `
              : ""}
            Up to level {maxSpellLevel} spells. Cantrips welcome. Not enforced; homebrew varies.
          </p>
          <ContentPicker
            kind="spells"
            extraParams={{ class: klass.id, level: String(maxSpellLevel) }}
            placeholder="Search spells (e.g. cure wounds)"
            onPick={(entry) => setSpells((current) => (current.includes(entry.name) ? current : [...current, entry.name]))}
            renderMeta={(entry) => (entry.level === 0 ? "cantrip" : `level ${entry.level}`)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {spells.map((spell) => chip(spell, () => setSpells((current) => current.filter((entry) => entry !== spell))))}
          </div>
        </section>
      ) : null}

      <EquipmentSection
        equipment={fullEquipment}
        suggestions={suggestedWeapons}
        onAdd={addEquipmentItem}
        onAddMany={(entries) =>
          setEquipment((current) => {
            const names = new Set(current.map((item) => item.name));
            return [...current, ...entries.filter((item) => !names.has(item.name))];
          })
        }
        onRemove={removeEquipmentItem}
        gold={gold}
        setGold={setGold}
        chip={chip}
        inputClass={inputClass}
      />

      <section className="panel rounded-xl p-4">
        <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Backstory (optional)</h2>
        <p className="mb-2 text-xs text-stone-500">
          Who were they before the adventure? The party can read this, and the DM weaves it
          into the story.
        </p>
        <textarea
          value={backstory}
          onChange={(event) => setBackstory(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="A disgraced temple guard looking for a second chance..."
          className={cn(inputClass, "resize-y")}
        />
      </section>

      <section className="panel rounded-xl p-4">
        <h2 className="eyebrow mb-1 text-xs text-amber-200/90">Additional feats (optional)</h2>
        {asiSlotLevels.length ? (
          <p className="mb-2 text-xs text-stone-500">
            Beyond the ability score improvement picks above; racial or homebrew feats go here.
          </p>
        ) : null}
        <ContentPicker
          kind="feats"
          placeholder="Search feats (e.g. alert, tough)"
          onPick={(entry) => setFeats((current) => (current.includes(entry.name) ? current : [...current, entry.name]))}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {feats.map((feat) => chip(feat, () => setFeats((current) => current.filter((entry) => entry !== feat))))}
        </div>
      </section>

      {preview && race ? (
        <section className="panel ornate rounded-xl border-amber-500/30 p-4">
          <h2 className="eyebrow mb-2 text-xs text-amber-200/90">Derived stats</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-stone-300 sm:grid-cols-4">
            <label className="block">
              <span className="block text-xs text-stone-500">Max HP</span>
              <input
                type="number"
                min={1}
                max={500}
                value={preview.maxHp}
                onChange={(event) => setHpOverride(Number(event.target.value) || 1)}
                className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-stone-500">AC</span>
              <input
                type="number"
                min={1}
                max={30}
                value={preview.ac}
                onChange={(event) => setAcOverride(Number(event.target.value) || 10)}
                className="w-20 rounded border border-stone-700 bg-stone-900 px-2 py-1"
              />
            </label>
            <span className="self-end">Speed {race.speed} ft</span>
            <span className="self-end">Prof {formatModifier(proficiencyBonus(effectiveLevel))}</span>
            <span>Initiative {formatModifier(preview.derived.initiative)}</span>
            <span>Passive Perception {preview.derived.passivePerception}</span>
            {preview.derived.spellSaveDc ? <span>Spell DC {preview.derived.spellSaveDc}</span> : null}
            {preview.derived.spellAttack !== null ? (
              <span>Spell attack {formatModifier(preview.derived.spellAttack)}</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {localError || error ? <p className="text-red-400">{localError || error}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-200 px-3 py-2.5 font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {submitLabel}
      </button>
    </form>
  );
}
