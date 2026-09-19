import { probeBackend } from "./lib/provider-capability-probe.mjs";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};
const baseUrl = valueAfter("--url") || process.env.OPENAI_COMPAT_BASE_URL || "";
const model = valueAfter("--model") || process.env.OPENAI_COMPAT_MODEL || "";
const apiKey = valueAfter("--api-key") || process.env.OPENAI_COMPAT_API_KEY || "";
const json = args.includes("--json");

try {
  const result = await probeBackend({ baseUrl, model, apiKey });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`backend: ${result.endpoint}`);
    console.log(`model: ${result.model}`);
    console.log(`streaming: ${result.stages.streaming.ok ? "PASS" : "FAIL"}`);
    console.log(`tool call: ${result.stages.toolCall.ok ? "PASS" : "FAIL"}`);
    console.log(`tool continuation: ${result.stages.toolContinuation.ok ? "PASS" : "FAIL"}`);
    console.log(`overall: ${result.ok ? "PASS" : "FAIL"}`);
  }
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
