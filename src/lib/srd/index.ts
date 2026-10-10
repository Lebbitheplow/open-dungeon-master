import { subclassSpellsFor } from "@/lib/srd/features";
import { FEAT_ONLY_SPEED } from "@/lib/srd/feature-effects";
import { hasMediumArmorMaster } from "@/lib/srd/feat-combat";
import backgroundsJson from "@/lib/srd/backgrounds.json";
import classesJson from "@/lib/srd/classes.json";
import racesJson from "@/lib/srd/races.json";
import skillsJson from "@/lib/srd/skills.json";
import spellSlotsJson from "@/lib/srd/spell-slots.json";
import { CUSTOM_CLASSES } from "@/lib/classes";
import { computeArmorClass, matchArmor, unarmoredFormulaFor, type AcBreakdown } from "@/lib/srd/armor";
import { conditionAcRiders } from "@/lib/srd/condition-effects";
import { combatRiders, defenseRiders, halfProficiencyCovers } from "@/lib/srd/feature-effects";
import { featureSaveProficiencies } from "@/lib/srd/trait-rules";
import { authoredAcBonus, authoredSaveModifier, authoredSpeeds } from "@/lib/srd/authored-effects";
import { effectiveAbilities, magicItemRiders } from "@/lib/srd/magic-items";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { hpBonusPerLevel } from "@/lib/srd/race-id";
import { isThirdCaster, thirdCasterSlots } from "@/lib/srd/third-caster";
import type {
  Ability,
  AbilityScores,
  CharacterSheet,
  Proficiencies,
} from "@/lib/schemas/sheet";
import { itemCastNumbers } from "@/lib/srd/item-cast-credit";

import type { SrdBackground, SrdClass, SrdRace, SrdSkill } from "@/lib/srd/srd-types";

export type { SrdBackground, SrdClass, SrdRace, SrdSkill } from "@/lib/srd/srd-types";

export const SRD_SKILLS = skillsJson.skills as SrdSkill[];
export const SRD_CLASSES = classesJson.classes as SrdClass[];
export const SRD_RACES = racesJson.races as SrdRace[];
export const SRD_BACKGROUNDS = backgroundsJson.backgrounds as SrdBackground[];

const SLOT_TABLES = spellSlotsJson as unknown as {
  artificer: Record<string, number[]>;
  full: Record<string, number[]>;
  half: Record<string, number[]>;
  pact: Record<string, { slots: number; slotLevel: number }>;
};

// SRD classes first, then the setting-specific custom catalog.
export const ALL_CLASSES: SrdClass[] = [...SRD_CLASSES, ...CUSTOM_CLASSES];

export function findClass(id: string) {
  return ALL_CLASSES.find((entry) => entry.id === id) ?? null;
}

export function findRace(id: string) {
  return SRD_RACES.find((entry) => entry.id === id) ?? null;
}

export function findBackground(id: string) {
  return SRD_BACKGROUNDS.find((entry) => entry.id === id) ?? null;
}

