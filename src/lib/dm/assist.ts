import type { Campaign } from "@/lib/db/campaigns";
import { bestiaryFor, resolveMonster, suggestEnemies } from "@/lib/bestiary";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { listSheets } from "@/lib/db/sheets";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { ADJUDICATIONS } from "@/lib/dm/invoke-catalog";
import { findAdjudication } from "@/lib/dm/catalog-types";
import {
  parseSuggestionJson,
  rankAdjudications,
  type ParsedSuggestion,
} from "@/lib/dm/assist-logic";
import { parseRollTable, TABLE_MAX_ENTRIES, type RollTableEntry } from "@/lib/dm/roll-table-logic";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// The DM's assist rail: read-only answers from engines that already exist.
// Nothing here applies anything. Every function returns something the DM
// looks at and then decides about, which is the whole contract of the phase.

// ---- intent to adjudication ----

export type SuggestedAdjudication = {
  name: string;
  label: string;
  summary: string;
  // Prefilled arguments, present only on the model's own pick.
  args?: Record<string, unknown>;
  why?: string;
};

const SUGGEST_SYSTEM =
  'You map a player\'s stated intention onto exactly one action the rules engine can perform. You are given a shortlist of candidate actions with their arguments. Return STRICT JSON only, no code fences, shaped: {"name": string, "args": object, "why": string}. name MUST be one of the candidate names. args fills in what you can infer from the intention and leaves out what you cannot; never invent a character name or an id that is not given to you. why is one short clause saying what the roll or effect is for. If none of the candidates fits, return the closest one with empty args.';

// A keyword shortlist first, always, then one small model call to pick among
// it and prefill. The shortlist is what the DM sees if the model is slow,
// unreachable, or simply wrong.
export async function suggestAdjudication(
  campaign: Campaign,
  intent: string,
  options: { inEncounter: boolean; useModel?: boolean },
): Promise<{ suggestions: SuggestedAdjudication[]; picked: ParsedSuggestion | null }> {
  const ranked = rankAdjudications(intent, ADJUDICATIONS, {
    inEncounter: options.inEncounter,
    limit: 5,
  });
  const suggestions: SuggestedAdjudication[] = ranked.map(({ entry }) => ({
    name: entry.name,
    label: entry.label,
    summary: entry.summary,
  }));
  if (!ranked.length || options.useModel === false) {
    return { suggestions, picked: null };
  }

  const candidates = ranked
    .map(({ entry }) => {
      const fields = entry.fields
        .map((field) => `${field.name} (${field.kind}${field.required ? ", required" : ""})`)
        .join(", ");
      return `- ${entry.name}: ${entry.summary}\n  arguments: ${fields || "none"}`;
    })
    .join("\n");
  const roster = listSheets(campaign.id)
    .map((sheet) => `${sheet.name} (id ${sheet.id})`)
    .join("; ");

  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: SUGGEST_SYSTEM },
      {
        role: "user",
        content: [
          `Player's intention: ${intent}`,
          roster ? `The party: ${roster}` : "",
          `Candidate actions:\n${candidates}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    return { suggestions, picked: null };
  }
  const parsed = parseSuggestionJson(stripReasoningArtifacts(String(message?.content ?? "")));
  // A pick that names something outside the shortlist is discarded rather
  // than trusted: the console would render a form for an action the DM never
  // saw proposed.
  if (!parsed || !ranked.some(({ entry }) => entry.name === parsed.name)) {
    return { suggestions, picked: null };
  }
  const entry = findAdjudication(ADJUDICATIONS, parsed.name);
  if (entry) {
    const index = suggestions.findIndex((item) => item.name === parsed.name);
    if (index >= 0) {
      suggestions[index] = { ...suggestions[index], args: parsed.args, why: parsed.why };
      // The model's pick leads the list.
      suggestions.unshift(...suggestions.splice(index, 1));
    }
  }
  return { suggestions, picked: parsed };
}

// ---- quick statblock ----

export type StatblockMatch = {
  slug: string;
  name: string;
  cr: number;
  blurb: string;
};

// The genre catalog, filtered by name. With no query it returns the CR-spread
// shortlist the encounter builder already uses, so an empty box is still a
// useful answer.
export function searchStatblocks(campaign: Campaign, query: string): StatblockMatch[] {
  const setting = campaign.gameSettings;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    const levels = listSheets(campaign.id).map((sheet) => sheet.level);
    return suggestEnemies(setting, levels, 12).map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      cr: entry.cr,
      blurb: entry.blurb,
    }));
  }
  return bestiaryFor(setting)
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(trimmed) ||
        entry.slug.includes(trimmed) ||
        entry.blurb.toLowerCase().includes(trimmed),
    )
    .slice(0, 12)
    .map((entry) => ({ slug: entry.slug, name: entry.name, cr: entry.cr, blurb: entry.blurb }));
}

export type StatblockResult = {
  name: string;
  // The catalog's reskin name when the setting renames the base monster.
  reskinName: string | null;
  stats: EnemyStats;
  // True when nothing matched and the numbers came from the DMG's
  // by-CR baseline instead of a real stat block.
  synthesized: boolean;
};

// One monster, resolved the same way the spawner resolves it, so what the DM
// previews is exactly what start_encounter would put on the board. Falls back
// to the DMG baseline at a requested CR, which is what "generate at a target
// CR" means: honest numbers, no invention.
export function quickStatblock(
  campaign: Campaign,
  input: { ref?: string; cr?: number },
): StatblockResult | null {
  const ref = (input.ref ?? "").trim();
  if (ref) {
    const resolved = resolveMonster(ref, campaign.gameSettings, {
      userId: campaign.ownerUserId,
    });
    if (resolved) {
      return {
        name: resolved.reskinName ?? resolved.baseName,
        reskinName: resolved.reskinName,
        stats: resolved.stats,
        synthesized: false,
      };
    }
  }
  if (typeof input.cr === "number") {
    return {
      name: ref || `CR ${input.cr} threat`,
      reskinName: null,
      stats: synthesizeStats(input.cr),
      synthesized: true,
    };
  }
  return null;
}

// ---- roll table generation ----

const TABLE_SYSTEM =
  "You write random tables for a tabletop RPG session. Output ONLY the rows, one per line, each beginning with its number and a full stop, like '1. A cart has thrown a wheel across the road.' No heading, no commentary, no blank lines. Each row is one concrete thing a Dungeon Master can drop straight into play, under 25 words, in the tone of the setting you are given.";

export async function generateRollTable(
  campaign: Campaign,
  input: { prompt: string; rows: number; context?: string },
): Promise<{ entries: RollTableEntry[]; error?: string }> {
  const rows = Math.max(2, Math.min(TABLE_MAX_ENTRIES, Math.round(input.rows)));
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: TABLE_SYSTEM },
      {
        role: "user",
        content: [
          `Setting: ${campaign.theme || campaign.gameSettings.genre.replace(/_/g, " ")}`,
          input.context ? `Where this happens: ${input.context}` : "",
          `Write a ${rows}-row table: ${input.prompt}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    return { entries: [], error: "The model could not be reached." };
  }
  const entries = parseRollTable(
    stripReasoningArtifacts(String(message?.content ?? "")),
  ).slice(0, rows);
  if (entries.length < 2) {
    return { entries: [], error: "The model returned nothing usable." };
  }
  return { entries };
}
