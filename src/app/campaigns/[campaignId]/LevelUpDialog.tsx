"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Dices, Loader2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { abilityMod, findClass, findSkill, spellSlotsFor } from "@/lib/srd";
import { applyAsiChoices, crossedAsiLevels } from "@/lib/srd/asi";
import { expertiseSlotsFor, populateFeatures, srdSubclassName, subclassLevelFor } from "@/lib/srd/features";
import {
  FIGHTING_STYLES,
  chosenFightingStyles,
  fightingStyleFeatureName,
  fightingStyleSlots,
  type FightingStyleId,
} from "@/lib/srd/feature-effects";
import { spellClassFor } from "@/lib/classes";
import { suggestedSpellCount } from "@/lib/content/mechanics";
import AsiFeatEditor from "@/app/characters/builder/AsiFeatEditor";
import { useArchetypes } from "@/app/characters/builder/useBuilderOptions";
import type { AsiChoice, CharacterSheet } from "@/lib/schemas/sheet";

type SpellRow = { slug: string; name: string; level: number };

// Guided level-up: pick average or rolled HP, resolve any Ability Score
// Improvements, choose a subclass when the class reaches its subclass level,
// and pick newly learned spells from the class's actual spell list. New class
// features are granted automatically from the SRD tables. Everything is
// saved through a single sheet PATCH.
export function LevelUpDialog({
  campaignId,
  sheet,
  targetLevel,
  onDone,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  targetLevel: number;
  onDone: () => void;
}) {
  const [rolledHp, setRolledHp] = useState<number | null>(null);
  const [hpGain, setHpGain] = useState<number | null>(null);
  const [asiChoices, setAsiChoices] = useState<Array<AsiChoice | null>>([]);
  const [subclassChoice, setSubclassChoice] = useState("");
  const [expertisePicks, setExpertisePicks] = useState<string[]>([]);
  const [spellPicks, setSpellPicks] = useState<string[]>([]);
  const [stylePicks, setStylePicks] = useState<FightingStyleId[]>([]);
  const [spellQuery, setSpellQuery] = useState("");
  const [spellOptions, setSpellOptions] = useState<SpellRow[]>([]);
  const [packInstalled, setPackInstalled] = useState(true);
  const [manualSpell, setManualSpell] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const klass = findClass(sheet.class);
  const hitDie = klass?.hitDie ?? Number(sheet.hitDice.die.replace("d", "")) ?? 8;
  const conMod = abilityMod(sheet.abilities.con);
  const levelsGained = Math.max(1, targetLevel - sheet.level);
  const averageGain = Math.max(1, (Math.floor(hitDie / 2) + 1 + conMod) * levelsGained);
  const rolledGain =
    rolledHp !== null ? Math.max(1, rolledHp + conMod * levelsGained) : null;

  const asiLevels = useMemo(
    () => crossedAsiLevels(sheet.level, targetLevel),
    [sheet.level, targetLevel],
  );
  const asiResolved = asiLevels.every((_, index) => asiChoices[index]);

  // Expertise: rogue 1/6 and bard 3/10 double proficiency in two skills
  // each; the step appears when the new level grants unspent picks.
  const currentExpertise = sheet.proficiencies.expertise ?? [];
  const expertiseSlots = expertiseSlotsFor(sheet.class, targetLevel);
  const expertiseToPick = Math.max(0, expertiseSlots - currentExpertise.length);
  const expertiseOptions = sheet.proficiencies.skills.filter(
    (skill) => !currentExpertise.includes(skill),
  );
  const needsExpertise = expertiseToPick > 0 && expertiseOptions.length > 0;

  // Fighting styles: the class grants the slot, the player picks which one,
  // and the pick is stored as a "choice"-sourced feature the regrant keeps.
  // Independent of the subclass, so it can be resolved before one is chosen.
  const styleSlots = fightingStyleSlots(
    populateFeatures(sheet.features, sheet.class, sheet.subclass, sheet.race, targetLevel),
  );
  const currentStyles = chosenFightingStyles(sheet.features);
  const stylesToPick = Math.max(0, styleSlots - currentStyles.length);
  const needsStyle = stylesToPick > 0;
  const styleOptions = FIGHTING_STYLES.filter(
    (style) => !currentStyles.some((name) => name.toLowerCase() === style.name.toLowerCase()),
  );

  const subclassLevel = subclassLevelFor(sheet.class);
  const needsSubclass =
    subclassLevel !== null &&
    !sheet.subclass.trim() &&
    sheet.level < subclassLevel &&
    subclassLevel <= targetLevel;
  const srdSubclass = srdSubclassName(sheet.class);
  const archetypes = useArchetypes(needsSubclass ? sheet.class : "");
  const subclassOptions = useMemo(() => {
    const names = srdSubclass ? [srdSubclass] : [];
    for (const archetype of archetypes) {
      if (!names.some((name) => name.toLowerCase() === archetype.name.toLowerCase())) {
        names.push(archetype.name);
      }
    }
    return names;
  }, [srdSubclass, archetypes]);

  const steps = useMemo(
    () => [
      "hp",
      ...(asiLevels.length ? ["asi"] : []),
      ...(needsExpertise ? ["expertise"] : []),
      ...(needsStyle ? ["style"] : []),
      ...(needsSubclass ? ["subclass"] : []),
      ...(sheet.spellcasting ? ["spells"] : []),
    ],
    [asiLevels.length, needsExpertise, needsStyle, needsSubclass, sheet.spellcasting],
  );
  const step = steps[stepIndex];
  const lastStep = stepIndex === steps.length - 1;

  const effectiveSubclass = subclassChoice || sheet.subclass;
  const newFeatureNames = useMemo(() => {
    const current = new Set(sheet.features.map((feature) => feature.name.toLowerCase()));
    return populateFeatures(sheet.features, sheet.class, effectiveSubclass, sheet.race, targetLevel)
      .filter((feature) => !current.has(feature.name.toLowerCase()))
      .map((feature) => feature.name);
  }, [sheet.features, sheet.class, effectiveSubclass, sheet.race, targetLevel]);

  // The class's real spell list at the levels this character can now cast,
  // so nobody has to know 5e spell lists by heart.
  const maxCastable = useMemo(() => {
    const slotLevels = Object.keys(spellSlotsFor(sheet.class, targetLevel)).map(Number);
    return slotLevels.length ? Math.max(...slotLevels) : null;
  }, [sheet.class, targetLevel]);

  useEffect(() => {
    if (step !== "spells") {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ q: spellQuery, limit: "60" });
    // Catalog casters borrow an SRD class's spell list.
    params.set("class", spellClassFor(sheet.class));
    if (maxCastable !== null) {
      params.set("level", String(maxCastable));
    }
    fetch(`/api/content/spells?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          return;
        }
        setPackInstalled(Boolean(data.packInstalled));
        setSpellOptions(
          ((data.results ?? []) as Array<{ slug: string; name: string; level: number }>).map(
            (row) => ({ slug: row.slug, name: row.name, level: row.level }),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [step, spellQuery, sheet.class, maxCastable]);

  const knownList = useMemo(
    () =>
      sheet.spellcasting
        ? sheet.spellcasting.known.length
          ? sheet.spellcasting.known
          : sheet.spellcasting.prepared
        : [],
    [sheet.spellcasting],
  );
  const alreadyKnown = useMemo(
    () => new Set(knownList.map((name) => name.toLowerCase())),
    [knownList],
  );
  const allowance = sheet.spellcasting
    ? suggestedSpellCount(
        spellClassFor(sheet.class),
        targetLevel,
        abilityMod(sheet.abilities[sheet.spellcasting.ability]),
      )
    : null;
  const remainingPicks = allowance ? Math.max(0, allowance.count - knownList.length) : null;

  function rollHp() {
    let total = 0;
    for (let i = 0; i < levelsGained; i += 1) {
      total += 1 + Math.floor(Math.random() * hitDie);
    }
    setRolledHp(total);
  }

  function pickHp(gain: number) {
    setHpGain(gain);
    if (steps.length > 1) {
      setStepIndex(1);
    } else {
      apply(gain);
    }
  }

  function toggleSpell(name: string) {
    setSpellPicks((current) =>
      current.includes(name) ? current.filter((pick) => pick !== name) : [...current, name],
    );
  }

  async function apply(gain: number) {
    setBusy(true);
    setError("");
    try {
      const choices = asiChoices.filter((choice): choice is AsiChoice => choice !== null);
      const slots = spellSlotsFor(sheet.class, targetLevel);
      const newFeats = choices.flatMap((choice) =>
        choice.mode === "feat" ? [choice.feat] : [],
      );
      const features = [
        ...populateFeatures(
          sheet.features,
          sheet.class,
          effectiveSubclass,
          sheet.race,
          targetLevel,
        ),
        ...stylePicks.map((id) => ({
          name: fightingStyleFeatureName(id),
          source: "choice" as const,
        })),
      ];
      let spellcastingPatch: CharacterSheet["spellcasting"] = null;
      if (sheet.spellcasting) {
        const nextSlots = Object.keys(slots).length
          ? Object.fromEntries(
              Object.entries(slots).map(([slotLevel, max]) => [
                slotLevel,
                {
                  max,
                  used: Math.min(sheet.spellcasting?.slots[slotLevel]?.used ?? 0, max),
                },
              ]),
            )
          : sheet.spellcasting.slots;
        const additions = spellPicks.filter((name) => !alreadyKnown.has(name.toLowerCase()));
        const intoKnown = sheet.spellcasting.known.length > 0;
        spellcastingPatch = {
          ...sheet.spellcasting,
          slots: nextSlots,
          known: intoKnown
            ? [...sheet.spellcasting.known, ...additions]
            : sheet.spellcasting.known,
          prepared: intoKnown
            ? sheet.spellcasting.prepared
            : [...sheet.spellcasting.prepared, ...additions],
        };
      }
      const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: targetLevel,
          maxHp: sheet.maxHp + gain,
          currentHp: Math.min(sheet.currentHp + gain, sheet.maxHp + gain),
          hitDice: { ...sheet.hitDice, total: targetLevel },
          features,
          ...(choices.length
            ? { abilities: applyAsiChoices(sheet.abilities, choices) }
            : {}),
          ...(newFeats.length
            ? { feats: [...new Set([...sheet.feats, ...newFeats])] }
            : {}),
          ...(expertisePicks.length
            ? { expertise: [...currentExpertise, ...expertisePicks] }
            : {}),
          ...(needsSubclass && subclassChoice ? { subclass: subclassChoice } : {}),
          ...(spellcastingPatch ? { spellcasting: spellcastingPatch } : {}),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Could not level up.");
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const stepReady =
    step === "asi"
      ? asiResolved
      : step === "expertise"
        ? expertisePicks.length === Math.min(expertiseToPick, expertiseOptions.length)
        : step === "style"
        ? stylePicks.length === Math.min(stylesToPick, styleOptions.length)
        : step === "subclass"
          ? Boolean(subclassChoice) || subclassOptions.length === 0
          : true;

  function nextOrApply() {
    if (lastStep) {
      apply(hpGain ?? averageGain);
    } else {
      setStepIndex(stepIndex + 1);
    }
  }

  const wideStep = step !== "hp";

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onDone()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 panel ornate rounded-xl border-amber-500/40 p-6",
            wideStep
              ? "max-h-[85vh] w-[min(92vw,32rem)] overflow-y-auto"
              : "w-[min(92vw,26rem)]",
          )}
        >
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 font-display text-lg tracking-wide text-amber-100">
              <Sparkles className="size-5 text-amber-200" />
              Level {targetLevel}!
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-stone-400 hover:bg-stone-900">
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {step === "hp" ? (
            <>
              <p className="mb-3 text-sm text-stone-300">
                {sheet.name} advances to level {targetLevel}. Choose how to gain hit points
                ({levelsGained} d{hitDie}
                {conMod ? ` ${conMod > 0 ? "+" : ""}${conMod} CON each` : ""}):
              </p>
              {newFeatureNames.length ? (
                <p className="mb-4 rounded-md border border-amber-900/50 bg-stone-950/60 px-3 py-2 text-xs text-amber-200">
                  New at level {targetLevel}: {newFeatureNames.join(", ")}
                </p>
              ) : null}

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => pickHp(averageGain)}
                  className="flex w-full items-center justify-between rounded-md border border-stone-700 px-4 py-2.5 text-sm hover:border-amber-700 hover:bg-stone-900 disabled:opacity-50"
                >
                  <span>Take the average</span>
                  <span className="font-mono text-amber-400">+{averageGain} HP</span>
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={rollHp}
                    className="flex flex-1 items-center justify-center gap-2 rounded-md border border-stone-700 px-4 py-2.5 text-sm hover:border-amber-700 hover:bg-stone-900 disabled:opacity-50"
                  >
                    <Dices className="size-4" />
                    {rolledHp === null ? `Roll ${levelsGained}d${hitDie}` : `Rolled ${rolledHp}`}
                  </button>
                  {rolledGain !== null ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => pickHp(rolledGain)}
                      className={cn(
                        "rounded-lg bg-amber-200 px-4 py-2.5 text-sm font-medium text-stone-950",
                        "hover:bg-amber-100 disabled:opacity-50",
                      )}
                    >
                      {busy ? <Loader2 className="size-4 animate-spin" /> : `Take +${rolledGain} HP`}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 text-sm">
              {step === "asi" ? (
                <>
                  <p className="text-stone-300">
                    +{hpGain} HP locked in. This level also grants
                    {asiLevels.length === 1 ? " an ability score improvement" : " ability score improvements"}:
                  </p>
                  <AsiFeatEditor
                    slotLevels={asiLevels}
                    baseScores={sheet.abilities}
                    choices={asiLevels.map((_, index) => asiChoices[index] ?? null)}
                    onChange={setAsiChoices}
                  />
                </>
              ) : null}

              {step === "expertise" ? (
                <>
                  <p className="text-stone-300">
                    Expertise: pick {Math.min(expertiseToPick, expertiseOptions.length)} of{" "}
                    {sheet.name}&apos;s proficient skills to DOUBLE their proficiency bonus in:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {expertiseOptions.map((skillId) => {
                      const picked = expertisePicks.includes(skillId);
                      return (
                        <button
                          key={skillId}
                          type="button"
                          onClick={() =>
                            setExpertisePicks((current) =>
                              picked
                                ? current.filter((entry) => entry !== skillId)
                                : current.length < expertiseToPick
                                  ? [...current, skillId]
                                  : current,
                            )
                          }
                          className={cn(
                            "rounded-full border px-3 py-1 text-sm",
                            picked
                              ? "border-amber-600 bg-stone-900 text-amber-100"
                              : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                          )}
                        >
                          {findSkill(skillId)?.name ?? skillId}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {step === "style" ? (
                <>
                  <p className="text-stone-300">
                    Fighting Style: pick {stylesToPick} for {sheet.name}. The server applies it
                    to every attack from here on.
                  </p>
                  <div className="space-y-1.5">
                    {styleOptions.map((style) => {
                      const picked = stylePicks.includes(style.id);
                      return (
                        <button
                          key={style.id}
                          type="button"
                          onClick={() =>
                            setStylePicks((current) =>
                              picked
                                ? current.filter((entry) => entry !== style.id)
                                : current.length < stylesToPick
                                  ? [...current, style.id]
                                  : current,
                            )
                          }
                          className={cn(
                            "block w-full rounded-lg border px-3 py-2 text-left",
                            picked
                              ? "border-amber-600 bg-stone-900 text-amber-100"
                              : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                          )}
                        >
                          <span className="block text-sm">{style.name}</span>
                          <span className="block text-xs text-stone-400">{style.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {step === "subclass" ? (
                <>
                  <p className="text-stone-300">
                    At level {subclassLevel}, every {klass?.name ?? sheet.class} chooses a
                    specialization. Pick one for {sheet.name}:
                  </p>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {subclassOptions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setSubclassChoice(name)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md border px-4 py-2 text-left text-sm",
                          subclassChoice === name
                            ? "border-amber-600 bg-stone-900 text-amber-100"
                            : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                        )}
                      >
                        <span>{name}</span>
                        {srdSubclass && name === srdSubclass ? (
                          <span className="text-xs text-stone-500">SRD</span>
                        ) : null}
                      </button>
                    ))}
                    {!subclassOptions.length ? (
                      <p className="text-xs text-stone-500">
                        No known specializations for this class; the party lead can set one on
                        the sheet later.
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === "spells" ? (
                <>
                  <p className="text-stone-300">
                    New spells for {sheet.name}
                    {remainingPicks !== null && allowance ? (
                      <>
                        {" "}
                        (up to{" "}
                        <span className="text-amber-200">
                          {remainingPicks} new {allowance.label}
                        </span>{" "}
                        at level {targetLevel})
                      </>
                    ) : null}
                    :
                  </p>
                  {packInstalled ? (
                    <>
                      <label className="flex items-center gap-2 rounded-md border border-stone-700 px-3 py-2">
                        <Search className="size-4 text-stone-500" />
                        <input
                          value={spellQuery}
                          onChange={(event) => setSpellQuery(event.target.value)}
                          placeholder="Search your class's spell list"
                          className="w-full bg-transparent text-sm outline-none placeholder:text-stone-600"
                        />
                      </label>
                      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                        {spellOptions
                          .filter((spell) => !alreadyKnown.has(spell.name.toLowerCase()))
                          .map((spell) => (
                            <label
                              key={spell.slug}
                              className="flex cursor-pointer items-center gap-2 rounded-md border border-stone-800 px-3 py-1.5 text-sm hover:border-stone-600"
                            >
                              <input
                                type="checkbox"
                                checked={spellPicks.includes(spell.name)}
                                disabled={
                                  !spellPicks.includes(spell.name) &&
                                  remainingPicks !== null &&
                                  spellPicks.length >= remainingPicks
                                }
                                onChange={() => toggleSpell(spell.name)}
                                className="accent-amber-400"
                              />
                              <span className="flex-1">{spell.name}</span>
                              <span className="text-xs text-stone-500">
                                {spell.level === 0 ? "cantrip" : `level ${spell.level}`}
                              </span>
                            </label>
                          ))}
                        {!spellOptions.length ? (
                          <p className="px-1 py-2 text-xs text-stone-500">No matching spells.</p>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        value={manualSpell}
                        onChange={(event) => setManualSpell(event.target.value)}
                        placeholder="Spell name"
                        className="w-full rounded-md border border-stone-700 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-stone-600"
                      />
                      <button
                        type="button"
                        disabled={!manualSpell.trim()}
                        onClick={() => {
                          toggleSpell(manualSpell.trim());
                          setManualSpell("");
                        }}
                        className="rounded-md border border-stone-700 px-3 py-2 text-sm hover:bg-stone-900 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  )}
                  {spellPicks.length ? (
                    <p className="text-xs text-stone-400">
                      Learning: <span className="text-amber-200">{spellPicks.join(", ")}</span>
                      {remainingPicks !== null && spellPicks.length >= remainingPicks ? (
                        <span className="text-stone-500">
                          {" "}
                          (that is the full allowance at this level)
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </>
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStepIndex(Math.max(0, stepIndex - 1))}
                  className="rounded-md border border-stone-700 px-4 py-2.5 text-sm text-stone-300 hover:bg-stone-900 disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={busy || !stepReady}
                  onClick={nextOrApply}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-200 px-4 py-2.5 text-sm font-medium text-stone-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : lastStep ? (
                    "Confirm level up"
                  ) : (
                    "Next"
                  )}
                </button>
              </div>
            </div>
          )}
          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
