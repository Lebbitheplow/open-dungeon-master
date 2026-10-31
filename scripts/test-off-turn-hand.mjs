// Two Hands a person playing several characters was missing (the workshop's
// test bench, 2026-10-30):
//
// - A hero who is hit while another of the same person's heroes acts is
//   offered their reaction (Uncanny Dodge, Shield) as a card. The Hand
//   follows the character acting, so the hit hero's reaction never showed,
//   nor did it in the GM seat, where the monsters' hand sits on their turns
//   (src/lib/battlemap/hand-react.ts offTurnReactionCards,
//   src/lib/player-characters.ts offTurnReactors).
// - At a table a person runs, a companion nobody commands is that person's
//   to play on its own turn: the Hand is the companion's, its cards are
//   accepted by the actions route and its End turn ends the turn
//   (src/lib/dm/companion-command.ts gmCompanionTurn). The GM seat showed the
//   monsters' hand and only Skip turn.
import assert from "node:assert/strict";
import fs from "node:fs";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { combatKit, TRAINED } from "./lib/enforce-combat.mjs";
import { fakeModel, reply, settleQueue } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-off-turn-hand");

const { setDmMode } = await import("../src/lib/db/campaigns.ts");
const { createCompanionUser } = await import("../src/lib/db/users.ts");
const { createSheet, markSheetAsCompanion, setCompanionCommander } = await import("../src/lib/db/sheets.ts");
const { activePublicEncounter } = await import("../src/lib/db/encounter-view.ts");
const { gmCompanionTurn } = await import("../src/lib/dm/companion-command.ts");
const { gmTurnCompanion, offTurnReactors } = await import("../src/lib/player-characters.ts");
const { offTurnReactionCards, reactionAim, reactionCards } = await import("../src/lib/battlemap/hand-react.ts");
const { turnFromEncounter } = await import("../src/lib/battlemap/hand-table.ts");
const { characterAwaitingPlayer, declaredThisTurn } = await import("../src/lib/dm/player-word.ts");
const { turnOverFor } = await import("../src/lib/dm/claims.ts");

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

