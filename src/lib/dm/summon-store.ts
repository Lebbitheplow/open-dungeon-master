// The creatures spells and features make, as the table keeps them: each one
// a guest companion sheet whose numbers are its SRD stat block, with a
// summon record (src/lib/schemas/summon.ts), a "summoned" condition carrying
// the spell's duration, a token beside its maker and an initiative entry.
// This module spawns them, sends them away (0 hit points, the end of the
// spell, the end of its duration) and turns Conjure Elemental's elemental on
// the party when concentration breaks.
//
// Database-level only: concentration.ts and pc-damage.ts call into it, so it
// must not import mutations.ts, enemy-damage.ts, map-tools.ts or
// companion-tools.ts (each of them reaches those two).

import { dmRoll, rollCard } from "@/lib/dm/roll-card";
import type { Campaign } from "@/lib/db/campaigns";
import { getDatabase } from "@/lib/db/core";
import {
  createSheet,
  getSheetById,
  listSheets,
  markSheetAsCompanion,
  patchSheet,
  setSheetSummon,
} from "@/lib/db/sheets";
import { createCompanionUser, deleteCompanionUser } from "@/lib/db/users";
import {
  getActiveEncounter,
  insertEnemy,
  listEnemies,
  saveEncounter,
  type OrderEntry,
} from "@/lib/db/encounters";
import {
  getBattleMapForEncounter,
  getTokenByRef,
  insertToken,
  listTokens,
  removeTokenByRef,
} from "@/lib/db/battle-maps";
import { activePublicEncounter } from "@/lib/db/encounter-view";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { nameArrivals } from "@/lib/dm/encounter-logic";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { d20Expression } from "@/lib/dice";
import { createSheetSchema, type CharacterSheet } from "@/lib/schemas/sheet";
import type { SheetSummon } from "@/lib/schemas/summon";
import type { SummonForm } from "@/lib/srd/summon-forms";
import { enemyStatsFromSummon, SUMMONED } from "@/lib/dm/summon-rules";

const mod = (score: number) => Math.floor((score - 10) / 2);

// The sheet level whose proficiency bonus is the creature's own (SRD 5.1:
// a challenge rating's proficiency bonus), so its saves come out as printed.
function levelForCr(cr: number): number {
  if (cr >= 17) return 17;
  if (cr >= 13) return 13;
  if (cr >= 9) return 9;
  if (cr >= 5) return 5;
  return 1;
}

function publishEncounterState(campaignId: string) {
  publishPersisted(campaignId, "encounter_updated", { encounter: activePublicEncounter(campaignId) });
}

export type SpawnInput = {
  form: SummonForm;
  count: number;
  record: SheetSummon;
  // Rounds the "summoned" condition lasts; null for a creature that stays
  // until it is dismissed or destroyed (Find Steed).
  rounds: number | null;
  slotLevel: number | null;
  // "before": right before its maker (Faithful Hound bites at the start of
  // its caster's turn).
  initiative: "group" | "caster" | "before";
  // Conditions it arrives with (the invisible hound).
  conditions?: string[];
  // Durable Summons.
  tempHp?: number;
  // Overrides a spell writes onto the block (Find Steed's Intelligence 6,
  // Phantom Steed's speed, the Arcane Hand's hit points).
  overrides?: { int?: number; speed?: number; hp?: number; ac?: number; level?: number };
};

