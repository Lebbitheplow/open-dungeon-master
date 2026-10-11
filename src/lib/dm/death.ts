import { deathSaveFeat } from "@/lib/srd/feat-combat";
import type { SystemGlyph } from "@/lib/system-glyphs";
import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { noteDeathMoment } from "@/lib/dm/revival";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet, DeathSaves, FullPatchSheetInput } from "@/lib/schemas/sheet";
import { effectiveMaxHp } from "@/lib/dm/condition-logic";
import { conditionDeathSaveAdvantage } from "@/lib/srd/condition-effect-queries";
import { resolveRollExpression, type RollArgs } from "@/lib/dm/rolls";
import { rollExtrasFor, spendRollCarriers } from "@/lib/dm/forced-save";
import {
  downConditions,
  stableTimer,
  wakeConditions,
  withoutStableTimer,
} from "@/lib/dm/vitals-logic";
import {
  applyDeathSaveRoll,
  freshDeathTrack,
  isMassiveDamage,
  onDamageAtZero,
} from "@/lib/dm/death-logic";

// The dying engine: a PC dropping to 0 HP gets a server-tracked death-save
// state, saves roll automatically at the top of their skipped combat turns,
// and healing or stabilizing clears the track. Every write is audited so
// the party lead can undo it. This module must not import mutations.ts or
// encounter-tools.ts (both import it).
//
// The body follows the track (src/lib/dm/vitals-logic.ts): a character who
// drops is unconscious and prone, one who is healed wakes and stays prone,
// and a stable one regains a hit point once 1d4 hours have passed.

type DeathExtra = Pick<FullPatchSheetInput, "currentHp" | "conditions" | "conditionMeta">;

function writeDeathState(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  deathSaves: DeathSaves,
  kind: string,
  reason: string,
  extraPatch: DeathExtra = {},
) {
  const patch = { deathSaves, ...extraPatch };
  const updated = patchSheet(sheet.id, patch);
  const entry = insertSheetAudit({
    campaignId: campaign.id,
    characterId: sheet.id,
    turnId,
    kind,
    delta: { deathSaves, ...extraPatch },
    reason,
    seq: allocateSeq(campaign.id),
    before: sheet,
    patch,
  });
  publishPersisted(campaign.id, "sheet_audit", { entry, characterName: sheet.name });
  if (updated) {
    publishPersisted(campaign.id, "sheet_updated", { sheet: updated });
  }
}

function recordDeath(campaign: Campaign, sheet: CharacterSheet, cause: string) {
  // When, in the world's time: the window a revival spell holds to.
  noteDeathMoment(campaign.id, sheet.id);
  insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "death",
    summary: `Died: ${cause}.`,
  });
}

function tableNote(campaign: Campaign, content: string, glyph: SystemGlyph) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
    glyph,
    content,
  });
  publishWithSeq(campaign.id, seq, "message_added", { message });
}

export function describeTrack(track: DeathSaves): string {
  if (!track) {
    return "";
  }
  if (track.dead) {
    return "DEAD";
  }
  if (track.stable) {
    return "stable at 0 HP";
  }
  return `dying: ${track.successes} successes, ${track.failures} failures`;
}

