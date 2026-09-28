// A lobby, one seated player, and the two doors a new character comes
// through, for the creation suites (scripts/test-enforce-creation-*.mjs).
//
//   POST /api/campaigns/[campaignId]/sheet   a character made at the table
//   POST /api/characters                     a character made in the library
//
// Import enforce-world.mjs first: it points the database at a scratch
// directory and registers the route loader.
import { openWorld } from "./enforce-world.mjs";

// Every character posted here arrives with a portrait. A sheet without one
// asks the image backend to paint it (src/lib/portrait.ts), and a rules suite
// has no business putting renders on somebody's GPU queue.
export const PORTRAIT = { url: "/uploads/enforce-creation.png" };
const withPortrait = (sheet) => ({ ...sheet, portrait: sheet?.portrait || PORTRAIT });

// A level 1 human fighter, soldier background, exactly as SRD 5.1 builds one:
// the standard array (15, 14, 13, 12, 10, 8) with the human's +1 to each,
// 10 + CON modifier hit points, one d10 hit die, the fighter's two saves,
// two fighter skills beside the soldier's two, and the class's training.
export const LEGAL_FIGHTER = {
  name: "Brakka",
  race: "human",
  class: "fighter",
  subclass: "",
  background: "soldier",
  alignment: "N",
  abilities: { str: 16, dex: 15, con: 14, int: 13, wis: 11, cha: 9 },
  maxHp: 12,
  ac: 18,
  acOverride: false,
  speed: 30,
  hitDice: { die: "d10", total: 1, spent: 0 },
  classes: [],
  hitDicePools: null,
  proficiencies: {
    saves: ["str", "con"],
    skills: ["perception", "survival", "athletics", "intimidation"],
    expertise: [],
    languages: ["Common", "Dwarvish"],
    // The soldier's "one type of gaming set", named: a character made here
    // names the tool it chose.
    tools: ["dice set", "vehicles (land)"],
    armor: ["light", "medium", "heavy", "shields"],
    weapons: ["simple", "martial"],
  },
  // SRD 5.1, Fighter, Starting Equipment, every first option: chain mail, a
  // martial weapon and a shield, a light crossbow and 20 bolts (the pack
  // left home).
  equipment: [
    { name: "Longsword", qty: 1 },
    { name: "Light Crossbow", qty: 1 },
    { name: "Crossbow Bolts", qty: 20 },
    { name: "Chain Mail", qty: 1 },
    { name: "Shield", qty: 1 },
  ],
  gold: 10,
  copper: 0,
  feats: [],
  features: [{ name: "Fighting Style: Defense", source: "choice" }],
  asiChoices: [],
  spellcasting: null,
  portrait: PORTRAIT,
  notes: "",
  backstory: "",
};

// The same character as a level 1 high elf wizard, for the caster rules.
export const LEGAL_WIZARD = {
  ...LEGAL_FIGHTER,
  name: "Ilvane",
  race: "high_elf",
  class: "wizard",
  background: "sage",
  // 8, 14+2, 13, 15+1, 12, 10.
  abilities: { str: 8, dex: 16, con: 13, int: 16, wis: 12, cha: 10 },
  maxHp: 7,
  ac: 13,
  hitDice: { die: "d6", total: 1, spent: 0 },
  proficiencies: {
    saves: ["int", "wis"],
    skills: ["investigation", "insight", "arcana", "history", "perception"],
    expertise: [],
    languages: ["Common", "Elvish", "Dwarvish", "Giant", "Draconic"],
    tools: [],
    armor: [],
    weapons: ["daggers", "darts", "slings", "quarterstaffs", "light crossbows"],
  },
  equipment: [{ name: "Quarterstaff", qty: 1 }],
  features: [],
  spellcasting: {
    ability: "int",
    slots: { 1: { max: 2, used: 0 } },
    prepared: ["Magic Missile", "Shield", "Sleep", "Mage Armor"],
    known: [],
    cantrips: ["Fire Bolt", "Light", "Mage Hand"],
    spellbook: ["Magic Missile", "Shield", "Sleep", "Mage Armor", "Detect Magic", "Burning Hands"],
  },
};

export async function openCreation(options = {}) {
  const world = await openWorld({ status: "lobby", ...options });
  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const sheets = await import("../../src/lib/db/sheets.ts");
  const characters = await import("../../src/lib/db/characters.ts");
  const sheetRoute = await world.route("campaigns/[campaignId]/sheet");
  const libraryRoute = await world.route("characters");
  const campaignId = world.campaignId;

  const player = world.addUser("player");
  const joined = campaigns.joinByInviteCode(player.id, world.campaign().inviteCode);
  if ("error" in joined) {
    throw new Error(`could not seat the player: ${joined.error}`);
  }

  async function call(mod, method, body, params = {}) {
    // The guard behind withPortrait: no sheet leaves here without a portrait.
    for (const sheet of [body, body?.sheet]) {
      if (sheet && typeof sheet === "object" && "abilities" in sheet && !sheet.portrait) {
        throw new Error("enforce-creation: a character posted without a portrait would queue a render");
      }
    }
    const request = new Request("http://test/", {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = await mod[method](request, { params: Promise.resolve(params) });
    return { status: response.status, json: await response.json() };
  }

  // Empty the player's seat, so every attempt starts from no character.
  function clearSeat(user = player) {
    while (sheets.deleteSheetForUser(campaignId, user.id)) {
      // A table that allows several characters may hold more than one.
    }
  }

  // Post a character at the table as the player. Returns the status, the
  // refusal if there was one, and the sheet as the database now holds it
  // (null when nothing was stored).
  async function atTable(body, user = player) {
    clearSeat(user);
    world.signIn(user);
    const response = await call(sheetRoute, "POST", withPortrait(body), { campaignId });
    return {
      status: response.status,
      error: response.json.error ?? null,
      sheet: sheets.getSheetForUser(campaignId, user.id),
    };
  }

  // Post a character to the library, then bring it to the table the way the
  // lobby's "use this character" does.
  async function throughLibrary(sheet, level = 1, user = player) {
    clearSeat(user);
    world.signIn(user);
    const made = await call(libraryRoute, "POST", { level, sheet: withPortrait(sheet) });
    if (made.status >= 400) {
      return { status: made.status, error: made.json.error ?? null, character: null, sheet: null };
    }
    const character = made.json.character;
    const joinedTable = await call(sheetRoute, "POST", { libraryCharacterId: character.id }, { campaignId });
    return {
      status: joinedTable.status,
      error: joinedTable.json.error ?? null,
      character: characters.getCharacter(character.id),
      sheet: sheets.getSheetForUser(campaignId, user.id),
    };
  }

  return { world, campaignId, player, call, clearSeat, atTable, throughLibrary, sheetRoute, libraryRoute, sheets, characters };
}
