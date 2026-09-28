// What the campaign enforcement suites share on top of enforce-world.mjs:
// the route calling convention, a table made through the routes, and a
// server with no model and no painter behind it.
//
// Import this BEFORE enforce-world.mjs opens a world. A campaign copies the
// server's default backends when it is created, and these suites drive routes
// that would otherwise wake whatever is listening on this machine: a DM turn
// (end-turn, a resolved pending roll) or a portrait render (a new sheet).
import { heroInput } from "./enforce-world.mjs";

process.env.DEFAULT_TEXT_PROVIDER = "none";
delete process.env.COMFYUI_URL;
delete process.env.FLUX_WORKER_URL;
delete process.env.KOKORO_URL;
// The capability probe's own cache, answered in advance and dated a day
// ahead so it never goes stale mid-suite: no painter and no voice is
// listening, so nothing is queued on whatever this machine really runs.
globalThis.__odmCapabilityProbes = new Map(
  [
    "http://127.0.0.1:8188/system_stats",
    "http://127.0.0.1:7869/health",
    "http://127.0.0.1:8880/health",
  ].map((url) => [url, { probedAt: Date.now() + 86_400_000, reachable: false }]),
);

// One request to a route module, answered as { status, json }. A body that
// is already a string is sent as written, so a test can post broken JSON.
export async function call(mod, method, body, params = {}, url = "http://test/") {
  const request = new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await mod[method](request, { params: Promise.resolve(params) });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return { status: response.status, json };
}

// An uploaded picture gets smaller copies written beside it after the route
// has answered (src/lib/image-variants.ts). A suite that imported files
// waits for those before it removes the scratch directory under them.
export function settle(milliseconds = 600) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function signOut() {
  globalThis.__odmTestToken = "";
}

// A sheet as a client posts it. It carries a portrait so the route has no
// picture to ask for.
export function posted(overrides = {}) {
  return { ...heroInput(overrides), portrait: { url: "/uploads/enforce.png" } };
}

// Every seat a permission can turn on, at one human-run table: the owner
// holds the DM seat, and the lead, the assistant DM, a player with a sheet, a
// member without one, a stranger and nobody are all somebody else.
export async function seats(world) {
  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const campaignId = world.campaignId;
  campaigns.setDmMode(campaignId, "human", world.owner.id);
  const lead = world.addUser("lead");
  const leadSheet = world.addHero({ name: "Lead", user: lead });
  const player = world.addUser("player");
  const sheet = world.addHero({ name: "Player", user: player });
  const other = world.addUser("other");
  const otherSheet = world.addHero({ name: "Other", user: other });
  const assistant = world.addUser("assistant");
  const bare = world.addUser("bare");
  const status = world.campaign().status;
  campaigns.setCampaignStatus(campaignId, "lobby");
  for (const user of [assistant, bare]) {
    const joined = campaigns.joinByInviteCode(user.id, world.campaign().inviteCode);
    if ("error" in joined) {
      throw new Error(`could not seat ${user.username}: ${joined.error}`);
    }
  }
  campaigns.setCampaignStatus(campaignId, status);
  campaigns.setPartyLead(campaignId, lead.id);
  campaigns.setAssistantDm(campaignId, assistant.id);
  const stranger = world.addUser("stranger");
  return {
    dm: world.owner,
    assistant,
    lead,
    leadSheet,
    player,
    sheet,
    other,
    otherSheet,
    bare,
    stranger,
  };
}

// Puts a hero's token beside an enemy's on an open floor, so a melee swing
// is in reach whatever the generated map looked like.
export async function standBeside(world, heroId, enemyId) {
  const maps = await import("../../src/lib/db/battle-maps.ts");
  const board = maps.getBattleMapForEncounter(world.encounter().id);
  if (!board) {
    return;
  }
  maps.setBattleMapTerrain(board.id, ".".repeat(board.width * board.height));
  const hero = maps.getTokenByRef(board.id, heroId);
  const enemy = maps.getTokenByRef(board.id, enemyId);
  if (hero && enemy) {
    maps.moveToken(enemy.id, 3, 3, 0);
    maps.moveToken(hero.id, 2, 3, 0);
  }
}
