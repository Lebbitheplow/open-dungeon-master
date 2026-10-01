// Spell and class-feature cards for the Hand (docs/visual-overhaul-plan.md
// 5.2): what a prepared spell or a limited-use feature costs, rolls and
// spends, read from the same tables the cast and use_resource tools read.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { casterStateProblem, componentProblem, materialPlan, slotPlan, turnCharge } from "@/lib/dm/cast-rules";
import { computeSheetDerived, spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { resourceDef, resourceLevel, type ResourceDef } from "@/lib/srd/class-resources";
import { isMeleeSpellAttack } from "@/lib/srd/melee-spell";
import { bundledSpellFacts } from "@/lib/srd/spell-facts";
import { aoeSpendFor } from "@/lib/srd/aoe-spend";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { authoredSpellRow, parseSpellMech, spellMechFor, type SpellMech } from "@/lib/srd/spell-mechanics";
import { baseHealingDice, scaledSpellDice } from "@/lib/srd/spell-scaling";
import { mechSpellDamage } from "@/lib/srd/spell-dice";
import { allSpellNames } from "@/lib/srd/spell-lists";
import { areaFor } from "@/lib/battlemap/hand-area";
import {
  SAVE_LABEL,
  addFlat,
  budgetOf,
  costGate,
  feet,
  gated,
  lowestSlot,
  primaryClass,
  signed,
  slotLine,
  spellKey,
  standingGate,
  type Gate,
  type HandCard,
  type HandChoice,
  type HandCardType,
  type HandCost,
  type HandOptions,
  type HandTarget,
  type HandTurn,
  type SpellFact,
} from "@/lib/battlemap/hand-core";

// ---- spells ----

export function spellNames(sheet: CharacterSheet): string[] {
  const casting = sheet.spellcasting;
  if (!casting) return [];
  const all = [
    ...allSpellNames(casting),
    ...(casting.casters ?? []).flatMap((caster) => allSpellNames(caster)),
  ];
  const seen = new Set<string>();
  return all.filter((name) => {
    const key = spellKey(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function factFor(name: string, options: HandOptions): SpellFact | null {
  const fetched = options.spells?.[spellKey(name)];
  if (fetched) return fetched;
  const row = authoredSpellRow(name);
  if (!row) return null;
  return {
    level: row.level,
    school: "",
    castingTime: "1 action",
    range: "",
    desc: row.desc,
    higherLevel: row.higher_level ?? "",
    concentration: Boolean(row.concentration),
  };
}

const title = (word: string) => word.replace(/^./, (c) => c.toUpperCase());

// Bestow Curse's nine curses, in the words a player picks from.
const CURSE_LABELS: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
  attacks: "Its attacks on you",
  will: "Its will",
  necrotic: "Necrotic wounds",
};

// The one pick a spell's row asks the caster to make, as the engine names it
// (src/lib/srd/spell-mech-types.ts): a condition's variants (Blindness/
// Deafness, Eyebite, Bestow Curse), a word's choices (Command), Heat Metal
// on worn armor, the condition a restoration ends, a buff's form
// (Enlarge/Reduce). The value is what cast_at_enemy's `condition` or
// cast_buff's `variant` reads (src/lib/dm/spell-riders.ts chosenCondition).
export function spellChoice(mech: SpellMech): HandChoice | undefined {
  const condition = mech.condition;
  if (condition?.variants && condition.variants.length > 1) {
    return {
      arg: "condition",
      label: "Choose",
      options: condition.variants.map((variant) => {
        const inner = /\(([^)]+)\)$/.exec(variant)?.[1];
        return inner
          ? { value: inner, label: CURSE_LABELS[inner] ?? title(inner) }
          : { value: variant, label: title(variant) };
      }),
    };
  }
  if (condition?.choices && Object.keys(condition.choices).length) {
    return {
      arg: "condition",
      label: "The word",
      options: Object.entries(condition.choices).map(([word, adds]) => ({ value: word, label: title(word), note: adds.join(", ") })),
    };
  }
  if (mech.riders?.gripSave) {
    return {
      arg: "condition",
      label: "The metal",
      options: [
        { value: "", label: "A held object" },
        { value: "armor", label: "Worn armor" },
      ],
      fallback: "",
    };
  }
  if (mech.cures && !mech.cures.all && mech.cures.conditions.length > 1) {
    return {
      arg: "variant",
      label: "Ends",
      options: mech.cures.conditions.map((entry) => ({ value: entry, label: entry === "cursed" ? "A curse" : title(entry) })),
    };
  }
  if (mech.buff?.variants && mech.buff.variants.length > 1) {
    return { arg: "variant", label: "Choose", options: mech.buff.variants.map((variant) => ({ value: variant, label: title(variant) })) };
  }
  return undefined;
}

function castingCost(castingTime: string): HandCost | null {
  const text = castingTime.toLowerCase();
  if (text.includes("bonus")) return "bonus";
  if (text.includes("reaction")) return "reaction";
  // Minutes and hours do not fit in a turn, so the spell stays off the hand.
  return /^1 action\b/.test(text.trim()) || text.trim() === "" ? "action" : null;
}

function spellCard(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, name: string, fact: SpellFact): HandCard | null {
  const cost = castingCost(fact.castingTime);
  if (!cost) return null;
  // The mechanics row the engine reads; the prose is parsed only for what the
  // card shows when no row exists (its target, its save).
  const row = spellMechFor([name]);
  const mech: SpellMech = row ?? parseSpellMech({ desc: fact.desc, higherLevel: fact.higherLevel }) ?? { resolution: "utility" };
  const slot = fact.level > 0 ? lowestSlot(sheet, fact.level) : null;
  const derived = computeSheetDerived(sheet);
  const abilityMod = sheet.spellcasting ? derived.abilityMods[sheet.spellcasting.ability] : 0;
  const scaled = scaledSpellDice({
    spellLevel: fact.level,
    desc: fact.desc,
    higherLevel: fact.higherLevel,
    casterLevel: sheet.level,
    slotLevel: slot?.level,
  });
  // The dice the engine rolls (spellDamageFor reads the same rule): Web,
  // Entangle and Hypnotic Pattern deal none whatever their prose mentions.
  const rolled = mechSpellDamage({
    spell: name,
    mech: row,
    spellLevel: fact.level,
    casterLevel: sheet.level,
    slotLevel: slot?.level,
    desc: fact.desc,
    higherLevel: fact.higherLevel,
  });
  let damage: string | null = mech.resolution === "heal" || mech.resolution === "buff" ? null : rolled?.dice ?? null;
  let heals = false;
  if (mech.resolution === "heal") {
    // upcastDamage reads a healing step too, so a higher slot heals more.
    const healing = scaled?.dice ?? baseHealingDice(fact.desc);
    heals = true;
    damage = healing ? addFlat(healing, /spellcasting ability modifier|spellcasting modifier/i.test(fact.desc) ? abilityMod : 0) : null;
  }
  // Agonizing Blast and its kin ride one named cantrip.
  const rider = riders.cantripAbilityRiders.find((entry) => spellKey(entry.spell) === spellKey(name));
  if (rider && damage) {
    damage = addFlat(damage, derived.abilityMods[rider.ability as keyof typeof derived.abilityMods] ?? 0);
  }
  const toHit = mech.resolution === "attack" ? spellAttackFor(sheet, name) : null;
  // The engine's own facts (casting time, components, material cost, range)
  // for the engine's own gates below.
  const facts = bundledSpellFacts(name);
  const dc = mech.resolution === "save" && mech.save ? spellSaveDcFor(sheet, name) : null;
  const save = dc !== null && mech.save ? { ability: SAVE_LABEL[mech.save] ?? mech.save.toUpperCase(), dc } : null;
  const type: HandCardType =
    mech.resolution === "heal" ? "mend" : mech.resolution === "buff" ? "ward" : mech.condition ? "control" : "spell";
  const target: HandTarget =
    mech.resolution === "heal"
      ? "ally"
      : mech.resolution === "buff"
        ? mech.buff?.target === "self" ? "self" : "ally"
        : mech.resolution === "attack" || mech.resolution === "save" || mech.resolution === "auto"
          ? "enemy"
          : "none";
  const typed = damage ? `${damage}${mech.damageType ? ` ${mech.damageType}` : ""}` : "";
  const dice = heals
    ? damage ? `heals ${damage}` : "heals"
    : save
      ? typed ? `${typed}, ${save.ability} save` : `${save.ability} save DC ${save.dc}`
      : typed ||
        (mech.buff
          ? // A buff with an aura that hurts (Spirit Guardians) names the
            // engine's dice beside it; the card itself aims at no enemy.
            `${mech.buff.condition}${mech.resolution === "buff" && rolled ? `, ${rolled.dice}${mech.damageType ? ` ${mech.damageType}` : ""}` : ""}`
          : "");
  const roll =
    toHit !== null ? `${signed(toHit)} to hit` : save ? (typed ? `DC ${save.dc}${mech.halfOnSave ? ", half on a save" : ""}` : "no attack") : "no roll";
  const notes: string[] = [];
  if (fact.concentration && sheet.concentratingOn && spellKey(sheet.concentratingOn) !== spellKey(name)) {
    notes.push(`Ends your concentration on ${sheet.concentratingOn}.`);
  }
  if (mech.note) notes.push(mech.note);
  if (slot && slot.level > fact.level) notes.push(`Cast with a level ${slot.level} slot.`);
  // Every refusal below is the cast guard's own (src/lib/dm/cast-rules.ts),
  // asked of the same sheet: raging, a beast form without Beast Spells,
  // untrained armor, a verbal component while silenced, no free hand, a
  // costly material neither carried nor affordable, no slot, and the
  // bonus-action spell rule.
  const problem = (text: string | null, spent = false): Gate => (text ? { reason: text, spent } : null);
  const material = materialPlan(sheet, facts);
  const slotRefusal = fact.level > 0 && !slot ? slotPlan(sheet, name, facts, fact.level) : null;
  const charge = turnCharge({
    who: sheet.name,
    facts,
    spell: name,
    slotLevel: slot?.level ?? null,
    inFight: true,
    budget: turn.myTurn ? budgetOf(turn, sheet) : null,
    reactionSpent: turn.reactionUsed,
  });
  const melee = mech.resolution === "attack" && isMeleeSpellAttack(name, facts?.range.kind);
  if (melee) notes.unshift("Melee spell attack: a creature beside you.");
  const card: HandCard = {
    id: `spell:${spellKey(name)}`,
    type,
    name,
    cost,
    range: feet(fact.range),
    dice,
    roll,
    rules: notes.slice(0, 2).join(" "),
    resource: fact.level === 0 ? "Cantrip" : slot ? slotLine(slot) : `Level ${fact.level} · no slots`,
    condition: mech.condition?.name ?? (fact.concentration ? "Concentration" : ""),
    icon: { kind: "spell", key: name, family: fact.school ? `spell-${fact.school.toLowerCase()}` : null },
    target,
    toHit,
    damage,
    damageType: heals ? "healing" : mech.damageType ?? "",
    heals,
    save,
    // A touch spell is a melee spell attack with touch reach (the engine's
    // isMeleeSpellAttack): it previews and aims like a swing.
    melee,
    ...(melee ? { range: "Touch" } : {}),
    disabled: null,
    spent: false,
    compose: false,
    // A reaction spell (Shield, Hellish Rebuke) is played as a reaction:
    // use_reaction resolves it, off the caster's turn too.
    intent:
      cost === "reaction"
        ? { card: "reaction", feature: name, spell: name, slotLevel: slot?.level ?? null }
        : { card: "spell", spell: name, slotLevel: slot?.level ?? null },
  };
  const choice = cost === "reaction" ? undefined : spellChoice(mech);
  if (choice) card.choice = choice;
  // Web, Moonbeam, a wall: the square it is laid on is picked on the board.
  const area = cost === "reaction" ? null : areaFor(name, slot?.level ?? (fact.level || null));
  if (area) card.area = area;
  return gated(
    card,
    standingGate(sheet, turn, cost === "reaction" ? "reaction" : "cast"),
    problem(casterStateProblem(sheet)),
    problem(componentProblem(sheet, facts)),
    // A reaction spell needs a reaction to spend (slowed takes it away).
    cost === "reaction" ? costGate("reaction", turn, sheet, name) : null,
    "error" in material ? { reason: material.error, spent: false } : null,
    slotRefusal && "error" in slotRefusal ? { reason: slotRefusal.error, spent: true } : null,
    "error" in charge ? { reason: charge.error, spent: charge.error.includes("already used") } : null,
  );
}

export function spellCards(sheet: CharacterSheet, turn: HandTurn, riders: CombatRiders, options: HandOptions): HandCard[] {
  const rows: Array<{ level: number; card: HandCard }> = [];
  for (const name of spellNames(sheet)) {
    const fact = factFor(name, options);
    if (!fact) continue;
    const card = spellCard(sheet, turn, riders, name, fact);
    if (card) rows.push({ level: fact.level, card });
  }
  // Attacks first inside a level, so the cantrip that hurts leads the hand.
  const weight = (card: HandCard) => (card.target === "enemy" ? 0 : card.heals ? 1 : 2);
  rows.sort((a, b) => a.level - b.level || weight(a.card) - weight(b.card) || a.card.name.localeCompare(b.card.name));
  return rows.map((row) => row.card);
}

// ---- class features and resources ----

// What the feature costs to use. The resource table does not carry it, so
// the SRD staples are named and the rest is read out of the guidance line.
const FEATURE_COST: Record<string, HandCost> = {
  rage: "bonus",
  second_wind: "bonus",
  bardic_inspiration: "bonus",
  action_surge: "free",
  ki: "free",
  sorcery_points: "free",
};

function featureCost(def: ResourceDef): HandCost {
  const named = FEATURE_COST[def.id];
  if (named) return named;
  if (/bonus action/i.test(def.guidance)) return "bonus";
  if (/\breaction\b/i.test(def.guidance)) return "reaction";
  return "action";
}

export function featureCards(sheet: CharacterSheet, turn: HandTurn): HandCard[] {
  const derived = computeSheetDerived(sheet);
  const cards: HandCard[] = [];
  for (const [id, state] of Object.entries(sheet.resources)) {
    const def = resourceDef(id);
    // Superiority dice ride attacks (riderCards); recoveries belong to a rest.
    // Ki is spent through its techniques, each a card of its own (hand-class.ts
    // Flurry of Blows, and the bonus-action moves in hand.ts).
    if (!def || def.passive || id === "sub_superiority_dice" || id === "ki" || def.effect.kind === "recover_slots") continue;
    const level = resourceLevel(def, sheet);
    const effect = def.effect;
    const left = state.max - state.used;
    const cost = featureCost(def);
    let type: HandCardType = "feature";
    let dice = "";
    let damage: string | null = null;
    let target: HandTarget = "none";
    let heals = false;
    let save: HandCard["save"] = null;
    let compose = false;
    let condition = "";
    let damageType = "";
    if (effect.kind === "heal_self" || effect.kind === "heal_target") {
      damage = effect.dice(level, derived.abilityMods);
      dice = `heals ${damage}`;
      type = "mend";
      heals = true;
      target = effect.kind === "heal_self" ? "self" : "ally";
    } else if (effect.kind === "heal_pool" || effect.kind === "heal_dice_pool") {
      dice = effect.kind === "heal_pool" ? `heals up to ${left}` : `heals ${effect.die} a die`;
      type = "mend";
      heals = true;
      target = "ally";
      // How much of the pool to spend is the player's call, so they finish the line.
      compose = true;
    } else if (effect.kind === "temp_hp") {
      damage = effect.dice(level, derived.abilityMods);
      dice = `${damage} temp hp`;
      type = "ward";
      target = "self";
    } else if (effect.kind === "condition" || effect.kind === "buff") {
      dice = effect.condition;
      condition = effect.condition;
      type = "ward";
      target = effect.kind === "buff" && effect.target === "ally" ? "ally" : "self";
    } else if (effect.kind === "inspire") {
      dice = `+1${effect.die(level)} to a roll`;
      type = "ward";
      target = "ally";
    } else if (effect.kind === "aoe") {
      // A dragonborn's breath takes its ancestry's save and damage type.
      const spend = aoeSpendFor(def, sheet, level, derived)!;
      damage = spend.dice;
      damageType = spend.damageType ?? "";
      save = { ability: SAVE_LABEL[spend.saveAbility] ?? spend.saveAbility, dc: 0 };
      dice = `${damage}${damageType ? ` ${damageType}` : ""}, ${save.ability} save`;
      type = "spell";
      target = "enemy";
    } else if (effect.kind === "enemy_save") {
      damage = effect.dice ? effect.dice(level, derived.abilityMods) : null;
      save = { ability: SAVE_LABEL[effect.save] ?? effect.save, dc: 0 };
      dice = damage ? `${damage}, ${save.ability} save` : `${save.ability} save`;
      condition = effect.condition ?? "";
      type = condition ? "control" : "spell";
      target = "enemy";
    } else if (effect.kind === "teleport") {
      dice = `${effect.feet} ft`;
    }
    const card: HandCard = {
      id: `feature:${id}`,
      type,
      name: def.displayName,
      cost,
      range: target === "self" || target === "none" ? "Self" : "",
      dice,
      roll: save ? "no attack" : "no roll",
      rules: def.guidance.split(". ")[0].replace(/\.?$/, "."),
      resource: `Uses ${left}/${state.max}`,
      condition,
      icon: { kind: "feature", key: def.displayName, family: `class-${primaryClass(sheet)}` },
      target,
      toHit: null,
      damage,
      damageType: heals ? "healing" : damageType,
      heals,
      // A feature's DC is the engine's to compute at spend time, so the card
      // names the save and carries 0 for "not shown".
      save,
      melee: false,
      disabled: null,
      spent: false,
      compose,
      intent:
        cost === "reaction"
          ? { card: "reaction", feature: def.displayName }
          : { card: "feature", resourceId: id },
    };
    cards.push(
      gated(
        card,
        standingGate(sheet, turn, cost === "reaction" ? "reaction" : cost === "bonus" ? "bonus" : cost === "free" ? "free" : "action"),
        left > 0 ? null : { reason: `${def.displayName} is spent until a ${def.recharge} rest.`, spent: true },
        costGate(cost, turn, sheet, def.displayName),
      ),
    );
  }
  return cards;
}

