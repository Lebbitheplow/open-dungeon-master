// Writing an NPC on purpose.
//
// The agency model in src/lib/dm/npc-logic.ts is far richer than anything a
// person could reach: six personality axes, a scene goal, a session goal
// advanced by background dice, a defining ambition, NPC-to-NPC relations,
// aliases. All of it was reachable only by the AI DM's tools or by a
// migration. This module is the half of the forge that decides what a valid
// NPC is, so the panel and the route can both ask it rather than each
// deciding for themselves.
//
// Two things here are not just validation, and they are the reason this is a
// module rather than a zod schema.
//
// The first is that an axis is stored as a number and read as a word. A DM
// setting "warmth: 2" is guessing; a DM setting "warm" is writing a person.
// The number is what the engine drifts and compares, the word is what the
// human works in, and the translation belongs in one place.
//
// The second is that relations are stored per NPC and are therefore
// one-sided by construction. Marla can hold a grudge the smith knows nothing
// about, which is true to life and invisible in a JSON field. relationGraph
// resolves the roster into edges that say plainly which links are mutual,
// which are one-sided, and which point at somebody who does not exist.
//
// Pure by design: no DB and no I/O, so scripts/test-npc-forge.mjs drives it
// directly. Its imports, npc-logic.ts and gender.ts, are themselves pure;
// the impure rim is src/lib/db/npcs.ts.

import {
  PERSONALITY_AXES,
  clampAxis,
  type NpcGoals,
  type NpcPersonality,
  type NpcRelation,
} from "@/lib/dm/npc-logic";
import { storedGender, type Gender } from "@/lib/gender";

export const ATTITUDES = ["hostile", "indifferent", "friendly"] as const;
export type Attitude = (typeof ATTITUDES)[number];

// What the six axes mean at each end. Written as adjectives a DM would use
// at the table, because the slider shows these and not the number.
export const AXIS_LABELS: Record<
  (typeof PERSONALITY_AXES)[number],
  { name: string; low: string; high: string }
> = {
  drive: { name: "Drive", low: "content", high: "driven" },
  diligence: { name: "Diligence", low: "slapdash", high: "meticulous" },
  boldness: { name: "Boldness", low: "cautious", high: "bold" },
  warmth: { name: "Warmth", low: "cold", high: "warm" },
  empathy: { name: "Empathy", low: "callous", high: "understanding" },
  composure: { name: "Composure", low: "volatile", high: "unflappable" },
};

export type AxisName = keyof typeof AXIS_LABELS;

// A person, not a number. Zero is "neither", which is a real answer: most
// people are unremarkable on most axes and a roster where everyone is
// extreme on all six is a roster of cartoons.
export function describeAxis(axis: AxisName, value: number): string {
  const labels = AXIS_LABELS[axis];
  const score = clampAxis(value);
  if (score === 0) {
    return "neither";
  }
  const word = score > 0 ? labels.high : labels.low;
  return Math.abs(score) >= 2 ? `very ${word}` : word;
}

// The whole personality in a phrase, for the roster line. Only the axes that
// actually say something appear: listing six traits when four are zero
// describes nobody.
export function describePersonality(personality: NpcPersonality | null): string {
  if (!personality) {
    return "";
  }
  const traits = PERSONALITY_AXES.filter((axis) => clampAxis(personality[axis]) !== 0).map((axis) =>
    describeAxis(axis, personality[axis]),
  );
  return traits.join(", ");
}

export const BLANK_PERSONALITY: NpcPersonality = {
  drive: 0,
  diligence: 0,
  boldness: 0,
  warmth: 0,
  empathy: 0,
  composure: 0,
};

export function normalizePersonality(input: unknown): NpcPersonality | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const raw = input as Record<string, unknown>;
  const personality = {} as NpcPersonality;
  for (const axis of PERSONALITY_AXES) {
    personality[axis] = clampAxis(Number(raw[axis] ?? 0));
  }
  return personality;
}

// ---- relations ----

export const RELATION_LABELS: Record<number, string> = {
  [-3]: "sworn enemy",
  [-2]: "hostile",
  [-1]: "wary",
  0: "neutral",
  1: "friendly",
  2: "close",
  3: "devoted",
};

export function describeRelation(score: number): string {
  return RELATION_LABELS[clampAxis(score)] ?? "neutral";
}

