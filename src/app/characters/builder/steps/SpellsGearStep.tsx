"use client";

import { Star } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore } from "react";
import { SpellBook, type SpellTile } from "@/components/sheet/SpellBook";
import { AnyListSpellGroup } from "@/components/sheet/AnyListSpellGroup";
import { ANY_SPELL_LIST, useSpellLookups, useSpellPool, useWiderSpellPool } from "@/components/sheet/useSpellPool";
import { anyListPickRefusal, anyListTiles, builderAnyListGroup } from "@/lib/srd/any-list-picks-logic";
import { GameTerm } from "@/components/ui/GameTerm";
import { cn } from "@/lib/cn";
import { OWNS_ESCAPE } from "@/lib/owned-escape";
import { ui } from "@/lib/ui";
import { spellLevelOf } from "@/lib/srd/spell-lists";
import { bundledSpellSchool } from "@/lib/srd/spell-facts";
import { thirdCasterSchoolProblem } from "@/lib/srd/third-caster";
import { subclassCastingProfileFor } from "@/lib/srd/features";
import { displayName } from "@/lib/worlds/reskin-logic";
import type { WorldPack } from "@/lib/worlds/types";
import { armorClassLine, purseViewFor } from "../derivedReasons";
import BackgroundKitSection from "../BackgroundKitSection";
import EquipmentSection from "../EquipmentSection";
import KitChoicesSection from "../KitChoicesSection";
import type { BackgroundOption, ClassOption } from "../useBuilderOptions";
import type { TableRulesState } from "../useTableRules";
import type { BuilderActions, BuilderDerived, CasterDesk } from "../useBuilderDerived";
import { useRovingGroup } from "../roving";
import type { BuilderState } from "../useBuilderState";
import { fillSpells } from "../quickBuild";
import { spellOnSavedList, spellShortageLines, spellSupplyOf } from "../spellSupply";
import { capLines, castingNumbers, swapChoices, swapInList, swapQuestion, type PendingSwap } from "../spellDesk";
import { StepPanel, inputClass } from "./shared";
import { textKey } from "@/lib/language/text-logic";

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
      {/* The classes that cast: one desk, or a tab for each (backlog F9). */}
      {klass ? <CasterSpells state={state} derived={derived} klass={klass} pack={pack} /> : null}
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

// One casting class's desk as the spell desk reads it: its own lists and
// their setters, its counts, its spellcasting numbers, and the slots it
// casts from (a warlock's pact slots, on a class list). The lead's desk is
// the builder's own fields and derived values, unchanged.
function deskView(state: BuilderState, derived: BuilderDerived, desk: CasterDesk): { state: BuilderState; derived: BuilderDerived } {
  const pact = desk.klass.casterType === "pact" && derived.pactSlots ? derived.pactSlots : null;
  const slots = pact ? { [String(pact.level)]: { max: pact.max, used: 0 } } : derived.spellSlots;
  const numbers = (view: BuilderDerived) =>
    view.preview
      ? { ...view.preview, derived: { ...view.preview.derived, spellSaveDc: desk.spellSaveDc, spellAttack: desk.spellAttack } }
      : view.preview;
  if (desk.lead) {
    return { state, derived: pact ? { ...derived, spellSlots: slots } : derived };
  }
  const setList = (key: "spells" | "bookPrepared" | "cantrips") => (next: string[] | ((current: string[]) => string[])) =>
    state.setCasterList(desk.classId, key, next);
  return {
    state: {
      ...state,
      spells: desk.lists.spells,
      bookPrepared: desk.lists.bookPrepared,
      cantrips: desk.lists.cantrips,
      setSpells: setList("spells"),
      setBookPrepared: setList("bookPrepared"),
      setCantrips: setList("cantrips"),
    } as BuilderState,
    derived: { ...derived, ...desk, spellSlots: slots, preview: numbers(derived) } as BuilderDerived,
  };
}

