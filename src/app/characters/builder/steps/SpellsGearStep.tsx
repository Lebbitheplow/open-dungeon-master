"use client";

import { Star } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { SpellBook, type SpellTile } from "@/components/sheet/SpellBook";
import { useSpellLookups, useSpellPool } from "@/components/sheet/useSpellPool";
import { GameTerm } from "@/components/ui/GameTerm";
import { cn } from "@/lib/cn";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { bundledSpellSchool } from "@/lib/srd/spell-facts";
import { thirdCasterSchoolProblem } from "@/lib/srd/third-caster";
import { displayName } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import { armorClassLine, purseViewFor } from "../derivedReasons";
import BackgroundKitSection from "../BackgroundKitSection";
import EquipmentSection from "../EquipmentSection";
import KitChoicesSection from "../KitChoicesSection";
import type { BackgroundOption, ClassOption } from "../useBuilderOptions";
import type { TableRulesState } from "../useTableRules";
import type { BuilderActions, BuilderDerived } from "../useBuilderDerived";
import type { BuilderState } from "../useBuilderState";
import { StepPanel, inputClass } from "./shared";

const noSubscribe = () => () => {};

// Step 5: spells for a caster who has something to cast at this level (the
// section is absent for everyone else, a level 1 paladin included) and the
// equipment block: auto loadout, suggestions, catalog search, gold.
export function SpellsGearStep({
  state,
  derived,
  actions,
  klass,
  background,
  table,
  pack,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  actions: BuilderActions;
  klass: ClassOption | undefined;
  background: BackgroundOption | undefined;
  table: TableRulesState;
  pack: WorldPack | null;
}) {
  const purse = purseViewFor({
    purse: derived.purse,
    keepsStoredGear: state.keepsStoredGear,
    backgroundName: background?.name ?? "chosen",
    backgroundPurse: background?.purse ?? 0,
    classId: klass?.id ?? "",
    className: klass?.name ?? "character",
    table,
  });
  return (
    <div className="space-y-4">
      {klass && derived.casts ? (
        <SpellsSection state={state} derived={derived} klass={klass} pack={pack} />
      ) : null}
      <div data-builder-target="gear">
      <EquipmentSection
        equipment={derived.fullEquipment}
        suggestions={derived.equipmentSuggestions}
        onAdd={actions.addEquipmentItem}
        onAddMany={actions.addEquipmentItems}
        onRemove={actions.removeEquipmentItem}
        purse={purse}
        inputClass={inputClass}
        kit={
          <>
            {klass && derived.classKit && derived.kitChoices ? (
              <KitChoicesSection
                kit={derived.classKit}
                choices={derived.kitChoices}
                training={derived.kitTraining}
                className={klass.name.toLowerCase()}
                armorClass={armorClassLine(derived.acInfo?.ac ?? derived.ac, derived.acInfo?.parts)}
                onOption={actions.chooseKitOption}
                onPick={actions.pickKitSlot}
              />
            ) : null}
            {background && !state.keepsStoredGear ? (
              <BackgroundKitSection
                kit={derived.backgroundKit}
                backgroundName={background.name}
                onPick={actions.pickBackgroundGear}
              />
            ) : null}
          </>
        }
      />
      </div>
    </div>
  );
}

