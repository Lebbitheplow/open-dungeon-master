// What a cast needs to know about a spell besides its dice: how long it
// takes to cast, what it is made of (a voice, a gesture, a material and what
// the material costs), how far it reaches, and whether it is a ritual or
// holds concentration.
//
// Two sources, the same shape. The content pack's row is read when the pack
// answers (src/lib/content/index.ts spellFactsFor). Without it the bundled
// data answers: ODM's own authored spells carry every field, and the
// checklist (manifest/spells.json) carries the facts of the SRD's spells as
// short keys written by scripts/annotate-spell-manifest.mjs. So a server
// with no pack still knows that Fireball is 3rd level, that Detect Magic is
// a ritual and that Bless takes concentration.
//
// Pure: text in, facts out, no database.

import authoredSpellsJson from "@/lib/srd/authored-spells.json";
import spellManifest from "@/lib/srd/manifest/spells.json";
import { compareNames } from "@/lib/language/text-logic";

// An action, a bonus action, a reaction, or a number of minutes.
export type CastingTime = "action" | "bonus" | "reaction" | number;

export type SpellRange =
  | { kind: "feet"; feet: number }
  // A spell centred on the caster; `areaFeet` is the size of the cone, line
  // or radius the range line prints ("Self (15-foot cone)").
  | { kind: "self"; areaFeet?: number }
  | { kind: "touch" | "sight" | "unlimited" | "special" | "unknown" };

export type SpellFacts = {
  name: string;
  level: number;
  castingTime: CastingTime;
  verbal: boolean;
  somatic: boolean;
  material: boolean;
  // What the material costs in gold pieces, when the spell names a price.
  // Null for a component a pouch or a focus stands in for.
  materialCostGp: number | null;
  materialConsumed: boolean;
  // The words of the material line, for matching what the caster carries.
  // Empty when the facts came from the checklist, which keeps no prose.
  materialText: string;
  ritual: boolean;
  concentration: boolean;
  range: SpellRange;
  classes: string[];
  // Other names the spell is printed under, lowercased.
  aliases: string[];
  homebrew: boolean;
  // A table's workshop copy: the published spell it runs as, whose area,
  // summons, reaction or transformation the engines lay for it (a renamed
  // Web, "Silkbind", still webs the board). Absent for everything else.
  runsAs?: string;
};

// "1 bonus action", "1 reaction, which you take when...", "10 minutes",
// "8 hours", and the 2024 rows' "bonus-action". Text nobody can read is an
// action, which is what nine spells in ten take.
export function castingTimeFrom(text: unknown): CastingTime {
  const clean = String(text ?? "").trim().toLowerCase().replace(/-/g, " ");
  if (/bonus/.test(clean)) {
    return "bonus";
  }
  if (/reaction/.test(clean)) {
    return "reaction";
  }
  const span = /^(\d+)\s*(minute|hour|round)s?\b/.exec(clean);
  if (span) {
    const count = Number(span[1]);
    if (span[2] === "hour") {
      return count * 60;
    }
    // A round is six seconds: a spell of several rounds is under a minute
    // and still more than a turn, so it is counted as one minute.
    return span[2] === "round" ? 1 : count;
  }
  return "action";
}

export function describeCastingTime(time: CastingTime): string {
  if (typeof time === "number") {
    return time >= 60 && time % 60 === 0
      ? `${time / 60} hour${time === 60 ? "" : "s"}`
      : `${time} minute${time === 1 ? "" : "s"}`;
  }
  return time === "bonus" ? "a bonus action" : time === "reaction" ? "a reaction" : "an action";
}

// "V, S, M (a pinch of sulfur)" -> the three letters. The material in
// brackets is not part of the letters.
export function componentLettersFrom(text: unknown): { verbal: boolean; somatic: boolean; material: boolean } {
  const head = String(text ?? "").split("(")[0].toUpperCase();
  const has = (letter: string) => new RegExp(`\\b${letter}\\b`).test(head);
  return { verbal: has("V"), somatic: has("S"), material: has("M") };
}

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

// The price a material line states ("diamonds worth 300gp", "an agate worth
// at least 1,000 gp") and whether the spell uses the material up. Several
// priced materials are added together, and a price "each" counts as many
// times as the line names them (Legend Lore's four ivory strips at 50 gp).
export function materialCostFrom(text: unknown): { costGp: number | null; consumed: boolean } {
  const line = String(text ?? "");
  let total = 0;
  for (const match of line.matchAll(/(\d[\d,]*)\s*gp\b(\s+each\b)?/gi)) {
    let price = Number(match[1].replace(/,/g, ""));
    if (match[2]) {
      const clause = line.slice(0, match.index).split(/[,;]|\band\b/i).pop() ?? "";
      const count = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/i.exec(clause)?.[1] ?? "";
      price *= Number(count) || COUNT_WORDS[count.toLowerCase()] || 1;
    }
    total += price;
  }
  return {
    costGp: total > 0 ? total : null,
    consumed: total > 0 && /consum/i.test(line),
  };
}