async function route(world, name, body, user) {
  const handler = await world.route(`campaigns/[campaignId]/${name}`);
  world.signIn({ id: user.id });
  const response = await handler.POST(
    new Request(`http://odm.test/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }),
    { params: Promise.resolve({ campaignId: world.campaignId }) },
  );
  return { status: response.status, body: await response.json() };
}

const current = (world) => {
  const encounter = world.encounter();
  return encounter?.orderReady ? encounter.order[encounter.turnIndex] : null;
};

// One person playing two heroes: Hild acts first, Poppy (a rogue with
// Uncanny Dodge) after her, then a goblin.
async function twoHeroes(gameSettings = { multiCharacter: "all_active" }) {
  const world = await openWorld({ gameSettings });
  const kit = await combatKit(world);
  const hild = world.addHero({ name: "Hild", class: "cleric" });
  const poppy = world.addHero({ name: "Poppy", class: "rogue", user: world.owner });
  world.patch(poppy.id, { features: [{ name: "Uncanny Dodge", source: "class" }] });
  await kit.fight(1, { heroFaces: { [hild.id]: 19, [poppy.id]: 15 }, enemyFace: 1 });
  return { world, hild: world.sheet(hild.id), poppy: world.sheet(poppy.id) };
}

// The Hand's reactions as Hand.tsx works them out for the person acting as
// `acting`: the acting character's own, then the others'.
function handReactions(world, acting, multiCharacter) {
  const encounter = activePublicEncounter(world.campaignId);
  const sheets = world.sheets();
  const hits = encounter.lastHits ?? [];
  const own = reactionCards(acting, turnFromEncounter(encounter, acting, { myTurn: true }), hits, sheets);
  const others = offTurnReactionCards(
    offTurnReactors(sheets, acting.userId, acting.id, multiCharacter).map((sheet) => ({
      sheet,
      turn: turnFromEncounter(encounter, sheet, { myTurn: false }),
    })),
    hits,
    sheets,
  );
  return { own, others, hits };
}

await test("A hit hero who is not the one acting is offered their reaction, named for them, and the actions route takes it", async () => {
  const { world, hild, poppy } = await twoHeroes();
  assert.equal(current(world).characterId, hild.id, "Hild acts first");
  const goblin = world.enemies()[0];
  await world.hitBy(poppy.id, { enemyId: goblin.id, name: goblin.displayName, total: 18, vsAc: 14, raw: 6, attack: "Scimitar" });
  const { own, others, hits } = handReactions(world, hild, "all_active");
  assert.equal(own.length, 0, "Hild was not hit");
  const dodge = others.find((card) => card.name === "Uncanny Dodge");
  assert.ok(dodge, "Poppy's Uncanny Dodge was never offered while Hild acts");
  assert.deepEqual(dodge.actor, { id: poppy.id, name: "Poppy" });
  assert.equal(dodge.disabled, null, dodge.disabled ?? "");
  assert.match(dodge.prompt, /hit Poppy for 6/);
  assert.ok(dodge.id.startsWith("reaction:"), "the card keeps its urgent seat in the fan");
  assert.equal(reactionAim(dodge, hits, poppy.id, world.sheets()), null, "Uncanny Dodge needs no target");

  // With one character fielded at a time, only the selected one acts.
  assert.equal(handReactions(world, hild, "one_active").others.length, 0);

  // The card goes out under Poppy's name while it is Hild's turn.
  const posted = await route(world, "actions", { kind: "do", content: "Poppy twists away from the blow.", characterId: poppy.id, intent: dodge.intent }, world.owner);
  assert.equal(posted.status, 202, JSON.stringify(posted.body));
  assert.equal(current(world).characterId, hild.id, "Hild's turn is still Hild's");
  // Sent as Poppy, the answer is no word of Hild's: a narration that hands
  // the turn on cannot end Hild's turn for it (claims.ts turnOverFor), and
  // the AI still waits on Hild (the bench's answer typed in Hild's box was
  // read as Hild's move, and her turn ended with the reply).
  assert.equal(declaredThisTurn(world.campaignId, hild.id), false);
  assert.equal(turnOverFor(world.campaignId, { resolvedCharacterIds: [] }), null);
  assert.equal(characterAwaitingPlayer(world.campaignId)?.id, hild.id);
});

// A complete card is the engine's before the narrator's (issue 570, turn.ts
// directCards), a reaction among them: the card sent as the hit hero is
// resolved as that hero on the acting one's turn, and leaves that turn alone.
await test("At a table the AI runs, the hit hero's reaction card is the turn's first call, made as that hero, and the acting hero keeps the turn", async () => {
  const { world, hild, poppy } = await twoHeroes();
  const model = await fakeModel();
  try {
    model.pointAt(world);
    model.script([reply({ text: "Poppy twists aside and the scimitar only grazes her. The goblin turns back to Hild." })]);
    const goblin = world.enemies()[0];
    await world.hitBy(poppy.id, { enemyId: goblin.id, name: goblin.displayName, total: 18, vsAc: 14, raw: 6, attack: "Scimitar" });
    const dodge = handReactions(world, hild, "all_active").others.find((card) => card.name === "Uncanny Dodge");
    const posted = await route(world, "actions", { kind: "do", content: "Poppy twists away from the blow.", characterId: poppy.id, intent: dodge.intent }, world.owner);
    assert.equal(posted.status, 202, JSON.stringify(posted.body));
    await settleQueue(world.campaignId);
    const [request] = model.requests;
    assert.ok(request, "the turn asked the narrator");
    const first = request.messages.find((message) => message.role === "assistant" && message.tool_calls?.length)?.tool_calls[0];
    assert.equal(first?.function.name, "use_reaction", JSON.stringify(first));
    const args = JSON.parse(first.function.arguments);
    assert.equal(args.characterId, poppy.id, "made as Poppy, not as Hild");
    assert.equal(args.feature, "Uncanny Dodge");
    const [answer] = model.results(request);
    assert.equal(answer?.result.ok, true, JSON.stringify(answer?.result));
    assert.ok(world.encounter().reactionsUsed.includes(poppy.id), "Poppy's reaction is spent");
    assert.equal(world.encounter().reactionsUsed.includes(hild.id), false, "Hild's is not");
    assert.equal(current(world).characterId, hild.id, "Hild's turn is still Hild's");
    assert.equal(characterAwaitingPlayer(world.campaignId)?.id, hild.id);
  } finally {
    model.close();
  }
});

await test("Another hero's reaction card aims where its own hero's would", () => {
  const card = { id: "reaction:protection:ally-1@hero-2", target: "ally" };
  assert.deepEqual(reactionAim(card, [], "hero-2", [{ id: "ally-1", name: "Bram" }]), { id: "ally-1", name: "Bram", kind: "ally" });
  const strike = { id: "reaction:commanders-strike@hero-2", target: "enemy" };
  assert.equal(reactionAim(strike, [{ characterId: "hero-2", attackerId: "e1", attacker: "Goblin" }], "hero-2", []), null, "Commander's Strike's target is still picked");
});

// A table a person runs, where that person also plays Kara: a companion
// nobody commands, Pip, acts after her, then a goblin.
async function personsTable({ commandedBy = null } = {}) {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", abilities: { dex: 10, con: 10, wis: 10 } });
  const bot = createCompanionUser("Pip");
  const made = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(kara.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  setCompanionCommander(made.id, commandedBy);
  setDmMode(world.campaignId, "human", world.owner.id);
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  return { world, kara, pip: world.sheet(made.id) };
}

await test("At a table a person runs, a companion nobody commands is theirs on its turn: its card resolves and End turn ends it", async () => {
  const { world, kara, pip } = await personsTable();
  assert.equal(current(world).characterId, kara.id);
  assert.equal((await route(world, "encounter/end-turn", {}, world.owner)).status, 200);
  assert.equal(current(world).characterId, pip.id, "the pointer rests on Pip");

  // A card the companion's Hand plays: the Dodge action, resolved at once.
  const dodged = await route(world, "actions", { kind: "do", content: "Pip takes the Dodge action.", characterId: pip.id, intent: { card: "basic", action: "dodge" } }, world.owner);
  assert.equal(dodged.status, 200, JSON.stringify(dodged.body));
  assert.equal(dodged.body.resolved, true);
  assert.equal(world.encounter().turnBudget.actionUsed, true, "the Dodge spent Pip's action");

  const ended = await route(world, "encounter/end-turn", {}, world.owner);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.notEqual(current(world).characterId, pip.id, "Pip's turn ended");
  assert.equal(gmCompanionTurn(world.campaign(), world.owner.id), null, "the turn after Pip's is no companion's");
});

await test("The Hand's view of a companion's turn and the server's agree", async () => {
  const { world, pip } = await personsTable();
  await route(world, "encounter/end-turn", {}, world.owner);
  assert.equal(current(world).characterId, pip.id);
  assert.equal(gmCompanionTurn(world.campaign(), world.owner.id)?.id, pip.id);
  assert.equal(gmTurnCompanion(world.sheets(), pip.id)?.id, pip.id);
});

await test("A companion a player commands stays theirs, and a player cannot take a companion's turn from the GM", async () => {
  const { world, pip } = await personsTable();
  const player = world.addUser("guest");
  await route(world, "encounter/end-turn", {}, world.owner);
  assert.equal(current(world).characterId, pip.id);
  assert.equal(gmCompanionTurn(world.campaign(), player.id), null, "a player holds no GM seat");
  assert.equal(gmTurnCompanion([{ ...pip, commandedBy: "someone" }], pip.id), null, "a commanded companion is its commander's");
  assert.equal(gmTurnCompanion([{ ...pip, commandedBy: null }], pip.id)?.id, pip.id);
  // The GM's own hero's card names the companion only by its id.
  const asKara = await route(world, "actions", { kind: "do", content: "Pip dodges.", intent: { card: "basic", action: "dodge" } }, world.owner);
  assert.notEqual(asKara.status, 200, "a card without the companion's id is not played as the companion");
});

await test("In the GM seat, a reaction card for a hero the GM plays is resolved at once, on the enemies' turn", async () => {
  const world = await openWorld({ gameSettings: { multiCharacter: "all_active" }, campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara", proficiencies: TRAINED });
  const poppy = world.addHero({ name: "Poppy", class: "rogue", level: 5, user: world.owner, maxHp: 30, ac: 12, acOverride: true });
  world.patch(poppy.id, { features: [{ name: "Uncanny Dodge", source: "class" }] });
  setDmMode(world.campaignId, "human", world.owner.id);
  // The goblin's 20 and up beats both heroes whatever its Dexterity, so at a
  // table a person runs the fight opens on its turn, owed before Kara's
  // (enemies-due.ts). Kara on 19 against a goblin's 18 + 2 left her turn
  // waiting behind it, and ending it was refused.
  await kit.fight(1, { heroFaces: { [kara.id]: 10, [poppy.id]: 5 }, enemyFace: 20 });
  const [goblin] = world.enemies();
  assert.deepEqual(world.encounter().legendary.due, [goblin.id], "the fight opens on the goblin's turn");
  assert.notEqual(current(world).characterId, poppy.id, "Poppy is hit on a turn not hers");
  world.dice(15, 6);
  const swing = await world.invoke("enemy_attack", { enemyId: goblin.id, targetCharacterId: poppy.id });
  assert.equal(swing.ok, true, swing.error);
  const hurt = world.sheet(poppy.id).currentHp;
  assert.ok(hurt < 30, "the goblin hit Poppy");
  const encounter = activePublicEncounter(world.campaignId);
  const [dodge] = offTurnReactionCards(
    [{ sheet: world.sheet(poppy.id), turn: turnFromEncounter(encounter, world.sheet(poppy.id), { myTurn: false }) }],
    encounter.lastHits ?? [],
    world.sheets(),
  );
  assert.equal(dodge?.name, "Uncanny Dodge");
  const played = await route(world, "actions", { kind: "do", content: "Poppy twists away.", characterId: poppy.id, intent: dodge.intent }, world.owner);
  assert.equal(played.status, 200, JSON.stringify(played.body));
  assert.equal(played.body.resolved, true);
  assert.ok(world.sheet(poppy.id).currentHp > hurt, "Uncanny Dodge gave back half the hit");
});

await test("An AI-run table keeps a companion's turn the AI's", async () => {
  const world = await openWorld({ campaign: { maxPlayers: 8 } });
  const kit = await combatKit(world);
  const kara = world.addHero({ name: "Kara" });
  const bot = createCompanionUser("Pip");
  const made = createSheet(world.campaignId, bot.id, 1, { ...world.sheet(kara.id), name: "Pip" });
  markSheetAsCompanion(made.id, "party", "cheerful");
  await kit.fight(1, { heroFaces: { [kara.id]: 19, [made.id]: 15 }, enemyFace: 1 });
  await route(world, "encounter/end-turn", {}, world.owner);
  assert.equal(current(world).characterId, made.id);
  assert.equal((await route(world, "encounter/end-turn", {}, world.owner)).status, 409);
  assert.equal(gmCompanionTurn(world.campaign(), world.owner.id), null);
});

await test("The screens wire it: the Hand offers the other heroes' reactions, and the GM seat shows a companion's Hand and the heroes' reactions", () => {
  const hand = read("app/campaigns/[campaignId]/Hand.tsx");
  assert.match(hand, /offTurnReactionCards\(/);
  assert.match(hand, /characterId: picked\.actor\?\.id \?\? sheet\?\.id/);
  assert.match(hand, /gmTurnCompanion\(sheets, turnId\)/);
  const composer = read("app/campaigns/[campaignId]/Composer.tsx");
  assert.match(composer, /Boolean\(gmTurnCompanion\(sheets, current\.id\)\)/);
  assert.match(composer, /reactionsOnly=\{!partyHand\}/);
  assert.match(composer, /multiCharacter=\{multiCharacter\}/);
  const view = read("app/campaigns/[campaignId]/SessionView.tsx");
  assert.match(view, /gmTurnCompanion\(sheets, turnCharacterId\(state\.encounter\)\)/);
  assert.match(view, /playsTurn: gmPlaysTurn/);
});

await test("The GM's box and cards are open on the companion's turn they play, and closed on another's", async () => {
  const { composerGate } = await import("../src/app/campaigns/[campaignId]/composerGate.ts");
  const floor = { mode: "initiative", encounterId: "e", userIds: ["companion-user"], currentName: "Pip", round: 1 };
  const gate = (playsTurn) => composerGate({ floor, sheets: [], meUserId: "gm", kind: "do", myName: "Pip", leadPrivate: false, openingNarrationPlaying: false, playsTurn });
  assert.equal(gate(true).inputBlocked, false);
  assert.equal(gate(false).inputBlocked, true);
});

finish();
