import { z } from "zod";
import type { Campaign } from "@/lib/db/campaigns";
import {
  getActiveEncounter,
  insertEnemy,
  listEnemies,
  saveEncounter,
  type OrderEntry,
} from "@/lib/db/encounters";
import { getBattleMapForEncounter, insertToken, listTokens } from "@/lib/db/battle-maps";
import { d20Expression, rollExpression } from "@/lib/dice";
import { resolveMonster } from "@/lib/bestiary";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import { encounterCeiling, evaluateEncounter } from "@/lib/srd/encounter-math";
import { numberDuplicates, spliceIntoOrder } from "@/lib/dm/encounter-logic";
import { findSpawnTiles } from "@/lib/battlemap/tactics";
import { occupiedTiles } from "@/lib/battlemap/view";
import { publishEncounter } from "@/lib/dm/enemy-damage";
import { publishBattleMapUpdate } from "@/lib/dm/map-tools";
import type { Genre } from "@/lib/schemas/game-settings";
import type { CharacterSheet } from "@/lib/schemas/sheet";

// Enemy spawning shared by start_encounter and the mid-combat add_enemies
// tool, so reinforcements and summons are real server-tracked combatants
// with stat blocks, initiative slots, and battle-map tokens. Must not
// import encounter-tools or encounter-tools-extra (they import this).

export const enemyRequestSchema = z.object({
  monster: z.string(),
  name: z.string().optional(),
  count: z.number().int().min(1).max(8).optional(),
  cr: z.number().min(0).max(30).optional(),
});
export type EnemyRequest = z.infer<typeof enemyRequestSchema>;

export type ResolvedEnemyRequest = {
  slug: string;
  name: string;
  stats: ReturnType<typeof synthesizeStats>;
};

// Resolves every requested enemy before anything is created. Returns the
// flat per-individual list, or the first unresolvable monster reference.
export function resolveEnemyRequests(
  genre: Genre,
  requests: EnemyRequest[],
): { resolved: ResolvedEnemyRequest[] } | { unknownMonster: string } {
  const resolved: ResolvedEnemyRequest[] = [];
  for (const request of requests) {
    const count = request.count ?? 1;
    const match = resolveMonster(request.monster, genre);
    if (!match && request.cr === undefined) {
      return { unknownMonster: request.monster };
    }
    const stats = match ? match.stats : synthesizeStats(request.cr ?? 0.5);
    const displayName =
      request.name?.trim() || match?.reskinName || match?.baseName || request.monster.trim();
    for (let index = 0; index < count; index += 1) {
      resolved.push({ slug: match?.slug ?? "custom", name: displayName, stats });
    }
  }
  return { resolved };
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
      "Bring NEW enemies into the ongoing fight: reinforcements arriving, summoned creatures, an ambusher revealing itself. Call this BEFORE narrating them appearing; they become real server-tracked combatants with initiative slots and map tokens. Never narrate a new combatant into existence without it.",
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
                description: "Monster slug or name, e.g. 'goblin' or 'Gutter Punk'.",
              },
              name: {
                type: "string",
                description: "Optional in-world display name when reskinning.",
              },
              count: { type: "integer", minimum: 1, maximum: 8 },
              cr: {
                type: "number",
                description:
                  "Only for an invented enemy with no matching monster: its challenge rating.",
              },
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
        { monster: flat.data.monster, name: flat.data.name, count: flat.data.count, cr: flat.data.cr },
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
): Record<string, unknown> {
  const encounter = getActiveEncounter(campaign.id);
  if (!encounter) {
    return { error: "No active encounter; use start_encounter to begin a fight." };
  }
  const args = parseAddArgs(rawArguments);
  if (!args) {
    return {
      error: 'Invalid add_enemies arguments. Send {"enemies":[{"monster":"goblin","count":2}]}.',
    };
  }
  const outcome = resolveEnemyRequests(campaign.gameSettings.genre, args.enemies);
  if ("unknownMonster" in outcome) {
    return {
      error: `Unknown monster "${outcome.unknownMonster}". Use a real monster slug or name, or pass cr for an invented enemy.`,
    };
  }

  const existing = listEnemies(encounter.id);
  const alive = existing.filter((enemy) => enemy.status === "alive");
  if (alive.length + outcome.resolved.length > 8) {
    return { error: "Too many combatants: keep the fight to 8 living enemies or fewer." };
  }
  // Budget check over the whole living opposition, reinforcements included.
  const partyLevels = sheets.map((sheet) => sheet.level);
  const evaluation = evaluateEncounter(partyLevels, [
    ...alive.map((enemy) => enemy.cr),
    ...outcome.resolved.map((entry) => entry.stats.cr),
  ]);
  const ceiling = encounterCeiling(campaign.difficulty, evaluation.thresholds.deadly);
  if (evaluation.adjustedXp > ceiling) {
    return {
      error: `Too deadly: with these reinforcements the adjusted XP is ${evaluation.adjustedXp} vs an allowed ceiling of ${ceiling}. Add fewer or weaker enemies.`,
    };
  }

  const names = numberDuplicates([
    ...existing.map((enemy) => enemy.displayName),
    ...outcome.resolved.map((entry) => entry.name),
  ]).slice(existing.length);
  const inserted = outcome.resolved.map((entry, index) =>
    insertEnemy({
      encounterId: encounter.id,
      campaignId: campaign.id,
      slug: entry.slug,
      displayName: names[index],
      // Enemy initiative rolls silently at spawn, like start_encounter.
      initiative: rollExpression(d20Expression(entry.stats.dexMod)).total,
      stats: entry.stats,
    }),
  );

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
    saveEncounter(encounter);
  }

  // Tokens: cluster near existing enemies, or enter far from the party.
  const map = getBattleMapForEncounter(encounter.id);
  if (map) {
    const tokens = listTokens(map.id);
    const spots = findSpawnTiles(
      map.terrain,
      map.width,
      map.height,
      occupiedTiles(map, tokens, null),
      inserted.length,
      tokens.filter((token) => token.kind === "enemy").map((token) => ({ x: token.x, y: token.y })),
      tokens.filter((token) => token.kind === "pc").map((token) => ({ x: token.x, y: token.y })),
    );
    inserted.forEach((enemy, index) => {
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
  publishEncounter(campaign.id);

  return {
    ok: true,
    added: inserted.map((enemy) => ({
      enemyId: enemy.id,
      name: enemy.displayName,
      ac: enemy.ac,
      hp: `${enemy.currentHp}/${enemy.maxHp}`,
    })),
    note: "The reinforcements are in the fight and on the map. They act at their initiative; narrate their arrival now.",
  };
}
