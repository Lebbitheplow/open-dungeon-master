import { crLabel, damagePerRound, deriveCr } from "@/lib/bestiary/derive-cr";
import {
  parseMonster,
  passivePerceptionFor,
  saveModFor,
  type EnemyStats,
  type SaveAbility,
} from "@/lib/bestiary/statblock";
import { averageOf } from "@/lib/srd/odds";

// Several monsters or spells in one table, with the rows that DIFFER marked.
//
// A comparison whose only job is putting two stat blocks next to each other
// is not worth building, because a browser has tabs. The thing a DM cannot
// do by eye across two tabs is spot which of forty numbers actually moved,
// so every row carries `differs` and the UI can collapse the rest.
//
// Monster rows include the DERIVED rating from derive-cr.ts next to the
// printed one, since "these two are both CR 5 but one of them is not" is
// the comparison most likely to change a DM's mind about an encounter.
//
// Pure: callers hand in rows they already fetched, so this loads directly in
// scripts/test-reference-desk.mjs and runs in the browser without a route.

export const COMPARE_KINDS = ["spells", "monsters"] as const;
export type CompareKind = (typeof COMPARE_KINDS)[number];

// Four columns is where a table stops fitting on a laptop, and past three
// things nobody is comparing any more, they are browsing.
export const MAX_COMPARE = 4;

export type CompareSubject = {
  slug: string;
  name: string;
  source: "open5e" | "homebrew";
  data: Record<string, unknown>;
};

export type CompareCell = {
  text: string;
  detail?: string;
};

export type CompareRow = {
  label: string;
  group: string;
  cells: CompareCell[];
  // False when every column says the same thing, which is what lets the UI
  // show only what is actually different.
  differs: boolean;
};

export type CompareTable = {
  kind: CompareKind;
  columns: Array<{ slug: string; name: string; source: "open5e" | "homebrew" }>;
  rows: CompareRow[];
  differingRows: number;
};

export function isCompareKind(value: unknown): value is CompareKind {
  return typeof value === "string" && (COMPARE_KINDS as readonly string[]).includes(value);
}

function text(value: unknown, fallback = "not stated"): string {
  if (value === null || value === undefined) {
    return fallback;
  }
  const asString = typeof value === "string" ? value : String(value);
  return asString.trim() || fallback;
}

function row(label: string, group: string, cells: CompareCell[]): CompareRow {
  const first = cells[0]?.text ?? "";
  return { label, group, cells, differs: cells.some((cell) => cell.text !== first) };
}

// ---- spells ----

// Open5e prints the same field under different names across its v1 and v2
// rows, and the homebrew blob uses whichever the editor wrote. Every
// spelling is tried, the way describeContentEntry already does for prose.
function field(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function spellLevel(data: Record<string, unknown>): number {
  const raw = field(data, "level_int", "level");
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function schoolName(data: Record<string, unknown>): string {
  const school = field(data, "school");
  if (school && typeof school === "object") {
    return text((school as { name?: string }).name);
  }
  return text(school);
}

function classList(data: Record<string, unknown>): string {
  const raw = field(data, "dnd_class", "classes", "spell_lists");
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === "string" ? entry : text((entry as { name?: string })?.name, "")))
      .filter(Boolean)
      .join(", ");
  }
  return text(raw);
}

function components(data: Record<string, unknown>): CompareCell {
  const listed = field(data, "components");
  const material = field(data, "material");
  return {
    text: text(listed).toUpperCase(),
    detail: material ? String(material) : undefined,
  };
}

// The first dice expression in a spell's text. Not a mechanics parse: that
// is spell-mechanics.ts's job and it answers a different question. This is
// only so a comparison of two damage spells shows the dice side by side.
function spellDice(data: Record<string, unknown>): CompareCell {
  const desc = `${text(field(data, "desc", "description"), "")}`;
  const match = /\b(\d+d\d+(?:\s*\+\s*\d+)?)\b/.exec(desc);
  if (!match) {
    return { text: "none in the text" };
  }
  const expression = match[1].replace(/\s+/g, "");
  const average = averageOf(expression);
  return {
    text: expression,
    detail: average ? `${average} on average` : undefined,
  };
}

function flag(value: unknown): string {
  return value === true || value === "yes" ? "yes" : "no";
}

function compareSpells(subjects: CompareSubject[]): CompareRow[] {
  const each = <T,>(pick: (data: Record<string, unknown>) => T) =>
    subjects.map((subject) => pick(subject.data));
  return [
    row(
      "Level",
      "casting",
      each((data) => {
        const level = spellLevel(data);
        return { text: level === 0 ? "cantrip" : `level ${level}` };
      }),
    ),
    row("School", "casting", each((data) => ({ text: schoolName(data).toLowerCase() }))),
    row("Casting time", "casting", each((data) => ({ text: text(field(data, "casting_time")) }))),
    row("Range", "casting", each((data) => ({ text: text(field(data, "range")) }))),
    row("Duration", "casting", each((data) => ({ text: text(field(data, "duration")) }))),
    row("Components", "casting", each(components)),
    row("Concentration", "cost", each((data) => ({ text: flag(field(data, "concentration")) }))),
    row("Ritual", "cost", each((data) => ({ text: flag(field(data, "ritual")) }))),
    row("Dice", "effect", each(spellDice)),
    row("Classes", "effect", each((data) => ({ text: classList(data).toLowerCase() }))),
  ];
}

