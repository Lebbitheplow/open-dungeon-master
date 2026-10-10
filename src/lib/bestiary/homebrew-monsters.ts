import { createHomebrew, deleteHomebrew, getHomebrew, listHomebrew, updateHomebrew, type HomebrewEntry, archiveHomebrew } from "@/lib/db/homebrew";
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

// `archived`: forgotten monsters too, for play (an NPC's stat block or a
// prepared encounter that names one still fights with it).
export function listHomebrewMonsters(userId: string, options: { archived?: boolean } = {}): HomebrewMonster[] {
  return listHomebrew(userId, "monster", { archived: options.archived ?? false }).map(hydrate);
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

// Forgetting a monster archives it (src/lib/db/homebrew.ts archiveHomebrew):
// it leaves the bestiary and its pickers, and an NPC or an encounter that
// already names it still fights with its block.
export function deleteHomebrewMonster(userId: string, id: string, options: { purge?: boolean } = {}): boolean {
  const existing = getHomebrew(userId, id);
  if (!existing || existing.kind !== "monster") {
    return false;
  }
  return options.purge ? deleteHomebrew(userId, id) : archiveHomebrew(userId, id);
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
    listHomebrewMonsters(userId, { archived: true }).find(
      (monster) => monster.draft.name.toLowerCase() === lowered,
    ) ?? null
  );
}

// The same lookup across whoever runs a table (src/lib/db/homebrew.ts
// tableAuthors), the first author's monster first: what a fight at that
// table resolves, whichever of its DMs prepared the monster.
export function findTableMonster(userIds: string[], ref: string): HomebrewMonster | null {
  for (const userId of [...new Set(userIds.filter(Boolean))]) {
    const found = findHomebrewMonster(userId, ref);
    if (found) {
      return found;
    }
  }
  return null;
}
