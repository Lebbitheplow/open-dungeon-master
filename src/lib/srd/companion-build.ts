// The choices a companion makes for itself.
//
// A player's character levels through a dialog: the player picks where an
// Ability Score Improvement goes and which spells are learned, and the server
// builds the level from those picks (src/lib/srd/level-up.ts). A companion
// has nobody to ask, so the engine picks for it, here, and then hands the
// picks to the very same builder. That is what keeps a companion's sheet
// legal by construction: nothing in this file writes a sheet, it only names
// choices the rules then judge like anybody's.
//
// Pure: no database. The spells to pick from are handed in.
import type { Ability, AbilityScores, AsiChoice } from "@/lib/schemas/sheet";
import { ABILITY_SCORE_CAP, applyAsiChoices } from "@/lib/srd/asi";
import {
  cantripCapOf,
  dedupeNames,
  grantedSpellsOf,
  heldSpells,
  maxSpellLevelOf,
  preparedCount,
  spellCapOf,
  spellbookAllowance,
  spellbookOf,
  type CasterView,
} from "@/lib/srd/spell-prep";

const lower = (name: string) => name.trim().toLowerCase();

// Where a companion's improvements go: two points to the first score of its
// class's priority that has room for both, and when the best it can do is a
// score of 19, one point there and one to the next score with room. Feats
// are a player's taste; a companion takes the numbers.
export function companionImprovements(
  scores: AbilityScores,
  priority: Ability[],
  count: number,
): AsiChoice[] {
  const choices: AsiChoice[] = [];
  let current = { ...scores };
  for (let taken = 0; taken < count; taken += 1) {
    const roomy = priority.find((ability) => current[ability] <= ABILITY_SCORE_CAP - 2);
    const tight = priority.find((ability) => current[ability] === ABILITY_SCORE_CAP - 1);
    const first = priority.find((ability) => current[ability] < ABILITY_SCORE_CAP);
    let choice: AsiChoice | null = null;
    if (first !== undefined && first === tight) {
      const second = priority.find(
        (ability) => ability !== first && current[ability] < ABILITY_SCORE_CAP,
      );
      choice = second ? { mode: "plus1x2", abilities: [first, second] } : null;
    } else if (roomy !== undefined) {
      choice = { mode: "plus2", ability: roomy };
    }
    if (!choice) {
      // Every score stands at 20: there is nothing left to improve.
      break;
    }
    choices.push(choice);
    current = applyAsiChoices(current, [choice]);
  }
  return choices;
}

const ABILITY_ORDER: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

// The order a companion's scores matter in, by the shape of its class:
// casters lead with their casting stat, classes that save on Strength fight
// in melee, everyone else is a Dexterity skirmisher. Constitution always
// lands second.
export function abilityPriority(klass: {
  spellAbility?: Ability | null;
  saves: readonly string[];
}): Ability[] {
  const casting = klass.spellAbility;
  if (casting) {
    const rest = ABILITY_ORDER.filter(
      (ability) => ability !== casting && ability !== "con" && ability !== "dex",
    );
    return [casting, "con", "dex", ...rest];
  }
  if (klass.saves.includes("str")) {
    return ["str", "con", "dex", "wis", "cha", "int"];
  }
  return ["dex", "con", "wis", "str", "int", "cha"];
}

// A priority for a class nobody described: the scores as they stand, best
// first, which is where whoever built the sheet put the character's weight.
export function priorityFromScores(scores: AbilityScores): Ability[] {
  return (Object.keys(scores) as Ability[]).sort((a, b) => scores[b] - scores[a]);
}

// Spells an adventuring ally is glad to have, tried before the rest of a
// class's list. Names the checklist does not carry are simply never offered.
const STAPLES = [
  "Fire Bolt", "Sacred Flame", "Eldritch Blast", "Vicious Mockery", "Produce Flame", "Ray of Frost",
  "Light", "Guidance", "Mage Hand", "Shillelagh", "Minor Illusion", "Spare the Dying",
  "Cure Wounds", "Healing Word", "Bless", "Magic Missile", "Shield", "Guiding Bolt", "Sleep",
  "Faerie Fire", "Hunter's Mark", "Mage Armor", "Burning Hands", "Thunderwave", "Entangle",
  "Shield of Faith", "Hellish Rebuke", "Charm Person", "Detect Magic",
  "Hold Person", "Spiritual Weapon", "Lesser Restoration", "Scorching Ray", "Misty Step",
  "Invisibility", "Moonbeam", "Aid", "Pass without Trace", "Shatter",
  "Fireball", "Revivify", "Counterspell", "Dispel Magic", "Spirit Guardians", "Call Lightning",
  "Haste", "Fly", "Mass Healing Word", "Conjure Animals", "Hypnotic Pattern",
  "Banishment", "Polymorph", "Greater Invisibility", "Death Ward", "Wall of Fire", "Ice Storm",
  "Cone of Cold", "Mass Cure Wounds", "Flame Strike", "Greater Restoration", "Hold Monster",
  "Wall of Force", "Raise Dead",
  "Heal", "Chain Lightning", "Disintegrate", "Sunbeam", "Blade Barrier",
  "Finger of Death", "Resurrection", "Fire Storm", "Teleport", "Regenerate",
  "Sunburst", "Earthquake", "Dominate Monster", "Holy Aura",
  "Meteor Swarm", "Mass Heal", "Power Word Kill", "True Resurrection", "Foresight",
].map(lower);

