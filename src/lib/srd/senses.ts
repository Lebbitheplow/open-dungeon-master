// Senses beyond darkvision (docs/vtt-parity-implementation-plan.md section
// 3.2): blindsight sees within its reach regardless of light, through fog
// and darkness but not through walls; tremorsense feels anything on the
// ground within reach and misses whatever flies; truesight and Devil's
// Sight see through magical darkness. Monsters carry them on the stat
// block; characters get them from features. Pure and dependency-free.

export type Senses = {
  // All in tiles (feet / 5); 0 means none.
  darkvision: number;
  blindsight: number;
  tremorsense: number;
  truesight: number;
  // Devil's Sight: sees normally in darkness, magical or not, to its reach.
  devilsSight: number;
};

export const NO_SENSES: Senses = {
  darkvision: 0,
  blindsight: 0,
  tremorsense: 0,
  truesight: 0,
  devilsSight: 0,
};

function feetToTiles(feet: number): number {
  return Math.max(0, Math.floor(feet / 5));
}

// "blindsight 60 ft", "Tremorsense 30 ft.", "truesight 120ft" and the
// features that grant a sense without naming its range the same way.
export function sensesFromText(texts: string[]): Senses {
  const out: Senses = { ...NO_SENSES };
  const take = (key: keyof Senses, feet: number) => {
    out[key] = Math.max(out[key], feetToTiles(feet));
  };
  for (const raw of texts) {
    const text = raw.toLowerCase();
    for (const key of ["darkvision", "blindsight", "tremorsense", "truesight"] as const) {
      const match = new RegExp(`${key}\\s*(\\d+)\\s*(?:ft|feet)?`).exec(text);
      if (match) {
        take(key, Number(match[1]));
      } else if (text.includes(key) && key !== "darkvision") {
        take(key, 30);
      }
    }
    if (text.includes("blind fighting")) {
      take("blindsight", 10);
    }
    if (text.includes("devil's sight") || text.includes("devils sight")) {
      take("devilsSight", 120);
    }
    if (text.includes("ghostly gaze")) {
      take("truesight", 30);
    }
  }
  return out;
}

export function sensesFromBlock(
  senses: { blindsight?: number; tremorsense?: number; truesight?: number; darkvision?: number } | undefined,
): Senses {
  return {
    darkvision: feetToTiles(senses?.darkvision ?? 0),
    blindsight: feetToTiles(senses?.blindsight ?? 0),
    tremorsense: feetToTiles(senses?.tremorsense ?? 0),
    truesight: feetToTiles(senses?.truesight ?? 0),
    devilsSight: 0,
  };
}

export function describeSenses(senses: Senses): string {
  const parts: string[] = [];
  if (senses.blindsight) {
    parts.push(`blindsight ${senses.blindsight * 5} ft`);
  }
  if (senses.tremorsense) {
    parts.push(`tremorsense ${senses.tremorsense * 5} ft`);
  }
  if (senses.truesight) {
    parts.push(`truesight ${senses.truesight * 5} ft`);
  }
  if (senses.devilsSight) {
    parts.push(`Devil's Sight ${senses.devilsSight * 5} ft`);
  }
  return parts.join(", ");
}