// A character's creature size, derived from their race on demand rather
// than stored: Small vs Medium is what the rules care about (heavy weapons,
// grapple limits) and homebrew races default to Medium.
export function sizeForRace(raceId: string): "Small" | "Medium" {
  const race = findRace(raceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return race?.size === "Small" ? "Small" : "Medium";
}

export function findSkill(id: string) {
  return SRD_SKILLS.find((entry) => entry.id === id) ?? null;
}

export function abilityMod(score: number) {
  return Math.floor((score - 10) / 2);
}

export function proficiencyBonus(level: number) {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

export function formatModifier(value: number) {
  return value >= 0 ? `+${value}` : `${value}`;
}

// Spell slots {level: max} for a class at a character level, per SRD tables.
// The subclass matters for a fighter or a rogue only: the Eldritch Knight and
// the Arcane Trickster cast at a third of the pace (src/lib/srd/third-caster.ts).
export function spellSlotsFor(
  classId: string,
  level: number,
  subclass?: string | null,
): Record<string, number> {
  const klass = findClass(classId);
  if (klass?.casterType === "none" && isThirdCaster(classId, subclass)) {
    return thirdCasterSlots(level);
  }
  if (!klass || klass.casterType === "none") {
    return {};
  }
  const key = String(Math.max(1, Math.min(20, level)));
  if (klass.casterType === "pact") {
    const pact = SLOT_TABLES.pact[key];
    return pact ? { [String(pact.slotLevel)]: pact.slots } : {};
  }
  const row = SLOT_TABLES[klass.casterType][key] ?? [];
  return Object.fromEntries(row.map((max, index) => [String(index + 1), max]));
}

// Everything the armor engine needs off a sheet, loose enough that the
// character builder can pass a half-built character before one exists.
export type AcSource = {
  class: string;
  abilities: AbilityScores;
  proficiencies: Pick<Proficiencies, "armor">;
  equipment: Array<{ name: string; equipped?: boolean; attuned?: boolean }>;
  features: Array<{ name: string; classId?: string }>;
  level?: number;
  // Multiclass class list (acquisition order); resolves which Unarmored
  // Defense applies and scales level-driven riders per class.
  classes?: Array<{ id: string; level: number }>;
  // Active conditions, so effect conditions (Shield of Faith, Mage Armor,
  // Barkskin) land in the stored AC for as long as they hold.
  conditions?: string[];
  // Feats, for the ones that move the armor class (Medium Armor Master).
  feats?: string[];
  // The spell being concentrated on (Durable Magic's +2 AC holds while one is).
  concentratingOn?: string | null;
  // Extra flat adds on top of whatever the feature table already grants.
  bonus?: number;
  // Who wears the gear: a magic item that names who may attune to it gives
  // nothing to anyone else, and a dwarf is not slowed by heavy armor.
  race?: string;
  alignment?: string;
  spellcasting?: unknown;
};

// The character's armor class and how it was arrived at. The single place
// AC is computed: db/sheets.ts writes it on every patch, the builder shows
// it live, and the sheet dialog renders `parts` as the breakdown.
export function acBreakdownFor(source: AcSource): AcBreakdown {
  const riders = combatRiders({
    class: source.class,
    level: source.level ?? 1,
    features: source.features,
    classes: source.classes,
  });
  // Ability-setting magic items (a Belt of Giant Strength) change the DEX
  // and CON that feed the AC, so the effective scores are used throughout.
  const abilities = effectiveAbilities(source.abilities, source.equipment, source);
  const magic = magicItemRiders(source.equipment, source);
  const input = {
    equipment: source.equipment,
    race: source.race,
    armorProfs: source.proficiencies.armor,
    mediumArmorMaster: hasMediumArmorMaster({ feats: source.feats, features: source.features }),
    dexMod: abilityMod(abilities.dex),
    abilityMods: {
      con: abilityMod(abilities.con),
      wis: abilityMod(abilities.wis),
    },
    strength: abilities.str,
    unarmored: unarmoredFormulaFor(
      source.classes?.length
        ? source.classes.map((entry) => entry.id)
        : source.class,
      source.features,
    ),
  };
  // The Defense fighting style only counts while actually wearing armor, so
  // whether it applies is only knowable after the armor is resolved.
  const conditionAc = conditionAcRiders(source.conditions ?? [], {
    str: abilityMod(abilities.str),
    dex: abilityMod(abilities.dex),
    con: abilityMod(abilities.con),
    int: abilityMod(abilities.int),
    wis: abilityMod(abilities.wis),
    cha: abilityMod(abilities.cha),
  });
  let chosenInput = input;
  let resolved = computeArmorClass(input);
  // An alternative unarmored base from a condition (Mage Armor 13 + DEX)
  // wins only when it actually beats what the sheet already computes.
  if (conditionAc.base && conditionAc.baseSource && resolved.armorName === null) {
    const altInput = {
      ...input,
      unarmored: {
        source: conditionAc.baseSource,
        base: conditionAc.base,
        ability: null,
        allowsShield: true,
      },
    };
    const alt = computeArmorClass(altInput);
    if (alt.ac > resolved.ac) {
      chosenInput = altInput;
      resolved = alt;
    }
  }
  const armored = resolved.armorName !== null;
  const featureBonus = riders.acBonus && (!riders.acBonusRequiresArmor || armored)
    ? riders.acBonus
    : 0;
  // Bracers of Defense: only while wearing no armor and no shield.
  const unarmoredBonus =
    !armored && !resolved.shieldName ? magic.acUnarmoredBonus : 0;
  // The authored subclass features' own (Soul of the Forge, Durable Magic).
  const authored = authoredAcBonus(source);
  const bonus =
    featureBonus + magic.acBonus + unarmoredBonus + conditionAc.bonus + authored.bonus + (source.bonus ?? 0);
  let final = bonus ? computeArmorClass({ ...chosenInput, bonus }) : resolved;
  // Barkskin: the AC never sits below the floor while the condition holds.
  if (conditionAc.floor && final.ac < conditionAc.floor) {
    final = {
      ...final,
      ac: conditionAc.floor,
      parts: [...final.parts, `floor ${conditionAc.floor}`],
    };
  }
  return final;
}

export function deriveAc(source: AcSource): number {
  return acBreakdownFor(source).ac;
}

// The armor class attacks against this character actually face: the beast
// form's AC while transformed, the derived sheet AC otherwise.
//
// A pinned armor class (acOverride) is a number the armor engine leaves
// alone, but a spell still moves it: Shield, Shield of Faith, Haste and
// Barkskin's floor are added on read, the same riders deriveAc folds into an
// unpinned sheet's stored number.
export function effectiveAcFor(
  sheet: Pick<CharacterSheet, "ac"> & {
    wildShape?: CharacterSheet["wildShape"];
    acOverride?: boolean;
    conditions?: string[];
    abilities?: AbilityScores;
  },
): number {
  if (sheet.wildShape?.beastAc !== undefined && sheet.wildShape?.beastAc !== null) {
    return sheet.wildShape.beastAc;
  }
  if (!sheet.acOverride || !sheet.conditions?.length) {
    return sheet.ac;
  }
  const mods = sheet.abilities
    ? Object.fromEntries(
        Object.entries(sheet.abilities).map(([ability, score]) => [ability, abilityMod(score)]),
      )
    : undefined;
  const riders = conditionAcRiders(sheet.conditions, mods);
  const raised = sheet.ac + riders.bonus;
  return riders.floor ? Math.max(raised, riders.floor) : raised;
}

// The character's real walking speed. Worn armor gates the class speed
// bonuses (Fast Movement stops in heavy armor, Unarmored Movement in any
// armor or shield) and heavy armor below its Strength requirement costs
// 10 feet. Conditions and exhaustion apply downstream (condition-logic.ts).
// An active transformation replaces it with the form's own speed.
//
// `encumbrance` is the table's variant rule, which this module cannot read
// itself; callers with campaign access pass it and an overloaded pack costs
// a further 10 or 20 feet.
export function speedFor(
  source: AcSource & {
    speed: number;
    wildShape?: CharacterSheet["wildShape"];
    gold?: number;
    race?: string;
    feats?: string[];
  },
  options: { encumbrance?: boolean } = {},
): number {
  if (source.wildShape?.speed !== undefined) {
    return source.wildShape.speed;
  }
  // Test doubles and half-built sheets may lack these lists. A feat that
  // moves speed (Mobile) is read from sheet.feats as a feature by its name.
  const featNames = (source.feats ?? []).filter(
    (feat) => !(source.features ?? []).some((feature) => feature.name.toLowerCase() === feat.toLowerCase()),
  );
  const features = [...(source.features ?? []), ...featNames.map((name) => ({ name }))];
  const equipment = source.equipment ?? [];
  const riders = combatRiders({
    class: source.class,
    level: source.level ?? 1,
    features,
    classes: source.classes,
  });
  const breakdown = acBreakdownFor({ ...source, features, equipment });
  const worn = breakdown.armor ?? (breakdown.armorName ? matchArmor(breakdown.armorName) : null);
  // One feature's tiers replace each other; different features add up.
  const bySource = new Map<object | undefined, number>();
  for (const entry of riders.speedBonuses) {
    if (entry.gate === "heavy_armor" && worn?.category === "heavy") {
      continue;
    }
    if (entry.gate === "armor_or_shield" && (worn || breakdown.shieldName)) {
      continue;
    }
    bySource.set(entry.source, Math.max(bySource.get(entry.source) ?? 0, entry.amount));
  }
  // A feat whose name a class feature shares is read from sheet.feats alone
  // (feature-effects.ts FEAT_ONLY_SPEED: Level Up's Skirmisher).
  const featOnly = (source.feats ?? []).reduce((sum, feat) => sum + (FEAT_ONLY_SPEED[feat.trim().toLowerCase()] ?? 0), 0);
  const bonus = [...bySource.values()].reduce((sum, amount) => sum + amount, 0) + featOnly;
  const carried = source.abilities
    ? encumbranceFor({
        strength: source.abilities.str,
        equipment,
        coins: source.gold ?? 0,
        size: source.race ? sizeForRace(source.race) : undefined,
        wearer: source,
      })
    : null;
  const load = options.encumbrance ? (carried?.speedPenalty ?? 0) : 0;
  const speed = Math.max(0, source.speed + bonus - breakdown.speedPenalty - load);
  // Past the carrying capacity (Strength x 15, SRD 5.1 Lifting and
  // Carrying) the load can only be dragged: speed 5 feet, whatever the
  // table's encumbrance rule (src/lib/dm/load-rules.ts).
  return carried?.overCapacity ? Math.min(speed, 5) : speed;
}

// One named contribution to a derived number. The pattern is AC's: the sheet
// has always been able to say "16 = 14 leather + 2 DEX", and every other
// number computed the same way and then threw the reasoning away. A human DM
// will not trust an engine they cannot audit, so now they all keep it.
export type DerivedPart = { label: string; value: number };

// Every derived number's working. Sums are guaranteed to match the totals
// beside them because the totals are computed BY summing these.
export type DerivedParts = {
  saves: Record<Ability, DerivedPart[]>;
  skills: Record<string, DerivedPart[]>;
  initiative: DerivedPart[];
  passivePerception: DerivedPart[];
  spellSaveDc: DerivedPart[];
  spellAttack: DerivedPart[];
};

export type SheetDerived = {
  proficiencyBonus: number;
  abilityMods: Record<Ability, number>;
  saves: Record<Ability, number>;
  skills: Record<string, number>;
  initiative: number;
  passivePerception: number;
  passiveInvestigation: number;
  spellSaveDc: number | null;
  spellAttack: number | null;
  // Flying and swimming speeds the authored subclass features grant
  // (Stormborn, Wind Soul, Gift of the Sea), in feet; absent when none do.
  speeds?: { fly?: number; swim?: number };
  parts: DerivedParts;
};

// Drops the zero rows, which are noise, but always keeps the first one so a
// +0 modifier still shows where the number started.
function keepMeaningful(parts: DerivedPart[]): DerivedPart[] {
  return parts.filter((part, index) => index === 0 || part.value !== 0);
}

function sumParts(parts: DerivedPart[]): number {
  return parts.reduce((total, part) => total + part.value, 0);
}

// Flying and swimming speeds from the authored features, as a spread for the
// derived numbers; nothing when there are none.
function otherSpeeds(sheet: { features?: Array<{ name: string }>; speed?: number }): { speeds?: { fly?: number; swim?: number } } {
  const speeds = authoredSpeeds(sheet, sheet.speed ?? 30);
  return Object.keys(speeds).length ? { speeds } : {};
}

// All derived numbers come from the sheet + SRD data; the model never
// invents a modifier.
export function computeSheetDerived(
  sheet: Pick<
    CharacterSheet,
    "abilities" | "level" | "proficiencies" | "spellcasting"
  > & {
    class?: string;
    features?: Array<{ name: string }>;
    feats?: string[];
    equipment?: Array<{ name: string; equipped?: boolean; attuned?: boolean }>;
    wildShape?: CharacterSheet["wildShape"];
  },
): SheetDerived {
  const pb = proficiencyBonus(sheet.level);
  // Ability-setting magic items raise the scores every other number reads.
  const withItems = sheet.equipment
    ? effectiveAbilities(sheet.abilities, sheet.equipment, sheet)
    : sheet.abilities;
  // An active transformation overrides the scores its form carries: Wild
  // Shape stores STR/DEX/CON (mind stays the druid's), Polymorph all six.
  // Proficiencies and everything derived from the kept scores stay, per 5e.
  const abilities = sheet.wildShape?.abilities
    ? { ...withItems, ...sheet.wildShape.abilities }
    : withItems;
  const magicSaveBonus = sheet.equipment ? magicItemRiders(sheet.equipment, sheet).saveBonus : 0;
  const abilityMods = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [ability, abilityMod(abilities[ability])]),
  ) as Record<Ability, number>;

  // Feature- and feat-driven riders (Aura of Protection, Alert, Observant).
  // The full sheet carries class, features, and feats; the lighter callers
  // (the builder's preview) do not, and simply see none of them.
  const riderFeatures = [
    ...(sheet.features ?? []),
    ...((sheet.feats ?? []).map((name) => ({ name }))),
  ];
  const defense =
    sheet.class && (sheet.features || sheet.feats)
      ? defenseRiders({ class: sheet.class, level: sheet.level, features: riderFeatures }, abilityMods)
      : { saveBonus: 0, initiativeBonus: 0, passiveBonus: 0, halfProficiency: null };

  // Saves a feature trains on top of the class table's (Diamond Soul,
  // Slippery Mind): derived here, so no stored sheet has to change.
  const featureSaves = featureSaveProficiencies({
    features: riderFeatures,
  });
  const saveParts = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [
      ability,
      keepMeaningful([
        { label: `${ability.toUpperCase()} modifier`, value: abilityMods[ability] },
        {
          label: "proficiency",
          value:
            sheet.proficiencies.saves.includes(ability) || featureSaves.includes(ability) ? pb : 0,
        },
        { label: "features", value: defense.saveBonus },
        // Durable Magic's +2, Elegant Courtier's Charisma (authored-effects.ts).
        { label: "subclass features", value: authoredSaveModifier(sheet, ability, abilityMods) },
        { label: "magic items", value: magicSaveBonus },
      ]),
    ]),
  ) as Record<Ability, DerivedPart[]>;
  const saves = Object.fromEntries(
    (Object.keys(abilities) as Ability[]).map((ability) => [
      ability,
      sumParts(saveParts[ability]),
    ]),
  ) as Record<Ability, number>;

  // Jack of All Trades / Remarkable Athlete: half the proficiency bonus on
  // any covered check that does not already use it. The bard's rounds down;
  // the Champion's, which covers the physical abilities only, rounds up.
  const halfScope = defense.halfProficiency ?? null;
  const halfPb = halfScope === "physical" ? Math.ceil(pb / 2) : Math.floor(pb / 2);
  const expertise = sheet.proficiencies.expertise ?? [];
  const skillParts = Object.fromEntries(
    SRD_SKILLS.map((skill) => {
      const trained = expertise.includes(skill.id)
        ? { label: "expertise", value: pb * 2 }
        : sheet.proficiencies.skills.includes(skill.id)
          ? { label: "proficiency", value: pb }
          : halfProficiencyCovers(halfScope, skill.ability)
            ? { label: "half proficiency", value: halfPb }
            : { label: "untrained", value: 0 };
      return [
        skill.id,
        keepMeaningful([
          { label: `${skill.ability.toUpperCase()} modifier`, value: abilityMods[skill.ability] },
          trained,
        ]),
      ];
    }),
  ) as Record<string, DerivedPart[]>;
  const skills = Object.fromEntries(
    SRD_SKILLS.map((skill) => [skill.id, sumParts(skillParts[skill.id])]),
  );

  const spellAbility = sheet.spellcasting?.ability ?? null;
  // Initiative is a Dexterity check nobody is proficient in, so both
  // half-proficiency scopes cover it.
  const initiativeParts = keepMeaningful([
    { label: "DEX modifier", value: abilityMods.dex },
    { label: "features", value: defense.initiativeBonus },
    { label: "half proficiency", value: halfScope ? halfPb : 0 },
  ]);
  const passiveParts = keepMeaningful([
    { label: "base", value: 10 },
    { label: "Perception", value: skills.perception },
    { label: "features", value: defense.passiveBonus },
  ]);
  // Observant's +5 covers passive Investigation too.
  const passiveInvestigationParts = keepMeaningful([
    { label: "base", value: 10 },
    { label: "Investigation", value: skills.investigation },
    { label: "features", value: defense.passiveBonus },
  ]);
  const spellSaveParts = spellAbility
    ? [
        { label: "base", value: 8 },
        { label: "proficiency", value: pb },
        { label: `${spellAbility.toUpperCase()} modifier`, value: abilityMods[spellAbility] },
      ]
    : [];
  const spellAttackParts = spellAbility
    ? [
        { label: "proficiency", value: pb },
        { label: `${spellAbility.toUpperCase()} modifier`, value: abilityMods[spellAbility] },
      ]
    : [];
  return {
    proficiencyBonus: pb,
    abilityMods,
    saves,
    skills,
    initiative: sumParts(initiativeParts),
    passivePerception: sumParts(passiveParts),
    passiveInvestigation: sumParts(passiveInvestigationParts),
    spellSaveDc: spellAbility ? sumParts(spellSaveParts) : null,
    spellAttack: spellAbility ? sumParts(spellAttackParts) : null,
    ...otherSpeeds(sheet),
    parts: {
      saves: saveParts,
      skills: skillParts,
      initiative: initiativeParts,
      passivePerception: passiveParts,
      spellSaveDc: spellSaveParts,
      spellAttack: spellAttackParts,
    },
  };
}

