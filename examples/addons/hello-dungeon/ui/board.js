// The Hello Dungeon board view. It runs in a sandboxed frame inside the
// table page and knows only what the page posts it (the bridge contract in
// docs/addons/extension-points.md):
//
//   page -> view  { odm: 1, type: "snapshot", snapshot }   the board, for this viewer
//                 { odm: 1, type: "file", requestId, ok, name, mime, bytes }
//                 { odm: 1, type: "fx", events }             attacks, spells, heals as they land
//                 { odm: 1, type: "ping", x, y, focus, at }  somebody pointed at a square
//                 { odm: 1, type: "camera", mode, x, y, zoom } the DM steering the view
//   view -> page  { odm: 1, type: "ready" }
//                 { odm: 1, type: "tile", x, y }            a tap on a square
//                 { odm: 1, type: "token", tokenId }        a tap on a figure
//                 { odm: 1, type: "hover", x, y }           or x: null, y: null
//                 { odm: 1, type: "file", requestId, name } ask for a stored file
//                 { odm: 1, type: "anchors", tokens }       where each figure was drawn
//
// Files in the addon's asset library (what its setup wrote to publicDir)
// load straight from snapshot.assetsUrl, like the flagstone below.
//
// A tap here is exactly a tap on the flat board: the page decides what it
// means (a move, a target, a ping) and the server's rules decide whether it
// happens. Nothing drawn here can be more than the snapshot holds, and the
// snapshot holds only what this viewer may see.

