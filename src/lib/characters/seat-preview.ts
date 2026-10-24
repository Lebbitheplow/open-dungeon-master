import type { Campaign } from "@/lib/db/campaigns";
import { admitLibraryCharacter, type LibraryCharacter } from "@/lib/db/characters";
import { tableAuthors } from "@/lib/db/homebrew";
import { subclassExtrasFor } from "@/lib/db/subclass-extras";
import { oweSkippedImprovements } from "@/lib/characters/adapt";
import { admitSheet } from "@/lib/characters/admit";
import { classGrantsFor, featFactsFor, offeredSubclasses, spellFactsFor, subclassIsOffered } from "@/lib/characters/catalog";
import { joinChanges, type JoinPreview } from "@/lib/characters/join-changes";
import {
  applySeatPicks,
  hasSeatPicks,
  owedPicksOf,
  type SeatPicks,
  type SeatPicksContext,
} from "@/lib/characters/seat-picks";

export type { JoinPreview };
import { createSheetSchema, type CreateSheetInput } from "@/lib/schemas/sheet";
import type { Pregen } from "@/lib/starter/pregens";

// The ways a hero takes a seat, each written once: the join itself (POST
// /sheet, POST /sheet/pregen, POST /sheet/offered) and the confirm sheet a
// player reads before it (POST /sheet/preview, backlog F6) both come here,
// so what the sheet promises is what the join does. A hero the builder just
// made (the hero chooser's "Help me build") is previewed here too, by the
// table door its join (POST or PUT /sheet with a sheet) goes through.
//
// The choices a hero owes as it sits down (a subclass, an Ability Score
// Improvement) may be picked on the confirm sheet; the join and its preview
// apply them here too (src/lib/characters/seat-picks.ts), after the door
// the hero came through and before the stored door that judges the result.

type Seated = { ok: true; sheet: CreateSheetInput; rolledHp?: number[]; settle?: () => void };
type Refused = { ok: false; problems: string[] };

// The table's catalog for the picks: its DMs' homebrew, as the level-up
// reads it (src/app/api/campaigns/[campaignId]/sheet/route.ts PATCH).
export function seatPicksContextFor(campaign: Pick<Campaign, "id">): SeatPicksContext {
  const owner = tableAuthors(campaign.id);
  return {
    classOf: (classId) => classGrantsFor(classId, owner),
    featOf: (name) => featFactsFor(name, owner),
    spellOf: (name) => spellFactsFor(name, owner),
    subclassOffered: (classId, name) => subclassIsOffered(classId, name, owner),
    subclassesOf: (classId) => offeredSubclasses(classId, owner),
    subclassExtras: subclassExtrasFor(owner),
    campaignId: campaign.id,
  };
}

// A seated sheet with the picks made, judged again by the stored door: the
// sheet as a library character entering play at this level would be judged,
// with hit points, slots and training written for what was picked.
export function withSeatPicks<T extends Seated>(
  admitted: T,
  level: number,
  picks: SeatPicks | null | undefined,
  campaign: Campaign,
  userId: string,
): T | Seated | Refused {
  if (!hasSeatPicks(picks)) {
    return admitted;
  }
  const applied = applySeatPicks(admitted.sheet, level, picks, seatPicksContextFor(campaign));
  if (!applied.ok) {
    return applied;
  }
  const judged = admitSheet({ door: "stored", level, sheet: applied.sheet, userId, campaign });
  if (!judged.ok) {
    return judged;
  }
  return {
    ok: true,
    sheet: judged.sheet,
    ...(judged.rolledHp ?? admitted.rolledHp ? { rolledHp: judged.rolledHp ?? admitted.rolledHp } : {}),
    settle: () => {
      admitted.settle?.();
      judged.settle();
    },
  };
}

export type PregenAdmitted =
  | { ok: true; built: CreateSheetInput; sheet: CreateSheetInput; rolledHp?: number[]; settle: () => void }
  | { ok: false; problems: string[] };