// The caster entry that owns a spell on a multiclass sheet: the one whose
// known/prepared list carries it. Null when the sheet has no per-class
// casters or none of them lists the spell (legacy fields then apply).
function casterEntryForSpell(
  spellcasting: NonNullable<CharacterSheet["spellcasting"]>,
  spellName: string,
  // The sheet's classes, for a subclass's always-prepared spells (a
  // domain's, an oath's, a circle's), which no list on the sheet names.
  classes: Array<{ id: string; subclass?: string; level: number }> = [],
): NonNullable<NonNullable<CharacterSheet["spellcasting"]>["casters"]>[number] | null {
  const wanted = spellName.trim().toLowerCase();
  if (!wanted || !spellcasting.casters?.length) {
    return null;
  }
  const listed = spellcasting.casters.find((caster) =>
    allSpellNames(caster).some(
      (entry) => entry.trim().toLowerCase() === wanted,
    ),
  );
  if (listed) {
    return listed;
  }
  const granter = classes.find(
    (entry) => entry.subclass && subclassSpellsFor(entry.id, entry.subclass, entry.level).some((name) => name.trim().toLowerCase() === wanted),
  );
  if (granter) {
    return spellcasting.casters.find((caster) => caster.classId.toLowerCase() === granter.id.toLowerCase()) ?? null;
  }
  // A ritual read from a wizard's book, prepared or not, is the wizard's.
  return spellcasting.casters.find((caster) => (caster.spellbook ?? []).some((entry) => entry.trim().toLowerCase() === wanted)) ?? null;
}

