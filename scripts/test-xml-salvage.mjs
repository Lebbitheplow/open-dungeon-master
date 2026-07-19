// XML tool-call salvage: the model's native <tool_call><function=...>
// dialect leaked as text (llama-server extraction miss) becomes synthetic
// calls, and every tag is stripped from narration and speech.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { salvageXmlToolCalls } = await import("../src/lib/dm/rolls.ts");
const { stripToolText } = await import("../src/lib/dm/tool-text.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

function args(result, index = 0) {
  return JSON.parse(result.calls[index].rawArguments);
}

// The exact leak observed live during combat testing.
const LIVE_LEAK = `<tool_call>
<function=enemy_attack>
<parameter=enemyId>
fc44185a-24e9-4b0f-8ab4-82b23e858f03
</parameter>
<parameter=targetCharacterId>
c7badbb8-4ebf-443e-a626-d8a63663584f
</parameter>
<parameter=advantage>
none
</parameter>
</function>
</tool_call>`;

test("the exact live leak becomes an enemy_attack call", () => {
  const result = salvageXmlToolCalls(LIVE_LEAK);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "enemy_attack");
  assert.deepEqual(args(result), {
    enemyId: "fc44185a-24e9-4b0f-8ab4-82b23e858f03",
    targetCharacterId: "c7badbb8-4ebf-443e-a626-d8a63663584f",
    advantage: "none",
  });
  assert.equal(result.text, "");
});

test("leak mid-narration preserves surrounding prose", () => {
  const result = salvageXmlToolCalls(
    `The drone pivots toward Avery, targeting lasers converging.\n\n${LIVE_LEAK}\n\nThe alley falls silent.`,
  );
  assert.equal(result.calls.length, 1);
  assert.ok(result.text.includes("targeting lasers"));
  assert.ok(result.text.includes("falls silent"));
  assert.ok(!result.text.includes("<"), result.text);
});

test("JSON dialect inside tool_call", () => {
  const result = salvageXmlToolCalls(
    '<tool_call>\n{"name": "damage_enemy", "arguments": {"enemyId": "e1", "amount": 12, "type": "fire"}}\n</tool_call>',
  );
  assert.equal(result.calls[0].name, "damage_enemy");
  assert.deepEqual(args(result), { enemyId: "e1", amount: 12, type: "fire" });
});

test("value coercion: ints, booleans, JSON arrays", () => {
  const result = salvageXmlToolCalls(
    `<tool_call><function=start_encounter><parameter=enemies>[{"monster":"goblin","count":3}]</parameter><parameter=summary>Ambush</parameter></function></tool_call>`,
  );
  const parsed = args(result);
  assert.deepEqual(parsed.enemies, [{ monster: "goblin", count: 3 }]);
  assert.equal(parsed.summary, "Ambush");

  const nums = salvageXmlToolCalls(
    `<tool_call><function=damage_enemy><parameter=enemyId>e1</parameter><parameter=amount>15</parameter></function></tool_call>`,
  );
  assert.equal(args(nums).amount, 15);
});

test("multiple blocks in one reply", () => {
  const result = salvageXmlToolCalls(
    `<tool_call><function=damage_enemy><parameter=enemyId>e1</parameter><parameter=amount>8</parameter></function></tool_call>\nBetween attacks.\n<tool_call><function=enemy_attack><parameter=enemyId>e2</parameter><parameter=targetCharacterId>c1</parameter></function></tool_call>`,
  );
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].name, "damage_enemy");
  assert.equal(result.calls[1].name, "enemy_attack");
  assert.equal(result.text, "Between attacks.");
});

test("bare function block without tool_call wrapper", () => {
  const result = salvageXmlToolCalls(
    `<function=move_token><parameter=name>Cyber-Mastiff 1</parameter><parameter=x>4</parameter><parameter=y>7</parameter></function>`,
  );
  assert.equal(result.calls[0].name, "move_token");
  assert.deepEqual(args(result), { name: "Cyber-Mastiff 1", x: 4, y: 7 });
});

test("unknown function name is stripped but not dispatched", () => {
  const result = salvageXmlToolCalls(
    `<tool_call><function=summon_dragon><parameter=size>huge</parameter></function></tool_call>The air stills.`,
  );
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, "The air stills.");
});

test("truncated block still salvages and strips", () => {
  const result = salvageXmlToolCalls(
    `<tool_call>\n<function=damage_enemy>\n<parameter=enemyId>\ne1\n</parameter>\n<parameter=amount>\n9`,
  );
  assert.equal(result.calls.length, 1);
  assert.deepEqual(args(result), { enemyId: "e1", amount: 9 });
  assert.ok(!result.text.includes("<"));
});

test("orphaned tags strip without crashing", () => {
  const result = salvageXmlToolCalls("The blow lands.</tool_call></function></parameter>");
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, "The blow lands.");
});

test("plain narration with angle brackets is untouched", () => {
  const text = "The sign reads <KEEP OUT> in flaking paint.";
  const result = salvageXmlToolCalls(text);
  assert.equal(result.calls.length, 0);
  assert.equal(result.text, text);
});

test("stripToolText removes XML blocks and move_token brackets", () => {
  const stripped = stripToolText(
    `A tense beat. ${LIVE_LEAK} Then chaos. [move_token name=Wolf x=3 y=2]`,
  );
  assert.ok(!stripped.includes("<"));
  assert.ok(!stripped.includes("move_token"));
  assert.ok(stripped.includes("A tense beat."));
  assert.ok(stripped.includes("Then chaos."));
});

console.log(`test-xml-salvage: ${passed} passed`);
