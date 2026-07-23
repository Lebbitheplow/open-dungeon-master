import { z } from "zod";
import { isErrorResponse, requireMember, type MemberContext } from "@/lib/campaign-api";
import { JOIN_NOTE_PREFIX } from "@/lib/campaign-types";
import { allocateSeq, setMemberReady } from "@/lib/db/campaigns";
import {
  createCharacter,
  getCharacterForUser,
  instantiateIntoCampaign,
  updateCharacter,
  updateCharacterPortrait,
} from "@/lib/db/characters";
import { insertCampaignMessage } from "@/lib/db/messages";
import { createSheet, deleteSheetForUser, getSheetForUser, patchSheet } from "@/lib/db/sheets";
import { queueLibraryPortrait } from "@/lib/portrait";
import { createSheetSchema, patchSheetSchema } from "@/lib/schemas/sheet";
import { suggestedSpellCount } from "@/lib/content/mechanics";
import { spellClassFor } from "@/lib/classes";
import { abilityMod, findClass, findSkill } from "@/lib/srd";
import { populateFeaturesForClasses, subclassSpellsFor } from "@/lib/srd/features";
import {
  canMulticlassInto,
  classListFor,
  multiclassGrantsFor,
  pactSlotsFor,
  slotTableFor,
  type MulticlassGrant,
} from "@/lib/srd/multiclass";
import type {
  CharacterSheet,
  FullPatchSheetInput,
  PatchSheetInput,
} from "@/lib/schemas/sheet";
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

