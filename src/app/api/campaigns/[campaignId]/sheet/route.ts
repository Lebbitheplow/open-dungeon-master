import { z } from "zod";
import { tableAuthors } from "@/lib/db/homebrew";
import {
  isErrorResponse,
  requireMember,
  steersStory,
  type MemberContext,
} from "@/lib/campaign-api";
import { JOIN_NOTE_PREFIX } from "@/lib/campaign-types";
import { admitSheet, refusal } from "@/lib/characters/admit";
import { allocateSeq, setMemberReady } from "@/lib/db/campaigns";
import {
  createCharacter,
  getCharacterForUser,
  instantiateIntoCampaign,
  updateCharacter,
  updateCharacterPortrait,
} from "@/lib/db/characters";
import { insertCampaignMessage } from "@/lib/db/messages";
import {
  createSheet,
  deleteSheetForUser,
  getSheetById,
  getSheetForUser,
  patchSheet,
} from "@/lib/db/sheets";
import { queueLibraryPortrait } from "@/lib/portrait";
import { createSheetSchema, patchSheetSchema } from "@/lib/schemas/sheet";
import {
  classGrantsFor,
  featFactsFor,
  raceGrantsFor,
  spellFactsFor,
  subclassIsOffered,
} from "@/lib/characters/catalog";
import { rollCard } from "@/lib/dm/roll-card";
import { buildLevelUp } from "@/lib/srd/level-up";
import { freeCantripCount } from "@/lib/srd/free-cantrips";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { publishPersisted, publishWithSeq } from "@/lib/events";

// A character arriving after the adventure started gets a table note so the
// DM writes them into the story on its next turn.
function announceMidGameJoin(context: MemberContext, sheet: CharacterSheet) {
  if (context.campaign.status !== "active") {
    return;
  }
  const campaignId = context.campaign.id;
  const seq = allocateSeq(campaignId);
  const backstoryHint = sheet.backstory
    ? ` Their backstory: ${sheet.backstory.slice(0, 200)}`
    : "";
  const message = insertCampaignMessage({
    campaignId,
    seq,
    authorType: "system",
    content: `${JOIN_NOTE_PREFIX}${context.user.username} has joined the party as ${sheet.name}, a ${sheet.race.replaceAll("_", " ")} ${sheet.class}.${backstoryHint} Introduce them into the scene at the next natural moment.`,
  });
  publishWithSeq(campaignId, seq, "message_added", { message });
}

const fromLibrarySchema = z.object({
  libraryCharacterId: z.string().min(1),
});

const editSchema = z.object({
  editLibraryCharacterId: z.string().min(1),
  sheet: createSheetSchema,
});

// Character changes (edit, switch, delete, recreate) are lobby-only; once
// the adventure starts, the sheet is locked to the lead/engine paths.
function lobbyGuard(context: MemberContext): Response | null {
  if (context.campaign.status !== "lobby") {
    return Response.json(
      { error: "Characters can only be changed in the lobby." },
      { status: 409 },
    );
  }
  return null;
}