export function rangeFrom(text: unknown): SpellRange {
  const clean = String(text ?? "").trim().toLowerCase();
  if (!clean) {
    return { kind: "unknown" };
  }
  if (clean.startsWith("self")) {
    // "self (15-foot cone)", and the checklist's own "self:15".
    const area = /(\d+)[- ]?(?:foot|feet|ft)|^self:(\d+)/.exec(clean);
    const feet = area ? Number(area[1] ?? area[2]) : 0;
    return feet > 0 ? { kind: "self", areaFeet: feet } : { kind: "self" };
  }
  if (clean.startsWith("touch")) {
    return { kind: "touch" };
  }
  if (clean.startsWith("sight")) {
    return { kind: "sight" };
  }
  if (clean.startsWith("unlimited")) {
    return { kind: "unlimited" };
  }
  const span = /^(\d[\d,]*)\s*(feet|foot|ft\.?|miles?)?/.exec(clean);
  if (span) {
    const count = Number(span[1].replace(/,/g, ""));
    // The 2024 rows print a bare number of feet.
    return { kind: "feet", feet: /mile/.test(span[2] ?? "") ? count * 5280 : count };
  }
  return { kind: "special" };
}

export function describeRange(range: SpellRange): string {
  if (range.kind === "self" && range.areaFeet) {
    return `self (${range.areaFeet} feet)`;
  }
  return range.kind === "feet" ? `${range.feet} feet` : range.kind;
}

// A row in the shape the pack and the authored file share.
export type SpellRowLike = {
  name: string;
  level: number;
  ritual?: boolean;
  concentration?: boolean;
  classes?: string[];
  aliases?: string[];
  homebrew?: boolean;
  data: Record<string, unknown>;
};

// A flag in any of the shapes the sources write one: a boolean, a 1, or the
// 2014 rows' "yes" and "no".
export const truthy = (value: unknown) => value === true || value === 1 || (typeof value === "string" && /^(yes|true)$/i.test(value.trim()));

// Whether a row's spell is a ritual and asks for concentration: the 2014
// rows' "yes"/"no", the 2024 rows' can_be_cast_as_ritual and
// requires_concentration, a homebrew row's booleans, and a duration that
// begins "Concentration".
export function spellFlagsOf(data: Record<string, unknown>): { ritual: boolean; concentration: boolean } {
  return {
    ritual: truthy(data.ritual) || truthy(data.can_be_cast_as_ritual),
    concentration: truthy(data.concentration) || truthy(data.requires_concentration) || /^concentration\b/i.test(String(data.duration ?? "").trim()),
  };
}

// What a row says of its material, in every shape the sources use: the 2014
// rows' `material` line ("Diamonds worth 300gp, which the spell consumes."),
// the 2024 rows' `material_specified` with `material_cost` and
// `material_consumed`, a material named in brackets after the M ("V, S, M
// (a diamond worth at least 50 gp)"), and a workshop spell's own
// `materialCostGp` and `materialConsumed`, which win over its words.
export function materialOf(data: Record<string, unknown>): { text: string; costGp: number | null; consumed: boolean } {
  const written = String(data.components ?? "");
  const bracket = /\(([^)]+)\)/.exec(written)?.[1] ?? "";
  const text =
    (typeof data.material === "string" ? data.material : "") ||
    (typeof data.material_specified === "string" ? data.material_specified : "") ||
    bracket;
  const read = materialCostFrom(text);
  const statedCost =
    typeof data.materialCostGp === "number" ? data.materialCostGp
    : typeof data.material_cost === "number" && data.material_cost > 0 ? data.material_cost
    : null;
  const costGp = statedCost !== null ? (statedCost > 0 ? statedCost : null) : read.costGp;
  const consumed =
    typeof data.materialConsumed === "boolean" ? data.materialConsumed
    : data.material_consumed !== undefined && data.material_consumed !== null && data.material_consumed !== "" ? truthy(data.material_consumed)
    : read.consumed;
  return { text: text.trim(), costGp, consumed: Boolean(costGp) && consumed };
}

