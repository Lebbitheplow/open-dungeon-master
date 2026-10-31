// The 3D-dice notation mapper must reproduce server rolls exactly.
import assert from "node:assert/strict";
import { rollExpression } from "../src/lib/dice.ts";
import { percentileNotation, rollToDiceBoxNotation } from "../src/lib/dice-notation.ts";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

test("simple d20 maps with its rolled value", () => {
  const result = rollExpression("1d20+5");
  const notation = rollToDiceBoxNotation(result);
  assert.equal(notation.length, 1);
  const dice = result.terms.find((term) => term.kind === "dice");
  assert.equal(notation[0], `1d20@${dice.dice[0].value}`);
});

test("fireball 8d6 forces every die", () => {
  const result = rollExpression("8d6");
  const [notation] = rollToDiceBoxNotation(result);
  const dice = result.terms.find((term) => term.kind === "dice");
  assert.equal(notation, `8d6@${dice.dice.map((die) => die.value).join(",")}`);
});

test("advantage 2d20kh1 animates both dice", () => {
  const result = rollExpression("2d20kh1+3");
  const [notation] = rollToDiceBoxNotation(result);
  assert.match(notation, /^2d20@\d+,\d+$/);
});

test("d100 is thrown as a tens die and a d10 together", () => {
  const result = rollExpression("1d100");
  const [notation] = rollToDiceBoxNotation(result);
  assert.match(notation, /^1d100\+1d10@\d+,\d+$/);
});

// The library's d100 faces read 10..90 and 00, so a forced 57 matched no
// face and showed a random tens value (issue 668).
test("a percentile roll lands its tens and ones on faces the dice have", () => {
  const tensFaces = new Set([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  for (let value = 1; value <= 100; value += 1) {
    const [, forced] = percentileNotation([value]).split("@");
    const [tens, ones] = forced.split(",").map(Number);
    assert.ok(tensFaces.has(tens), `tens face for ${value}`);
    assert.ok(ones >= 1 && ones <= 10, `ones face for ${value}`);
    // 00 and 0 together read 100; 00 with a ones die reads the ones alone.
    assert.equal((tens % 100) + (ones % 10) || 100, value, `reads ${value}`);
  }
  assert.equal(percentileNotation([57]), "1d100+1d10@50,7");
  assert.equal(percentileNotation([5]), "1d100+1d10@100,5");
  assert.equal(percentileNotation([40]), "1d100+1d10@40,10");
  assert.equal(percentileNotation([100]), "1d100+1d10@100,10");
  assert.equal(percentileNotation([57, 3]), "2d100+2d10@50,100,7,3");
});

test("multiple terms produce multiple notations", () => {
  const result = rollExpression("1d20+2d6+1");
  const notations = rollToDiceBoxNotation(result);
  assert.equal(notations.length, 2);
});

test("unsupported homebrew sides skip animation", () => {
  const result = rollExpression("1d3");
  assert.equal(rollToDiceBoxNotation(result), null);
});

test("modifier-only rolls skip animation", () => {
  assert.equal(
    rollToDiceBoxNotation({ terms: [{ kind: "modifier", sign: 1, value: 4 }] }),
    null,
  );
});

console.log(`${passed} dice-notation tests passed`);
