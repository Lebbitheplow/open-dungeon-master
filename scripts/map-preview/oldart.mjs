// A faithful port of the tile art the app draws today, so the comparison page
// shows the real thing and not a sketch of it. Every number here is lifted
// from src/app/campaigns/[campaignId]/battleMapCells.tsx and
// src/app/campaigns/[campaignId]/terrainDraw.ts at the commit being compared.

export const TILE = 32;

export const PALETTES = {
  cave: { floor: "#26232b", floorAlt: "#2a2731", wall: "#0b0a10", wallDeco: "rock", water: "#173a4f", difficult: "#37323b" },
  forest: { floor: "#25301f", floorAlt: "#293524", wall: "#101a0d", wallDeco: "tree", water: "#1e3a5f", difficult: "#3a3d24" },
  swamp: { floor: "#2a2f22", floorAlt: "#2e3326", wall: "#151c11", wallDeco: "tree", water: "#2b3d33", difficult: "#3d3b26" },
  riverside: { floor: "#33302a", floorAlt: "#37342d", wall: "#191713", wallDeco: "rock", water: "#1d4b73", difficult: "#42402f" },
  interior: { floor: "#322a22", floorAlt: "#362e25", wall: "#14100c", wallDeco: "stone", water: "#1e3a5f", difficult: "#3f3a2d" },
  field: { floor: "#2c3324", floorAlt: "#303728", wall: "#1a1d14", wallDeco: "rock", water: "#1e3a5f", difficult: "#403d28" },
};

