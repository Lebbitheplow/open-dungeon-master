// Issue 282: the WorldForge wiki's entry list, a capped flex column that
// scrolls, squeezed forty entries into slivers drawn over one another.
// motion-press hides overflow, and a flex item that hides overflow has no
// automatic minimum height, so the rows shrank instead of the list
// scrolling. The row says shrink-0, and the stylesheet says the same for
// every listbox option and menu item, so no other scrolling column of
// pressable rows can do it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

// The wiki's list is drawn by EntryList (#479: only the rows in view of a
// big world).
const list = read("src/app/workshop/world/EntryList.tsx");
const css = read("src/app/globals.css");

// The list is still a capped, scrolling flex column (the shape that shrinks).
assert.match(list, /className="flex max-h-\[60vh\] flex-col[^"]*overflow-y-auto[^"]*"\s+role="listbox"\s+aria-label="Entries"/);
// Each row is a pressable option that refuses to shrink.
const row = list.match(/role="option"[\s\S]*?className=\{cn\(\s*"([^"]+)"/);
assert.ok(row, "the entry row's class list");
assert.match(row[1], /\bmotion-press\b/, "the row presses (overflow hidden)");
assert.match(row[1], /\bshrink-0\b/, "the row keeps its height");

// The stylesheet's guard: every listbox option and menu item keeps its
// height, inside the components layer with the rest of the row motion.
const guard = css.match(/\[role="menu"\] > \[role\^="menuitem"\],\s*\[role="listbox"\] > \[role="option"\] \{\s*flex-shrink: 0;\s*\}/);
assert.ok(guard, "listbox options and menu items say flex-shrink: 0");
const layerStart = css.lastIndexOf("@layer components", guard.index);
assert.ok(layerStart !== -1 && !/@layer (base|utilities)/.test(css.slice(layerStart, guard.index)), "the guard sits in the components layer");
// motion-press is the reason: the rule is still there and still hides overflow.
assert.match(css, /\.motion-press \{\s*position: relative;\s*overflow: hidden;/);

console.log("ok: listbox options and menu items keep their height in a scrolling column (issue 282)");
