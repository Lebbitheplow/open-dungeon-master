// The painted icon set and the library that addresses it. The app computes an
// icon's path from its kind and name instead of loading a manifest, so the one
// thing that must never drift is the slug rule: this walks every icon the
// generator shipped and proves the library finds it.
// See docs/visual-overhaul-plan.md 8b.2.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

register("./lib/register-alias.mjs", import.meta.url);

const { iconSlug, iconPath, familyIconPath, iconCandidates } = await import("../src/lib/icons.ts");
const { slugify } = await import("./icon-set.mjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "public", "assets", "icons");
const UI = path.join(ROOT, "public", "assets", "ui");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
}

const folderBytes = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (sum, entry) => sum + (entry.isDirectory() ? folderBytes(path.join(dir, entry.name)) : statSync(path.join(dir, entry.name)).size),
    0,
  );

test("the library slugs a name exactly as the catalogue does", () => {
  for (const name of ["Fireball", "Tasha's Hideous Laughter", "Melf’s Acid Arrow", "Élan of the Fey", "Potion of Healing (Greater)", "  Bag  of Holding  ", "+1 Longsword", "Reflex Booster II"]) {
    assert.equal(iconSlug(name), slugify(name), name);
  }
});

test("paths are root relative and the fallback chain is own icon, then family", () => {
  assert.equal(iconPath("spell", "Magic Missile"), "/assets/icons/spell/magic-missile.webp");
  assert.equal(familyIconPath("spell-evocation"), "/assets/icons/family/spell-evocation.webp");
  assert.deepEqual(iconCandidates({ kind: "item", key: "Rope, hempen", family: "item-gear" }), [
    "/assets/icons/item/rope-hempen.webp",
    "/assets/icons/family/item-gear.webp",
  ]);
  assert.deepEqual(iconCandidates({ kind: "feat", key: "Alert" }), ["/assets/icons/feat/alert.webp"]);
});

if (existsSync(path.join(ICONS, "manifest.json"))) {
  const manifest = JSON.parse(readFileSync(path.join(ICONS, "manifest.json"), "utf8"));

  test("every shipped icon is where the library looks for it", () => {
    const lost = [];
    for (const icon of manifest.icons) {
      if (iconPath(icon.group, icon.key) !== icon.src) lost.push(`${icon.id}: ${iconPath(icon.group, icon.key)} is not ${icon.src}`);
      else if (!existsSync(path.join(ROOT, "public", icon.src))) lost.push(`${icon.id}: no file at ${icon.src}`);
    }
    assert.deepEqual(lost.slice(0, 8), []);
  });

  test("the fallback families the app names all exist", () => {
    for (const family of ["item-gear", "item-weapon", "item-armor", "item-magic_item", "class-wizard", "class-fighter", "class-netrunner", "spell-evocation", "damage-fire"]) {
      assert.ok(existsSync(path.join(ROOT, "public", familyIconPath(family))), family);
    }
  });

  test("every name-free description belongs to an icon in the set", () => {
    const subjects = JSON.parse(readFileSync(path.join(ROOT, "scripts", "icon-subjects.json"), "utf8")).subjects;
    const ids = new Set(manifest.icons.map((icon) => icon.id));
    assert.deepEqual(Object.keys(subjects).filter((id) => !ids.has(id)), []);
  });

  test("the icon set and the UI furniture fit the budgets the apps carry them under", () => {
    assert.ok(folderBytes(ICONS) <= 12 * 1024 * 1024, `icons are ${(folderBytes(ICONS) / 1048576).toFixed(1)} MB`);
    if (existsSync(UI)) assert.ok(folderBytes(UI) <= 3 * 1024 * 1024, `ui is ${(folderBytes(UI) / 1048576).toFixed(1)} MB`);
  });
}

console.log(`icons: ${passed} checks passed`);
