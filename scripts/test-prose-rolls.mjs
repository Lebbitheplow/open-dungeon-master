// Prose roll asks: a narration that asks for dice in words ("Avery, make an
// Investigation check, DC 15"), in any language, is read by the claims
// reader (src/lib/dm/claims.ts) into roll_ask claims, which become synthetic
// request_roll calls with the asking sentence stripped from the narration.
// Each case gives the claims a reader returns for its text.
import assert from "node:assert/strict";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { rollAsksFromClaims } = await import("../src/lib/dm/rolls.ts");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const avery = { id: "c-avery", name: "Avery" };
const brom = { id: "c-brom", name: "Brom" };

function args(result, index = 0) {
  return JSON.parse(result.calls[index].rawArguments);
}

const ask = (fields) => ({ kind: "roll_ask", ...fields });

test("the exact live failure: bold skill check with DC", () => {
  const text =
    "Avery approaches, wiping dust off the casing. It's going to take some work.\n\n**Avery, make an Intelligence (Investigation) check, DC 15.**";
  const result = rollAsksFromClaims(
    text,
    [ask({ character: "c-avery", check: "skill", skill: "investigation", dc: 15, quote: "Avery, make an Intelligence (Investigation) check, DC 15." })],
    [avery, brom],
  );
  assert.equal(result.calls.length, 1);
  assert.deepEqual(args(result), { kind: "skill_check", characterId: "c-avery", skill: "investigation", dc: 15 });
  assert.ok(!result.text.includes("check"), result.text);
  assert.ok(!result.text.includes("**"), result.text);
  assert.ok(result.text.includes("wiping dust"), result.text);
});

test("the same ask written in Italian becomes the same call", () => {
  const text = "Avery si avvicina al meccanismo. **Avery, fai una prova di Intelligenza (Indagare), CD 15.**";
  const result = rollAsksFromClaims(
    text,
    [ask({ character: "c-avery", check: "skill", skill: "investigation", dc: 15, quote: "fai una prova di Intelligenza (Indagare), CD 15" })],
    [avery, brom],
  );
  assert.deepEqual(args(result), { kind: "skill_check", characterId: "c-avery", skill: "investigation", dc: 15 });
  assert.equal(result.text, "Avery si avvicina al meccanismo.");
});

test("a saving throw and a bare ability check carry their ability", () => {
  const save = rollAsksFromClaims(
    "The gas floods the corridor. Brom, make a DC 12 Constitution saving throw!",
    [ask({ character: "c-brom", check: "save", ability: "con", dc: 12, quote: "make a DC 12 Constitution saving throw" })],
    [avery, brom],
  );
  assert.deepEqual(args(save), { kind: "saving_throw", characterId: "c-brom", ability: "con", dc: 12 });
  assert.ok(save.text.includes("gas floods"));
  const bare = rollAsksFromClaims(
    "Avery, make a Strength check, DC 10.",
    [ask({ character: "c-avery", check: "ability", ability: "str", dc: 10, quote: "Avery, make a Strength check, DC 10." })],
    [avery, brom],
  );
  assert.deepEqual(args(bare), { kind: "ability_check", characterId: "c-avery", ability: "str", dc: 10 });
});

test("initiative takes no DC, and a missing DC is left out", () => {
  const initiative = rollAsksFromClaims(
    "Weapons out! Roll initiative, Avery!",
    [ask({ character: "c-avery", check: "initiative", dc: 12, quote: "Roll initiative, Avery!" })],
    [avery, brom],
  );
  assert.deepEqual(args(initiative), { kind: "initiative", characterId: "c-avery" });
  const noDc = rollAsksFromClaims(
    "Avery, give me a Sleight of Hand check.",
    [ask({ character: "c-avery", check: "skill", skill: "sleight_of_hand", quote: "give me a Sleight of Hand check" })],
    [avery, brom],
  );
  assert.deepEqual(args(noDc), { kind: "skill_check", characterId: "c-avery", skill: "sleight_of_hand" });
});

test("two asks in one reply both become calls, and both sentences go", () => {
  const result = rollAsksFromClaims(
    "Avery, make a Dexterity saving throw, DC 14. Brom, make an Athletics check, DC 10.",
    [
      ask({ character: "c-avery", check: "save", ability: "dex", dc: 14, quote: "Avery, make a Dexterity saving throw, DC 14." }),
      ask({ character: "c-brom", check: "skill", skill: "athletics", dc: 10, quote: "Brom, make an Athletics check, DC 10." }),
    ],
    [avery, brom],
  );
  assert.equal(result.calls.length, 2);
  assert.equal(args(result, 0).characterId, "c-avery");
  assert.equal(args(result, 1).characterId, "c-brom");
  assert.equal(result.text, "");
});

test("an ask of everyone rolls for the whole party", () => {
  const result = rollAsksFromClaims(
    "Everyone make a Perception check, DC 13.",
    [ask({ character: "all", check: "skill", skill: "perception", dc: 13, quote: "Everyone make a Perception check, DC 13." })],
    [avery, brom],
  );
  assert.deepEqual(result.calls.map((call) => JSON.parse(call.rawArguments).characterId).sort(), ["c-avery", "c-brom"]);
});

test("claims of other kinds, or none, leave the narration as it is", () => {
  const text = "The guard checks his list and waves you through. He makes a note of your name.";
  assert.deepEqual(rollAsksFromClaims(text, [], [avery]), { text, calls: [] });
  assert.deepEqual(rollAsksFromClaims(text, [{ kind: "fight_start", quote: "waves you through" }], [avery]), { text, calls: [] });
  assert.deepEqual(rollAsksFromClaims("", [], [avery]), { text: "", calls: [] });
});

console.log(`test-prose-rolls: ${passed} passed`);
