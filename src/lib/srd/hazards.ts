// Canonical 5e environmental-hazard and trap math, table-driven and pure so
// scripts/test-hazards.mjs can exercise it without a database. The DM names a
// hazard and the server produces the real save ability, DC, and damage dice
// from the book instead of the model inventing numbers that drift scene to
// scene. Mirrors the encounter-math.ts style.

// --- Falling (PHB): 1d6 bludgeoning per 10 feet fallen, capped at 20d6. ---
export function fallingDamageDice(feet: number): string {
  const d6 = Math.max(0, Math.min(20, Math.floor((Number(feet) || 0) / 10)));
  return d6 > 0 ? `${d6}d6` : "0";
}

// --- Traps: severity x character tier -> save DC and damage dice, from the
// DMG "Damage Severity by Level" and trap save-DC bands. A trap's danger is
// read from the VICTIM's own level, so the same pit is a scratch to a name-
// level party and lethal to first-level characters. ---

export type TrapSeverity = "setback" | "dangerous" | "deadly";
export type TrapTier = 1 | 2 | 3 | 4; // levels 1-4, 5-10, 11-16, 17-20

export function tierForLevel(level: number): TrapTier {
  const lvl = Number(level) || 1;
  if (lvl <= 4) return 1;
  if (lvl <= 10) return 2;
  if (lvl <= 16) return 3;
  return 4;
}

// Representative DC from each severity's band (setback 10-11, dangerous 12-15,
// deadly 16-20). One value keeps traps consistent without a second knob.
const TRAP_SAVE_DC: Record<TrapSeverity, number> = {
  setback: 11,
  dangerous: 13,
  deadly: 18,
};

export function trapSaveDc(severity: TrapSeverity): number {
  return TRAP_SAVE_DC[severity];
}

// DMG "Damage Severity by Level" (d10s of damage).
const TRAP_DAMAGE: Record<TrapSeverity, Record<TrapTier, string>> = {
  setback: { 1: "1d10", 2: "2d10", 3: "4d10", 4: "10d10" },
  dangerous: { 1: "2d10", 2: "4d10", 3: "10d10", 4: "18d10" },
  deadly: { 1: "4d10", 2: "10d10", 3: "18d10", 4: "24d10" },
};

export function trapDamageDice(severity: TrapSeverity, level: number): string {
  return TRAP_DAMAGE[severity][tierForLevel(level)];
}

export type TrapProfile = {
  saveAbility: "dex";
  saveDc: number;
  damageDice: string;
  tier: TrapTier;
};

// A trap's full mechanical profile against one victim: a Dexterity save (the
// default for darts, blades, and collapsing floors), the DC from its severity,
// and the damage scaled to the victim's tier.
export function trapProfile(severity: TrapSeverity, level: number): TrapProfile {
  return {
    saveAbility: "dex",
    saveDc: trapSaveDc(severity),
    damageDice: trapDamageDice(severity, level),
    tier: tierForLevel(level),
  };
}

// --- Suffocation / drowning (PHB): a creature can hold its breath for
// 1 + CON modifier minutes (minimum 30 seconds). Out of air, it survives a
// number of rounds equal to its CON modifier (minimum 1), then drops to 0 HP
// and is dying. ---
export function breathHoldMinutes(conMod: number): number {
  return Math.max(0.5, 1 + (Number(conMod) || 0));
}

export function suffocationRounds(conMod: number): number {
  return Math.max(1, Number(conMod) || 0);
}

// --- Extreme cold (DMG): CON save DC 10 each hour of exposure or gain one
// level of exhaustion; creatures with cold resistance/immunity or cold-weather
// gear are unaffected. ---
export function extremeColdSave(): { ability: "con"; dc: number; onFail: string } {
  return { ability: "con", dc: 10, onFail: "one level of exhaustion" };
}

// --- Extreme heat (DMG): CON save each hour to avoid a level of exhaustion.
// The DC starts at 5 and rises by 1 for each hour after the first. ---
export function extremeHeatSave(hour: number): { ability: "con"; dc: number; onFail: string } {
  const h = Math.max(1, Math.round(Number(hour) || 1));
  return { ability: "con", dc: 5 + (h - 1), onFail: "one level of exhaustion" };
}