// ---- monsters ----

const SAVES: SaveAbility[] = ["str", "dex", "con", "int", "wis", "cha"];

function statsFor(subject: CompareSubject): EnemyStats {
  // A hand-built monster is already stored in the EnemyStats shape, so
  // parsing it again would be running an Open5e reader over something that
  // was never an Open5e row.
  if (subject.source === "homebrew" && subject.data.stats) {
    return subject.data.stats as EnemyStats;
  }
  const cr = typeof subject.data.cr === "number" ? subject.data.cr : 0;
  return parseMonster(subject.data, cr);
}

function bestAttack(stats: EnemyStats): CompareCell {
  const attack = stats.attacks[0];
  if (!attack) {
    return { text: "no attacks" };
  }
  return {
    text: `${attack.name} ${attack.toHit >= 0 ? "+" : ""}${attack.toHit}`,
    detail: `${attack.damage}${attack.type ? ` ${attack.type}` : ""}`,
  };
}

function compareMonsters(subjects: CompareSubject[]): CompareRow[] {
  const stats = subjects.map(statsFor);
  const each = (pick: (stat: EnemyStats, index: number) => CompareCell) => stats.map(pick);
  return [
    row("Armour class", "defence", each((stat) => ({ text: String(stat.ac) }))),
    row("Hit points", "defence", each((stat) => ({ text: String(stat.maxHp) }))),
    row("Size", "defence", each((stat) => ({ text: text(stat.size, "medium").toLowerCase() }))),
    row("Speed", "defence", each((stat) => ({ text: text(stat.speed) }))),
    row("Resistances", "defence", each((stat) => ({ text: text(stat.resist, "none") }))),
    row("Immunities", "defence", each((stat) => ({ text: text(stat.immune, "none") }))),
    row(
      "Condition immunities",
      "defence",
      each((stat) => ({ text: text(stat.conditionImmune, "none") })),
    ),
    row("Best attack", "offence", each(bestAttack)),
    row(
      "Attacks a turn",
      "offence",
      each((stat) => ({ text: String(Math.max(1, stat.attacksPerTurn ?? 1)) })),
    ),
    row(
      "Damage a round",
      "offence",
      each((stat) => {
        const output = damagePerRound(stat);
        return {
          text: String(Math.round(output.perRound)),
          detail: output.notes.length
            ? output.notes[0]
            : `${output.swings} x ${Math.round(output.perSwing)}`,
        };
      }),
    ),
    row(
      "Saving throws",
      "offence",
      each((stat) => ({
        text: SAVES.map((ability) => `${ability.toUpperCase()} ${signedMod(saveModFor(stat, ability))}`).join(" "),
      })),
    ),
    row(
      "Passive Perception",
      "offence",
      each((stat) => ({ text: String(passivePerceptionFor(stat)) })),
    ),
    row(
      "Printed rating",
      "rating",
      each((stat) => ({ text: `CR ${crLabel(stat.cr)}`, detail: `${stat.xp.toLocaleString()} XP` })),
    ),
    row(
      "Derived rating",
      "rating",
      each((stat) => {
        const derived = deriveCr(stat);
        return {
          text: `CR ${crLabel(derived.cr)}`,
          detail: derived.notes.length
            ? derived.notes[0]
            : derived.drift
              ? `${Math.abs(derived.drift)} rating${Math.abs(derived.drift) === 1 ? "" : "s"} from the printed one`
              : "agrees with the printed rating",
        };
      }),
    ),
    row(
      "Traits",
      "rating",
      each((stat) => ({
        text: String(stat.traits.length),
        detail: stat.traits.length ? stat.traits[0] : undefined,
      })),
    ),
  ];
}

function signedMod(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

// ---- the table ----

export function buildCompare(
  kind: CompareKind,
  subjects: CompareSubject[],
): CompareTable | { error: string } {
  if (subjects.length < 2) {
    return { error: "Pick at least two things to compare." };
  }
  if (subjects.length > MAX_COMPARE) {
    return { error: `Compare up to ${MAX_COMPARE} at a time.` };
  }
  const rows = kind === "spells" ? compareSpells(subjects) : compareMonsters(subjects);
  return {
    kind,
    columns: subjects.map((subject) => ({
      slug: subject.slug,
      name: subject.name,
      source: subject.source,
    })),
    rows,
    differingRows: rows.filter((entry) => entry.differs).length,
  };
}
