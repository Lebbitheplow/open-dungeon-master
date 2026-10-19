// The world the browser scenarios open: one table in a fight on a painted
// board with a full chronicle, a quiet table out of combat, two campaigns
// still in their lobbies (one with an imported story arc), library
// characters, and a lead with a password. Writes the database, its key and the ids the scenarios
// need into the folder given, then exits (enforce-world cleans its own
// scratch folder on the way out).
//
//   node scripts/browser/seed.mjs <out-dir>
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "../lib/enforce-world.mjs";
import { combatKit } from "../lib/enforce-combat.mjs";

const out = process.argv[2];
if (!out) {
  throw new Error("seed.mjs needs the folder to write into");
}
fs.mkdirSync(out, { recursive: true });

const PASSWORD = "Browser-2026-pass";
const TITLE = "Regression Table";
const LOBBY_TITLE = "Regression Lobby";

const world = await openWorld({ campaign: { title: TITLE }, gameSettings: { ttsEnabled: true } });
const kit = await combatKit(world);
const { getDatabase } = await import("../../src/lib/db/core.ts");
const campaigns = await import("../../src/lib/db/campaigns.ts");
const messages = await import("../../src/lib/db/messages.ts");
const { setUserAdmin, setUserPassword } = await import("../../src/lib/db/users.ts");
const { hashPassword } = await import("../../src/lib/auth.ts");
const { LEAD_NOTE_PREFIX } = await import("../../src/lib/campaign-types.ts");

const tavi = world.addHero({
  user: world.owner,
  name: "Tavi Lockwhisper",
  class: "rogue",
  level: 3,
  abilities: { str: 10, dex: 16 },
  proficiencies: { saves: ["dex", "int"], skills: ["stealth"], expertise: [], languages: ["Common"], tools: [], armor: ["light"], weapons: ["simple", "martial"] },
  equipment: [
    { name: "Rapier", qty: 1, equipped: true },
    { name: "Dagger", qty: 2, equipped: true },
    { name: "Leather", qty: 1, equipped: true },
  ],
});

// The story so far, enough to fill the chronicle's window, ending on the
// two entries the chronicle scenario reads whole: a long system line (a
// lead's direction, the prefix the transcript draws as a card) and a
// three-paragraph passage with emphasis and a question at its end.
const say = (content, extra = {}) => {
  const seq = campaigns.allocateSeq(world.campaignId);
  return messages.insertCampaignMessage({ campaignId: world.campaignId, seq, ...extra, content });
};
for (let index = 1; index <= 44; index += 1) {
  if (index % 3 === 0) {
    say(`Line ${index}: Tavi keeps low and watches the door.`, { authorType: "player", userId: world.owner.id, characterId: tavi.id });
  } else {
    say(`Passage ${index}. The rain drums on the slate roof of the old mill while the goblins argue in the yard below. Lantern light spills across the wet stones, and somewhere a chain rattles against a post as the wind turns.`, { authorType: "dm", speech: [] });
  }
}
// Table talk put to the DM and its out-of-character answer (PR 314): the
// chronicle reads the answer as a line, never as a passage.
const oocQuestion = "@DM can Tavi see the dog from the east wall?";
const oocAnswer = "Not from there: the dog sleeps under the cart, out of sight until you round the corner.";
say(`(ooc) ${oocQuestion}`, { authorType: "player", userId: world.owner.id, characterId: tavi.id });
say(`(ooc) ${oocAnswer}`, { authorType: "dm", speech: [] });
const systemLine =
  "Keep to the shadows along the east wall, wait for the second goblin to turn his back, and only then go for the lantern. If the dog wakes, we scatter and meet at the ford before dawn.";
say(`${LEAD_NOTE_PREFIX}${systemLine}`, { authorType: "system" });
const paragraphs = [
  "The *bolt* dies against wet salt and the yard goes quiet, the kind of quiet that has teeth in it.",
  "The nearer goblin lowers his torch. His eyes find the shadow you are standing in and stay there a moment too long.",
  "_What_ do you do?",
];
say(paragraphs.join("\n\n"), { authorType: "dm", speech: [] });

