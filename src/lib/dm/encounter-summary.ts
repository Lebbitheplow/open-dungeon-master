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
  enemies: Array<{ status: string }>;
  sheets: Array<{ id: string; name: string }>;
  rolls: SummaryRoll[];
  audits: SummaryAudit[];
}): EncounterSummary {
  const lines = new Map<string, FighterLine>(
    input.sheets.map((sheet) => [sheet.id, { characterId: sheet.id, name: sheet.name, dealt: 0, taken: 0, healed: 0, nat20s: 0, nat1s: 0 }]),
  );
  for (const roll of input.rolls) {
    const line = roll.characterId ? lines.get(roll.characterId) : undefined;
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
