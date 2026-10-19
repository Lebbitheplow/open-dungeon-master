// A small branching adventure on a workshop's storyboard, for the scene
// suites (audit WF-19): a hook, a fork with two choices and an optional
// detour, a fight drawn on a battle map, a secret and somebody's moment,
// with a Who, a Where, a map and a fight picked. Import it after
// openWorld (scripts/lib/enforce-world.mjs), which points the database
// somewhere safe.

const { createWorldEntity } = await import("../../src/lib/db/world-forge.ts");
const { createPreparedMap } = await import("../../src/lib/db/prepared-maps.ts");
const { insertEncounterTemplate } = await import("../../src/lib/db/encounter-templates.ts");
const { getBeat, insertBeat, updateBeat } = await import("../../src/lib/db/workshop-beats.ts");

export const CARD_TITLES = [
  "The summons",
  "The fork in the fen",
  "Side with the guild",
  "Trust the wardens",
  "A detour through the reeds",
  "The ambush at the sluice",
  "The warden's secret",
  "Ivo's confession",
];

export function buildAdventure(campaignId, userId) {
  const npc = createWorldEntity(campaignId, { typeId: "t_character", name: "Ivo Brannock", article: "The warden of the sea wall." });
  const place = createWorldEntity(campaignId, { typeId: "t_location", name: "The Sluice Gate", text: "Iron and brine." });
  if ("error" in npc || "error" in place) throw new Error(npc.error ?? place.error);
  const npcId = npc.entity.ref.slice("npc:".length);
  const locationId = place.entity.ref.slice("location:".length);
  const map = createPreparedMap({ campaignId, name: "Sluice battle map", width: 12, height: 8, terrain: ".".repeat(96), ambient: "bright", theme: "field" });
  const encounter = insertEncounterTemplate({
    campaignId,
    name: "Smugglers at the sluice",
    enemies: [{ monster: "bandit", count: 3 }],
    battlefield: "Wet stone and a rising tide.",
    map: { mapId: map.id, scene: null, seed: null, theme: null, ambient: null, width: null, height: null },
    notes: "",
    createdByUserId: userId,
  });
  const card = (kind, title, body, links, x, y) => {
    const made = insertBeat(campaignId, { kind, title, body, links, edges: [], routes: {}, x, y });
    if ("error" in made) throw new Error(made.error);
    return made.id;
  };
  const [summons, fork, guild, wardens, reeds, ambush, secret, confession] = [
    card("hook", CARD_TITLES[0], "A letter with the warden's seal.", { npcId }, 40, 40),
    card("event", CARD_TITLES[1], "The causeway splits three ways.", {}, 320, 40),
    card("event", CARD_TITLES[2], "The guild pays well and asks little.", { locationId }, 600, 0),
    card("event", CARD_TITLES[3], "The wardens want the leak found.", {}, 600, 160),
    card("event", CARD_TITLES[4], "Lanterns in the reeds.", {}, 600, 320),
    card("encounter", CARD_TITLES[5], "They wait where the water is loudest.", { mapId: map.id, encounterId: encounter.id, locationId }, 880, 80),
    card("secret", CARD_TITLES[6], "Ivo sold the codes himself.", {}, 880, 320),
    card("npc_moment", CARD_TITLES[7], "He asks them to let the tide decide.", { npcId }, 1160, 80),
  ];
  const draw = (from, edges, routes = {}) => {
    const { id, ...rest } = getBeat(from);
    updateBeat(campaignId, id, { ...rest, edges, routes });
  };
  draw(summons, [fork]);
  draw(fork, [guild, wardens, reeds], {
    [guild]: { kind: "choice", label: "if they side with the guild" },
    [wardens]: { kind: "choice", label: "if they trust the wardens" },
    [reeds]: { kind: "optional", label: "if they search the reeds" },
  });
  draw(guild, [ambush]);
  draw(wardens, [ambush]);
  draw(reeds, [secret]);
  draw(ambush, [confession]);
  return { npcId, locationId, mapId: map.id, encounterId: encounter.id, cards: { summons, fork, guild, wardens, reeds, ambush, secret, confession } };
}

// A board as words, so two databases can be compared: each card's kind,
// title, text and place, its arrows and their routes by the title of the
// card they reach, and its picks by the name of what was picked.
export async function describeBoard(campaignId) {
  const { listBeats } = await import("../../src/lib/db/workshop-beats.ts");
  const { getDatabase } = await import("../../src/lib/db/core.ts");
  const db = getDatabase();
  const beats = listBeats(campaignId);
  const titles = new Map(beats.map((beat) => [beat.id, beat.title]));
  const tables = { npcId: "npcs", locationId: "locations", mapId: "prepared_maps", encounterId: "encounter_templates" };
  const nameOf = (field, id) => db.prepare(`SELECT name FROM ${tables[field]} WHERE id = ?`).get(id)?.name ?? `missing ${id}`;
  return beats.map((beat) => ({
    kind: beat.kind,
    title: beat.title,
    body: beat.body,
    x: beat.x,
    y: beat.y,
    leadsTo: beat.edges.map((edge) => titles.get(edge) ?? `missing ${edge}`),
    routes: Object.fromEntries(Object.entries(beat.routes ?? {}).map(([to, route]) => [titles.get(to), route])),
    picks: Object.fromEntries(Object.entries(beat.links).map(([field, id]) => [field, nameOf(field, id)])),
  }));
}