// The same spell book the sheet draws (src/components/sheet/SpellBook.tsx):
// a tab per spell level, every spell on the class list a tile, the chosen
// ones lit, the suggested ones starred, the subclass's free ones locked. One
// place to choose, instead of suggestions, a catalog and a search box that
// each said something slightly different.
function SpellsSection({
  state,
  derived,
  klass,
  pack,
}: {
  state: BuilderState;
  derived: BuilderDerived;
  klass: ClassOption;
  pack: WorldPack | null;
}) {
  const { spells, setSpells, cantrips, setCantrips, bookPrepared, setBookPrepared } = state;
  const {
    spellAdvice,
    cantripAdvice,
    chosenCantrips,
    chosenSpells,
    chosenPrepared,
    maxSpellLevel,
    starters,
    subclassSpells,
    racialCantrips,
    featSpells,
    spellSearchClass,
    spellStyle,
    spellbookAdvice,
  } = derived;
  // Every class holds to the 5e tables: a setting class borrows an SRD
  // class's spell list and its counts with it, the same counts the server
  // enforces on a level-up and at the sheet.
  const cantripCap = cantripAdvice;
  const spellCap = spellAdvice?.count ?? null;
  const bookCap = spellbookAdvice;
  const wizard = spellStyle === "spellbook";
  // A wizard fills the book first, then prepares from it.
  const [phase, setPhase] = useState<"book" | "prepare">("book");
  const [limitNote, setLimitNote] = useState("");
  // See SpellBook: the chosen tab is announced after mount so the travelling
  // pill never lands on server-rendered markup before hydration.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  const { pool, loading } = useSpellPool(spellSearchClass, maxSpellLevel);
  // A chosen spell the class list lacks (an edited sheet, a pack spell)
  // still finds its level.
  const lookups = useSpellLookups([...cantrips, ...spells]);

  const lower = (name: string) => name.toLowerCase();
  const has = (list: string[], name: string) => list.some((entry) => lower(entry) === lower(name));
  const isGranted = (name: string) => has(subclassSpells, name);
  // Known from the race, on top of the class's count (issue #118).
  const isRacial = (name: string) => has(racialCantrips, name);
  // Known from a feat (Fey Touched's misty step, Spell Sniper's cantrip),
  // on top of the class's count too.
  const isFeat = (name: string) => has([...featSpells.cantrips, ...featSpells.spells], name);
  const poolByName = new Map(pool.map((row) => [lower(row.name), row]));
  // An Eldritch Knight's or Arcane Trickster's two schools, as the server
  // judges the sheet (src/lib/srd/third-caster.ts). Null when the spell is
  // fine or the class has no school rule.
  const schoolOf = (spell: string) => ({
    name: spell,
    school: poolByName.get(lower(spell))?.data?.school ?? bundledSpellSchool(spell),
  });
  const offSchool = (name: string) =>
    thirdCasterSchoolProblem({
      classId: klass.id,
      subclass: state.subclass,
      level: state.level,
      spells: [...spells.filter((entry) => !isGranted(entry)), name].map(schoolOf),
    });
  const suggested = new Set(
    [...(starters?.cantrips ?? []), ...(starters?.spells ?? [])].map((entry) => lower(entry.n)),
  );

  function toggleCantrip(name: string) {
    if (has(cantrips, name)) {
      setCantrips((current) => current.filter((entry) => lower(entry) !== lower(name)));
      return;
    }
    if (cantripCap !== null && chosenCantrips.length >= cantripCap) {
      setLimitNote(
        `You already know ${cantripCap} ${cantripCap === 1 ? "cantrip" : "cantrips"}. Remove one to choose ${name}.`,
      );
      return;
    }
    setCantrips((current) => [...current, name]);
  }
  function toggleSpell(name: string) {
    if (has(spells, name)) {
      setSpells((current) => current.filter((entry) => lower(entry) !== lower(name)));
      setBookPrepared((current) => current.filter((entry) => lower(entry) !== lower(name)));
      return;
    }
    // A full list first, as the tile says (blockedFor below), then the
    // school rule.
    const cap = wizard ? bookCap : spellCap;
    if (cap !== null && chosenSpells.length >= cap) {
      setLimitNote(
        wizard
          ? `Your spellbook starts with ${cap} spells. Remove one to write in ${name}.`
          : `You already have ${cap} ${spellAdvice?.label ?? "spells"}. Remove one to choose ${name}.`,
      );
      return;
    }
    const school = offSchool(name);
    if (school) {
      setLimitNote(school);
      return;
    }
    setSpells((current) => [...current, name]);
  }
  function togglePrepared(name: string) {
    if (has(bookPrepared, name)) {
      setBookPrepared((current) => current.filter((entry) => lower(entry) !== lower(name)));
      return;
    }
    if (spellCap !== null && chosenPrepared.length >= spellCap) {
      setLimitNote(`You can prepare ${spellCap} spells. Unprepare one to prepare ${name}.`);
      return;
    }
    setBookPrepared((current) => [...current, name]);
  }

  function onTile(tile: SpellTile) {
    setLimitNote("");
    if (tile.level === 0) {
      toggleCantrip(tile.name);
    } else if (wizard && phase === "prepare") {
      togglePrepared(tile.name);
    } else {
      toggleSpell(tile.name);
    }
  }

  // Fills whatever room is left with the suggested picks, in order. A
  // wizard's suggestions go in the book and are prepared as far as they fit.
  function addSuggested() {
    if (!starters) {
      return;
    }
    const cantripRoom = cantripCap === null ? Infinity : cantripCap - chosenCantrips.length;
    const newCantrips = starters.cantrips
      .map((entry) => entry.n)
      .filter((name) => !has(cantrips, name) && !isRacial(name))
      .slice(0, Math.max(0, cantripRoom));
    const cap = wizard ? bookCap : spellCap;
    const spellRoom = cap === null ? Infinity : cap - chosenSpells.length;
    const newSpells = starters.spells
      .map((entry) => entry.n)
      .filter((name) => !has(spells, name) && !isGranted(name))
      .slice(0, Math.max(0, spellRoom));
    setLimitNote("");
    setCantrips((current) => [...current, ...newCantrips]);
    setSpells((current) => [...current, ...newSpells]);
    if (wizard) {
      const book = [...spells, ...newSpells];
      const prepareRoom = spellCap === null ? Infinity : spellCap - chosenPrepared.length;
      setBookPrepared((current) => [
        ...current,
        ...book.filter((name) => !has(current, name)).slice(0, Math.max(0, prepareRoom)),
      ]);
    }
  }

  // What a tile that is not chosen says when it cannot be chosen now, so a
  // full list reads as full before anyone taps (issue 66: taps past the cap
  // did nothing a player could see).
  const cantripsFull = cantripCap !== null && chosenCantrips.length >= cantripCap;
  const listCap = wizard ? bookCap : spellCap;
  const listFull = listCap !== null && chosenSpells.length >= listCap;
  const preparedFull = spellCap !== null && chosenPrepared.length >= spellCap;
  const listFullText = wizard ? "Spellbook full" : spellStyle === "known" ? "Known spells full" : "Prepared list full";
  const blockedFor = (name: string, level: number | null, tileState: SpellTile["state"]) => {
    if (tileState === "inBook") {
      return phase === "prepare" && preparedFull ? "Prepared list full" : undefined;
    }
    if (tileState !== "available") {
      return undefined;
    }
    if (level === 0) {
      return cantripsFull ? "Cantrips full" : undefined;
    }
    if (listFull) {
      return listFullText;
    }
    return offSchool(name) ? "Outside your two schools" : undefined;
  };

  // Every tile: the class list from the pack, plus anything chosen or
  // suggested the list lacks (a starter from a book the pack does not carry).
  const names = [
    ...pool.map((row) => row.name),
    ...cantrips,
    ...spells,
    ...subclassSpells,
    ...racialCantrips,
    ...featSpells.cantrips,
    ...featSpells.spells,
    ...(starters?.cantrips ?? []).map((entry) => entry.n),
    ...(starters?.spells ?? []).map((entry) => entry.n),
  ].filter((name, index, all) => all.findIndex((other) => lower(other) === lower(name)) === index);
  const tiles: SpellTile[] = names.flatMap((name): SpellTile[] => {
    const row = poolByName.get(lower(name)) ?? lookups.get(lower(name));
    const level = row?.level ?? spellLevelOf(name) ?? (has(cantrips, name) ? 0 : null);
    if ((level === 0 && cantripAdvice === null) || (level !== null && level > maxSpellLevel)) {
      return [];
    }
    let tileState: SpellTile["state"];
    if (level === 0) {
      tileState = isRacial(name) || isFeat(name) ? "granted" : has(cantrips, name) ? "ready" : "available";
    } else if (isGranted(name) || isFeat(name)) {
      tileState = "granted";
    } else if (wizard) {
      if (phase === "prepare" && !has(spells, name)) {
        return [];
      }
      tileState = !has(spells, name) ? "available" : has(bookPrepared, name) ? "ready" : "inBook";
    } else {
      tileState = has(spells, name) ? "ready" : "available";
    }
    return [
      {
        name,
        level,
        state: tileState,
        suggested: suggested.has(lower(name)) && !(level === 0 && isRacial(name)) && !isFeat(name),
        blocked: blockedFor(name, level, tileState),
        label: displayName(pack, "spells", name),
        data: row?.data,
        slug: row?.slug,
        homebrew: row?.source === "homebrew",
        ...(level === 0 && isRacial(name) ? { note: "From your race" } : isFeat(name) ? { note: "From your feat" } : {}),
        ...(row?.document && row.documentSlug !== "wotc-srd" ? { source: row.document } : {}),
      },
    ];
  });

  const counters = [
    ...(cantripAdvice !== null
      ? [{ label: "Cantrips", value: chosenCantrips.length, max: cantripAdvice }]
      : []),
    ...(wizard && spellbookAdvice !== null
      ? [{ label: "Spellbook", value: chosenSpells.length, max: spellbookAdvice }]
      : []),
    ...(spellAdvice
      ? [
          {
            label: spellStyle === "known" ? "Known" : "Prepared",
            value: wizard ? chosenPrepared.length : chosenSpells.length,
            max: spellAdvice.count,
          },
        ]
      : []),
  ];

  const className = klass.name.toLowerCase();
  return (
    <StepPanel
      title="Spells"
      ornate
      anchor="spells"
      help={
        <>
          <GameTerm id="cantrip">Cantrips</GameTerm> are small spells you know for good and cast as
          often as you like.{" "}
          {spellStyle === "known"
            ? `A ${className} knows a fixed set of spells, always ready to cast with a spell slot. You can swap one each time you level up.`
            : wizard
              ? "A wizard writes spells in a spellbook, then prepares some of them to cast. Fill the book first, then choose what is prepared. In play you change what is prepared after a long rest."
              : `A ${className} can prepare any spell on the ${className} list. Choose what you start with prepared; in play you change them after a long rest.`}{" "}
          Tap a spell to choose it; ⓘ reads it first.
        </>
      }
    >
      {wizard ? (
        <div role="tablist" aria-label="Spellbook step" className="mb-3 grid grid-cols-2 gap-1.5">
          {(
            [
              ["book", "1. Write your spellbook", `${chosenSpells.length}/${spellbookAdvice ?? "?"}`],
              ["prepare", "2. Prepare from it", `${chosenPrepared.length}/${spellAdvice?.count ?? "?"}`],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mounted && phase === key}
              onClick={() => {
                setPhase(key);
                setLimitNote("");
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                phase === key
                  ? "border-amber-400/70 bg-amber-400/10 text-amber-100"
                  : "border-stone-700/70 text-stone-400 hover:border-amber-500/40",
              )}
            >
              <span className="block font-display tracking-wide">{label}</span>
              <span className="font-mono text-[11px] text-stone-500">{count}</span>
            </button>
          ))}
        </div>
      ) : null}
      {starters ? (
        <p className="mb-2 text-xs text-stone-400">
          <Star className="mr-1 inline size-3 fill-amber-300 text-amber-300" aria-hidden="true" />
          {starters.why}{" "}
          <button
            type="button"
            onClick={addSuggested}
            className="text-amber-300 underline-offset-2 hover:underline"
          >
            Fill with the suggested spells
          </button>
        </p>
      ) : null}
      <SpellBook
        tiles={tiles}
        maxLevel={maxSpellLevel}
        counters={counters}
        onTile={onTile}
        notice={limitNote || undefined}
        emptyText={
          loading
            ? "Loading the spell list..."
            : wizard && phase === "prepare"
              ? "Nothing in your spellbook at this level."
              : "No spells at this level."
        }
        header={
          klass.genres ? (
            <span className="text-stone-500">Counts follow the {spellSearchClass} list this class borrows.</span>
          ) : null
        }
      />
    </StepPanel>
  );
}
