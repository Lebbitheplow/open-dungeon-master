import { avatarPlaceholder, characterPlaceholder } from "@/lib/placeholders";
import type { Speaker } from "@/lib/dm/speech";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import type { CastMember } from "@/lib/dm/cast";

// The faces the story log gives the people who speak in it, as lists to try
// best first: the transcript shows the first that loads (useFaceChain), so an
// upload that was deleted or cannot be reached gives way to the next instead
// of a broken image, the way the board's tokens fall back (TokenFace). The
// painted plates come last because they ship with the server and the apps
// (scripts/test-placeholders.mjs checks every one resolves).

type FaceSheet = Pick<CharacterSheet, "portrait" | "race" | "class" | "gender">;

const plateOf = (sheet: FaceSheet) => characterPlaceholder({ race: sheet.race, class: sheet.class, gender: sheet.gender });

const present = (urls: Array<string | null | undefined>) => urls.filter((url): url is string => Boolean(url));

// A character speaking inside the narration: their portrait, else the
// painted plate for their class and race. Their player's avatar is left out
// on purpose; it stands for the player at the table, not the character in
// the story. Anyone else gets no face from here (undefined): an NPC's comes
// from the public cast (SpeechLine), and a character whose sheet this viewer
// does not hold has nothing to draw from.
export function speakerFaces(who: Speaker, sheetsById: ReadonlyMap<string, FaceSheet>): string[] | undefined {
  const sheet = who.kind === "pc" ? sheetsById.get(who.id) : undefined;
  return sheet ? present([sheet.portrait?.url, plateOf(sheet)]) : undefined;
}

// Someone from the cast: their portrait, else the stand-in the cast carries
// for a companion who left the party (issue 660), so the line they leave on
// shows the face their earlier lines did. Empty only for one with neither.
export function castFaces(member: Pick<CastMember, "portraitUrl" | "plate"> | undefined): string[] {
  return present([member?.portraitUrl, member?.plate]);
}

// A player's own line: the character's portrait, then the player's own
// avatar, then a stand-in, which is the plate for the character's class or
// race, or the sigil the player's id hashes to when there is no sheet to
// draw from. Empty only for a line with neither a sheet nor an author.
export function playerFaces({
  sheet,
  avatarUrl,
  userId,
}: {
  sheet?: FaceSheet;
  avatarUrl?: string | null;
  userId?: string | null;
}): string[] {
  return present([
    sheet?.portrait?.url,
    avatarUrl,
    sheet ? plateOf(sheet) : userId ? avatarPlaceholder(userId) : undefined,
  ]);
}
