// Spell and class-feature cards for the Hand (docs/visual-overhaul-plan.md
// 5.2): what a prepared spell or a limited-use feature costs, rolls and
// spends, read from the same tables the cast and use_resource tools read.
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { computeSheetDerived, spellAttackFor, spellSaveDcFor } from "@/lib/srd";
import { RAGING, resourceDef, resourceLevel, type ResourceDef } from "@/lib/srd/class-resources";
import type { CombatRiders } from "@/lib/srd/feature-effects";
import { authoredSpellRow, parseSpellMech, spellMechFor, type SpellMech } from "@/lib/srd/spell-mechanics";
import { baseHealingDice, scaledSpellDice } from "@/lib/srd/spell-scaling";
import {
  SAVE_LABEL,
  addFlat,
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
    ...casting.prepared,
    ...casting.known,
    ...(casting.casters ?? []).flatMap((caster) => [...caster.prepared, ...caster.known]),
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
  const mech: SpellMech = spellMechFor([name]) ?? parseSpellMech({ desc: fact.desc, higherLevel: fact.higherLevel }) ?? { resolution: "utility" };
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
  let damage: string | null = mech.resolution === "heal" || mech.resolution === "buff" ? null : scaled?.dice ?? null;
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
      : typed || (mech.buff ? mech.buff.condition : "");
  const roll =
    toHit !== null ? `${signed(toHit)} to hit` : save ? (typed ? `DC ${save.dc}${mech.halfOnSave ? ", half on a save" : ""}` : "no attack") : "no roll";
  const notes: string[] = [];
  if (fact.concentration && sheet.concentratingOn && spellKey(sheet.concentratingOn) !== spellKey(name)) {
    notes.push(`Ends your concentration on ${sheet.concentratingOn}.`);
  }
  if (mech.note) notes.push(mech.note);
  if (slot && slot.level > fact.level) notes.push(`Cast with a level ${slot.level} slot.`);
  const raging = sheet.conditions.some((entry) => entry.toLowerCase() === RAGING);
  const form: Gate = sheet.wildShape
    ? { reason: `No spellcasting in ${sheet.wildShape.form} form.`, spent: false }
    : raging
      ? { reason: "No spellcasting while raging.", spent: false }
      : null;
  const slotGate: Gate =
    fact.level > 0 && !slot ? { reason: `No spell slot of level ${fact.level} or higher left.`, spent: true } : null;
  // A levelled spell on one action leaves only an action cantrip for the other.
  const other = turn.leveledSpell ?? null;
  const pairGate: Gate =
    other && fact.level > 0 && other !== cost && cost !== "reaction"
      ? { reason: "You already cast a levelled spell this turn; only a cantrip may follow it.", spent: false }
      : other === "bonus" && cost === "action" && fact.level > 0
        ? { reason: "After a bonus action spell, only a cantrip may be cast with your action.", spent: false }
        : null;
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
    melee: false,
    disabled: null,
    spent: false,
    compose: false,
    intent: { card: "spell", spell: name, slotLevel: slot?.level ?? null },
  };
  return gated(card, standingGate(sheet, turn), form, costGate(cost, turn, sheet), slotGate, pairGate);
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
    if (!def || def.passive || id === "sub_superiority_dice" || def.effect.kind === "recover_slots") continue;
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
      damage = effect.dice(level);
      save = { ability: SAVE_LABEL[effect.save] ?? effect.save, dc: 0 };
      dice = `${damage}, ${save.ability} save`;
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
      damageType: heals ? "healing" : "",
      heals,
      // A feature's DC is the engine's to compute at spend time, so the card
      // names the save and carries 0 for "not shown".
      save,
      melee: false,
      disabled: null,
      spent: false,
      compose,
      intent: { card: "feature", resourceId: id },
    };
    cards.push(
      gated(
        card,
        standingGate(sheet, turn),
        left > 0 ? null : { reason: `${def.displayName} is spent until a ${def.recharge} rest.`, spent: true },
        costGate(cost, turn, sheet),
      ),
    );
  }
  return cards;
}

