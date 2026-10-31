import { z } from "zod";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import type { Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  insertEnemy,
  listEnemies,
  patchEnemyHp,
  renameEnemy,
  saveEncounter,
  type EncounterEnemy,
  type OrderEntry,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter, getTokenByRef, insertToken, listTokens, renameTokenByRef } from "@/lib/db/battle-maps";
import { d20Expression } from "@/lib/dice";
import { resolveMonster } from "@/lib/bestiary";
import { listNpcs } from "@/lib/db/npcs";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { nameArrivals, spliceIntoOrder } from "@/lib/dm/encounter-logic";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import type { SettingRef } from "@/lib/worlds/preset";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { dmRoll } from "@/lib/dm/roll-card";
import type { ToolResult } from "@/lib/dm/tool-errors";
import { textKey } from "@/lib/language/text-logic";
import { fieldSheetFoes, sheetFoesByName, type SheetFoe, type SheetFoeEntry } from "@/lib/dm/sheet-foes";
import { fightingParty, MAX_COMBATANTS } from "@/lib/dm/party-budget";
import { arrivalsFor, returningRow, survivorNamed, unknownReturning } from "@/lib/dm/foe-return";
import { initLegendaryPools } from "@/lib/dm/legendary-tools";
import { isDefeated } from "@/lib/dm/knockout";
import { latestAppearance, lastAppearanceOfNpc } from "@/lib/db/foe-history";

// Enemy spawning shared by start_encounter and the mid-combat add_enemies
// tool, so reinforcements and summons are real server-tracked combatants
// with stat blocks, initiative slots, and battle-map tokens. Must not
// import encounter-tools or encounter-tools-extra (they import this).

export const enemyRequestSchema = z.object({
  monster: z.string(),
  name: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  cr: z.number().min(0).max(30).optional(),
  // A creature from an earlier fight, by its enemyId there: it comes back
  // as that fight left it (issue #667, src/lib/dm/foe-return.ts). A blank
  // one from a weak caller is the same as none.
  returning: z.preprocess((value) => (typeof value === "string" && value.trim() ? value.trim() : undefined), z.string().max(80).optional()),
});
export type EnemyRequest = z.infer<typeof enemyRequestSchema>;

export type ResolvedEnemyRequest = {
  slug: string;
  name: string;
  stats: ReturnType<typeof synthesizeStats>;
  // A character who fights as its own sheet on the foes' side (issue 503:
  // a companion come back against the party, or one that turned on it): no
  // enemy row is made for it; `stats` is what the fight is budgeted on
  // (src/lib/dm/sheet-foes.ts).
  sheetFoe?: SheetFoe;
  // The Cast NPC this enemy is (issue #667): their next fight finds them.
  npcId?: string;
  // The row of an earlier fight this creature comes back from, as it was
  // left there (src/lib/dm/foe-return.ts).
  returning?: string;
};

