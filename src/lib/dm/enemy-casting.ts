import type { Campaign } from "@/lib/db/campaigns";
import { getActiveEncounter, saveEncounter, type Encounter, type EncounterEnemy } from "@/lib/db/encounters";
import type { SaveAbility } from "@/lib/bestiary/statblock";
import type { SpellCondition } from "@/lib/srd/spell-mech-types";
import { spellDamageFor, spellFactsFor, spellMechanicsFor } from "@/lib/content";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { canEnemyAct } from "@/lib/dm/can-act";
import { spendEnemyAction } from "@/lib/dm/enemy-approach";
import { castingHold } from "@/lib/dm/spell-planes";
import { antimagicProblem } from "@/lib/dm/zone-rules";
import { resolveEnemyRef } from "@/lib/dm/enemy-damage";
import { charmedBy } from "@/lib/dm/enemy-profile";
import {
  abilityKey,
  abilityNames,
  abilityRefusal,
  findMonsterAbility,
  findMonsterSpell,
  slotFor,
  spellUsesLeft,
  spendAbility,
  spendSlot,
  spendSpellUse,
  type AbilityLedger,
} from "@/lib/dm/monster-abilities";

// An enemy's special action or spell aimed at the party (cast_at_player and
// aoe_damage with casterEnemyId): it is the creature's action for the round
// (or the legendary action bought for it), its numbers are the block's, its
// recharge, daily uses and spell slots are spent, and it is refused for a
// creature that cannot act, a spell the block does not list, a slot it no
// longer has, and a target that charmed it. The caller rolls and applies;
// this decides what may be rolled.

export type EnemyUse = {
  enemy: EncounterEnemy;
  // What was used, for the result and the dice cards.
  name: string;
  save?: SaveAbility;
  dc?: number;
  damage?: string;
  damageType?: string;
  halfOnSave?: boolean;
  condition?: string;
  rounds?: number;
  // The condition ends on a save at the end of each round.
  saveEnds?: boolean;
  // A spell or a magical ability, which Magic Resistance answers.
  magical: boolean;
  // The numbers are the block's (or the spell's): the caller's are ignored.
  // False only for a creature whose block lists nothing to match (a
  // synthesized enemy), which keeps the caller's numbers.
  fromBlock: boolean;
  // A concentration spell the enemy now holds.
  spell?: string;
  // The spell's own condition rules, so what it lays on a character records
  // the spell and its caster and ends with the enemy's concentration.
  spellCondition?: SpellCondition;
  slotLevel?: number;
  // The numbers the caller sent that the block overrode.
  corrections: string[];
  // Spends the action (or the legendary purchase), the recharge, the use
  // or the slot. Called once the effect resolves.
  commit: () => void;
};

function ledgerOf(encounter: Encounter, enemyId: string): AbilityLedger | undefined {
  return encounter.legendary.abilities?.[enemyId];
}

// What a legendary action bought and has not yet spent (legendary-tools.ts):
// an ability by its key, or "cantrip".
export function boughtByLegendary(encounter: Encounter, enemyId: string): string[] {
  return ledgerOf(encounter, enemyId)?.bought ?? [];
}

type Input = {
  casterEnemyId: string;
  ability?: string;
  spell?: string;
  source?: string;
  targetIds: string[];
  // What the caller sent, compared with the block for the corrections line.
  sent: { save?: string; dc?: number; damage?: string };
};

function describe(enemy: EncounterEnemy): string {
  const names = abilityNames(enemy.stats);
  const spells = enemy.stats.spells ?? [];
  const parts = [
    ...(names.length ? [`abilities: ${names.join(", ")}`] : []),
    ...(spells.length ? [`spells: ${spells.join(", ")}`] : []),
  ];
  return parts.length ? ` Its block lists ${parts.join("; ")}.` : "";
}

