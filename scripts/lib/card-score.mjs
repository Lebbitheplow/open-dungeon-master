// Plays one card scenario (card-scenarios.mjs) at a staged table and scores
// what the DM turn did with it, from the turn's tool calls alone
// (src/lib/dm/card-score-logic.ts). Shared by the live scorer
// (scripts/score-cards.mjs) and its own suite (scripts/test-score-cards.mjs),
// which plays the same scenarios against a scripted model.
//
// Import enforce-world.mjs before this module: it points the database at a
// scratch directory as it loads, and this module imports src/ on demand.
//
//   const backend = liveBackend({ url, model, key });   // or a fakeModel()
//   const result = await playScenario(scenario, { backend, seed: 7 });
//   result.score.verdict   // "resolved" | "refused" | "missed"
//   result.score.path      // "engine" | "model" | "correction" | "none"
import { openWorld, seedDice } from "./enforce-world.mjs";
import { combatKit } from "./enforce-combat.mjs";
import { HEROES, allyOf } from "./card-scenarios.mjs";

// A scenario that could not be staged as written: the Hand did not deal the
// card, dealt it disabled, or the engine refused it before the post. Not a
// model failure; a finding about the Hand or the scenario.
export class StageError extends Error {
  constructor(scenarioId, message) {
    super(`${scenarioId}: ${message}`);
    this.name = "StageError";
    this.scenarioId = scenarioId;
  }
}

// A live OpenAI-compatible backend for the staged campaigns. Only an admin's
// campaign runs on a backend address of its own (src/lib/db/settings.ts), so
// each world's owner is made one.
export function liveBackend({ url, model, key = "" }) {
  return {
    label: model,
    pointAt: async (world) => {
      const { getDatabase } = await import("../../src/lib/db/core.ts");
      const campaigns = await import("../../src/lib/db/campaigns.ts");
      getDatabase().prepare(`UPDATE users SET is_admin = 1 WHERE id = ?`).run(world.owner.id);
      campaigns.updateStorySettings(world.campaignId, {
        textProvider: "custom",
        customBaseUrl: url,
        customModel: model,
        customApiKey: key,
        imageGenerationEnabled: false,
        autoImages: false,
      });
    },
  };
}

// The Hand's spell facts for a sheet, from the content pack when it is
// installed and from the bundled data when it is not: what the client's
// HandSpells.tsx fetches, built here on the server side.
async function spellFactsFor(sheet, authors) {
  const { spellsToLookUp } = await import("../../src/lib/battlemap/hand.ts");
  const { findSpellByName } = await import("../../src/lib/content/index.ts");
  const { bundledSpellFacts } = await import("../../src/lib/srd/spell-facts.ts");
  const { authoredSpellRow } = await import("../../src/lib/srd/spell-mechanics.ts");
  const { textKey } = await import("../../src/lib/language/text-logic.ts");
  const facts = {};
  for (const name of spellsToLookUp(sheet)) {
    const entry = findSpellByName(name, authors);
    if (entry) {
      const text = (value) => (typeof value === "string" ? value : "");
      facts[textKey(name)] = {
        level: entry.level,
        school: entry.school,
        castingTime: text(entry.data.casting_time),
        range: text(entry.data.range),
        desc: text(entry.data.desc),
        higherLevel: text(entry.data.higher_level),
        concentration: entry.concentration,
      };
      continue;
    }
    // CI has no pack: the bundled checklist and the authored rows still
    // describe every SRD spell the scenarios cast.
    const bundled = bundledSpellFacts(name);
    const authored = authoredSpellRow(name);
    if (bundled || authored) {
      facts[textKey(name)] = {
        level: bundled?.level ?? authored?.level ?? 1,
        school: bundled?.school ?? authored?.school ?? "",
        castingTime: authored?.casting_time ?? (bundled?.castingTime === "bonus" ? "1 bonus action" : bundled?.castingTime === "reaction" ? "1 reaction" : "1 action"),
        range: authored?.range ?? (bundled?.range?.kind === "feet" ? `${bundled.range.feet} feet` : bundled?.range?.kind === "touch" ? "Touch" : "Self"),
        desc: authored?.desc ?? "",
        higherLevel: authored?.higher_level ?? "",
        concentration: bundled?.concentration ?? authored?.concentration ?? false,
      };
    }
  }
  return facts;
}

