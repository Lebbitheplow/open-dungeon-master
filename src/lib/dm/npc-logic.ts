// Pure NPC-agency logic, kept free of alias imports so node test scripts
// (scripts/test-npc-agency.mjs) can load it directly.
//
// Gives tracked NPCs inner life beyond the attitude scalar: a six-axis
// personality that drifts with how the party treats them, per-character
// bonds, NPC-to-NPC relations, a session goal advanced by background dice
// at chapter close, and a pressure meter that notices being courted or
// ignored. Everything here is deterministic given its inputs; dice come in
// as injected rolls so the engines cost zero model calls.

export type NpcPersonality = {
  drive: number;
  diligence: number;
  boldness: number;
  warmth: number;
  empathy: number;
  composure: number;
};

export const PERSONALITY_AXES = [
  "drive",
  "diligence",
  "boldness",
  "warmth",
  "empathy",
  "composure",
] as const;

export type NpcSessionGoal = { text: string; progress: number; target: number };

export type NpcGoals = {
  // What they want in the current scene; free text, set by the DM.
  scene?: string;
  // A goal advanced by background dice at chapter close.
  session?: NpcSessionGoal;
  // Long-term defining ambition, often seeded from the arc cast's agenda.
  ambition?: string;
};

export type NpcRelation = { npcName: string; score: number; note?: string };
export type NpcBond = { characterId: string; score: number };
export type NpcPressure = { ignored: number; engaged: number };

export type NpcAgency = {
  personality: NpcPersonality | null;
  goals: NpcGoals;
  relations: NpcRelation[];
  bonds: NpcBond[];
  pressure: NpcPressure;
};

export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-3, Math.min(3, Math.round(value)));
}

// ---- column (de)serialization, tolerant of empty and garbage ----

export function parsePersonality(raw: string): NpcPersonality | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const personality = {} as NpcPersonality;
    for (const axis of PERSONALITY_AXES) {
      personality[axis] = clampAxis(Number(parsed[axis] ?? 0));
    }
    return personality;
  } catch {
    return null;
  }
}

export function parseGoals(raw: string): NpcGoals {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as {
      scene?: unknown;
      session?: { text?: unknown; progress?: unknown; target?: unknown } | null;
      ambition?: unknown;
    };
    const goals: NpcGoals = {};
    if (typeof parsed.scene === "string" && parsed.scene.trim()) {
      goals.scene = parsed.scene.trim().slice(0, 200);
    }
    if (parsed.session && typeof parsed.session.text === "string" && parsed.session.text.trim()) {
      goals.session = {
        text: parsed.session.text.trim().slice(0, 200),
        progress: Math.max(0, Math.floor(Number(parsed.session.progress ?? 0)) || 0),
        target: Math.max(1, Math.min(6, Math.floor(Number(parsed.session.target ?? 3)) || 3)),
      };
    }
    if (typeof parsed.ambition === "string" && parsed.ambition.trim()) {
      goals.ambition = parsed.ambition.trim().slice(0, 300);
    }
    return goals;
  } catch {
    return {};
  }
}

export function parseRelations(raw: string): NpcRelation[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry.npcName === "string" && entry.npcName.trim())
      .slice(0, 20)
      .map((entry) => ({
        npcName: String(entry.npcName).trim().slice(0, 80),
        score: clampAxis(Number(entry.score ?? 0)),
        ...(typeof entry.note === "string" && entry.note.trim()
          ? { note: String(entry.note).trim().slice(0, 120) }
          : {}),
      }));
  } catch {
    return [];
  }
}

export function parseBonds(raw: string): NpcBond[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => entry && typeof entry.characterId === "string" && entry.characterId)
      .slice(0, 20)
      .map((entry) => ({
        characterId: String(entry.characterId),
        score: clampAxis(Number(entry.score ?? 0)),
      }));
  } catch {
    return [];
  }
}

export function parsePressure(raw: string): NpcPressure {
  if (!raw) {
    return { ignored: 0, engaged: 0 };
  }
  try {
    const parsed = JSON.parse(raw) as { ignored?: unknown; engaged?: unknown };
    return {
      ignored: Math.max(0, Math.floor(Number(parsed.ignored ?? 0)) || 0),
      engaged: Math.max(0, Math.floor(Number(parsed.engaged ?? 0)) || 0),
    };
  } catch {
    return { ignored: 0, engaged: 0 };
  }
}

