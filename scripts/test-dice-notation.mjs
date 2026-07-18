// The 3D-dice notation mapper must reproduce server rolls exactly.
import assert from "node:assert/strict";
import { rollExpression } from "../src/lib/dice.ts";
import { rollToDiceBoxNotation } from "../src/lib/dice-notation.ts";

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

test("d100 is supported", () => {
  const result = rollExpression("1d100");
  const [notation] = rollToDiceBoxNotation(result);
  assert.match(notation, /^1d100@\d+$/);
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
