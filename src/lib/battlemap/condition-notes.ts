// What a condition's stored metadata means, in the words a player reads on a
// chip: how long it lasts (rounds, "until Kael's turn", "save ends (WIS 13)"),
// and who or what put it there. The engine keeps these beside the condition
// names (ConditionMeta in src/lib/dm/condition-logic.ts); before this the
// board, the party panel and the sheet showed the rounds only, so Dodge,
// Shield, a Stunning Strike and every save-ends effect looked permanent.
//
// Pure and database-free: the board projection (view.ts), the encounter
// projection and the sheet chips all call it, and scripts/test-hand-engine.mjs
// drives it.
import { describeConditionDuration } from "@/lib/dm/condition-logic";
import { conditionEffectsFor } from "@/lib/srd/condition-effects";

export type ConditionMetaLike = {
  rounds?: number;
  untilTurnOf?: string;
  // Lasts until the END of this creature's next turn (Stunning Strike,
  // Guiding Bolt, Menacing Attack; src/lib/dm/turn-end.ts). `turnBegun`: that
  // turn has started, so it ends when this turn does.
  untilTurnEndOf?: string;
  turnBegun?: boolean;
  saveEnds?: { ability: string; dc: number };
  source?: string;
  spell?: string;
};

// The SRD's own conditions, which every player already reads. Any other name
// the engine writes ("halted", "retching", "hurled through hell") carries its
// registry row's one-line summary, so a chip says what it does.
const SRD_CONDITIONS = new Set([
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
]);

function meaningOf(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (SRD_CONDITIONS.has(key) || /^exhaustion\b/.test(key)) return null;
  const summary = conditionEffectsFor(key)?.summary?.trim();
  return summary ? summary.replace(/\.$/, "") : null;
}

// Words the engine writes into `source` that are not a creature's id.
const ENGINE_WORDS: Record<string, string> = {
  stable: "stable",
  "knocked out": "knocked out",
  check: "for a check",
};

export type ConditionNote = {
  // "3 rounds", "until Goblin 2's turn", "until their next turn".
  duration: string | null;
  // The duration is a count of rounds (a chip that shows the count itself
  // leaves it out of the line).
  counted: boolean;
  // "save ends (WIS 13)".
  save: string | null;
  // "from Kael", "Hold Person", "trigger: the ogre steps in".
  source: string | null;
  // What a condition outside the SRD's list does ("no action this turn").
  meaning?: string | null;
};

export function conditionNote(
  name: string,
  meta: ConditionMetaLike | undefined,
  // Resolves a combatant id to a name, or null when the viewer may not know it.
  nameOf: (id: string) => string | null,
  // The creature carrying the condition, so its own turn reads "their next turn".
  holderId?: string,
): ConditionNote {
  const meaning = meaningOf(name);
  if (!meta) {
    return { duration: null, counted: false, save: null, source: null, meaning };
  }
  let duration: string | null = null;
  let counted = false;
  if (meta.untilTurnEndOf) {
    const who = meta.untilTurnEndOf === holderId ? null : nameOf(meta.untilTurnEndOf);
    const turn = meta.turnBegun ? "turn" : "next turn";
    duration = who ? `until the end of ${who}'s ${turn}` : `until the end of their ${turn}`;
  } else if (meta.untilTurnOf) {
    const who = meta.untilTurnOf === holderId ? null : nameOf(meta.untilTurnOf);
    duration = who ? `until ${who}'s turn` : "until their next turn";
  } else if (typeof meta.rounds === "number" && meta.rounds > 0) {
    duration = describeConditionDuration(meta.rounds);
    counted = true;
  }
  const save = meta.saveEnds ? `save ends (${meta.saveEnds.ability.toUpperCase()} ${meta.saveEnds.dc})` : null;
  let source: string | null = null;
  const raw = meta.source?.trim() ?? "";
  if (name.trim().toLowerCase() === "readied" && raw) {
    // Ready's trigger is stored as the source (src/lib/dm/object-actions.ts).
    source = `trigger: ${raw}`;
  } else if (raw && ENGINE_WORDS[raw.toLowerCase()]) {
    source = ENGINE_WORDS[raw.toLowerCase()];
  } else if (raw) {
    const who = nameOf(raw);
    source = who ? `from ${who}` : null;
  }
  if (meta.spell && !source) {
    source = meta.spell;
  } else if (meta.spell && source && !source.includes(meta.spell)) {
    source = `${source} (${meta.spell})`;
  }
  return { duration, counted, save, source, meaning };
}

// One line for a tooltip or a chip's tail: "until Kael's turn, from Kael".
// `skipCounted` leaves a round count out, for a chip that shows it already.
// A condition outside the SRD's list leads with what it does.
export function conditionNoteLine(note: ConditionNote, options: { skipCounted?: boolean } = {}): string {
  const duration = options.skipCounted && note.counted ? null : note.duration;
  return [note.meaning, duration, note.save, note.source].filter(Boolean).join(", ");
}

// A name lookup over the combatants a viewer can see.
export function namesLookup(entries: Array<{ id: string; name: string }>): (id: string) => string | null {
  const byId = new Map(entries.map((entry) => [entry.id, entry.name]));
  return (id) => byId.get(id) ?? null;
}