// Called from apply_damage after the HP math lands. `preSheet` is the
// pre-mutation sheet. Returns extra fields merged into the tool result.
export function applyDamageDeathHook(
  campaign: Campaign,
  // Null for damage the server applies outside a DM turn, such as an
  // opportunity attack triggered by a player's own token move.
  turnId: string | null,
  preSheet: CharacterSheet,
  math: { currentHp: number; dropped: boolean; overkill: number },
  crit: boolean,
): Record<string, unknown> {
  if (math.currentHp > 0) {
    return {};
  }
  const fresh = getSheetById(preSheet.id);
  if (!fresh) {
    return {};
  }

  // Already at 0 with a track: damage as large as the hit point maximum
  // kills outright, anything less adds automatic failures and breaks
  // stabilization.
  if (!math.dropped && fresh.deathSaves && !fresh.deathSaves.dead) {
    if (isMassiveDamage(math.overkill, effectiveMaxHp(fresh))) {
      const track = { ...freshDeathTrack(), failures: 3, dead: true };
      writeDeathState(campaign, turnId, fresh, track, "death_state", "massive damage at 0 HP");
      recordDeath(campaign, fresh, "killed outright by massive damage");
      tableNote(campaign, `${fresh.name} is killed outright by massive damage.`, "cue-death");
      return { dead: true, note: `${fresh.name} is killed INSTANTLY (massive damage while at 0 HP). This death is real; narrate it.` };
    }
    const next = onDamageAtZero(fresh.deathSaves, crit);
    writeDeathState(
      campaign,
      turnId,
      fresh,
      next,
      "death_state",
      "damage while dying",
      fresh.deathSaves.stable ? { conditionMeta: withoutStableTimer(fresh.conditionMeta) } : {},
    );
    if (next.dead) {
      recordDeath(campaign, fresh, "wounds suffered while dying");
      tableNote(campaign, `${fresh.name} has died of their wounds.`, "cue-death");
      return { dead: true, note: `${fresh.name} is DEAD (their death-save failures reached 3).` };
    }
    return {
      dying: describeTrack(next),
      note: `${fresh.name} takes an automatic death-save failure${crit ? " (two, critical hit)" : ""}: now ${describeTrack(next)}.`,
    };
  }

  if (math.dropped) {
    if (isMassiveDamage(math.overkill, effectiveMaxHp(fresh))) {
      const track = { ...freshDeathTrack(), failures: 3, dead: true };
      writeDeathState(campaign, turnId, fresh, track, "death_state", "massive damage");
      recordDeath(campaign, fresh, "killed outright by massive damage");
      tableNote(campaign, `${fresh.name} is killed outright by massive damage.`, "cue-death");
      return { dead: true, note: `${fresh.name} is killed INSTANTLY (massive damage). This death is real; narrate it.` };
    }
    writeDeathState(
      campaign,
      turnId,
      fresh,
      freshDeathTrack(),
      "death_state",
      "dropped to 0 HP",
      downConditions(fresh),
    );
    return {
      dying: true,
      note: `${fresh.name} is unconscious and DYING at 0 HP. The server rolls their death saves automatically in combat. Healing any amount revives them; the stabilize tool stops the dying after a successful DC 10 Medicine check or a healer's kit.`,
    };
  }
  return {};
}

// Called from heal after HP is restored: any healing ends the dying state.
export function healDeathHook(
  campaign: Campaign,
  turnId: string,
  preSheet: CharacterSheet,
): Record<string, unknown> {
  if (preSheet.deathSaves?.dead || preSheet.currentHp > 0) {
    return {};
  }
  const fresh = getSheetById(preSheet.id);
  if (!fresh || fresh.currentHp <= 0) {
    return {};
  }
  // A sheet that reached 0 before the track or the conditions were kept has
  // nothing to clear.
  const asleep = fresh.conditions.some((entry) => entry.toLowerCase() === "unconscious");
  if (!fresh.deathSaves && !asleep) {
    return {};
  }
  writeDeathState(
    campaign,
    turnId,
    fresh,
    null,
    "death_state",
    "healed while dying",
    wakeConditions(fresh),
  );
  return {
    note: `${fresh.name} is no longer dying; they are conscious again, and prone until they stand.`,
  };
}

// A stabilized creature's wait for its hit point: 1d4 hours, rolled here so
// the table sees the die. Returns the condition metadata carrying the wait.
export function rollStableTimer(campaign: Campaign, sheet: CharacterSheet) {
  const outcome = rollExpression("1d4");
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "custom",
    detail: `hours until ${sheet.name} regains 1 hit point (1d4)`,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const held = downConditions(sheet);
  return {
    hours: outcome.total,
    conditions: held.conditions,
    conditionMeta: stableTimer(held, outcome.total),
  };
}

