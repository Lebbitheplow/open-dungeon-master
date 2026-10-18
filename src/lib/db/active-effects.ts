import { textKey } from "@/lib/language/text-logic";
import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getSheetById, patchSheet } from "@/lib/db/sheets";
import { shiftEnemyMaxHp } from "@/lib/db/encounters";
import { publishPersisted } from "@/lib/events";
import { ROUNDS_PER_MINUTE } from "@/lib/dm/condition-logic";
import {
  endEncounterEffects,
  normalizeAura,
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
  aura_json: string | null;
};

function mapRow(row: Row): ActiveEffect {
  const aura = normalizeAura(parseJson<unknown>(row.aura_json ?? "null", null));
  return {
    ...(aura ? { aura } : {}),
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

// ---- maximum hit points ----

// What the "add" maxHp modifiers come to, per target ("kind|id").
function maxHpBonuses(campaignId: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const effect of listEffects(campaignId)) {
    const bonus = effect.modifiers.filter((modifier) => modifier.field === "maxHp" && modifier.mode === "add").reduce((sum, modifier) => sum + modifier.value, 0);
    if (bonus) {
      const key = `${effect.targetKind}|${effect.targetId}`;
      out.set(key, (out.get(key) ?? 0) + bonus);
    }
  }
  return out;
}

// Runs a change to the effects and moves each target's stored maximum by
// what its maxHp modifiers moved, as Aid moves it (sheets.ts maxHpRiders): by
// exact deltas, so lifting an effect gives back what it gave and no more,
// and a raise lifts the current hit points with it.
function followingMaxHp<T>(campaignId: string, change: () => T): T {
  const before = maxHpBonuses(campaignId);
  const out = change();
  const after = maxHpBonuses(campaignId);
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const delta = (after.get(key) ?? 0) - (before.get(key) ?? 0);
    const [kind, id] = key.split("|");
    if (!delta) {
      continue;
    }
    if (kind === "enemy") {
      shiftEnemyMaxHp(id, delta);
      continue;
    }
    const sheet = getSheetById(id);
    const updated = sheet
      ? patchSheet(id, { maxHp: sheet.maxHp + delta, currentHp: delta > 0 ? sheet.currentHp + delta : Math.min(sheet.currentHp, sheet.maxHp + delta) })
      : null;
    if (updated) {
      publishPersisted(campaignId, "sheet_updated", { sheet: updated });
    }
  }
  return out;
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
  aura?: ActiveEffect["aura"];
}): ActiveEffect {
  const id = crypto.randomUUID();
  const now = nowIso();
  followingMaxHp(input.campaignId, () => getDatabase()
    .prepare(
      `INSERT INTO active_effects
        (id, campaign_id, target_kind, target_id, name, source, modifiers_json,
         duration, remaining, save_ability, save_dc, visible, created_at, aura_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.aura ? JSON.stringify(input.aura) : null,
    ));
  return { id, createdAt: now, ...input };
}

export function deleteEffect(campaignId: string, effectId: string): boolean {
  const result = followingMaxHp(campaignId, () => getDatabase()
    .prepare(`DELETE FROM active_effects WHERE campaign_id = ? AND id = ?`)
    .run(campaignId, effectId));
  return result.changes > 0;
}

// Removing by name, which is how a person says it: "the bless is over".
// Case-insensitive because a DM types "Bless" and the AI wrote "bless", and
// by Unicode case (src/lib/language): SQLite's LOWER folds ASCII only.
export function deleteEffectsByName(
  campaignId: string,
  target: { kind: EffectTargetKind; id: string },
  name: string,
): number {
  const db = getDatabase();
  const wanted = textKey(name);
  const ids = (
    db
      .prepare(`SELECT id, name FROM active_effects WHERE campaign_id = ? AND target_kind = ? AND target_id = ?`)
      .all(campaignId, target.kind, target.id) as Array<{ id: string; name: string }>
  )
    .filter((row) => textKey(row.name) === wanted)
    .map((row) => row.id);
  const remove = db.prepare(`DELETE FROM active_effects WHERE campaign_id = ? AND id = ?`);
  followingMaxHp(campaignId, () => db.transaction(() => {
    for (const id of ids) {
      remove.run(campaignId, id);
    }
  })());
  return ids.length;
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
  followingMaxHp(campaignId, run);
  return result.expired;
}

// One combat round passing, the fight's `round` the one now starting. Called
// from the same place condition durations tick, so an effect and a condition
// applied together end together; every tenth round is a minute gone.
export function tickEffectRound(campaignId: string, round: number): ActiveEffect[] {
  const minutePassed = round > 1 && (round - 1) % ROUNDS_PER_MINUTE === 0;
  return persistTick(campaignId, tickRound(listEffects(campaignId), minutePassed));
}

// In-world minutes passing outside a fight: travel, a rest, pass_time. Inside
// one the round wrap owns every lifetime (tickEffectRound), as it owns timed
// conditions, so the same time is never counted twice.
export function tickEffectMinutes(campaignId: string, minutes: number): ActiveEffect[] {
  return persistTick(campaignId, tickMinutes(listEffects(campaignId), minutes, ROUNDS_PER_MINUTE));
}

// The fight ending takes its own effects with it.
export function clearEncounterEffects(campaignId: string): ActiveEffect[] {
  return persistTick(campaignId, endEncounterEffects(listEffects(campaignId)));
}
