import type { MapTheme } from "@/lib/battlemap/generate";
import type { Backdrop } from "@/lib/battlemap/backdrop";
import type { DoorStates, LightZone, MapDrawing, MapLabel, MapProp, SceneAmbience } from "@/lib/battlemap/scene";
import type { MapSkin } from "@/lib/battlemap/skins";
import type { AmbientLight, MapLight } from "@/lib/battlemap/types";

// What /api/campaigns/:id/dm/maps hands the client. Shared by the map
// library panel and the workshop's gallery pieces so a tile and the editor
// behind it agree on what a prepared map is.

export const THEME_LABELS: Record<MapTheme, string> = {
  cave: "Cave",
  forest: "Forest",
  swamp: "Swamp",
  riverside: "Water",
  interior: "Indoors",
  field: "Open ground",
};

export type PreparedMap = {
  id: string;
  name: string;
  notes: string;
  tags: string[];
  width: number;
  height: number;
  terrain: string;
  ambient: AmbientLight;
  theme: MapTheme;
  lights: MapLight[];
  seed: number;
  backdrop: Backdrop | null;
  labels: MapLabel[];
  props: MapProp[];
  doors: DoorStates;
  zones: LightZone[];
  overlayPath: string;
  ambience: SceneAmbience;
  // Marks made at the table that came back with a captured board.
  drawings?: MapDrawing[];
  // What it is painted with; empty means the setting and theme decide.
  skin?: MapSkin;
};

export type LibraryState = {
  maps: PreparedMap[];
  board: "fight" | "scene" | null;
  hasParty: boolean;
  // True in a workshop, where a scene can never open (there is no party and
  // never will be), so the control is hidden rather than forever disabled.
  workshop: boolean;
  // The campaign's setting, which picks the skin a map wears by default.
  genre?: string;
};