// A ready-made hero (src/lib/starter/pregens.ts) through the table door: the
// same door as a character the builder made, judged by the table's rules.
// Every hero is a level 1 build: at a higher table the improvements its
// level earned were never offered, so they are owed, not taken (backlog B6,
// the rule a library hero joining above its level follows), unless the
// player picks them on the confirm sheet.
export function admitPregen(pregen: Pregen, campaign: Campaign, userId: string, picks?: SeatPicks | null): PregenAdmitted {
  const built = createSheetSchema.parse(pregen.sheet);
  const admitted = admitSheet({ door: "table", level: campaign.startingLevel, sheet: built, userId, campaign });
  if (!admitted.ok) {
    return admitted;
  }
  const seated = withSeatPicks(
    {
      ok: true,
      sheet: oweSkippedImprovements(admitted.sheet, built, 1, campaign.startingLevel),
      ...(admitted.rolledHp ? { rolledHp: admitted.rolledHp } : {}),
      settle: admitted.settle,
    },
    campaign.startingLevel,
    picks,
    campaign,
    userId,
  );
  if (!seated.ok) {
    return seated;
  }
  return {
    ok: true,
    built,
    sheet: seated.sheet,
    ...(seated.rolledHp ? { rolledHp: seated.rolledHp } : {}),
    settle: seated.settle ?? (() => undefined),
  };
}

// A library character at the table's level, by the stored door, with the
// picks made: the player's own (POST and PUT /sheet) or a DM's offered
// pregen (POST /sheet/offered).
export function admitLibraryForSeat(
  character: LibraryCharacter,
  campaign: Campaign,
  userId: string,
  level: number,
  picks?: SeatPicks | null,
): { ok: true; sheet: CreateSheetInput; rolledHp?: number[]; settle?: () => void } | { ok: false; error: string; problems: string[] } {
  const admitted = admitLibraryCharacter(character, campaign, userId, level);
  if (!admitted.ok) {
    return admitted;
  }
  const seated = withSeatPicks(admitted, level, picks, campaign, userId);
  return seated.ok ? seated : { ok: false, error: seated.problems[0] ?? "Those picks are not within the rules.", problems: seated.problems };
}

function preview(
  name: string,
  stored: CreateSheetInput,
  fromLevel: number,
  toLevel: number,
  // The hero as it seats with nothing picked: what the pickers offer.
  unpicked: { ok: true; sheet: CreateSheetInput } | { ok: false },
  admitted: { ok: true; sheet: CreateSheetInput; rolledHp?: number[] } | { ok: false; problems: string[] },
  campaign: Campaign,
): JoinPreview {
  const picks = unpicked.ok ? owedPicksOf(unpicked.sheet, toLevel, seatPicksContextFor(campaign)) : null;
  if (!admitted.ok) {
    return { name, fromLevel, toLevel, ok: false, problems: admitted.problems, rollsHp: false, changes: [], owed: [], ...(picks ? { picks } : {}) };
  }
  return {
    name,
    fromLevel,
    toLevel,
    ok: true,
    problems: [],
    rollsHp: Boolean(admitted.rolledHp),
    ...joinChanges(stored, fromLevel, admitted.sheet, toLevel),
    ...(picks ? { picks } : {}),
  };
}

export function previewLibraryJoin(character: LibraryCharacter, campaign: Campaign, userId: string, picks?: SeatPicks | null): JoinPreview {
  const level = Math.max(1, Math.min(20, campaign.startingLevel));
  const unpicked = admitLibraryCharacter(character, campaign, userId, level);
  const admitted = hasSeatPicks(picks) && unpicked.ok ? withSeatPicks(unpicked, level, picks, campaign, userId) : unpicked;
  return preview(character.name, character.sheet, character.level, level, unpicked, admitted, campaign);
}

export function previewPregenJoin(pregen: Pregen, campaign: Campaign, userId: string, picks?: SeatPicks | null): JoinPreview {
  const unpicked = admitPregen(pregen, campaign, userId);
  const admitted = hasSeatPicks(picks) && unpicked.ok ? admitPregen(pregen, campaign, userId, picks) : unpicked;
  const built = createSheetSchema.parse(pregen.sheet);
  return preview(built.name, built, 1, campaign.startingLevel, unpicked, admitted, campaign);
}

// A character the builder made for this table, not stored yet: the table
// door judges it at the table's level, as its join will. It was built with
// every choice its level offers, so the confirm sheet asks for none.
export function previewBuiltJoin(sheet: CreateSheetInput, campaign: Campaign, userId: string): JoinPreview {
  const level = Math.max(1, Math.min(20, campaign.startingLevel));
  const admitted = admitSheet({ door: "table", level, sheet, userId, campaign });
  return preview(sheet.name, sheet, level, level, { ok: false }, admitted, campaign);
}
