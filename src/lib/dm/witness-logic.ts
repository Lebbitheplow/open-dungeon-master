// Pure witness / knowledge-boundary logic, kept free of alias imports so
// node test scripts (scripts/test-witness.mjs) can load it directly.
//
// Nothing currently stops the model having a shopkeeper across town mention
// a secret struck in a cellar. world_facts.known_by already scopes which
// PLAYERS may read a fact; this is the other half, scoping which NPCs could
// plausibly know it.
//
// The rule is deliberately permissive in one direction and strict in the
// other. Marking a fact as witnessed is evidence an NPC knows it; NOT being
// a witness is not proof they are ignorant, because news travels, people
// gossip, and a spymaster's whole job is knowing things they did not see. So
// an unwitnessed fact is "they have no on-screen reason to know this",
// which the prompt renders as a caution rather than a prohibition. What is
// forbidden is an NPC citing a specific private moment they were absent for.

// Facts everyone in the world may reasonably know regardless of who was
// present. A public execution is not a secret.
export const PUBLIC_CATEGORIES = ["world", "lore", "location"] as const;

export type WitnessableFact = {
  category: string;
  subject: string;
  fact: string;
  witnessedBy: string[];
};

export function parseWitnesses(raw: string): string[] {
  if (!raw || !raw.startsWith("[")) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeWitnesses(parsed.map((entry) => String(entry)));
  } catch {
    return [];
  }
}

export function serializeWitnesses(names: string[]): string {
  return JSON.stringify(normalizeWitnesses(names));
}

// Case-insensitive dedupe that keeps the first spelling seen and bounds the
// list, since a crowded scene should not blow up the row.
export function normalizeWitnesses(names: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = String(raw ?? "").trim();
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name);
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

export function mergeWitnesses(existing: string[], incoming: string[], limit = 12): string[] {
  return normalizeWitnesses([...existing, ...incoming], limit);
}

// Which tracked NPCs a span of text mentions. Matches on whole words so
// "Mar" does not match "Marla", and checks aliases so the short form in the
// transcript resolves to the canonical row (src/lib/dm/entity-logic.ts).
export function detectWitnesses(
  text: string,
  roster: Array<{ name: string; aliases?: string[] }>,
): string[] {
  if (!text.trim()) {
    return [];
  }
  const haystack = text.toLowerCase();
  const found: string[] = [];
  for (const npc of roster) {
    const candidates = [npc.name, ...(npc.aliases ?? [])];
    const present = candidates.some((candidate) => {
      const needle = candidate.trim().toLowerCase();
      if (needle.length < 3) {
        return false;
      }
      // Word-boundary match without regex escaping surprises in names.
      let index = haystack.indexOf(needle);
      while (index >= 0) {
        const before = index === 0 ? " " : haystack[index - 1];
        const afterIndex = index + needle.length;
        const after = afterIndex >= haystack.length ? " " : haystack[afterIndex];
        if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
          return true;
        }
        index = haystack.indexOf(needle, index + 1);
      }
      return false;
    });
    if (present) {
      found.push(npc.name);
    }
  }
  return normalizeWitnesses(found);
}

export function isPublicCategory(category: string): boolean {
  return (PUBLIC_CATEGORIES as readonly string[]).includes(category);
}

// Whether this NPC has an on-screen reason to know this fact.
export function npcCouldKnow(fact: WitnessableFact, npcName: string): boolean {
  if (isPublicCategory(fact.category)) {
    return true;
  }
  // A fact nobody was recorded witnessing predates witness tracking or came
  // from off-screen simulation; treat it as ambient rather than secret, or
  // every NPC in an existing campaign suddenly forgets everything.
  if (!fact.witnessedBy.length) {
    return true;
  }
  const needle = npcName.trim().toLowerCase();
  return fact.witnessedBy.some((witness) => witness.trim().toLowerCase() === needle);
}

// The per-NPC prompt line naming what they were present for. Empty when
// there is nothing worth constraining, so the roster stays terse.
export function renderWitnessNote(
  npcName: string,
  facts: WitnessableFact[],
  limit = 3,
): string {
  const absent = facts.filter(
    (fact) =>
      !isPublicCategory(fact.category) &&
      fact.witnessedBy.length > 0 &&
      !npcCouldKnow(fact, npcName),
  );
  if (!absent.length) {
    return "";
  }
  const subjects = normalizeWitnesses(
    absent.map((fact) => fact.subject || fact.fact.slice(0, 40)),
    limit,
  );
  return subjects.length ? `was not present for: ${subjects.join("; ")}` : "";
}
