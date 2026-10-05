// A throwaway table for the enforcement suites: a real database, a real
// campaign, real sheets, and the engine reached the way a DM reaches it
// (src/lib/dm/invoke.ts), with the dice under the test's control.
//
// Import this BEFORE anything from src/: it points the database at a scratch
// directory and registers the route loader as it loads.
//
//   const world = await openWorld();
//   const hero = world.addHero({ class: "fighter", level: 5 });
//   world.dice(20, 6);                      // the next two dice rolled
//   const out = await world.invoke("pc_attack", { ... });
//   world.sheet(hero.id)                    // the sheet as stored now
//   await world.beginFight([{ monster: "goblin", count: 2 }]);
//   world.close();
import { randomBytes } from "node:crypto";
import crypto from "node:crypto";
import fs from "node:fs";
import { register, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { removeTempDir } from "./remove-temp-dir.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const packPath = path.join(repoRoot, "data", "content", "open5e.sqlite");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-enforce-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");
// The content pack is read-only, so the real one is safe to share. CI has
// none: suites that need a pack row ask world.hasPack first. A
// CONTENT_DB_PATH already set wins, so pointing it at nothing runs a suite
// the way CI does.
if (!process.env.CONTENT_DB_PATH && fs.existsSync(packPath)) {
  process.env.CONTENT_DB_PATH = packPath;
}
export const hasPack = fs.existsSync(process.env.CONTENT_DB_PATH ?? "");
process.chdir(dir);
process.on("exit", () => removeTempDir(dir));

register("./register-routes.mjs", import.meta.url);

// House rules and lore re-embed; a fixed vector keeps the model off disk.
globalThis.__odmEmbedderPromise = Promise.resolve((texts) =>
  Promise.resolve({ tolist: () => texts.map(() => new Array(384).fill(0.1)) }),
);

// ---- dice ----
//
// src/lib/dice.ts rolls with crypto.randomInt(1, sides + 1). Named imports of
// a builtin are live bindings, so replacing the function and syncing makes
// every die in the engine come from this queue. A call that is not shaped
// like a die (a minimum other than 1) is passed through untouched. An empty
// queue rolls for real, and so does a null in it: a die the test does not
// care about, ahead of ones it does.
const realRandomInt = crypto.randomInt;
const queue = [];
const rolled = [];

crypto.randomInt = function forcedRandomInt(min, max, callback) {
  if (min === 1 && typeof max === "number" && typeof callback !== "function" && queue.length && queue[0] === null) {
    queue.shift();
  } else if (min === 1 && typeof max === "number" && typeof callback !== "function" && queue.length) {
    const sides = max - 1;
    const face = Math.max(1, Math.min(sides, queue.shift()));
    rolled.push({ sides, face, forced: true });
    return face;
  }
  const face = realRandomInt(min, max, callback);
  if (min === 1 && typeof face === "number") {
    rolled.push({ sides: max - 1, face, forced: false });
  }
  return face;
};
syncBuiltinESMExports();

// Queue the next dice, in the order the engine will roll them.
export function dice(...faces) {
  queue.push(...faces.flat());
}

// Forget queued dice a call did not use, and say how many there were: a test
// that queued five dice for a roll that took two has misread the engine.
export function clearDice() {
  const left = queue.length;
  queue.length = 0;
  return left;
}

// Every die rolled since the last call, forced or not.
export function diceLog() {
  return rolled.splice(0, rolled.length);
}

// ---- the table ----

const scoresOf = (overrides = {}) => ({
  str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...overrides,
});

const HIT_DIE = {
  barbarian: "d12", fighter: "d10", paladin: "d10", ranger: "d10",
  bard: "d8", cleric: "d8", druid: "d8", monk: "d8", rogue: "d8", warlock: "d8",
  artificer: "d8", sorcerer: "d6", wizard: "d6",
};