// The spell step's desks (backlog F9, phase 2): one class that casts keeps
// the one desk it always had; several get a tab each, real tabs with their
// panels, one tab stop with the arrows between them (F16). Every panel stays
// mounted, so a half-made swap or a book phase survives a look at another.
function CasterSpells({
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
  const desks = (derived.casterDesks ?? []).filter((desk) => desk.casts);
  const keys = desks.map((desk) => desk.classId);
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = chosen && keys.includes(chosen) ? chosen : (keys[0] ?? null);
  const roving = useRovingGroup({ keys, chosen: shown });
  const baseId = useId();
  if (desks.length <= 1) {
    return derived.casts ? <SpellsSection state={state} derived={derived} klass={derived.casterKlass ?? klass} pack={pack} /> : null;
  }
  return (
    <div data-caster-tabs="">
      <div
        role="tablist"
        aria-label="Spells by class"
        className="mb-3 flex flex-wrap gap-2"
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {desks.map((desk) => (
          <button
            key={desk.classId}
            type="button"
            role="tab"
            id={`${baseId}-tab-${desk.classId}`}
            aria-selected={shown === desk.classId}
            aria-controls={`${baseId}-panel-${desk.classId}`}
            tabIndex={roving.tabIndex(desk.classId)}
            data-roving-item={desk.classId}
            data-caster-tab={desk.classId}
            onClick={() => setChosen(desk.classId)}
            className={cn(
              "inline-flex min-h-11 items-center rounded-lg border px-3 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400",
              shown === desk.classId
                ? "border-amber-500/60 bg-amber-400/10 text-amber-100"
                : "border-stone-600/60 text-stone-300 hover:border-amber-500/40 hover:bg-stone-900/70",
            )}
          >
            {desk.klass.name} {desk.casterLevel}
          </button>
        ))}
      </div>
      {desks.map((desk) => {
        const view = deskView(state, derived, desk);
        return (
          <div
            key={desk.classId}
            role="tabpanel"
            id={`${baseId}-panel-${desk.classId}`}
            aria-labelledby={`${baseId}-tab-${desk.classId}`}
            hidden={shown !== desk.classId}
            data-caster-panel={desk.classId}
          >
            <SpellsSection state={view.state} derived={view.derived} klass={desk.klass} pack={pack} />
          </div>
        );
      })}
    </div>
  );
}

// The same spell book the sheet draws (src/components/sheet/SpellBook.tsx):
// a tab per spell level, every spell on the class list a tile, the chosen
// ones lit, the suggested ones starred, the subclass's free ones locked. One
// place to choose, instead of suggestions, a catalog and a search box that
// each said something slightly different.
export function SpellsSection({
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
    spellWider,
    spellStyle,
    spellbookAdvice,
  } = derived;
  // Every class holds to the 5e tables: a setting class borrows an SRD
  // class's spell list and its counts with it, the same counts the server
  // enforces on a level-up and at the sheet.
  const cantripCap = cantripAdvice;
  const spellCap = spellAdvice?.count ?? null;
  const bookCap = spellbookAdvice;
  // The working behind a prepared caster's count, said with the limit.
  const limitWhy = spellAdvice?.formula ? `: ${spellAdvice.formula}` : "";
  const wizard = spellStyle === "spellbook";
  // A wizard fills the book first, then prepares from it.
  const [phase, setPhase] = useState<"book" | "prepare">("book");
  const [limitNote, setLimitNote] = useState("");
  // A tap on a spell while its list is full asks which spell it replaces
  // (backlog F13), instead of refusing it; the tile tapped gets focus back
  // if the swap is called off.
  const [swap, setSwap] = useState<PendingSwap | null>(null);
  const deskRef = useRef<HTMLDivElement | null>(null);
  // See SpellBook: the chosen tab is announced after mount so the travelling
  // pill never lands on server-rendered markup before hydration.
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  // A patron's expanded spells and a Divine Soul's cleric list join it.
  const { pool, loading } = useWiderSpellPool(spellSearchClass, maxSpellLevel, true, spellWider);
  // A chosen spell the class list lacks (an edited sheet, a pack spell)
  // still finds its level.
  const lookups = useSpellLookups([...cantrips, ...spells]);
  // Magical Secrets and the Book of Shadows take picks from any class's
  // list (src/lib/srd/any-list-picks-logic.ts): every class's spells, for
  // their group below the book.
  const spellGrants = derived.spellGrants;
  const { pool: anyPool, loading: anyLoading } = useSpellPool(ANY_SPELL_LIST, maxSpellLevel, Boolean(spellGrants?.anyList));
  const [anyNote, setAnyNote] = useState("");

  const has = (list: string[], name: string) => list.some((entry) => textKey(entry) === textKey(name));
  const isGranted = (name: string) => has(subclassSpells, name);
  // Known from the race, on top of the class's count (issue #118).
  const isRacial = (name: string) => has(racialCantrips, name);
  // Known from a feat (Fey Touched's misty step, Spell Sniper's cantrip),
  // on top of the class's count too.
  const isFeat = (name: string) => has([...featSpells.cantrips, ...featSpells.spells], name);
  const poolByName = new Map(pool.map((row) => [textKey(row.name), row]));
  // The picks off the class's list are the group's, read once the class's
  // list is in (until then every pick would look off it).
  const onClassList = (name: string) => poolByName.has(textKey(name));
  const className = klass.name.toLowerCase();
  const anyBuild =
    spellGrants && !loading
      ? builderAnyListGroup({
          grants: spellGrants,
          cantrips: chosenCantrips.filter((name) => !isFeat(name)),
          spells: chosenSpells.filter((name) => !isFeat(name)),
          onList: onClassList,
          cantripCap,
          own: className,
          maxLevel: maxSpellLevel,
        })
      : { group: null, chosen: [] };
  const anyGroup = anyBuild.group;
  const anyChosenKeys = new Set(anyBuild.chosen.map((name) => textKey(name)));
  // An Eldritch Knight's or Arcane Trickster's two schools, as the server
  // judges the sheet (src/lib/srd/third-caster.ts). Null when the spell is
  // fine or the class has no school rule.
  const schoolOf = (spell: string) => ({
    name: spell,
    school: poolByName.get(textKey(spell))?.data?.school ?? bundledSpellSchool(spell),
  });
  // `without` is the spell a swap takes out to make room.
  const offSchool = (name: string, without?: string) =>
    thirdCasterSchoolProblem({
      classId: klass.id,
      subclass: derived.casterSubclass ?? state.subclass,
      profile: subclassCastingProfileFor(klass.id, derived.casterSubclass ?? state.subclass),
      level: derived.casterLevel ?? state.level,
      spells: [
        ...spells.filter((entry) => !isGranted(entry) && (without === undefined || textKey(entry) !== textKey(without))),
        name,
      ].map(schoolOf),
    });
  // Only the starters the save takes for this class: the bundled list puts
  // none of the artificer's suggested cantrips on its list, and a star on
  // one led to a refusal at the save.
  const listRule = { third: klass.casterType === "none", spellClass: spellSearchClass, spellPool: loading ? undefined : pool };
  const starterCantrips = (starters?.cantrips ?? []).filter((entry) => spellOnSavedList(entry.n, listRule));
  const starterSpells = (starters?.spells ?? []).filter((entry) => spellOnSavedList(entry.n, listRule));
  const suggested = new Set([...starterCantrips, ...starterSpells].map((entry) => textKey(entry.n)));

  // The picks a swap may take out of each list to make room for `into`:
  // never one the subclass, the race or a feat grants, which do not count
  // against the cap; and for an Eldritch Knight or Arcane Trickster only one
  // whose leaving keeps `into` inside the two schools.
  const choicesFor = (kind: PendingSwap["kind"], into: string) =>
    kind === "cantrip"
      ? swapChoices({ list: cantrips, into, locked: (entry) => isRacial(entry) || isFeat(entry) })
      : kind === "prepared"
        ? swapChoices({ list: bookPrepared, into, locked: isGranted })
        : swapChoices({
            list: spells,
            into,
            locked: (entry) => isGranted(entry) || isFeat(entry),
            // Only a third caster has the school rule; every tile asks, so
            // no one else pays for the check.
            problem: listRule.third ? offSchool : undefined,
          });
  const candidatesFor = (kind: PendingSwap["kind"], into: string) => choicesFor(kind, into).candidates;
  // Opens the swap when the full list has a pick of the player's to trade.
  function offerSwap(kind: PendingSwap["kind"], name: string): boolean {
    if (!candidatesFor(kind, name).length) {
      return false;
    }
    setSwap({ kind, name });
    // The question is where the player's attention should go next: focus
    // moves to it, and Cancel or Escape brings it back to the tile.
    window.setTimeout(() => deskRef.current?.querySelector<HTMLElement>("[data-spell-swap]")?.focus(), 0);
    return true;
  }
  // The tile by its spell, not whatever held focus at the tap: a tap on a
  // phone (WebKit) never focuses the button it lands on.
  function focusTile(name: string) {
    window.setTimeout(() => {
      deskRef.current?.querySelector<HTMLElement>(`li[data-spell="${CSS.escape(name)}"] button`)?.focus();
    }, 0);
  }
  function cancelSwap() {
    if (swap) {
      focusTile(swap.name);
    }
    setSwap(null);
  }
  // One action: the chosen spell goes out and the tapped one takes its
  // place, by the same rules a tap would have checked.
  function doSwap(out: string) {
    if (!swap) {
      return;
    }
    const into = swap.name;
    if (swap.kind === "cantrip") {
      setCantrips((current) => swapInList(current, out, into));
    } else if (swap.kind === "prepared") {
      setBookPrepared((current) => swapInList(current, out, into));
    } else {
      const school = offSchool(into, out);
      if (school) {
        setSwap(null);
        setLimitNote(school);
        focusTile(into);
        return;
      }
      setSpells((current) => swapInList(current, out, into));
      // A spell that leaves the book leaves what is prepared from it.
      setBookPrepared((current) => current.filter((entry) => textKey(entry) !== textKey(out)));
    }
    setSwap(null);
    setLimitNote(`Swapped ${out} out for ${into}.`);
    focusTile(into);
  }

  function toggleCantrip(name: string) {
    if (has(cantrips, name)) {
      setCantrips((current) => current.filter((entry) => textKey(entry) !== textKey(name)));
      return;
    }
    if (cantripCap !== null && chosenCantrips.length >= cantripCap) {
      if (offerSwap("cantrip", name)) {
        return;
      }
      setLimitNote(
        `You already know ${cantripCap} ${cantripCap === 1 ? "cantrip" : "cantrips"}. Remove one to choose ${name}.`,
      );
      return;
    }
    setCantrips((current) => [...current, name]);
  }
  function toggleSpell(name: string) {
    if (has(spells, name)) {
      setSpells((current) => current.filter((entry) => textKey(entry) !== textKey(name)));
      setBookPrepared((current) => current.filter((entry) => textKey(entry) !== textKey(name)));
      return;
    }
    // A full list first, as the tile says (blockedFor below), then the
    // school rule.
    const cap = wizard ? bookCap : spellCap;
    if (cap !== null && chosenSpells.length >= cap) {
      if (offerSwap("spell", name)) {
        return;
      }
      // Picks to trade, and the two schools turned every one away.
      const school = choicesFor("spell", name).ruledOut ? offSchool(name) : null;
      if (school) {
        setLimitNote(school);
        return;
      }
      setLimitNote(
        wizard
          ? `Your spellbook starts with ${cap} spells. Remove one to write in ${name}.`
          : `You already have ${cap} ${spellAdvice?.label ?? "spells"}${limitWhy}. Remove one to choose ${name}.`,
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
      setBookPrepared((current) => current.filter((entry) => textKey(entry) !== textKey(name)));
      return;
    }
    if (spellCap !== null && chosenPrepared.length >= spellCap) {
      if (offerSwap("prepared", name)) {
        return;
      }
      setLimitNote(`You can prepare ${spellCap} spells${limitWhy}. Unprepare one to prepare ${name}.`);
      return;
    }
    setBookPrepared((current) => [...current, name]);
  }

  function onTile(tile: SpellTile) {
    setLimitNote("");
    setAnyNote("");
    setSwap(null);
    if (tile.level === 0) {
      toggleCantrip(tile.name);
    } else if (wizard && phase === "prepare") {
      togglePrepared(tile.name);
    } else {
      toggleSpell(tile.name);
    }
  }

  // Fills whatever room is left the way the quick build does (quickBuild.ts
  // fillSpells): the suggested picks the save takes first, then the class
  // list's best. A wizard's go in the book and are prepared as far as they
  // fit.
  function addSuggested() {
    setLimitNote("");
    setSwap(null);
    const fill = fillSpells({ fields: { cantrips, spells, bookPrepared }, derived, klass, spellPool: listRule.spellPool });
    if (fill?.patch.cantrips) setCantrips(fill.patch.cantrips);
    if (fill?.patch.spells) setSpells(fill.patch.spells);
    if (fill?.patch.bookPrepared) setBookPrepared(fill.patch.bookPrepared);
  }


  // What a tile that is not chosen says when it cannot be chosen now, so a
  // full list reads as full before anyone taps (issue 66: taps past the cap
  // did nothing a player could see).
  const cantripsFull = cantripCap !== null && chosenCantrips.length >= cantripCap;
  const listCap = wizard ? bookCap : spellCap;
  const listFull = listCap !== null && chosenSpells.length >= listCap;
  const preparedFull = spellCap !== null && chosenPrepared.length >= spellCap;
  const listFullText = wizard ? "Spellbook full" : spellStyle === "known" ? "Known spells full" : "Prepared list full";
  // A full list with a pick of the player's in it that can make room for
  // this spell offers a swap instead (backlog F13): the tile says so and is
  // not dimmed.
  const swapsIn = (name: string, level: number | null, tileState: SpellTile["state"]) =>
    tileState === "inBook"
      ? phase === "prepare" && preparedFull && candidatesFor("prepared", name).length > 0
      : tileState === "available" &&
        (level === 0 ? cantripsFull && candidatesFor("cantrip", name).length > 0 : listFull && candidatesFor("spell", name).length > 0);
  const blockedFor = (name: string, level: number | null, tileState: SpellTile["state"], swappable: boolean) => {
    if (swappable) {
      return undefined;
    }
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
      // Picks to trade, and the two schools turn every one away: the rule
      // is what stands in the way, not the count.
      return choicesFor("spell", name).ruledOut ? "Outside your two schools" : listFullText;
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
    ...starterCantrips.map((entry) => entry.n),
    ...starterSpells.map((entry) => entry.n),
  ]
    .filter((name, index, all) => all.findIndex((other) => textKey(other) === textKey(name)) === index)
    // A pick from another class's list sits in its own group below.
    .filter((name) => !anyChosenKeys.has(textKey(name)));
  const tiles: SpellTile[] = names.flatMap((name): SpellTile[] => {
    const row = poolByName.get(textKey(name)) ?? lookups.get(textKey(name));
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
    const swappable = swapsIn(name, level, tileState);
    return [
      {
        name,
        level,
        state: tileState,
        suggested: suggested.has(textKey(name)) && !(level === 0 && isRacial(name)) && !isFeat(name),
        blocked: blockedFor(name, level, tileState, swappable),
        label: displayName(pack, "spells", name),
        data: row?.data,
        slug: row?.slug,
        homebrew: row?.source === "homebrew",
        ...(level === 0 && isRacial(name)
          ? { note: "From your race" }
          : isFeat(name)
            ? { note: "From your feat" }
            : swappable
              ? { note: "Full: tap to swap in" }
              : {}),
        ...(row?.document && row.documentSlug !== "wotc-srd" ? { source: row.document } : {}),
      },
    ];
  });

  // The group's tiles: other classes' spells it takes, each pick also taking
  // its place in the counts above.
  const anyRefusal = (name: string, cantrip: boolean) =>
    anyGroup
      ? anyListPickRefusal({
          group: anyGroup,
          picked: anyBuild.chosen.length,
          cantrip,
          cantripsOpen: (cantripCap ?? 0) - chosenCantrips.length,
          spellsOpen: (spellCap ?? 0) - chosenSpells.length,
          name,
        })
      : null;
  const anyTiles: SpellTile[] = anyGroup
    ? anyListTiles({
        group: anyGroup,
        pool: anyPool,
        held: (name) => onClassList(name) || isGranted(name) || isRacial(name) || isFeat(name),
        picks: anyBuild.chosen,
        elsewhere: () => null,
        refusal: anyRefusal,
      }).map((tile) => ({ ...tile, label: displayName(pack, "spells", tile.name) }))
    : [];
  function toggleAnyPick(tile: SpellTile) {
    setAnyNote("");
    setLimitNote("");
    setSwap(null);
    const key = textKey(tile.name);
    const setList = tile.level === 0 ? setCantrips : setSpells;
    if (anyChosenKeys.has(key)) {
      setList((current) => current.filter((entry) => textKey(entry) !== key));
      return;
    }
    const refusal = anyRefusal(tile.name, tile.level === 0);
    if (refusal) {
      setAnyNote(refusal.long);
      return;
    }
    setList((current) => [...current, tile.name]);
  }

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

  // The desk's header (backlog F13): the numbers the build math table
  // shows for casting (buildMath.ts), and each cap said as its working.
  const numbers = castingNumbers({
    spellSaveDc: derived.preview?.derived.spellSaveDc,
    spellAttack: derived.preview?.derived.spellAttack,
    spellSlots: derived.spellSlots,
  });
  const caps = capLines({
    className: klass.name,
    level: derived.casterLevel ?? derived.effectiveLevel,
    cantripCap,
    spellbookCap: wizard ? bookCap : null,
    spellCap: spellAdvice,
    known: spellStyle === "known",
  });
  const listTitle = spellStyle === "known" ? "Known spells" : "Prepared";
  const named = (list: string[]) => list.map((name) => displayName(pack, "spells", name));
  const chosenLists = [
    ...(cantripCap !== null
      ? [{ id: "cantrips", title: "Cantrips", count: `${chosenCantrips.length}/${cantripCap}`, names: named(chosenCantrips) }]
      : []),
    ...(wizard
      ? [{ id: "book", title: "Spellbook", count: `${chosenSpells.length}/${bookCap ?? "?"}`, names: named(chosenSpells) }]
      : []),
    ...(spellAdvice
      ? [
          {
            id: "list",
            title: listTitle,
            count: `${wizard ? chosenPrepared.length : chosenSpells.length}/${spellAdvice.count}`,
            names: named(wizard ? chosenPrepared : chosenSpells),
          },
        ]
      : []),
    ...(subclassSpells.length
      ? [{ id: "granted", title: "Always prepared", count: String(subclassSpells.length), names: named(subclassSpells) }]
      : []),
  ];

  // Fewer spells on the list than the class may take: said, and not held
  // against the save (submit.ts spellsBlocks).
  const shortage =
    loading || listRule.third
      ? []
      : spellShortageLines({
          className,
          supply: spellSupplyOf(pool, maxSpellLevel, [...racialCantrips, ...featSpells.cantrips, ...featSpells.spells, ...subclassSpells]),
          cantripCap,
          listCap: wizard ? bookCap : spellCap,
          listVerb: wizard ? "write in your spellbook" : spellStyle === "known" ? "know" : "prepare",
          maxSpellLevel,
        });
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
      <div ref={deskRef}>
      <SpellDeskHeader
        numbers={numbers}
        caps={caps}
        lists={chosenLists}
      />
      {wizard ? (
        // Two toggle buttons that switch what the list below does (write or
        // prepare), the same pattern as the spell level row in SpellBook.
        <div role="group" aria-label="Spellbook step" data-pill-group className="mb-3 grid grid-cols-2 gap-1.5">
          {(
            [
              ["book", "1. Write your spellbook", `${chosenSpells.length}/${spellbookAdvice ?? "?"}`],
              ["prepare", "2. Prepare from it", `${chosenPrepared.length}/${spellAdvice?.count ?? "?"}`],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={mounted && phase === key}
              data-on={mounted && phase === key ? "" : undefined}
              onClick={() => {
                setPhase(key);
                setLimitNote("");
                setSwap(null);
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                phase === key
                  ? "border-amber-400/70 bg-amber-400/10 text-amber-100"
                  : "border-stone-700/70 text-stone-400 hover:border-amber-500/40",
              )}
            >
              <span className="block font-display tracking-wide">{label}</span>
              <span className="font-mono text-[0.875rem] text-stone-500">{count}</span>
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
      {shortage.length ? (
        <div data-spell-shortage className="mb-2 space-y-1 rounded-lg border border-amber-500/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          {shortage.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      <SpellBook
        tiles={tiles}
        maxLevel={maxSpellLevel}
        counters={counters}
        onTile={onTile}
        writingBook={wizard && phase === "book"}
        notice={limitNote || undefined}
        filters
        prompt={
          swap ? (
            <SwapPrompt
              question={swapQuestion(
                swap,
                swap.kind === "cantrip" ? "Cantrips full" : swap.kind === "prepared" ? "Prepared list full" : listFullText,
              )}
              candidates={candidatesFor(swap.kind, swap.name)}
              into={swap.name}
              label={(name) => displayName(pack, "spells", name)}
              onSwap={doSwap}
              onCancel={cancelSwap}
            />
          ) : null
        }
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
        searchLabel={anyGroup ? `Find a ${className} spell` : undefined}
      />
      {anyGroup ? (
        <div className="mt-3">
          <AnyListSpellGroup
            group={anyGroup}
            tiles={anyTiles}
            maxLevel={maxSpellLevel}
            picked={anyBuild.chosen.length}
            onTile={toggleAnyPick}
            notice={anyNote}
            loading={anyLoading}
          />
        </div>
      ) : null}
      </div>
    </StepPanel>
  );
}

// The top of the spell desk (backlog F13): the casting numbers the sheet
// will carry, each cap with its working, and what is chosen, the book and
// the prepared list side by side, so neither has to be remembered while
// the other is open.
function SpellDeskHeader({
  numbers,
  caps,
  lists,
}: {
  numbers: ReturnType<typeof castingNumbers>;
  caps: ReturnType<typeof capLines>;
  lists: Array<{ id: string; title: string; count: string; names: string[] }>;
}) {
  return (
    <div data-spell-desk="" className="mb-3 space-y-2 text-xs">
      {numbers.dc || numbers.attack || numbers.slots.length ? (
        <dl data-casting-numbers="" className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2">
          {numbers.dc ? (
            <div className="flex gap-1">
              <dt className="text-stone-400">
                <GameTerm id="spell_save_dc">Spell save DC</GameTerm>
              </dt>
              <dd className="font-mono text-amber-100">{numbers.dc}</dd>
            </div>
          ) : null}
          {numbers.attack ? (
            <div className="flex gap-1">
              <dt className="text-stone-400">Spell attack</dt>
              <dd className="font-mono text-amber-100">{numbers.attack}</dd>
            </div>
          ) : null}
          {numbers.slots.length ? (
            <div className="flex gap-1">
              <dt className="text-stone-400">
                <GameTerm id="spell_slot">Slots</GameTerm>
              </dt>
              <dd className="text-amber-100">
                {numbers.slots.map((slot) => `${slot.label} ${slot.max}`).join(", ")}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {caps.length ? (
        <ul data-spell-caps="" className="space-y-0.5 text-stone-400">
          {caps.map((cap) => (
            <li key={cap.id}>
              <span className="text-stone-300">{cap.label}:</span> {cap.line}
            </li>
          ))}
        </ul>
      ) : null}
      {lists.length ? (
        <div data-chosen-spells="" className="grid gap-2 sm:grid-cols-2">
          {lists.map((list) => (
            <section key={list.id} aria-label={`${list.title}, ${list.count}`} className="rounded-lg border border-stone-800 px-3 py-2">
              <h4 className="eyebrow text-[0.875rem] text-stone-400">
                {list.title} <span className="font-mono">{list.count}</span>
              </h4>
              {list.names.length ? (
                <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-stone-200">
                  {list.names.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-stone-500">None yet.</p>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// "Swap it in for which?": one button per pick that can go, a tap on one
// trades them in one action. Escape or Cancel leaves both lists alone, and
// the question keeps its Escape from a dialog around the builder
// (OWNS_ESCAPE). Amber and stone, which the day theme turns to ink on
// cream, as the builder's other notices are; every button is a finger's
// width on a phone (pk-tap).
function SwapPrompt({
  question,
  candidates,
  into,
  label,
  onSwap,
  onCancel,
}: {
  question: string;
  candidates: string[];
  into: string;
  label: (name: string) => string;
  onSwap: (out: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label={question}
      tabIndex={-1}
      data-spell-swap=""
      {...{ [OWNS_ESCAPE]: "" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      className="reveal mb-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-100 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      <p className="mb-1.5">{question}</p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onSwap(name)}
            aria-label={`${label(name)}: swap out for ${label(into)}`}
            className={cn(ui.btnSmall, "pk-tap")}
          >
            {label(name)}
          </button>
        ))}
        <button type="button" onClick={onCancel} className={cn(ui.btnSmall, "pk-tap text-stone-400")}>
          Cancel
        </button>
      </div>
    </div>
  );
}
