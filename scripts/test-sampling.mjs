// Per-role sampling: backward compatibility above all, then profiles,
// clamping, and the cloud-safe versus local-only split.
import assert from "node:assert/strict";
import {
  CLOUD_SAFE_PARAMS,
  LOCAL_ONLY_PARAMS,
  PROFILES,
  STORY_TEMP_DEFAULT,
  STORY_TEMP_THINKING,
  clampSampling,
  filterForProvider,
  isDefaultOnly,
  profileById,
  resolveSampling,
} from "../src/lib/dm/sampling-logic.ts";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
};

check("an unconfigured install sends exactly what it sends today", () => {
  // The single most important property: this feature must be invisible until
  // an operator opts in.
  const off = resolveSampling({ role: "story", allowLocalOnly: true, thinking: false });
  assert.deepEqual(off, { temperature: STORY_TEMP_DEFAULT });
  const thinking = resolveSampling({ role: "story", allowLocalOnly: true, thinking: true });
  assert.deepEqual(thinking, { temperature: STORY_TEMP_THINKING });
});

check("the thinking-versus-not split is preserved, not flattened", () => {
  assert.notEqual(STORY_TEMP_THINKING, STORY_TEMP_DEFAULT);
  const a = resolveSampling({ role: "story", allowLocalOnly: false, thinking: true });
  const b = resolveSampling({ role: "story", allowLocalOnly: false, thinking: false });
  assert.notEqual(a.temperature, b.temperature);
});

check("the utility role gets no invented default", () => {
  // model-client only special-cases the story temperature; utility keeps
  // whatever the call site already passes.
  assert.deepEqual(resolveSampling({ role: "utility", allowLocalOnly: true }), {});
});

check("the default profile contributes nothing at all", () => {
  const profile = profileById("default");
  assert.equal(profile.story, undefined);
  assert.equal(profile.utility, undefined);
  const resolved = resolveSampling({ role: "story", profile, allowLocalOnly: true });
  assert.deepEqual(resolved, { temperature: STORY_TEMP_DEFAULT }, "still just the built-in");
});

check("a profile supplies per-role values", () => {
  const creative = profileById("creative");
  const story = resolveSampling({ role: "story", profile: creative, allowLocalOnly: true });
  const utility = resolveSampling({ role: "utility", profile: creative, allowLocalOnly: true });
  assert.equal(story.temperature, 1.0);
  assert.equal(utility.temperature, 0.3, "mechanical work stays tight even on Creative");
});

check("an explicit override beats the profile", () => {
  const resolved = resolveSampling({
    role: "story",
    profile: profileById("precise"),
    configured: { temperature: 1.2 },
    allowLocalOnly: true,
  });
  assert.equal(resolved.temperature, 1.2);
});

check("presence_penalty is not offered by any profile", () => {
  // It is pinned to 0 in model-client for a measured reason: a positive
  // penalty over the long DM prompt suppresses the tool-call sequence. If it
  // ever appears here, dice rolling can be broken from a settings screen.
  for (const profile of PROFILES) {
    for (const role of ["story", "utility"]) {
      const config = profile[role] ?? {};
      assert.equal(
        Object.prototype.hasOwnProperty.call(config, "presence_penalty"),
        false,
        `${profile.id}.${role} must not set presence_penalty`,
      );
    }
  }
  const resolved = resolveSampling({
    role: "story",
    configured: { presence_penalty: 1.5 },
    allowLocalOnly: true,
  });
  assert.equal(resolved.presence_penalty, undefined, "and it cannot be smuggled in");
});

check("local-only parameters never reach a cloud endpoint", () => {
  const config = { temperature: 0.8, top_k: 20, min_p: 0.05, repeat_penalty: 1.1 };
  const cloud = filterForProvider(config, false);
  assert.deepEqual(Object.keys(cloud).sort(), ["temperature"]);
  const local = filterForProvider(config, true);
  for (const key of LOCAL_ONLY_PARAMS) {
    assert.ok(key in local, `${key} survives locally`);
  }
});

check("cloud-safe parameters ride everywhere", () => {
  const config = { temperature: 0.8, top_p: 0.9 };
  for (const key of CLOUD_SAFE_PARAMS) {
    assert.ok(key in filterForProvider(config, false), `${key} is cloud safe`);
  }
});

check("out-of-range values are clamped, not sent", () => {
  const clamped = clampSampling({ temperature: 50, top_p: -1, top_k: 9999 });
  assert.equal(clamped.temperature, 2);
  assert.equal(clamped.top_p, 0);
  assert.equal(clamped.top_k, 200);
});

check("junk is dropped rather than forwarded", () => {
  const clamped = clampSampling({ temperature: Number.NaN, top_p: undefined });
  assert.deepEqual(clamped, {});
});

check("isDefaultOnly recognises an untouched config", () => {
  assert.equal(isDefaultOnly(undefined), true);
  assert.equal(isDefaultOnly({}), true);
  assert.equal(isDefaultOnly({ temperature: Number.NaN }), true, "junk is not configuration");
  assert.equal(isDefaultOnly({ temperature: 0.5 }), false);
});

check("every profile has a label and a real description", () => {
  const ids = PROFILES.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const profile of PROFILES) {
    assert.ok(profile.label.length > 0);
    assert.ok(profile.description.length > 30, `${profile.id} explains itself`);
  }
});

console.log(`sampling: ${passed} tests passed`);
