import { heroFell } from "@/lib/characters/fallen-logic";
import { textKey } from "@/lib/language/text-logic";
import { endedByDeath, type RelationshipStatus, type RomanceStage } from "@/lib/dm/relationship-logic";

// Who the party's bonds are with, and when one closes on a death (issue
// 657). Pure, so the rules are read the same way by every door that seats a
// hero, by the end of a fight, and by the tests. The database side is
// src/lib/dm/party-bonds.ts.

export type BondSubject = { kind: "npc" | "companion"; name: string; id: string };

type BondRow = { subjectName: string; status: RelationshipStatus; flags: string[] };

// Whether the person behind these bonds is dead: a death closes every
// character's bond with them at once (db/relationships.ts
// endRelationshipsWithSubject), so one bond ended by it says so for all.
export function subjectDied(rows: readonly Pick<BondRow, "status" | "flags">[]): boolean {
  return rows.some(endedByDeath);
}

// Everyone a hero who joins now is owed a bond with, at neutral: the party
// met them before this hero arrived (issue 657). A hero who joined later, a
// replacement for one who fell or a player new to the table, had no bond
// with anyone the party had already met, since bonds opened only at the
// first meeting.
//   - an NPC the party has met (metAt), alive, and still in the party's
//     story: no bond yet (met while every hero was dead, say), or one still
//     active with someone. An NPC everyone has parted from or finished with
//     is out of the story; a newcomer does not inherit them.
//   - a lasting companion travelling with the party now, alive. A guest
//     stays for one fight, and a summoned creature for its spell.
// The row behind a companion still in the party is the companion, so it is
// read once, from the sheet.
export function joinerSubjects(input: {
  npcs: readonly { id: string; name: string; metAt: string; companionSheetId: string }[];
  // Every sheet at the table: the companions among them, and which rows
  // stand behind one still here.
  sheets: readonly {
    id: string;
    name: string;
    isCompanion?: boolean;
    companionKind?: string;
    summon?: unknown;
    deathSaves?: { dead?: boolean } | null;
  }[];
  bonds: readonly BondRow[];
}): BondSubject[] {
  const bySubject = new Map<string, BondRow[]>();
  for (const bond of input.bonds) {
    const key = textKey(bond.subjectName);
    bySubject.set(key, [...(bySubject.get(key) ?? []), bond]);
  }
  const live = new Set(input.sheets.map((sheet) => sheet.id));
  const subjects: BondSubject[] = [];
  const seen = new Set<string>();
  const add = (subject: BondSubject) => {
    const key = textKey(subject.name);
    if (key && !seen.has(key)) {
      seen.add(key);
      subjects.push(subject);
    }
  };
  for (const sheet of input.sheets) {
    if (sheet.isCompanion && sheet.companionKind === "party" && !sheet.summon && !heroFell(sheet)) {
      add({ kind: "companion", name: sheet.name, id: sheet.id });
    }
  }
  for (const npc of input.npcs) {
    if (!npc.metAt || (npc.companionSheetId && live.has(npc.companionSheetId))) {
      continue;
    }
    const rows = bySubject.get(textKey(npc.name)) ?? [];
    if (subjectDied(rows)) {
      continue;
    }
    if (rows.length && !rows.some((row) => row.status === "active")) {
      continue;
    }
    add({ kind: npc.companionSheetId ? "companion" : "npc", name: npc.name, id: npc.id });
  }
  return subjects;
}

// The NPC a foe who died in a fight is, when the fight fielded someone the
// party knows (issue 657): their exact name or a name they answer to, the
// way a fight fields a Cast NPC under their own name (encounter-spawn.ts).
// Never a near match: "Raider 2" is not the Raider the party spared on the
// road, and closing her bonds on a stranger's death is worse than leaving
// them. `npcs` leaves out a row standing behind a companion in the party.
export function foeBondName(enemyName: string, npcs: readonly { name: string; aliases: readonly string[] }[]): string | null {
  const wanted = textKey(enemyName);
  if (!wanted) {
    return null;
  }
  const npc = npcs.find((entry) => textKey(entry.name) === wanted || entry.aliases.some((alias) => textKey(alias) === wanted));
  return npc ? npc.name : null;
}

// What a character's own record says of a death: someone who mattered to
// them, when the bond had any warmth or romance, or simply that they died,
// since a bond opened at neutral on meeting was no great loss. One wording
// for a death the GM names (relationship_end) and one a fight dealt.
export function deathMemory(bond: { characterName: string; approval: number; romance: RomanceStage }, subject: string): string {
  return bond.approval >= 10 || bond.romance !== "none" ? `${subject}, who mattered to ${bond.characterName}, died` : `${subject} died`;
}