// A sheet payload with every required field, so a test states only what its
// rule is about. Nothing here is derived: a test that needs a real AC or a
// real slot table asks the engine for one.
export function heroInput(overrides = {}) {
  const level = overrides.level ?? 1;
  const classId = overrides.class ?? "fighter";
  const rest = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "level"));
  return {
    name: "Test Hero",
    race: "human",
    class: classId,
    subclass: "",
    background: "",
    alignment: "",
    gender: "",
    appearance: "",
    abilities: scoresOf(overrides.abilities),
    maxHp: 30,
    ac: 12,
    acOverride: true,
    speed: 30,
    hitDice: { die: HIT_DIE[classId] ?? "d8", total: level, spent: 0 },
    classes: [],
    hitDicePools: null,
    proficiencies: {
      saves: [], skills: [], expertise: [], languages: ["Common"],
      tools: [], armor: [], weapons: [],
    },
    equipment: [],
    gold: 0,
    copper: 0,
    feats: [],
    features: [],
    asiChoices: [],
    spellcasting: null,
    portrait: null,
    notes: "",
    backstory: "",
    ...rest,
    abilities: scoresOf(overrides.abilities),
  };
}

export async function openWorld(options = {}) {
  const { createUser } = await import("../../src/lib/db/users.ts");
  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const sheets = await import("../../src/lib/db/sheets.ts");
  const encounters = await import("../../src/lib/db/encounters.ts");
  const messages = await import("../../src/lib/db/messages.ts");
  const { invokeEngine } = await import("../../src/lib/dm/invoke.ts");
  const { fieldedSheets } = await import("../../src/lib/dm/roster.ts");
  const { resolveRollExpression } = await import("../../src/lib/dm/rolls.ts");
  const { rollExtrasFor } = await import("../../src/lib/dm/forced-save.ts");
  const { mintSession } = await import("../../src/lib/auth.ts");

  let userCount = 0;
  function addUser(label = "player") {
    userCount += 1;
    return createUser(`${label}-${userCount}-${randomBytes(3).toString("hex")}`, "x");
  }

  const owner = addUser("owner");
  const created = campaigns.createCampaign(owner.id, {
    title: "Enforcement",
    description: "",
    theme: "high-fantasy",
    maxPlayers: 6,
    startingLevel: 1,
    difficulty: "normal",
    ...(options.campaign ?? {}),
    gameSettings: options.gameSettings ?? {},
  });
  if ((options.status ?? "active") === "active") {
    campaigns.setCampaignStatus(created.id, "active");
  }
  const campaignId = created.id;
  const campaign = () => campaigns.getCampaignById(campaignId);

  // A hero and the player who owns it. The first hero belongs to the owner;
  // each one after joins as a new member, since a player fields one sheet.
  let heroes = 0;
  function addHero(overrides = {}) {
    heroes += 1;
    let user = owner;
    if (heroes > 1 || overrides.user) {
      user = overrides.user ?? addUser();
      if (!campaigns.isCampaignMember(campaignId, user.id)) {
        // A table in play may refuse a newcomer; the seat is what the test
        // needs, not the lobby rule, so the door is opened for the join.
        const status = campaign().status;
        campaigns.setCampaignStatus(campaignId, "lobby");
        const joined = campaigns.joinByInviteCode(user.id, campaign().inviteCode);
        campaigns.setCampaignStatus(campaignId, status);
        if ("error" in joined) {
          throw new Error(`could not seat a player: ${joined.error}`);
        }
      }
    }
    const rest = Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "user"));
    const input = heroInput({ name: `Hero ${heroes}`, ...rest });
    return sheets.createSheet(campaignId, user.id, overrides.level ?? 1, input);
  }

  const invoke = (name, args = {}) =>
    invokeEngine(campaign(), { kind: "human", userId: owner.id }, { name, args });

  // A fight with the initiative already in, so a test starts on a known
  // turn. Enemies roll `enemyFace` on their d20; each hero rolls the face
  // given for its id in `heroFaces`, or 15. With the defaults the heroes act
  // first, in the order they were added when their modifiers match.
  // How many d20s a hero's initiative throws, resolved the way the opening
  // resolves it (src/lib/dm/encounter-open.ts).
  function initiativeD20s(sheet) {
    const resolved = resolveRollExpression(
      { kind: "initiative", characterId: sheet.id },
      sheet,
      rollExtrasFor(campaign(), sheet, "initiative"),
    );
    const match = resolved.expression ? /(\d*)d20/.exec(resolved.expression) : null;
    return match ? Number(match[1] || 1) : 1;
  }

  async function beginFight(enemies,{ heroFaces = {}, enemyFace = 1, ...args } = {}) {
    clearDice();
    const count = enemies.reduce((sum, enemy) => sum + (enemy.count ?? 1), 0);
    // The console asks the table for initiative as the fight opens
    // (src/lib/dm/initiative-ask.ts): the enemies' dice, then any ambush
    // Stealth (rolled for real), then each fielded hero's, in roster order.
    const heroes = fieldedSheets(campaign()).filter((sheet) => !sheet.deathSaves?.dead);
    const stealth = args.ambush === "enemies" ? count : args.ambush === "party" ? heroes.length : 0;
    dice(new Array(count).fill(enemyFace));
    dice(new Array(stealth).fill(null));
    // A hero rolling with advantage (Feral Instinct) throws two d20s, so the
    // face goes in once per die, or the next hero rolls for real.
    dice(heroes.flatMap((sheet) => new Array(initiativeD20s(sheet)).fill(heroFaces[sheet.id] ?? 15)));
    const started = await invoke("start_encounter", { enemies, ...args });
    clearDice();
    if (!started.ok) {
      throw new Error(`start_encounter refused: ${started.error}`);
    }
    // Anyone the opening did not roll for (a held roll) is asked by hand.
    const placed = new Set(
      (encounters.getActiveEncounter(campaignId)?.order ?? []).map((entry) => entry.characterId),
    );
    for (const sheet of heroes.filter((entry) => !placed.has(entry.id))) {
      dice(heroFaces[sheet.id] ?? 15);
      const rolled = await invoke("request_roll", {
        characterId: sheet.id,
        kind: "initiative",
        reason: "initiative",
      });
      clearDice();
      if (!rolled.ok) {
        throw new Error(`initiative refused for ${sheet.name}: ${rolled.error}`);
      }
    }
    diceLog();
    return encounters.getActiveEncounter(campaignId);
  }

  return {
    dir,
    hasPack,
    beginFight,
    owner,
    campaignId,
    campaign,
    addUser,
    addHero,
    dice,
    clearDice,
    diceLog,
    sheet: (id) => sheets.getSheetById(id),
    sheets: () => sheets.listSheets(campaignId),
    patch: (id, patch) => sheets.patchSheet(id, patch),
    encounter: () => encounters.getActiveEncounter(campaignId),
    enemies: () => {
      const active = encounters.getActiveEncounter(campaignId);
      return active ? encounters.listEnemies(active.id) : [];
    },
    // The engine, as the DM console calls it. Returns the InvokeOutcome:
    // { ok: true, result } or { ok: false, error }.
    invoke,
    // A line in the transcript, as the actions route or the server writes
    // it: the AI acts on a character's own turn only on their player's word
    // (src/lib/dm/player-word.ts).
    say: (authorType, content, sheet) =>
      messages.insertCampaignMessage({
        campaignId,
        seq: campaigns.allocateSeq(campaignId),
        authorType,
        content,
        ...(sheet ? { userId: sheet.userId, characterId: sheet.id } : {}),
      }),
    // Sign a user in for a route handler called directly.
    signIn: (user) => {
      globalThis.__odmTestToken = mintSession(user.id).token;
    },
    route: (name) => import(new URL(`../../src/app/api/${name}/route.ts`, import.meta.url).href),
    // The scratch directory is shared by every world this process opens, so
    // it goes when the process does, not when one world is done.
    close: () => {
      clearDice();
    },
  };
}