// Resolves every requested enemy before anything is created. Returns the
// flat per-individual list, or the first unresolvable monster reference.
//
// `authors` is whose hand-built monsters count as resolvable
// (src/lib/bestiary/homebrew-monsters.ts): everyone who runs the table
// (src/lib/db/homebrew.ts tableAuthors) rather than whoever pressed the
// button, because a monster prepared for this table by any of its DM seats
// should answer to its name no matter which seat starts the fight.
export function resolveEnemyRequests(
  setting: SettingRef,
  requests: EnemyRequest[],
  authors?: string | string[],
  // The table, for its Cast: an NPC named here with a stat block fights as
  // that block, under their own name (src/lib/npcs/forge.ts statBlock).
  campaignId?: string,
): { resolved: ResolvedEnemyRequest[] } | { unknownMonster: string } | { unknownReturning: string } {
  const resolved: ResolvedEnemyRequest[] = [];
  const authorList = Array.isArray(authors) ? authors : authors ? [authors] : [];
  const cast = campaignId ? listNpcs(campaignId).filter((npc) => npc.statBlock) : [];
  // A companion who left the party and comes back against it, or one that
  // turned on it, fights as themselves: once, whatever the count.
  const sheetFoes = campaignId ? sheetFoesByName(campaignId) : new Map<string, SheetFoeEntry>();
  for (const request of requests) {
    const count = request.count ?? 1;
    const wanted = textKey(request.monster);
    // A creature from an earlier fight, named by its id there or, alone, by
    // the name the tracker showed: it fights as its own row's block, once
    // (issue #667, foe-return.ts).
    if (request.returning && campaignId) {
      const row = returningRow(campaignId, request.returning);
      if (!row) {
        return { unknownReturning: request.returning };
      }
      resolved.push(carriedEntry(row));
      continue;
    }
    const foe = sheetFoes.get(wanted);
    if (foe) {
      if (!resolved.some((entry) => entry.sheetFoe && textKey(entry.name) === wanted)) {
        resolved.push({ slug: "sheet", name: foe.name, stats: foe.stats, sheetFoe: foe.foe });
      }
      continue;
    }
    const survivor = campaignId ? survivorNamed(campaignId, setting, request) : null;
    if (survivor) {
      resolved.push(carriedEntry(survivor));
      continue;
    }
    const npc = cast.find((entry) => textKey(entry.name) === wanted || entry.aliases.some((alias) => textKey(alias) === wanted));
    const match = npc
      ? (() => {
          const block = resolveMonster(npc.statBlock, setting, { userIds: authorList });
          return block ? { ...block, reskinName: npc.name } : null;
        })()
      : resolveMonster(request.monster, setting, { userIds: authorList });
    if (!match && request.cr === undefined) {
      return { unknownMonster: request.monster };
    }
    const stats = match ? match.stats : synthesizeStats(request.cr ?? 0.5);
    const displayName =
      request.name?.trim() || match?.reskinName || match?.baseName || request.monster.trim();
    if (npc && campaignId) {
      // A Cast NPC is one person, whatever the count (a count of 2 made two
      // of them), and comes back from their last fight as it left them.
      const last = lastAppearanceOfNpc(campaignId, npc.id);
      if (!resolved.some((entry) => entry.npcId === npc.id)) {
        resolved.push({
          slug: match?.slug ?? "custom",
          name: displayName,
          stats,
          npcId: npc.id,
          ...(last ? { returning: latestAppearance(last.id)?.id ?? last.id } : {}),
        });
      }
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      resolved.push({ slug: match?.slug ?? "custom", name: displayName, stats });
    }
  }
  return { resolved };
}

// A creature from an earlier fight, fighting as that row had it: its block,
// its name, who it is.
function carriedEntry(row: EncounterEnemy): ResolvedEnemyRequest {
  return { slug: row.slug, name: row.displayName, stats: row.stats, returning: row.id, ...(row.npcId ? { npcId: row.npcId } : {}) };
}

type ToolDef = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const addEnemiesTool: ToolDef = {
  type: "function",
  function: {
    name: "add_enemies",
    description:
      "Bring NEW enemies into the ongoing fight: reinforcements arriving, summoned creatures, an ambusher revealing itself. Call it BEFORE narrating them, never instead: they become real server-tracked combatants with initiative slots and map tokens. The server refuses more than 8 living enemies, or reinforcements past this party's XP ceiling.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        enemies: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              monster: {
                type: "string",
                description: "Monster slug or name ('goblin', 'Gutter Punk').",
              },
              name: {
                type: "string",
                description: "In-world display name, to reskin one for this setting.",
              },
              count: { type: "integer", minimum: 1, maximum: 8 },
              cr: {
                type: "number",
                description:
                  "Only for an invented enemy with no matching monster: its challenge rating.",
              },
              returning: { type: "string", description: "An earlier fight's enemyId." },
            },
            required: ["monster"],
          },
        },
        reason: { type: "string", description: "Short in-fiction cause of their arrival." },
      },
      required: ["enemies"],
    },
  },
};

const addArgsSchema = z.object({
  enemies: z.array(enemyRequestSchema).min(1).max(4),
  reason: z.string().optional(),
});

// Accepts the documented {enemies:[...]} shape, or flat monster/name/count
// keys (the textual-salvage path cannot produce arrays).
function parseAddArgs(rawArguments: string): z.infer<typeof addArgsSchema> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(rawArguments || "{}");
  } catch {
    return null;
  }
  const nested = addArgsSchema.safeParse(raw);
  if (nested.success) {
    return nested.data;
  }
  const flat = enemyRequestSchema.extend({ reason: z.string().optional() }).safeParse(raw);
  if (flat.success) {
    return {
      enemies: [
        { monster: flat.data.monster, name: flat.data.name, count: flat.data.count, cr: flat.data.cr, returning: flat.data.returning },
      ],
      reason: flat.data.reason,
    };
  }
  return null;
}