// A DM naming twenty people one NPC has opinions about is writing a faction,
// not a character; the parser already caps at 20 and this matches it so the
// panel never offers to store something that will be silently dropped.
export const MAX_RELATIONS = 20;

export function setRelation(
  relations: NpcRelation[],
  npcName: string,
  score: number,
  note?: string,
): NpcRelation[] {
  const name = npcName.trim().slice(0, 80);
  if (!name) {
    return relations;
  }
  const trimmedNote = (note ?? "").trim().slice(0, 120);
  const entry: NpcRelation = {
    npcName: name,
    score: clampAxis(score),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
  const existing = relations.findIndex(
    (relation) => relation.npcName.toLowerCase() === name.toLowerCase(),
  );
  if (existing >= 0) {
    const next = [...relations];
    next[existing] = entry;
    return next;
  }
  return relations.length >= MAX_RELATIONS ? relations : [...relations, entry];
}

export function removeRelation(relations: NpcRelation[], npcName: string): NpcRelation[] {
  return relations.filter(
    (relation) => relation.npcName.toLowerCase() !== npcName.trim().toLowerCase(),
  );
}

export type GraphNode = { name: string; known: boolean };

export type GraphEdge = {
  from: string;
  to: string;
  score: number;
  note?: string;
  // The other side holds an opinion too. Both scores are kept: a one-sided
  // friendship where the other party is wary is a story, not an error.
  mutual: boolean;
  backScore?: number;
  // The target is not an NPC on this roster. Also not an error: a DM may
  // name somebody they have not written yet. Worth showing, though, because
  // it is invisible in the stored JSON.
  dangling: boolean;
};

export type RelationGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

// Resolves a roster's per-NPC relation lists into edges, so the panel can
// draw a graph rather than print JSON. Each pair appears once.
export function relationGraph(
  roster: Array<{ name: string; relations: NpcRelation[] }>,
): RelationGraph {
  const byName = new Map(roster.map((npc) => [npc.name.toLowerCase(), npc]));
  const nodes: GraphNode[] = roster.map((npc) => ({ name: npc.name, known: true }));
  const seenNode = new Set(roster.map((npc) => npc.name.toLowerCase()));
  const edges: GraphEdge[] = [];
  const seenPair = new Set<string>();

  for (const npc of roster) {
    for (const relation of npc.relations) {
      const targetKey = relation.npcName.toLowerCase();
      const target = byName.get(targetKey);
      if (!target && !seenNode.has(targetKey)) {
        seenNode.add(targetKey);
        nodes.push({ name: relation.npcName, known: false });
      }
      // One entry per pair, whichever direction is walked first.
      const pairKey = [npc.name.toLowerCase(), targetKey].sort().join("\u0000");
      if (seenPair.has(pairKey)) {
        continue;
      }
      seenPair.add(pairKey);
      const back = target?.relations.find(
        (entry) => entry.npcName.toLowerCase() === npc.name.toLowerCase(),
      );
      edges.push({
        from: npc.name,
        to: relation.npcName,
        score: relation.score,
        ...(relation.note ? { note: relation.note } : {}),
        mutual: Boolean(back),
        ...(back ? { backScore: back.score } : {}),
        dangling: !target,
      });
    }
  }
  return { nodes, edges };
}

// ---- the draft ----

// Their own voice for read-aloud (docs/vtt-parity-implementation-plan.md
// 8.2), or null for the narrator's.
export type NpcVoice = { voiceId: string; speed: number };

export function normalizeNpcVoice(raw: unknown): NpcVoice | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const voiceId = typeof record.voiceId === "string" ? record.voiceId.trim().slice(0, 120) : "";
  if (!voiceId) {
    return null;
  }
  const speed = Number(record.speed);
  return { voiceId, speed: Number.isFinite(speed) ? Math.round(Math.min(1.4, Math.max(0.7, speed)) * 100) / 100 : 1 };
}

export type NpcDraft = {
  name: string;
  voice: NpcVoice | null;
  // The faction they belong to, by id; "" for none.
  factionId: string;
  aliases: string[];
  attitude: Attitude;
  trait: string;
  location: string;
  // What they do: a role id from the picker ("merchant", "mystery-inspector")
  // or free text. Chooses the placeholder face (src/lib/placeholders.ts).
  role: string;
  // src/lib/gender.ts; "" for unspecified.
  gender: Gender;
  personality: NpcPersonality | null;
  goals: NpcGoals;
  relations: NpcRelation[];
  // The stat block they fight with when it comes to blows: a monster
  // reference start_encounter resolves ("veteran", "homebrew:<id>"); "" for
  // none (src/lib/dm/encounter-spawn.ts).
  statBlock: string;
};