// A second hero at the table, the player's, so the travel formation has an
// order to arrange (issue 230).
const player = world.addUser("player");
const bree = world.addHero({
  user: player,
  name: "Bree Underbough",
  class: "fighter",
  level: 3,
  abilities: { str: 16, con: 14 },
  proficiencies: { saves: ["str", "con"], skills: ["athletics"], expertise: [], languages: ["Common"], tools: [], armor: ["light", "medium", "heavy", "shields"], weapons: ["simple", "martial"] },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
});
// A character in the lead's library, for the build editor (issue 229).
const { createCharacter } = await import("../../src/lib/db/characters.ts");
const LIBRARY_NAME = "Brann Stoutheart";
const brann = createCharacter(world.owner.id, 3, {
  name: LIBRARY_NAME,
  race: "human",
  class: "fighter",
  subclass: "Champion",
  background: "soldier",
  alignment: "LN",
  abilities: { str: 16, dex: 12, con: 15, int: 10, wis: 12, cha: 9 },
  maxHp: 28,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 3, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "perception", "survival"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [{ name: "Longsword", qty: 1, equipped: true }],
  gold: 10,
  copper: 0,
  feats: [],
  // The fighting style rides as a "choice" feature, as the builder saves it.
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  notes: "",
});
// A Life Domain cleric in the library, for the builder's subclass training
// (issue 251): the domain's heavy armor is said on the calling step and kept.
const LIFE_NAME = "Wren Ashdown";
const wren = createCharacter(world.owner.id, 1, {
  name: LIFE_NAME,
  race: "human",
  class: "cleric",
  subclass: "Life Domain",
  background: "acolyte",
  alignment: "NG",
  abilities: { str: 15, dex: 11, con: 14, int: 9, wis: 16, cha: 13 },
  maxHp: 10,
  ac: 16,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d8", total: 1, spent: 0 },
  proficiencies: {
    saves: ["wis", "cha"],
    skills: ["insight", "religion", "medicine", "persuasion"],
    expertise: [],
    languages: ["Common", "Dwarvish", "Elvish", "Giant"],
    tools: [],
    armor: ["light", "medium", "shields", "heavy"],
    weapons: ["simple"],
  },
  equipment: [
    { name: "Mace", qty: 1, equipped: true },
    { name: "Chain mail", qty: 1, equipped: true },
  ],
  gold: 15,
  copper: 0,
  feats: [],
  features: [],
  asiChoices: [],
  spellcasting: {
    ability: "wis",
    slots: { 1: { max: 2, used: 0 } },
    cantrips: ["Guidance", "Sacred Flame", "Spare the Dying"],
    prepared: ["Command", "Healing Word", "Sanctuary", "Shield of Faith"],
    known: [],
  },
  notes: "",
});
await kit.fight(1, { heroFaces: { [tavi.id]: 19 } });
const [goblin] = world.enemies();
kit.place(tavi.id, 2, 2);
kit.place(goblin.id, 3, 2);
kit.giveTurn(tavi.id);

