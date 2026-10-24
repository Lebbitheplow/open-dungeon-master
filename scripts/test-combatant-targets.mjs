// Every targeting tool reads its target through the one resolver (issue 503,
// Phase 6). A target in a fight is any combatant: an enemy, or a character
// fighting on the other side (src/lib/dm/combatant.ts). A tool that read
// enemies alone would make a companion turned on the party untouchable by
// it, and the hole would show only at the table.
//
// The rule lives in src/lib/dm/combatant-targets.ts: every parameter a tool
// offered in a fight names a target by (target..., second...Id,
// against...Id) is listed there, nothing listed is stale, and every one
// listed as "combatant" is read through resolveCombatant or
// resolveTargetFoe in the handler file it names, which never hands it to
// resolveEnemyRef. A "pending" entry is one not yet read that way: it is
// reported, and the suite fails once it is (drop the pending note then).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openWorld } from "./lib/enforce-world.mjs";
import { suite } from "./lib/enforce-harness.mjs";

const { test, finish } = suite("test-combatant-targets");
const root = path.resolve(import.meta.dirname, "..");
const world = await openWorld({ gameSettings: { ttsEnabled: false } });
const { dmTurnTools } = await import("../src/lib/dm/turn.ts");
const { TARGET_PARAMS, namesATarget } = await import("../src/lib/dm/combatant-targets.ts");

// Every parameter path of every tool offered in a fight, nested ones as
// "targets[].enemyId".
function paramsOf(tool) {
  const fn = tool.function ?? tool;
  const out = [];
  const walk = (props, prefix) => {
    for (const [name, schema] of Object.entries(props ?? {})) {
      const key = `${prefix}${name}`;
      out.push(`${fn.name}.${key}`);
      if (schema?.type === "array" && schema.items?.properties) walk(schema.items.properties, `${key}[].`);
      if (schema?.type === "object" && schema.properties) walk(schema.properties, `${key}.`);
    }
  };
  walk(fn.parameters?.properties, "");
  return out;
}

const offered = new Set(dmTurnTools(world.campaign(), true, true, false).flatMap(paramsOf));

// The handler reads the parameter through the resolver: the file names the
// parameter, calls resolveCombatant or resolveTargetFoe, and never hands the
// parameter to resolveEnemyRef (an actor that is an enemy by nature, as
// enemy_attack's enemyId, may still be read that way).
function resolvesThrough(file, param) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const leaf = param.split(".").pop().replace(/\[\]$/, "");
  const named = new RegExp(`\\b${leaf}\\b`);
  const oldWay = (text.match(/resolveEnemyRef\([^;]*?\)/g) ?? []).some((call) => named.test(call));
  return named.test(text) && /resolve(?:Combatant|TargetFoe)\(/.test(text) && !oldWay;
}

await test("every parameter that names a target in a fight is listed with how it reads one", () => {
  const unlisted = [...offered].filter((param) => namesATarget(param) && !(param in TARGET_PARAMS));
  assert.deepEqual(unlisted, [], "list each in src/lib/dm/combatant-targets.ts");
});

await test("nothing listed is stale: each listed parameter is offered in a fight", () => {
  const stale = Object.keys(TARGET_PARAMS).filter((param) => !offered.has(param));
  assert.deepEqual(stale, []);
});

await test("every combatant target is read through resolveCombatant or resolveTargetFoe in its handler", () => {
  const unread = [];
  const resolvedPending = [];
  for (const [param, rule] of Object.entries(TARGET_PARAMS)) {
    if (rule.kind !== "combatant") {
      continue;
    }
    assert.ok(fs.existsSync(path.join(root, rule.file)), `${param}: ${rule.file} does not exist`);
    const reads = resolvesThrough(rule.file, param);
    if (rule.pending) {
      if (reads) {
        resolvedPending.push(param);
      }
      continue;
    }
    if (!reads) {
      unread.push(`${param} (${rule.file})`);
    }
  }
  assert.deepEqual(unread, [], "these read their target without the resolver");
  assert.deepEqual(resolvedPending, [], "these now read through the resolver: drop their pending note");
});

const pending = Object.entries(TARGET_PARAMS).filter(([, rule]) => rule.kind === "combatant" && rule.pending);
for (const [param, rule] of pending) {
  console.log(`  PENDING ${param}: ${rule.pending}`);
}
world.close();
finish();