export function blankDraft(): NpcDraft {
  return {
    name: "",
    voice: null,
    factionId: "",
    aliases: [],
    attitude: "indifferent",
    trait: "",
    location: "",
    role: "",
    gender: "",
    personality: null,
    goals: {},
    relations: [],
    statBlock: "",
  };
}

export type DraftOutcome = { draft: NpcDraft } | { error: string };

// A stored NPC opened for editing. Typed structurally rather than against
// the row type so this module stays free of the database, which is what lets
// the test script load it directly.
export function draftFrom(npc: {
  name: string;
  aliases: string[];
  attitude: string;
  trait: string;
  location: string;
  // Optional so rows stored before the column existed still open.
  role?: string;
  gender?: Gender;
  voice?: NpcVoice | null;
  factionId?: string;
  statBlock?: string;
  agency: { personality: NpcPersonality | null; goals: NpcGoals; relations: NpcRelation[] };
}): NpcDraft {
  return {
    statBlock: npc.statBlock ?? "",
    name: npc.name,
    voice: npc.voice ? { ...npc.voice } : null,
    factionId: npc.factionId ?? "",
    aliases: [...npc.aliases],
    attitude: ATTITUDES.includes(npc.attitude as Attitude)
      ? (npc.attitude as Attitude)
      : "indifferent",
    trait: npc.trait,
    location: npc.location,
    role: npc.role ?? "",
    gender: npc.gender ?? "",
    personality: npc.agency.personality ? { ...npc.agency.personality } : null,
    goals: structuredClone(npc.agency.goals),
    relations: npc.agency.relations.map((relation) => ({ ...relation })),
  };
}