// The hit point a stable creature regains when its wait is over. Called by
// the condition clocks (src/lib/dm/condition-tick.ts); returns the line for
// the table, or null when the character is not waiting.
export function wakeStable(campaign: Campaign, characterId: string): string | null {
  const sheet = getSheetById(characterId);
  const track = sheet?.deathSaves;
  if (!sheet || !track?.stable || track.dead || sheet.currentHp > 0) {
    return null;
  }
  writeDeathState(campaign, null, sheet, null, "death_state", "stable, and the hours have passed", {
    currentHp: 1,
    ...wakeConditions(sheet),
  });
  return `${sheet.name} comes round with 1 hit point.`;
}

// One automatic death save, rolled server-side when the initiative pointer
// passes a dying PC. Publishes the dice card and a table note so both the
// players and the model (via history) see the result.
export function rollDeathSave(campaign: Campaign, characterId: string): void {
  const sheet = getSheetById(characterId);
  const track = sheet?.deathSaves;
  if (!sheet || !track || track.stable || track.dead || sheet.currentHp > 0) {
    return;
  }
  // A death save is a saving throw tied to no ability: it takes what every
  // save takes (exhaustion, Bless and Bane, a paladin's aura, a Ring of
  // Protection, a held inspiration die, a halfling's Lucky) through the one
  // roll builder every other save uses (src/lib/dm/rolls.ts).
  // Beacon of Hope: death saves with advantage (condition-effects.ts).
  const hope = conditionDeathSaveAdvantage(sheet.conditions);
  // Diehard: advantage on death saves; Survivor: on the first of a fall
  // (src/lib/srd/feat-combat.ts).
  const feat = deathSaveFeat(sheet, track);
  const claim = hope ?? feat;
  const resolved = resolveRollExpression(
    {
      kind: "saving_throw",
      ...(claim ? { advantage: "advantage", advantageReason: `${claim}: advantage` } : {}),
    } as RollArgs,
    sheet,
    { ...rollExtrasFor(campaign, sheet, "saving_throw"), death: true },
  );
  if ("error" in resolved || "autoFail" in resolved) {
    return;
  }
  spendRollCarriers(campaign.id, sheet.id, resolved.spendInspiration);
  const outcome = rollExpression(resolved.expression);
  const advantage = /^2d20kh1/.test(resolved.expression) ? "advantage" : /^2d20kl1/.test(resolved.expression) ? "disadvantage" : "none";
  const notes = [...(resolved.conditionNotes ?? []), ...(hope ? [`${hope}: advantage`] : []), ...(feat ? [`${feat}: advantage`] : [])];
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: `death save${notes.length ? ` (${notes.join("; ")})` : ""}`.slice(0, 200),
    dc: 10,
    ...(advantage === "none" ? {} : { advantage }),
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const applied = applyDeathSaveRoll(track, outcome.natural ?? outcome.total, outcome.total);
  if (applied.outcome === "revive") {
    writeDeathState(campaign, null, sheet, null, "death_state", "natural 20 death save", {
      currentHp: 1,
      ...wakeConditions(sheet),
    });
    tableNote(campaign, `${sheet.name} rolls a natural 20 on their death save and regains 1 HP!`, "cue-heal");
    return;
  }
  if (applied.outcome === "stable") {
    const wait = rollStableTimer(campaign, sheet);
    writeDeathState(campaign, null, sheet, applied.track, "death_state", "automatic death save", {
      conditions: wait.conditions,
      conditionMeta: wait.conditionMeta,
    });
    tableNote(
      campaign,
      `${sheet.name} succeeds their third death save and is stable (unconscious at 0 HP). They regain 1 hit point in ${wait.hours} hour${wait.hours === 1 ? "" : "s"}.`,
      "cue-heal",
    );
    return;
  }
  writeDeathState(campaign, null, sheet, applied.track, "death_state", "automatic death save");
  if (applied.outcome === "dead") {
    recordDeath(campaign, sheet, "failed death saving throws");
    tableNote(campaign, `${sheet.name} fails their final death save and dies.`, "cue-death");
    return;
  }
  tableNote(
    campaign,
    `${sheet.name} death save: rolled ${outcome.total}, ${
      applied.outcome === "success" ? "success" : "failure"
    } (${applied.track.successes} successes, ${applied.track.failures} failures).`,
    "die-d20",
  );
}
