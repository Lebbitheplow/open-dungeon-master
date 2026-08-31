import {
  createHomebrew,
  deleteHomebrew,
  getHomebrew,
  listHomebrew,
  updateHomebrew,
  type HomebrewEntry,
} from "@/lib/db/homebrew";
import {
  draftFromData,
  draftToData,
  describeMonster,
  readMonster,
  type MonsterDraft,
  type MonsterReadout,
} from "@/lib/bestiary/monster-draft";

// The DB rim for hand-built monsters.
//
// They live in homebrew_entries under kind "monster", which is a row that
// already existed and that the content search already returns
// (src/lib/content/index.ts). Storing them anywhere else would have meant a
// second monster table the pickers do not know about.
//
// Owned by a USER rather than by a campaign, like every other homebrew kind.
// That is the right scope: a DM who builds a monster in one workshop should
// find it in the next one without exporting anything.

export type HomebrewMonster = {
  id: string;
  slug: string;
  draft: MonsterDraft;
  desc: string;
  readout: MonsterReadout;
  summary: string;
  updatedAt: string;
};

function hydrate(entry: HomebrewEntry): HomebrewMonster {
  const draft = draftFromData(entry.name, entry.data);
  return {
    id: entry.id,
    slug: `homebrew:${entry.id}`,
    draft,
    desc: typeof entry.data.desc === "string" ? entry.data.desc : "",
    readout: readMonster(draft),
    summary: describeMonster(draft),
    updatedAt: entry.updatedAt,
  };
}

export function listHomebrewMonsters(userId: string): HomebrewMonster[] {
  return listHomebrew(userId, "monster").map(hydrate);
}

export function getHomebrewMonster(userId: string, id: string): HomebrewMonster | null {
  const entry = getHomebrew(userId, id);
  return entry && entry.kind === "monster" ? hydrate(entry) : null;
}

export function createHomebrewMonster(
  userId: string,
  draft: MonsterDraft,
  desc: string,
): HomebrewMonster {
  return hydrate(
    createHomebrew(userId, {
      kind: "monster",
      name: draft.name,
      data: draftToData(draft, desc),
    }),
  );
}

export function updateHomebrewMonster(
  userId: string,
  id: string,
  draft: MonsterDraft,
  desc: string,
): HomebrewMonster | null {
  const existing = getHomebrew(userId, id);
  if (!existing || existing.kind !== "monster") {
    return null;
  }
  const updated = updateHomebrew(userId, id, {
    name: draft.name,
    data: draftToData(draft, desc),
  });
  return updated ? hydrate(updated) : null;
}

export function deleteHomebrewMonster(userId: string, id: string): boolean {
  const existing = getHomebrew(userId, id);
  if (!existing || existing.kind !== "monster") {
    return false;
  }
  return deleteHomebrew(userId, id);
}

// The lookup resolveMonster needs: a reference a DM typed, against the
// monsters this DM has built. Accepts the "homebrew:<id>" slug the content
// pickers hand out, or the monster's name, because the roster box in the
// encounter prep panel takes names and a DM will type the one they wrote.
export function findHomebrewMonster(userId: string, ref: string): HomebrewMonster | null {
  const trimmed = ref.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("homebrew:")) {
    return getHomebrewMonster(userId, trimmed.slice("homebrew:".length));
  }
  const lowered = trimmed.toLowerCase();
  return (
    listHomebrewMonsters(userId).find(
      (monster) => monster.draft.name.toLowerCase() === lowered,
    ) ?? null
  );
}
