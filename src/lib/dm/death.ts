import { allocateSeq, type Campaign } from "@/lib/db/campaigns";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { insertSheetAudit } from "@/lib/db/sheet-audit";
import { insertCharacterEvent } from "@/lib/db/character-events";
import { insertCampaignMessage } from "@/lib/db/messages";
import { insertRoll } from "@/lib/db/rolls";
import { rollExpression } from "@/lib/dice";
import { publishPersisted, publishWithSeq } from "@/lib/events";
import type { CharacterSheet, DeathSaves } from "@/lib/schemas/sheet";
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

function writeDeathState(
  campaign: Campaign,
  turnId: string | null,
  sheet: CharacterSheet,
  deathSaves: DeathSaves,
  kind: string,
  reason: string,
  extraPatch: { currentHp?: number } = {},
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
  insertCharacterEvent({
    libraryCharacterId: sheet.libraryCharacterId,
    campaignCharacterId: sheet.id,
    campaignId: campaign.id,
    seq: allocateSeq(campaign.id),
    kind: "death",
    summary: `Died: ${cause}.`,
  });
}

function tableNote(campaign: Campaign, content: string) {
  const seq = allocateSeq(campaign.id);
  const message = insertCampaignMessage({
    campaignId: campaign.id,
    seq,
    authorType: "system",
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

  // Already at 0 with a track: this damage adds automatic failures and
  // breaks stabilization.
  if (!math.dropped && fresh.deathSaves && !fresh.deathSaves.dead) {
    const next = onDamageAtZero(fresh.deathSaves, crit);
    writeDeathState(campaign, turnId, fresh, next, "death_state", "damage while dying");
    if (next.dead) {
      recordDeath(campaign, fresh, "wounds suffered while dying");
      tableNote(campaign, `${fresh.name} has died of their wounds.`);
      return { dead: true, note: `${fresh.name} is DEAD (their death-save failures reached 3).` };
    }
    return {
      dying: describeTrack(next),
      note: `${fresh.name} takes an automatic death-save failure${crit ? " (two, critical hit)" : ""}: now ${describeTrack(next)}.`,
    };
  }

  if (math.dropped) {
    if (isMassiveDamage(math.overkill, fresh.maxHp)) {
      const track = { ...freshDeathTrack(), failures: 3, dead: true };
      writeDeathState(campaign, turnId, fresh, track, "death_state", "massive damage");
      recordDeath(campaign, fresh, "killed outright by massive damage");
      tableNote(campaign, `${fresh.name} is killed outright by massive damage.`);
      return { dead: true, note: `${fresh.name} is killed INSTANTLY (massive damage). This death is real; narrate it.` };
    }
    writeDeathState(campaign, turnId, fresh, freshDeathTrack(), "death_state", "dropped to 0 HP");
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
  if (!preSheet.deathSaves || preSheet.deathSaves.dead) {
    return {};
  }
  const fresh = getSheetById(preSheet.id);
  if (!fresh || !fresh.deathSaves) {
    return {};
  }
  writeDeathState(campaign, turnId, fresh, null, "death_state", "healed while dying");
  return { note: `${fresh.name} is no longer dying; they are conscious again.` };
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
  const outcome = rollExpression("1d20");
  const roll = insertRoll({
    campaignId: campaign.id,
    characterId: sheet.id,
    requestedBy: "dm",
    kind: "saving_throw",
    detail: "death save",
    dc: 10,
    result: outcome,
  });
  publishWithSeq(campaign.id, allocateSeq(campaign.id), "roll_result", {
    roll,
    source: "digital",
  });
  const applied = applyDeathSaveRoll(track, outcome.total);
  if (applied.outcome === "revive") {
    writeDeathState(campaign, null, sheet, null, "death_state", "natural 20 death save", {
      currentHp: 1,
    });
    tableNote(campaign, `${sheet.name} rolls a natural 20 on their death save and regains 1 HP!`);
    return;
  }
  writeDeathState(campaign, null, sheet, applied.track, "death_state", "automatic death save");
  if (applied.outcome === "dead") {
    recordDeath(campaign, sheet, "failed death saving throws");
    tableNote(campaign, `${sheet.name} fails their final death save and dies.`);
    return;
  }
  if (applied.outcome === "stable") {
    tableNote(
      campaign,
      `${sheet.name} succeeds their third death save and is stable (unconscious at 0 HP).`,
    );
    return;
  }
  tableNote(
    campaign,
    `${sheet.name} death save: rolled ${outcome.total}, ${
      applied.outcome === "success" ? "success" : "failure"
    } (${applied.track.successes} successes, ${applied.track.failures} failures).`,
  );
}