export function prepareEnemyUse(campaign: Campaign, input: Input): EnemyUse | { error: string } {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter; casterEnemyId names an enemy in a fight." };
  }
  const enemy = resolveEnemyRef(encounter.id, input.casterEnemyId);
  if (!enemy) {
    return { error: "Unknown casterEnemyId; use one from GAME STATE." };
  }
  for (const targetId of input.targetIds) {
    if (charmedBy(enemy.conditions, enemy.conditionMeta, targetId)) {
      return { error: `${enemy.displayName} is charmed by that character and cannot target them with a harmful ability. It may target someone else.` };
    }
  }
  const bought = boughtByLegendary(encounter, enemy.id);
  let legendary: string | null = null;
  const use: Omit<EnemyUse, "commit"> = { enemy, name: "", magical: false, fromBlock: false, corrections: [] };
  let spend: (ledger: AbilityLedger | undefined) => AbilityLedger | undefined = (ledger) => ledger;

  const spellName = (input.spell ?? "").trim();
  const abilityName = (input.ability ?? "").trim() || (!spellName ? (input.source ?? "").trim() : "");
  const hasBlock = abilityNames(enemy.stats).length > 0 || Boolean(enemy.stats.spells?.length) || Boolean(enemy.stats.spellcasting);

  if (spellName) {
    const casting = enemy.stats.spellcasting;
    const listed = findMonsterSpell(casting, spellName) ?? null;
    const known = listed ?? (enemy.stats.spells ?? []).find((name) => name.toLowerCase() === spellName.toLowerCase());
    if (!known) {
      return {
        error: `${enemy.displayName} cannot cast ${spellName}: it is not on its stat block.${describe(enemy)} Use one of those, or its attacks.`,
      };
    }
    const authors = spellAuthorsFor(campaign);
    const resolved = spellMechanicsFor({ spell: spellName, userIds: authors });
    const facts = spellFactsFor(spellName, authors);
    const level = listed?.level ?? resolved?.spellLevel ?? facts?.level ?? 0;
    use.name = resolved?.name ?? facts?.name ?? spellName;
    use.magical = true;
    if (resolved?.concentration) {
      use.spell = use.name;
    }
    if (level === 0 && bought.includes("cantrip")) {
      legendary = "cantrip";
    }
    const ledger = ledgerOf(encounter, enemy.id);
    let slot: number | null = null;
    if (listed && listed.perDay) {
      if (spellUsesLeft(ledger, listed) <= 0) {
        return { error: `${enemy.displayName} has cast ${use.name} as many times as it can today.${describe(enemy)}` };
      }
      spend = (next) => spendSpellUse(next, use.name);
    } else if (level > 0 && listed && listed.level !== null && casting && Object.keys(casting.slots).length) {
      slot = slotFor(casting, ledger, level);
      if (slot === null) {
        return { error: `${enemy.displayName} has no spell slot of level ${level} or higher left for ${use.name}. It can cast a lower-level spell, a cantrip, or attack.` };
      }
      const chosen = slot;
      spend = (next) => spendSlot(next, chosen);
    }
    const mech = resolved?.mech;
    use.fromBlock = Boolean(mech);
    if (mech?.save) {
      use.save = mech.save as SaveAbility;
    }
    if (mech) {
      use.halfOnSave = Boolean(mech.halfOnSave);
    }
    if (mech?.damageType) {
      use.damageType = mech.damageType;
    }
    if (mech?.condition) {
      use.spellCondition = mech.condition;
      use.slotLevel = slot ?? (level || undefined);
      use.condition = mech.condition.name;
      use.rounds = mech.condition.saveEnds ? undefined : mech.condition.rounds;
      use.saveEnds = Boolean(mech.condition.saveEnds);
    }
    const dice = spellDamageFor({
      spell: spellName,
      userIds: authors,
      casterLevel: casting?.casterLevel ?? Math.max(1, Math.ceil(enemy.cr)),
      ...(slot ? { slotLevel: slot } : {}),
    });
    if (dice) {
      use.damage = dice.dice;
    }
    if (casting?.dc) {
      use.dc = casting.dc;
    }
  } else if (abilityName) {
    const ability = findMonsterAbility(enemy.stats, abilityName);
    if (!ability) {
      if (hasBlock) {
        return { error: `${enemy.displayName} has no ability called ${abilityName}.${describe(enemy)}` };
      }
      use.name = abilityName;
    } else {
      use.name = ability.name;
      const key = abilityKey(ability.name);
      if (ability.legendaryCost) {
        if (!bought.includes(key)) {
          return { error: `${ability.name} is one of ${enemy.displayName}'s legendary actions: spend it with legendary_action at the end of another creature's turn first.` };
        }
        legendary = key;
      }
      const refusal = abilityRefusal(enemy.displayName, ability, ledgerOf(encounter, enemy.id));
      if (refusal) {
        return { error: refusal };
      }
      spend = (next) => spendAbility(ability, next);
      use.fromBlock = true;
      Object.assign(use, {
        ...(ability.save ? { save: ability.save } : {}),
        ...(ability.dc ? { dc: ability.dc } : {}),
        ...(ability.damage ? { damage: ability.damage } : {}),
        ...(ability.damageType ? { damageType: ability.damageType } : {}),
        ...(ability.halfOnSave !== undefined ? { halfOnSave: ability.halfOnSave } : { halfOnSave: false }),
        ...(ability.condition ? { condition: ability.condition } : {}),
        ...(ability.rounds ? { rounds: ability.rounds } : {}),
        ...(ability.repeatSave ? { saveEnds: true } : {}),
        magical: Boolean(ability.magical),
      });
    }
  } else if (hasBlock) {
    return {
      error: `Name what ${enemy.displayName} uses: ability (a name from its block) or spell (one it knows).${describe(enemy)}`,
    };
  }

  // The creature's action, or the legendary action that bought this.
  const allowed = canEnemyAct({ enemy, encounter, kind: legendary ? "legendary" : "action" });
  if (!allowed.ok) {
    return { error: allowed.error };
  }
  // Feeblemind, Maze, Fear's flight stop a creature's spells (spell-planes.ts).
  const unable = input.spell ? (castingHold({ name: enemy.displayName, conditions: enemy.conditions }) ?? antimagicProblem(campaign.id, enemy.id, enemy.displayName)) : null;
  if (unable) {
    return { error: unable };
  }
  if (use.save && input.sent.save && use.save !== input.sent.save) {
    use.corrections.push(`${use.name} forces a ${use.save.toUpperCase()} save; the server rolled that one.`);
  }
  if (use.dc && input.sent.dc && use.dc !== input.sent.dc) {
    use.corrections.push(`${use.name} is DC ${use.dc} on ${enemy.displayName}'s block.`);
  }
  if (use.damage && input.sent.damage && use.damage !== input.sent.damage) {
    use.corrections.push(`${use.name} deals ${use.damage}, not ${input.sent.damage}.`);
  }
  return {
    ...use,
    commit: () => {
      const live = getActiveEncounter(campaign.id);
      if (!live) {
        return;
      }
      const abilities = { ...(live.legendary.abilities ?? {}) };
      let ledger = spend(abilities[enemy.id]);
      if (legendary) {
        const rest = (ledger?.bought ?? []).filter((entry, index, list) => entry !== legendary || list.indexOf(entry) !== index);
        ledger = { ...(ledger ?? {}), bought: rest };
      } else {
        spendEnemyAction(live, enemy.id);
      }
      if (ledger) {
        abilities[enemy.id] = ledger;
      }
      live.legendary.abilities = abilities;
      saveEncounter(live);
    },
  };
}
