// A player whose hero has died. Before this, a table that plays one
// character each kept them out for good once the adventure had started:
// every door that seats a hero refused "You already have a character in
// this campaign" because the dead sheet still counted, and changing a
// character is lobby-only. Now a player whose heroes at the table have all
// fallen may bring in a new one, through the same doors a mid-game joiner
// uses, while the fallen hero stays on the record (the party panel, the
// chronicle, the board).
//
// Pure, so the table's banner and every server door read the same rule.

export type SeatedHero = {
  name: string;
  level: number;
  isCompanion?: boolean;
  deathSaves?: { dead?: boolean } | null;
};

export function heroFell(sheet: Pick<SeatedHero, "deathSaves">): boolean {
  return sheet.deathSaves?.dead === true;
}

// The player's fallen hero when every hero of theirs at the table has died:
// the one who reached the highest level, which a replacement joins at. Null
// while any of them lives, and before they have one. A companion is the GM's
// to run, so one the player commands never counts either way.
export function fallenHero<T extends SeatedHero>(own: T[]): T | null {
  const heroes = own.filter((sheet) => !sheet.isCompanion);
  if (!heroes.length || !heroes.every(heroFell)) {
    return null;
  }
  return heroes.reduce((best, sheet) => (sheet.level > best.level ? sheet : best));
}

// Whether another hero may take a seat for this player. `own` is every sheet
// the player holds at the table, companions included, as the doors always
// counted them: a table that plays one character each still lets in only a
// player with no sheet at all, or one whose heroes have all fallen.
export function heroDoorOpen(own: SeatedHero[], multiCharacter: string): boolean {
  return multiCharacter !== "off" || own.length === 0 || fallenHero(own) !== null;
}

// The level a hero joins at: the table's start level, or for a player whose
// heroes have all fallen the level the highest of them reached, so a party
// at level 7 is not sent a level 1 replacement. Never below the start.
export function heroJoinLevel(own: SeatedHero[], startingLevel: number): number {
  const fallen = fallenHero(own);
  return Math.max(1, Math.min(20, Math.max(startingLevel, fallen?.level ?? 0)));
}

// Whether a player may switch which of their heroes they play. A table of
// several characters each always lets them. One that plays one character
// each does only while two of theirs are alive at once, which happens when
// a fallen hero is raised after their replacement joined: the player then
// chooses which of the two plays on, rather than holding a hero nobody can
// act as. Switching to a hero who has fallen is never offered there.
export function switchesHeroes(own: SeatedHero[], multiCharacter: string): boolean {
  return multiCharacter !== "off" || own.filter((sheet) => !sheet.isCompanion && !heroFell(sheet)).length > 1;
}
