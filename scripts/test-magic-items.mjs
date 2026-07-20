// The magic-item effects table: that magic-items.json is current with the
// content pack, and that worn/attuned items grant their mechanics.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);
const { matchMagicItem, magicItemRiders, effectiveAbilities } = await import(
  "../src/lib/srd/magic-items.ts"
);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const items = JSON.parse(
  readFileSync(join(root, "src", "lib", "classes", "magic-items.json"), "utf8"),
).items;

const baseAbilities = { str: 10, dex: 14, con: 12, int: 8, wis: 13, cha: 10 };
const attuned = (name) => [{ name, attuned: true }];

test("magic-items.json is not stale against the content pack", () => {
  // Only meaningful when the content DB is present (CI without it skips).
  if (!existsSync(join(root, "data", "content", "open5e.sqlite"))) {
    return;
  }
  const result = spawnSync(
    process.execPath,
    [join(here, "generate-magic-items.mjs"), "--check"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the generated table has a real body of items", () => {
  assert.ok(items.length > 50, `only ${items.length} magic items`);
});

test("a flat-AC item grants its bonus only while attuned", () => {
  const cloak = "Cloak of Protection";
  assert.equal(matchMagicItem(cloak)?.requiresAttunement, true);
  // Attuned: +1 AC, +1 saves.
  const on = magicItemRiders(attuned(cloak));
  assert.equal(on.acBonus, 1);
  assert.equal(on.saveBonus, 1);
  // Carried but not attuned: nothing.
  const off = magicItemRiders([{ name: cloak }]);
  assert.equal(off.acBonus, 0);
  assert.equal(off.saveBonus, 0);
});

test("Bracers of Defense are an unarmored bonus, kept separate", () => {
  const riders = magicItemRiders(attuned("Bracers of Defense"));
  assert.equal(riders.acUnarmoredBonus, 2);
  assert.equal(riders.acBonus, 0);
});

test("an ability-setting item raises the score, never lowers it", () => {
  // Gauntlets set STR to 19.
  const raised = effectiveAbilities(baseAbilities, attuned("Gauntlets of Ogre Power"));
  assert.equal(raised.str, 19);
  assert.equal(raised.dex, 14);
  // A character already stronger keeps their score.
  const strong = effectiveAbilities({ ...baseAbilities, str: 20 }, attuned("Gauntlets of Ogre Power"));
  assert.equal(strong.str, 20);
  // Unattuned: no change.
  assert.deepEqual(effectiveAbilities(baseAbilities, [{ name: "Gauntlets of Ogre Power" }]), baseAbilities);
});

test("resistances come off worn items and dedupe", () => {
  const resistItem = items.find((item) => item.effects.some((e) => e.kind === "resistance"));
  const riders = magicItemRiders([{ name: resistItem.name, attuned: true }]);
  assert.ok(riders.resistances.length >= 1);
  // The same item twice does not double the list.
  const twice = magicItemRiders([
    { name: resistItem.name, attuned: true },
    { name: resistItem.name, attuned: true },
  ]);
  assert.deepEqual(new Set(twice.resistances), new Set(riders.resistances));
});

test("a non-attunement item works just by being carried", () => {
  const free = items.find((item) => !item.requiresAttunement);
  if (!free) {
    return;
  }
  const riders = magicItemRiders([{ name: free.name }]);
  assert.ok(riders.sources.includes(free.name));
});

test("every generated item is well formed", () => {
  const names = new Set();
  for (const item of items) {
    assert.ok(item.name.length > 0);
    assert.equal(item.match, item.name.toLowerCase());
    assert.equal(names.has(item.match), false, `duplicate ${item.match}`);
    names.add(item.match);
    assert.ok(item.effects.length > 0, item.name);
    assert.equal(typeof item.requiresAttunement, "boolean", item.name);
  }
});

test("name matching tolerates a magic prefix and extra words", () => {
  assert.equal(matchMagicItem("+1 Cloak of Protection")?.name, "Cloak of Protection");
  assert.equal(matchMagicItem("a mundane rope"), null);
});

console.log(`test-magic-items: ${passed} passed`);