// Changing your character invalidates your ready vote and swaps the sheet
// row (its id changes), so the table hears both.
function publishReplacement(
  context: MemberContext,
  oldSheet: CharacterSheet,
  newSheet: CharacterSheet,
) {
  const campaignId = context.campaign.id;
  setMemberReady(campaignId, context.user.id, false);
  publishPersisted(campaignId, "member_ready", { userId: context.user.id, ready: false });
  publishPersisted(campaignId, "sheet_deleted", { sheetId: oldSheet.id, userId: context.user.id });
  publishPersisted(campaignId, "sheet_updated", { sheet: newSheet });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  // libraryLevel is the linked library character's level. When it is not the
  // table's, the lobby's edit changes this table's copy only (PUT below), and
  // the edit page says so; a host without this field saved it to the library.
  const sheet = getSheetForUser(campaignId, context.user.id);
  const linked = sheet?.libraryCharacterId
    ? getCharacterForUser(context.user.id, sheet.libraryCharacterId)
    : null;
  return Response.json({ sheet, libraryLevel: linked?.level ?? null });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw = await request.json().catch(() => ({}));

  // A table that allows several characters per player lets a second one
  // in (docs/vtt-parity-implementation-plan.md 11.3); the first stays the
  // one in play until they switch. Nothing is awaited between this check
  // and the insert, so two requests at once cannot both pass it: the route
  // holds the rule now that the table has no constraint to hold it.
  if (getSheetForUser(campaignId, context.user.id) && context.campaign.gameSettings.multiCharacter === "off") {
    return Response.json(
      { error: "You already have a character in this campaign." },
      { status: 409 },
    );
  }

  // Path 1: pick an existing library character (adapted to campaign level).
  const fromLibrary = fromLibrarySchema.safeParse(raw);
  if (fromLibrary.success) {
    const result = instantiateIntoCampaign(
      fromLibrary.data.libraryCharacterId,
      campaignId,
      context.user.id,
      context.campaign.startingLevel,
    );
    if ("error" in result) {
      return Response.json(result, { status: 400 });
    }
    publishPersisted(campaignId, "sheet_updated", { sheet: result });
    announceMidGameJoin(context, result);
    return Response.json({ sheet: result }, { status: 201 });
  }

  // Path 2: create new; also saved to the user's library, then copied in.
  const parsed = createSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid character sheet." },
      { status: 400 },
    );
  }

  // One legality check for every door (src/lib/characters/admit.ts): what
  // the request claims is held to the rules, and what has one legal answer
  // is written by the server whatever the request says.
  const admitted = admitSheet({
    door: "table",
    level: context.campaign.startingLevel,
    sheet: parsed.data,
    userId: context.user.id,
    campaign: context.campaign,
  });
  if (!admitted.ok) {
    return refusal(admitted.problems);
  }
  const libraryCharacter = createCharacter(
    context.user.id,
    context.campaign.startingLevel,
    admitted.sheet,
  );
  const sheet = createSheet(
    campaignId,
    context.user.id,
    context.campaign.startingLevel,
    admitted.sheet,
    libraryCharacter.id,
  );
  admitted.settle();
  // The finished render lands on this campaign clone too (portrait.ts
  // mirrors to sheets whose portrait is still empty).
  queueLibraryPortrait(libraryCharacter);
  publishPersisted(campaignId, "sheet_updated", { sheet });
  announceMidGameJoin(context, sheet);

  return Response.json(
    { sheet, ...(admitted.rolledHp ? { rolled: { hp: admitted.rolledHp } } : {}) },
    { status: 201 },
  );
}