// Spawns the creatures: sheets, tokens beside the maker, one initiative
// entry each. Returns the new sheets.
export function spawnSummons(campaign: Campaign, caster: CharacterSheet, input: SpawnInput): CharacterSheet[] {
  const { form, record } = input;
  const existingNames = listSheets(campaign.id).map((sheet) => sheet.name);
  const wanted = Array.from({ length: input.count }, () => form.name);
  // Numbered on from whatever of its kind is already at the table, so a
  // third wolf called up later is Wolf 3 and not a second "Wolf" (issue 98).
  const { names } = nameArrivals(existingNames, wanted);
  const abilities = { ...form.abilities, ...(input.overrides?.int ? { int: Math.max(form.abilities.int, input.overrides.int) } : {}) };
  const hp = input.overrides?.hp ?? form.hp;
  const level = input.overrides?.level ?? levelForCr(form.cr);
  const created: CharacterSheet[] = [];
  names.forEach((rawName) => {
    const name = rawName;
    const draft = createSheetSchema.parse({
      name: name.slice(0, 60),
      race: "human",
      class: "fighter",
      abilities,
      maxHp: Math.max(1, Math.min(500, hp)),
      ac: input.overrides?.ac ?? form.ac,
      acOverride: true,
      speed: Math.min(120, input.overrides?.speed ?? (form.speed || form.fly || form.swim || 0)),
      hitDice: { die: "d8", total: level, spent: 0 },
      proficiencies: {
        saves: form.saves ?? [],
        skills: [],
        expertise: [],
        languages: [],
        tools: [],
        armor: [],
        weapons: [],
      },
      backstory: `${form.name} made by ${caster.name}'s ${record.spell}.`,
    });
    const user = createCompanionUser(name);
    const sheet = createSheet(campaign.id, user.id, level, draft);
    markSheetAsCompanion(sheet.id, "guest", `${form.name}, obeying ${caster.name}. ${record.traits}`.slice(0, 500));
    setSheetSummon(sheet.id, record);
    // A creature is its stat block: no class features or counters of the
    // sheet class that carries it, its own hit points, the spell's clock.
    const meta = {
      [SUMMONED]: {
        source: caster.id,
        spell: record.spell,
        ...(input.rounds ? { rounds: input.rounds } : {}),
        ...(input.slotLevel ? { slotLevel: input.slotLevel } : {}),
      },
    };
    const shaped = patchSheet(sheet.id, {
      features: [],
      resources: {},
      conditions: [SUMMONED, ...(input.conditions ?? [])],
      conditionMeta: meta,
      ...(input.tempHp ? { tempHp: input.tempHp } : {}),
    });
    const final = shaped ?? getSheetById(sheet.id) ?? sheet;
    created.push(final);
    publishPersisted(campaign.id, "sheet_updated", { sheet: final });
  });
  placeInFight(campaign, caster, created, form, input.initiative);
  return created;
}

function placeInFight(
  campaign: Campaign,
  caster: CharacterSheet,
  created: CharacterSheet[],
  form: SummonForm,
  mode: "group" | "caster" | "before",
) {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !created.length) {
    return;
  }
  if (encounter.orderReady) {
    const casterAt = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === caster.id);
    const casterInitiative = casterAt >= 0 ? encounter.order[casterAt].initiative : 0;
    // One roll for the group (SRD 5.1, Conjure Animals); a creature that
    // acts on its maker's turn goes right after the maker.
    const initiative =
      mode !== "group" && casterAt >= 0
        ? casterInitiative
        : rollCard(campaign, null, created[0].id, "initiative", `${form.name}: initiative`, d20Expression(mod(form.abilities.dex)), null).total;
    const entries: OrderEntry[] = created.map((sheet) => ({
      kind: "pc",
      characterId: sheet.id,
      userId: sheet.userId,
      name: sheet.name,
      initiative,
    }));
    if (mode !== "group" && casterAt >= 0) {
      const at = mode === "before" ? casterAt : casterAt + 1;
      encounter.order.splice(at, 0, ...entries);
      if (at <= encounter.turnIndex) {
        encounter.turnIndex += entries.length;
      }
    } else {
      let order = [...encounter.order];
      let pointer = encounter.turnIndex;
      for (const entry of entries) {
        let at = order.length;
        for (let index = 0; index < order.length; index += 1) {
          if (order[index].initiative < entry.initiative) {
            at = index;
            break;
          }
        }
        order = [...order.slice(0, at), entry, ...order.slice(at)];
        if (at <= pointer) {
          pointer += 1;
        }
      }
      encounter.order = order;
      encounter.turnIndex = pointer;
    }
    saveEncounter(encounter);
    publishEncounterState(campaign.id);
  }
  const map = getBattleMapForEncounter(encounter.id);
  if (!map) {
    return;
  }
  const tokens = listTokens(map.id);
  const anchor = tokens.find((token) => token.refId === caster.id);
  const spots = findSpawnTiles(
    map.terrain,
    map.width,
    map.height,
    occupiedTiles(map, tokens, null),
    created.length,
    anchor ? [{ x: anchor.x, y: anchor.y }] : tokens.filter((token) => token.kind === "pc").map((token) => ({ x: token.x, y: token.y })),
    tokens.filter((token) => token.kind === "enemy").map((token) => ({ x: token.x, y: token.y })),
  );
  created.forEach((sheet, index) => {
    const spot = spots[index];
    if (spot) {
      insertToken({ mapId: map.id, campaignId: campaign.id, kind: "pc", refId: sheet.id, name: sheet.name, x: spot.x, y: spot.y });
    }
  });
  publishEphemeral(campaign.id, "battle_map_updated", {});
}