(() => {
  "use strict";
  const BRIDGE = 1;
  const canvas = document.getElementById("board");
  const badge = document.getElementById("badge");
  const context = canvas.getContext("2d");
  let snapshot = null;
  let layout = null;
  let cameraZoom = 1;
  let cameraCenter = null;
  let cameraLocked = false;
  let sessionLayout = false;
  let hoverKey = "";
  let modelFor = "";
  let sentAnchors = "";
  const waiting = new Map();
  // Moments being drawn: effects and pings, each with when it started.
  const moments = [];
  const MOMENT_MS = 1100;
  let frameQueued = false;

  // The floor texture this addon's setup painted (server/setup.mjs), from
  // its asset library. Until it loads, or if setup has not run, floors are
  // plain.
  let flagstone = null;
  let flagstoneFrom = "";
  function loadFlagstone() {
    if (!snapshot?.assetsUrl || flagstoneFrom === snapshot.assetsUrl) return;
    flagstoneFrom = snapshot.assetsUrl;
    const image = new Image();
    image.onload = () => {
      flagstone = context.createPattern(image, "repeat");
      draw();
    };
    image.src = `${snapshot.assetsUrl}flagstone.png`;
  }

  // Each figure wears the picture it wears on the flat board (its portrait,
  // or its plate), asked for once per figure with the "face" message.
  // A model-based view can use token.character?.gender (Female/Male/Nonbinary);
  // missing or empty means use its ordinary model. Portraits already handle it.
  const faces = new Map();
  function askForFaces() {
    for (const token of snapshot.tokens) {
      if (faces.has(token.id)) continue;
      faces.set(token.id, null);
      const requestId = `face-${token.id}`;
      waiting.set(requestId, async (reply) => {
        if (!reply.ok) return;
        try {
          faces.set(token.id, await createImageBitmap(new Blob([reply.bytes], { type: reply.mime })));
          draw();
        } catch {
          // Not a picture this browser reads: the figure keeps its colour.
        }
      });
      send({ type: "face", requestId, tokenId: token.id });
    }
  }

  const ZONE_TONES = { harm: "rgb(220 90 60 / 0.35)", ward: "rgb(90 160 230 / 0.3)", bless: "rgb(240 210 110 / 0.3)", neutral: "rgb(200 200 220 / 0.25)" };

  const send = (message) => window.parent.postMessage({ odm: BRIDGE, ...message }, "*");

  const COLORS = {
    night: { floor: "#8f8673", water: "#3f6f8c", difficult: "#7b6d57", door: "#a0743c", lowwall: "#6b6458", climb: "#857a62", wall: "#4b4f5c", side: "#353843", edge: "rgb(0 0 0 / 0.25)" },
    day: { floor: "#cbbf9f", water: "#6a9cb8", difficult: "#b29f7c", door: "#b98545", lowwall: "#9a907b", climb: "#b6a682", wall: "#7d8292", side: "#626674", edge: "rgb(0 0 0 / 0.18)" },
  };
  const TOKEN_COLORS = { pc: "#4f86d9", enemy: "#c94a3d", npc: "#5aa864", prop: "#8a8378" };

  // The viewer's own choices for this view (its options in addon.json),
  // kept by the table for this device and handed over in the snapshot.
  const WALL_SCALE = { low: 0.45, normal: 1, tall: 1.6 };

  function wallHeight(index) {
    const heights = snapshot?.view?.data?.heights;
    const value = Array.isArray(heights) ? Number(heights[index]) : NaN;
    const scale = WALL_SCALE[snapshot?.options?.walls] ?? 1;
    return (Number.isFinite(value) && value > 0 ? value : 1.5) * scale;
  }

  function measure() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const { width: cols, height: rows } = snapshot;
    // Tile size that fits the whole diamond, walls included.
    const tw = Math.max(8, Math.min((width - 16) / ((cols + rows) / 2), ((height - 40) / ((cols + rows) / 2 + 3)) * 2)) * cameraZoom;
    const th = tw / 2;
    const [cx, cy] = cameraCenter ?? [cols / 2, rows / 2];
    const originX = width / 2 - ((cx - cy) * tw) / 2;
    const originY = height / 2 - ((cx + cy) * th) / 2 + th * 1.5;
    send({ type: "camera-state", x: Math.max(0, Math.min(cols - 1, cx - 0.5)), y: Math.max(0, Math.min(rows - 1, cy - 0.5)), zoom: cameraZoom });
    return { tw, th, lift: th * 0.9, originX, originY, width, height };
  }

  const toScreen = (x, y) => ({ x: layout.originX + ((x - y) * layout.tw) / 2, y: layout.originY + ((x + y) * layout.th) / 2 });

  function diamond(x, y, lift, fill, stroke) {
    const p = toScreen(x, y);
    context.beginPath();
    context.moveTo(p.x, p.y - lift);
    context.lineTo(p.x + layout.tw / 2, p.y + layout.th / 2 - lift);
    context.lineTo(p.x, p.y + layout.th - lift);
    context.lineTo(p.x - layout.tw / 2, p.y + layout.th / 2 - lift);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
      context.strokeStyle = stroke;
      context.stroke();
    }
  }

  function shade(color, amount) {
    const value = Number.parseInt(color.slice(1), 16);
    const channel = (shift) => Math.round(((value >> shift) & 255) * amount);
    return `rgb(${channel(16)} ${channel(8)} ${channel(0)})`;
  }

  function block(x, y, height, palette, dim) {
    const p = toScreen(x, y);
    const lift = height * layout.lift;
    const { tw, th } = layout;
    context.fillStyle = shade(palette.side, dim);
    context.beginPath();
    context.moveTo(p.x - tw / 2, p.y + th / 2);
    context.lineTo(p.x, p.y + th);
    context.lineTo(p.x, p.y + th - lift);
    context.lineTo(p.x - tw / 2, p.y + th / 2 - lift);
    context.fill();
    context.fillStyle = shade(palette.side, dim * 0.8);
    context.beginPath();
    context.moveTo(p.x + tw / 2, p.y + th / 2);
    context.lineTo(p.x, p.y + th);
    context.lineTo(p.x, p.y + th - lift);
    context.lineTo(p.x + tw / 2, p.y + th / 2 - lift);
    context.fill();
    diamond(x, y, lift, shade(palette.wall, dim), palette.edge);
  }

  function draw() {
    if (!snapshot) return;
    layout = measure();
    layout.tokens = [];
    const palette = COLORS[snapshot.appearance?.theme === "day" ? "day" : "night"];
    context.clearRect(0, 0, layout.width, layout.height);
    const { width, height, terrain } = snapshot;
    const visible = new Set(snapshot.visible);
    const reachable = new Set(snapshot.reachable);
    const tokensAt = new Map();
    for (const token of snapshot.tokens) tokensAt.set(token.y * width + token.x, [...(tokensAt.get(token.y * width + token.x) ?? []), token]);
    const zonesAt = new Map();
    for (const zone of snapshot.zones ?? []) for (const cell of zone.cells) zonesAt.set(cell, [...(zonesAt.get(cell) ?? []), zone]);
    // Back to front: a square's walls and figures cover the ones behind it.
    for (let sum = 0; sum <= width + height - 2; sum += 1) {
      for (let x = 0; x < width; x += 1) {
        const y = sum - x;
        if (y < 0 || y >= height) continue;
        const index = y * width + x;
        const char = terrain[index];
        if (char === " ") continue;
        const dim = snapshot.fullVision || visible.has(index) ? 1 : 0.55;
        const kind = snapshot.legend[char] ?? "floor";
        if (kind === "wall") {
          block(x, y, wallHeight(index), palette, dim);
        } else {
          diamond(x, y, 0, shade(palette[kind] ?? palette.floor, dim), snapshot.options?.outlines === false ? null : palette.edge);
          if (flagstone && kind === "floor") diamond(x, y, 0, flagstone);
          for (const zone of zonesAt.get(index) ?? []) diamond(x, y, 0, ZONE_TONES[zone.tone] ?? ZONE_TONES.neutral);
          if (reachable.has(index)) diamond(x, y, 0, "rgb(240 200 90 / 0.18)");
          if (hoverKey === `${x},${y}`) diamond(x, y, 0, "rgb(255 255 255 / 0.18)");
          // A walk takes two taps: the first aims it, so mark that square.
          if (snapshot.moveAim?.x === x && snapshot.moveAim?.y === y) diamond(x, y, 0, "rgb(240 200 90 / 0.45)");
        }
        for (const token of tokensAt.get(index) ?? []) drawToken(token);
      }
    }
    drawLabels();
    drawIntents();
    drawMoments();
    reportAnchors();
  }

  function drawLabels() {
    context.font = "11px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    for (const label of snapshot.labels ?? []) {
      const p = toScreen(label.x + 0.5, label.y + 0.5);
      context.fillStyle = "rgb(0 0 0 / 0.55)";
      const width = context.measureText(label.text).width + 8;
      context.fillRect(p.x - width / 2, p.y - 16, width, 15);
      context.fillStyle = "#f3e2b3";
      context.fillText(label.text, p.x, p.y - 2);
    }
  }

  // What each enemy means to do: a dashed line to its mark.
  function drawIntents() {
    const at = new Map(layout.tokens.map((token) => [token.id, token]));
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgb(230 120 90 / 0.8)";
    for (const intent of snapshot.intents ?? []) {
      const from = at.get(intent.tokenId);
      const to = intent.targetTokenId ? at.get(intent.targetTokenId) : null;
      if (!from || !to || intent.stale) continue;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.setLineDash([]);
  }

  // Effects and pings: a ring that opens on the square and fades. With
  // reduced motion it shows once, still, and goes.
  function drawMoments() {
    const now = performance.now();
    for (let index = moments.length - 1; index >= 0; index -= 1) {
      if (now - moments[index].at > MOMENT_MS) moments.splice(index, 1);
    }
    const still = snapshot.appearance?.reducedMotion;
    for (const moment of moments) {
      const t = still ? 0.5 : (now - moment.at) / MOMENT_MS;
      const p = toScreen(moment.x + 0.5, moment.y + 0.5);
      context.beginPath();
      context.ellipse(p.x, p.y, layout.tw * (0.3 + t * 0.6), layout.th * (0.3 + t * 0.6), 0, 0, Math.PI * 2);
      context.strokeStyle = moment.color.replace("ALPHA", String(Math.max(0, 1 - t)));
      context.lineWidth = 3;
      context.stroke();
      context.lineWidth = 1;
      if (moment.text) {
        context.fillStyle = "#fff";
        context.font = "bold 13px system-ui, sans-serif";
        context.fillText(moment.text, p.x, p.y - layout.th - t * 12);
      }
    }
    // One frame queued at a time, however many things ask for a redraw.
    if (moments.length && !frameQueued) {
      frameQueued = true;
      const next = () => {
        frameQueued = false;
        draw();
      };
      if (still) setTimeout(next, MOMENT_MS);
      else requestAnimationFrame(next);
    }
  }

  const FX_COLORS = { heal: "rgb(110 220 140 / ALPHA)", spell: "rgb(150 140 255 / ALPHA)", death: "rgb(160 160 160 / ALPHA)" };

  function addEffects(events) {
    const now = performance.now();
    for (const event of events) {
      const targets = Array.isArray(event.to) ? event.to : event.to ? [event.to] : event.from ? [event.from] : [];
      for (const [index, target] of targets.entries()) {
        const outcome = Array.isArray(event.outcomes) ? event.outcomes[index] : event.outcome;
        const miss = outcome === "miss" || outcome === "save" || outcome === "fumble";
        moments.push({
          x: target.x,
          y: target.y,
          at: now,
          color: miss ? "rgb(200 200 200 / ALPHA)" : FX_COLORS[event.kind] ?? "rgb(240 110 80 / ALPHA)",
          text: typeof event.amount === "number" && index === 0 ? String(event.amount) : miss ? "miss" : "",
        });
      }
    }
    draw();
  }

  // Where each figure stands on screen, as fractions of the frame, so the
  // table's plate and action ring open on the figure drawn here rather than
  // on its square of the flat grid. Sent only when something moved.
  function reportAnchors() {
    const tokens = {};
    for (const token of layout.tokens) {
      tokens[token.id] = [token.x / layout.width, (token.y - token.r) / layout.height, (token.y + token.r) / layout.height].map((value) => Math.round(value * 1000) / 1000);
    }
    const key = JSON.stringify(tokens);
    if (key === sentAnchors) return;
    sentAnchors = key;
    send({ type: "anchors", tokens });
  }

  function drawToken(token) {
    const p = toScreen(token.x + (token.size - 1) / 2, token.y + (token.size - 1) / 2);
    const radius = (layout.th * 0.55) * Math.max(1, token.size);
    const cx = p.x;
    const cy = p.y + layout.th / 2 - radius * 0.9 - (token.elevation === "flying" ? layout.lift : 0);
    context.globalAlpha = token.hidden ? 0.45 : 1;
    context.beginPath();
    context.ellipse(cx, p.y + layout.th / 2, radius * 0.8, radius * 0.35, 0, 0, Math.PI * 2);
    context.fillStyle = "rgb(0 0 0 / 0.35)";
    context.fill();
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = token.down ? "#6b6b6b" : TOKEN_COLORS[token.kind] ?? TOKEN_COLORS.npc;
    context.fill();
    context.lineWidth = snapshot.turn?.tokenId === token.id ? 3 : 1.5;
    context.strokeStyle = snapshot.turn?.tokenId === token.id ? "#ffd36b" : token.mine ? "#f3e2b3" : "rgb(0 0 0 / 0.5)";
    context.stroke();
    context.lineWidth = 1;
    const face = faces.get(token.id);
    if (face) {
      context.save();
      context.beginPath();
      context.arc(cx, cy, radius - 1.5, 0, Math.PI * 2);
      context.clip();
      context.drawImage(face, cx - radius, cy - radius, radius * 2, radius * 2);
      context.restore();
    }
    context.globalAlpha = 1;
    layout.tokens.push({ id: token.id, x: cx, y: cy, r: radius });
  }

  function tileAt(px, py) {
    const dx = (px - layout.originX) / (layout.tw / 2);
    const dy = (py - layout.originY) / (layout.th / 2);
    const x = Math.floor((dx + dy) / 2);
    const y = Math.floor((dy - dx) / 2);
    return x >= 0 && y >= 0 && x < snapshot.width && y < snapshot.height ? { x, y } : null;
  }

  function pointer(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener("click", (event) => {
    if (!snapshot || !layout) return;
    const at = pointer(event);
    const hit = [...layout.tokens].reverse().find((token) => Math.hypot(at.x - token.x, at.y - token.y) <= token.r);
    if (hit) {
      send({ type: "token", tokenId: hit.id });
      return;
    }
    const tile = tileAt(at.x, at.y);
    if (tile) send({ type: "tile", x: tile.x, y: tile.y });
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!snapshot || !layout) return;
    const at = pointer(event);
    const tile = tileAt(at.x, at.y);
    const key = tile ? `${tile.x},${tile.y}` : "";
    if (key === hoverKey) return;
    hoverKey = key;
    send(tile ? { type: "hover", x: tile.x, y: tile.y } : { type: "hover", x: null, y: null });
    draw();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") send({ type: "cancel" });
  });

  // The model this map's generator made: asked for once per map, to show the
  // file path works end to end. A real 3D view would parse it (with three.js
  // and its GLTFLoader, bundled into ui/) and draw it under the figures.
  function askForModel() {
    const model = snapshot?.view?.files?.find((file) => file.name.endsWith(".glb"));
    if (!model || modelFor === snapshot.mapId) return;
    modelFor = snapshot.mapId;
    const requestId = `model-${Date.now()}`;
    waiting.set(requestId, (reply) => {
      badge.textContent = reply.ok
        ? `3D model ${model.name}: ${Math.round(reply.bytes.byteLength / 1024)} KB, ${new TextDecoder().decode(new Uint8Array(reply.bytes, 0, 4))}`
        : `Model not loaded: ${reply.error}`;
    });
    send({ type: "file", requestId, name: model.name });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.odm !== BRIDGE) return;
    if (message.type === "camera-control" && sessionLayout && !cameraLocked && snapshot) {
      const action = message.action;
      if (action === "fit") { cameraZoom = 1; cameraCenter = null; }
      else if (action === "zoom-in" || action === "zoom-out") cameraZoom = Math.max(0.25, Math.min(8, cameraZoom * (action === "zoom-in" ? 1.2 : 1 / 1.2)));
      else {
        const [x, y] = cameraCenter ?? [snapshot.width / 2, snapshot.height / 2];
        cameraCenter = [x + (action === "left" ? -1 : action === "right" ? 1 : 0), y + (action === "up" ? -1 : action === "down" ? 1 : 0)];
      }
      draw();
    } else if (message.type === "camera" && sessionLayout && snapshot) {
      cameraLocked = message.mode === "lock";
      if (Number.isFinite(message.x) && Number.isFinite(message.y)) cameraCenter = [message.x + 0.5, message.y + 0.5];
      if (Number.isFinite(message.zoom)) cameraZoom = Math.max(0.25, Math.min(8, message.zoom));
      draw();
    }
    if (message.type === "scene") {
      snapshot = null;
      layout = null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      document.body.dataset.theme = message.appearance?.theme === "day" ? "day" : "night";
      badge.textContent = "No tactical map. Play continues through the native controls.";
    } else if (message.type === "snapshot") {
      sessionLayout = message.sessionLayout === "stage";
      snapshot = message.snapshot;
      document.body.dataset.theme = snapshot.appearance?.theme === "day" ? "day" : "night";
      if (!snapshot.view) badge.textContent = "";
      loadFlagstone();
      draw();
      askForModel();
      askForFaces();
    } else if (message.type === "fx" && snapshot) {
      addEffects(message.events);
    } else if (message.type === "ping" && snapshot) {
      moments.push({ x: message.x, y: message.y, at: performance.now(), color: "rgb(255 220 120 / ALPHA)", text: "" });
      draw();
    } else if (message.type === "file") {
      const handler = waiting.get(message.requestId);
      waiting.delete(message.requestId);
      handler?.(message);
    }
  });

  new ResizeObserver(() => draw()).observe(document.body);
  send({ type: "ready" });
})();