// Answer every parked roll with the server's dice, as the pending-rolls
// route's digital fallback does, then let the turn resume.
async function settleRolls(campaignId) {
  const { listOpenPendingRolls, resolvePendingRoll, listPendingForTurn } = await import("../../src/lib/db/dm-turns.ts");
  const { insertRoll } = await import("../../src/lib/db/rolls.ts");
  const { rollExpression } = await import("../../src/lib/dice.ts");
  const { resumeDmTurn } = await import("../../src/lib/dm/turn.ts");
  for (let round = 0; round < 4; round += 1) {
    const open = listOpenPendingRolls(campaignId);
    if (!open.length) return;
    let turnId = "";
    for (const pending of open) {
      const roll = insertRoll({
        campaignId,
        characterId: pending.characterId,
        requestedBy: "player",
        kind: pending.kind,
        detail: pending.detail,
        advantage: pending.advantage,
        dc: pending.dc,
        result: rollExpression(pending.expression),
      });
      resolvePendingRoll(pending.id, "fallback", roll.id);
      turnId = pending.turnId;
    }
    if (turnId && !listPendingForTurn(turnId).some((entry) => entry.status === "pending")) {
      await resumeDmTurn(campaignId, turnId);
    }
  }
}

// Where everyone stands: the actor at the middle of the board, the ally at
// their shoulder, the first enemy next to them or six squares off, the rest
// gathered behind it so an area laid on the first takes them too.
function positions(board, place, enemyCount) {
  const x = Math.min(5, board.width - 8);
  const y = Math.min(5, board.height - 3);
  const first = place === "ranged" ? x + 6 : x + 1;
  return {
    actor: [x, y],
    ally: [x - 1, y],
    enemies: Array.from({ length: enemyCount }, (_, index) => (index === 0 ? [first, y] : [first + Math.ceil(index / 2), y + (index % 2 ? 1 : -1)])),
  };
}

