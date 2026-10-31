// A feat's reading (reading-logic.ts): ODM's own feat when the engines run
// one by this name or its twin, else the three readers the builder and the
// sheet apply to a pack feat's text (its grants, its ability increase, its
// effects), and what that text holds that none of them read.

import { featGrantSpec, featGrantsAnything, type FeatGrantSpec } from "@/lib/srd/feat-grant-text";
import { featAbilityIncreaseFrom, engineFeatNamed } from "@/lib/srd/feat-effects";
import { parseFeatureEffects } from "@/lib/srd/feature-effects";
import { featEngineTag } from "@/lib/srd/feat-combat";
import { packFeatText } from "@/lib/srd/feat-text";
import { reading, readingChecked, type EntryReading, type ReadingRow } from "@/lib/content/reading-logic";

// A grant spec without its zeros and empty lists, as a reading stores it.
function grantsOf(spec: FeatGrantSpec): Partial<FeatGrantSpec> | null {
  const kept = Object.entries(spec).filter(([key, value]) => {
    if (key === "taught") {
      const taught = value as FeatGrantSpec["taught"];
      return taught.cantrips + taught.spells + taught.fixedSpells.length + taught.fixedCantrips.length > 0 || taught.ritualBook;
    }
    return Array.isArray(value) ? value.length > 0 : typeof value === "number" ? value > 0 : Boolean(value);
  });
  return kept.length ? (Object.fromEntries(kept) as Partial<FeatGrantSpec>) : null;
}

export function featUnread(desc: string, parts: { grants: Partial<FeatGrantSpec> | null; increase: unknown; effects: unknown[] }): string[] {
  const text = desc.toLowerCase().replace(/[*_]/g, "");
  const unread: string[] = [];
  const granted = parts.grants ? featGrantsAnything({ ...EMPTY_SPEC, ...parts.grants } as FeatGrantSpec) : false;
  if (/\b(?:gain|you have) proficiency (?:in|with)\b|\bbecome proficient\b|\byou are proficient\b/.test(text) && !granted) {
    unread.push("proficiency");
  }
  if (/\b(?:increase|raise)\b[^.]{0,40}?\bby 1\b|\bincreases? by 1\b/.test(text) && !parts.increase) {
    unread.push("ability increase");
  }
  if (/\byou (?:learn|know)\b[^.]{0,60}?\b(?:cantrips?|spells?)\b/.test(text) && !parts.grants?.taught) {
    unread.push("spell");
  }
  if (/\bresistance to\b[^.]{0,30}?\bdamage\b/.test(text) && !parts.grants?.damageTypes && !parts.effects.length) {
    unread.push("resistance");
  }
  return unread;
}

const EMPTY_SPEC = featGrantSpec("");

export function readFeat(row: ReadingRow): EntryReading {
  // ODM's own feats (and the pack's twins of them, Level Up's Attentive as
  // Alert) run on the engines' hand-written rules, as do the pack feats the
  // server applies by name (feat-combat.ts featEngineTag: Grappler, Level
  // Up's Deadeye and Battle Caster).
  const runsAs = engineFeatNamed(row.name);
  const tag = featEngineTag(row.name);
  if (runsAs || tag) {
    return reading({ handWritten: runsAs ? { runsAs } : { engine: tag }, parsed: null, unread: [], checked: true });
  }
  const { desc } = packFeatText(row.data);
  const grants = grantsOf(featGrantSpec(desc));
  const increase = featAbilityIncreaseFrom(desc);
  const effects = parseFeatureEffects(desc);
  const found = grants || increase || effects.length;
  return reading({
    handWritten: null,
    parsed: found ? { ...(grants ? { grants } : {}), ...(increase ? { increase } : {}), ...(effects.length ? { effects } : {}) } : null,
    unread: featUnread(desc, { grants, increase, effects }),
    checked: readingChecked("feat", row),
  });
}
