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

// ---- the rest of a prepared fight ----
//
// docs/workshop-parity-audit.md phase 13. A roster says what is in the
// fight; this says where each of them starts, who is hidden when it opens,
// which goblin is called Snik and has three hit points, what the fight is
// worth, and what happens when. Slots index the EXPANDED roster (goblin x3
// is slots 0, 1 and 2), so a placement survives the roster being retyped
// in the same order.

export type TemplatePlacement = { slot: number; x: number; y: number };
export type TemplateOverride = { slot: number; name?: string; hp?: number };

export type TemplateExtras = {
  placements: TemplatePlacement[];
  // Where the party enters, or null for wherever the generator puts them.
  entry: { x: number; y: number } | null;
  // Slots hidden when the fight opens: the ambusher in the rafters.
  hidden: number[];
  overrides: TemplateOverride[];
  // What the fight is worth, in the DM's words: coin, items, a table to roll.
  rewards: string;
  // "When the shaman drops, the wolves flee." One line each.
  phases: string[];
};

export const EXTRAS_LIMITS = {
  slots: TEMPLATE_MAX_ENEMIES,
  phases: 8,
  phaseText: 200,
  rewards: 600,
  name: 40,
  hp: 1000,
} as const;

export const EMPTY_TEMPLATE_EXTRAS: TemplateExtras = {
  placements: [],
  entry: null,
  hidden: [],
  overrides: [],
  rewards: "",
  phases: [],
};

export type RosterSlot = { slot: number; monster: string; label: string };

// "goblin x3, hobgoblin" as four slots: goblin 1, goblin 2, goblin 3,
// hobgoblin. The label is what the placement list shows.
export function expandRoster(rows: TemplateEnemy[]): RosterSlot[] {
  const slots: RosterSlot[] = [];
  for (const row of rows) {
    const count = Math.max(1, Math.round(row.count));
    for (let index = 0; index < count; index += 1) {
      slots.push({
        slot: slots.length,
        monster: row.monster,
        label: count > 1 ? `${row.monster} ${index + 1}` : row.monster,
      });
    }
  }
  return slots;
}

function slotNumber(value: unknown, slotCount: number): number | null {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 && number < slotCount ? number : null;
}

function tileNumber(value: unknown): number | null {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 && number < 256 ? number : null;
}

// Cleaned against the roster it belongs to: a slot past the end is dropped,
// one placement per slot (the last written wins), and text trimmed to what
// a note can hold.
export function normalizeTemplateExtras(
  raw: unknown,
  slotCount: number = EXTRAS_LIMITS.slots,
): TemplateExtras {
  const source = (raw ?? {}) as Partial<Record<keyof TemplateExtras, unknown>>;
  const placements = new Map<number, TemplatePlacement>();
  for (const entry of Array.isArray(source.placements) ? source.placements : []) {
    const row = (entry ?? {}) as Partial<TemplatePlacement>;
    const slot = slotNumber(row.slot, slotCount);
    const x = tileNumber(row.x);
    const y = tileNumber(row.y);
    if (slot === null || x === null || y === null) {
      continue;
    }
    placements.set(slot, { slot, x, y });
  }
  const entryRaw = (source.entry ?? null) as { x?: unknown; y?: unknown } | null;
  const entryX = entryRaw ? tileNumber(entryRaw.x) : null;
  const entryY = entryRaw ? tileNumber(entryRaw.y) : null;
  const hidden = [
    ...new Set(
      (Array.isArray(source.hidden) ? source.hidden : [])
        .map((value) => slotNumber(value, slotCount))
        .filter((value): value is number => value !== null),
    ),
  ].sort((a, b) => a - b);
  const overrides = new Map<number, TemplateOverride>();
  for (const entry of Array.isArray(source.overrides) ? source.overrides : []) {
    const row = (entry ?? {}) as Partial<TemplateOverride>;
    const slot = slotNumber(row.slot, slotCount);
    if (slot === null) {
      continue;
    }
    const name = typeof row.name === "string" ? row.name.trim().slice(0, EXTRAS_LIMITS.name) : "";
    const hp = Math.round(Number(row.hp));
    const override: TemplateOverride = { slot };
    if (name) {
      override.name = name;
    }
    if (Number.isFinite(hp) && hp > 0) {
      override.hp = Math.min(EXTRAS_LIMITS.hp, hp);
    }
    if (override.name || override.hp) {
      overrides.set(slot, override);
    }
  }
  return {
    placements: [...placements.values()].sort((a, b) => a.slot - b.slot).slice(0, EXTRAS_LIMITS.slots),
    entry: entryX !== null && entryY !== null ? { x: entryX, y: entryY } : null,
    hidden,
    overrides: [...overrides.values()].sort((a, b) => a.slot - b.slot),
    rewards: typeof source.rewards === "string" ? source.rewards.trim().slice(0, EXTRAS_LIMITS.rewards) : "",
    phases: (Array.isArray(source.phases) ? source.phases : [])
      .map((line) => (typeof line === "string" ? line.trim().slice(0, EXTRAS_LIMITS.phaseText) : ""))
      .filter(Boolean)
      .slice(0, EXTRAS_LIMITS.phases),
  };
}

// Which enemy the fight actually made is which slot. Matched by name in
// roster order rather than by insertion order, because the enemies of one
// start_encounter share a timestamp and a list ordered by it is a guess.
export function matchSlots<T extends { id: string; slug: string; displayName: string }>(
  slots: RosterSlot[],
  enemies: T[],
): Map<number, T> {
  const matched = new Map<number, T>();
  const used = new Set<string>();
  // Exact names first across every slot, then the loose matches for what
  // is left: otherwise "goblin" would take the hobgoblin before the goblin.
  const passes: Array<(slug: string, name: string, wanted: string) => boolean> = [
    (slug, name, wanted) => slug === wanted || name === wanted,
    (slug, name, wanted) => slug.includes(wanted) || name.includes(wanted) || wanted.includes(name),
  ];
  for (const test of passes) {
    for (const slot of slots) {
      if (matched.has(slot.slot)) {
        continue;
      }
      const wanted = slot.monster.trim().toLowerCase();
      const enemy = enemies.find(
        (candidate) =>
          !used.has(candidate.id) &&
          test(candidate.slug.toLowerCase(), candidate.displayName.toLowerCase(), wanted),
      );
      if (enemy) {
        used.add(enemy.id);
        matched.set(slot.slot, enemy);
      }
    }
  }
  return matched;
}

// The note the DM gets when the fight opens: the parts of the plan the
// board cannot show.
export function describeExtras(extras: TemplateExtras): string[] {
  const lines: string[] = [];
  if (extras.rewards) {
    lines.push(`Worth: ${extras.rewards}`);
  }
  extras.phases.forEach((phase, index) => {
    lines.push(`Phase ${index + 1}: ${phase}`);
  });
  return lines;
}