// Replace the caller's lobby character: switch to a library character,
// edit the current one in place, or build a brand-new one. All three
// shapes re-run the copy-on-instantiate path so level adaptation stays
// authoritative; the builder submits back the portrait it was prefilled
// with, so a fresh render only queues when the player cleared it.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const guard = lobbyGuard(context);
  if (guard) {
    return guard;
  }
  const existing = getSheetForUser(campaignId, context.user.id);
  if (!existing) {
    return Response.json(
      { error: "You have no character in this campaign yet; create one first." },
      { status: 404 },
    );
  }

  const raw = await request.json().catch(() => ({}));

  // Shape 1: switch to a different library character. Its portrait rides
  // along; a render only queues if it has none yet.
  const fromLibrary = fromLibrarySchema.safeParse(raw);
  if (fromLibrary.success) {
    const character = getCharacterForUser(context.user.id, fromLibrary.data.libraryCharacterId);
    if (!character) {
      return Response.json({ error: "Character not found in your library." }, { status: 404 });
    }
    deleteSheetForUser(campaignId, context.user.id);
    const result = instantiateIntoCampaign(
      character.id,
      campaignId,
      context.user.id,
      context.campaign.startingLevel,
    );
    if ("error" in result) {
      // The old sheet is already gone; the lobby falls back to its
      // create-a-character state, which the UI handles.
      publishPersisted(campaignId, "sheet_deleted", {
        sheetId: existing.id,
        userId: context.user.id,
      });
      return Response.json({ error: result.error }, { status: 400 });
    }
    queueLibraryPortrait(character);
    publishReplacement(context, existing, result);
    return Response.json({ sheet: result });
  }

  // Shape 2: edit the current character in place. The builder rebuilds it
  // at the table's level. When the library character is at that level too,
  // the library copy updates first (it owns builder-only fields like ASI
  // picks and appearance), then the campaign copy re-instantiates from it.
  // When it is not, the edit is this table's alone, the way joining adapts a
  // character without touching the library: a level 3 table's rebuild saved
  // over a level 8 hero would de-level it in every later campaign. The link
  // stays, so "save progress" and the campaign's end still sync back.
  const edit = editSchema.safeParse(raw);
  if (edit.success) {
    const character = getCharacterForUser(context.user.id, edit.data.editLibraryCharacterId);
    if (!character) {
      return Response.json({ error: "Character not found in your library." }, { status: 404 });
    }
    const edited = admitSheet({
      door: "library",
      level: context.campaign.startingLevel,
      sheet: edit.data.sheet,
      userId: context.user.id,
      campaign: context.campaign,
      baseline: { sheet: character.sheet, level: character.level },
    });
    if (!edited.ok) {
      return refusal(edited.problems);
    }
    edit.data.sheet = edited.sheet;
    edited.settle();
    if (character.level !== context.campaign.startingLevel) {
      deleteSheetForUser(campaignId, context.user.id);
      const sheet = createSheet(
        campaignId,
        context.user.id,
        context.campaign.startingLevel,
        edit.data.sheet,
        character.id,
      );
      // A portrait cleared to be redrawn is drawn from the edited sheet.
      if (!edit.data.sheet.portrait) {
        queueLibraryPortrait({ ...character, sheet: edit.data.sheet });
      }
      publishReplacement(context, existing, sheet);
      return Response.json({ sheet });
    }
    const updated = updateCharacter(
      context.user.id,
      character.id,
      context.campaign.startingLevel,
      edit.data.sheet,
    );
    if (!updated) {
      return Response.json({ error: "Could not update the character." }, { status: 400 });
    }
    deleteSheetForUser(campaignId, context.user.id);
    const result = instantiateIntoCampaign(
      character.id,
      campaignId,
      context.user.id,
      context.campaign.startingLevel,
    );
    if ("error" in result) {
      publishPersisted(campaignId, "sheet_deleted", {
        sheetId: existing.id,
        userId: context.user.id,
      });
      return Response.json({ error: result.error }, { status: 400 });
    }
    queueLibraryPortrait(updated);
    publishReplacement(context, existing, result);
    return Response.json({ sheet: result });
  }

  // Shape 3: replace with a brand-new character (also saved to the library).
  const parsed = createSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid character sheet." },
      { status: 400 },
    );
  }
  const replaced = admitSheet({
    door: "table",
    level: context.campaign.startingLevel,
    sheet: parsed.data,
    userId: context.user.id,
    campaign: context.campaign,
  });
  if (!replaced.ok) {
    return refusal(replaced.problems);
  }
  deleteSheetForUser(campaignId, context.user.id);
  const libraryCharacter = createCharacter(
    context.user.id,
    context.campaign.startingLevel,
    replaced.sheet,
  );
  const sheet = createSheet(
    campaignId,
    context.user.id,
    context.campaign.startingLevel,
    replaced.sheet,
    libraryCharacter.id,
  );
  replaced.settle();
  queueLibraryPortrait(libraryCharacter);
  publishReplacement(context, existing, sheet);
  return Response.json({ sheet });
}