// Stages the scenario's table and deals its card: the world, the actor and
// ally, the fight, and the card with the sentence and intent the Hand would
// post. Throws a StageError when the Hand or the engine will not have it.
export async function stageScenario(scenario) {
  const { deriveHand, FRESH_TURN } = await import("../../src/lib/battlemap/hand.ts");
  const { composeSentence, intentBody, handReady } = await import("../../src/lib/battlemap/hand-play.ts");
  const { reactionCards } = await import("../../src/lib/battlemap/hand-react.ts");
  const { messageIntentSchema } = await import("../../src/lib/dm/intent-logic.ts");
  const { intentRefusal } = await import("../../src/lib/dm/intent-check.ts");
  const { spellAuthorsFor } = await import("../../src/lib/dm/spell-authors.ts");
  const { textKey } = await import("../../src/lib/language/text-logic.ts");
  const { readLastHit } = await import("../../src/lib/dm/last-hit.ts");
  const encounters = await import("../../src/lib/db/encounters.ts");

  const world = await openWorld({ gameSettings: { ttsEnabled: false } });
  const kit = await combatKit(world);
  const actor = world.addHero(HEROES[scenario.actor]);
  const ally = world.addHero(HEROES[allyOf(scenario.actor)]);
  let enemy = null;
  if (!scenario.outOfFight) {
    const count = scenario.enemies ?? 2;
    await kit.fight(count);
    const enemies = world.enemies();
    const spots = positions(kit.map(), scenario.place, count);
    kit.place(actor.id, ...spots.actor);
    kit.place(ally.id, ...spots.ally);
    enemies.forEach((foe, index) => kit.place(foe.id, ...spots.enemies[index]));
    enemy = enemies[0];
    if (scenario.hit) {
      // The enemy's turn, and its blow just landed on the actor.
      const encounter = world.encounter();
      const index = encounter.order.findIndex((entry) => entry.kind !== "pc");
      encounters.saveEncounter({ ...encounter, turnIndex: index, turnBudget: null });
      await world.hitBy(actor.id, { enemyId: enemy.id, name: enemy.displayName, total: 19, vsAc: actor.ac, raw: 6, attack: "Scimitar" });
      world.patch(actor.id, { currentHp: actor.maxHp - 6 });
    } else {
      kit.giveTurn(actor.id);
    }
  }
  if (scenario.equipped) {
    world.patch(actor.id, {
      equipment: world.sheet(actor.id).equipment.map((item) => ({ ...item, equipped: scenario.equipped.includes(item.name) })),
    });
  }
  if (scenario.wounded?.actor) world.patch(actor.id, { currentHp: scenario.wounded.actor });
  if (scenario.wounded?.ally) world.patch(ally.id, { currentHp: scenario.wounded.ally });
  if (scenario.conditions) world.patch(actor.id, { conditions: scenario.conditions });

  const sheet = world.sheet(actor.id);
  const campaign = world.campaign();
  const encounter = world.encounter();
  const table = encounter
    ? {
        round: encounter.round,
        orderReady: encounter.orderReady,
        acting: scenario.hit ? { id: "", name: enemy.displayName } : { id: actor.id, name: actor.name },
        surprised: { acting: [], reacting: [] },
      }
    : null;
  const handTurn = { ...FRESH_TURN, myTurn: !scenario.hit, ...(scenario.hit ? { currentName: enemy.displayName } : {}), ...(table ? { table } : {}) };
  let cards;
  if (scenario.hit) {
    const record = readLastHit(world.campaignId, actor.id);
    const publicHit = {
      characterId: actor.id,
      attacker: record.attacker.name,
      attackerId: record.attacker.id,
      attack: record.attack,
      type: record.type,
      ranged: record.ranged,
      source: record.source,
      hit: record.swings.some((swing) => swing.hit),
      damage: record.swings.reduce((sum, swing) => sum + (swing.hit ? swing.raw : 0), 0),
      answered: record.answered,
    };
    cards = reactionCards(sheet, handTurn, [publicHit], [actor, ally].map((hero) => ({ id: hero.id, name: hero.name })));
  } else {
    const spells = await spellFactsFor(sheet, spellAuthorsFor(campaign));
    cards = deriveHand(sheet, handTurn, { spells, gear: { allies: 1 } });
  }
  const wanted = textKey(scenario.card);
  const card = cards.find((entry) => textKey(entry.name) === wanted);
  if (!card) {
    throw new StageError(scenario.id, `the Hand dealt no "${scenario.card}"; it holds: ${cards.map((entry) => entry.name).join(", ")}`);
  }
  if (card.disabled) {
    throw new StageError(scenario.id, `"${card.name}" is dealt disabled: ${card.disabled}`);
  }
  const aim =
    scenario.aim === "enemy"
      ? { id: enemy.id, name: enemy.displayName, kind: "enemy", ac: enemy.ac }
      : scenario.aim === "ally"
        ? { id: ally.id, name: ally.name, kind: "ally" }
        : scenario.aim === "self"
          ? { id: actor.id, name: actor.name, kind: "self" }
          : null;
  const choices = { ...(scenario.choices ?? {}) };
  if (scenario.area) {
    if (!card.area) {
      throw new StageError(scenario.id, `"${card.name}" lays no area on the board, so no square can be picked for it`);
    }
    const target = kit.token(enemy.id);
    const at = { x: target.x, y: target.y };
    choices.area = card.area.pick === "point" ? { at } : { toward: at };
  }
  if (!handReady(card, aim, choices)) {
    throw new StageError(scenario.id, `"${card.name}" is not ready to play as staged (target ${card.target}, aim ${aim?.kind ?? "none"})`);
  }
  const sentence = composeSentence(card, aim, [], choices);
  const parsed = messageIntentSchema.safeParse(intentBody(card, aim, [], choices));
  if (!parsed.success) {
    throw new StageError(scenario.id, `the card's intent does not parse: ${parsed.error.issues[0]?.message}`);
  }
  const intent = parsed.data;
  const refusal = intentRefusal(campaign, sheet, intent);
  if (refusal) {
    throw new StageError(scenario.id, `the engine refuses the card before it is posted: ${refusal}`);
  }
  return { world, kit, actor, ally, enemy, card, aim, choices, sentence, intent };
}

