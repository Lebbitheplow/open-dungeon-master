import { storyConfigured, storytellerConfigured } from "@/lib/capabilities";
import { deleteCampaignWithFiles } from "@/lib/campaign-deletion";
import { draftOffered } from "@/lib/characters/pregen-drafts";
import { linkWorkshop } from "@/lib/db/campaign-workshops";
import { allocateSeq, createCampaign, getCampaignById, setCampaignStatus, type Campaign } from "@/lib/db/campaigns";
import { ensureOpenChapter } from "@/lib/db/chapters";
import { admitLibraryCharacter, companionRoleRefusal, getCharacterForUser } from "@/lib/db/characters";
import { copyOneRow, type CopyContext } from "@/lib/db/content-copy";
import { getDatabase, nowIso } from "@/lib/db/core";
import { getEncounterTemplate, type EncounterTemplate } from "@/lib/db/encounter-templates";
import { insertCampaignMessage } from "@/lib/db/messages";
import { listNpcs } from "@/lib/db/npcs";
import { createSheet } from "@/lib/db/sheets";
import { allTestFightsOf, strandedTestFights, testFightsOf } from "@/lib/db/test-fights";
import { packClassIds } from "@/lib/dm/companion-tools";
import { deployTemplate } from "@/lib/dm/encounter-templates";
import { requestDmTurn } from "@/lib/dm/loop";
import { readyTemplates } from "@/lib/dm/prepared-encounter-tool";
import { publishWithSeq } from "@/lib/events";
import { textKey } from "@/lib/language/text-logic";
import type { GameSettings } from "@/lib/schemas/game-settings";
import type { CreateSheetInput } from "@/lib/schemas/sheet";
import { TARGET_PARTY_LIMITS } from "@/lib/workshop/kind";
import { buildStandIns } from "@/lib/workshop/stand-ins";

// A test fight (issue 553): one of a workshop's prepared fights, played.
//
// A workshop is prep, not a table (src/lib/workshop/kind.ts): it has no
// party, so its Deploy could only ever be refused with "No party characters
// to fight." A test fight is the table the fight needs, made for it and for
// nobody else. It is a campaigns row of kind 'playtest' that no list shows
// and nobody can join. Its author holds every seat. It starts already in
// play, with its party sitting at the table. That party is the workshop's
// target party as stand-ins built by the rules (src/lib/workshop/stand-ins.ts),
// or characters the author picks from their library, seated as copies so
// nothing the fight does reaches the library. The fight is copied in with
// its map and any cast member its roster names, and deployed the way a DM's
// Deploy lays it out.
//
// Who runs it: the AI DM, which opens the fight and runs the enemies as it
// would at a table the AI runs, while the author plays the party; or the
// author, at a table a person runs, for a server with no AI DM or a DM who
// runs their own tables. Then the author sits in the DM seat and holds the
// party too: on a hero's turn the party's Hand, whose weapon attacks the
// engine resolves at once, and on the enemies' the monsters' Hand.
//
// Ending the test deletes the table. So does starting the next one, and so
// does deleting the workshop.

export type TestParty = { kind: "stand-ins" } | { kind: "characters"; characterIds: string[] };

export type TestFightRunner = "ai" | "person";

export type TestFightOutcome = { ok: true; campaignId: string } | { ok: false; status: number; error: string };

export const NO_AI_TEST_REASON =
  "No AI GM is set up on this server, so you run the test: the enemies' cards on their turns, the party's on each hero's.";

// How the test table plays. The workshop's own settings ride under these:
// its setting, rules and variant rules are the fight's.
const TEST_FIGHT_SETTINGS = {
  // The author plays every hero, each on their own turn.
  multiCharacter: "all_active",
  // One fight, already chosen: no premise to write, no world turning, no
  // allies joining, and nobody else to wait for.
  aiStorySetup: false,
  worldSimulation: false,
  companions: "off",
  waitForTable: false,
  holdSubmissions: false,
  midGameJoinOpen: false,
} as const satisfies Partial<GameSettings>;

// The narrator's secret outline: what this table is for.
const TEST_FIGHT_OUTLINE = [
  "This table is a test of one prepared fight from the GM's workshop, played by the person who wrote it.",
  "The fight is already on the board, with its map, its opening positions and its plan.",
  "Narrate it briefly and run every enemy by the rules and by its plan, as you would at any table.",
  "Do not start a story, a new scene, a quest or another fight.",
  "When the fight ends, say in a line or two how it went (who fell and how many rounds it took) and stop.",
].join(" ");

