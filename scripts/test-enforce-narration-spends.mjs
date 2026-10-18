// The narration guard on a turn that spent something which reads like a
// spell: Hexblade's Curse narrated as a shadow and a black mark, a potion
// narrated as wounds closing. The claims reader sees only the prose, so it
// may name the spell the effect resembles (Bane, Cure Wounds); it is told
// what each character spent this turn and may tie such a cast to that spend,
// and a cast tied to its own caster's spend is no spell nothing paid for. A
// leveled spell narrated beside the spend, tied to nothing, is still caught:
// a spend excuses only what it paid for.
//
// Whole DM turns against the scripted fake model (scripts/lib/
// enforce-narrator.mjs), so what is pinned is the correction call the guard
// makes or does not make, and the request the reader was sent.
import assert from "node:assert/strict";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";
import { TRAINED } from "./lib/enforce-combat.mjs";
import { call, fakeModel, reply } from "./lib/enforce-narrator.mjs";

const { test, finish } = suite("test-enforce-narration-spends");
const world = await openWorld({ gameSettings: { ttsEnabled: false, narrationGuard: true } });
const model = await fakeModel();
model.pointAt(world);

const vesper = world.addHero({
  name: "Vesper", class: "warlock", subclass: "Hexblade", level: 5, abilities: { cha: 16 }, proficiencies: TRAINED,
  features: [{ name: "Hexblade's Curse", source: "subclass", level: 1 }],
  spellcasting: {
    ability: "cha", slots: {}, pactSlots: { level: 3, max: 2, used: 0 },
    prepared: [], known: ["Hold Person", "Hex"], cantrips: ["Eldritch Blast"],
  },
  equipment: [{ name: "Potion of Healing", qty: 2 }],
});
assert.ok(world.sheet(vesper.id).resources?.sub_hexblades_curse, "Vesper has no Hexblade's Curse to spend");

const curse = () => call("use_resource", { characterId: vesper.id, resource: "Hexblade's Curse" });
const LONG = " The candles gutter as the cold settles over the chapel, and nobody in the pews dares to breathe.";

// One turn: the spend, then the narration, with what the reader answers for
// that narration. Returns the stored message and the turn's requests.
async function spendTurn(spend, narration, claims, rewrite) {
  world.patch(vesper.id, { resources: { ...world.sheet(vesper.id).resources, sub_hexblades_curse: { max: 1, used: 0 } }, currentHp: 20 });
  model.script([reply({ calls: [spend] }), reply({ text: narration }), ...(rewrite ? [reply({ text: rewrite })] : [])]);
  model.claims([claims]);
  const message = await model.turn(world, "Vesper curses the cleric.", vesper.id);
  return { message, served: model.served(), read: model.readerRequests[0]?.messages.at(-1)?.content ?? "" };
}

await test("A curse narrated with no spell named, read as Bane and tied to the curse spent, is no spell nothing paid for: no correction call, in any language.", async () => {
  const narrations = [
    "A cold shadow peels away from Vesper and settles on the cleric: a black mark blooms on his tunic, and for a minute nothing he does will escape it." + LONG,
    "Un'ombra fredda si stacca da Vesper e si posa sul chierico: un marchio nero gli fiorisce sulla tunica, e per un minuto nulla di ciò che fa le sfuggirà." + LONG,
  ];
  for (const narration of narrations) {
    const quote = narration.split(":")[1].split(",")[0].trim();
    const turn = await spendTurn(curse(), narration, [{ kind: "cast", caster: vesper.id, spell: "Bane", spent: "s1", quote }]);
    assert.equal(turn.served, 2, "a correction call was made");
    assert.match(turn.read, /^Spent refs: "s1" for Hexblade's Curse \(Vesper\)$/m, "the reader was not told what Vesper spent");
    assert.equal(turn.message?.content, narration);
  }
});

await test("A leveled spell narrated beside the curse, tied to nothing spent, is still a spell nothing paid for.", async () => {
  const narration = "A black mark blooms on the cleric's tunic as Vesper's curse takes him. Then Vesper raises a hand and casts Hold Person, and the cleric locks rigid." + LONG;
  const rewrite = "A black mark blooms on the cleric's tunic as Vesper's curse takes him, and the cleric staggers back from the warlock with a hiss, clutching his holy symbol." + LONG;
  const turn = await spendTurn(
    curse(),
    narration,
    [
      { kind: "cast", caster: vesper.id, spell: "Bane", spent: "s1", quote: "A black mark blooms on the cleric's tunic" },
      { kind: "cast", caster: vesper.id, spell: "Hold Person", quote: "Vesper raises a hand and casts Hold Person" },
    ],
    rewrite,
  );
  assert.equal(turn.served, 3, "no correction call was made");
  const correction = String(model.requests[2]?.messages.at(-1)?.content ?? "");
  assert.match(correction, /Hold Person/);
  assert.doesNotMatch(correction, /bane/);
  assert.equal(turn.message?.content, rewrite);
});

await test("A potion drunk through use_item, read as Cure Wounds and tied to that spend, is no spell nothing paid for.", async () => {
  const narration = "Vesper drains the red vial in one swallow, and the gash along her ribs knits closed under a warm glow." + LONG;
  const turn = await spendTurn(
    call("use_item", { characterId: vesper.id, item: "Potion of Healing" }),
    narration,
    [{ kind: "cast", caster: vesper.id, spell: "Cure Wounds", spent: "s1", quote: "the gash along her ribs knits closed" }],
  );
  assert.equal(turn.served, 2, "a correction call was made");
  assert.match(turn.read, /^Spent refs: "s1" for Potion of Healing \(Vesper\)$/m);
  assert.equal(turn.message?.content, narration);
});

model.close();
world.close();
finish();