// ---- personality ----

// A small stable hash so two NPCs with the same attitude still differ.
function nameHash(seed: string): number {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(index);
  }
  return hash >>> 0;
}

// Deterministic coarse hexagon from what we already know: the seed spreads
// each axis into -1..1 from the name, then attitude leans warmth/empathy.
// A hostile enforcer and a friendly innkeeper feel different from turn one
// without any model call; play then drifts the axes.
export function derivePersonality(
  name: string,
  attitude: "hostile" | "indifferent" | "friendly",
  trait: string,
): NpcPersonality {
  const seed = nameHash(`${name.toLowerCase()}|${trait.toLowerCase()}`);
  const axisSeed = (index: number) => ((seed >> (index * 4)) % 3) - 1;
  const lean = attitude === "friendly" ? 1 : attitude === "hostile" ? -1 : 0;
  return {
    drive: clampAxis(axisSeed(0)),
    diligence: clampAxis(axisSeed(1)),
    boldness: clampAxis(axisSeed(2)),
    warmth: clampAxis(axisSeed(3) + lean * 2),
    empathy: clampAxis(axisSeed(4) + lean),
    composure: clampAxis(axisSeed(5)),
  };
}

// Decisive social outcomes drift the axes a step: being won over warms an
// NPC, being cowed shakes their composure, other setbacks cool them.
export function driftPersonality(
  personality: NpcPersonality,
  approach: "persuade" | "deceive" | "intimidate",
  direction: "up" | "down",
): NpcPersonality {
  const next = { ...personality };
  if (direction === "up") {
    next.warmth = clampAxis(next.warmth + 1);
    if (approach === "persuade") {
      next.empathy = clampAxis(next.empathy + 1);
    }
  } else if (approach === "intimidate") {
    next.composure = clampAxis(next.composure - 1);
    next.warmth = clampAxis(next.warmth - 1);
  } else {
    next.warmth = clampAxis(next.warmth - 1);
  }
  return next;
}

// ---- bonds ----

// A decisive attitude shift also moves the acting character's personal bond
// one step in the same direction. Same once-per-exchange guard as attitude:
// the caller only invokes this when the shift actually landed.
export function shiftBond(
  bonds: NpcBond[],
  characterId: string,
  direction: "up" | "down",
): NpcBond[] {
  const delta = direction === "up" ? 1 : -1;
  const existing = bonds.find((bond) => bond.characterId === characterId);
  if (!existing) {
    return [...bonds, { characterId, score: clampAxis(delta) }];
  }
  return bonds.map((bond) =>
    bond.characterId === characterId ? { ...bond, score: clampAxis(bond.score + delta) } : bond,
  );
}

// Moves a directed NPC-to-NPC edge, creating it at the delta when new.
export function shiftRelation(
  relations: NpcRelation[],
  npcName: string,
  delta: number,
  note?: string,
): NpcRelation[] {
  const existing = relations.find(
    (relation) => relation.npcName.toLowerCase() === npcName.toLowerCase(),
  );
  if (!existing) {
    return [
      ...relations,
      { npcName, score: clampAxis(delta), ...(note ? { note } : {}) },
    ].slice(0, 20);
  }
  return relations.map((relation) =>
    relation === existing
      ? {
          ...relation,
          score: clampAxis(relation.score + delta),
          ...(note ? { note } : {}),
        }
      : relation,
  );
}

// ---- session goals (background dice) ----

export type GoalAdvanceResult = {
  goal: NpcSessionGoal;
  advanced: boolean;
  completed: boolean;
  rolled: number;
};

const GOAL_ADVANCE_DC = 12;

// One background roll per chapter: d20 + drive + boldness/2 against a flat
// DC. Driven NPCs push their schemes along; timid ones stall.
export function advanceSessionGoal(
  goal: NpcSessionGoal,
  personality: NpcPersonality | null,
  d20: number,
): GoalAdvanceResult {
  const modifier = personality
    ? personality.drive + Math.trunc(personality.boldness / 2)
    : 0;
  const rolled = d20 + modifier;
  if (rolled < GOAL_ADVANCE_DC) {
    return { goal, advanced: false, completed: false, rolled };
  }
  const progress = goal.progress + 1;
  return {
    goal: { ...goal, progress },
    advanced: true,
    completed: progress >= goal.target,
    rolled,
  };
}

