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
  describeEndpoint,
  endpointKind,
  filterForProvider,
  isDefaultOnly,
  profileById,
  resolveSampling,
  unsupportedParamFromError,
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

// --- Endpoint capabilities -------------------------------------------------
// The reason these exist: the payload ODM grew around llama.cpp with a Qwen
// preset is exactly the payload OpenAI answers 400 for.

check("the shipped llama.cpp default is classified local", () => {
  assert.equal(endpointKind("http://127.0.0.1:8001/v1"), "local");
  assert.equal(endpointKind("http://localhost:11434/v1"), "local");
  assert.equal(endpointKind("http://host.docker.internal:8001/v1"), "local");
  assert.equal(endpointKind("https://llama.lebbi.org/v1"), "local");
});

check("vendor hosts are recognised", () => {
  assert.equal(endpointKind("https://api.openai.com/v1"), "openai");
  assert.equal(endpointKind("https://openrouter.ai/api/v1"), "openrouter");
});

check("a vendor name in the path or a suffixed host is not that vendor", () => {
  // Whole-host comparison, so neither of these may be treated as a vendor.
  assert.equal(endpointKind("http://evil.test/v1?upstream=api.openai.com"), "local");
  assert.equal(endpointKind("https://api.openai.com.evil.test/v1"), "local");
  assert.equal(endpointKind("https://openrouter.ai.evil.test/v1"), "local");
});

check("local caps reproduce ODM's pre-existing hardcoded payload", () => {
  // The regression guard for the default install. Every field here is what
  // model-client.ts sent before endpoint capabilities existed, so a change
  // to this assertion is a change to what llama-server receives.
  assert.deepEqual(describeEndpoint("http://127.0.0.1:8001/v1"), {
    kind: "local",
    allowLocalOnlySamplers: true,
    allowTemplateKwargs: true,
    maxTokensField: "max_tokens",
    sendZeroPresencePenalty: true,
  });
});

check("OpenRouter caps are unchanged from the old !isOpenRouter behaviour", () => {
  const caps = describeEndpoint("https://openrouter.ai/api/v1");
  assert.equal(caps.allowLocalOnlySamplers, false, "was already stripped");
  assert.equal(caps.allowTemplateKwargs, true, "was already sent");
  assert.equal(caps.maxTokensField, "max_tokens");
  assert.equal(caps.sendZeroPresencePenalty, true);
});

check("OpenAI gets the strict payload", () => {
  const caps = describeEndpoint("https://api.openai.com/v1");
  assert.equal(caps.allowLocalOnlySamplers, false, "400s on top_k/min_p");
  assert.equal(caps.allowTemplateKwargs, false, "400s on chat_template_kwargs");
  assert.equal(caps.maxTokensField, "max_completion_tokens", "reasoning models dropped max_tokens");
  assert.equal(caps.sendZeroPresencePenalty, false, "0 is already the default there");
});

check("an unset base URL does not crash the classifier", () => {
  assert.equal(endpointKind(""), "local");
  assert.equal(endpointKind("not a url"), "local");
});

// --- Unsupported-parameter retry -------------------------------------------

check("OpenAI's error.param is read", () => {
  const body = JSON.stringify({
    error: {
      message: "Unsupported parameter: 'temperature' is not supported with this model.",
      type: "invalid_request_error",
      param: "temperature",
      code: "unsupported_parameter",
    },
  });
  assert.equal(unsupportedParamFromError(body), "temperature");
});

check("an unrecognised argument is read out of the message when param is null", () => {
  const body = JSON.stringify({
    error: {
      message: "Unrecognized request argument supplied: chat_template_kwargs",
      type: "invalid_request_error",
      param: null,
      code: null,
    },
  });
  assert.equal(unsupportedParamFromError(body), "chat_template_kwargs");
});

check("unsupported_value on a reasoning model is read", () => {
  const body = JSON.stringify({
    error: {
      message:
        "Unsupported value: 'temperature' does not support 0.9 with this model. Only the default (1) value is supported.",
      param: "temperature",
      code: "unsupported_value",
    },
  });
  assert.equal(unsupportedParamFromError(body), "temperature");
});

check("max_tokens is droppable so the retry can promote it", () => {
  const body = JSON.stringify({
    error: {
      message:
        "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
      param: "max_tokens",
    },
  });
  assert.equal(unsupportedParamFromError(body), "max_tokens");
});

check("tools stay with the retry-without-tools path, not the param drop", () => {
  // "not supported" here must fall through to the tool retry in
  // model-client.ts, which drops the whole tool array rather than one field.
  const body = JSON.stringify({
    error: { message: "Unsupported parameter: 'tool_choice' is not supported.", param: "tool_choice" },
  });
  assert.equal(unsupportedParamFromError(body), null);
  assert.equal(
    unsupportedParamFromError('{"error":{"message":"tools are not supported","param":"tools"}}'),
    null,
  );
});

check("the request's own load-bearing fields are never dropped", () => {
  assert.equal(unsupportedParamFromError('{"error":{"param":"model"}}'), null);
  assert.equal(unsupportedParamFromError('{"error":{"param":"messages"}}'), null);
});

check("junk bodies yield nothing to drop", () => {
  assert.equal(unsupportedParamFromError(""), null);
  assert.equal(unsupportedParamFromError("<html>502 Bad Gateway</html>"), null);
  assert.equal(unsupportedParamFromError("rate limit exceeded"), null);
});

console.log(`sampling: ${passed} tests passed`);