// A campaign still in its lobby, for the lobby pages and the cover dialog.
const lobby = campaigns.createCampaign(world.owner.id, {
  title: LOBBY_TITLE,
  description: "A table that has not started.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});

// A DM offer waiting on the lead's own character, so the offer bar has
// something to settle (issue 239). Bree is the second Party card to arrange
// (issue 240).
const itemProposals = await import("../../src/lib/db/item-proposals.ts");
const offer = itemProposals.insertItemProposal({
  campaignId: world.campaignId,
  turnId: null,
  characterId: tavi.id,
  userId: world.owner.id,
  toolName: "grant_item",
  argsJson: JSON.stringify({ characterId: tavi.id, name: "Healing potion", qty: 1, reason: "found in the mill" }),
  summary: "Give Healing potion to Tavi Lockwhisper",
  reason: "found in the mill",
  seq: campaigns.allocateSeq(world.campaignId),
});
// A quiet table the AI narrates, with no fight: the lead's cleric holds
// Spirit Guardians (issue 252) and the player's Bree is seated beside her,
// so the party has a plan to coordinate (issue 254).
const QUIET_TITLE = "Quiet Crossing";
const { heroInput } = await import("../lib/enforce-world.mjs");
const sheets = await import("../../src/lib/db/sheets.ts");
const quiet = campaigns.createCampaign(world.owner.id, {
  title: QUIET_TITLE,
  description: "A ford at dusk, nothing hunting the party yet.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 5,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
const joinedQuiet = campaigns.joinByInviteCode(player.id, campaigns.getCampaignById(quiet.id).inviteCode);
if ("error" in joinedQuiet) {
  throw new Error(`could not seat the player at ${QUIET_TITLE}: ${joinedQuiet.error}`);
}
campaigns.setCampaignStatus(quiet.id, "active");
const ama = sheets.createSheet(
  quiet.id,
  world.owner.id,
  5,
  heroInput({
    name: "Sister Ama",
    class: "cleric",
    level: 5,
    abilities: { wis: 16 },
    spellcasting: {
      ability: "wis",
      slots: { 1: { max: 4, used: 0 }, 2: { max: 3, used: 0 }, 3: { max: 2, used: 0 } },
      prepared: ["Bless", "Spirit Guardians", "Hold Person", "Cure Wounds"],
      known: [],
      cantrips: ["Sacred Flame"],
    },
    equipment: [{ name: "Mace", qty: 1, equipped: true }, { name: "Component pouch", qty: 1 }],
  }),
);
sheets.patchSheet(ama.id, { concentratingOn: "Spirit Guardians" });
const corin = sheets.createSheet(quiet.id, player.id, 5, heroInput({ name: "Corin Vale", class: "fighter", level: 5 }));
messages.insertCampaignMessage({
  campaignId: quiet.id,
  seq: campaigns.allocateSeq(quiet.id),
  authorType: "dm",
  speech: [],
  content: "The ford is quiet. Across the water a lantern swings on the ferryman's hut, and the rope bridge creaks in the wind.",
});

// The seeded turn below, so lore-trace can tell its trace from one a later
// scenario's turn on the quiet table left.
let quietLoreTurnId = "";
// The quiet table's world lore and the record a turn left of it (issue
// 305): four crossings the lead tagged as a set, one of them secret, a
// pinned entry, and lore about other things. The trace is the one turn
// retrieval builds for a player asking for every crossing, kept on a
// finished DM turn so the lead's Context panel has something to show.
{
  const { insertLoreEntry, embedPendingLore } = await import("../../src/lib/db/lore.ts");
  const { buildTurnRetrieval } = await import("../../src/lib/dm/context-retrieval.ts");
  const { createDmTurn, saveDmTurn } = await import("../../src/lib/db/dm-turns.ts");
  const fordLore = (title, body, extra = {}) =>
    insertLoreEntry({ campaignId: quiet.id, category: "geography", title, body, tags: [], ...extra });
  const guild = fordLore("The Ferry Guild", "The guild licenses every boat on the river and fines anyone who rows without a token.", { category: "factions" });
  getDatabase().prepare(`UPDATE lore_entries SET pinned = 1 WHERE id = ?`).run(guild.id);
  fordLore("The Ferry", "The ferryman takes a silver piece a head and more after dark.", { tags: ["crossing"] });
  fordLore("The Rope Bridge", "Forty planks over the gorge, three of them rotten. It holds two at a time.", { tags: ["crossing"] });
  fordLore("The Drowned Ford", "A sunken causeway a hand under the water at low tide; the smugglers mark it with reeds.", { tags: ["crossing"], visibility: "dm" });
  fordLore("The Shallows", "Waist-deep in late summer, chest-deep after rain, and the current pulls downstream.", { tags: ["crossing"] });
  fordLore("Harvest Festival", "At the end of summer the farmers burn a straw giant and dance until morning.");
  fordLore("The Lich of the Fens", "A lich sleeps beneath the fens and dreams of the kingdom it lost.");
  await embedPendingLore(quiet.id);
  const retrieval = await buildTurnRetrieval(campaigns.getCampaignById(quiet.id), [
    { authorType: "player", content: "How do we get over the river? Tell me every crossing." },
  ]);
  if (!retrieval.loreTrace) {
    throw new Error("the quiet table's lore left no trace");
  }
  const turn = createDmTurn(quiet.id, []);
  quietLoreTurnId = turn.id;
  saveDmTurn({
    ...turn,
    status: "done",
    contextTrace: {
      limitTokens: 40_000,
      promptTokens: 9_000,
      blocks: [{ id: "game-state", kind: "state", tokens: 3_000, included: true, reason: "always included", position: 1 }],
      lore: retrieval.loreTrace,
    },
  });
}

// A table of three accounts that have never met a tour, for the tours'
// account record (issue 306): one finishes the table's tour in one browser
// and must not meet it in another, one shares that browser, and one signs in
// where an old per-browser flag is waiting. Its own table, so the other
// scenarios' parties are unchanged.
const TOUR_TITLE = "First Visit";
const tourTable = campaigns.createCampaign(world.owner.id, {
  title: TOUR_TITLE,
  description: "A road inn, for meeting the table's tour.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 3,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
const tourAccounts = ["walker", "sharer", "heir"].map((label, index) => {
  const user = world.addUser(label);
  const joined = campaigns.joinByInviteCode(user.id, campaigns.getCampaignById(tourTable.id).inviteCode);
  if ("error" in joined) {
    throw new Error(`could not seat ${label} at ${TOUR_TITLE}: ${joined.error}`);
  }
  sheets.createSheet(tourTable.id, user.id, 3, heroInput({ name: ["Wren Walker", "Sela Sharer", "Hob Heir"][index], class: "fighter", level: 3 }));
  return user;
});
campaigns.setCampaignStatus(tourTable.id, "active");
messages.insertCampaignMessage({
  campaignId: tourTable.id,
  seq: campaigns.allocateSeq(tourTable.id),
  authorType: "dm",
  speech: [],
  content: "The inn's fire is low and the road outside is empty. Someone has left a map pinned to the door.",
});

// A lobby whose imported prep already wrote a story arc, so the lead is
// told before AI Story Setup runs over it (issue 249).
const PREP_TITLE = "Prepared Lobby";
const { normalizeStoryArc } = await import("../../src/lib/dm/arc-logic.ts");
const prepared = campaigns.createCampaign(world.owner.id, {
  title: PREP_TITLE,
  description: "A lobby with a storyboard already in.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setStoryArc(
  prepared.id,
  normalizeStoryArc({
    premise: "The mill wheel has stopped and the miller's girl is gone.",
    beats: ["The wheel stops at dusk.", "Marla confesses what she saw.", "The wheelhouse opens."],
  }),
);

// Tables in play the Setup tab ends, one per viewport so the second run
// does not open a table the first already closed, and an earlier, finished
// campaign with prep to bring into them mid-campaign. A campaign rather than
// a workshop because the lead's workshop shelf stays empty for
// empty-states; both are the same copy (src/lib/db/import-sources.ts).
const { insertRollTable } = await import("../../src/lib/db/roll-tables.ts");
const PREP_SOURCE_TITLE = "Old Harbour";
const prepSource = campaigns.createCampaign(world.owner.id, {
  title: PREP_SOURCE_TITLE,
  description: "A finished campaign with prep worth reusing.",
  theme: "high-fantasy",
  maxPlayers: 6,
  startingLevel: 1,
  difficulty: "normal",
  gameSettings: { ttsEnabled: false },
});
campaigns.setCampaignStatus(prepSource.id, "ended");
insertRollTable({
  campaignId: prepSource.id,
  name: "Ferry Rumours",
  entries: [
    { min: 1, max: 1, text: "The ferryman owes the river hag a debt." },
    { min: 2, max: 2, text: "A lantern on the far bank never goes out." },
  ],
  createdByUserId: world.owner.id,
});
const closing = {};
for (const viewport of ["desktop", "laptop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Closing Table (${viewport})`,
    description: "A table near the end of its story.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Wynn Ashdown", class: "fighter", level: 3 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The last bell rings over the harbour. The road home is open.",
  });
  closing[viewport] = table.id;
}

// A table per viewport for the DM's Stop (issue 383): its turn runs against
// a model the scenario starts and never lets answer.
const stopTables = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Stop Table (${viewport})`,
    description: "A table whose storyteller never answers.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(table.id, world.owner.id, 3, heroInput({ name: "Ilse Marr", class: "fighter", level: 3 }));
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "The ferry waits at the pier, its lantern hissing in the fog.",
  });
  stopTables[viewport] = table.id;
}

// A table per viewport for the wardrobe (issues 411 and 412): the lead's
// netrunner, a genre class whose features explain themselves only once the
// cyberpunk catalog has been fetched, wears one magic cloak and carries a
// second.
const wardrobe = {};
for (const viewport of ["desktop", "phone"]) {
  const table = campaigns.createCampaign(world.owner.id, {
    title: `Wardrobe (${viewport})`,
    description: "A safehouse with a rack of coats by the door.",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 3,
    difficulty: "normal",
    gameSettings: { ttsEnabled: false },
  });
  campaigns.setCampaignStatus(table.id, "active");
  sheets.createSheet(
    table.id,
    world.owner.id,
    3,
    heroInput({
      name: "Vex Halloran",
      class: "netrunner",
      level: 3,
      equipment: [
        { name: "Leather", qty: 1, equipped: true },
        { name: "Cloak of Protection", qty: 1, equipped: true, attuned: true },
        { name: "Cloak of Elvenkind", qty: 1, equipped: false, attuned: true },
      ],
    }),
  );
  messages.insertCampaignMessage({
    campaignId: table.id,
    seq: campaigns.allocateSeq(table.id),
    authorType: "dm",
    speech: [],
    content: "Rain ticks on the safehouse window. Two cloaks hang by the door.",
  });
  wardrobe[viewport] = table.id;
}

for (const user of [world.owner, player, ...tourAccounts]) {
  setUserPassword(user.id, await hashPassword(PASSWORD), false);
}
// A variant human fighter whose stored Dexterity, 8, no longer meets the
// two feats it holds (Skulker on the race, Defensive Duelist on its 4th
// level improvement, both Dexterity 13): an edit keeps a feat the stored
// character held, so one taken off can be put back (PR 381 follow-up).
const HELD_FEATS_NAME = "Sable Quickstep";
const sable = createCharacter(world.owner.id, 4, {
  name: HELD_FEATS_NAME,
  race: "variant_human",
  class: "fighter",
  subclass: "Champion",
  background: "soldier",
  alignment: "N",
  // The standard array, Dexterity 8, and the race's +1 to Strength and Constitution.
  abilities: { str: 16, dex: 8, con: 14, int: 12, wis: 14, cha: 10 },
  maxHp: 36,
  ac: 19,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 4, spent: 0 },
  proficiencies: {
    saves: ["str", "con"],
    skills: ["athletics", "intimidation", "perception", "survival", "stealth"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  equipment: [
    { name: "Longsword", qty: 1, equipped: true },
    { name: "Chain mail", qty: 1, equipped: true },
    { name: "Shield", qty: 1, equipped: true },
  ],
  gold: 10,
  copper: 0,
  feats: ["Skulker", "Defensive Duelist"],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [{ mode: "feat", feat: "Defensive Duelist" }],
  racialChoices: { asi: ["str", "con"], skills: ["stealth"] },
  spellcasting: null,
  notes: "",
});

// The lead runs the server too, for the admin settings (issue 255).
setUserAdmin(world.owner.id, true);

const ids = {
  lead: world.owner.username,
  player: player.username,
  walker: tourAccounts[0].username,
  sharer: tourAccounts[1].username,
  heir: tourAccounts[2].username,
  password: PASSWORD,
  title: TITLE,
  lobbyTitle: LOBBY_TITLE,
  campaignId: world.campaignId,
  lobbyId: lobby.id,
  tavi: tavi.id,
  bree: bree.id,
  goblin: goblin.id,
  library: brann.id,
  libraryName: LIBRARY_NAME,
  lifeCleric: wren.id,
  lifeClericName: LIFE_NAME,
  heldFeats: sable.id,
  heldFeatsName: HELD_FEATS_NAME,
  offerId: offer.id,
  offerSummary: offer.summary,
  quietId: quiet.id,
  quietTitle: QUIET_TITLE,
  quietLoreTurnId,
  tourTableId: tourTable.id,
  tourTableTitle: TOUR_TITLE,
  ama: ama.id,
  corin: corin.id,
  preparedId: prepared.id,
  preparedTitle: PREP_TITLE,
  prepSourceId: prepSource.id,
  prepSourceTitle: PREP_SOURCE_TITLE,
  closing,
  stopTables,
  wardrobe,
  // Every campaign a scenario opens, by id, for the app's home tiles.
  titles: {
    [world.campaignId]: TITLE,
    [lobby.id]: LOBBY_TITLE,
    [quiet.id]: QUIET_TITLE,
    [prepared.id]: PREP_TITLE,
    [tourTable.id]: TOUR_TITLE,
    [prepSource.id]: PREP_SOURCE_TITLE,
    ...Object.fromEntries(Object.entries(closing).map(([viewport, id]) => [id, `Closing Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(stopTables).map(([viewport, id]) => [id, `Stop Table (${viewport})`])),
    ...Object.fromEntries(Object.entries(wardrobe).map(([viewport, id]) => [id, `Wardrobe (${viewport})`])),
  },
  systemLine,
  oocQuestion,
  oocAnswer,
  paragraphs: paragraphs.map((text) => text.replace(/[*_]/g, "")),
};
getDatabase().pragma("wal_checkpoint(TRUNCATE)");
fs.copyFileSync(process.env.SQLITE_DB_PATH, path.join(out, "world.sqlite"));
fs.writeFileSync(path.join(out, "key"), process.env.DB_ENCRYPTION_KEY);
fs.writeFileSync(path.join(out, "ids.json"), JSON.stringify(ids, null, 2));
getDatabase().close();
console.log(`seeded ${TITLE} (${world.campaignId}), ${QUIET_TITLE}, ${LOBBY_TITLE} and ${PREP_TITLE} into ${out}`);