// The save DC a named spell is cast at: the owning caster class's ability
// on a multiclass sheet, the sheet's single DC otherwise. Falls back to the
// primary DC for spells no caster entry lists (scrolls, story grants).
export function spellSaveDcFor(
  sheet: Parameters<typeof computeSheetDerived>[0],
  spellName: string,
): number | null {
  // A spell cast from a scroll or a wand carries the item's DC
  // (src/lib/srd/item-cast-credit.ts).
  const fromItem = itemCastNumbers((sheet as { id?: string }).id, spellName)?.saveDc;
  if (fromItem) {
    return fromItem;
  }
  const derived = computeSheetDerived(sheet);
  if (!sheet.spellcasting) {
    return derived.spellSaveDc;
  }
  const owner = casterEntryForSpell(sheet.spellcasting, spellName, (sheet as { classes?: Array<{ id: string; subclass?: string; level: number }> }).classes ?? []);
  if (!owner || owner.ability === sheet.spellcasting.ability) {
    return derived.spellSaveDc;
  }
  return 8 + derived.proficiencyBonus + derived.abilityMods[owner.ability];
}

// The spell-attack bonus for a named spell, same ownership rule as the DC.
export function spellAttackFor(
  sheet: Parameters<typeof computeSheetDerived>[0],
  spellName: string,
): number | null {
  const fromItem = itemCastNumbers((sheet as { id?: string }).id, spellName)?.attackBonus;
  if (fromItem) {
    return fromItem;
  }
  const derived = computeSheetDerived(sheet);
  if (!sheet.spellcasting) {
    return derived.spellAttack;
  }
  const owner = casterEntryForSpell(sheet.spellcasting, spellName, (sheet as { classes?: Array<{ id: string; subclass?: string; level: number }> }).classes ?? []);
  if (!owner || owner.ability === sheet.spellcasting.ability) {
    return derived.spellAttack;
  }
  return derived.proficiencyBonus + derived.abilityMods[owner.ability];
}

