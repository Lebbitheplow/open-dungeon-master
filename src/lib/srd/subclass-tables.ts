// Subclasses the bundled tables do not carry, as tables the feature grants
// can read: a workshop subclass (homebrew_entries kind "archetype", its
// features by level as { n, d }) and a content-pack archetype written as
// prose ("##### Roar of Defiance / Beginning at 3rd level, ..."). Without
// these a character who took one got the base class's features and none of
// the subclass's (src/lib/srd/features.ts classFeaturesFor), and a workshop
// copy of a published subclass started with no features at all.
//
// They reach the grants as `extras`, per table: a homebrew subclass is its
// author's, so two DMs' "Oath of Ash" never share features (the server
// builds them for whoever runs the table, src/lib/characters/
// subclass-extras.ts; the builder from the rows it fetched). Pure.

import {
  defaultThirdCasterProfile,
  isThirdCasterProfile,
  thirdCasterProfileForFeature,
  thirdCasterProfileForPackSubclass,
  type ThirdCasterProfile,
} from "@/lib/srd/third-caster";

export type SubclassFeatureRow = { n: string; d: string };

export type ExtraSubclass = {
  name: string;
  levels: Record<string, SubclassFeatureRow[]>;
  // Always-prepared spells by class level (a domain's, an oath's).
  spells?: Record<string, string[]>;
  // Casts as an Eldritch Knight or Arcane Trickster does (src/lib/srd/
  // third-caster.ts). Read only for a class that casts nothing of its own
  // (src/lib/srd/features.ts subclassCastingProfileFor).
  castingProfile?: ThirdCasterProfile;
  source: "homebrew" | "pack";
};

// By class id.
export type SubclassExtras = Record<string, ExtraSubclass[]>;

// The subclasses the browser fetched or was sent for this person: the
// builder's and the level-up dialog's archetype rows (src/app/characters/
// builder/useBuilderOptions.ts useArchetypes) and the campaign snapshot's
// (useCampaignStream). src/lib/srd/features.ts reads them when a caller
// passes no extras of its own. Set only in the browser, where everything
// fetched is this one person's to see. Kept here, apart from features.ts,
// so the campaign page registers them without loading the class tables
// into its first load (scripts/bundle-budget.json).
const browserExtras: SubclassExtras = {};

export function registerBrowserSubclassExtras(classId: string, tables: SubclassExtras[string]): void {
  if (typeof window === "undefined") {
    return;
  }
  browserExtras[classId] = tables;
}

export function browserSubclassExtras(): SubclassExtras {
  return browserExtras;
}

const ORDINAL = /\b(?:at|beginning at|starting at|when you reach|by|upon reaching|once you reach)\s+(\d{1,2})(?:st|nd|rd|th)\s+level/i;
const LEVEL_ANYWHERE = /\b(\d{1,2})(?:st|nd|rd|th)[- ]level\b/i;

// The features a prose archetype prints under its "#####" headings, each at
// the first level its text names (the class's subclass level when it names
// none). The text kept is the feature's own paragraph, trimmed.
export function subclassLevelsFromProse(desc: string, defaultLevel = 3): Record<string, SubclassFeatureRow[]> {
  const levels: Record<string, SubclassFeatureRow[]> = {};
  // "##### Roar of Defiance", "#####Hellish Aspect" and " ##### Bloodletting
  // Focus" are all headings in the pack's markdown.
  const parts = String(desc ?? "").split(/^\s*#{3,6}\s*/m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const name = head.replace(/[*_]/g, "").trim().slice(0, 80);
    const body = rest.join("\n").replace(/\s+/g, " ").trim();
    if (!name || !body) {
      continue;
    }
    const found = ORDINAL.exec(body) ?? LEVEL_ANYWHERE.exec(body);
    const level = found ? Math.min(20, Math.max(1, Number(found[1]))) : defaultLevel;
    (levels[String(level)] ??= []).push({ n: name, d: body.slice(0, 500) });
  }
  return levels;
}

type Row = { name: string; source: string; data: Record<string, unknown> };

function homebrewLevels(raw: unknown): Record<string, SubclassFeatureRow[]> {
  const out: Record<string, SubclassFeatureRow[]> = {};
  for (const [level, rows] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (!Array.isArray(rows)) continue;
    const features = rows
      .map((row) => ({ n: String((row as SubclassFeatureRow)?.n ?? "").trim(), d: String((row as SubclassFeatureRow)?.d ?? "") }))
      .filter((row) => row.n);
    if (features.length) {
      out[level] = features;
    }
  }
  return out;
}

function spellLevels(raw: unknown): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {};
  for (const [level, names] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    const list = Array.isArray(names) ? names.map((name) => String(name).trim()).filter(Boolean) : [];
    if (list.length) {
      out[level] = list;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

// A workshop subclass casts as a third caster when its author said so (the
// Eldritch Knight's rules or the Arcane Trickster's), or, when they said
// nothing, when it holds either one's Spellcasting feature: a copy of
// either, or a subclass that borrowed the feature, casts without a second
// setting to find. "none" is the author turning that off; "third-caster"
// is the first spelling, the class's own.
function castingProfileOf(data: Record<string, unknown>, levels: Record<string, SubclassFeatureRow[]>): ThirdCasterProfile | undefined {
  if (isThirdCasterProfile(data.castingProfile)) {
    return data.castingProfile;
  }
  if (data.castingProfile === "third-caster") {
    return defaultThirdCasterProfile(String(data.classSlug ?? ""));
  }
  if (data.castingProfile === "none") {
    return undefined;
  }
  for (const rows of Object.values(levels)) {
    for (const row of rows) {
      const profile = thirdCasterProfileForFeature(row.n);
      if (profile) {
        return profile;
      }
    }
  }
  return undefined;
}

// One fetched archetype row as a table, or null when it says nothing a
// grant could use.
export function extraSubclassOf(row: Row, defaultLevel = 3): ExtraSubclass | null {
  const homebrew = row.source === "homebrew";
  const levels = homebrew ? homebrewLevels(row.data.levels) : subclassLevelsFromProse(String(row.data.desc ?? ""), defaultLevel);
  const spells = homebrew ? spellLevels(row.data.spells) : undefined;
  const castingProfile = homebrew ? castingProfileOf(row.data, levels) : (thirdCasterProfileForPackSubclass(row.name) ?? undefined);
  if (!Object.keys(levels).length && !spells) {
    if (!castingProfile) return null;
  }
  return { name: row.name, levels, ...(spells ? { spells } : {}), ...(castingProfile ? { castingProfile } : {}), source: homebrew ? "homebrew" : "pack" };
}

export function mergeExtras(...sets: SubclassExtras[]): SubclassExtras {
  const out: SubclassExtras = {};
  for (const set of sets) {
    for (const [classId, tables] of Object.entries(set)) {
      out[classId] = [...(out[classId] ?? []), ...tables];
    }
  }
  return out;
}