export async function testFightReadiness(workshop: Campaign): Promise<{ ready: boolean; reason: string }> {
  const ready = storyConfigured(workshop.settings) || (await storytellerConfigured());
  return ready ? { ready, reason: "" } : { ready, reason: NO_AI_TEST_REASON };
}

type Seat = { name: string; level: number; sheet: CreateSheetInput; xp?: number; settle?: () => void };

// The heroes, built and judged before anything is stored, so a party the
// rules refuse leaves no table behind.
function seatsFor(workshop: Campaign, userId: string, party: TestParty): { ok: true; seats: Seat[] } | { ok: false; error: string } {
  if (party.kind === "stand-ins") {
    const offered = draftOffered(workshop.gameSettings.genre, packClassIds(workshop.gameSettings));
    const built = buildStandIns(workshop.gameSettings.targetParty, offered, userId);
    return built.ok ? { ok: true, seats: built.heroes } : built;
  }
  const ids = [...new Set(party.characterIds)];
  if (!ids.length) {
    return { ok: false, error: "Pick at least one character to fight it." };
  }
  if (ids.length > TARGET_PARTY_LIMITS.size.max) {
    return { ok: false, error: `A test party holds at most ${TARGET_PARTY_LIMITS.size.max} characters.` };
  }
  const seats: Seat[] = [];
  for (const id of ids) {
    const character = getCharacterForUser(userId, id);
    if (!character) {
      return { ok: false, error: "One of those characters is not in your library." };
    }
    if (character.role === "companion") {
      return { ok: false, error: companionRoleRefusal(character) };
    }
    // At its own level: the point of bringing your own party is to see how
    // that party fares.
    const admitted = admitLibraryCharacter(character, workshop, userId, character.level);
    if (!admitted.ok) {
      return { ok: false, error: admitted.error };
    }
    seats.push({ name: character.name, level: character.level, sheet: admitted.sheet, xp: character.xp });
  }
  return { ok: true, seats };
}

// The fight, its map and the cast its roster names, copied from the
// workshop into the test table through the import's own row copies
// (src/lib/db/content-copy.ts), so the copy is exactly what an import of
// the fight would bring. Returns the copied fight.
function copyFight(workshop: Campaign, campaignId: string, template: EncounterTemplate): EncounterTemplate | null {
  const copies = new Map<string, string>();
  const key = (kind: string, id: string) => `${kind}:${id}`;
  const context: CopyContext = {
    sourceId: workshop.id,
    campaignId,
    now: nowIso(),
    nameFor: (_kind, _id, fallback) => fallback,
    track: (kind, sourceRowId) => {
      const id = crypto.randomUUID();
      copies.set(key(kind, sourceRowId), id);
      return id;
    },
    resolve: (kind, sourceRowId) => copies.get(key(kind, sourceRowId)) ?? null,
    kept: () => false,
    counts: { copied: 0, kept: 0, unbound: 0 },
  };
  // A cast member named in the roster fights as their own stat block
  // (src/lib/dm/encounter-spawn.ts), which only the table's own cast has.
  const named = (name: string) => template.enemies.some((row) => textKey(String(row.monster ?? "")) === textKey(name));
  const castNames = new Set<string>();
  for (const npc of listNpcs(workshop.id)) {
    if (npc.statBlock && [npc.name, ...npc.aliases].some(named)) {
      copyOneRow(context, "npcs", npc.id, castNames);
    }
  }
  if (template.map.mapId) {
    copyOneRow(context, "maps", template.map.mapId, new Set());
  }
  const id = copyOneRow(context, "encounters", template.id, new Set());
  return id ? getEncounterTemplate(id) : null;
}

// Ends every open test of this workshop by this author but `keep`, and any
// of theirs left with no workshop to go back to.
export function endTestFights(workshopId: string, userId: string, keep = ""): number {
  const ids = new Set([...testFightsOf(workshopId, userId).map((fight) => fight.id), ...strandedTestFights(userId)]);
  ids.delete(keep);
  for (const id of ids) {
    deleteCampaignWithFiles(id);
  }
  return ids.size;
}

