import { tileIndex, type AmbientLight, type BattleToken, type MapLight } from "@/lib/battlemap/types";

// Model-facing map text: an ASCII grid with token overlay letters plus a
// token list carrying exact ids and coordinates. Target is under ~1.5k
// chars for a 20x15 grid so combat prompts stay lean.

export type SerializableMap = {
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  lights: MapLight[];
};

// PCs get A-Z in party order; enemies get digits then lowercase letters.
export function tokenGlyphs(tokens: BattleToken[]): Map<string, string> {
  const glyphs = new Map<string, string>();
  const pcLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const enemyLetters = "123456789abcdefghijklmnopqrstuvwxyz";
  let pcAt = 0;
  let enemyAt = 0;
  for (const token of tokens) {
    if (token.kind === "pc") {
      glyphs.set(token.id, pcLetters[pcAt % pcLetters.length]);
      pcAt += 1;
    } else {
      glyphs.set(token.id, enemyLetters[enemyAt % enemyLetters.length]);
      enemyAt += 1;
    }
  }
  return glyphs;
}

// `statuses` maps a token's refId to a short status note appended to its
// combatant line (DOWN, DYING, conditions), so the model sees drift-free
// state next to each position.
export function serializeMapForPrompt(
  map: SerializableMap,
  tokens: BattleToken[],
  statuses?: Map<string, string>,
): string {
  const glyphs = tokenGlyphs(tokens);
  const grid = map.terrain.split("");
  for (const token of tokens) {
    grid[tileIndex(map.width, token.x, token.y)] = glyphs.get(token.id) ?? "?";
  }

  const lines: string[] = [];
  lines.push(
    `Battle map ${map.width}x${map.height} tiles (1 tile = 5 ft). Coordinates are (col,row); (0,0) is top-left.`,
  );
  lines.push(
    "Legend: . floor | # wall (blocks movement and sight) | ~ water (difficult) | , difficult ground. Letters and digits are combatants.",
  );
  // Column header uses last-digit ruler so wide maps stay aligned.
  const header = Array.from({ length: map.width }, (_, x) => String(x % 10)).join("");
  lines.push(`   ${header}`);
  for (let y = 0; y < map.height; y += 1) {
    const row = grid.slice(y * map.width, (y + 1) * map.width).join("");
    lines.push(`${String(y).padStart(2, " ")} ${row}`);
  }

  const tokenLines = tokens.map((token) => {
    const glyph = glyphs.get(token.id) ?? "?";
    const ref = token.kind === "enemy" ? ` [enemyId=${token.refId}]` : "";
    const status = statuses?.get(token.refId);
    return `${glyph}=${token.name} (${token.kind === "pc" ? "PC" : "enemy"})${ref} at (${token.x},${token.y})${status ? ` [${status}]` : ""}`;
  });
  lines.push(`Combatants: ${tokenLines.join("; ")}`);

  // Precomputed PC-to-enemy ranges: tile counting on the ASCII grid is
  // exactly the arithmetic small models get wrong, so these lines are the
  // authoritative distances the prompt points at.
  const pcTokens = tokens.filter((token) => token.kind === "pc");
  const enemyTokens = tokens.filter((token) => token.kind === "enemy");
  if (pcTokens.length && enemyTokens.length) {
    const rows = pcTokens.map((pc) => {
      const parts = enemyTokens.map((enemy) => {
        const tilesApart = Math.max(Math.abs(pc.x - enemy.x), Math.abs(pc.y - enemy.y));
        return `${enemy.name} ${tilesApart <= 1 ? "ADJACENT (melee range, 5 ft)" : `${tilesApart * 5} ft`}`;
      });
      return `- ${pc.name}: ${parts.join("; ")}`;
    });
    lines.push(`Distances (authoritative; do not re-count tiles):\n${rows.join("\n")}`);
  }

  const lightParts: string[] = [`Ambient light: ${map.ambient}.`];
  if (map.lights.length) {
    lightParts.push(
      `Fixed lights at ${map.lights.map((light) => `(${light.x},${light.y})`).join(", ")} (bright ${map.lights[0].brightRadius} tiles).`,
    );
  }
  const carriers = tokens.filter((token) => token.lightRadius > 0);
  if (carriers.length) {
    lightParts.push(`Carrying light: ${carriers.map((token) => token.name).join(", ")}.`);
  }
  lines.push(lightParts.join(" "));

  return lines.join("\n");
}
