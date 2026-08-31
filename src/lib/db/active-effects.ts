import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import {
  endEncounterEffects,
  tickMinutes,
  tickRound,
  type ActiveEffect,
  type EffectModifier,
  type EffectTargetKind,
} from "@/lib/dm/effects-logic";

// The active-effect instance store.
//
// A table of its own, unlike conditions (which live as a string list on the
// sheet), because an effect carries structure a string cannot: several
// modifiers, a duration in a unit of its own choosing, a source, and a save.
// Rows are per (campaign, target kind, target id), so a character and an
// enemy are addressed the same way and nothing has to know which is which.

type Row = {
  id: string;
  campaign_id: string;
  target_kind: string;
  target_id: string;
  name: string;
  source: string;
  modifiers_json: string;
  duration: string;
  remaining: number;
  save_ability: string;
  save_dc: number;
  visible: number;
  created_at: string;
};

function mapRow(row: Row): ActiveEffect {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    targetKind: row.target_kind as EffectTargetKind,
    targetId: row.target_id,
    name: row.name,
    source: row.source,
    modifiers: parseJson<EffectModifier[]>(row.modifiers_json, []),
    duration: row.duration as ActiveEffect["duration"],
    remaining: row.remaining,
    saveAbility: row.save_ability,
    saveDc: row.save_dc,
    visible: row.visible === 1,
    createdAt: row.created_at,
  };
}

export function listEffects(
  campaignId: string,
  target?: { kind: EffectTargetKind; id: string },
): ActiveEffect[] {
  const db = getDatabase();
  const rows = target
    ? (db
        .prepare(
          `SELECT * FROM active_effects
            WHERE campaign_id = ? AND target_kind = ? AND target_id = ?
            ORDER BY created_at ASC`,
        )
        .all(campaignId, target.kind, target.id) as Row[])
    : (db
        .prepare(`SELECT * FROM active_effects WHERE campaign_id = ? ORDER BY created_at ASC`)
        .all(campaignId) as Row[]);
  return rows.map(mapRow);
}

export function insertEffect(input: {
  campaignId: string;
  targetKind: EffectTargetKind;
  targetId: string;
  name: string;
  source: string;
  modifiers: EffectModifier[];
  duration: ActiveEffect["duration"];
  remaining: number;
  saveAbility: string;
  saveDc: number;
  visible: boolean;
}): ActiveEffect {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO active_effects
        (id, campaign_id, target_kind, target_id, name, source, modifiers_json,
         duration, remaining, save_ability, save_dc, visible, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.campaignId,
      input.targetKind,
      input.targetId,
      input.name,
      input.source,
      JSON.stringify(input.modifiers),
      input.duration,
      input.remaining,
      input.saveAbility,
      input.saveDc,
      input.visible ? 1 : 0,
      now,
    );
  return { id, createdAt: now, ...input };
}

export function deleteEffect(campaignId: string, effectId: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM active_effects WHERE campaign_id = ? AND id = ?`)
    .run(campaignId, effectId);
  return result.changes > 0;
}

// Removing by name, which is how a person says it: "the bless is over".
// Case-insensitive because a DM types "Bless" and the AI wrote "bless".
export function deleteEffectsByName(
  campaignId: string,
  target: { kind: EffectTargetKind; id: string },
  name: string,
): number {
  const result = getDatabase()
    .prepare(
      `DELETE FROM active_effects
        WHERE campaign_id = ? AND target_kind = ? AND target_id = ?
          AND LOWER(name) = LOWER(?)`,
    )
    .run(campaignId, target.kind, target.id, name.trim());
  return result.changes;
}

function persistTick(
  campaignId: string,
  result: { kept: ActiveEffect[]; expired: ActiveEffect[] },
): ActiveEffect[] {
  const db = getDatabase();
  const update = db.prepare(`UPDATE active_effects SET remaining = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM active_effects WHERE id = ?`);
  const run = db.transaction(() => {
    for (const effect of result.kept) {
      update.run(effect.remaining, effect.id);
    }
    for (const effect of result.expired) {
      remove.run(effect.id);
    }
  });
  run();
  return result.expired;
}

// One combat round passing. Called from the same place condition durations
// tick, so an effect and a condition applied together end together.
export function tickEffectRound(campaignId: string): ActiveEffect[] {
  return persistTick(campaignId, tickRound(listEffects(campaignId)));
}

// In-world minutes passing: travel, a rest, pass_time. This is what the
// campaign clock bought, and the reason "for an hour" is now a thing an
// effect can say.
export function tickEffectMinutes(campaignId: string, minutes: number): ActiveEffect[] {
  return persistTick(campaignId, tickMinutes(listEffects(campaignId), minutes));
}

// The fight ending takes its own effects with it.
export function clearEncounterEffects(campaignId: string): ActiveEffect[] {
  return persistTick(campaignId, endEncounterEffects(listEffects(campaignId)));
}