// Total XP needed to reach each level (index = level - 1), per the 5e table.
export const XP_THRESHOLDS = [
  0, 300, 900, 2_700, 6_500, 14_000, 23_000, 34_000, 48_000, 64_000,
  85_000, 100_000, 120_000, 140_000, 165_000, 195_000, 225_000, 265_000,
  305_000, 355_000,
];

export function levelForXp(xp: number): number {
  let level = 1;
  for (let index = 0; index < XP_THRESHOLDS.length; index += 1) {
    if (xp >= XP_THRESHOLDS[index]) {
      level = index + 1;
    }
  }
  return level;
}

// Suggested starting HP: max hit die + CON mod (+1/level for hill dwarves).
export function suggestedStartingHp(classId: string, raceId: string, con: number, level: number) {
  const klass = findClass(classId);
  if (!klass) {
    return 8;
  }
  const conMod = abilityMod(con);
  const perLevelBonus = hpBonusPerLevel(raceId);
  // Every level adds at least 1, however poor the Constitution (SRD 5.1,
  // Beyond 1st Level), so the floor sits on each level and not on the total.
  const firstLevel = Math.max(1, klass.hitDie + conMod + perLevelBonus);
  const laterLevels =
    Math.max(0, level - 1) *
    Math.max(1, Math.floor(klass.hitDie / 2) + 1 + conMod + perLevelBonus);
  return firstLevel + laterLevels;
}
