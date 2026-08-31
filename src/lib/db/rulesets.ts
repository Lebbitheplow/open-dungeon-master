import { getDatabase, nowIso, parseJson } from "@/lib/db/core";
import { getCampaignById, updateGameSettings } from "@/lib/db/campaigns";
import { getHouseRulesText, setHouseRules } from "@/lib/db/rules";
import { normalizeGameSettings } from "@/lib/schemas/game-settings";
import { mergeHouseRules, type Ruleset, type VariantRules } from "@/lib/rulesets/logic";
import type { CreateRulesetInput } from "@/lib/schemas/ruleset";

// The DB rim around src/lib/rulesets/logic.ts. A ruleset is the source; a
// campaign holds a copy. Editing a ruleset never reaches into a running
// table, which is the same contract library_characters has with
// character_sheets and for the same reason.

type RulesetRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  variant_rules_json: string;
  house_rules_text: string;
  homebrew_ids_json: string;
  created_at: string;
  updated_at: string;
};

// variantRules is normalized through the game-settings schema on read, so a
// row written before a variant rule existed acquires its default rather than
// returning undefined into engine code that expects a boolean.
function mapRuleset(row: RulesetRow): Ruleset {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description ?? "",
    variantRules: normalizeGameSettings({
      variantRules: parseJson<Partial<VariantRules>>(row.variant_rules_json, {}),
    }).variantRules,
    houseRulesText: row.house_rules_text ?? "",
    homebrewIds: parseJson<string[]>(row.homebrew_ids_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listRulesetsForUser(userId: string): Ruleset[] {
  const rows = getDatabase()
    .prepare(`SELECT * FROM library_rulesets WHERE user_id = ? ORDER BY updated_at DESC`)
    .all(userId) as RulesetRow[];
  return rows.map(mapRuleset);
}

export function getRulesetForUser(userId: string, id: string): Ruleset | null {
  const row = getDatabase()
    .prepare(`SELECT * FROM library_rulesets WHERE id = ? AND user_id = ?`)
    .get(id, userId) as RulesetRow | undefined;
  return row ? mapRuleset(row) : null;
}

export function createRuleset(userId: string, input: CreateRulesetInput): Ruleset {
  const id = crypto.randomUUID();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO library_rulesets
         (id, user_id, name, description, variant_rules_json, house_rules_text,
          homebrew_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      input.name,
      input.description,
      JSON.stringify(input.variantRules),
      input.houseRulesText,
      JSON.stringify(input.homebrewIds),
      now,
      now,
    );
  return getRulesetForUser(userId, id) as Ruleset;
}

export function updateRuleset(
  userId: string,
  id: string,
  patch: Partial<CreateRulesetInput>,
): Ruleset | null {
  const existing = getRulesetForUser(userId, id);
  if (!existing) {
    return null;
  }
  getDatabase()
    .prepare(
      `UPDATE library_rulesets SET name = ?, description = ?, variant_rules_json = ?,
         house_rules_text = ?, homebrew_ids_json = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(
      patch.name ?? existing.name,
      patch.description ?? existing.description,
      JSON.stringify(patch.variantRules ?? existing.variantRules),
      patch.houseRulesText ?? existing.houseRulesText,
      JSON.stringify(patch.homebrewIds ?? existing.homebrewIds),
      nowIso(),
      id,
      userId,
    );
  return getRulesetForUser(userId, id);
}

export function deleteRuleset(userId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(`DELETE FROM library_rulesets WHERE id = ? AND user_id = ?`)
    .run(id, userId);
  return result.changes > 0;
}

// Copy a ruleset onto a campaign or a workshop. The variant flags land in
// game settings, where every engine already reads them; the prose goes
// through setHouseRules so it is chunked and re-embedded exactly as a hand
// edit would be, rather than written straight to the column and left
// invisible to retrieval.
export function applyRulesetToCampaign(
  ruleset: Ruleset,
  campaignId: string,
  houseRulesMode: "replace" | "append" = "replace",
): boolean {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return false;
  }
  updateGameSettings(campaignId, { variantRules: ruleset.variantRules });
  const merged = mergeHouseRules(
    ruleset.houseRulesText,
    getHouseRulesText(campaignId),
    houseRulesMode,
  );
  if (merged !== getHouseRulesText(campaignId)) {
    setHouseRules(campaignId, merged);
  }
  return true;
}

// Capture what a campaign or workshop currently runs as a new library
// ruleset. This is the direction a DM actually works in: they tinker at the
// table, decide they like it, and want it next time.
export function captureRulesetFromCampaign(
  userId: string,
  campaignId: string,
  name: string,
  description = "",
): Ruleset | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }
  return createRuleset(userId, {
    name,
    description,
    variantRules: campaign.gameSettings.variantRules,
    houseRulesText: getHouseRulesText(campaignId),
    homebrewIds: [],
  });
}
