"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Dices, Loader2, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { InfoButton, InfoChipList } from "@/components/ui/InfoDialog";
import { describeFeature } from "@/lib/help";
import {
  openOptionSlots,
  optionFeatureName,
  type OptionSlot,
} from "@/lib/srd/options";
import { ALL_CLASSES, SRD_SKILLS, abilityMod, findClass, findSkill, spellSlotsFor } from "@/lib/srd";
import { applyAsiChoices, crossedAsiLevels } from "@/lib/srd/asi";
import {
  MULTICLASS_CAP,
  canMulticlassInto,
  classListFor,
  describeGrant,
  describePrereq,
  multiclassGrantsFor,
} from "@/lib/srd/multiclass";
import {
  expertiseSlotsFor,
  populateFeaturesForClasses,
  subclassLevelFor,
  subclassNamesFor,
  subclassSpellsFor,
} from "@/lib/srd/features";
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
  multiclassAllowed = true,
  onDone,
}: {
  campaignId: string;
  sheet: CharacterSheet;
  targetLevel: number;
  // Campaign setting: offers the class step's new-class options only when
  // the table allows multiclassing (already-split sheets keep theirs).
  multiclassAllowed?: boolean;
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

  // Which class takes the level: an existing one advances, or an eligible
  // new class starts at 1 (multiclassing). Defaults to the primary class so
  // single-class characters keep their one-click flow.
  const classList = useMemo(() => classListFor(sheet), [sheet]);
  const [classChoice, setClassChoice] = useState(classList[0].id);
  const [skillPick, setSkillPick] = useState("");

  const levelsGained = Math.max(1, targetLevel - sheet.level);
  const chosenEntry = classList.find(
    (entry) => entry.id.toLowerCase() === classChoice.toLowerCase(),
  );
  const chosenKlass = findClass(classChoice);
  const isNewClass = !chosenEntry;
  const classLevelAfter = (chosenEntry?.level ?? 0) + levelsGained;
  // Anything beyond leveling a lone class in place goes through the
  // server's multiclass path (levelUpClass + server-built class array).
  const isMulticlassPath = (sheet.classes?.length ?? 0) > 0 || isNewClass;
  const nextClasses = useMemo(() => {
    const next = classList.map((entry) => ({ ...entry }));
    const mine = next.find((entry) => entry.id.toLowerCase() === classChoice.toLowerCase());
    if (mine) {
      mine.level += levelsGained;
    } else {
      next.push({ id: classChoice, subclass: "", level: levelsGained });
    }
    return next;
  }, [classList, classChoice, levelsGained]);

  // Eligible-first list of classes the character could multiclass into.
  const newClassOptions = useMemo(() => {
    if (!multiclassAllowed || classList.length >= MULTICLASS_CAP) {
      return [];
    }
    return ALL_CLASSES.filter(
      (candidate) => !classList.some((entry) => entry.id.toLowerCase() === candidate.id),
    )
      .map((candidate) => ({ option: candidate, check: canMulticlassInto(sheet, candidate.id) }))
      .sort((a, b) => Number(b.check.ok) - Number(a.check.ok));
  }, [classList, sheet, multiclassAllowed]);
  const needsClassStep = classList.length > 1 || newClassOptions.some((entry) => entry.check.ok);

  // Some multiclass grants include one class-skill pick (rogue, ranger,
  // bard); offered right in the class step and validated server-side.
  const chosenGrant = isNewClass ? multiclassGrantsFor(classChoice) : null;
  const skillOptions = chosenGrant?.skillChoice
    ? (chosenGrant.skillChoice.from.length
        ? chosenGrant.skillChoice.from
        : SRD_SKILLS.map((skill) => skill.id)
      ).filter((id) => !sheet.proficiencies.skills.includes(id))
    : [];
  const needsSkillPick = skillOptions.length > 0;

  function resetClassPicks() {
    setSubclassChoice("");
    setExpertisePicks([]);
    setSpellPicks([]);
    setStylePicks([]);
    setOptionPicks([]);
    setSkillPick("");
    setRolledHp(null);
  }

  const klass = chosenKlass ?? findClass(sheet.class);
  const hitDie = chosenKlass?.hitDie ?? Number(sheet.hitDice.die.replace("d", "")) ?? 8;
  const conMod = abilityMod(sheet.abilities.con);
  const averageGain = Math.max(1, (Math.floor(hitDie / 2) + 1 + conMod) * levelsGained);
  const rolledGain =
    rolledHp !== null ? Math.max(1, rolledHp + conMod * levelsGained) : null;

  const asiLevels = useMemo(
    () => crossedAsiLevels(sheet.level, targetLevel),
    [sheet.level, targetLevel],
  );
  const asiResolved = asiLevels.every((_, index) => asiChoices[index]);

  // Expertise: rogue 1/6 and bard 3/10 double proficiency in two skills
  // each; the step appears when the new level grants unspent picks. Scales
  // by the chosen class's own level, so a rogue dip never grants bard picks.
  const currentExpertise = sheet.proficiencies.expertise ?? [];
  const expertiseSlots = expertiseSlotsFor(classChoice, classLevelAfter);
  const expertiseToPick = Math.max(0, expertiseSlots - currentExpertise.length);
  const expertiseOptions = sheet.proficiencies.skills.filter(
    (skill) => !currentExpertise.includes(skill),
  );
  const needsExpertise = expertiseToPick > 0 && expertiseOptions.length > 0;

  // Fighting styles: the class grants the slot, the player picks which one,
  // and the pick is stored as a "choice"-sourced feature the regrant keeps.
  // Independent of the subclass, so it can be resolved before one is chosen.
  const styleSlots = fightingStyleSlots(
    populateFeaturesForClasses(sheet.features, nextClasses, sheet.race),
  );
  const currentStyles = chosenFightingStyles(sheet.features);
  const stylesToPick = Math.max(0, styleSlots - currentStyles.length);
  const needsStyle = stylesToPick > 0;
  const styleOptions = FIGHTING_STYLES.filter(
    (style) => !currentStyles.some((name) => name.toLowerCase() === style.name.toLowerCase()),
  );

  // Pick-lists that gained slots at this level: invocations, maneuvers,
  // metamagic, pact boons, infusions, runes, disciplines. Uses the subclass
  // being chosen this level-up if there is one, so a fighter who picks Battle
  // Master here is offered maneuvers in the same flow.
  const [optionPicks, setOptionPicks] = useState<string[]>([]);
  const subclassLevel = subclassLevelFor(classChoice);
  const entrySubclass = chosenEntry?.subclass ?? "";
  const needsSubclass =
    subclassLevel !== null &&
    !entrySubclass.trim() &&
    (chosenEntry?.level ?? 0) < subclassLevel &&
    subclassLevel <= classLevelAfter;
  const builtInSubclasses = subclassNamesFor(classChoice);
  const archetypes = useArchetypes(needsSubclass ? classChoice : "");
  // The subclasses with real feature tables come first; content-pack
  // archetypes are prose only and fill in behind them.
  const subclassOptions = useMemo(() => {
    const names = [...builtInSubclasses];
    for (const archetype of archetypes) {
      if (!names.some((name) => name.toLowerCase() === archetype.name.toLowerCase())) {
        names.push(archetype.name);
      }
    }
    return names;
    // builtInSubclasses is rebuilt each render from a constant table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builtInSubclasses.join("|"), archetypes]);

  const openSlots = useMemo(
    () =>
      openOptionSlots({
        classId: classChoice,
        subclass: subclassChoice || entrySubclass,
        level: classLevelAfter,
        features: [...sheet.features, ...optionPicks.map((name) => ({ name }))],
      }),
    [classChoice, entrySubclass, sheet.features, subclassChoice, classLevelAfter, optionPicks],
  );
  const needsOptions = openSlots.some((slot) => slot.remaining > 0);

  function toggleOption(slot: OptionSlot, name: string) {
    const featureName = optionFeatureName(slot.kind, name);
    setOptionPicks((current) => {
      if (current.includes(featureName)) {
        return current.filter((entry) => entry !== featureName);
      }
      return slot.remaining > 0 ? [...current, featureName] : current;
    });
  }

  // Spellcasting for the CHOSEN class: on the multiclass path each caster
  // class keeps its own list, so the picker reads (and the server writes)
  // that class's entry rather than the legacy shared fields.
  const casterEntry = sheet.spellcasting?.casters?.find(
    (caster) => caster.classId.toLowerCase() === classChoice.toLowerCase(),
  );
  const showSpells = isMulticlassPath
    ? Boolean(chosenKlass && chosenKlass.casterType !== "none" && chosenKlass.spellAbility)
    : Boolean(sheet.spellcasting);

  const steps = useMemo(
    () => [
      ...(needsClassStep ? ["class"] : []),
      "hp",
      ...(asiLevels.length ? ["asi"] : []),
      ...(needsExpertise ? ["expertise"] : []),
      ...(needsStyle ? ["style"] : []),
      ...(needsSubclass ? ["subclass"] : []),
      ...(needsOptions ? ["options"] : []),
      ...(showSpells ? ["spells"] : []),
    ],
    [needsClassStep, asiLevels.length, needsExpertise, needsStyle, needsSubclass, needsOptions, showSpells],
  );
  const step = steps[stepIndex];
  const lastStep = stepIndex === steps.length - 1;

  const effectiveSubclass = subclassChoice || entrySubclass;
  const newFeatureNames = useMemo(() => {
    const current = new Set(sheet.features.map((feature) => feature.name.toLowerCase()));
    const withSubclass = nextClasses.map((entry) =>
      entry.id.toLowerCase() === classChoice.toLowerCase()
        ? { ...entry, subclass: subclassChoice || entry.subclass }
        : entry,
    );
    return populateFeaturesForClasses(sheet.features, withSubclass, sheet.race)
      .filter((feature) => !current.has(feature.name.toLowerCase()))
      .map((feature) => feature.name);
  }, [sheet.features, nextClasses, classChoice, subclassChoice, sheet.race]);

  // The class's real spell list at the levels this character can now cast,
  // so nobody has to know 5e spell lists by heart. Multiclass, per RAW: the
  // learnable levels come from the class's OWN table at its class level.
  const maxCastable = useMemo(() => {
    const slotLevels = Object.keys(spellSlotsFor(classChoice, classLevelAfter)).map(Number);
    return slotLevels.length ? Math.max(...slotLevels) : null;
  }, [classChoice, classLevelAfter]);

  useEffect(() => {
    if (step !== "spells") {
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ q: spellQuery, limit: "60" });
    // Catalog casters borrow an SRD class's spell list.
    params.set("class", spellClassFor(classChoice));
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
  }, [step, spellQuery, classChoice, maxCastable]);

  const knownList = useMemo(() => {
    if (isMulticlassPath) {
      // The chosen class's own list; a caster class being started fresh
      // knows nothing yet. Lead-built multiclass sheets without a casters
      // array fall back to the legacy fields when leveling their first
      // caster class.
      const entry =
        casterEntry ??
        (sheet.spellcasting && !sheet.spellcasting.casters?.length && !isNewClass
          ? sheet.spellcasting
          : null);
      return entry ? (entry.known.length ? entry.known : entry.prepared) : [];
    }
    return sheet.spellcasting
      ? sheet.spellcasting.known.length
        ? sheet.spellcasting.known
        : sheet.spellcasting.prepared
      : [];
  }, [sheet.spellcasting, isMulticlassPath, casterEntry, isNewClass]);
  const alreadyKnown = useMemo(
    () => new Set(knownList.map((name) => name.toLowerCase())),
    [knownList],
  );
  const allowanceAbility = isMulticlassPath
    ? (casterEntry?.ability ?? chosenKlass?.spellAbility ?? null)
    : (sheet.spellcasting?.ability ?? null);
  const allowance =
    showSpells && allowanceAbility
      ? suggestedSpellCount(
          spellClassFor(classChoice),
          classLevelAfter,
          abilityMod(sheet.abilities[allowanceAbility]),
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
    if (stepIndex < steps.length - 1) {
      setStepIndex(stepIndex + 1);
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
      const newFeats = choices.flatMap((choice) =>
        choice.mode === "feat" ? [choice.feat] : [],
      );

      // Multiclass path: name the class taking the level and send only the
      // player's picks; the server builds the class array, hit-die pools,
      // proficiency grants, and per-class spellcasting itself.
      if (isMulticlassPath) {
        const response = await fetch(`/api/campaigns/${campaignId}/sheet`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            level: targetLevel,
            maxHp: sheet.maxHp + gain,
            currentHp: Math.min(sheet.currentHp + gain, sheet.maxHp + gain),
            levelUpClass: classChoice,
            ...(skillPick ? { levelUpSkill: skillPick } : {}),
            ...(spellPicks.length ? { levelUpSpells: spellPicks } : {}),
            features: [
              ...sheet.features,
              ...stylePicks.map((id) => ({
                name: fightingStyleFeatureName(id),
                source: "choice" as const,
              })),
              ...optionPicks.map((name) => ({ name, source: "choice" as const })),
            ],
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
          }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || "Could not level up.");
          return;
        }
        onDone();
        return;
      }

      const slots = spellSlotsFor(sheet.class, targetLevel);
      const features = [
        ...populateFeaturesForClasses(
          sheet.features,
          [{ id: sheet.class, subclass: effectiveSubclass, level: targetLevel }],
          sheet.race,
        ),
        ...stylePicks.map((id) => ({
          name: fightingStyleFeatureName(id),
          source: "choice" as const,
        })),
        ...optionPicks.map((name) => ({ name, source: "choice" as const })),
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
        // Subclass spells (domain, circle, oath, patron) arrive on their own
        // at the levels the table names, on top of the player's picks.
        const granted = subclassSpellsFor(sheet.class, effectiveSubclass, targetLevel);
        const additions = [...spellPicks, ...granted].filter(
          (name) => !alreadyKnown.has(name.toLowerCase()),
        );
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
    step === "class"
      ? Boolean(classChoice) && (!needsSkillPick || Boolean(skillPick))
      : step === "asi"
      ? asiResolved
      : step === "expertise"
        ? expertisePicks.length === Math.min(expertiseToPick, expertiseOptions.length)
        : step === "style"
        ? stylePicks.length === Math.min(stylesToPick, styleOptions.length)
        : step === "subclass"
          ? Boolean(subclassChoice) || subclassOptions.length === 0
          : step === "options"
            ? openSlots.every((slot) => slot.remaining === 0)
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
                {sheet.name} advances to level {targetLevel}
                {isMulticlassPath
                  ? ` as a ${chosenKlass?.name ?? classChoice} (${chosenKlass?.name ?? classChoice} level ${classLevelAfter})`
                  : ""}
                . Choose how to gain hit points ({levelsGained} d{hitDie}
                {conMod ? ` ${conMod > 0 ? "+" : ""}${conMod} CON each` : ""}):
              </p>
              {newFeatureNames.length ? (
                <div className="mb-4 rounded-md border border-amber-900/50 bg-stone-950/60 px-3 py-2">
                  <p className="mb-1 text-xs text-amber-200">New at level {targetLevel}:</p>
                  <InfoChipList
                    items={newFeatureNames.map((name) => ({
                      name,
                      text: describeFeature(classChoice, effectiveSubclass, name),
                    }))}
                  />
                </div>
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
              {step === "class" ? (
                <>
                  <p className="text-stone-300">
                    Which class takes level {targetLevel}? Advance one {sheet.name} already has,
                    or multiclass into a new one.
                  </p>
                  <div className="space-y-1.5">
                    {classList.map((entry) => {
                      const held = findClass(entry.id);
                      const picked = classChoice.toLowerCase() === entry.id.toLowerCase();
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => {
                            if (!picked) {
                              setClassChoice(entry.id);
                              resetClassPicks();
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm",
                            picked
                              ? "border-amber-600 bg-stone-900 text-amber-100"
                              : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                          )}
                        >
                          <span>
                            {held?.name ?? entry.id}
                            {entry.subclass ? (
                              <span className="text-xs text-stone-500"> · {entry.subclass}</span>
                            ) : null}
                          </span>
                          <span className="font-mono text-xs text-amber-400">
                            {entry.level} → {entry.level + levelsGained}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {newClassOptions.length ? (
                    <>
                      <p className="text-xs uppercase tracking-wide text-amber-200/80">
                        Multiclass into a new class
                      </p>
                      <p className="text-xs text-stone-500">
                        A new class starts at level 1 with SOME of its training: no saving
                        throws, and only the proficiencies the multiclass rules grant.
                      </p>
                      <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                        {newClassOptions.map(({ option, check }) => {
                          const picked = classChoice.toLowerCase() === option.id.toLowerCase();
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={!check.ok}
                              onClick={() => {
                                if (!picked) {
                                  setClassChoice(option.id);
                                  resetClassPicks();
                                }
                              }}
                              className={cn(
                                "block w-full rounded-lg border px-3 py-2 text-left",
                                picked
                                  ? "border-amber-600 bg-stone-900 text-amber-100"
                                  : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                                !check.ok && "cursor-not-allowed opacity-50 hover:border-stone-700 hover:bg-transparent",
                              )}
                            >
                              <span className="flex items-center justify-between text-sm">
                                <span>{option.name}</span>
                                <span className="text-xs text-stone-500">d{option.hitDie}</span>
                              </span>
                              <span className="block text-xs text-stone-400">
                                {check.ok
                                  ? `Grants: ${describeGrant(multiclassGrantsFor(option.id))}`
                                  : check.error}
                              </span>
                              <span className="block text-[11px] text-stone-600">
                                Requires {describePrereq(option.id)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                  {needsSkillPick ? (
                    <>
                      <p className="text-stone-300">
                        {chosenKlass?.name ?? classChoice} grants one new skill. Pick it:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {skillOptions.map((skillId) => {
                          const picked = skillPick === skillId;
                          return (
                            <button
                              key={skillId}
                              type="button"
                              onClick={() => setSkillPick(picked ? "" : skillId)}
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
                </>
              ) : null}

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

              {step === "options" ? (
                <>
                  <p className="text-stone-300">
                    New abilities for {sheet.name} to choose. These are real powers, not flavour,
                    so read them before picking.
                  </p>
                  {openSlots
                    .filter((slot) => slot.remaining > 0 || slot.chosen.length > 0)
                    .map((slot) => (
                      <div key={slot.kind}>
                        <p className="mb-1 mt-2 text-xs uppercase tracking-wide text-amber-200/80">
                          {slot.label}: {slot.chosen.length}/{slot.total} chosen
                        </p>
                        <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                          {slot.options.map((option) => {
                            const picked = slot.chosen.some(
                              (name) => name.toLowerCase() === option.n.toLowerCase(),
                            );
                            const already =
                              picked &&
                              !optionPicks.includes(optionFeatureName(slot.kind, option.n));
                            return (
                              <div
                                key={option.n}
                                className={cn(
                                  "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                                  picked
                                    ? "border-amber-600 bg-stone-900 text-amber-100"
                                    : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                                  already && "opacity-60",
                                )}
                              >
                                <button
                                  type="button"
                                  disabled={already}
                                  onClick={() => toggleOption(slot, option.n)}
                                  className="grow text-left"
                                >
                                  <span className="block">{option.n}</span>
                                  <span className="block text-[11px] text-stone-500">
                                    {already ? "Already known. " : ""}
                                    {option.req ? `Requires ${option.req}. ` : ""}
                                    {option.d}
                                  </span>
                                </button>
                                <InfoButton
                                  label={option.n}
                                  meta={option.req ? `Requires ${option.req}` : undefined}
                                  text={option.d}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
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
                  <p className="text-xs text-stone-500">
                    This choice shapes how {sheet.name} plays for the rest of the campaign. Read
                    each one before deciding.
                  </p>
                  <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {subclassOptions.map((name) => {
                      const archetype = archetypes.find(
                        (entry) => entry.name.toLowerCase() === name.toLowerCase(),
                      );
                      return (
                        <div
                          key={name}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-2 text-sm",
                            subclassChoice === name
                              ? "border-amber-600 bg-stone-900 text-amber-100"
                              : "border-stone-700 hover:border-amber-800 hover:bg-stone-900",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => setSubclassChoice(name)}
                            className="flex grow items-center justify-between gap-2 py-2 text-left"
                          >
                            <span>{name}</span>
                            {builtInSubclasses.some(
                              (entry) => entry.toLowerCase() === name.toLowerCase(),
                            ) ? (
                              <span className="text-xs text-stone-500">full features</span>
                            ) : (
                              <span className="text-xs text-stone-600">description only</span>
                            )}
                          </button>
                          <InfoButton
                            label={name}
                            text={archetype?.desc}
                            reference={
                              archetype ? { kind: "archetypes", slug: archetype.id, name } : undefined
                            }
                          />
                        </div>
                      );
                    })}
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
