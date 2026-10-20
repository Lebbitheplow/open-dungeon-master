// The hero page a new character lands on after its first save (backlog F23
// and F26): three things to try on a first turn, and one line that notices
// the build. Every number comes from the helpers the table itself uses: the
// Hand's cards (src/lib/battlemap/hand.ts) for the attack and the spell, the
// resource table for a limited use, computeSheetDerived for the skills, the
// spell DC and the scores. Nothing is invented: a character with no spell
// gets no spell tip, and the reveal line says only what the sheet holds.
// Pure and database-free; scripts/test-hero-tips.mjs drives it.
import { carriedWeapons, deriveHand, FRESH_TURN, SAVE_LABEL, type HandCard, type SpellFact } from "@/lib/battlemap/hand";
import type { CharacterSheet, CreateSheetInput } from "@/lib/schemas/sheet";
import { computeSheetDerived, SRD_SKILLS, formatModifier } from "@/lib/srd";
import { populateResources, resourceDef } from "@/lib/srd/class-resources";
import { ammoKindForWeapon, findAmmo } from "@/lib/srd/ammunition";
import { combatRiders } from "@/lib/srd/feature-effects";
import { weaponAttackProfile } from "@/lib/dm/attack-logic";
import { textKey } from "@/lib/language/text-logic";
import { ABILITIES, type Ability } from "@/lib/schemas/abilities";
import type { IconRef } from "@/lib/icons";

// The library row the hero page reads: the sheet as saved, with its level.
export type LibraryHero = {
  id: string;
  name: string;
  level: number;
  sheet: CreateSheetInput;
};

// One tip: the line to read, and the note beside it that explains a limited
// use ("1 use, back after a short rest"), or "" when nothing runs out.
export type HeroTip = {
  kind: "attack" | "spell" | "feature" | "skill";
  text: string;
  note: string;
  // The Hand card's own picture, or the skill's glyph.
  icon: IconRef;
};

