// Builds the map art preview page on the NAS: every skin on the same room,
// three maps straight from the generator, fog and light demos, every surface
// with its seam score, every object and decal on a sheet, and the honest list
// of what is not done. Sign-off on this page is the gate before anything in
// src/ changes (docs/visual-overhaul-plan.md, section 3.9).
//
//   node scripts/build-map-preview.mjs                 -> /NAS/odm-map-preview.html
//   node scripts/build-map-preview.mjs out.html --seed 7
//
// Everything the page needs is embedded as data URIs so it opens from a file
// share in any browser without a server and without tainting the canvas.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { register } from "node:module";
import path from "node:path";
import { TILES, CATEGORIES } from "./tile-set.mjs";
import { SKINS } from "../src/lib/battlemap/skins.ts";
import { oldGrid } from "./map-preview/oldart.mjs";

register("./lib/register-alias.mjs", import.meta.url);
const { generateBattleMap } = await import("../src/lib/battlemap/generate.ts");

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) || "/NAS/odm-map-preview.html";
const seedArg = args.indexOf("--seed");
const SEED = seedArg >= 0 ? Number(args[seedArg + 1]) : Number(new Date().toISOString().slice(0, 10).replace(/-/g, ""));
// The app's own renderer, inlined: an ES module there, a page global here.
const RENDERER = `(function () {\n${readFileSync(path.join(import.meta.dirname, "..", "src", "lib", "battlemap", "render", "renderer.js"), "utf8").replace("export { ODMRender };", "window.ODMRender = ODMRender;")}\n})();`;

const tileManifest = JSON.parse(readFileSync(path.join(ROOT, "public", "assets", "tiles", "manifest.json"), "utf8"));
const propManifestPath = path.join(ROOT, "public", "assets", "props", "manifest.json");
const propManifest = existsSync(propManifestPath) ? JSON.parse(readFileSync(propManifestPath, "utf8")) : { objects: [], decals: [] };
const tileById = new Map(tileManifest.tiles.map((t) => [t.id, t]));