// Plays the scenario: stages it, points its table at the backend, posts the
// card as the Hand would, runs the DM turn and scores it.
export async function playScenario(scenario, { backend, seed = 1 }) {
  const campaigns = await import("../../src/lib/db/campaigns.ts");
  const messages = await import("../../src/lib/db/messages.ts");
  const { startDmTurn } = await import("../../src/lib/dm/turn.ts");
  const { getDmTurn, getLatestDmTurnId } = await import("../../src/lib/db/dm-turns.ts");
  const { spellMechanicsFor } = await import("../../src/lib/content/index.ts");
  const { spellAuthorsFor } = await import("../../src/lib/dm/spell-authors.ts");
  const { scoreCard } = await import("../../src/lib/dm/card-score-logic.ts");
  const { DM_HALTED_PREFIX } = await import("../../src/lib/campaign-types.ts");

  seedDice(seed);
  const staged = await stageScenario(scenario);
  const { world, actor, intent, sentence } = staged;
  await backend.pointAt(world);
  const seq = campaigns.allocateSeq(world.campaignId);
  messages.insertCampaignMessage({
    campaignId: world.campaignId,
    seq,
    authorType: "player",
    userId: actor.userId,
    characterId: actor.id,
    content: sentence,
    intent,
  });
  const started = Date.now();
  let thrown = null;
  try {
    await startDmTurn(world.campaignId);
    await settleRolls(world.campaignId);
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
  }
  const seconds = Math.round((Date.now() - started) / 10) / 100;
  const turnId = getLatestDmTurnId(world.campaignId);
  const turn = turnId ? getDmTurn(turnId) : null;
  const spell = intent.card === "spell" || intent.card === "reaction" ? intent.spell : undefined;
  const resolution = spell ? (spellMechanicsFor({ spell, userIds: spellAuthorsFor(world.campaign()) })?.mech.resolution ?? null) : null;
  const card = { intent, characterId: actor.id, name: actor.name, resolution };
  const score = scoreCard(card, turn?.conversation ?? [], { callIndex: turn?.callIndex });
  const written = messages.listRecentMessages(world.campaignId, 50).filter((message) => message.seq > seq);
  const halted = written.find((message) => message.authorType === "system" && message.content.startsWith(DM_HALTED_PREFIX));
  seedDice(null);
  world.close();
  return {
    id: scenario.id,
    group: scenario.group,
    card: staged.card.name,
    sentence,
    seconds,
    score,
    narrated: Boolean(turn?.narrationParts.length),
    status: turn?.status ?? "none",
    error: thrown ?? (halted ? halted.content.slice(DM_HALTED_PREFIX.length) : null),
    // For a reader checking a verdict by eye; never part of a shared count.
    narration: written.filter((message) => message.authorType === "dm").map((message) => message.content).join("\n").slice(0, 400),
    conversation: turn?.conversation ?? [],
  };
}

// Counts for a report: by verdict, by path, by group, and the scenarios that
// could not be staged.
export async function summarize(results, stageErrors = []) {
  const { tallyScores } = await import("../../src/lib/dm/card-score-logic.ts");
  const scored = results.filter((result) => !result.error);
  const groups = {};
  for (const result of scored) {
    const group = (groups[result.group] ??= { scenarios: 0, resolved: 0, refused: 0, missed: 0, engine: 0, model: 0, correction: 0 });
    group.scenarios += 1;
    group[result.score.verdict] += 1;
    if (result.score.path !== "none") group[result.score.path] += 1;
  }
  const near = {};
  for (const result of scored) {
    for (const reason of result.score.near) near[reason] = (near[reason] ?? 0) + 1;
  }
  return {
    scenarios: results.length,
    errors: results.filter((result) => result.error).length,
    stageErrors: stageErrors.length,
    ...tallyScores(scored.map((result) => result.score)),
    near,
    narratedWhenMissed: scored.filter((result) => result.score.verdict === "missed" && result.narrated).length,
    modelCalls: scored.reduce((sum, result) => sum + result.score.modelCalls, 0),
    meanSeconds: Math.round((scored.reduce((sum, result) => sum + result.seconds, 0) / Math.max(1, scored.length)) * 10) / 10,
    groups,
  };
}