export function factsFromRow(row: SpellRowLike): SpellFacts {
  const data = row.data;
  const written = String(data.components ?? "");
  // The 2014 rows print letters; the 2024 rows and some homebrew carry flags.
  const letters = written
    ? componentLettersFrom(written)
    : {
        verbal: truthy(data.verbal) || truthy(data.requires_verbal_components),
        somatic: truthy(data.somatic) || truthy(data.requires_somatic_components),
        material: truthy(data.material) || truthy(data.requires_material_components),
      };
  const material = materialOf(data);
  const runsAs = row.homebrew && typeof data.runsAs === "string" && data.runsAs.trim() ? data.runsAs.trim() : "";
  return {
    name: row.name,
    level: row.level,
    castingTime: castingTimeFrom(data.casting_time),
    ...letters,
    materialCostGp: letters.material ? material.costGp : null,
    materialConsumed: letters.material && material.consumed,
    materialText: letters.material ? material.text : "",
    ritual: Boolean(row.ritual),
    concentration: Boolean(row.concentration),
    range: rangeFrom(data.range_text ?? data.range),
    classes: (row.classes ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    aliases: (row.aliases ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    homebrew: Boolean(row.homebrew),
    ...(runsAs ? { runsAs } : {}),
  };
}

// The canonical name of a published spell the bundled data knows ("web" ->
// "Web", "Melf's Acid Arrow" -> "Acid Arrow"), or null. What a workshop
// copy may run as: every engine that keys a spell by name (areas, summons,
// reactions, transformations) keys the SRD's and ODM's own, all bundled.
export function engineSpellNamed(name: string): string | null {
  const wanted = name.trim();
  return wanted ? (bundledSpellFacts(wanted)?.name ?? null) : null;
}

// ---- the bundled data ----

export type AuthoredSpell = {
  name: string;
  level: number;
  school: string;
  classes: string[];
  casting_time: string;
  range: string;
  components: string;
  duration: string;
  ritual?: boolean;
  concentration?: boolean;
  desc: string;
  higher_level?: string;
};

const AUTHORED = (authoredSpellsJson as unknown as { spells: AuthoredSpell[] }).spells;

const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

const AUTHORED_BY_NAME = new Map(AUTHORED.map((row) => [normalize(row.name), row] as const));

export function authoredSpell(name: string): AuthoredSpell | null {
  return AUTHORED_BY_NAME.get(normalize(name)) ?? null;
}

export function authoredSpells(): AuthoredSpell[] {
  return AUTHORED;
}

// The checklist's short keys (scripts/annotate-spell-manifest.mjs):
//   r ritual, k concentration, t casting time ("bonus", "reaction" or a
//   number of minutes; absent for an action), v component letters, g the
//   material's price in gp, x the material is consumed, d the range (feet,
//   or a word; "self:15" for a 15 foot area around the caster).
type ManifestSpell = {
  n: string;
  l: number;
  s?: string;
  c?: string;
  a?: string[];
  r?: boolean;
  k?: boolean;
  t?: "bonus" | "reaction" | number;
  v?: string;
  g?: number;
  x?: boolean;
  d?: number | string;
};

const MANIFEST = new Map(
  (spellManifest as unknown as { spells: ManifestSpell[] }).spells.flatMap((spell) =>
    [spell.n, ...(spell.a ?? [])].map((name) => [normalize(name), spell] as const),
  ),
);

function manifestRange(value: ManifestSpell["d"]): SpellRange {
  if (typeof value === "number") {
    return { kind: "feet", feet: value };
  }
  return value ? rangeFrom(value) : { kind: "unknown" };
}

// The school the bundled checklist gives a spell ("evocation"), or null.
export function bundledSpellSchool(name: string): string | null {
  const listed = MANIFEST.get(normalize(name));
  const authored = authoredSpell(listed?.n ?? name);
  return (listed?.s ?? authored?.school ?? "").trim().toLowerCase() || null;
}

// What the bundled data says of a spell by name, or null for a name neither
// the authored file nor the checklist carries.
export function bundledSpellFacts(name: string): SpellFacts | null {
  const listed = MANIFEST.get(normalize(name)) ?? null;
  const authored = authoredSpell(listed?.n ?? name) ?? authoredSpell(name);
  const classes = (listed?.c ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const aliases = (listed?.a ?? []).map(normalize);
  if (authored) {
    return {
      ...factsFromRow({
        name: authored.name,
        level: authored.level,
        ritual: authored.ritual,
        concentration: authored.concentration,
        classes: classes.length ? classes : authored.classes,
        aliases,
        data: authored as unknown as Record<string, unknown>,
      }),
    };
  }
  if (!listed) {
    return null;
  }
  const letters = (listed.v ?? "").toUpperCase();
  return {
    name: listed.n,
    level: listed.l,
    castingTime: listed.t ?? "action",
    verbal: letters.includes("V"),
    somatic: letters.includes("S"),
    material: letters.includes("M"),
    materialCostGp: listed.g ?? null,
    materialConsumed: Boolean(listed.x),
    materialText: "",
    ritual: Boolean(listed.r),
    concentration: Boolean(listed.k),
    range: manifestRange(listed.d),
    classes,
    aliases,
    homebrew: false,
  };
}

// Every spell name the bundled data knows, sorted: what a workshop copy may
// run as (engineSpellNamed).
export function bundledSpellNames(): string[] {
  const names = new Set<string>([...AUTHORED.map((row) => row.name), ...(spellManifest as unknown as { spells: ManifestSpell[] }).spells.map((spell) => spell.n)]);
  return [...names].sort(compareNames);
}
