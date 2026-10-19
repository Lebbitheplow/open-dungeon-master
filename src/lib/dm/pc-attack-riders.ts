// What rides a player's attack and is paid for by it: a Battle Master's
// maneuver and a paladin's smite, both spent when the hit is known, and the
// conditions a rider can leave on the target. Split from pc-attack.ts, which
// decides the attack these belong to.

import { CURVING_SHOT } from "@/lib/srd/authored-economy";
import { settleEnemyIncapacitation } from "@/lib/dm/enemy-incapacitation";
import { storeBudget } from "@/lib/dm/turn-budget";
import { untilTurnEnd } from "@/lib/dm/turn-end";
import type { Campaign } from "@/lib/db/campaigns";
import type { PendingAttack } from "@/lib/db/dm-turns";
import { getActiveEncounter, getEnemy, patchEnemyConditions, type EncounterEnemy } from "@/lib/db/encounters";
import { rollEnemySave } from "@/lib/dm/forced-save";
import { resourceLeft } from "@/lib/dm/attack-rules";
import type { ManeuverPick } from "@/lib/dm/pc-attack-plan";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { publishPersisted } from "@/lib/events";
import { isIncapacitated, removeConditions, type ConditionMeta } from "@/lib/dm/condition-logic";
import { sizeRank } from "@/lib/bestiary/statblock";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { applyDmMutation } from "@/lib/dm/mutations";
import { GRAPPLING_STRIKE, MANEUVERED, maneuverDieFor, maneuverUse, offSwingRefusal, type ManeuverUse } from "@/lib/dm/maneuver-rules";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { ToolError } from "@/lib/dm/tool-errors";
import { optionsOfKind } from "@/lib/srd/options";
import { textKey } from "@/lib/language/text-logic";
import type { WeaponMaterial } from "@/lib/dm/damage-logic";
import { ammoKindForWeapon } from "@/lib/srd/ammunition";

// The condition a maneuver's rider save decides, when it has one.
export const MANEUVER_RIDERS: Array<{ match: RegExp; condition: string; save: "str" | "wis" }> = [
  { match: /trip/i, condition: "prone", save: "str" },
  { match: /menacing/i, condition: "frightened", save: "wis" },
  { match: /disarm/i, condition: "disarmed", save: "str" },
  { match: /goading/i, condition: "goaded", save: "wis" },
];

// A Battle Master maneuver named on the swing: known, with a Superiority Die
// left, on a weapon attack. The pool is only looked at; the die is spent on
// the roll for Precision Attack and on the hit for every other maneuver.
export function pickManeuver(
  sheet: CharacterSheet,
  asked: string | undefined,
  weaponAttack: boolean,
): { refused: ToolError } | { maneuver: ManeuverPick | null } {
  if (!asked?.trim()) {
    return { maneuver: null };
  }
  if (!weaponAttack) {
    return { refused: { error: "Maneuvers ride weapon attacks, not spells. Ask the player whether to cast it without the maneuver.", retry: true } };
  }
  const term = asked.trim().toLowerCase();
  const picks = sheet.features
    .map((feature) => feature.name)
    .filter((name) => textKey(name).startsWith("maneuver"));
  const known = picks.some((name) => {
    const bare = textKey(name.replace(/^maneuver:\s*/i, ""));
    return bare.includes(textKey(asked)) || textKey(asked).includes(bare);
  });
  if (!known) {
    const theirs = picks.length ? ` Their maneuvers: ${picks.join(", ")}.` : " They have no maneuver picks.";
    // A maneuver the rules know that they did not pick rides an attack they
    // can still make; a name nobody knows is the call's to fix, from their
    // picks.
    return {
      refused: optionsOfKind("maneuver").some((option) => textKey(option.n) === textKey(asked.replace(/^maneuver:\s*/i, "")))
        ? { error: `${sheet.name} knows no maneuver "${asked}".${theirs} They can make the attack without it.`, retry: true }
        : { error: `No maneuver called "${asked}" is known.${theirs} Send the one meant, by the name on the sheet.`, retry: true },
    };
  }
  // A reaction, a bonus action of its own or a check is not part of a swing.
  const elsewhere = offSwingRefusal(asked);
  if (elsewhere) {
    return { refused: elsewhere };
  }
  const pool = resourceLeft(sheet, "Superiority Dice");
  if (pool === null || pool.left < 1) {
    return {
      refused:
        { error: pool === null
          ? `${sheet.name} has no Superiority Dice. They can make the attack without the maneuver.`
          : `${sheet.name} has 0/${pool.max} Superiority Dice left; ${asked.trim()} is not available until they rest. They can make the attack without it.`, retry: true },
    };
  }
  return {
    maneuver: {
      name: asked.trim(),
      die: maneuverDieFor(sheet),
      precision: /precision/i.test(term),
      rider: MANEUVER_RIDERS.find((entry) => entry.match.test(term)) ?? null,
      use: maneuverUse(term),
    },
  };
}