// Takes a summoned creature off the table: its initiative entry, its token,
// its sheet and the bot user behind it.
export function removeSummon(
  campaign: Campaign,
  sheet: Pick<CharacterSheet, "id" | "userId" | "name">,
  replaceWith?: OrderEntry,
) {
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const index = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === sheet.id);
    if (index !== -1 && replaceWith) {
      encounter.order[index] = replaceWith;
      saveEncounter(encounter);
      publishEncounterState(campaign.id);
    } else if (index !== -1) {
      encounter.order.splice(index, 1);
      if (index < encounter.turnIndex) {
        encounter.turnIndex -= 1;
      } else if (index === encounter.turnIndex) {
        encounter.turnIndex = Math.max(0, Math.min(encounter.turnIndex, encounter.order.length - 1));
      }
      saveEncounter(encounter);
      publishEncounterState(campaign.id);
    }
    const map = getBattleMapForEncounter(encounter.id);
    if (map) {
      removeTokenByRef(map.id, sheet.id);
      publishEphemeral(campaign.id, "battle_map_updated", {});
    }
  }
  publishPersisted(campaign.id, "sheet_deleted", { sheetId: sheet.id, userId: sheet.userId });
  deleteCompanionUser(sheet.userId);
}

// A conjured creature that turns on the party when its maker's concentration
// breaks (Conjure Elemental, Conjure Fey): an enemy with its stat block and
// hit points as they stand, where it stood, at its place in the order.
function turnHostile(campaign: Campaign, sheet: CharacterSheet): string | null {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter || !sheet.summon) {
    return null;
  }
  const stats = enemyStatsFromSummon(sheet);
  const entryAt = encounter.order.findIndex((entry) => entry.kind === "pc" && entry.characterId === sheet.id);
  // Now a foe: its roll is the DM's, as an enemy's initiative is.
  const initiative = entryAt >= 0 ? encounter.order[entryAt].initiative : dmRoll(campaign.id, null, "initiative", `${sheet.summon.form}: initiative`, d20Expression(stats.dexMod)).total;
  const taken = new Set(listEnemies(encounter.id).map((enemy) => enemy.displayName));
  const displayName = taken.has(sheet.summon.form) ? `${sheet.summon.form} (unbound)` : sheet.summon.form;
  const enemy = insertEnemy({
    encounterId: encounter.id,
    campaignId: campaign.id,
    slug: `summon:${sheet.summon.form.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    displayName,
    initiative,
    stats,
  });
  const map = getBattleMapForEncounter(encounter.id);
  const token = map ? getTokenByRef(map.id, sheet.id) : null;
  // It keeps its place in the order, now on the other side.
  removeSummon(campaign, sheet, entryAt >= 0 ? { kind: "enemy", enemyId: enemy.id, name: enemy.displayName, initiative } : undefined);
  const live = getActiveEncounter(campaign.id);
  if (live && live.orderReady && entryAt < 0) {
    live.order.push({ kind: "enemy", enemyId: enemy.id, name: enemy.displayName, initiative });
    saveEncounter(live);
  }
  if (map && token) {
    insertToken({ mapId: map.id, campaignId: campaign.id, kind: "enemy", refId: enemy.id, name: enemy.displayName, x: token.x, y: token.y });
    publishEphemeral(campaign.id, "battle_map_updated", {});
  }
  // Its wounds come with it.
  if (sheet.currentHp < sheet.maxHp) {
    getDatabase().prepare("UPDATE encounter_enemies SET current_hp = ? WHERE id = ?").run(Math.max(1, sheet.currentHp), enemy.id);
  }
  publishEncounterState(campaign.id);
  return enemy.displayName;
}

// The creatures `spell` made (by `casterId` when given): gone when the
// spell ends, or turned hostile where the spell says so. Returns a line for
// each for the table.
export function endSpellSummons(campaign: Campaign, spell: string, casterId?: string): string[] {
  const wanted = spell.trim().toLowerCase();
  const lines: string[] = [];
  for (const stale of listSheets(campaign.id)) {
    const sheet = getSheetById(stale.id) ?? stale;
    const summon = sheet.summon;
    if (!summon || summon.spell.trim().toLowerCase() !== wanted || (casterId && summon.casterId !== casterId)) {
      continue;
    }
    if (summon.hostileOnBreak && summon.concentration) {
      const hostile = turnHostile(campaign, sheet);
      if (hostile) {
        lines.push(`${sheet.name} breaks free of ${summon.casterName || "its caster"}'s control and turns hostile.`);
        continue;
      }
    }
    removeSummon(campaign, sheet);
    lines.push(`${sheet.name} vanishes as ${summon.spell} ends.`);
  }
  return lines;
}

