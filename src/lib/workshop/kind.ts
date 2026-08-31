// What a campaigns row is for, and the guards that keep the two kinds apart.
//
// A workshop IS a campaigns row (docs/workshop-plan.md section 1). That is
// deliberate: every content table, route guard, projection and panel already
// keys off campaign_id, so a prep space that is a campaign inherits all of it
// for free, and importing prep into a real table becomes a row copy between
// two campaign ids rather than a second storage shape.
//
// The cost of that choice is that a workshop must never behave like a table
// that plays: no AI turn, no world tick, no seat in a campaign list. Those
// guards are the whole safety argument for the design, so they live here, as
// pure predicates, and scripts/test-workshop-isolation.mjs asserts them.
//
// Pure by design: no "@/" imports and no I/O, so the test can drive it.

export const CAMPAIGN_KINDS = ["campaign", "workshop"] as const;
export type CampaignKind = (typeof CAMPAIGN_KINDS)[number];

// Rows written before the column existed read as NULL, and anything a client
// invents reads as garbage. Both mean "a table that plays", which is the
// answer that preserves existing behaviour for every campaign in the file.
export function normalizeCampaignKind(raw: unknown): CampaignKind {
  return raw === "workshop" ? "workshop" : "campaign";
}

export function isWorkshop(row: { kind: CampaignKind }): boolean {
  return row.kind === "workshop";
}

// The single predicate every AI entry point asks before it spends a model
// call on a campaign. Phrased as a capability rather than as "not a
// workshop" so a future third kind has one obvious place to declare itself.
export function runsAiTurns(row: { kind: CampaignKind }): boolean {
  return row.kind === "campaign";
}

// ---- the stand-in party ----

// Three prep tools need a party that does not exist yet: the encounter
// calculator wants levels, the odds panel wants a target, and the map studio
// refuses to open a scene with nobody on it. Rather than fabricate character
// sheets, a workshop declares the party it is building for, once, and every
// tool reads it.
export type TargetParty = { size: number; level: number };

export const DEFAULT_TARGET_PARTY: TargetParty = { size: 4, level: 3 };

export const TARGET_PARTY_LIMITS = {
  size: { min: 1, max: 8 },
  level: { min: 1, max: 20 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeTargetParty(raw: unknown): TargetParty {
  const input = (raw ?? {}) as Partial<TargetParty>;
  const size = Number(input.size);
  const level = Number(input.level);
  return {
    size: Number.isFinite(size)
      ? clamp(Math.round(size), TARGET_PARTY_LIMITS.size.min, TARGET_PARTY_LIMITS.size.max)
      : DEFAULT_TARGET_PARTY.size,
    level: Number.isFinite(level)
      ? clamp(Math.round(level), TARGET_PARTY_LIMITS.level.min, TARGET_PARTY_LIMITS.level.max)
      : DEFAULT_TARGET_PARTY.level,
  };
}

// The shape src/lib/srd/encounter-math.ts already takes: one level per
// character. A workshop party is uniform by construction, which is the
// honest simplification, because a DM budgeting an encounter before session
// one does not yet know that the rogue will be a level behind.
export function targetPartyLevels(party: TargetParty): number[] {
  return Array.from({ length: party.size }, () => party.level);
}
