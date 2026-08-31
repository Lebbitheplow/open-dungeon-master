// Prepared encounters: the roster a DM writes down before the session, in
// the same shorthand the console's "Start a fight" box already takes.
//
// Pure by design (no "@/" imports, no I/O) so scripts/test-encounter-
// templates.mjs can drive it directly. The parser here is the one the
// adjudication façade uses for its own enemies field
// (src/lib/dm/invoke.ts), so what the DM saves and what they type into the
// live form can never read differently.

export type TemplateEnemy = { monster: string; count: number };

export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_NOTES_MAX = 600;
export const TEMPLATE_HINT_MAX = 200;
// start_encounter refuses more than 8 combatants, so a roster that saved
// more would be a template that can never be deployed.
export const TEMPLATE_MAX_ENEMIES = 8;
export const TEMPLATE_MAX_ROWS = 8;

// "goblin x4" / "2x wolf" / "hobgoblin", one per line or separated by
// semicolons. A line with no count is one of that thing.
export function parseRoster(value: unknown): TemplateEnemy[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const row = entry as Partial<TemplateEnemy>;
        return {
          monster: String(row?.monster ?? "").trim(),
          count: Math.max(1, Math.round(Number(row?.count) || 1)),
        };
      })
      .filter((row) => row.monster);
  }
  if (typeof value !== "string") {
    return [];
  }
  const rows: TemplateEnemy[] = [];
  for (const line of value.split(/[\n;]/)) {
    const text = line.trim();
    if (!text) {
      continue;
    }
    const trailing = /^(.*?)\s*[x*]\s*(\d{1,2})$/i.exec(text);
    const leading = /^(\d{1,2})\s*[x*]?\s+(.*)$/.exec(text);
    if (trailing) {
      rows.push({ monster: trailing[1].trim(), count: Number(trailing[2]) });
    } else if (leading) {
      rows.push({ monster: leading[2].trim(), count: Number(leading[1]) });
    } else {
      rows.push({ monster: text, count: 1 });
    }
  }
  return rows.filter((row) => row.monster && row.count > 0);
}

// Back to the text a DM would have typed, so an edit round-trips.
export function formatRoster(rows: TemplateEnemy[]): string {
  return rows
    .map((row) => (row.count > 1 ? `${row.monster} x${row.count}` : row.monster))
    .join("\n");
}

export function rosterSize(rows: TemplateEnemy[]): number {
  return rows.reduce((total, row) => total + row.count, 0);
}

// One more of that monster. What a DM clicking a search result means: the
// second click on "goblin" is "goblin x2", not a second goblin line, because
// the roster is a shopping list and nobody writes the same item twice.
// Matching is case-insensitive for the same reason parseRoster is lenient:
// the name came off a picker or off a keyboard and both are the same fight.
export function addToRoster(rows: TemplateEnemy[], monster: string): TemplateEnemy[] {
  const name = monster.trim();
  if (!name) {
    return rows;
  }
  const wanted = name.toLowerCase();
  const at = rows.findIndex((row) => row.monster.trim().toLowerCase() === wanted);
  if (at === -1) {
    return rows.length >= TEMPLATE_MAX_ROWS
      ? rows
      : [...rows, { monster: name, count: 1 }];
  }
  return rows.map((row, index) =>
    index === at ? { ...row, count: Math.min(99, row.count + 1) } : row,
  );
}

// Trims a roster to what the engine will actually accept, so a template can
// never be saved in a shape that only fails at the table. Returns the
// cleaned rows, or the one sentence explaining what was wrong.
export function checkRoster(rows: TemplateEnemy[]): { rows: TemplateEnemy[] } | { error: string } {
  const cleaned = rows
    .slice(0, TEMPLATE_MAX_ROWS)
    // The count is bounded but NOT clamped to the combatant cap: quietly
    // turning nine goblins into eight would save a template that is not the
    // fight the DM wrote down. The total is refused below instead.
    .map((row) => ({
      monster: row.monster.trim().slice(0, TEMPLATE_NAME_MAX),
      count: Math.min(99, Math.max(1, Math.round(row.count))),
    }))
    .filter((row) => row.monster);
  if (!cleaned.length) {
    return { error: "A prepared encounter needs at least one monster." };
  }
  if (rosterSize(cleaned) > TEMPLATE_MAX_ENEMIES) {
    return {
      error: `That is ${rosterSize(cleaned)} creatures; a fight takes ${TEMPLATE_MAX_ENEMIES} or fewer.`,
    };
  }
  return { rows: cleaned };
}

// The map settings saved beside a roster. All optional: a template with no
// map settings deploys with the generator's own reading of the scene, which
// is exactly what start_encounter does today.
//
// mapId points at a prepared map in the campaign's drawer and wins over the
// generation dials when both are set: a DM who linked a drawn map meant that
// map, not a reroll of its seed. Old rows read mapId as null through the
// EMPTY_TEMPLATE_MAP spread in src/lib/db/encounter-templates.ts, so no
// migration.
export type TemplateMap = {
  mapId: string | null;
  seed: number | null;
  theme: string | null;
  ambient: string | null;
  width: number | null;
  height: number | null;
};

export const EMPTY_TEMPLATE_MAP: TemplateMap = {
  mapId: null,
  seed: null,
  theme: null,
  ambient: null,
  width: null,
  height: null,
};

function optionalInt(value: unknown, min: number, max: number): number | null {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(max, Math.max(min, number));
}

export function normalizeTemplateMap(
  raw: unknown,
  allowed: { themes: string[]; ambients: string[] },
): TemplateMap {
  const source = (raw ?? {}) as Partial<Record<keyof TemplateMap, unknown>>;
  const theme = typeof source.theme === "string" ? source.theme : null;
  const ambient = typeof source.ambient === "string" ? source.ambient : null;
  // The id is only shape-checked here: this module is pure, so whether the
  // map actually exists in the campaign's drawer is the route's question.
  const mapId =
    typeof source.mapId === "string" && source.mapId.trim()
      ? source.mapId.trim().slice(0, 64)
      : null;
  return {
    mapId,
    seed: optionalInt(source.seed, 0, 0xffffffff),
    theme: theme && allowed.themes.includes(theme) ? theme : null,
    ambient: ambient && allowed.ambients.includes(ambient) ? ambient : null,
    width: optionalInt(source.width, 1, 64),
    height: optionalInt(source.height, 1, 64),
  };
}
