"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { MAX_TRAITS, TRAIT_MAX, type MonsterDraft } from "@/lib/bestiary/monster-draft";
import {
  ABILITY_ORDER,
  ENVIRONMENTS,
  SECTION_LABELS,
  SENSE_NAMES,
  SKILL_NAMES,
  TRAIT_SECTIONS,
  abilityMod,
  sectionOfLine,
  withSection,
} from "@/lib/bestiary/block-sections";
import type { EnemyStats, SaveAbility } from "@/lib/bestiary/statblock";
import { LANGUAGES, appendTerm } from "@/lib/workshop/pickers";
import { AddFromList } from "@/components/ui/AddFromList";
import { ContentPick } from "@/components/ui/ContentPick";
import { OptionGlossary } from "@/components/ui/OptionGlossary";
import { describeSkill } from "@/lib/help";
import type { GlossaryEntry } from "@/lib/help/terms";
import { ALIGNMENT_LABELS } from "@/app/characters/builder/usePickerGroups";
import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Field, FieldLabel, OptionalStepper, addChip, chip, chipOn, chipRow, rowIcon } from "@/app/workshop/kit";

// The printed half of a stat block (docs/workshop-parity-audit.md phase
// 12): ability scores, skills, senses, languages and alignment, the spells
// a caster knows, where it lives, and a section on every trait line so the
// block reads in the order a book prints it. None of it changes what the
// engine runs, which is the attack list; it changes what the DM running the
// monster gets told, and whether the block looks finished.

const ALIGNMENTS = [
  "",
  "lawful good",
  "neutral good",
  "chaotic good",
  "lawful neutral",
  "neutral",
  "chaotic neutral",
  "lawful evil",
  "neutral evil",
  "chaotic evil",
  "unaligned",
  "any alignment",
] as const;

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

type Setter = (patch: Partial<EnemyStats>) => void;

const capital = (text: string) => text.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
const ALIGNMENT_OPTIONS = ALIGNMENTS.map((alignment) => ({ value: alignment as string, label: alignment ? capital(alignment) : "Unstated" }));
const SECTION_OPTIONS = TRAIT_SECTIONS.map((section) => ({ value: section, label: SECTION_LABELS[section] }));
// The painted glyph for a sense; the names are the engine's keys.
const SENSE_GLYPHS: Record<string, string> = {
  blindsight: "sense-blindsight",
  darkvision: "sense-darkvision",
  tremorsense: "sense-tremorsense",
  truesight: "sense-truesight",
};

// What each skill and alignment means, for the ⓘ beside those lists. The
// alignment blurbs are the character builder's; the bestiary's list uses
// the spelled-out names, so they are matched by name.
const SKILL_GLOSSARY: GlossaryEntry[] = SKILL_NAMES.flatMap((name) => {
  const blurb = describeSkill(name.toLowerCase().replace(/\s+/g, "_")) ?? describeSkill(name);
  return blurb ? [{ name, blurb }] : [];
});
const ALIGNMENT_GLOSSARY: GlossaryEntry[] = Object.values(ALIGNMENT_LABELS).map((entry) => ({
  name: entry.name,
  blurb: entry.blurb,
}));

