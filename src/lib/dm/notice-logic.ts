// What stands between a character and noticing something without looking
// for it: the pace they march at and the light they see by. Pure, so the
// numbers can be tested apart from the tool (src/lib/dm/check-tools.ts).
//
// SRD 5.1, Travel Pace: a fast pace is -5 to passive Wisdom (Perception).
// SRD 5.1, Vision and Light: dim light is lightly obscured, disadvantage on
// Wisdom (Perception) checks that rely on sight, and a passive check at
// disadvantage is -5; in darkness a creature without darkvision sees nothing,
// and darkvision turns darkness into dim light and dim light into bright.

export type Light = "bright" | "dim" | "dark";

// The light under the open sky at an hour of the day: twilight either side
// of the night, darkness through it.
export function skyLight(hour: number): Light {
  const value = ((Math.floor(hour) % 24) + 24) % 24;
  if (value >= 21 || value < 5) {
    return "dark";
  }
  if (value < 7 || value >= 19) {
    return "dim";
  }
  return "bright";
}

// Where the party is, off the board, as far as light goes. SRD 5.1, Vision
// and Light: darkness outdoors at night, and "within the confines of an
// unlit dungeon or a subterranean vault" at any hour; a lived-in building is
// lit by its lamps and fires. Read from the current location's name, then
// its description; a place the words do not settle is not guessed at.
export type PlaceKind = "outdoors" | "indoors" | "underground";

const UNDERGROUND =
  /\b(caves?|caverns?|grotto|dungeons?|crypts?|catacombs?|tombs?|barrows?|mines?|tunnels?|sewers?|underdark|undercity|cellars?|vaults?|burrows?|warrens?|depths|underground|subterranean|oubliette)\b/i;
const INDOORS =
  /\b(inns?|taverns?|alehouse|pub|house|home|halls?|rooms?|chambers?|shops?|store|smithy|forge|temples?|shrines?|chapel|church|cathedral|library|keep|castle|palace|manor|mansion|towers?|guildhall|guild|barracks|warehouse|mill|stables?|cottage|hut|cabin|lodge|office|study|kitchen|prison|jail|hovel|brothel|bathhouse|theatre|theater|academy|monastery|abbey|court|throne room)\b/i;
const OUTDOORS =
  /\b(roads?|highway|forests?|woods?|woodland|fields?|plains?|hills?|mountains?|river|lake|coast|shore|beach|swamp|marsh|bog|desert|tundra|valley|meadow|camp|campsite|clearing|garden|courtyard|square|market|streets?|alley|bridge|trail|path|pass|wilds?|wilderness|jungle|glade|grove|ruins?|graveyard|cemetery|farm|village|docks?|harbou?r|deck|sea|ocean|rooftops?|outdoors|outside|open air)\b/i;

export function placeKindOf(text: string): PlaceKind | null {
  if (UNDERGROUND.test(text)) {
    return "underground";
  }
  if (INDOORS.test(text)) {
    return "indoors";
  }
  if (OUTDOORS.test(text)) {
    return "outdoors";
  }
  return null;
}

// The light off the board. A light the DM names wins; then the place: an
// unlit underground place is dark, a building is lit, the open sky follows
// the hour. With no location recorded the party is taken to be under the
// sky, as before; a named place the words cannot settle gives no light
// shift at all (null), for the DM to name.
export function offBoardLight(input: {
  hour: number;
  named?: Light | null;
  place?: { name: string; description?: string; outdoors?: boolean | null } | null;
}): Light | null {
  if (input.named) {
    return input.named;
  }
  if (!input.place) {
    return skyLight(input.hour);
  }
  if (input.place.outdoors === true) {
    return skyLight(input.hour);
  }
  const kind = placeKindOf(input.place.name) ?? placeKindOf(input.place.description ?? "") ?? (input.place.outdoors === false ? "indoors" : null);
  if (kind === "underground") {
    return "dark";
  }
  if (kind === "indoors") {
    return "bright";
  }
  if (kind === "outdoors") {
    return skyLight(input.hour);
  }
  return null;
}

// The light a character sees by: their own lit torch or lantern brightens
// what is near them, and darkvision lifts the light one step.
export function lightSeenBy(ambient: Light, carriesLight: boolean, darkvision: boolean): Light {
  let light = carriesLight ? "bright" : ambient;
  if (darkvision) {
    light = light === "dark" ? "dim" : "bright";
  }
  return light as Light;
}

// The shift to a passive Perception that relies on sight, with the reasons
// for the result.
// In darkness a creature that cannot see is effectively blinded, and a
// blinded creature fails any check that relies on sight (SRD 5.1,
// Conditions): `blind` says so, and the caller counts the character out.
// Something noticed by ear is not touched by the light.
export function sightPassiveShift(input: {
  pace?: "fast" | "normal" | "slow";
  light?: Light;
  byEar?: boolean;
}): { shift: number; blind: boolean; notes: string[] } {
  let shift = 0;
  const notes: string[] = [];
  if (input.pace === "fast") {
    shift -= 5;
    notes.push("fast pace: -5");
  }
  if (input.byEar) {
    return { shift, blind: false, notes };
  }
  if (input.light === "dim") {
    shift -= 5;
    notes.push("dim light: -5");
  } else if (input.light === "dark") {
    notes.push("darkness: sees nothing");
    return { shift, blind: true, notes };
  }
  return { shift, blind: false, notes };
}

// An unconscious creature is unaware of its surroundings (SRD 5.1,
// Conditions), and a creature at 0 hit points is unconscious.
export function cannotNotice(sheet: { currentHp: number; conditions: string[]; deathSaves?: { dead?: boolean } | null }): boolean {
  return (
    Boolean(sheet.deathSaves?.dead) ||
    sheet.currentHp <= 0 ||
    sheet.conditions.some((condition) => /^(unconscious|asleep|sleeping)\b/i.test(condition.trim()))
  );
}
