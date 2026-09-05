import {
  EMPTY_TEMPLATE_EXTRAS,
  type TemplateEnemy,
  type TemplateExtras,
} from "@/lib/dm/encounter-template-logic";
import type { MapLabel, MapProp } from "@/lib/battlemap/scene";

// What /api/campaigns/:id/dm/encounter-templates hands the client. Shared by
// the prep panel and the workshop's rows so a row and the editor behind it
// agree on what a prepared encounter is. Mirrors TemplateReadout in
// src/lib/dm/encounter-templates.ts rather than importing it, so a client
// component never names a module that opens the database.

export type TemplateReadout = {
  // "hard for this party", or why the roster cannot be costed.
  verdict: string;
  adjustedXp: number;
  // The ceiling start_encounter will refuse above, at this difficulty.
  ceiling: number;
  tooDeadly: boolean;
  unknownMonster: string | null;
  count: number;
};

export type PreparedEncounter = {
  id: string;
  name: string;
  enemies: TemplateEnemy[];
  battlefield: string;
  notes: string;
  map: { mapId: string | null };
  extras: TemplateExtras;
  readout: TemplateReadout;
};

// A prepared map as the picker sees it. The drawer route hands back whole
// maps, so the placement canvas can draw the real ground when one is
// linked; the fields are optional because a bare option list is still one.
export type MapOption = {
  id: string;
  name: string;
  width?: number;
  height?: number;
  terrain?: string;
  labels?: MapLabel[];
  props?: MapProp[];
};

// The form's fields as typed. The roster is kept as the text the DM wrote,
// not as parsed rows, because the server parses it (checkRoster) and an
// edit has to round-trip through the same shorthand.
export type EncounterDraft = {
  name: string;
  enemies: string;
  battlefield: string;
  notes: string;
  mapId: string;
  extras: TemplateExtras;
};

export const EMPTY_ENCOUNTER_DRAFT: EncounterDraft = {
  name: "",
  enemies: "",
  battlefield: "",
  notes: "",
  mapId: "",
  extras: EMPTY_TEMPLATE_EXTRAS,
};