export function handleAddEnemies(
  campaign: Campaign,
  rawArguments: string,
  sheets: CharacterSheet[],
): ToolResult {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter; use start_encounter to begin a fight.", retry: true };
  }
  const args = parseAddArgs(rawArguments);
  if (!args) {
    return {
      error: 'Invalid add_enemies arguments. Send {"enemies":[{"monster":"goblin","count":2}]}.',
      retry: true,
    };
  }
  const outcome = resolveEnemyRequests(campaign.gameSettings, args.enemies, spellAuthorsFor(campaign), campaign.id);
  if ("unknownMonster" in outcome) {
    return {
      error: `Unknown monster "${outcome.unknownMonster}". Use a real monster slug or name, or pass cr for an invented enemy.`,
      retry: true,
    };
  }
  if ("unknownReturning" in outcome) {
    return unknownReturning(campaign.id, outcome.unknownReturning);
  }

  // Characters named here fight as their own sheets (sheet-foes.ts): fielded
  // below, once the enemy rows are in.
  const rows = outcome.resolved.filter((entry) => !entry.sheetFoe);
  const foes = outcome.resolved.flatMap((entry) => (entry.sheetFoe ? [entry.sheetFoe] : []));
  // A creature from an earlier fight comes in as it was left (issue #667).
  const arrivals = arrivalsFor(campaign, rows, encounter.id);
  if ("error" in arrivals) {
    return arrivals;
  }
  const existing = listEnemies(encounter.id);
  // Who is standing against the party now: one knocked out, dead or fled
  // is out of the fight and takes no place under the cap nor in the budget
  // (issue #667: a knocked-out goblin kept a reinforcement out).
  const standing = existing.filter((enemy) => !isDefeated(enemy));
  const arrivingStanding = outcome.resolved.filter((entry) => {
    const rowIndex = rows.indexOf(entry);
    return rowIndex < 0 || !arrivals.carries[rowIndex]?.knockedOut;
  });
  if (standing.length + arrivingStanding.length > MAX_COMBATANTS) {
    return { error: `Too many combatants: keep the fight to ${MAX_COMBATANTS} living enemies or fewer.`, retry: true };
  }
  // Budget check over the whole living opposition, reinforcements included,
  // against the characters fighting it (src/lib/dm/party-budget.ts).
  const partyLevels = fightingParty(campaign, sheets).map((sheet) => sheet.level);
  const evaluation = evaluateEncounter(partyLevels, [
    ...standing.map((enemy) => enemy.cr),
    ...arrivingStanding.map((entry) => entry.stats.cr),
  ]);
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  if (evaluation.adjustedXp > ceiling) {
    return {
      error: `Too deadly: with these reinforcements the adjusted XP is ${evaluation.adjustedXp} vs an allowed ceiling of ${ceiling}. Add fewer or weaker enemies.`,
      retry: true,
    };
  }

  // A creature that fled this same fight takes the field again on its own
  // row; the rest arrive on rows of their own.
  const rejoining = rows.flatMap((entry, index) => {
    const carry = arrivals.carries[index];
    return carry?.rejoin ? [{ id: carry.rejoin, carry }] : [];
  });
  const arriving = rows.flatMap((entry, index) => (arrivals.carries[index]?.rejoin ? [] : [{ entry, carry: arrivals.carries[index] }]));
  // Numbered with the enemies already in the fight, as one run per kind
  // (issue 98). One who stood alone under a plain name takes a number now
  // that there are more of them: in the tracker, in the order, on the board.
  // A creature come back from an earlier fight keeps its name there, so it
  // is numbered as one already here.
  const carriedHere = arriving.filter((arrival) => arrival.carry);
  const freshHere = arriving.filter((arrival) => !arrival.carry);
  const before = [...existing.map((enemy) => enemy.displayName), ...carriedHere.map((arrival) => arrival.entry.name)];
  const { names: freshNames, renames } = nameArrivals(before, freshHere.map((arrival) => arrival.entry.name));
  const carriedNames = carriedHere.map((arrival) => arrival.entry.name);
  const renamed: Array<{ enemy: EncounterEnemy; name: string }> = [];
  for (const { index, name } of renames) {
    if (index < existing.length) {
      renamed.push({ enemy: existing[index], name });
    } else {
      carriedNames[index - existing.length] = name;
    }
  }
  for (const { enemy, name } of renamed) {
    renameEnemy(enemy.id, name);
    for (const entry of encounter.order) {
      if (entry.kind === "enemy" && entry.enemyId === enemy.id) {
        entry.name = name;
      }
    }
  }
  const nameOf = (arrival: (typeof arriving)[number]) =>
    arrival.carry ? carriedNames[carriedHere.indexOf(arrival)] : freshNames[freshHere.indexOf(arrival)];
  const inserted = arriving.map((arrival) => {
    const name = nameOf(arrival);
    return insertEnemy({
      encounterId: encounter.id,
      campaignId: campaign.id,
      slug: arrival.entry.slug,
      displayName: name,
      // Enemy initiative rolls silently at spawn, like start_encounter.
      // A record for the DM alone, as an enemy's save is.
      initiative: dmRoll(campaign.id, null, "initiative", `${name}: initiative`, d20Expression(arrival.entry.stats.dexMod)).total,
      stats: arrival.entry.stats,
      ...(arrival.entry.npcId ? { npcId: arrival.entry.npcId } : {}),
      ...(arrival.carry ? { arrives: arrival.carry.arrives } : {}),
    });
  });
  const back = rejoining.flatMap(({ id, carry }) => {
    const row = patchEnemyHp(id, carry.arrives.currentHp, "alive");
    return row ? [row] : [];
  });
  // Legendary pools for the arrivals, the lair flag kept (issue #667: a
  // reinforcement had none until its first turn), and what one come back
  // kept of its pools.
  const kept = new Map(
    arriving.flatMap((arrival, index) => (arrival.carry?.legendary ? [[inserted[index].id, arrival.carry.legendary] as const] : [])),
  );
  initLegendaryPools(encounter, inserted, encounter.legendary.lair, kept);

  // Splice into a locked order without moving the pointer off the current
  // PC; during initiative collection the order builds later from the DB.
  if (encounter.orderReady) {
    const newEntries: OrderEntry[] = inserted.map((enemy) => ({
      kind: "enemy",
      enemyId: enemy.id,
      name: enemy.displayName,
      initiative: enemy.initiative ?? 0,
    }));
    const spliced = spliceIntoOrder(encounter.order, encounter.turnIndex, newEntries);
    encounter.order = spliced.order;
    encounter.turnIndex = spliced.turnIndex;
  }
  saveEncounter(encounter);

  // Tokens: cluster near existing enemies, or enter far from the party.
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    for (const { enemy, name } of renamed) {
      renameTokenByRef(map.id, enemy.id, name);
    }
    const tokens = listTokens(map.id);
    const spots = findSpawnTiles(
      map.terrain,
      map.width,
      map.height,
      occupiedTiles(map, tokens, null),
      inserted.length + back.length,
      tokens.filter((token) => token.kind === "enemy").map((token) => ({ x: token.x, y: token.y })),
      tokens.filter((token) => token.kind === "pc").map((token) => ({ x: token.x, y: token.y })),
    );
    // A creature back on the field comes in as a newcomer does; its old
    // token went when it fled.
    const placing = [...inserted, ...back.filter((enemy) => !getTokenByRef(map.id, enemy.id))];
    placing.forEach((enemy, index) => {
      const spot = spots[index];
      if (spot) {
        insertToken({
          mapId: map.id,
          campaignId: campaign.id,
          kind: "enemy",
          refId: enemy.id,
          name: enemy.displayName,
          x: spot.x,
          y: spot.y,
        });
      }
    });
    publishBattleMapUpdate(campaign.id);
  }
  const fielded = foes.length ? fieldSheetFoes(campaign, foes) : [];
  publishEncounter(campaign.id);

  return {
    ok: true,
    added: [
      ...[...inserted, ...back].map((enemy) => {
        const carry = arriving.find((_, index) => inserted[index]?.id === enemy.id)?.carry ?? rejoining.find((entry) => entry.id === enemy.id)?.carry;
        return {
          enemyId: enemy.id,
          name: enemy.displayName,
          ac: enemy.ac,
          hp: `${enemy.currentHp}/${enemy.maxHp}`,
          ...(carry ? { returning: carry.line } : {}),
        };
      }),
      ...fielded.map((sheet) => ({ characterId: sheet.id, name: sheet.name, ac: sheet.ac, hp: `${sheet.currentHp}/${sheet.maxHp}`, side: "foe" })),
    ],
    // Told, so the next call and the next passage use the name on the board.
    ...(renamed.length
      ? { renamed: renamed.map(({ enemy, name }) => ({ enemyId: enemy.id, was: enemy.displayName, name })) }
      : {}),
    note: "The reinforcements are in the fight and on the map. They act at their initiative; narrate their arrival now.",
  };
}