// A multiclass level-up: the client names the class taking the level and
// the server builds everything else itself, so a crafted request can never
// invent a class array, skip a prerequisite, or walk off with proficiencies
// the multiclass rules do not grant. Returns the engine patch to apply, or
// an error string.
function buildMulticlassLevelUp(
  sheet: CharacterSheet,
  data: PatchSheetInput,
): { patch: FullPatchSheetInput } | { error: string } {
  const targetLevel = data.level ?? sheet.level;
  const gained = targetLevel - sheet.level;
  if (gained < 1 || targetLevel > 20) {
    return { error: "Invalid level gain." };
  }
  const classId = (data.levelUpClass ?? "").trim().toLowerCase() || classListFor(sheet)[0].id;
  const klass = findClass(classId);
  if (!klass) {
    return { error: `Unknown class "${classId}".` };
  }

  const nextClasses = classListFor(sheet).map((entry) => ({ ...entry }));
  const existing = nextClasses.find((entry) => entry.id.toLowerCase() === classId);
  let grants: MulticlassGrant | null = null;
  if (existing) {
    if (existing.level + gained > 20) {
      return { error: `${klass.name} is already at its level cap.` };
    }
    existing.level += gained;
  } else {
    const check = canMulticlassInto(sheet, classId);
    if (!check.ok) {
      return { error: check.error ?? "Cannot multiclass into that class." };
    }
    nextClasses.push({ id: klass.id, subclass: "", level: gained });
    grants = multiclassGrantsFor(klass.id);
  }
  const leveled = nextClasses.find((entry) => entry.id.toLowerCase() === classId)!;
  // The subclass pick from the dialog belongs to the class being leveled.
  if (data.subclass !== undefined && data.subclass.trim() && !leveled.subclass) {
    leveled.subclass = data.subclass.trim();
  }

  // Multiclass proficiency grants land server-side (never saves, per RAW),
  // plus the one class-skill pick some grants offer.
  let proficiencies = sheet.proficiencies;
  const union = (current: string[], added: string[]) => [
    ...current,
    ...added.filter(
      (entry) => !current.some((held) => held.toLowerCase() === entry.toLowerCase()),
    ),
  ];
  if (grants) {
    proficiencies = {
      ...proficiencies,
      armor: union(proficiencies.armor, grants.armor),
      weapons: union(proficiencies.weapons, grants.weapons),
      tools: union(proficiencies.tools, grants.tools),
    };
    const skillPick = (data.levelUpSkill ?? "").trim().toLowerCase();
    if (skillPick && grants.skillChoice) {
      const allowed =
        !grants.skillChoice.from.length || grants.skillChoice.from.includes(skillPick);
      if (findSkill(skillPick) && allowed && !proficiencies.skills.includes(skillPick)) {
        proficiencies = { ...proficiencies, skills: [...proficiencies.skills, skillPick] };
      }
    }
  }
  // Expertise picks fold in here because patchSheet ignores the bare
  // `expertise` field whenever proficiencies are patched alongside it.
  if (data.expertise) {
    proficiencies = {
      ...proficiencies,
      expertise: data.expertise.filter((skill) => proficiencies.skills.includes(skill)),
    };
  }

  // Per-class hit-die pools: created from the pre-level-up sheet on the
  // first multiclass level, extended in place afterwards.
  let pools = sheet.hitDicePools?.map((pool) => ({ ...pool })) ?? null;
  if (nextClasses.length >= 2) {
    if (!pools?.length) {
      pools = [
        {
          classId: sheet.class,
          die: sheet.hitDice.die,
          total: sheet.level,
          spent: sheet.hitDice.spent,
        },
      ];
    }
    const pool = pools.find((entry) => entry.classId.toLowerCase() === classId);
    if (pool) {
      pool.total = Math.min(20, pool.total + gained);
    } else {
      pools.push({
        classId: klass.id,
        die: `d${klass.hitDie}` as "d6" | "d8" | "d10" | "d12",
        total: gained,
        spent: 0,
      });
    }
  }

  // Server-side feature regrant per class at its own level; the client's
  // list rides along as `existing` so its choice picks (fighting styles,
  // invocations) survive exactly as in the single-class flow.
  const features = populateFeaturesForClasses(
    data.features ?? sheet.features,
    nextClasses,
    sheet.race,
  );

  // Per-class spellcasting: each caster class keeps its own ability and
  // lists, the slot pool is shared via the multiclass table, and Pact Magic
  // is tracked apart.
  let spellcasting = sheet.spellcasting;
  const anyCaster = nextClasses.some(
    (entry) => (findClass(entry.id)?.casterType ?? "none") !== "none",
  );
  if (anyCaster && (spellcasting || (klass.casterType !== "none" && klass.spellAbility))) {
    const casters = (
      spellcasting?.casters?.map((caster) => ({
        ...caster,
        known: [...caster.known],
        prepared: [...caster.prepared],
      })) ?? []
    );
    if (!casters.length && spellcasting) {
      // Seed from the legacy single-caster fields; the owner is the first
      // caster class the sheet already had.
      const owner = classListFor(sheet).find(
        (entry) => (findClass(entry.id)?.casterType ?? "none") !== "none",
      );
      casters.push({
        classId: owner?.id ?? sheet.class,
        ability: spellcasting.ability,
        known: [...spellcasting.known],
        prepared: [...spellcasting.prepared],
      });
    }
    if (klass.casterType !== "none" && klass.spellAbility) {
      let mine = casters.find((caster) => caster.classId.toLowerCase() === classId);
      if (!mine) {
        mine = { classId: klass.id, ability: klass.spellAbility, known: [], prepared: [] };
        casters.push(mine);
      }
      const allowance = suggestedSpellCount(
        spellClassFor(klass.id),
        leveled.level,
        abilityMod((data.abilities ?? sheet.abilities)[mine.ability]),
      );
      const heldNames = new Set(
        [...mine.known, ...mine.prepared].map((name) => name.toLowerCase()),
      );
      const picks = (data.levelUpSpells ?? []).filter(
        (name) => !heldNames.has(name.toLowerCase()),
      );
      const intoKnown = allowance?.label === "spells known";
      if (allowance) {
        const held = (intoKnown ? mine.known : mine.prepared).length + picks.length;
        if (held > allowance.count) {
          return {
            error: `A ${klass.name} ${leveled.level} may hold ${allowance.count} ${allowance.label}; that list would have ${held}.`,
          };
        }
      }
      // Subclass spells (domain, circle, oath, patron) arrive free.
      const granted = subclassSpellsFor(klass.id, leveled.subclass, leveled.level).filter(
        (name) =>
          !heldNames.has(name.toLowerCase()) &&
          !picks.some((pick) => pick.toLowerCase() === name.toLowerCase()),
      );
      if (intoKnown) {
        mine.known.push(...picks, ...granted);
      } else {
        mine.prepared.push(...picks, ...granted);
      }
    }
    const table = slotTableFor({ class: sheet.class, classes: nextClasses });
    const slots = Object.fromEntries(
      Object.entries(table).map(([slotLevel, max]) => [
        slotLevel,
        { max, used: Math.min(spellcasting?.slots?.[slotLevel]?.used ?? 0, max) },
      ]),
    );
    const warlockLevel =
      nextClasses.find((entry) => findClass(entry.id)?.casterType === "pact")?.level ?? 0;
    const pactInfo = pactSlotsFor(warlockLevel);
    const dedupe = (names: string[]) => {
      const seen = new Set<string>();
      return names.filter((name) => {
        const key = name.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    };
    spellcasting = {
      // Mirrors for every existing consumer: the primary caster's ability,
      // and the union of every class's lists.
      ability: casters[0]?.ability ?? spellcasting?.ability ?? klass.spellAbility ?? "int",
      slots,
      known: dedupe(casters.flatMap((caster) => caster.known)).slice(0, 80),
      prepared: dedupe(casters.flatMap((caster) => caster.prepared)).slice(0, 60),
      casters,
      ...(pactInfo
        ? {
            pact: {
              level: pactInfo.level,
              max: pactInfo.max,
              used: Math.min(spellcasting?.pact?.used ?? 0, pactInfo.max),
            },
          }
        : {}),
    };
  }

  return {
    patch: {
      ...(data.currentHp !== undefined ? { currentHp: data.currentHp } : {}),
      ...(data.maxHp !== undefined ? { maxHp: data.maxHp } : {}),
      ...(data.abilities ? { abilities: data.abilities } : {}),
      ...(data.feats ? { feats: data.feats } : {}),
      classes: nextClasses,
      ...(pools?.length ? { hitDicePools: pools } : {}),
      proficiencies,
      features,
      ...(spellcasting !== sheet.spellcasting ? { spellcasting } : {}),
    },
  };
}

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

  return Response.json({ sheet: getSheetForUser(campaignId, context.user.id) });
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

  if (getSheetForUser(campaignId, context.user.id)) {
    return Response.json(
      { error: "You already have a character in this campaign." },
      { status: 409 },
    );
  }

  const raw = await request.json().catch(() => ({}));

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
      return Response.json({ error: result.error }, { status: 400 });
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

  const libraryCharacter = createCharacter(
    context.user.id,
    context.campaign.startingLevel,
    parsed.data,
  );
  const sheet = createSheet(
    campaignId,
    context.user.id,
    context.campaign.startingLevel,
    parsed.data,
    libraryCharacter.id,
  );
  // The finished render lands on this campaign clone too (portrait.ts
  // mirrors to sheets whose portrait is still empty).
  queueLibraryPortrait(libraryCharacter);
  publishPersisted(campaignId, "sheet_updated", { sheet });
  announceMidGameJoin(context, sheet);

  return Response.json({ sheet }, { status: 201 });
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

  // Shape 2: edit the current character in place. The library copy updates
  // first (it owns builder-only fields like ASI picks and appearance), then
  // the campaign copy re-instantiates from it.
  const edit = editSchema.safeParse(raw);
  if (edit.success) {
    const character = getCharacterForUser(context.user.id, edit.data.editLibraryCharacterId);
    if (!character) {
      return Response.json({ error: "Character not found in your library." }, { status: 404 });
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
  deleteSheetForUser(campaignId, context.user.id);
  const libraryCharacter = createCharacter(
    context.user.id,
    context.campaign.startingLevel,
    parsed.data,
  );
  const sheet = createSheet(
    campaignId,
    context.user.id,
    context.campaign.startingLevel,
    parsed.data,
    libraryCharacter.id,
  );
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

  const sheet = getSheetForUser(campaignId, context.user.id);
  if (!sheet) {
    return Response.json({ error: "You have no character in this campaign." }, { status: 404 });
  }

  const raw = await request.json().catch(() => ({}));
  const parsed = patchSheetSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid sheet update." },
      { status: 400 },
    );
  }

  // Players may self-serve cosmetics any time; every other field in the
  // player patch schema exists for the level-up flow, so gameplay stats
  // (HP, gold, conditions, items) only pass as part of a genuine level
  // increase. Counter adjustments go through /sheet/usage, everything else
  // through the party lead.
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

  // Multiclass path: an already-multiclassed sheet levels any of its
  // classes, or a single-class sheet takes a first level in a NEW class.
  // The server builds the class array, hit-die pools, proficiency grants,
  // and per-class spellcasting itself from the named class.
  const wantedClass = (parsed.data.levelUpClass ?? "").trim().toLowerCase();
  const takesNewClass =
    Boolean(wantedClass) &&
    !classListFor(sheet).some((entry) => entry.id.toLowerCase() === wantedClass);
  // Campaign setting: a table with multiclassing off refuses NEW classes;
  // characters already split still level their existing classes normally.
  if (takesNewClass && context.campaign.gameSettings?.multiclassingEnabled === false) {
    return Response.json(
      { error: "Multiclassing is turned off for this campaign (a lobby setting the owner controls)." },
      { status: 403 },
    );
  }
  if (levelingUp && ((sheet.classes?.length ?? 0) > 0 || takesNewClass)) {
    const built = buildMulticlassLevelUp(sheet, parsed.data);
    if ("error" in built) {
      return Response.json({ error: built.error }, { status: 400 });
    }
    const leveled = patchSheet(sheet.id, built.patch);
    publishPersisted(campaignId, "sheet_updated", { sheet: leveled });
    return Response.json({ sheet: leveled });
  }

  // A level-up may not hand out more spells than the class's 5e table
  // allows. The builder shows the allowance and the picker blocks past it;
  // this is the server saying the same thing, so a crafted request cannot
  // walk away with a full spellbook.
  if (parsed.data.spellcasting && sheet.spellcasting) {
    const ability = parsed.data.spellcasting.ability ?? sheet.spellcasting.ability;
    const allowance = suggestedSpellCount(
      spellClassFor(sheet.class),
      parsed.data.level ?? sheet.level,
      abilityMod((parsed.data.abilities ?? sheet.abilities)[ability]),
    );
    const next = parsed.data.spellcasting;
    const held = (next.known.length > 0 ? next.known : next.prepared).length;
    if (allowance && held > allowance.count) {
      return Response.json(
        {
          error: `A level ${parsed.data.level ?? sheet.level} ${sheet.class} may hold ${allowance.count} ${allowance.label}; that list has ${held}.`,
        },
        { status: 400 },
      );
    }
  }

  const updated = patchSheet(sheet.id, parsed.data);
  // Portraits are cosmetic, so unlike stats they mirror to the library
  // immediately instead of waiting for a campaign-end sync; /characters
  // shows the photo right after an in-game upload.
  if (parsed.data.portrait !== undefined && sheet.libraryCharacterId) {
    updateCharacterPortrait(context.user.id, sheet.libraryCharacterId, parsed.data.portrait);
  }
  publishPersisted(campaignId, "sheet_updated", { sheet: updated });

  return Response.json({ sheet: updated });
}