// What a hit spends, decided before the roll and paid after it: the smite
// slot and the Superiority Die of an on-hit maneuver. Carried on a parked
// physical-dice attack too, so the player's own d20 decides the spend.
export type OnHitSpends = {
  characterId: string;
  smite?: { slot: number; dice: number; undeadOrFiend: boolean };
  // `use` and `targetId`: Grappling Strike's die waits for the grapple, and
  // Maneuvering Attack's hit opens an ally's move (maneuver-rules.ts).
  maneuver?: { name: string; die: string; use?: ManeuverUse; targetId?: string };
  // Stunning Strike: 1 ki on the hit, then the target's CON save at this DC.
  stun?: { dc: number };
  // The damage before any on-hit dice, and what a critical adds to it.
  baseDamage: string;
  critExtraDice: number;
};

// `nonlethal`: a knockout blow, carried to the damage stage
// (src/lib/dm/enemy-damage.ts applyPendingDamageRoll).
// `hitSpent`: the attacker's conditions the hit uses up (the smites);
// `spell`: an attack spell whose rider lands on the hit.
export type ParkedAttack = PendingAttack & {
  // The wielded item's material (damage-logic.ts weaponMaterial).
  material?: WeaponMaterial;
  onHit?: OnHitSpends;
  nonlethal?: boolean;
  hitSpent?: string[];
  // The once-per-turn riders the hit spends (Sneak Attack): pc-attack-damage.ts claimHitRiders.
  hitClaims?: string[];
  spell?: string;
  // A melee attack, which a monster's Parry answers (enemy-reactions.ts).
  melee?: boolean;
  // A magic weapon's dice on a natural 20 (src/lib/dm/gear-attack.ts).
  critGear?: { suffix: string; typed: Array<{ dice: string; type: string }>; notes: string[] };
  // What rides the roll and the hit beyond the damage
  // (src/lib/dm/attack-features.ts, attack-onhit.ts).
  extras?: {
    foeSlayer?: number;
    strokeOfLuck?: boolean;
    openHand?: { choice: "prone" | "push" | "no reactions"; dc: number };
    hurl?: boolean;
    poison?: boolean;
    tempHp?: { amount: number; feature: string };
  };
};