// The saved library sheet as a fresh table sheet: full hit points, every
// slot and use in hand, nothing spent. This is the sheet the character
// sits down with, so the Hand's cards read as they will on the first turn.
// A sheet stored before a field existed comes back without it, so every
// list falls back to empty here rather than in each reader.
export function freshPlaySheet(hero: LibraryHero): CharacterSheet {
  const stored = hero.sheet;
  const sheet = {
    ...stored,
    classes: stored.classes ?? [],
    hitDicePools: stored.hitDicePools ?? null,
    equipment: stored.equipment ?? [],
    feats: stored.feats ?? [],
    features: stored.features ?? [],
    speed: stored.speed ?? 30,
    gold: stored.gold ?? 0,
    copper: stored.copper ?? 0,
    spellcasting: stored.spellcasting ?? null,
    portrait: stored.portrait ?? null,
    backstory: stored.backstory ?? "",
    proficiencies: {
      ...stored.proficiencies,
      saves: stored.proficiencies?.saves ?? [],
      skills: stored.proficiencies?.skills ?? [],
      expertise: stored.proficiencies?.expertise ?? [],
      languages: stored.proficiencies?.languages ?? [],
      tools: stored.proficiencies?.tools ?? [],
      armor: stored.proficiencies?.armor ?? [],
      weapons: stored.proficiencies?.weapons ?? [],
    },
  };
  const level = hero.level;
  const abilityMods = computeSheetDerived({ ...sheet, level }).abilityMods;
  return {
    id: hero.id,
    campaignId: "",
    userId: "",
    libraryCharacterId: hero.id,
    name: sheet.name,
    race: sheet.race,
    class: sheet.class,
    subclass: sheet.subclass,
    background: sheet.background,
    alignment: sheet.alignment,
    gender: sheet.gender,
    level,
    xp: 0,
    abilities: sheet.abilities,
    maxHp: sheet.maxHp,
    currentHp: sheet.maxHp,
    tempHp: 0,
    ac: sheet.ac,
    acOverride: sheet.acOverride ?? false,
    speed: sheet.speed,
    hitDice: sheet.hitDice,
    classes: sheet.classes,
    hitDicePools: sheet.hitDicePools,
    proficiencies: sheet.proficiencies,
    equipment: sheet.equipment,
    gold: sheet.gold,
    copper: sheet.copper,
    feats: sheet.feats,
    features: sheet.features,
    spellcasting: sheet.spellcasting,
    conditions: [],
    conditionMeta: {},
    resources: populateResources(sheet.features, level, abilityMods, {}, sheet.classes, sheet.feats),
    wildShape: null,
    pets: [],
    exhaustion: 0,
    deathSaves: null,
    concentratingOn: null,
    portrait: sheet.portrait,
    notes: "",
    backstory: sheet.backstory,
    isCompanion: false,
    companionKind: null,
    personality: "",
    createdAt: "",
    updatedAt: "",
  } as CharacterSheet;
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

function restLine(recharge: "short" | "long"): string {
  return recharge === "short" ? "back after a short rest" : "back after a long rest";
}

function usesLine(count: number, recharge: "short" | "long"): string {
  return `${count} ${count === 1 ? "use" : "uses"}, ${restLine(recharge)}`;
}

// "1d8+3 slashing" reads as "1d8+3"; the damage type stays on the sheet.
function damageOf(card: HandCard): string {
  return card.damage ?? card.dice;
}

// The weapons carried that can be used now: a bow with nothing to shoot is
// carried but not ready, as the Hand's own ammunition check reads it.
function readyWeapons(sheet: CharacterSheet): Set<string> {
  const ready = new Set<string>();
  for (const weapon of carriedWeapons(sheet)) {
    const ammoKind = ammoKindForWeapon(weapon.srd.name);
    if (ammoKind && !findAmmo(sheet.equipment, ammoKind)) continue;
    ready.add(textKey(weapon.name));
  }
  return ready;
}

// The strongest weapon the character carries: the best chance to hit, then
// the biggest die. An off-hand swing and a bare fist are left out, unless
// the fist is all there is (a monk's Martial Arts is a card like any other),
// and so is a bow with nothing to shoot.
function bestAttack(cards: HandCard[], sheet: CharacterSheet): HandCard | null {
  const swings = cards.filter(
    (card) => card.type === "attack" && card.intent.card === "attack" && !card.intent.offHand && !card.disabled && card.toHit !== null,
  );
  const carried = new Set(carriedWeapons(sheet).map((weapon) => textKey(weapon.name)));
  const ready = readyWeapons(sheet);
  const weaponOf = (card: HandCard) => (card.intent.card === "attack" ? textKey(card.intent.weapon) : "");
  const armed = swings.filter((card) => ready.has(weaponOf(card)));
  const pool = armed.length ? armed : swings.filter((card) => !carried.has(weaponOf(card)));
  return [...pool].sort((a, b) => (b.toHit ?? 0) - (a.toHit ?? 0) || averageOf(b.damage) - averageOf(a.damage))[0] ?? null;
}

function averageOf(expression: string | null): number {
  if (!expression) return 0;
  let total = 0;
  for (const term of expression.replace(/\s+/g, "").split(/(?=[+-])/)) {
    const dice = /^([+-]?)(\d*)d(\d+)$/.exec(term);
    if (dice) {
      total += (dice[1] === "-" ? -1 : 1) * Number(dice[2] || 1) * ((Number(dice[3]) + 1) / 2);
    } else if (/^[+-]?\d+$/.test(term)) {
      total += Number(term);
    }
  }
  return total;
}

function attackTip(card: HandCard, sheet: CharacterSheet): HeroTip {
  const verb = card.melee ? "Swing" : "Shoot";
  // Sneak Attack is the limit worth knowing beside a swing, when the attack
  // engine says this weapon can carry it (a finesse or ranged weapon).
  const riders = combatRiders(sheet);
  const weapon = carriedWeapons(sheet).find((entry) => card.intent.card === "attack" && textKey(entry.name) === textKey(card.intent.weapon));
  const sneak =
    riders.sneakAttackDice > 0 &&
    weapon &&
    weaponAttackProfile(computeSheetDerived(sheet), sheet.proficiencies.weapons, { displayName: weapon.name, srd: weapon.srd, unarmed: false }, { riders })
      .sneakEligible;
  return {
    kind: "attack",
    text: `${verb} your ${card.name}: ${card.roll || `${formatModifier(card.toHit ?? 0)} to hit`}, ${damageOf(card)}`,
    note:
      sneak
        ? `Sneak Attack: +${riders.sneakAttackDice}d6 once a turn, when you have advantage or an ally is beside the target`
        : "",
    icon: card.icon,
  };
}

// The spell worth trying first: one cast as a bonus action leaves the
// action free, so it leads; then a levelled spell, which is what a slot is
// for; then a cantrip, which can go every turn. A spell without its facts
// (the content search not answered yet) is still named, without numbers.
function bestSpell(cards: HandCard[]): HandCard | null {
  const spells = cards.filter((card) => card.intent.card === "spell" && !card.disabled && (card.cost === "action" || card.cost === "bonus"));
  const levelOf = (card: HandCard) => (card.intent.card === "spell" ? card.intent.slotLevel ?? 0 : 0);
  const score = (card: HandCard) =>
    (card.cost === "bonus" ? 100 : 0) + (levelOf(card) > 0 ? 10 : 0) + (card.damage || card.heals ? 1 : 0);
  return [...spells].sort((a, b) => score(b) - score(a))[0] ?? null;
}

// What the spell does, in the card's own numbers: "heals 1d4+3", "+5 to
// hit, 1d10", "DEX save DC 13, 1d8", or "3d4+3, it always hits".
function spellEffect(card: HandCard): string {
  if (card.heals) return card.dice;
  if (card.save) return card.damage ? `${SAVE_LABEL[card.save.ability] ?? card.save.ability} save DC ${card.save.dc}, ${card.damage}` : card.dice;
  if (card.toHit !== null) return [`${formatModifier(card.toHit)} to hit`, card.damage].filter(Boolean).join(", ");
  return card.damage ? `${card.damage}, it always hits` : "";
}

function spellTip(card: HandCard, sheet: CharacterSheet): HeroTip {
  const slotLevel = card.intent.card === "spell" ? card.intent.slotLevel : null;
  const how = card.cost === "bonus" ? " as a bonus action" : "";
  const what = spellEffect(card);
  let note = "";
  if (slotLevel) {
    const casting = sheet.spellcasting;
    const pact = casting?.pact && casting.pact.level === slotLevel && !casting.slots[String(slotLevel)];
    const count = pact ? casting!.pact!.max : casting?.slots[String(slotLevel)]?.max ?? 0;
    const kind = pact ? "pact slot" : `${ORDINAL[slotLevel] ?? `level ${slotLevel}`}-level slot`;
    note = `Uses a ${kind}: you have ${count}, ${restLine(pact ? "short" : "long")}`;
  } else if (slotLevel === null) {
    note = "A cantrip: no slot, cast it as often as you like";
  }
  return { kind: "spell", text: `Cast ${card.name}${how}${what ? `: ${what}` : ""}`, note, icon: card.icon };
}

// A limited-use feature from the resource table (Second Wind, Rage, Bardic
// Inspiration), with its count and when it comes back.
function bestFeature(cards: HandCard[], sheet: CharacterSheet): { card: HandCard; uses: number; recharge: "short" | "long" } | null {
  for (const card of cards) {
    if (card.intent.card !== "feature" || card.disabled) continue;
    const def = resourceDef(card.intent.resourceId);
    const state = sheet.resources[card.intent.resourceId];
    if (!def || !state || state.max <= 0) continue;
    return { card, uses: state.max, recharge: def.recharge };
  }
  return null;
}

function featureTip(found: { card: HandCard; uses: number; recharge: "short" | "long" }): HeroTip {
  const { card } = found;
  const how = card.cost === "bonus" ? " as a bonus action" : card.cost === "reaction" ? " as a reaction" : "";
  const what = card.dice ? `: ${card.dice}` : "";
  return { kind: "feature", text: `Use ${card.name}${how}${what}`, note: usesLine(found.uses, found.recharge), icon: card.icon };
}

// What each skill is for at the table, in a few words.
type SkillId =
  | "acrobatics" | "animal_handling" | "arcana" | "athletics" | "deception" | "history" | "insight" | "intimidation" | "investigation"
  | "medicine" | "nature" | "perception" | "performance" | "persuasion" | "religion" | "sleight_of_hand" | "stealth" | "survival";

const SKILL_USES: Record<SkillId, string> = {
  acrobatics: "tumble past a guard or keep your feet",
  animal_handling: "calm a frightened animal",
  arcana: "recall what you know of magic",
  athletics: "climb, jump or shove a foe",
  deception: "bluff your way past a guard",
  history: "recall the past of a place",
  insight: "tell when someone is lying",
  intimidation: "make a foe back down",
  investigation: "search a room for clues",
  medicine: "steady a dying friend",
  nature: "recall the lore of the wild",
  perception: "spot the ambush first",
  performance: "hold a crowd",
  persuasion: "talk your way in",
  religion: "recall the lore of the gods",
  sleight_of_hand: "lift a key unseen",
  stealth: "sneak ahead",
  survival: "track your quarry",
};

// The trained skills, best first; the SRD's order breaks a tie.
function bestSkills(sheet: CharacterSheet): Array<{ id: string; name: string; bonus: number }> {
  const derived = computeSheetDerived(sheet);
  const trained = new Set([...sheet.proficiencies.skills, ...(sheet.proficiencies.expertise ?? [])]);
  return SRD_SKILLS.filter((skill) => trained.has(skill.id))
    .map((skill) => ({ id: skill.id, name: skill.name, bonus: derived.skills[skill.id] ?? 0 }))
    .sort((a, b) => b.bonus - a.bonus);
}

function skillTip(skill: { id: string; name: string; bonus: number }): HeroTip {
  const use = SKILL_USES[skill.id as SkillId] as string | undefined;
  return {
    kind: "skill",
    text: `You're good at ${skill.name} (${formatModifier(skill.bonus)})${use ? `: ${use}` : ""}`,
    note: "",
    icon: { kind: "glyph", key: `skill-${skill.id.replace(/_/g, "-")}` },
  };
}

// Three things to try on a first turn, from what the character can really
// do: the best weapon, a spell, a limited-use feature, and the best trained
// skill, in that order, the first three that exist. A character with fewer
// fills the rest from its next-best skills.
export function threeThingsToTry(sheet: CharacterSheet, spells: Record<string, SpellFact> = {}): HeroTip[] {
  const cards = deriveHand(sheet, FRESH_TURN, { spells });
  const tips: HeroTip[] = [];
  const attack = bestAttack(cards, sheet);
  const spell = bestSpell(cards);
  const feature = bestFeature(cards, sheet);
  const skills = bestSkills(sheet);
  // A caster whose cantrip out-hits the weapon they carry leads with the spell.
  if (spell && attack && sheet.spellcasting && (computeSheetDerived(sheet).spellAttack ?? -99) > (attack.toHit ?? 0)) {
    tips.push(spellTip(spell, sheet), attackTip(attack, sheet));
  } else {
    if (attack) tips.push(attackTip(attack, sheet));
    if (spell) tips.push(spellTip(spell, sheet));
  }
  if (feature && tips.length < 3) tips.push(featureTip(feature));
  for (const skill of skills) {
    if (tips.length >= 3) break;
    tips.push(skillTip(skill));
  }
  return tips;
}

const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

const ABILITY_LINES: Record<Ability, string> = {
  str: "the strongest arm in the room",
  dex: "quick hands and quicker feet",
  con: "hard to put down",
  int: "a mind like a trap",
  wis: "sees what others miss",
  cha: "a voice people follow",
};

const CASTER_LINES: Record<"int" | "wis" | "cha", string> = {
  int: "the sharpest mind at the table",
  wis: "the steadiest will at the table",
  cha: "the boldest voice at the table",
};

// One line that notices the build (F26). Three rules, tried in order, each
// true of the sheet as saved:
//   1. AC 18 or more: "AC 19 at level 1, the party's wall".
//   2. A caster whose spell DC is 13 or more: "Spell DC 15, ...", worded by
//      the casting ability.
//   3. Otherwise the highest score, the SRD's order breaking a tie:
//      "Dexterity 17, quick hands and quicker feet".
export function revealLine(sheet: CharacterSheet): string {
  if (sheet.ac >= 18) {
    return `AC ${sheet.ac} at level ${sheet.level}, the party's wall`;
  }
  const derived = computeSheetDerived(sheet);
  const casting = sheet.spellcasting;
  if (casting && derived.spellSaveDc !== null && derived.spellSaveDc >= 13) {
    return `Spell DC ${derived.spellSaveDc}, ${CASTER_LINES[casting.ability]}`;
  }
  let top: Ability = "str";
  for (const ability of ABILITIES) {
    if (sheet.abilities[ability] > sheet.abilities[top]) top = ability;
  }
  return `${ABILITY_NAMES[top]} ${sheet.abilities[top]}, ${ABILITY_LINES[top]}`;
}

// Where the builder sends a character after its first save: the hero page,
// unless the player asked never to see it again. Edits never come through
// here; they return to the sheet they edited.
export function afterFirstSave(characterId: string, skipHeroPage: boolean): string {
  return skipHeroPage ? "/characters" : `/characters/${encodeURIComponent(characterId)}/ready`;
}