function cleanList(input: unknown, max: number, length: number): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of input) {
    const value = String(entry ?? "").trim().slice(0, length);
    if (value && !seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

// The one boundary an NPC crosses on its way in. Everything downstream of
// this can assume a draft is already the shape the columns expect.
export function normalizeNpcDraft(input: unknown): DraftOutcome {
  const raw = (input ?? {}) as Record<string, unknown>;
  const name = String(raw.name ?? "").trim().slice(0, 80);
  if (!name) {
    return { error: "An NPC needs a name before anything else about them matters." };
  }

  const attitude = ATTITUDES.includes(raw.attitude as Attitude)
    ? (raw.attitude as Attitude)
    : "indifferent";

  // An alias that repeats the name is not an alias, and it would make the
  // entity resolver do redundant work on every mention.
  const aliases = cleanList(raw.aliases, 8, 80).filter(
    (alias) => alias.toLowerCase() !== name.toLowerCase(),
  );

  const goalsRaw = (raw.goals ?? {}) as Record<string, unknown>;
  const goals: NpcGoals = {};
  const scene = String(goalsRaw.scene ?? "").trim().slice(0, 200);
  if (scene) {
    goals.scene = scene;
  }
  const ambition = String(goalsRaw.ambition ?? "").trim().slice(0, 300);
  if (ambition) {
    goals.ambition = ambition;
  }
  const session = (goalsRaw.session ?? null) as Record<string, unknown> | null;
  const sessionText = String(session?.text ?? "").trim().slice(0, 200);
  if (sessionText) {
    const target = Math.max(1, Math.min(6, Math.round(Number(session?.target ?? 3)) || 3));
    goals.session = {
      text: sessionText,
      // Progress can never exceed the target: a goal shown as 5 of 3 is a
      // display bug the DM would have to reason about mid-session.
      progress: Math.max(0, Math.min(target, Math.round(Number(session?.progress ?? 0)) || 0)),
      target,
    };
  }

  let relations: NpcRelation[] = [];
  if (Array.isArray(raw.relations)) {
    for (const entry of raw.relations as Array<Record<string, unknown>>) {
      relations = setRelation(
        relations,
        String(entry?.npcName ?? ""),
        Number(entry?.score ?? 0),
        entry?.note === undefined ? undefined : String(entry.note),
      );
    }
    // An NPC cannot hold an opinion about themselves; the graph would draw a
    // loop and the DM would have written nothing.
    relations = removeRelation(relations, name);
  }

  return {
    draft: {
      name,
      voice: normalizeNpcVoice(raw.voice),
      factionId: String(raw.factionId ?? "").trim().slice(0, 64),
      aliases,
      attitude,
      trait: String(raw.trait ?? "").trim().slice(0, 200),
      location: String(raw.location ?? "").trim().slice(0, 120),
      role: String(raw.role ?? "").trim().slice(0, 40),
      gender: storedGender(raw.gender),
      personality: normalizePersonality(raw.personality),
      goals,
      relations,
      statBlock: String(raw.statBlock ?? "").trim().slice(0, 80),
    },
  };
}

// The roster line: who they are in one sentence, without opening them.
export function describeNpc(draft: NpcDraft): string {
  const parts = [draft.trait, describePersonality(draft.personality), draft.location]
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(". ");
}

// ---- generation, one field at a time ----

// The plan's word for this is "interactive": a DM should be able to accept
// the model's goals and reject its personality. So generation is per field
// and never returns a whole NPC, which would be a form that fills itself in
// and leaves a person with nothing to disagree with.
export const GENERATABLE_FIELDS = ["trait", "scene", "session", "ambition", "personality"] as const;
export type GeneratableField = (typeof GENERATABLE_FIELDS)[number];

export const FIELD_LABELS: Record<GeneratableField, string> = {
  trait: "Distinguishing trait",
  scene: "What they want right now",
  session: "What they are working toward",
  ambition: "Their defining ambition",
  personality: "Personality",
};

// Applies one generated field to a draft and leaves everything else exactly
// as the DM left it.
export function applyGeneratedField(
  draft: NpcDraft,
  field: GeneratableField,
  value: string,
): NpcDraft {
  const text = value.trim();
  if (field === "personality") {
    return { ...draft, personality: parsePersonalityWords(text) ?? draft.personality };
  }
  if (!text) {
    return draft;
  }
  if (field === "trait") {
    return { ...draft, trait: text.slice(0, 200) };
  }
  if (field === "scene") {
    return { ...draft, goals: { ...draft.goals, scene: text.slice(0, 200) } };
  }
  if (field === "ambition") {
    return { ...draft, goals: { ...draft.goals, ambition: text.slice(0, 300) } };
  }
  return {
    ...draft,
    goals: {
      ...draft.goals,
      session: {
        text: text.slice(0, 200),
        progress: draft.goals.session?.progress ?? 0,
        target: draft.goals.session?.target ?? 3,
      },
    },
  };
}

// Reads a personality back out of the words the model was asked for, so the
// axes stay the vocabulary and the model never has to invent a number scale.
// Anything it says that is not one of the twelve adjectives is ignored.
export function parsePersonalityWords(text: string): NpcPersonality | null {
  const lower = ` ${text.toLowerCase().replace(/[^a-z ]+/g, " ")} `;
  const personality = { ...BLANK_PERSONALITY };
  let matched = false;
  for (const axis of PERSONALITY_AXES) {
    const { low, high } = AXIS_LABELS[axis];
    const veryHigh = lower.includes(` very ${high} `);
    const veryLow = lower.includes(` very ${low} `);
    if (veryHigh || lower.includes(` ${high} `)) {
      personality[axis] = veryHigh ? 2 : 1;
      matched = true;
    } else if (veryLow || lower.includes(` ${low} `)) {
      personality[axis] = veryLow ? -2 : -1;
      matched = true;
    }
  }
  return matched ? personality : null;
}

// Models like to wrap an answer in quotes, prefix it with the field name, or
// hand back a bulleted list when asked for one line. Take the first real line
// and strip the decoration rather than storing it. Lives here rather than
// beside the model call because it is text work with no I/O in it, which is
// the line every module in this codebase is drawn on.
export function cleanSuggestion(raw: string): string {
  const line = raw
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) {
    return "";
  }
  return line
    .replace(/^[-*\u2022]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(trait|goal|ambition|personality|answer)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .slice(0, 300);
}

// The adjectives a model may use, handed to it in the prompt so it answers
// in the vocabulary the axes are built from rather than in its own.
export function personalityVocabulary(): string {
  return PERSONALITY_AXES.map((axis) => `${AXIS_LABELS[axis].low}/${AXIS_LABELS[axis].high}`).join(
    ", ",
  );
}