function byPreference<T extends { name: string }>(spells: T[]): T[] {
  const rank = (spell: T) => {
    const index = STAPLES.indexOf(lower(spell.name));
    return index === -1 ? STAPLES.length : index;
  };
  return [...spells].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export type CompanionSpellInput = {
  // The caster's lists as held, at the class's level BEFORE this one; empty
  // lists for a caster being made.
  before: CasterView;
  // The class's level after.
  level: number;
  // The scores after this level's improvements.
  abilities: AbilityScores;
  // True for the first level in the class, and for a companion made whole at
  // a level: a wizard then writes its whole starting book.
  firstLevel: boolean;
  // Cantrips the race gave, known on top of the class's own.
  freeCantrips: number;
  // The class's list (src/lib/srd/spell-lists.ts checklistSpellsOn).
  candidates: Array<{ name: string; level: number }>;
  // Names somebody asked for (the DM, recruiting). Tried first; one that is
  // off the list or out of reach is passed over.
  wanted?: string[];
};

// The new spells a companion takes with a level: as many cantrips and
// spells as the class's tables have room for, and no more.
export function companionSpellPicks(input: CompanionSpellInput): string[] {
  const after: CasterView = { ...input.before, level: input.level };
  const granted = new Set(grantedSpellsOf(after).map(lower));
  const held = new Set(
    [
      ...after.cantrips,
      ...after.known,
      ...after.prepared,
      ...after.pending,
      ...after.spellbook,
    ].map(lower),
  );
  const top = maxSpellLevelOf(after);
  const wanted = (input.wanted ?? []).map(lower);
  const open = input.candidates.filter(
    (spell) => !held.has(lower(spell.name)) && !granted.has(lower(spell.name)),
  );
  // What was asked for leads, in the order it was asked.
  const ordered = [
    ...wanted.flatMap((name) => open.filter((spell) => lower(spell.name) === name)),
    ...byPreference(open.filter((spell) => !wanted.includes(lower(spell.name)))),
  ];

  const cantripCap = cantripCapOf(after);
  const cantripRoom =
    cantripCap === null
      ? 0
      : Math.max(0, cantripCap + input.freeCantrips - dedupeNames(after.cantrips).length);
  const cantrips = ordered.filter((spell) => spell.level === 0).slice(0, cantripRoom);

  let room = 0;
  if (top > 0) {
    if (after.style === "spellbook") {
      room = input.firstLevel
        ? Math.max(0, spellbookAllowance(input.level) - spellbookOf(after).length)
        : 2;
    } else {
      const cap = spellCapOf(after, input.abilities);
      const count =
        after.style === "known"
          ? dedupeNames(heldSpells(after)).filter((name) => !granted.has(lower(name))).length
          : preparedCount(after);
      room = cap ? Math.max(0, cap.count - count) : 0;
    }
  }
  const reachable = ordered.filter((spell) => spell.level >= 1 && spell.level <= top);
  const asked = reachable.filter((spell) => wanted.includes(lower(spell.name))).slice(0, room);
  const rest = reachable.filter((spell) => !asked.includes(spell));
  const spells = [...asked];
  if (room - spells.length <= 2) {
    // A level's worth: the strongest magic the new level reaches.
    const strongest = [...rest].sort((a, b) => b.level - a.level);
    spells.push(...strongest.slice(0, Math.max(0, room - spells.length)));
  } else {
    // A whole list at once: a spell of each level in turn, so the list has
    // something for every slot.
    const byLevel = new Map<number, Array<{ name: string; level: number }>>();
    for (const spell of rest) {
      byLevel.set(spell.level, [...(byLevel.get(spell.level) ?? []), spell]);
    }
    let added = true;
    while (spells.length < room && added) {
      added = false;
      for (let level = 1; level <= top && spells.length < room; level += 1) {
        const next = byLevel.get(level)?.shift();
        if (next) {
          spells.push(next);
          added = true;
        }
      }
    }
  }
  return [...cantrips, ...spells].map((spell) => spell.name);
}
