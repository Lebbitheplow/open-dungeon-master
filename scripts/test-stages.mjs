// Turn-stage catalogue: default-on resolution, the model-call labelling, and
// catalogue integrity.
import assert from "node:assert/strict";
import {
  STAGES,
  isStageEnabled,
  modelCallStages,
  stageById,
} from "../src/lib/dm/stages.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

check("every stage defaults to on", () => {
  // The catalogue exists so an operator can trade quality for speed
  // deliberately, never to change a running campaign by omission.
  for (const stage of STAGES) {
    assert.equal(isStageEnabled(undefined, stage.id), true, `${stage.id} defaults on`);
    assert.equal(isStageEnabled({}, stage.id), true, `${stage.id} on with empty settings`);
  }
});

check("only an explicit false disables a stage", () => {
  assert.equal(isStageEnabled({ recall: false }, "recall"), false);
  assert.equal(isStageEnabled({ recall: true }, "recall"), true);
  assert.equal(isStageEnabled({ recall: undefined }, "recall"), true);
});

check("disabling one stage leaves the others alone", () => {
  const settings = { compaction: false };
  assert.equal(isStageEnabled(settings, "compaction"), false);
  assert.equal(isStageEnabled(settings, "recall"), true);
  assert.equal(isStageEnabled(settings, "retrieval"), true);
});

check("every stage declares whether it costs a model call", () => {
  for (const stage of STAGES) {
    assert.equal(typeof stage.callsModel, "boolean", `${stage.id} declares its cost`);
  }
});

check("the model-call stages are the ones worth turning off first", () => {
  const ids = modelCallStages().map((stage) => stage.id).sort();
  assert.deepEqual(ids, ["chapterSummary", "compaction"]);
});

check("recall and retrieval are engine work, not model calls", () => {
  // Turning these off buys no GPU time; it only narrows what the DM is told,
  // and the panel should say so rather than implying a speedup.
  assert.equal(stageById("recall").callsModel, false);
  assert.equal(stageById("retrieval").callsModel, false);
});

check("every stage states what breaks when it is off", () => {
  for (const stage of STAGES) {
    assert.ok(stage.label.length > 0, `${stage.id} has a label`);
    assert.ok(stage.description.length > 20, `${stage.id} explains what it does`);
    assert.match(stage.cost, /^Off, /, `${stage.id} states the cost of disabling it`);
  }
});

check("stage ids are unique", () => {
  const ids = STAGES.map((stage) => stage.id);
  assert.equal(new Set(ids).size, ids.length);
});

check("an unknown id resolves to nothing rather than throwing", () => {
  assert.equal(stageById("nope"), undefined);
});

console.log(`stages: ${passed} tests passed`);