// The creatures whose spell has run its course (the "summoned" condition
// ran out on the clock or at the round wrap) go, and an initiative entry
// left behind by one that went while the pointer was moving (the move saves
// the order it read before) is taken out. Called after the pointer's move is
// saved and after time passes.
export function sweepSummons(campaign: Campaign): string[] {
  const lines: string[] = [];
  const sheets = listSheets(campaign.id);
  for (const stale of sheets) {
    const sheet = getSheetById(stale.id) ?? stale;
    if (!sheet.summon || sheet.conditions.some((name) => name.toLowerCase() === SUMMONED)) {
      continue;
    }
    removeSummon(campaign, sheet);
    lines.push(`${sheet.name} fades as ${sheet.summon.spell} runs its course.`);
  }
  const encounter = getActiveEncounter(campaign.id);
  if (encounter) {
    const kept = encounter.order.filter((entry) => entry.kind !== "pc" || getSheetById(entry.characterId));
    if (kept.length !== encounter.order.length) {
      const current = encounter.order[encounter.turnIndex];
      const before = encounter.order.slice(0, encounter.turnIndex).filter((entry) => !kept.includes(entry)).length;
      encounter.order = kept;
      encounter.turnIndex = current && kept.includes(current) ? kept.indexOf(current) : Math.max(0, Math.min(encounter.turnIndex - before, kept.length - 1));
      saveEncounter(encounter);
      publishEncounterState(campaign.id);
    }
  }
  return lines;
}

// A summoned creature at 0 hit points disappears (SRD 5.1: "disappears
// when it drops to 0 hit points"), and Phantom Steed's horse at any damage;
// the death engine never sees it.
export function summonAfterDamage(campaign: Campaign, sheet: CharacterSheet, dropped: boolean, taken: number): string | null {
  if (!sheet.summon) {
    return null;
  }
  const fragile = sheet.summon.spell === "Phantom Steed" && taken > 0;
  if (!dropped && !fragile) {
    return null;
  }
  removeSummon(campaign, sheet);
  return fragile && !dropped
    ? `${sheet.name} takes damage and disappears (Phantom Steed).`
    : `${sheet.name} drops to 0 hit points and disappears.`;
}

export function summonsOf(campaignId: string, casterId: string, spell?: string): CharacterSheet[] {
  return listSheets(campaignId).filter(
    (sheet) =>
      sheet.summon?.casterId === casterId &&
      (!spell || sheet.summon.spell.trim().toLowerCase() === spell.trim().toLowerCase()),
  );
}
