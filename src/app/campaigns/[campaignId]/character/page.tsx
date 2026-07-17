"use client";

import { Loader2, Swords } from "lucide-react";
import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import { cn } from "@/lib/cn";
import type { Ability, AbilityScores } from "@/lib/schemas/sheet";
import {
  SRD_BACKGROUNDS,
  SRD_CLASSES,
  SRD_RACES,
  SRD_SKILLS,
  abilityMod,
  computeSheetDerived,
  formatModifier,
  proficiencyBonus,
  spellSlotsFor,
  suggestedStartingHp,
} from "@/lib/srd";

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITY_LABELS: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};
const ALIGNMENTS = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"];

export default function CharacterCreatePage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = use(params);

  const [name, setName] = useState("");
  const [raceId, setRaceId] = useState(SRD_RACES[0].id);
  const [classId, setClassId] = useState(SRD_CLASSES[0].id);
  const [backgroundId, setBackgroundId] = useState(SRD_BACKGROUNDS[0].id);
  const [alignment, setAlignment] = useState("N");
  const [assignments, setAssignments] = useState<Record<Ability, number | null>>({
    str: null, dex: null, con: null, int: null, wis: null, cha: null,
  });
  const [chosenSkills, setChosenSkills] = useState<string[]>([]);
  const [level, setLevel] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // The campaign's starting level drives HP, hit dice, and spell slots.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data?.campaign?.startingLevel) {
          setLevel(data.campaign.startingLevel);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const race = SRD_RACES.find((entry) => entry.id === raceId)!;
  const klass = SRD_CLASSES.find((entry) => entry.id === classId)!;
  const background = SRD_BACKGROUNDS.find((entry) => entry.id === backgroundId)!;

  const usedValues = Object.values(assignments).filter((value) => value !== null);
  const complete = usedValues.length === 6 && name.trim().length > 0;

  // Final scores = assigned standard array + racial ASI.
  const abilities = useMemo<AbilityScores | null>(() => {
    if (Object.values(assignments).some((value) => value === null)) {
      return null;
    }
    const scores = { ...(assignments as Record<Ability, number>) };
    for (const [ability, bonus] of Object.entries(race.asi)) {
      scores[ability as Ability] += bonus ?? 0;
    }
    return scores as AbilityScores;
  }, [assignments, race]);

  const preview = useMemo(() => {
    if (!abilities) {
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
    const characterLevel = level ?? 1;
    const derived = computeSheetDerived({
      abilities,
      level: characterLevel,
      proficiencies,
      spellcasting: klass.spellAbility ? { ability: klass.spellAbility, slots: {}, prepared: [] } : null,
    });
    const maxHp = suggestedStartingHp(classId, raceId, abilities.con, characterLevel);
    // Unarmored AC baseline; players adjust for armor before saving.
    const ac = 10 + derived.abilityMods.dex;
    return { proficiencies, derived, maxHp, ac };
  }, [abilities, klass, background, race, chosenSkills, classId, raceId, level]);

  function assign(ability: Ability, value: number | null) {
    setAssignments((current) => {
      const next = { ...current };
      // Unassign this value anywhere else first (each array value used once).
      if (value !== null) {
        for (const key of Object.keys(next) as Ability[]) {
          if (next[key] === value) {
            next[key] = null;
          }
        }
      }
      next[ability] = value;
      return next;
    });
  }

  function toggleSkill(skillId: string) {
    setChosenSkills((current) =>
      current.includes(skillId)
        ? current.filter((entry) => entry !== skillId)
        : current.length < klass.skillChoices.count
          ? [...current, skillId]
          : current,
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!abilities || !preview) {
      setError("Assign all six ability scores first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const characterLevel = level ?? 1;
      const slots = Object.fromEntries(
        Object.entries(spellSlotsFor(classId, characterLevel)).map(([slotLevel, max]) => [
          slotLevel,
          { max, used: 0 },
        ]),
      );
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          race: raceId,
          class: classId,
          background: backgroundId,
          alignment,
          abilities,
          maxHp: preview.maxHp,
          ac: preview.ac,
          speed: race.speed,
          hitDice: { die: `d${klass.hitDie}`, total: characterLevel, spent: 0 },
          proficiencies: preview.proficiencies,
          equipment: [],
          gold: 15,
          feats: [],
          spellcasting: klass.spellAbility
            ? { ability: klass.spellAbility, slots, prepared: [] }
            : null,
          notes: "",
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not create the character.");
        return;
      }
      window.location.href = `/campaigns/${campaignId}`;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 outline-none focus:border-amber-600";

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <header className="mb-6">
        <a href={`/campaigns/${campaignId}`} className="text-sm text-stone-500 hover:text-stone-300">
          &larr; Back to the lobby
        </a>
        <div className="mt-2 flex items-center gap-3">
          <Swords className="size-7 text-amber-500" />
          <h1 className="font-serif text-2xl font-semibold">Create your character</h1>
        </div>
        <p className="mt-1 text-sm text-stone-400">
          SRD 5.1 rules. Ability scores use the standard array; derived stats are computed for you.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-6 text-sm">
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-stone-400">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={60} className={inputClass} />
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">Alignment</span>
            <select value={alignment} onChange={(event) => setAlignment(event.target.value)} className={inputClass}>
              {ALIGNMENTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">Race</span>
            <select value={raceId} onChange={(event) => setRaceId(event.target.value)} className={inputClass}>
              {SRD_RACES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-stone-500">{race.traits.join(" · ")}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">Class</span>
            <select
              value={classId}
              onChange={(event) => { setClassId(event.target.value); setChosenSkills([]); }}
              className={inputClass}
            >
              {SRD_CLASSES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              d{klass.hitDie} hit die · saves {klass.saves.map((save) => save.toUpperCase()).join(", ")}
              {klass.spellAbility ? ` · ${klass.spellAbility.toUpperCase()} caster` : ""}
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">Background</span>
            <select value={backgroundId} onChange={(event) => setBackgroundId(event.target.value)} className={inputClass}>
              {SRD_BACKGROUNDS.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-stone-500">
              Grants {background.skills.map((skillId) => SRD_SKILLS.find((skill) => skill.id === skillId)?.name).join(", ")}
            </span>
          </label>
        </section>

        <section>
          <h2 className="mb-2 font-medium">Ability scores (standard array)</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(Object.keys(ABILITY_LABELS) as Ability[]).map((ability) => {
              const asi = race.asi[ability] ?? 0;
              const assigned = assignments[ability];
              const finalScore = assigned !== null ? assigned + asi : null;
              return (
                <label key={ability} className="block rounded-lg border border-stone-800 bg-stone-950/60 p-3">
                  <span className="mb-1 flex items-baseline justify-between">
                    <span className="text-stone-300">{ABILITY_LABELS[ability]}</span>
                    {asi ? <span className="text-xs text-amber-500">+{asi} racial</span> : null}
                  </span>
                  <select
                    value={assigned ?? ""}
                    onChange={(event) => assign(ability, event.target.value ? Number(event.target.value) : null)}
                    className={inputClass}
                  >
                    <option value="">--</option>
                    {STANDARD_ARRAY.map((value) => (
                      <option
                        key={value}
                        value={value}
                        disabled={usedValues.includes(value) && assignments[ability] !== value}
                      >
                        {value}
                      </option>
                    ))}
                  </select>
                  {finalScore !== null ? (
                    <span className="mt-1 block text-xs text-stone-400">
                      Final {finalScore} ({formatModifier(abilityMod(finalScore))})
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-medium">
            Class skills (pick {klass.skillChoices.count})
          </h2>
          <div className="flex flex-wrap gap-2">
            {klass.skillChoices.from.map((skillId) => {
              const skill = SRD_SKILLS.find((entry) => entry.id === skillId)!;
              const fromBackground = background.skills.includes(skillId);
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
                  {skill.name}
                  {fromBackground ? " (background)" : ""}
                </button>
              );
            })}
          </div>
        </section>

        {preview ? (
          <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
            <h2 className="mb-2 font-medium">Derived stats</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-stone-300 sm:grid-cols-4">
              <span>HP {preview.maxHp}</span>
              <span>AC {preview.ac} (unarmored)</span>
              <span>Speed {race.speed} ft</span>
              <span>Prof {formatModifier(proficiencyBonus(level ?? 1))}</span>
              <span>Initiative {formatModifier(preview.derived.initiative)}</span>
              <span>Passive Perception {preview.derived.passivePerception}</span>
              {preview.derived.spellSaveDc ? <span>Spell DC {preview.derived.spellSaveDc}</span> : null}
              {preview.derived.spellAttack !== null ? (
                <span>Spell attack {formatModifier(preview.derived.spellAttack)}</span>
              ) : null}
            </div>
          </section>
        ) : null}

        {error ? <p className="text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={busy || !complete}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2.5 font-medium text-amber-50 hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Join the party
        </button>
      </form>
    </main>
  );
}