// ---- goal collisions ----

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "into", "over", "their", "them",
  "they", "that", "this", "his", "her", "its", "our", "your", "who",
  "what", "where", "when", "will", "wants", "want", "take", "get", "keep",
  "make", "become", "becomes", "out", "off", "own", "new", "old", "all",
  "party", "gold",
]);

function goalTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3 && !STOPWORDS.has(token)),
  );
}

export type GoalCollision = { a: string; b: string; over: string };

// Two NPCs whose session goals name the same significant thing are after
// the same prize; the caller resolves each collision with opposed dice.
export function detectGoalCollisions(
  npcs: Array<{ name: string; goalText: string }>,
): GoalCollision[] {
  const collisions: GoalCollision[] = [];
  for (let indexA = 0; indexA < npcs.length; indexA += 1) {
    for (let indexB = indexA + 1; indexB < npcs.length; indexB += 1) {
      const tokensA = goalTokens(npcs[indexA].goalText);
      const tokensB = goalTokens(npcs[indexB].goalText);
      const shared = [...tokensA].find((token) => tokensB.has(token));
      if (shared) {
        collisions.push({ a: npcs[indexA].name, b: npcs[indexB].name, over: shared });
      }
    }
  }
  return collisions;
}

// ---- pressure ----

export function tickPressure(pressure: NpcPressure, mentioned: boolean): NpcPressure {
  return mentioned
    ? { ignored: 0, engaged: Math.min(pressure.engaged + 1, 9) }
    : { ignored: Math.min(pressure.ignored + 1, 9), engaged: pressure.engaged };
}

// A behavioral note once the counters lean far enough; null while balanced.
export function pressureState(pressure: NpcPressure): "ignored" | "engaged" | null {
  if (pressure.ignored >= 2) {
    return "ignored";
  }
  if (pressure.engaged >= 3) {
    return "engaged";
  }
  return null;
}

// ---- roster rendering ----

// The compact agency fragment appended to an NPC's roster line, bounded so
// twenty NPCs cannot blow up GAME STATE. bondNames resolves characterId to
// a display name; unknown ids are skipped.
export function agencyFragment(
  agency: NpcAgency,
  bondNames: Map<string, string>,
): string {
  const parts: string[] = [];
  if (agency.personality) {
    const p = agency.personality;
    const notable = (
      [
        ["driven", p.drive], ["dutiful", p.diligence], ["bold", p.boldness],
        ["warm", p.warmth], ["empathic", p.empathy], ["composed", p.composure],
      ] as Array<[string, number]>
    )
      .filter(([, value]) => Math.abs(value) >= 2)
      .map(([label, value]) => (value > 0 ? label : `not ${label}`))
      .slice(0, 3);
    if (notable.length) {
      parts.push(notable.join(", "));
    }
  }
  const bonds = agency.bonds
    .filter((bond) => bond.score !== 0 && bondNames.has(bond.characterId))
    .slice(0, 4)
    .map((bond) => `${bondNames.get(bond.characterId)} ${bond.score > 0 ? "+" : ""}${bond.score}`);
  if (bonds.length) {
    parts.push(`bonds: ${bonds.join(", ")}`);
  }
  if (agency.goals.session) {
    parts.push(
      `pursuing: ${agency.goals.session.text} (${agency.goals.session.progress}/${agency.goals.session.target})`,
    );
  } else if (agency.goals.ambition) {
    parts.push(`wants: ${agency.goals.ambition}`);
  }
  const relations = agency.relations
    .filter((relation) => Math.abs(relation.score) >= 2)
    .slice(0, 3)
    .map((relation) => `${relation.npcName} ${relation.score > 0 ? "+" : ""}${relation.score}`);
  if (relations.length) {
    parts.push(`ties: ${relations.join(", ")}`);
  }
  const pressed = pressureState(agency.pressure);
  if (pressed === "ignored") {
    parts.push("feels ignored by the party; cools toward them and may act without them");
  } else if (pressed === "engaged") {
    parts.push("feels courted by the party");
  }
  return parts.join(" | ").slice(0, 400);
}