// Remove the caller's lobby character entirely; the lobby falls back to
// its create-a-character state.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const guard = lobbyGuard(context);
  if (guard) {
    return guard;
  }
  const removed = deleteSheetForUser(campaignId, context.user.id);
  if (!removed) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }
  setMemberReady(campaignId, context.user.id, false);
  publishPersisted(campaignId, "member_ready", { userId: context.user.id, ready: false });
  publishPersisted(campaignId, "sheet_deleted", { sheetId: removed.id, userId: context.user.id });
  return Response.json({ ok: true });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  const context = await requireMember(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }

  const raw: unknown = await request.json().catch(() => ({}));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // A companion's sheet belongs to its bot, so nobody at the table can reach
  // it through getSheetForUser. Whoever runs the story may name one and set
  // its portrait, and nothing else: the sheetId path accepts exactly one
  // key, so it widens no other edit right. Stats still go through the lead's
  // adjust route as before.
  let sheet: CharacterSheet | null;
  let companionPortrait = false;
  if (typeof body.sheetId === "string" && body.sheetId) {
    const target = getSheetById(body.sheetId);
    if (!target || target.campaignId !== campaignId || !target.isCompanion) {
      return Response.json({ error: "That companion is not in this campaign." }, { status: 404 });
    }
    if (!steersStory(context)) {
      return Response.json(
        { error: "Only whoever runs the story can change a companion's portrait." },
        { status: 403 },
      );
    }
    const keys = Object.keys(body).filter((key) => key !== "sheetId" && body[key] !== undefined);
    if (keys.length !== 1 || keys[0] !== "portrait") {
      return Response.json(
        { error: "Only a companion's portrait can be changed from here." },
        { status: 403 },
      );
    }
    sheet = target;
    companionPortrait = true;
  } else {
    sheet = getSheetForUser(campaignId, context.user.id);
  }
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }

  const parsed = patchSheetSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid sheet update." },
      { status: 400 },
    );
  }

  // Players may self-serve cosmetics any time. Every other field in the
  // player patch schema belongs to the level-up, so it only passes as part of
  // a level increase; counter adjustments go through /sheet/usage, preparing
  // spells through /sheet/spells, everything else through whoever runs the
  // table.
  const cosmeticKeys = new Set(["portrait", "notes", "backstory"]);
  const patchedKeys = Object.entries(parsed.data)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key);
  const levelingUp = typeof parsed.data.level === "number" && parsed.data.level > sheet.level;
  if (!levelingUp && patchedKeys.some((key) => !cosmeticKeys.has(key))) {
    return Response.json(
      {
        error:
          "Only portrait, notes, and backstory can be changed here outside of a level-up. Ask the party lead to adjust other stats.",
      },
      { status: 403 },
    );
  }

  // A level-up is built from the player's choices and nothing else in the
  // request (src/lib/srd/level-up.ts): one level, earned, in one class, with
  // hit points by the table's method. The single-class and the multiclass
  // level are the same code.
  if (levelingUp) {
    if (companionPortrait) {
      return Response.json(
        { error: "Only a companion's portrait can be changed from here." },
        { status: 403 },
      );
    }
    // The table's homebrew, whoever of its DM seats wrote it.
    const owner = tableAuthors(context.campaign.id);
    const built = buildLevelUp(sheet, parsed.data, {
      hpMethod: context.campaign.gameSettings.hpMethod ?? "average",
      multiclassAllowed: context.campaign.gameSettings.multiclassingEnabled !== false,
      classOf: classGrantsFor,
      // The race's cantrip pick and its innate cantrips (Thaumaturgy) are
      // known on top of the class's, as at creation (U:UB3).
      racialCantrips: freeCantripCount(sheet, raceGrantsFor(sheet.race, owner)?.cantripChoice?.count ?? 0),
      spellOf: (name) => spellFactsFor(name, owner),
      featOf: (name) => featFactsFor(name, owner),
      subclassOffered: (classId, name) => subclassIsOffered(classId, name, owner),
      // Under hpMethod "rolled" the hit die is a roll the table sees, as
      // every roll the server makes is (PR #61): a dice card on the record.
      rollDie: (sides) =>
        rollCard(
          context.campaign,
          null,
          sheet.id,
          "custom",
          `level ${parsed.data.level}: hit die d${sides}`,
          `1d${sides}`,
          null,
        ).total,
    });
    if ("error" in built) {
      return Response.json({ error: built.error }, { status: built.status ?? 400 });
    }
    const leveled = patchSheet(sheet.id, built.patch);
    publishPersisted(campaignId, "sheet_updated", { sheet: leveled });
    return Response.json({
      sheet: leveled,
      hpGained: built.hpGained,
      ...(built.rolled ? { rolled: built.rolled } : {}),
    });
  }

  const cosmetic = {
    ...(parsed.data.portrait !== undefined ? { portrait: parsed.data.portrait } : {}),
    ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    ...(parsed.data.backstory !== undefined ? { backstory: parsed.data.backstory } : {}),
  };
  const updated = patchSheet(sheet.id, cosmetic);
  // Portraits are cosmetic, so unlike stats they mirror to the library
  // immediately instead of waiting for a campaign-end sync; /characters
  // shows the photo right after an in-game upload.
  // A companion's library row, if it has one, is the bot's, not the
  // uploader's, so the mirror is skipped rather than written under the
  // wrong owner.
  if (parsed.data.portrait !== undefined && sheet.libraryCharacterId && !companionPortrait) {
    updateCharacterPortrait(context.user.id, sheet.libraryCharacterId, parsed.data.portrait);
  }
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  return Response.json({ sheet: updated });
}