// The editor's own fill for a door square. The play view has no door art at
// all and falls through to floor, which is one of the gaps the new set closes.
export const DOOR_FILL = "#6b4f2a";

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 255) + amt);
  const g = clamp(((n >> 8) & 255) + amt);
  const b = clamp((n & 255) + amt);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function tileNoise(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function hashNoise(x, y, salt) {
  const n = Math.sin((x + salt * 57.3) * 269.5 + (y - salt * 19.7) * 183.3) * 43758.5453;
  return n - Math.floor(n);
}

function wallDeco(kind, x, y) {
  const px = x * TILE;
  const py = y * TILE;
  if (kind === "tree") {
    const jx = (hashNoise(x, y, 1) - 0.5) * 4;
    const jy = (hashNoise(x, y, 2) - 0.5) * 4;
    return (
      `<g opacity="0.9">` +
      `<ellipse cx="${px + TILE / 2}" cy="${py + TILE - 4}" rx="${TILE / 3}" ry="3" fill="#000" opacity="0.35"/>` +
      `<circle cx="${px + TILE / 2 + jx}" cy="${py + TILE / 2 - 2 + jy}" r="${TILE / 2.7}" fill="#16240f"/>` +
      `<circle cx="${px + TILE / 2 - 6 + jx}" cy="${py + TILE / 2 + 3 + jy}" r="${TILE / 4}" fill="#233620"/>` +
      `<circle cx="${px + TILE / 2 + 6 + jx}" cy="${py + TILE / 2 + jy}" r="${TILE / 5}" fill="#2c4327"/>` +
      `<circle cx="${px + TILE / 2 - 2 + jx}" cy="${py + TILE / 2 - 6 + jy}" r="${TILE / 6}" fill="#375334" opacity="0.8"/>` +
      `</g>`
    );
  }
  if (kind === "stone") {
    return (
      `<g>` +
      `<line x1="${px}" y1="${py + TILE / 2}" x2="${px + TILE}" y2="${py + TILE / 2}" stroke="#0000006e" stroke-width="1.5"/>` +
      `<line x1="${px}" y1="${py + TILE / 2 + 1}" x2="${px + TILE}" y2="${py + TILE / 2 + 1}" stroke="#ffffff10" stroke-width="1"/>` +
      `<line x1="${px + TILE / 3}" y1="${py}" x2="${px + TILE / 3}" y2="${py + TILE / 2}" stroke="#0000006e" stroke-width="1.5"/>` +
      `<line x1="${px + (2 * TILE) / 3}" y1="${py + TILE / 2}" x2="${px + (2 * TILE) / 3}" y2="${py + TILE}" stroke="#0000006e" stroke-width="1.5"/>` +
      `</g>`
    );
  }
  const jx = (hashNoise(x, y, 3) - 0.5) * 3;
  return (
    `<g>` +
    `<ellipse cx="${px + TILE / 2}" cy="${py + TILE - 5}" rx="${TILE / 3}" ry="3" fill="#000" opacity="0.3"/>` +
    `<polygon points="${px + 5},${py + TILE - 6} ${px + TILE / 2 + jx},${py + 7} ${px + TILE - 5},${py + TILE - 6}" fill="#2a2731" stroke="#0b0a10" stroke-width="1"/>` +
    `<polygon points="${px + 9},${py + TILE - 6} ${px + TILE / 2 + jx},${py + 11} ${px + TILE / 2 + 7},${py + TILE - 6}" fill="#3a3644" opacity="0.6"/>` +
    `</g>`
  );
}

// Renders a grid of terrain characters the way the play view does, including
// the neighbour-aware passes: wall bevels, fence axis, shore foam and the
// shadow a wall casts south and east onto open floor.
export function oldGrid(rows, theme, options = {}) {
  const palette = PALETTES[theme];
  const height = rows.length;
  const width = rows[0].length;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? " " : rows[y][x]);
  const out = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ch = at(x, y);
      const px = x * TILE;
      const py = y * TILE;

      if (ch === "#") {
        const topOpen = at(x, y - 1) !== "#" && at(x, y - 1) !== " ";
        const leftOpen = at(x - 1, y) !== "#" && at(x - 1, y) !== " ";
        out.push(
          `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="${palette.wall}"/>` +
            `<rect x="${px + 1.5}" y="${py + 1.5}" width="${TILE - 3}" height="${TILE - 3}" rx="2" fill="${shade(palette.wall, 16)}"/>` +
            (topOpen
              ? `<line x1="${px + 1}" y1="${py + 1.5}" x2="${px + TILE - 1}" y2="${py + 1.5}" stroke="${shade(palette.wall, 40)}" stroke-width="1.5" opacity="0.7"/>`
              : "") +
            (leftOpen
              ? `<line x1="${px + 1.5}" y1="${py + 1}" x2="${px + 1.5}" y2="${py + TILE - 1}" stroke="${shade(palette.wall, 32)}" stroke-width="1.5" opacity="0.6"/>`
              : "") +
            wallDeco(palette.wallDeco, x, y),
        );
      } else if (ch === "|") {
        const horizontal = at(x - 1, y) === "|" || at(x + 1, y) === "|";
        const vertical = at(x, y - 1) === "|" || at(x, y + 1) === "|";
        const rail = shade(palette.wall, 70);
        const along = horizontal || !vertical;
        out.push(
          `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="${palette.floorAlt}"/>` +
            (along
              ? `<line x1="${px}" y1="${py + TILE / 2 - 3}" x2="${px + TILE}" y2="${py + TILE / 2 - 3}" stroke="${rail}" stroke-width="2"/>` +
                `<line x1="${px}" y1="${py + TILE / 2 + 3}" x2="${px + TILE}" y2="${py + TILE / 2 + 3}" stroke="${shade(rail, -25)}" stroke-width="2"/>` +
                `<line x1="${px + 6}" y1="${py + TILE / 2 - 6}" x2="${px + 6}" y2="${py + TILE / 2 + 6}" stroke="${rail}" stroke-width="2"/>` +
                `<line x1="${px + TILE - 6}" y1="${py + TILE / 2 - 6}" x2="${px + TILE - 6}" y2="${py + TILE / 2 + 6}" stroke="${rail}" stroke-width="2"/>`
              : `<line x1="${px + TILE / 2 - 3}" y1="${py}" x2="${px + TILE / 2 - 3}" y2="${py + TILE}" stroke="${rail}" stroke-width="2"/>` +
                `<line x1="${px + TILE / 2 + 3}" y1="${py}" x2="${px + TILE / 2 + 3}" y2="${py + TILE}" stroke="${shade(rail, -25)}" stroke-width="2"/>` +
                `<line x1="${px + TILE / 2 - 6}" y1="${py + 6}" x2="${px + TILE / 2 + 6}" y2="${py + 6}" stroke="${rail}" stroke-width="2"/>` +
                `<line x1="${px + TILE / 2 - 6}" y1="${py + TILE - 6}" x2="${px + TILE / 2 + 6}" y2="${py + TILE - 6}" stroke="${rail}" stroke-width="2"/>`),
        );
      } else if (ch === "~") {
        const foam = [];
        if (at(x, y - 1) !== "~") foam.push(`<line x1="${px + 2}" y1="${py + 1.5}" x2="${px + TILE - 2}" y2="${py + 1.5}" stroke="#bfe9ff55" stroke-width="1.5"/>`);
        if (at(x, y + 1) !== "~") foam.push(`<line x1="${px + 2}" y1="${py + TILE - 1.5}" x2="${px + TILE - 2}" y2="${py + TILE - 1.5}" stroke="#bfe9ff55" stroke-width="1.5"/>`);
        if (at(x - 1, y) !== "~") foam.push(`<line x1="${px + 1.5}" y1="${py + 2}" x2="${px + 1.5}" y2="${py + TILE - 2}" stroke="#bfe9ff55" stroke-width="1.5"/>`);
        if (at(x + 1, y) !== "~") foam.push(`<line x1="${px + TILE - 1.5}" y1="${py + 2}" x2="${px + TILE - 1.5}" y2="${py + TILE - 2}" stroke="#bfe9ff55" stroke-width="1.5"/>`);
        out.push(
          `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="url(#water-${theme})"/>` +
            `<path d="M ${px + 3} ${py + 11} q 6 -4 12 0 t 14 0" stroke="#ffffff2a" stroke-width="1.5" fill="none"/>` +
            `<path d="M ${px + 2} ${py + 22} q 7 4 13 0 t 13 0" stroke="#ffffff18" stroke-width="1.5" fill="none"/>` +
            foam.join(""),
        );
      } else if (ch === ",") {
        const tuft = palette.wallDeco === "tree" ? "#2f3d22" : "#413b30";
        let scatter = "";
        for (let k = 0; k < 5; k += 1) {
          const gx = px + 5 + hashNoise(x, y, 10 + k) * (TILE - 10);
          const gy = py + 6 + hashNoise(x, y, 20 + k) * (TILE - 10);
          const r = 1.4 + hashNoise(x, y, 30 + k) * 2;
          scatter +=
            `<circle cx="${gx}" cy="${gy}" r="${r}" fill="${tuft}" opacity="0.7"/>` +
            `<circle cx="${gx + 0.8}" cy="${gy - 0.8}" r="${r * 0.5}" fill="${shade(tuft, 20)}" opacity="0.6"/>`;
        }
        out.push(`<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="${palette.difficult}"/>${scatter}`);
      } else if (ch === "+") {
        // The editor's door fill. The play view draws nothing here.
        out.push(`<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="${DOOR_FILL}"/>`);
      } else {
        const n = tileNoise(x, y);
        const flBase = n > 0.66 ? shade(palette.floor, 6) : n > 0.33 ? palette.floor : palette.floorAlt;
        out.push(
          `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="${flBase}"/>` +
            `<rect x="${px}" y="${py}" width="${TILE}" height="${TILE}" fill="none" stroke="#00000022" stroke-width="1"/>` +
            (n > 0.86
              ? `<path d="M ${px + 8} ${py + 7} l 6 5 l -3 6" stroke="#00000030" stroke-width="1" fill="none"/>`
              : n < 0.08
                ? `<circle cx="${px + n * 96 + 6}" cy="${py + 18}" r="1.2" fill="#ffffff10"/>`
                : ""),
        );
      }

      // The cast shadow pass, which only runs on open floor beside a wall.
      if (ch !== "#") {
        if (at(x, y - 1) === "#") out.push(`<rect x="${px}" y="${py}" width="${TILE}" height="${TILE * 0.55}" fill="url(#castN)"/>`);
        if (at(x - 1, y) === "#") out.push(`<rect x="${px}" y="${py}" width="${TILE * 0.5}" height="${TILE}" fill="url(#castW)"/>`);
      }
    }
  }

  const grain = options.grain === false
    ? ""
    : `<rect x="0" y="0" width="${width * TILE}" height="${height * TILE}" filter="url(#grain-${theme})" opacity="0.5" style="mix-blend-mode:overlay"/>`;

  return (
    `<svg viewBox="0 0 ${width * TILE} ${height * TILE}" width="100%" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">` +
    defs(theme, palette) +
    out.join("") +
    grain +
    `</svg>`
  );
}

function defs(theme, palette) {
  return (
    `<defs>` +
    `<filter id="grain-${theme}" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch" result="n"/>` +
    `<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0"/>` +
    `</filter>` +
    `<linearGradient id="water-${theme}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${shade(palette.water, 26)}"/>` +
    `<stop offset="100%" stop-color="${shade(palette.water, -18)}"/>` +
    `</linearGradient>` +
    `<linearGradient id="castN" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0.5"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="castW" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#000" stop-opacity="0.42"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></linearGradient>` +
    `</defs>`
  );
}