export function AbilityScores({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const stats = draft.stats;
  const set: Setter = (patch) => onChange({ ...draft, stats: { ...stats, ...patch } });
  const scores = stats.abilities ?? {};
  const setScore = (ability: SaveAbility, value: number | "") => {
    const next = { ...scores };
    if (value === "") {
      delete next[ability];
    } else {
      next[ability] = value;
    }
    set({ abilities: Object.keys(next).length ? next : undefined });
  };
  // A DM who typed the six scores usually means the saves and the DEX
  // modifier to follow from them, the way a printed block's do.
  const derive = () =>
    set({
      dexMod: typeof scores.dex === "number" ? abilityMod(scores.dex) : stats.dexMod,
      saveMods: Object.fromEntries(
        ABILITY_ORDER.map((ability) => [
          ability,
          typeof scores[ability] === "number" ? abilityMod(scores[ability] as number) : stats.saveMods?.[ability] ?? 0,
        ]),
      ) as EnemyStats["saveMods"],
    });
  return (
    <div className="space-y-1">
      <SectionHead
        title="Ability scores"
        glyph="ability-str"
        className="mb-1"
        aside={
          <button
            type="button"
            onClick={derive}
            disabled={!Object.keys(scores).length}
            className={cn(ui.btnSmall, addChip)}
            title="Set the DEX modifier and the saving throws from these scores"
          >
            Saves from scores
          </button>
        }
      />
      <div className="stagger-up grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ABILITY_ORDER.map((ability) => (
          <div key={ability} className="flex flex-col gap-1">
            <span className="flex items-center gap-1">
              <GameIcon icon={{ kind: "glyph", key: `ability-${ability}` }} size="size-5" />
              <FieldLabel className="uppercase">{ability}</FieldLabel>
              {typeof scores[ability] === "number" ? (
                <span className="text-[11px] text-stone-400">{signed(abilityMod(scores[ability] as number))}</span>
              ) : null}
            </span>
            <OptionalStepper
              label={`${ability.toUpperCase()} score`}
              min={1}
              max={30}
              fallback={10}
              value={scores[ability]}
              onChange={(next) => setScore(ability, next)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SkillsAndSenses({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const stats = draft.stats;
  const set: Setter = (patch) => onChange({ ...draft, stats: { ...stats, ...patch } });
  const skills = stats.skills ?? {};
  const senses = stats.senses ?? {};
  const passiveDefault = 10 + (skills.perception ?? stats.saveMods?.wis ?? 0);
  const setSense = (name: keyof NonNullable<EnemyStats["senses"]>, value: number | "") => {
    const next = { ...senses };
    if (value === "" || value === 0) {
      delete next[name];
    } else {
      next[name] = value;
    }
    set({ senses: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <SectionHead title="Skills and senses" glyph="skill-perception" className="mb-1" />
        <span className="flex items-center gap-1">
          <FieldLabel>Skills (tap to add, type the bonus)</FieldLabel>
          <OptionGlossary title="Skills" entries={SKILL_GLOSSARY} />
        </span>
        <div className={cn("stagger-pop", chipRow)}>
          {SKILL_NAMES.map((name) => {
            const bonus = skills[name];
            const on = typeof bonus === "number";
            return (
              <span key={name} className="flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = { ...skills };
                    if (on) {
                      delete next[name];
                    } else {
                      next[name] = Math.max(2, stats.dexMod + 2);
                    }
                    set({ skills: Object.keys(next).length ? next : undefined });
                  }}
                  className={cn(ui.btnSmall, chip, on && chipOn)}
                >
                  <GameIcon icon={{ kind: "glyph", key: `skill-${name.toLowerCase().replace(/\s+/g, "-")}` }} size="size-4" />
                  {name}
                </button>
                {on ? (
                  <NumberStepper
                    size="sm"
                    label={`${name} bonus`}
                    min={-5}
                    max={20}
                    value={bonus}
                    onChange={(next) => set({ skills: { ...skills, [name]: next } })}
                  />
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      <div className="stagger-up grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SENSE_NAMES.map((name) => (
          <div key={name} className="flex flex-col gap-1">
            <span className="flex items-center gap-1">
              {SENSE_GLYPHS[name] ? <GameIcon icon={{ kind: "glyph", key: SENSE_GLYPHS[name] }} size="size-5" /> : null}
              <FieldLabel className="capitalize">{name}</FieldLabel>
            </span>
            <OptionalStepper
              label={`${name} in feet`}
              min={0}
              max={600}
              step={5}
              suffix="ft"
              fallback={0}
              value={senses[name]}
              onChange={(next) => setSense(name, next)}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1">
            <GameIcon icon={{ kind: "glyph", key: "sense-passive-perception" }} size="size-5" />
            <FieldLabel>Passive Perception</FieldLabel>
          </span>
          <OptionalStepper
            label="Passive Perception"
            min={1}
            max={40}
            fallback={passiveDefault}
            value={senses.passivePerception}
            onChange={(next) => setSense("passivePerception", next)}
          />
          {typeof senses.passivePerception === "number" ? null : (
            <span className="text-[11px] text-stone-500">Unset, so it reads as {passiveDefault}.</span>
          )}
        </div>
      </div>
      <p className="text-[11px] text-stone-500">
        A hiding character has to beat the passive Perception; the printed number wins, then the skill, then Wisdom.
      </p>
    </div>
  );
}

export function LanguagesAndHabitat({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const stats = draft.stats;
  const set: Setter = (patch) => onChange({ ...draft, stats: { ...stats, ...patch } });
  const environment = stats.environment ?? [];
  const spells = stats.spells ?? [];
  return (
    <div className="space-y-2">
      <SectionHead title="Tongue, creed and habitat" glyph="system-lore" className="mb-1" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field as="label" label="Languages">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={stats.languages ?? ""}
              maxLength={200}
              placeholder="Common, Goblin"
              onChange={(event) => set({ languages: event.target.value || undefined })}
              className={cn(ui.input, "min-w-32 flex-1")}
            />
            <AddFromList
              prompt="Add"
              options={LANGUAGES}
              onPick={(term) => set({ languages: appendTerm(stats.languages ?? "", term) })}
            />
          </div>
        </Field>
        <Field label="Alignment" aside={<OptionGlossary title="Alignments" entries={ALIGNMENT_GLOSSARY} />}>
          <Select
            label="Alignment"
            value={stats.alignment ?? ""}
            onChange={(next) => set({ alignment: next || undefined })}
            options={ALIGNMENT_OPTIONS}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel>Spells known (by name, comma separated)</FieldLabel>
        <input
          defaultValue={spells.join(", ")}
          key={spells.join("|")}
          maxLength={800}
          aria-label="Spells known"
          placeholder="Fire Bolt, Shield, Misty Step"
          onBlur={(event) => {
            const next = event.target.value.split(",").map((name) => name.trim()).filter(Boolean);
            if (next.join("|") !== spells.join("|")) {
              set({ spells: next.length ? next : undefined });
            }
          }}
          className={ui.input}
        />
        <ContentPick
          kind="spells"
          label="Find a spell in the catalogue to add"
          placeholder="Find a spell to add..."
          onPick={(entry) => {
            if (!spells.some((known) => known.toLowerCase() === entry.name.toLowerCase())) {
              set({ spells: [...spells, entry.name] });
            }
          }}
        />
        <span className="text-[11px] text-stone-500">
          The DM running it sees the list. Put a round of casting into extra damage so the rating counts it.
        </span>
      </div>
      <div className="space-y-1">
        <FieldLabel>Found in</FieldLabel>
        <div className={cn("stagger-pop", chipRow)}>
          {ENVIRONMENTS.map((place) => {
            const on = environment.includes(place);
            return (
              <button
                key={place}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? environment.filter((entry) => entry !== place) : [...environment, place];
                  set({ environment: next.length ? next : undefined });
                }}
                className={cn(ui.btnSmall, chip, on && chipOn)}
              >
                {place}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The trait list with a section on every line. The line stored is the one
// the DM prompt prints, prefix and all (src/lib/bestiary/block-sections.ts).
export function SectionedTraitEditor({ draft, onChange }: { draft: MonsterDraft; onChange: (draft: MonsterDraft) => void }) {
  const traits = draft.stats.traits;
  const setTraits = (next: string[]) => onChange({ ...draft, stats: { ...draft.stats, traits: next } });
  return (
    <div className="flex flex-col gap-1.5">
      <SectionHead title="Traits and actions" glyph="tab-notes" className="mb-0" />
      {traits.map((trait, index) => {
        const { section, text } = sectionOfLine(trait);
        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
            <span className="w-40 shrink-0">
              <Select
                label="Section"
                value={section}
                onChange={(next) => setTraits(traits.map((row, at) => (at === index ? withSection(row, next) : row)))}
                options={SECTION_OPTIONS}
              />
            </span>
            <input
              value={text}
              maxLength={TRAIT_MAX}
              onChange={(event) =>
                setTraits(traits.map((row, at) => (at === index ? withSection(event.target.value, section) : row)))
              }
              placeholder="Fire Breath (Recharge 5-6): DC 15 Dex save, 6d6 fire, half on a success"
              className={cn(ui.input, "min-w-40 flex-1")}
            />
            <button
              type="button"
              onClick={() => setTraits(traits.filter((_, at) => at !== index))}
              className={cn(ui.iconAction, rowIcon, "hover:text-red-300")}
              aria-label="Remove trait"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
      {traits.length < MAX_TRAITS ? (
        <div className={cn("reveal", chipRow)}>
          {TRAIT_SECTIONS.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setTraits([...traits, withSection("", section)])}
              className={cn(ui.btnSmall, addChip)}
            >
              <Plus className="size-3" /> {SECTION_LABELS[section]}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-stone-500">The block is full at {MAX_TRAITS} lines.</p>
      )}
    </div>
  );
}
