import { withLanguage } from "@/lib/dm/table-language-logic";
import type { Campaign } from "@/lib/db/campaigns";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { bestiaryFor, resolveMonster, suggestEnemies } from "@/lib/bestiary";
import { synthesizeStats } from "@/lib/bestiary/synthesize";
import type { EnemyStats } from "@/lib/bestiary/statblock";
import { listSheets } from "@/lib/db/sheets";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { ADJUDICATIONS } from "@/lib/dm/invoke-catalog";
import type { CatalogEntry } from "@/lib/dm/catalog-types";
import { embed } from "@/lib/embeddings";
import {
  availableEntries,
  catalogEntryText,
  parseSuggestionJson,
  rankBySimilarity,
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
  'You map a player\'s stated intention onto exactly one action the rules engine can perform. You are given every action the engine can perform right now, with their arguments. Return STRICT JSON only, no code fences, shaped: {"name": string, "args": object, "why": string}. name MUST be one of the listed action names. args fills in what you can infer from the intention and leaves out what you cannot; never invent a character name or an id that is not given to you. why is one short clause saying what the roll or effect is for. If no action fits well, return the closest one with empty args.';

// How many of the nearest actions the DM is shown before the model answers.
const SHORTLIST = 5;

let catalogVectors: Promise<Map<string, Float32Array>> | null = null;

// The catalog's vectors, embedded once per process: the catalog only
// changes with the code.
function catalogVectorsOnce(): Promise<Map<string, Float32Array>> {
  catalogVectors ??= embed(ADJUDICATIONS.map(catalogEntryText)).then(
    (vectors) => new Map(ADJUDICATIONS.map((entry, index) => [entry.name, vectors[index]])),
    (error: unknown) => {
      catalogVectors = null;
      throw error;
    },
  );
  return catalogVectors;
}

export type AssistSuggestion = { suggestions: SuggestedAdjudication[]; picked: ParsedSuggestion | null };

// The actions nearest the intent by meaning first, in any language (embedded
// on this server, no model call), then one small model call that picks from
// every action this moment allows and prefills it. The shortlist is what the
// DM sees if the model is slow, unreachable, or simply wrong. An embedder that
// fails leaves the model's pick alone; with no model either, there is
// nothing to suggest, and the DM is told so.
export async function suggestAdjudication(
  campaign: Campaign,
  intent: string,
  options: { inEncounter: boolean; useModel?: boolean },
): Promise<AssistSuggestion | { error: string }> {
  const available = availableEntries(ADJUDICATIONS, options.inEncounter);
  const toSuggestion = (entry: CatalogEntry): SuggestedAdjudication => ({
    name: entry.name,
    label: entry.label,
    summary: entry.summary,
  });
  let suggestions: SuggestedAdjudication[] = [];
  let embedded = true;
  try {
    const [vectors, [intentVector]] = await Promise.all([catalogVectorsOnce(), embed([intent])]);
    suggestions = rankBySimilarity(intentVector, available, vectors, SHORTLIST).map(toSuggestion);
  } catch (error) {
    embedded = false;
    console.error("[assist] the embedder failed; the shortlist is empty", error);
  }
  const unavailable = { error: "Suggestions are unavailable: the embedding model could not be loaded." };
  if (options.useModel === false) {
    return embedded ? { suggestions, picked: null } : unavailable;
  }

  const candidates = available
    .map((entry) => {
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
      { role: "system", content: withLanguage(SUGGEST_SYSTEM, campaign.gameSettings.tableLanguage) },
      {
        role: "user",
        content: [
          `Player's intention: ${intent}`,
          roster ? `The party: ${roster}` : "",
          `Actions:\n${candidates}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  const parsed = error ? null : parseSuggestionJson(stripReasoningArtifacts(String(message?.content ?? "")));
  // A pick that names no action this moment allows is discarded rather than
  // trusted: the console would render a form for an action it cannot run.
  const entry = parsed ? available.find((candidate) => candidate.name === parsed.name) : undefined;
  if (!parsed || !entry) {
    return embedded ? { suggestions, picked: null } : unavailable;
  }
  // The model's pick leads the list, prefilled, whether or not the
  // shortlist had it.
  const picked = { ...toSuggestion(entry), args: parsed.args, why: parsed.why };
  suggestions = [picked, ...suggestions.filter((item) => item.name !== entry.name)].slice(0, SHORTLIST);
  return { suggestions, picked: parsed };
}

// ---- quick statblock ----

export type StatblockMatch = {
  slug: string;
  name: string;
  cr: number;
  type: string;
  blurb: string;
};

// The genre catalog, filtered by name, blurb or creature type ("undead"
// lists every undead in the roster). With no query it returns the CR-spread
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
      type: entry.type,
      blurb: entry.blurb,
    }));
  }
  return bestiaryFor(setting)
    .filter(
      (entry) =>
        entry.name.toLowerCase().includes(trimmed) ||
        entry.slug.includes(trimmed) ||
        entry.type === trimmed ||
        entry.blurb.toLowerCase().includes(trimmed),
    )
    .slice(0, 12)
    .map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      cr: entry.cr,
      type: entry.type,
      blurb: entry.blurb,
    }));
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
      userIds: spellAuthorsFor(campaign),
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
      { role: "system", content: withLanguage(TABLE_SYSTEM, campaign.gameSettings.tableLanguage) },
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
