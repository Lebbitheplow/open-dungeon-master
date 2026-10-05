// After the fight (docs/vtt-parity-implementation-plan.md 4.2): what the
// dice and the sheets recorded over the encounter's span, folded into
// one card. Pure; enemy-damage.ts gathers the rows and stores the result.

export type FighterLine = { characterId: string; name: string; dealt: number; taken: number; healed: number; nat20s: number; nat1s: number };

export type EncounterSummary = {
  outcome: string;
  rounds: number;
  seconds: number;
  kills: number;
  fled: number;
  fighters: FighterLine[];
  totals: { dealt: number; taken: number; healed: number; nat20s: number; nat1s: number };
};

export type SummaryRoll = {
  characterId: string | null;
  // Who rolled it (src/lib/db/rolls.ts); absent or null, the roll is the
  // characterId sheet's, as every roll was before it was recorded.
  attacker?: { kind: string; id: string } | null;
  kind: string;
  total: number;
  applied?: boolean;
  targetEnemyId?: string | null;
  crit?: "nat20" | "nat1" | null;
};

export type SummaryAudit = { characterId: string; kind: string; delta: Record<string, unknown> };

export function computeEncounterSummary(input: {
  outcome: string;
  rounds: number;
  startedAt: string;
  endedAt: string;
  // Hit points where the fight's own are known: what the enemies lost is the
  // least the party's side dealt, whichever tool landed it.
  enemies: Array<{ status: string; maxHp?: number; currentHp?: number }>;
  sheets: Array<{ id: string; name: string }>;
  rolls: SummaryRoll[];
  audits: SummaryAudit[];
}): EncounterSummary {
  const lines = new Map<string, FighterLine>(
    input.sheets.map((sheet) => [sheet.id, { characterId: sheet.id, name: sheet.name, dealt: 0, taken: 0, healed: 0, nat20s: 0, nat1s: 0 }]),
  );
  for (const roll of input.rolls) {
    // An enemy's critical hit on a character is not the character's natural 20.
    const rollerId = roll.attacker ? (roll.attacker.kind === "sheet" ? roll.attacker.id : null) : roll.characterId;
    const line = rollerId ? lines.get(rollerId) : undefined;
    if (!line) {
      continue;
    }
    // Damage that landed on an enemy counts as dealt; a hit that was
    // never applied (a miss, a spell resisted) does not.
    if (roll.kind === "damage" && roll.applied) {
      line.dealt += Math.max(0, roll.total);
    }
    if (roll.crit === "nat20") {
      line.nat20s += 1;
    } else if (roll.crit === "nat1") {
      line.nat1s += 1;
    }
  }
  for (const audit of input.audits) {
    const line = lines.get(audit.characterId);
    if (!line) {
      continue;
    }
    const amount = Number(audit.delta.amount ?? audit.delta.damage ?? audit.delta.healed ?? 0);
    if (!Number.isFinite(amount)) {
      continue;
    }
    if (audit.kind === "apply_damage") {
      line.taken += Math.max(0, amount);
    } else if (audit.kind === "heal") {
      line.healed += Math.max(0, amount);
    }
  }
  const fighters = [...lines.values()];
  const totals = fighters.reduce(
    (sum, line) => ({
      dealt: sum.dealt + line.dealt,
      taken: sum.taken + line.taken,
      healed: sum.healed + line.healed,
      nat20s: sum.nat20s + line.nat20s,
      nat1s: sum.nat1s + line.nat1s,
    }),
    { dealt: 0, taken: 0, healed: 0, nat20s: 0, nat1s: 0 },
  );
  // The fighters' lines read the weapon dice the server applied as rolled. A
  // spell's card shows its dice before the save, an area's one roll lands on
  // many, a pet has its own: those are on nobody's line, so the total never
  // reads less than the enemies actually lost.
  const lost = input.enemies.reduce(
    (sum, enemy) => sum + (enemy.maxHp === undefined || enemy.currentHp === undefined ? 0 : Math.max(0, enemy.maxHp - Math.max(0, enemy.currentHp))),
    0,
  );
  totals.dealt = Math.max(totals.dealt, lost);
  const seconds = Math.max(0, Math.round((Date.parse(input.endedAt) - Date.parse(input.startedAt)) / 1000)) || 0;
  return {
    outcome: input.outcome,
    rounds: Math.max(1, input.rounds),
    seconds,
    kills: input.enemies.filter((enemy) => enemy.status === "dead").length,
    fled: input.enemies.filter((enemy) => enemy.status === "fled").length,
    fighters,
    totals,
  };
}

// One line for the chapter's record.
export function describeEncounterSummary(summary: EncounterSummary): string {
  const top = [...summary.fighters].sort((a, b) => b.dealt - a.dealt)[0];
  const parts = [
    `${summary.outcome.replace(/_/g, " ")} after ${summary.rounds} round${summary.rounds === 1 ? "" : "s"}`,
    `${summary.totals.dealt} damage dealt, ${summary.totals.taken} taken, ${summary.totals.healed} healed`,
  ];
  if (summary.kills) {
    parts.push(`${summary.kills} slain`);
  }
  if (top && top.dealt > 0) {
    parts.push(`${top.name} struck hardest`);
  }
  return parts.join("; ") + ".";
}
