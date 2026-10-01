// The shape of a player's projection of the battle map, the only shape
// clients ever see. Split from view.ts, which builds it and re-exports the
// type; a type-only module, so a client may import it freely.

import type { Backdrop } from "@/lib/battlemap/backdrop";
import type { Footprint } from "@/lib/battlemap/footprint";
import type { MapTheme } from "@/lib/battlemap/generate";
import type { HealthWord } from "@/lib/battlemap/health-words";
import type { TokenIntent } from "@/lib/battlemap/intent";
import type { DoorStates, LightZone, MapDrawing, MapLabel } from "@/lib/battlemap/scene";
import type { MapSkin } from "@/lib/battlemap/skins";
import type { AmbientLight, TokenKind } from "@/lib/battlemap/types";
import type { TargetEdge } from "@/lib/battlemap/view-tactics";
import type { ViewZone } from "@/lib/dm/zone-view";

export type PlayerMapView = {
  mapId: string;
  width: number;
  height: number;
  // The light the board is under right now: the author's for a roofed map,
  // the clock's and the weather's for one under the sky.
  ambient: AmbientLight;
  outdoors: boolean;
  theme: MapTheme;
  // Row-major terrain chars; unexplored tiles are replaced with a space.
  terrain: string;
  // Cosmetic art under the grid, or null. The renderer draws it only inside
  // explored tiles, so a picture cannot show a player through the fog that
  // is hiding the terrain (src/lib/battlemap/backdrop.ts).
  backdrop: Backdrop | null;
  // What the board is painted with when it has no backdrop; empty means the
  // setting and theme decide. Cosmetic, so it is the same for every viewer.
  skin: MapSkin;
  visible: number[];
  explored: number[];
  tokens: Array<{
    id: string;
    kind: TokenKind;
    refId: string;
    name: string;
    x: number;
    y: number;
    mine: boolean;
    // PC at 0 HP: rendered downed, never removed from the map.
    down: boolean;
    // Only ever true in the DM's projection: a hidden token is absent from a
    // player's rather than marked in it.
    hidden: boolean;
    // A carried light burning down: minutes left of the whole, or null
    // (docs/vtt-parity-implementation-plan.md 7.3).
    light: { remaining: number; total: number } | null;
    // The painted object a prop or bystander is drawn as, or "" for the
    // plain figure (public/assets/props/manifest.json ids).
    stamp: string;
  }>;
  lights: Array<{ x: number; y: number; radius: number }>;
  reachable: number[];
  // What the server charges, in squares, to reach each square of `reachable`
  // (same order), spell areas and passing allies counted: the drag ruler
  // reads it (src/lib/battlemap/board-move.ts) instead of pricing a route on
  // the terrain alone.
  reachableCost?: number[];
  // What the viewer's own move may carry this turn, asked of the rules the
  // move route asks: a long jump's reach (src/lib/srd/jump.ts: the Strength
  // score in feet after a 10-foot run, half standing) and, while the
  // character grapples someone, the drag's cost (src/lib/dm/drag.ts: every
  // square doubled unless each creature held is two sizes smaller).
  moves?: {
    jumpFeet: number;
    highJumpFeet: number;
    runningStart: boolean;
    drag: { factor: 1 | 2; names: string[] } | null;
  };
  budgetLeft: number;
  myTokenId: string | null;
  round: number;
  currentTurnName: string;
  // Whether this board is a fight or an exploration scene. A scene has no
  // rounds and no initiative, so movement is not rationed on it.
  board: "fight" | "scene";
  // True when this projection skipped fog entirely (the DM's view). Clients
  // use it to drop the fog shading, not to decide what they may do.
  fullVision: boolean;
  // DM view only: real hit points behind every token, so the person running
  // the fight can see the board the way they see their own notes.
  tokenHp?: Record<string, { current: number; max: number }>;
  // The scene layer (src/lib/battlemap/scene.ts). Labels a player may see,
  // and only where they have been; the DM sees them all. Door states,
  // patches of light and the overlay picture are the DM's alone: a player
  // sees a locked or secret door as the wall the engine treats it as.
  labels: MapLabel[];
  // Marks drawn on the board: everyone's, and the DM's own for the DM.
  drawings: MapDrawing[];
  doors?: DoorStates;
  zones?: LightZone[];
  overlayPath?: string;
  // The stage layer (docs/vtt-parity-implementation-plan.md section 1.1).
  // Every entry states a fact the engine holds: conditions with rounds
  // left, a health word instead of a number, an aura's reach, a large
  // creature's footprint, whether it is flying, whose turn it is, and who
  // attacked whom this round. Keyed by token id; absent keys mean none.
  // `note` is what the condition's metadata says beyond rounds ("until
  // Kael's turn", "save ends (WIS 13)", "from Kael"); a character's rows
  // also carry concentration, exhaustion and the death track (view-stage.ts).
  tokenConditions: Record<string, Array<{ id: string; label: string; rounds?: number; note?: string }>>;
  // From the viewer's own character to each enemy they can see, keyed by the
  // enemy's id: cover, flanking, reach, shooting in melee (view-tactics.ts).
  // Empty for the DM and for a viewer with no token.
  edges: Record<string, TargetEdge>;
  tokenHealth: Record<string, HealthWord>;
  tokenAuras: Record<string, Array<{ id: string; radiusFeet: number; tone: AuraTone }>>;
  tokenFootprint: Record<string, Footprint>;
  tokenElevation: Record<string, "flying" | "burrowing">;
  turn: { tokenId: string; round: number } | null;
  targets: Record<string, string[]>;
  // What each enemy this viewer can see is about to do: the DM's declaration
  // for this round, else the engine's guess (src/lib/dm/intent.ts, which also
  // holds the redaction). Empty when the table has `enemyIntent` off.
  intents: TokenIntent[];
  // The spell areas on the board (src/lib/battlemap/zones.ts), the squares
  // a player has explored: what a zone layer draws under the tokens.
  spellZones: ViewZone[];
};

export type AuraTone = "ward" | "harm" | "bless" | "neutral";
