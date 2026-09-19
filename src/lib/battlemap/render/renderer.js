// Map renderer v3. Deterministic: the same terrain string, skin and seed
// always draw the same picture, with no model in the loop. The AI made the
// assets once (scripts/generate-tiles.mjs, generate-props.mjs); this composes
// every map from them.
//
// One source for two places: the play board paints its picture under the grid
// with it (src/lib/battlemap/render/painted.ts), and the NAS preview page
// inlines this same file (scripts/build-map-preview.mjs). It depends on
// nothing but a canvas, so it runs only in a browser.
//
// Layers, in order: ground, rough and hazards, water and lava and chasms,
// low walls, ambient occlusion, walls with their edge decals, fittings,
// dressing (automatic props and placed stamps), scatter decals, light, grade,
// grid, fog.
//
// An unexplored tile arrives as a space. It paints as bare ground and is never
// dressed; the board covers it with fog, so nothing here can leak a room.
const ODMRender = {};

// ---- noise ----
function hash(x, y, s) {
  let q = (x * 374761393 + y * 668265263 + s * 144665) | 0;
  q = Math.imul(q ^ (q >>> 13), 1274126177);
  q ^= q >>> 16;
  return (q >>> 0) / 4294967295;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(w, h, freq, oct, seed) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let A = 0.5, f = freq, s = 0, n = 0;
      for (let k = 0; k < oct; k++) {
        s += A * vnoise(x * f, y * f, seed + k * 17);
        n += A;
        A *= 0.5;
        f *= 2;
      }
      o[y * w + x] = s / n;
    }
  }
  return o;
}
const smooth = (a, b, v) => {
  let t = (v - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

// ---- canvas helpers ----
function mk(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function blit(ctx, c, { dx = 0, dy = 0, blur = 0, alpha = 1, op = "source-over" } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  if (blur) ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(c, dx, dy);
  ctx.restore();
}
function cut(t, m) {
  const c = mk(t.width, t.height), x = c.getContext("2d");
  x.drawImage(t, 0, 0);
  x.globalCompositeOperation = "destination-in";
  x.drawImage(m, 0, 0);
  return c;
}
function solid(m, color) {
  const c = mk(m.width, m.height), x = c.getContext("2d");
  x.drawImage(m, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
// A band along one side of a shape: the shape minus itself shifted.
function edgeBand(m, dx, dy, color) {
  const c = mk(m.width, m.height), x = c.getContext("2d");
  x.drawImage(m, 0, 0);
  x.globalCompositeOperation = "destination-out";
  x.drawImage(m, dx, dy);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
function outline(m, r, color) {
  const c = mk(m.width, m.height), x = c.getContext("2d");
  for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]]) {
    x.drawImage(m, dx, dy);
  }
  x.globalCompositeOperation = "destination-out";
  x.drawImage(m, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}
function fieldCanvas(w, h, field, fn) {
  const c = mk(w, h), x = c.getContext("2d"), d = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const p = fn(field[i]);
    d.data[i * 4] = p[0];
    d.data[i * 4 + 1] = p[1];
    d.data[i * 4 + 2] = p[2];
    d.data[i * 4 + 3] = p[3];
  }
  x.putImageData(d, 0, 0);
  return c;
}
// ---- the renderer ----
//
// spec: { rows, skin, seed, cell, assets, options }
//   rows:    array of equal-length strings of terrain characters
//   skin:    a skin object (scripts/map-preview/skins.mjs)
//   seed:    the map's seed; every random choice derives from it
//   cell:    pixels per square
//   assets:  { tiles: {id: HTMLImageElement[]}, objects: {id: img}, decals: {id: img},
//              catalogue: { objects: [...manifest entries], decals: [...] } }
//   options: { grid, dressing, decals, quality ("full"|"low"), ambient,
//              lights: [{x,y,brightRadius,dimRadius}], zones: [{x0,y0,x1,y1,ambient,kind}],
//              props: [{x,y,id,rot}], unexplored: Set("x,y"), unseen: Set("x,y") }
ODMRender.render = function render(spec, cv) {
  const { rows, skin, assets } = spec;
  const CELL = spec.cell || 56;
  const opt = { grid: false, dressing: true, decals: true, quality: "full", ambient: "bright", lights: [], zones: [], props: [], ...(spec.options || {}) };
  const low = opt.quality === "low";
  const seed = spec.seed | 0;
  const W = rows[0].length, H = rows.length, w = W * CELL, h = H * CELL;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? "#" : rows[y][x]);
  const rnd = (x, y, s) => hash(x + seed * 7, y + seed * 13, s);

  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");

  // Fields. The map seed shifts every field so two maps never share grime.
  const EDGE_B = fbm(w, h, 1 / 26, 4, 53 + seed);
  const EDGE_LOW = fbm(w, h, 1 / (CELL * 3), 2, 61 + seed);
  const EDGE_C = fbm(w, h, 1 / 13, 3, 71 + seed);
  const MACRO = fbm(w, h, 1 / 240, 3, 97 + seed);
  const STAIN = fbm(w, h, 1 / 80, 4, 131 + seed);
  const BOMB = fbm(w, h, 1 / 150, 3, 211 + seed);
  const PATCH = fbm(w, h, 1 / 110, 4, 307 + seed);
  // Rough and water regions bend on a longer wavelength than walls, so a
  // pool that fills a room is a pond and not a pillow.
  const EDGE_SOFT = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) EDGE_SOFT[i] = EDGE_B[i] * 0.55 + EDGE_LOW[i] * 0.45;

  function mask(pred, o, noise) {
    const P = 2, g = mk(W + 2 * P, H + 2 * P), gx = g.getContext("2d"), im = gx.createImageData(g.width, g.height);
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const cy = Math.min(H - 1, Math.max(0, y - P)), cx = Math.min(W - 1, Math.max(0, x - P));
        const on = pred(rows[cy][cx], cx, cy), i = (y * g.width + x) * 4;
        im.data[i] = im.data[i + 1] = im.data[i + 2] = on ? 255 : 0;
        im.data[i + 3] = 255;
      }
    }
    gx.putImageData(im, 0, 0);
    const b = mk(g.width * CELL, g.height * CELL), bx = b.getContext("2d");
    bx.imageSmoothingEnabled = false;
    bx.filter = `blur(${o.blur}px)`;
    bx.drawImage(g, 0, 0, b.width, b.height);
    const d = bx.getImageData(P * CELL, P * CELL, w, h).data, out = mk(w, h), ox = out.getContext("2d"), od = ox.createImageData(w, h);
    const mid = o.threshold ?? 0.5;
    for (let i = 0; i < w * h; i++) {
      const v = d[i * 4] / 255 + (noise[i] - 0.5) * 2 * o.amp;
      const a = smooth(mid - o.soft, mid + o.soft, v);
      od.data[i * 4] = od.data[i * 4 + 1] = od.data[i * 4 + 2] = 255;
      od.data[i * 4 + 3] = a * 255;
    }
    ox.putImageData(od, 0, 0);
    return out;
  }

  const variants = (id) => (assets.tiles[id] && assets.tiles[id].length ? assets.tiles[id] : null);
  const pickVariant = (id, k) => {
    const list = variants(id);
    if (!list) return null;
    return list[k % list.length];
  };

  function tex(img, span, off, angle = 0) {
    const c = mk(w, h), x = c.getContext("2d"), p = x.createPattern(img, "repeat"), s = (span * CELL) / img.width;
    const m = new DOMMatrix().translate(off, off * 0.7).rotate(angle).scale(s, s);
    p.setTransform(m);
    x.fillStyle = p;
    x.fillRect(0, 0, w, h);
    return c;
  }
  // Texture bombing: the material drawn again from another variant at
  // another scale and a quarter turn, revealed through soft noise. One
  // texture has a rhythm; two unrelated rhythms layered through noise do not.
  function bombed(id, span, off) {
    const a = tex(pickVariant(id, 0), span, off);
    if (low) return a;
    const c = mk(w, h), x = c.getContext("2d");
    x.drawImage(tex(pickVariant(id, 1), span * 1.37, off * 2.3 + 97, 90), 0, 0);
    x.globalCompositeOperation = "destination-in";
    x.drawImage(fieldCanvas(w, h, BOMB, (v) => [255, 255, 255, smooth(0.44, 0.56, v) * 255]), 0, 0);
    a.getContext("2d").drawImage(c, 0, 0);
    const third = pickVariant(id, 2);
    if (third && third !== pickVariant(id, 0)) {
      const c2 = mk(w, h), x2 = c2.getContext("2d");
      x2.drawImage(tex(third, span * 0.83, off * 1.7 + 211, 180), 0, 0);
      x2.globalCompositeOperation = "destination-in";
      x2.drawImage(fieldCanvas(w, h, PATCH, (v) => [255, 255, 255, smooth(0.6, 0.7, v) * 255]), 0, 0);
      a.getContext("2d").drawImage(c2, 0, 0);
    }
    return a;
  }

  // Decals along a contour. For every grid edge between an "in" square and
  // an "out" square, the crossing of the soft mask is found along the normal
  // so the strip sits on the painted boundary, not the grid line.
  function layEdgeDecals(m, predIn, decalImgs, o) {
    if (!opt.decals || !decalImgs.length) return;
    const md = m.getContext("2d").getImageData(0, 0, w, h).data;
    const alphaAt = (px, py) => {
      const ix = Math.max(0, Math.min(w - 1, px | 0)), iy = Math.max(0, Math.min(h - 1, py | 0));
      return md[(iy * w + ix) * 4 + 3] / 255;
    };
    const size = o.size * CELL, thick = o.thick * CELL;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!predIn(rows[y][x], x, y)) continue;
        const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const [nx, ny] of sides) {
          if (predIn(at(x + nx, y + ny), x + nx, y + ny)) continue;
          if (rnd(x * 4 + nx, y * 4 + ny, 901) > o.density) continue;
          // Two samples per edge, so a long edge gets a run of strips.
          for (const t of [0.28, 0.72]) {
            if (rnd(x, y, 902 + t * 100 + nx * 3 + ny) > 0.8) continue;
            const ex = (x + 0.5 + nx * 0.5 + (nx === 0 ? t - 0.5 : 0)) * CELL;
            const ey = (y + 0.5 + ny * 0.5 + (ny === 0 ? t - 0.5 : 0)) * CELL;
            let cx = ex, cy = ey, found = false;
            for (let d = -0.5; d <= 0.5; d += 0.05) {
              const px = ex + nx * d * CELL, py = ey + ny * d * CELL;
              if (alphaAt(px, py) < 0.5) {
                cx = px;
                cy = py;
                found = true;
                break;
              }
            }
            if (!found) continue;
            cx += nx * o.shift * CELL;
            cy += ny * o.shift * CELL;
            // The strip's band runs across the image; rotate so it lies
            // along the edge and its inside faces the region.
            const ang = nx === 0 ? 0 : Math.PI / 2;
            const flip = nx + ny > 0 ? Math.PI : 0;
            const img = decalImgs[Math.floor(rnd(x, y, 903 + nx + ny * 2) * decalImgs.length)];
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(ang + flip + (rnd(x, y, 904) - 0.5) * 0.12);
            ctx.globalAlpha = o.alpha;
            const len = size * (0.9 + rnd(x, y, 905) * 0.3);
            ctx.drawImage(img, -len / 2, -thick / 2, len, thick);
            ctx.restore();
          }
        }
      }
    }
  }

  const propImg = (id) => assets.objects[id] || null;
  const shadowOf = (img) => {
    const c = mk(img.width, img.height), x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, c.height);
    return c;
  };
  const shadowCache = new Map();
  function drawProp(img, cx, cy, size, ang, o = {}) {
    const sc = size / Math.max(img.width, img.height), dw = img.width * sc, dh = img.height * sc;
    let sh = shadowCache.get(img);
    if (!sh) {
      sh = shadowOf(img);
      shadowCache.set(img, sh);
    }
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    if (!low) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.filter = "blur(3px)";
      ctx.drawImage(sh, -dw / 2 + 3, -dh / 2 + 5, dw, dh);
      ctx.restore();
    }
    const ol = o.outline ?? 1.4;
    for (const [ox, oy] of [[ol, 0], [-ol, 0], [0, ol], [0, -ol]]) {
      ctx.globalAlpha = 0.7;
      ctx.drawImage(sh, -dw / 2 + ox, -dh / 2 + oy, dw, dh);
    }
    ctx.globalAlpha = 1;
    ctx.filter = "brightness(.9) saturate(.95) contrast(1.06)";
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }

  // 1. Ground.
  ctx.drawImage(bombed(skin.bind["."], skin.floorSpan, 0), 0, 0);
  if (skin.patch && variants(skin.patch.id)) {
    const pt = bombed(skin.patch.id, skin.patch.span, 33), px = pt.getContext("2d");
    px.globalCompositeOperation = "destination-in";
    px.drawImage(fieldCanvas(w, h, PATCH, (v) => [255, 255, 255, smooth(skin.patch.t - (skin.patch.soft || 0.09), skin.patch.t + (skin.patch.soft || 0.09), v) * 255]), 0, 0);
    blit(ctx, pt, { alpha: skin.patch.alpha || 1 });
  }
  blit(ctx, fieldCanvas(w, h, STAIN, (v) => [38, 30, 22, smooth(0.6, 0.72, v) * 55]));
  blit(ctx, fieldCanvas(w, h, STAIN, (v) => [215, 205, 185, smooth(0.36, 0.24, v) * 30]));

  // 2. Rough ground.
  const rough = mask((c) => c === ",", { blur: 14, amp: 0.36, soft: 0.07 }, EDGE_SOFT);
  blit(ctx, solid(rough, "#000"), { blur: 6, alpha: 0.3 });
  const rt = bombed(skin.bind[","], skin.roughSpan, 61), rx = rt.getContext("2d");
  rx.globalCompositeOperation = "multiply";
  rx.fillStyle = skin.roughTint || "#b3aa9e";
  rx.fillRect(0, 0, w, h);
  ctx.drawImage(cut(rt, rough), 0, 0);
  layEdgeDecals(rough, (c) => c === ",", decalsFor(skin.roughDecals, skin.fringe), { size: 0.7, thick: 0.28, shift: 0.02, density: 0.5, alpha: 0.85 });

  // 3. Water, lava, chasm.
  const water = mask((c) => c === "~", { blur: 16, amp: 0.38, soft: 0.06 }, EDGE_SOFT);
  if (skin.glow) {
    blit(ctx, solid(water, "#ff7a1a"), { blur: 18, alpha: 0.75, op: "lighter" });
  } else {
    blit(ctx, solid(water, "#000"), { blur: 9, alpha: 0.55 });
  }
  // A flooded floor is water over the room's own floor: the skin sets
  // waterAlpha below 1 and the flagstones show through.
  blit(ctx, cut(tex(pickVariant(skin.bind["~"], 0), skin.waterSpan, 113), water), { alpha: skin.waterAlpha ?? 1 });
  if (!low && !skin.glow && variants(skin.bind["~"]).length > 1) {
    // Caustics: a second variant screened through the water at low alpha.
    const caus = cut(tex(pickVariant(skin.bind["~"], 1), skin.waterSpan * 1.6, 41, 90), water);
    blit(ctx, caus, { alpha: 0.28, op: "screen" });
  }
  blit(ctx, edgeBand(water, 5, 7, "#000"), { blur: 4, alpha: skin.glow ? 0.25 : 0.45 });
  blit(ctx, outline(water, 2, skin.glow ? "#2a0d04" : "#15110d"), { alpha: 0.55 });
  layEdgeDecals(water, (c) => c === "~", decalsFor(skin.shoreDecals, skin.shore), { size: 0.75, thick: 0.3, shift: 0.04, density: 0.6, alpha: 0.8 });

  // 4. Low walls.
  const lowW = mask((c) => c === "|", { blur: 4, amp: 0.12, soft: 0.05 }, EDGE_C);
  blit(ctx, solid(lowW, "#000"), { dx: 3, dy: 5, blur: 4, alpha: 0.55 });
  const lt = tex(pickVariant(skin.bind["|"], 0), 1.4, 29), lx = lt.getContext("2d");
  lx.globalCompositeOperation = "multiply";
  lx.fillStyle = skin.lowTint || "#a09a90";
  lx.fillRect(0, 0, w, h);
  ctx.drawImage(cut(lt, lowW), 0, 0);
  blit(ctx, outline(lowW, 1.5, "#120f0c"), { alpha: 0.8 });

  // 5. Ambient occlusion: the room darkens toward its walls and corners.
  // Masonry keeps a crisp edge; a tree clump, a hedge or an earth bank is a
  // blob, so nature skins soften the wall mask and bend it on the long noise.
  const wallEdge = skin.wallEdge || { blur: 4, amp: 0.16 };
  const walls = mask((c) => c === "#", { blur: wallEdge.blur, amp: wallEdge.amp, soft: 0.05 }, wallEdge.blur > 6 ? EDGE_SOFT : EDGE_C);
  if (!low) {
    blit(ctx, solid(walls, "#000"), { blur: CELL * 0.45, alpha: 0.3, op: "multiply" });
  }

  // 6. Walls: contact shade, cast shadow, darkened masonry, lit top edge,
  // shaded bottom edge, a hard outline, then the painted lip along the floor.
  blit(ctx, solid(walls, "#000"), { blur: 20, alpha: 0.5 });
  blit(ctx, solid(walls, "#000"), { dx: 5, dy: 8, blur: 7, alpha: 0.55 });
  const wt = bombed(skin.bind["#"], skin.wallSpan, 171), wx = wt.getContext("2d");
  wx.globalCompositeOperation = "multiply";
  wx.fillStyle = skin.wallTint;
  wx.fillRect(0, 0, w, h);
  ctx.drawImage(cut(wt, walls), 0, 0);
  blit(ctx, edgeBand(walls, 3, 4, "#fff3e0"), { blur: 1, alpha: 0.22 });
  blit(ctx, edgeBand(walls, -3, -4, "#000"), { blur: 1, alpha: 0.4 });
  const wo = outline(walls, 2, "#0d0b09");
  blit(ctx, wo);
  blit(ctx, wo, { alpha: 0.6 });
  layEdgeDecals(walls, (c) => c === "#", decalsFor(skin.wallDecals, skin.lip), { size: 0.8, thick: 0.24, shift: 0.14, density: 0.45, alpha: 0.75 });

  // 7. Fittings: a door is a slab set into the wall run and rotated to it.
  const doorImg = pickVariant(skin.bind["+"], 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (rows[y][x] !== "+") continue;
      const horiz = at(x - 1, y) === "#" || at(x + 1, y) === "#", t = CELL * 0.36, len = CELL + 6;
      ctx.save();
      ctx.translate((x + 0.5) * CELL, (y + 0.5) * CELL);
      if (!horiz) ctx.rotate(Math.PI / 2);
      ctx.shadowColor = "rgba(0,0,0,.65)";
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 3;
      ctx.drawImage(doorImg, 0, doorImg.height * 0.3, doorImg.width, doorImg.height * 0.4, -len / 2, -t / 2, len, t);
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#0d0b09";
      ctx.lineWidth = 2;
      ctx.strokeRect(-len / 2, -t / 2, len, t);
      ctx.restore();
    }
  }

  // 8. Dressing. Cosmetic only: props sit against walls or in open ground,
  // never in a doorway, a corridor, or the square next to another prop, so
  // the picture never suggests an obstacle the rules do not have. A placed
  // stamp claims its own square and the eight around it first.
  const taken = new Set(), key = (x, y) => `${x},${y}`;
  for (const p of opt.props) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) taken.add(key(p.x + a, p.y + b));
  }
  const pool = dressingPool(skin, assets.catalogue.objects);
  if (opt.dressing) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ch = rows[y][x];
        if (ch !== "." && ch !== ",") continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => at(x + a, y + b) === "+")) continue;
        const N = at(x, y - 1) === "#", S = at(x, y + 1) === "#", E = at(x + 1, y) === "#", Wd = at(x - 1, y) === "#";
        if ((N && S) || (E && Wd)) continue;
        let near = false;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (taken.has(key(x + a, y + b))) near = true;
        if (near) continue;
        const walls4 = N + S + E + Wd, r = rnd(x, y, 501);
        const kind = walls4 >= 1 && ch === "." && r < skin.wallDensity ? "wall" : walls4 === 0 && r < skin.scatterDensity ? "scatter" : null;
        if (!kind) continue;
        const candidates = pool.filter((p) => p.kind === kind && propImg(p.id));
        if (!candidates.length) continue;
        const total = candidates.reduce((s, p) => s + p.weight, 0);
        let pick = rnd(x, y, 777) * total, prop = candidates[0];
        for (const p of candidates) {
          if ((pick -= p.weight) <= 0) {
            prop = p;
            break;
          }
        }
        let cx = (x + 0.5) * CELL, cy = (y + 0.5) * CELL;
        if (kind === "wall") {
          const push = CELL * 0.16;
          if (N) cy -= push;
          if (S) cy += push;
          if (E) cx += push;
          if (Wd) cx -= push;
        }
        cx += (rnd(x, y, 9) - 0.5) * CELL * 0.14;
        cy += (rnd(x, y, 10) - 0.5) * CELL * 0.14;
        const ang = prop.align ? (N || S ? 0 : Math.PI / 2) + (rnd(x, y, 12) - 0.5) * 0.12 : rnd(x, y, 13) * Math.PI * 2;
        const size = Math.min(prop.span, 1.2) * 1.3 * CELL * (0.9 + rnd(x, y, 14) * 0.2);
        drawProp(propImg(prop.id), cx, cy, size, ang);
        taken.add(key(x, y));
      }
    }
  }
  // Placed stamps, at full size.
  for (const p of opt.props) {
    const entry = assets.catalogue.objects.find((o) => o.id === p.id);
    const img = propImg(p.id);
    if (!entry || !img) continue;
    drawProp(img, (p.x + 0.5) * CELL, (p.y + 0.5) * CELL, entry.span * 1.15 * CELL, p.rot || 0, { outline: 1.6 });
  }

  // 9. Scatter decals: small loose things on open ground.
  if (opt.decals && !low) {
    const scatter = assets.catalogue.decals.filter((d) => d.shape === "scatter" && d.on.includes(skin.ground) && assets.decals[d.id]);
    if (scatter.length) {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (rows[y][x] !== ".") continue;
          if (rnd(x, y, 601) > skin.scatterDecalDensity) continue;
          const d = scatter[Math.floor(rnd(x, y, 602) * scatter.length)];
          const img = assets.decals[d.id];
          const size = CELL * (0.45 + rnd(x, y, 603) * 0.35);
          ctx.save();
          ctx.translate((x + rnd(x, y, 604)) * CELL, (y + rnd(x, y, 605)) * CELL);
          ctx.rotate(rnd(x, y, 606) * Math.PI * 2);
          ctx.globalAlpha = d.blend === "multiply" ? 0.7 : 0.82;
          ctx.globalCompositeOperation = d.blend === "multiply" ? "multiply" : "source-over";
          const sc = size / Math.max(img.width, img.height);
          ctx.drawImage(img, (-img.width * sc) / 2, (-img.height * sc) / 2, img.width * sc, img.height * sc);
          ctx.restore();
        }
      }
    }
  }

  // 10. Light. A darkness layer per ambient, punched through by lights and
  // by lit zones, plus a warm additive glow on the picture itself.
  const darkAlpha = { bright: 0, dim: 0.42, dark: 0.66 }[opt.ambient] ?? 0;
  const darkLayer = mk(w, h), dk = darkLayer.getContext("2d");
  if (darkAlpha) {
    dk.fillStyle = `rgba(8,7,18,${darkAlpha})`;
    dk.fillRect(0, 0, w, h);
  }
  for (const z of opt.zones) {
    const za = { bright: 0, dim: 0.42, dark: 0.66 }[z.ambient] ?? 0;
    dk.save();
    dk.globalCompositeOperation = "source-over";
    dk.clearRect(z.x0 * CELL, z.y0 * CELL, (z.x1 - z.x0 + 1) * CELL, (z.y1 - z.y0 + 1) * CELL);
    dk.fillStyle = z.kind === "magical_darkness" ? "rgba(30,8,46,.82)" : `rgba(8,7,18,${za})`;
    dk.fillRect(z.x0 * CELL, z.y0 * CELL, (z.x1 - z.x0 + 1) * CELL, (z.y1 - z.y0 + 1) * CELL);
    dk.restore();
  }
  for (const l of opt.lights) {
    const cx = (l.x + 0.5) * CELL, cy = (l.y + 0.5) * CELL, rb = l.brightRadius * CELL, rd = l.dimRadius * CELL;
    const g = dk.createRadialGradient(cx, cy, 0, cx, cy, rd);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(Math.min(0.98, rb / rd), "rgba(0,0,0,.85)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    dk.globalCompositeOperation = "destination-out";
    dk.fillStyle = g;
    dk.fillRect(cx - rd, cy - rd, rd * 2, rd * 2);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, rb * 1.1);
    glow.addColorStop(0, "rgba(255,190,110,.42)");
    glow.addColorStop(0.5, "rgba(255,150,60,.18)");
    glow.addColorStop(1, "rgba(255,120,40,0)");
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = glow;
    ctx.fillRect(cx - rb * 1.1, cy - rb * 1.1, rb * 2.2, rb * 2.2);
    ctx.restore();
  }
  ctx.drawImage(darkLayer, 0, 0);

  // 11. Grade: slow tonal drift, the skin's tint, a vignette, paper grain.
  blit(ctx, fieldCanvas(w, h, MACRO, (v) => {
    const g = 128 + (v - 0.5) * 120;
    return [g, g, g, 255];
  }), { op: "soft-light" });
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.fillStyle = skin.grade;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,.22)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  if (!low) blit(ctx, grain(), { alpha: 0.16, op: "overlay" });

  // 12. Grid: hairlines only when asked for.
  if (opt.grid) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < W; x++) {
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, h);
    }
    for (let y = 1; y < H; y++) {
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(w, y * CELL + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 13. Fog. The unexplored mask is dilated before it is softened, so the
  // soft edge always covers more than the square, never less. The server
  // blanks unexplored terrain anyway; this is the drawing, not the guarantee.
  if (opt.unexplored && opt.unexplored.size) {
    const fog = mask((c, x, y) => opt.unexplored.has(key(x, y)), { blur: 7, amp: 0.05, soft: 0.1, threshold: 0.32 }, EDGE_C);
    ctx.drawImage(solid(fog, "#07060f"), 0, 0);
  }
  if (opt.unseen && opt.unseen.size) {
    const dimm = mask((c, x, y) => opt.unseen.has(key(x, y)), { blur: 6, amp: 0.04, soft: 0.1, threshold: 0.4 }, EDGE_C);
    blit(ctx, solid(dimm, "#000"), { alpha: 0.55 });
  }

  // The edge decals of a family, or the named subset a skin asks for: a
  // cave pool takes wet sand and scum, never sea foam.
  function decalsFor(family, ids) {
    if (!family) return [];
    return assets.catalogue.decals
      .filter((d) => d.shape === "edge" && d.family === family && assets.decals[d.id] && (!ids || ids.includes(d.id)))
      .map((d) => assets.decals[d.id]);
  }
  function grain() {
    const g = mk(256, 256), gx = g.getContext("2d"), d = gx.createImageData(256, 256);
    for (let i = 0; i < 256 * 256; i++) {
      const v = 110 + hash(i % 256, (i / 256) | 0, 999) * 90;
      d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v;
      d.data[i * 4 + 3] = 255;
    }
    gx.putImageData(d, 0, 0);
    const c = mk(w, h), x = c.getContext("2d");
    x.fillStyle = x.createPattern(g, "repeat");
    x.fillRect(0, 0, w, h);
    return c;
  }
};

// The objects a skin may dress with: every catalogue object in one of the
// skin's sets, weighted toward the ones the skin favours.
function dressingPool(skin, objects) {
  return objects
    .filter((o) => (o.kind === "wall" || o.kind === "scatter") && o.sets.some((s) => skin.sets.includes(s)))
    .map((o) => ({ ...o, weight: (skin.favour || []).includes(o.id) ? 3 : 1 }));
}
ODMRender.dressingPool = dressingPool;

export { ODMRender };