// Pays for what the hit carries and returns the dice it bought. A spend the
// sheet can no longer afford (the slot went elsewhere while the roll was
// parked) buys nothing and says so.
export function spendOnHit(
  campaign: Campaign,
  turnId: string,
  spends: OnHitSpends,
  sheets: CharacterSheet[],
  sheetsById: Map<string, CharacterSheet>,
): { suffix: string; notes: string[]; stunPaid: boolean } {
  let suffix = "";
  const notes: string[] = [];
  let stunPaid = false;
  if (spends.stun) {
    const spent = applyDmMutation(
      campaign,
      turnId,
      "use_resource",
      JSON.stringify({ characterId: spends.characterId, resource: "Ki", reason: "Stunning Strike" }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      notes.push("Stunning Strike: no ki point left, so the hit lands without it");
    } else {
      stunPaid = true;
    }
  }
  if (spends.maneuver?.use === "grapple") {
    // The die rides the grapple's Athletics check, which is the bonus
    // action that may follow this hit (take_action grapple, bonus).
    markAttacker(campaign, spends.characterId, `${GRAPPLING_STRIKE} (1${spends.maneuver.die})`, spends.maneuver.targetId);
    notes.push(
      `${spends.maneuver.name}: they may now try to grapple the target as a bonus action (take_action grapple with bonus true); the Superiority Die is spent on that Athletics check and added to it`,
    );
  } else if (spends.maneuver) {
    const spent = applyDmMutation(
      campaign,
      turnId,
      "use_resource",
      JSON.stringify({
        characterId: spends.characterId,
        resource: "Superiority Dice",
        reason: spends.maneuver.name,
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      notes.push(`${spends.maneuver.name}: no Superiority Die left, so the hit lands without it`);
    } else {
      suffix += `+1${spends.maneuver.die}`;
      if (spends.maneuver.use === "ally_move") {
        markAttacker(campaign, spends.characterId, MANEUVERED, spends.maneuver.targetId);
        notes.push(
          `${spends.maneuver.name}: an ally who can see or hear them may use its reaction to move up to half its speed without drawing an opportunity attack from the target (use_reaction for that ally, feature "Maneuvering Attack", with x and y)`,
        );
      }
    }
  }
  if (spends.smite) {
    const spent = applyDmMutation(
      campaign,
      turnId,
      "use_spell_slot",
      JSON.stringify({
        characterId: spends.characterId,
        level: spends.smite.slot,
        reason: "Divine Smite",
      }),
      sheets,
      sheetsById,
    ).result;
    if ("error" in spent) {
      notes.push(`Divine Smite: no level ${spends.smite.slot} slot left, so the hit lands without it`);
    } else {
      suffix += `+${spends.smite.dice}d8`;
    }
  }
  return { suffix, notes, stunPaid };
}

// A mark a maneuver's hit leaves on the attacker for the rest of this turn
// (turnBegun: the turn it ends with is the one under way), naming the
// creature it was against.
function markAttacker(campaign: Campaign, characterId: string, condition: string, targetId: string | undefined) {
  const sheet = getSheetById(characterId);
  if (!sheet) {
    return;
  }
  const held = sheet.conditions.filter((entry) => entry.toLowerCase().split(" (")[0] !== condition.split(" (")[0]);
  const updated = patchSheet(sheet.id, {
    conditions: [...held, condition],
    conditionMeta: { ...sheet.conditionMeta, [condition]: untilTurnEnd(characterId, { turnBegun: true, ...(targetId ? { source: targetId } : {}) }) },
  });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// An Arcane Archer's arrow missed: Curving Shot may reroll it at another
// creature with the bonus action, this turn (authored-economy.ts).
export function openCurvingShot(campaignId: string, sheet: CharacterSheet, enemyId: string, base: string | undefined): string | null {
  const holds = sheet.features.some((feature) => textKey(feature.name) === "curving shot");
  // A bow is a weapon that fires arrows (src/lib/srd/ammunition.ts).
  if (!holds || ammoKindForWeapon(base) !== "arrows") {
    return null;
  }
  const encounter = getActiveEncounter(campaignId);
  const budget = encounter?.turnBudget;
  if (!encounter || !budget || budget.ownerId !== sheet.id || budget.bonusUsed) {
    return null;
  }
  storeBudget(encounter, { ...budget, oncePerTurn: [...budget.oncePerTurn.filter((key) => !key.startsWith(CURVING_SHOT)), `${CURVING_SHOT}${enemyId}`] });
  return "Curving Shot: the bonus action may reroll this arrow at a different creature within 60 feet of this one (pc_attack bonusAttack \"feature\" at it)";
}

// Temporary hit points a hit gives the attacker (Hungry Jaws): they do not
// stack, so the better of the two stays.
export function gainTempHp(campaign: Campaign, sheetId: string, amount: number, feature: string): string {
  const sheet = getSheetById(sheetId);
  if (!sheet) {
    return "";
  }
  if (amount <= (sheet.tempHp ?? 0)) {
    return `${feature}: ${sheet.name} keeps their ${sheet.tempHp} temporary hit points, more than the ${amount} the bite gives.`;
  }
  const updated = patchSheet(sheet.id, { tempHp: amount });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
  return `${feature}: ${sheet.name} gains ${amount} temporary hit points.`;
}

// Stunning Strike's save, once the ki is paid: CON against the monk's ki DC,
// and a failure stuns the creature until the end of the monk's next turn
// (untilTurnEndOf, src/lib/dm/turn-end.ts).
export function stunningStrikeSave(
  campaign: Campaign,
  encounterId: string,
  enemyId: string,
  monkId: string,
  dc: number,
): string {
  const fresh = getEnemy(enemyId);
  if (!fresh || fresh.encounterId !== encounterId || fresh.status !== "alive") {
    return "Stunning Strike: the target is already down.";
  }
  const barred = riderBarred(fresh, "stunned", null);
  if (barred) {
    return `Stunning Strike: ${barred} The ki is spent.`;
  }
  // A stun is what a legendary creature keeps its resistances for.
  const save = rollEnemySave(campaign.id, fresh, "con", dc, { resist: true });
  if (save.success) {
    return `Stunning Strike: ${fresh.displayName} holds (CON save ${save.total ?? "failed outright"} vs DC ${dc}${save.legendaryResistance ? ", Legendary Resistance" : ""}); no stun.`;
  }
  if (!fresh.conditions.includes("stunned")) {
    patchEnemyConditions(fresh.id, [...fresh.conditions, "stunned"], {
      ...fresh.conditionMeta,
      stunned: untilTurnEnd(monkId, { source: monkId }),
    });
    // Stunned is out of action: its concentration and grapples end.
    settleEnemyIncapacitation(fresh.id, isIncapacitated(fresh.conditions));
    publishEncounter(campaign.id);
  }
  return `Stunning Strike: ${fresh.displayName} fails the CON save (${save.autoFailed ? "automatic" : save.total} vs DC ${dc}) and is stunned until the end of the monk's next turn.`;
}

// Clears the attacker's conditions a hit uses up (the smites: "the next
// time you hit"). A miss leaves them for the next swing.
export function clearHitSpent(campaign: Campaign, sheetId: string, names: string[]) {
  if (!names.length) {
    return;
  }
  const fresh = getSheetById(sheetId);
  if (!fresh) {
    return;
  }
  const cleared = removeConditions(fresh.conditions, fresh.conditionMeta, names);
  const updated = patchSheet(sheetId, { conditions: cleared.conditions, conditionMeta: cleared.meta });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

// Why a rider's condition cannot land on this creature, or null when it can:
// it is immune to the condition, or too large for the maneuver.
export function riderBarred(
  enemy: EncounterEnemy,
  condition: string,
  maxSize: string | null,
): string | null {
  if (enemy.stats.conditionImmune.toLowerCase().includes(condition)) {
    return `${enemy.displayName} is immune to being ${condition}.`;
  }
  if (maxSize && sizeRank(enemy.stats.size) > sizeRank(maxSize)) {
    return `${enemy.displayName} is ${enemy.stats.size}, too large to be knocked ${condition} this way (${maxSize} or smaller).`;
  }
  return null;
}

// Writes a rider's condition to the enemy row, when nothing bars it.
export function applyRiderCondition(
  campaign: Campaign,
  enemy: EncounterEnemy,
  condition: string,
  options: { rounds?: number; maxSize?: string; meta?: ConditionMeta } = {},
): { applied: true } | { applied: false; reason: string } {
  const barred = riderBarred(enemy, condition, options.maxSize ?? null);
  if (barred) {
    return { applied: false, reason: barred };
  }
  if (!enemy.conditions.includes(condition)) {
    patchEnemyConditions(enemy.id, [...enemy.conditions, condition], {
      ...enemy.conditionMeta,
      ...(options.meta ? { [condition]: options.meta } : options.rounds ? { [condition]: { rounds: options.rounds } } : {}),
    });
    publishEncounter(campaign.id);
  }
  return { applied: true };
}
