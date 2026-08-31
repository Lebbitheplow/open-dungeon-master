import { listRulesetsForUser } from "@/lib/db/rulesets";
import { chunkHouseRules, scoreRuleByKeywords } from "@/lib/dm/rules-logic";
import { activeVariantRules } from "@/lib/rulesets/logic";
import type { DeskSource } from "@/lib/reference/desk-logic";

// The table's OWN rules as something searchable, alongside the SRD.
//
// This is the half of "searches the ruleset's house rules alongside SRD
// content" that the content database cannot do, because house rules are
// prose on a ruleset row rather than rows in a pack. Chunking goes through
// the engine's own chunkHouseRules, so a heading the retrieval treats as a
// section is the same heading this search finds; re-deriving it here would
// eventually disagree, which is the reasoning countHouseRulings already
// records in src/lib/rulesets/logic.ts.
//
// Shared by the browse tab and the research desk, so a ruling the desk can
// cite is exactly a ruling the DM can find by hand.

// Every ruling in every ruleset this user owns, in the desk's source shape.
export function rulingSources(userId: string): DeskSource[] {
  const sources: DeskSource[] = [];
  for (const ruleset of listRulesetsForUser(userId)) {
    const short = ruleset.id.slice(0, 8);
    for (const [index, chunk] of chunkHouseRules(ruleset.houseRulesText).entries()) {
      sources.push({
        kind: "ruling",
        ref: `ruling:${short}-${index}`,
        name: chunk.heading || ruleset.name,
        text: chunk.heading ? `${chunk.heading}. ${chunk.text}` : chunk.text,
        origin: `your house rules in "${ruleset.name}"`,
      });
    }
    // A switched-on variant is a rule this table plays by just as much as a
    // paragraph someone typed, and it is the one a DM is most likely to
    // forget they turned on.
    for (const [index, line] of activeVariantRules(ruleset.variantRules).entries()) {
      sources.push({
        kind: "variant",
        ref: `variant:${short}-${index}`,
        name: line,
        text: `${line} is switched on.`,
        origin: `a variant rule in "${ruleset.name}"`,
      });
    }
  }
  return sources;
}

export type RulingHit = {
  ref: string;
  kind: "ruling" | "variant";
  name: string;
  text: string;
  origin: string;
};

const RULING_LIMIT = 60;

// Ranked by the same scorer the DM prompt uses to decide which house rules
// reach a live turn, so a DM searching here sees them in the order the
// engine would have surfaced them.
export function searchRulings(userId: string, query: string, limit = RULING_LIMIT): RulingHit[] {
  const sources = rulingSources(userId);
  const needle = (query ?? "").trim();
  const hits = needle
    ? sources
        .map((source) => ({
          source,
          score: scoreRuleByKeywords(needle, { heading: source.name, text: source.text }),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.source)
    : sources;
  return hits.slice(0, limit).map((source) => ({
    ref: source.ref,
    kind: source.kind as "ruling" | "variant",
    name: source.name,
    text: source.text,
    origin: source.origin,
  }));
}