const dataUri = (rel) => {
  const file = path.join(ROOT, "public", rel);
  return existsSync(file) ? `data:image/webp;base64,${readFileSync(file).toString("base64")}` : null;
};
// The sheets show hundreds of swatches; a 112px thumbnail keeps the page
// under 20 MB where the full files would push it past 50.
const thumbUri = (rel, px = 112) => {
  const file = path.join(ROOT, "public", rel);
  if (!existsSync(file)) return null;
  const buf = execFileSync("magick", [file, "-resize", `${px}x${px}`, "-quality", "78", "webp:-"], { maxBuffer: 1 << 22 });
  return `data:image/webp;base64,${buf.toString("base64")}`;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---- the seam metric ----
// Mean absolute difference between the first and last column (the wrap join)
// divided by the mean difference between adjacent interior column pairs.
// 1.0 means the join is like any other column pair. Same for rows.
function seamScore(file) {
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", file]).toString().trim().split(" ").map(Number);
  const raw = execFileSync("magick", [file, "-colorspace", "Gray", "-depth", "8", "gray:-"], { maxBuffer: 1 << 24 });
  const px = (x, y) => raw[y * w + x];
  // Two comparisons. Against adjacent interior columns (1.0 = seamless), and
  // against interior columns six pixels apart: a grain texture has near
  // identical neighbours, so the join is measured the way the eye reads it,
  // as a small shift. A surface passes if either reads under its limit.
  const GAP = 6;
  let wrapC = 0, intC = 0, farC = 0, wrapR = 0, intR = 0, farR = 0, nC = 0, nR = 0;
  for (let y = 0; y < h; y++) {
    wrapC += Math.abs(px(0, y) - px(w - 1, y));
    for (let x = GAP; x < w; x += 23) {
      intC += Math.abs(px(x, y) - px(x - 1, y));
      farC += Math.abs(px(x, y) - px(x - GAP, y));
      nC += 1;
    }
  }
  for (let x = 0; x < w; x++) {
    wrapR += Math.abs(px(x, 0) - px(x, h - 1));
    for (let y = GAP; y < h; y += 23) {
      intR += Math.abs(px(x, y) - px(x, y - 1));
      farR += Math.abs(px(x, y) - px(x, y - GAP));
      nR += 1;
    }
  }
  const cols = (wrapC / h) / (intC / nC), rows = (wrapR / w) / (intR / nR);
  const colsFar = (wrapC / h) / (farC / nC), rowsFar = (wrapR / w) / (farR / nR);
  return { cols: +cols.toFixed(2), rows: +rows.toFixed(2), colsFar: +colsFar.toFixed(2), rowsFar: +rowsFar.toFixed(2) };
}
// A join fails only when both readings say so.
const seamFails = (s) => (s.cols > 1.6 && s.colsFar > 1.15) || (s.rows > 1.6 && s.rowsFar > 1.15);

// ---- what the page shows ----
const ROOM = [
  "####################",
  "#........#,,,,,,,,,#",
  "#........+,,,,,,,,,#",
  "#........#,,,,,,,,,#",
  "#..####..#####|#####",
  "#..#......#........#",
  "#..#......#..~~~~..#",
  "####+######..~~~~..#",
  "#..........,,~~~~..#",
  "#..||||....,,~~~~..#",
  "#..........,,......#",
  "#........###########",
  "#........#.........#",
  "####################",
];
const ROOM_LIGHTS = [{ x: 4, y: 2, brightRadius: 3, dimRadius: 6 }, { x: 14, y: 9, brightRadius: 4, dimRadius: 8 }];
const ROOM_PROPS = [{ x: 5, y: 12, id: "table-long", rot: 0 }, { x: 2, y: 5, id: "rug", rot: Math.PI / 2 }, { x: 16, y: 5, id: "altar", rot: 0 }];

const skinsPresent = SKINS.filter((skin) => Object.values(skin.bind).every((id) => tileById.has(id)) && (!skin.patch || tileById.has(skin.patch.id)));
const skinsMissing = SKINS.filter((s) => !skinsPresent.includes(s)).map((s) => ({
  skin: s,
  missing: [...Object.values(s.bind), ...(s.patch ? [s.patch.id] : [])].filter((id) => !tileById.has(id)),
}));
const skinByTheme = Object.fromEntries(skinsPresent.filter((s) => s.theme).map((s) => [s.theme, s]));

// Three maps straight from the generator, so the layouts are not hand-picked.
const GENERATED = [
  { hint: "a torchlit crypt beneath the chapel", pcCount: 4, enemyCount: 4 },
  { hint: "a cave, pitch-black, with rubble", pcCount: 4, enemyCount: 5 },
  { hint: "a sunny meadow by the river", pcCount: 4, enemyCount: 4 },
].map((input, i) => {
  const map = generateBattleMap({ seed: SEED + i * 101, width: 20, height: 14, ...input });
  const rows = [];
  for (let y = 0; y < map.height; y++) rows.push(map.terrain.slice(y * map.width, (y + 1) * map.width));
  const skin = skinByTheme[map.theme] || skinsPresent[0];
  return { ...input, rows, theme: map.theme, ambient: map.ambient, lights: map.lights, seed: SEED + i * 101, skinId: skin?.id, pcSpawns: map.pcSpawns, enemySpawns: map.enemySpawns };
});

// Fog demo: the crypt with the east third unexplored and a band remembered but unseen.
const fogMap = GENERATED[0];
const unexplored = [], unseen = [];
for (let y = 0; y < fogMap.rows.length; y++) {
  for (let x = 0; x < fogMap.rows[0].length; x++) {
    if (x >= 13) unexplored.push(`${x},${y}`);
    else if (x >= 9) unseen.push(`${x},${y}`);
  }
}

// ---- assets to embed ----
const tileUris = {};
function needTile(id) {
  const t = tileById.get(id);
  if (!t || tileUris[id]) return;
  tileUris[id] = (t.variants || [t.src]).map(dataUri).filter(Boolean);
}
for (const skin of skinsPresent) {
  for (const id of Object.values(skin.bind)) needTile(id);
  if (skin.patch) needTile(skin.patch.id);
}
const objectUris = {};
for (const o of propManifest.objects) {
  const used = skinsPresent.some((s) => o.sets.some((set) => s.sets.includes(set))) || ROOM_PROPS.some((p) => p.id === o.id);
  if (used) objectUris[o.id] = dataUri(o.src);
}
const decalUris = {};
for (const d of propManifest.decals) decalUris[d.id] = dataUri(d.src);

// Every object and decal on a sheet (all of them, whether or not a skin uses them).
const sheetObjects = propManifest.objects.map((o) => ({ ...o, uri: thumbUri(o.src, 128) }));
const sheetDecals = propManifest.decals.map((d) => ({ ...d, uri: thumbUri(d.src, 256) }));

// Every surface with its seam score (measured on the shipped 256px file).
const surfaces = tileManifest.tiles.filter((t) => t.seamless).map((t) => {
  const variants = (t.variants || [t.src]).map((src) => ({ src, uri: thumbUri(src), score: seamScore(path.join(ROOT, "public", src)) }));
  return { ...t, variantFiles: variants };
});
const fittings = tileManifest.tiles.filter((t) => !t.seamless).map((t) => ({ ...t, uri: thumbUri(t.src) }));
const worst = surfaces.flatMap((t) => t.variantFiles.map((v) => ({ id: t.id, src: v.src, ...v.score }))).filter((v) => seamFails(v));

// Honest progress while the GPU runs are still filling the set.
const { OBJECT_LIST } = await import("./prop-set.mjs");
const { DECAL_LIST } = await import("./decal-set.mjs");
const progress = {
  objects: [propManifest.objects.length, OBJECT_LIST.length],
  decals: [propManifest.decals.length, DECAL_LIST.length],
  fluxTiles: [tileManifest.tiles.filter((t) => t.paint === "flux").length, TILES.length],
  variants: [tileManifest.tiles.filter((t) => (t.variants || []).length >= 3).length, TILES.filter((t) => t.seamless).length],
};
const inProgress = progress.objects[0] < progress.objects[1] || progress.fluxTiles[0] < progress.fluxTiles[1];

const totalTileBytes = tileManifest.tiles.reduce((s, t) => s + (t.bytes || 0), 0);
const totalPropBytes = [...propManifest.objects, ...propManifest.decals].reduce((s, e) => s + (e.bytes || 0), 0);

const grouped = new Map(Object.keys(CATEGORIES).map((k) => [k, []]));
for (const t of surfaces) grouped.get(t.category)?.push(t);

// ---- the art program beyond maps: icons, effect flipbooks, UI furniture ----
const readManifest = (rel) => (existsSync(path.join(ROOT, "public", rel)) ? JSON.parse(readFileSync(path.join(ROOT, "public", rel), "utf8")) : null);
const iconManifest = readManifest("assets/icons/manifest.json");
const fxManifest = readManifest("fx/manifest.json");
const uiManifest = readManifest("assets/ui/manifest.json");
const ICON_GROUP_TITLES = { spell: "Spells", item: "Items", feature: "Class features", option: "Options", feat: "Feats", condition: "Conditions", action: "Actions", glyph: "Glyphs and cues", family: "Fallback families" };
const iconGroups = iconManifest
  ? Object.keys(ICON_GROUP_TITLES)
      .map((group) => ({ group, icons: iconManifest.icons.filter((i) => i.group === group).sort((a, b) => a.label.localeCompare(b.label)).map((i) => ({ ...i, uri: thumbUri(i.src, 72) })) }))
      .filter((g) => g.icons.length)
  : [];
const fxSheets = fxManifest ? fxManifest.sheets.map((f) => ({ ...f, uri: dataUri(f.src) })).filter((f) => f.uri) : [];
const uiParts = uiManifest ? uiManifest.parts.map((u) => ({ ...u, uri: thumbUri(u.src, 200) })).filter((u) => u.uri) : [];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open Dungeon Master: map art preview</title>
<style>
:root { color-scheme: dark; --ink:#e8e3d9; --dim:#9a9387; --line:#2c2925; --bg:#100f0d; --card:#181613; --gold:#d9a84a; }
* { box-sizing:border-box }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.wrap { max-width:1560px; margin:0 auto; padding:40px 28px 96px }
h1 { font-size:34px; margin:0 0 6px; letter-spacing:-.02em }
h2 { font-size:22px; margin:64px 0 6px; padding-bottom:10px; border-bottom:1px solid var(--line) }
h3 { font-size:15px; margin:28px 0 10px; color:var(--gold); text-transform:uppercase; letter-spacing:.09em }
p { max-width:80ch; color:var(--dim); margin:8px 0 }
p strong { color:var(--ink); font-weight:600 }
code { font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:#0b0a09; border:1px solid var(--line); padding:1px 5px; border-radius:4px; color:#c9bfa8 }
.lede { font-size:17px; color:#c2bbae; max-width:84ch }
.bar { position:sticky; top:0; z-index:9; background:#100f0dee; backdrop-filter:blur(8px); border-bottom:1px solid var(--line); padding:11px 28px; display:flex; gap:20px; align-items:center; flex-wrap:wrap }
.bar label { font-size:13px; color:var(--dim); display:flex; gap:7px; align-items:center; cursor:pointer; user-select:none }
.bar b { font-size:13px; color:var(--gold); letter-spacing:.04em }
.bar .status { margin-left:auto; font-size:12px; color:var(--dim) }
.stats { display:flex; flex-wrap:wrap; gap:12px; margin:28px 0 8px }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 18px; min-width:150px }
.stat b { display:block; font-size:26px; color:var(--gold); font-weight:600; letter-spacing:-.02em }
.stat span { font-size:12px; color:var(--dim); text-transform:uppercase; letter-spacing:.07em }
.rooms { display:grid; grid-template-columns:repeat(2,1fr); gap:22px; margin-top:20px }
.rooms.three { grid-template-columns:repeat(3,1fr) }
.panel { background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden }
.panel > figcaption { padding:11px 15px; border-bottom:1px solid var(--line); display:flex; gap:10px; align-items:baseline; flex-wrap:wrap }
.panel figcaption b { font-size:14px; font-weight:600; white-space:nowrap }
.panel figcaption span { font-size:12px; color:var(--dim) }
.tag { margin-left:auto; font-size:10px; letter-spacing:.09em; text-transform:uppercase; padding:3px 8px; border-radius:99px }
.tag.old { background:#2a1d14; color:#c08a4a; border:1px solid #3d2a1a }
.tag.new { background:#16251b; color:#6fbb85; border:1px solid #1f3a28 }
.stage { position:relative; line-height:0; background:#000; min-height:120px }
.stage canvas { width:100%; display:block }
.stage .pending { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); font-size:13px; line-height:1.4 }
.room { display:grid; grid-template-columns:repeat(var(--cols),1fr); line-height:0; background:#000 }
.room .c { display:block; aspect-ratio:1; background-size:100% 100%; background-repeat:no-repeat }
.tiles { display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:13px; margin-top:12px }
.tile .sw { width:100%; aspect-ratio:1; border-radius:8px; overflow:hidden; border:1px solid var(--line); background-size:100% 100%; position:relative }
.tile .sw.rep { background-size:33.333% 33.333%; background-repeat:repeat }
.tile .nm { font-size:11.5px; margin-top:6px; line-height:1.3 }
.tile .th { font-size:10px; color:#7d7668; letter-spacing:.03em }
.tile .sc { font-size:10px; color:#7d7668; font-family:ui-monospace,monospace }
.tile .sc.bad { color:#d98a4a }
.vars { display:flex; gap:4px }
.vars .sw { width:auto; flex:1 }
.objs { display:grid; grid-template-columns:repeat(auto-fill,minmax(112px,1fr)); gap:10px; margin-top:12px }
.obj { text-align:center }
.obj .im { width:100%; aspect-ratio:1; display:grid; place-items:center; background:repeating-conic-gradient(#1d1b18 0 25%,#151311 0 50%) 0 0/16px 16px; border-radius:8px; border:1px solid var(--line) }
.obj .im img { max-width:88%; max-height:88% }
.obj .nm { font-size:10.5px; color:var(--dim); margin-top:4px; line-height:1.25 }
.decals { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:10px; margin-top:12px }
.decal .im { background:#6b6459; border-radius:8px; padding:6px; display:grid; place-items:center; min-height:64px }
.decal .im img { max-width:100%; max-height:120px }
.decal .nm { font-size:10.5px; color:var(--dim); margin-top:4px }
.cat { margin-top:34px }
.cathead { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap }
.cathead h3 { margin:0 }
.cathead .n { font-size:12px; color:var(--dim) }
.note { background:#14130f; border:1px solid var(--line); border-left:2px solid var(--gold); border-radius:0 10px 10px 0; padding:14px 18px; margin-top:20px }
.note p { margin:0; max-width:none }
.note p + p { margin-top:8px }
ul { color:var(--dim); max-width:80ch } li { margin:5px 0 }

.icons { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0 18px; }
.icons img { width: 56px; height: 56px; padding: 4px; border-radius: 50%; background: radial-gradient(circle at 50% 40%, #2b2622, #0d0b0a); border: 1px solid #5d4a2a; }
.fxs, .uis { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 18px; }
.fxc, .uic { width: 136px; font-size: 11px; color: #a39a8c; text-align: center; }
.fx { width: 128px; height: 128px; background-color: #000; background-repeat: no-repeat; border: 1px solid #2a2622; border-radius: 6px; margin: 0 auto 4px; }
.uic { width: 212px; }
.uic .im { height: 204px; display: flex; align-items: center; justify-content: center; background: #1b1815; border: 1px solid #2a2622; border-radius: 6px; margin-bottom: 4px; }
.uic .im img { max-width: 200px; max-height: 200px; }
h3 { font-size: 14px; color: #d9c9a3; margin: 14px 0 4px; }
</style>
</head>
<body>
<div class="bar">
  <b>ODM map art</b>
  <label><input type="checkbox" id="grid"> Grid lines</label>
  <label><input type="checkbox" id="dressing" checked> Dressing</label>
  <label><input type="checkbox" id="decals" checked> Decals</label>
  <label><input type="checkbox" id="lowq"> Low tier (phone)</label>
  <label><input type="checkbox" id="rep"> Repeat every surface 3&times;3 (seam check)</label>
  <span class="status" id="status">loading assets</span>
</div>
<div class="wrap">

<h1>Map art preview, renderer v3</h1>
<p class="lede">Every picture on this page is composed by the renderer from the terrain string, a skin and a seed. No model
touches a map. The assets were made once: surfaces on SDXL for the wrap and repainted by Flux, objects and decals on
Flux, all cut out and encoded by <code>scripts/generate-tiles.mjs</code> and <code>scripts/generate-props.mjs</code>.
Seed for the generated maps: <code>${SEED}</code>. Built ${new Date().toISOString().slice(0, 16).replace("T", " ")}.</p>

<div class="stats">
  <div class="stat"><b>${tileManifest.tiles.length}</b><span>materials and fittings</span></div>
  <div class="stat"><b>${surfaces.reduce((s, t) => s + t.variantFiles.length, 0)}</b><span>surface files</span></div>
  <div class="stat"><b>${propManifest.objects.length}</b><span>objects</span></div>
  <div class="stat"><b>${propManifest.decals.length}</b><span>decals</span></div>
  <div class="stat"><b>${skinsPresent.length}</b><span>skins</span></div>
  <div class="stat"><b>${((totalTileBytes + totalPropBytes) / 1024 / 1024).toFixed(1)} MB</b><span>shipped art</span></div>
</div>

<h2>The same room, every skin</h2>
<p>The identical ${ROOM[0].length}&times;${ROOM.length} terrain string in every skin. Two lights sit where the generator
would put braziers; three placed stamps (a long table, a rug, an altar) show what a DM's own props look like beside the
automatic dressing. The first panel is what the app draws today. Toggle the grid in the bar to see that every boundary
still sits on the squares the rules use.</p>
<div class="rooms">
  <figure class="panel">
    <figcaption><b>Indoors</b><span>today's renderer</span><span class="tag old">old</span></figcaption>
    ${oldGrid(ROOM, "interior")}
  </figure>
  ${skinsPresent.filter((s) => !s.genre).map((skin) => `<figure class="panel">
    <figcaption><b>${esc(skin.name)}</b><span>${esc(skin.note)}</span><span class="tag new">new</span></figcaption>
    <div class="stage" data-stage="room:${skin.id}"><canvas></canvas><div class="pending">queued</div></div>
  </figure>`).join("\n  ")}
</div>
${skinsPresent.some((s) => s.genre) ? `<h2>The other settings</h2>
<p>The same room again in the skins a cyberpunk, steampunk, post-apocalyptic, horror or mystery campaign gets by default.
Same six terrain characters, same rules, a different century.</p>
<div class="rooms">
  ${skinsPresent.filter((s) => s.genre).map((skin) => `<figure class="panel">
    <figcaption><b>${esc(skin.name)}</b><span>${esc(skin.genre)} &middot; ${esc(skin.note)}</span><span class="tag new">new</span></figcaption>
    <div class="stage" data-stage="room:${skin.id}"><canvas></canvas><div class="pending">queued</div></div>
  </figure>`).join("\n  ")}
</div>` : ""}
${skinsMissing.length ? `<p>Skins waiting on materials still rendering: ${skinsMissing.map((m) => `<strong>${esc(m.skin.name)}</strong> (${m.missing.map(esc).join(", ")})`).join("; ")}.</p>` : ""}

<h2>Straight from the generator</h2>
<p>Three maps from <code>generateBattleMap</code> at seed ${SEED}, ${SEED + 101} and ${SEED + 202}, each in its theme's
default skin, with the lights and the ambient light the generator chose. Nothing about the layout was chosen for the
picture.</p>
<div class="rooms three">
  ${GENERATED.map((g, i) => `<figure class="panel">
    <figcaption><b>${esc(g.hint)}</b><span>${esc(g.theme)} &middot; ${esc(g.ambient)} &middot; ${g.lights.length} lights</span><span class="tag new">new</span></figcaption>
    <div class="stage" data-stage="gen:${i}"><canvas></canvas><div class="pending">queued</div></div>
  </figure>`).join("\n  ")}
</div>

<h2>Fog and light</h2>
<p>Left: the crypt with the east third unexplored (opaque, soft edged, dilated so the edge never uncovers a square) and a
band remembered but not in sight (dimmed). Right: the same crypt in the dark with only its lights, plus a dark zone in
the north room and a magical darkness zone in the south room.</p>
<div class="rooms">
  <figure class="panel">
    <figcaption><b>Fog of war</b><span>unexplored and remembered</span><span class="tag new">new</span></figcaption>
    <div class="stage" data-stage="fog"><canvas></canvas><div class="pending">queued</div></div>
  </figure>
  <figure class="panel">
    <figcaption><b>Light and zones</b><span>dark ambient, two braziers, two zones</span><span class="tag new">new</span></figcaption>
    <div class="stage" data-stage="light"><canvas></canvas><div class="pending">queued</div></div>
  </figure>
</div>

<h2>Every surface, with its seam score</h2>
<p>Each material ships in ${surfaces[0]?.variantFiles.length || 1} variant(s); the renderer bombs them together so no
rhythm repeats. The score under each is the wrap join measured against the texture's own interior column pairs,
columns then rows: <strong>1.0 is seamless</strong>, and anything above 1.6 fails the asset test. Tick the seam check
in the bar to see every surface repeated 3&times;3.</p>
${worst.length ? `<div class="note"><p><strong>${worst.length} surface file(s) score above 1.6:</strong> ${worst.map((v) => `<code>${esc(v.src)}</code> (${v.cols} / ${v.rows})`).join(", ")}. They re-render with a seed salt before the set ships.</p></div>` : `<div class="note"><p><strong>Every surface file scores 1.6 or better on both axes.</strong></p></div>`}
${[...grouped].map(([key, list]) => list.length ? `<section class="cat">
  <div class="cathead"><h3>${esc(CATEGORIES[key].label)}</h3><span class="n">${list.length} materials &middot; ${esc(CATEGORIES[key].blurb)}</span></div>
  <div class="tiles">
    ${list.map((t) => `<div class="tile">
      <div class="vars">${t.variantFiles.map((v) => `<div class="sw seamable" style="background-image:url('${v.uri}')"></div>`).join("")}</div>
      <div class="nm">${esc(t.label)}</div>
      <div class="th">${esc(t.themes.join(" / "))}</div>
      <div class="sc${t.variantFiles.some((v) => seamFails(v.score)) ? " bad" : ""}">${t.variantFiles.map((v) => `${v.score.cols}/${v.score.rows}`).join(" &middot; ")}</div>
    </div>`).join("\n    ")}
  </div>
</section>` : "").join("\n")}

<h2>Fittings</h2>
<p>One object in one square: doors, stairs, bridges, wells. Spans run left to right and doors close top to bottom, and the
renderer rotates them to the wall run. These do not wrap and are not scored.</p>
<div class="tiles">
  ${fittings.map((t) => `<div class="tile"><div class="sw" style="background-image:url('${t.uri}')"></div><div class="nm">${esc(t.label)}</div><div class="th">${esc(t.category)} &middot; ${esc(t.themes.join(" / "))}</div></div>`).join("\n  ")}
</div>

<h2>Objects</h2>
<p>${propManifest.objects.length} cut-outs on transparency. The renderer draws every shadow and outline, so a barrel against a
north wall and one in open floor shade differently. <code>wall</code> objects sit against walls, <code>scatter</code> objects
land in open ground, <code>feature</code> objects are only ever placed by the DM.</p>
<div class="objs">
  ${sheetObjects.map((o) => `<div class="obj"><div class="im"><img src="${o.uri}" alt=""></div><div class="nm">${esc(o.label)}<br>${esc(o.kind)} &middot; ${o.span} sq</div></div>`).join("\n  ")}
</div>

<h2>Decals</h2>
<p>Edge strips lie along the painted contour of a wall, a shore, a lava pool or a rough patch; scatter decals drop on open
ground by noise. Stains draw in multiply so the pale ground the model painted them on disappears.</p>
<div class="decals">
  ${sheetDecals.map((d) => `<div class="decal"><div class="im"><img src="${d.uri}" alt=""></div><div class="nm">${esc(d.id)} &middot; ${esc(d.shape)}${d.family ? ` &middot; ${esc(d.family)}` : ""}${d.on ? ` &middot; ${esc(d.on.join(" "))}` : ""}</div></div>`).join("\n  ")}
</div>

${iconGroups.length ? `<h2>Icons</h2>
<p>${iconManifest.icons.length} painted icons on transparency, shown on the dark plate the app draws behind them. Hover for the name.
An OCR pass (<code>scripts/scan-icon-text.py</code>) finds any icon that came back with writing in it and re-rolls it.</p>
${iconGroups.map((g) => `<h3>${esc(ICON_GROUP_TITLES[g.group])} &middot; ${g.icons.length}</h3>
<div class="icons">${g.icons.map((i) => `<img src="${i.uri}" title="${esc(i.label)}" alt="" loading="lazy">`).join("")}</div>`).join("\n")}` : ""}

${fxSheets.length ? `<h2>Effects</h2>
<p>${fxSheets.length} flipbooks painted by a video model on black, played additively over the board. Bursts and projectiles play once
per beat; loops repeat. Rain, snow, motes, embers, fireflies and fog are not flipbooks: the board's particle canvas draws those.</p>
<div class="fxs">${fxSheets.map((f) => `<div class="fxc"><div class="fx" data-frames="${f.frames}" data-columns="${f.columns}" data-fps="${f.fps}" style="background-image:url(${f.uri})"></div><div class="nm">${esc(f.id)}</div></div>`).join("")}</div>` : ""}

${uiParts.length ? `<h2>UI furniture</h2>
<p>${uiParts.length} painted parts for the scroll, the book, plates, frames, loaders, switches and empty states. Text is never baked in.</p>
<div class="uis">${uiParts.map((u) => `<div class="uic"><div class="im"><img src="${u.uri}" alt="" loading="lazy"></div><div class="nm">${esc(u.id)}<br>${esc(u.use)}</div></div>`).join("")}</div>` : ""}

<h2>How this was made</h2>
<div class="note">
<p>Surfaces: an SDXL render with <code>SeamlessTile</code> and <code>CircularVAEDecode</code> (every convolution padded
circularly, so the texture wraps by construction), then repainted by Flux schnell at 0.55 denoise through the circular
decode. Measured on the test tile: 0.92 columns, 1.32 rows, where 1.0 is seamless and Flux alone gave 1.8 to 4.0 on rows.
Objects and decals: Flux schnell on a white backdrop, BEN2 matte, flood-filled and eroded, trimmed with a margin, a
saturation ceiling applied, WebP with alpha. Every seed derives from the asset id, so a re-render reproduces the reviewed
picture; a rejected asset gets a salt recorded in <code>scripts/prop-review.json</code>.</p>
<p>The renderer is <code>src/lib/battlemap/render/renderer.js</code>, canvas 2D, no dependencies, the same file the play board
uses. Skins are <code>src/lib/battlemap/skins.ts</code>.</p>
</div>

<h2>What is not done</h2>
<ul>
${inProgress ? `<li><strong>The asset runs are still going.</strong> Objects ${progress.objects[0]} of ${progress.objects[1]}, decals ${progress.decals[0]} of ${progress.decals[1]}, materials repainted on Flux ${progress.fluxTiles[0]} of ${progress.fluxTiles[1]}, materials with three variants ${progress.variants[0]} of ${progress.variants[1]}. Any skin above that looks thin on props, or any surface that still looks photographic, is waiting on the run; this page is rebuilt when it finishes.</li>` : ""}
<li><strong>Nothing in <code>src/</code> reads any of this yet.</strong> The editor and play view still draw the old art.
The port is phase 3 of <code>docs/visual-overhaul-plan.md</code> and waits on sign-off here.</li>
<li>Objects and decals not reviewed by eye are not trusted. The sheets above are the review; anything wrong gets a salt.</li>
<li>Fitting orientation follows a convention by prompt only; the fittings sheet is the check.</li>
<li>Lights on this page are gradients; the plan's light cookies are a later, hand-made asset.</li>
<li>The low tier drops decals, one bomb layer and the occlusion blur; it has not been timed on a phone yet.</li>
</ul>

</div>
<script>
window.ODM_ROOM = ${JSON.stringify(ROOM)};
window.ODM_ROOM_LIGHTS = ${JSON.stringify(ROOM_LIGHTS)};
window.ODM_ROOM_PROPS = ${JSON.stringify(ROOM_PROPS)};
window.ODM_SKINS = ${JSON.stringify(skinsPresent)};
window.ODM_GENERATED = ${JSON.stringify(GENERATED)};
window.ODM_FOG = ${JSON.stringify({ unexplored, unseen })};
window.ODM_CATALOGUE = ${JSON.stringify({ objects: propManifest.objects, decals: propManifest.decals })};
window.ODM_URIS = ${JSON.stringify({ tiles: tileUris, objects: objectUris, decals: decalUris })};
</script>
<script>${RENDERER}</script>
<script>
(async () => {
  const status = document.getElementById("status");
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = u; });
  const assets = { tiles: {}, objects: {}, decals: {}, catalogue: window.ODM_CATALOGUE };
  for (const [id, uris] of Object.entries(window.ODM_URIS.tiles)) assets.tiles[id] = (await Promise.all(uris.map(load))).filter(Boolean);
  for (const [id, uri] of Object.entries(window.ODM_URIS.objects)) { const im = uri && await load(uri); if (im) assets.objects[id] = im; }
  for (const [id, uri] of Object.entries(window.ODM_URIS.decals)) { const im = uri && await load(uri); if (im) assets.decals[id] = im; }
  const skins = Object.fromEntries(window.ODM_SKINS.map((s) => [s.id, s]));
  const stages = [...document.querySelectorAll(".stage[data-stage]")];
  const opts = () => ({
    grid: document.getElementById("grid").checked,
    dressing: document.getElementById("dressing").checked,
    decals: document.getElementById("decals").checked,
    quality: document.getElementById("lowq").checked ? "low" : "full",
  });
  function specFor(name) {
    const [kind, arg] = name.split(":");
    const base = opts();
    if (kind === "room") return { rows: window.ODM_ROOM, skin: skins[arg], seed: 4, cell: 56, options: { ...base, ambient: "bright", lights: window.ODM_ROOM_LIGHTS, props: window.ODM_ROOM_PROPS } };
    if (kind === "gen") { const g = window.ODM_GENERATED[+arg]; return { rows: g.rows, skin: skins[g.skinId], seed: g.seed, cell: 56, options: { ...base, ambient: g.ambient, lights: g.lights } }; }
    if (kind === "fog") { const g = window.ODM_GENERATED[0]; return { rows: g.rows, skin: skins[g.skinId], seed: g.seed, cell: 56, options: { ...base, ambient: g.ambient, lights: g.lights, unexplored: new Set(window.ODM_FOG.unexplored), unseen: new Set(window.ODM_FOG.unseen) } }; }
    if (kind === "light") { const g = window.ODM_GENERATED[0]; return { rows: g.rows, skin: skins[g.skinId], seed: g.seed, cell: 56, options: { ...base, ambient: "dark", lights: g.lights, zones: [{ x0: 1, y0: 1, x1: 6, y1: 4, ambient: "dark", kind: "darkness" }, { x0: 12, y0: 9, x1: 18, y1: 12, ambient: "dark", kind: "magical_darkness" }] } }; }
    return null;
  }
  let run = 0;
  async function renderAll() {
    const mine = ++run;
    for (const [i, st] of stages.entries()) {
      if (mine !== run) return;
      const spec = specFor(st.dataset.stage);
      const pending = st.querySelector(".pending");
      if (!spec || !spec.skin) { if (pending) pending.textContent = "skin not ready"; continue; }
      if (pending) pending.textContent = "rendering";
      status.textContent = "rendering " + (i + 1) + " / " + stages.length;
      await new Promise((r) => setTimeout(r, 0));
      const t = performance.now();
      try { window.ODMRender.render({ ...spec, assets }, st.querySelector("canvas")); if (pending) pending.remove(); }
      catch (e) { if (pending) pending.textContent = "failed: " + e.message; console.error(e); }
      st.title = Math.round(performance.now() - t) + " ms";
    }
    if (mine === run) status.textContent = "rendered " + stages.length + " maps";
  }
  for (const id of ["grid", "dressing", "decals", "lowq"]) document.getElementById(id).addEventListener("change", renderAll);
  document.getElementById("rep").addEventListener("change", (e) => { for (const el of document.querySelectorAll(".sw.seamable")) el.classList.toggle("rep", e.target.checked); });
  await renderAll();
})();

  // Flipbook player for the effects section.
  for (const el of document.querySelectorAll(".fx")) {
    const frames = Number(el.dataset.frames), columns = Number(el.dataset.columns), fps = Number(el.dataset.fps) || 24;
    const rows = Math.ceil(frames / columns);
    el.style.backgroundSize = \`\${columns * 128}px \${rows * 128}px\`;
    let frame = 0;
    setInterval(() => {
      el.style.backgroundPosition = \`-\${(frame % columns) * 128}px -\${Math.floor(frame / columns) * 128}px\`;
      frame = (frame + 1) % (frames + 8);
      if (frame >= frames) el.style.backgroundPosition = "128px 128px";
    }, 1000 / fps);
  }
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}: ${skinsPresent.length} skins, ${GENERATED.length} generated maps, ${surfaces.length} surfaces, ${propManifest.objects.length} objects, ${(html.length / 1024 / 1024).toFixed(1)} MB page`);
if (skinsMissing.length) console.log(`skins waiting on materials: ${skinsMissing.map((m) => m.skin.id).join(", ")}`);
if (worst.length) console.log(`${worst.length} surface file(s) above the seam threshold`);