// The workshop's delete: its test tables go first, whoever opened them.
export function deleteWorkshopTestFights(workshopId: string) {
  for (const id of allTestFightsOf(workshopId)) {
    deleteCampaignWithFiles(id);
  }
}

export async function openTestFight(input: {
  workshop: Campaign;
  userId: string;
  templateId: string;
  party: TestParty;
  runner: TestFightRunner;
}): Promise<TestFightOutcome> {
  const { workshop, userId, runner } = input;
  const template = getEncounterTemplate(input.templateId);
  if (!template || template.campaignId !== workshop.id) {
    return { ok: false, status: 404, error: "No such prepared encounter." };
  }
  if (!readyTemplates(workshop.id).some((entry) => entry.id === template.id)) {
    return { ok: false, status: 409, error: "That fight has nobody in it yet. Give it a roster, then test it." };
  }
  if (runner === "ai" && !(await testFightReadiness(workshop)).ready) {
    return { ok: false, status: 409, error: "No AI GM is set up on this server to run it. Run the test yourself." };
  }
  const party = seatsFor(workshop, userId, input.party);
  if (!party.ok) {
    return { ok: false, status: 422, error: party.error };
  }

  const level = Math.max(...party.seats.map((seat) => seat.level));
  const created = createCampaign(userId, {
    title: `Test: ${template.name}`.slice(0, 80),
    description: `A test of the prepared fight "${template.name}" from the workshop "${workshop.title}".`,
    theme: workshop.theme,
    maxPlayers: 1,
    startingLevel: level,
    difficulty: workshop.difficulty,
    kind: "playtest",
    // A person's table seats its maker in the DM seat (createCampaign).
    gameSettings: { ...workshop.gameSettings, ...TEST_FIGHT_SETTINGS, dmMode: runner === "ai" ? "ai" : "human" },
  });
  try {
    // The workshop's own narrator, and no scene pictures: a test is about
    // the fight, and a picture per passage is minutes of waiting.
    getDatabase()
      .prepare(`UPDATE campaigns SET settings_json = ?, dm_outline = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify({ ...workshop.settings, autoImages: false }), runner === "ai" ? TEST_FIGHT_OUTLINE : "", nowIso(), created.id);
    linkWorkshop(created.id, workshop.id);

    const fight = copyFight(workshop, created.id, template);
    if (!fight) {
      throw new Error("The fight could not be copied to the test table.");
    }
    for (const seat of party.seats) {
      createSheet(created.id, userId, seat.level, seat.sheet, null, seat.xp === undefined ? {} : { xp: seat.xp });
      seat.settle?.();
    }
    setCampaignStatus(created.id, "active");
    ensureOpenChapter(created.id);

    const campaign = getCampaignById(created.id);
    if (!campaign) {
      throw new Error("The test table could not be read back.");
    }
    // Said first, so the transcript reads the test, then the fight it opens.
    const seq = allocateSeq(campaign.id);
    const names = party.seats.map((seat) => seat.name);
    const note = insertCampaignMessage({
      campaignId: campaign.id,
      seq,
      authorType: "system",
      glyph: "cue-battle",
      content: `Test fight: ${template.name}, from the workshop "${workshop.title}". ${listed(names)} ${names.length === 1 ? "fights" : "fight"} it; ${runner === "ai" ? "the AI GM runs the enemies" : "you run the enemies"}.`,
    });
    publishWithSeq(campaign.id, seq, "message_added", { message: note });

    const deployed = await deployTemplate(campaign, userId, fight);
    if (!deployed.ok) {
      deleteCampaignWithFiles(campaign.id);
      return { ok: false, status: 409, error: `The fight would not start for that party: ${deployed.error}` };
    }
    // One test at a time per workshop: this one replaces the one before it,
    // now that it has started. A start the engine refused left that one be.
    endTestFights(workshop.id, userId, campaign.id);
    // The AI's opening, and the enemies' turns when they act first. A
    // person's fight waits for its person.
    if (runner === "ai") {
      requestDmTurn(campaign.id);
    }
    return { ok: true, campaignId: campaign.id };
  } catch (error) {
    deleteCampaignWithFiles(created.id);
    return { ok: false, status: 500, error: error instanceof Error ? error.message : "The test fight could not be set up." };
  }
}

function listed(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
