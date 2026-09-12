// What a player's virtual dice look like: the face colour, the number
// colour, the outline drawn around each number, the surface texture and the
// material the 3D tray shades them with. The look follows the account
// (users.settings_json.diceLook) so every table and every device shows the
// same dice; src/lib/dice/dice-look-store.ts is the client cache and sync.
//
// Pure and alias-import-free so scripts/test-dice-look.mjs can load it.

export type DiceTexture = (typeof DICE_TEXTURES)[number]["id"];
export type DiceMaterial = (typeof DICE_MATERIALS)[number]["id"];

export type DiceLook = {
  // Hex colours (#rrggbb). outline may be "" for no outline.
  face: string;
  numbers: string;
  outline: string;
  texture: DiceTexture;
  material: DiceMaterial;
};

// The textures the dice tray ships (public/dice-box/textures), named the
// way the library keys them.
export const DICE_TEXTURES = [
  { id: "none", label: "Plain" },
  { id: "paper", label: "Paper" },
  { id: "marble", label: "Marble" },
  { id: "cloudy", label: "Clouds" },
  { id: "speckles", label: "Speckles" },
  { id: "glitter", label: "Glitter" },
  { id: "stars", label: "Stars" },
  { id: "stainedglass", label: "Stained glass" },
  { id: "wood", label: "Wood grain" },
  { id: "metal", label: "Brushed metal" },
  { id: "fire", label: "Fire" },
  { id: "ice", label: "Ice" },
  { id: "water", label: "Water" },
  { id: "astral", label: "Astral" },
  { id: "skulls", label: "Skulls" },
  { id: "dragon", label: "Dragon scale" },
  { id: "leopard", label: "Leopard" },
] as const;

export const DICE_MATERIALS = [
  { id: "plastic", label: "Plastic" },
  { id: "glass", label: "Glass" },
  { id: "metal", label: "Metal" },
  { id: "wood", label: "Wood" },
  { id: "none", label: "Matte" },
] as const;

// The tray's original look, so an account that never opened the editor
// sees exactly what it always did.
export const DEFAULT_DICE_LOOK: DiceLook = {
  face: "#FFFFFF",
  numbers: "#F9B333",
  outline: "",
  texture: "paper",
  material: "plastic",
};

// Starting points, each a full look the player can then tweak. Drawn from
// the tray library's own themes, flattened to one colour where the library
// paints each die a different one.
export const DICE_LOOK_PRESETS: ReadonlyArray<{ id: string; label: string; look: DiceLook }> = [
  { id: "radiant", label: "Radiant", look: DEFAULT_DICE_LOOK },
  {
    id: "fire",
    label: "Fire",
    look: { face: "#F43C04", numbers: "#F8D84F", outline: "#000000", texture: "fire", material: "metal" },
  },
  {
    id: "ice",
    label: "Ice",
    look: { face: "#214FA3", numbers: "#60E9FF", outline: "#000000", texture: "ice", material: "glass" },
  },
  {
    id: "poison",
    label: "Poison",
    look: { face: "#504099", numbers: "#D6A8FF", outline: "#000000", texture: "cloudy", material: "plastic" },
  },
  {
    id: "acid",
    label: "Acid",
    look: { face: "#5ACE04", numbers: "#A9FF70", outline: "#000000", texture: "marble", material: "plastic" },
  },
  {
    id: "thunder",
    label: "Thunder",
    look: { face: "#7D7D7D", numbers: "#FFC500", outline: "#000000", texture: "cloudy", material: "metal" },
  },
  {
    id: "air",
    label: "Air",
    look: { face: "#A4CCD6", numbers: "#FFFFFF", outline: "#000000", texture: "cloudy", material: "glass" },
  },
  {
    id: "water",
    label: "Water",
    look: { face: "#5B8691", numbers: "#60E9FF", outline: "#000000", texture: "water", material: "glass" },
  },
  {
    id: "earth",
    label: "Earth",
    look: { face: "#346804", numbers: "#6C9943", outline: "#000000", texture: "speckles", material: "none" },
  },
  {
    id: "force",
    label: "Force",
    look: { face: "#FF68FF", numbers: "#FFFFFF", outline: "#570000", texture: "stars", material: "plastic" },
  },
  {
    id: "necrotic",
    label: "Necrotic",
    look: { face: "#6F0000", numbers: "#FFFFFF", outline: "#000000", texture: "skulls", material: "plastic" },
  },
  {
    id: "bloodmoon",
    label: "Blood moon",
    look: { face: "#6F0000", numbers: "#CDB800", outline: "#000000", texture: "marble", material: "plastic" },
  },
  {
    id: "starrynight",
    label: "Starry night",
    look: { face: "#091636", numbers: "#8597AD", outline: "#FFFFFF", texture: "speckles", material: "plastic" },
  },
  {
    id: "glitterparty",
    label: "Glitter party",
    look: { face: "#FFB5F5", numbers: "#FFFFFF", outline: "", texture: "glitter", material: "plastic" },
  },
  {
    id: "astralsea",
    label: "Astral sea",
    look: { face: "#FFFFFF", numbers: "#565656", outline: "", texture: "astral", material: "none" },
  },
  {
    id: "dragon",
    label: "Dragon",
    look: { face: "#B80000", numbers: "#FFFFFF", outline: "#000000", texture: "dragon", material: "none" },
  },
  {
    id: "bronze",
    label: "Bronze",
    look: { face: "#705206", numbers: "#FFBF59", outline: "#3D2D03", texture: "metal", material: "metal" },
  },
  {
    id: "onyx",
    label: "Onyx",
    look: { face: "#000000", numbers: "#FFFFFF", outline: "#000000", texture: "none", material: "glass" },
  },
  {
    id: "ivory",
    label: "Ivory",
    look: { face: "#FFFFFF", numbers: "#000000", outline: "", texture: "none", material: "plastic" },
  },
];

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function normalizeHex(value: string): string {
  return value.toUpperCase();
}

function isTexture(value: unknown): value is DiceTexture {
  return DICE_TEXTURES.some((texture) => texture.id === value);
}

function isMaterial(value: unknown): value is DiceMaterial {
  return DICE_MATERIALS.some((material) => material.id === value);
}

// A stored look, however it was saved: every field is checked on its own
// and a bad or missing one falls back to the default, so a half-written
// record from an older build still yields dice.
export function parseDiceLook(raw: unknown): DiceLook {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    face: isHexColor(source.face) ? normalizeHex(source.face) : DEFAULT_DICE_LOOK.face,
    numbers: isHexColor(source.numbers) ? normalizeHex(source.numbers) : DEFAULT_DICE_LOOK.numbers,
    outline: isHexColor(source.outline)
      ? normalizeHex(source.outline)
      : source.outline === ""
        ? ""
        : DEFAULT_DICE_LOOK.outline,
    texture: isTexture(source.texture) ? source.texture : DEFAULT_DICE_LOOK.texture,
    material: isMaterial(source.material) ? source.material : DEFAULT_DICE_LOOK.material,
  };
}

// Strict check for a write: true only when every field is present and
// valid. The profile route refuses anything else rather than repairing it.
export function isValidDiceLook(raw: unknown): raw is DiceLook {
  if (!raw || typeof raw !== "object") return false;
  const source = raw as Record<string, unknown>;
  return (
    isHexColor(source.face) &&
    isHexColor(source.numbers) &&
    (source.outline === "" || isHexColor(source.outline)) &&
    isTexture(source.texture) &&
    isMaterial(source.material)
  );
}

export function sameDiceLook(a: DiceLook, b: DiceLook): boolean {
  return (
    a.face === b.face &&
    a.numbers === b.numbers &&
    a.outline === b.outline &&
    a.texture === b.texture &&
    a.material === b.material
  );
}

// A name unique to these values. The tray library caches colour sets by
// name and hands the cached one back for a repeat, so two different looks
// must never share a name and the same look may.
export function diceLookKey(look: DiceLook): string {
  return `odm:${look.face}:${look.numbers}:${look.outline || "none"}:${look.texture}:${look.material}`;
}

// The dice-box-threejs config fragment for a look. The custom colour set
// wins over any named theme, and the material is set both on the set and
// on the box because the library reads it from either depending on the
// path (initial load versus updateConfig).
export function diceLookTheme(look: DiceLook): {
  theme_customColorset: {
    name: string;
    foreground: string;
    background: string;
    outline: string;
    texture: string;
    material: string;
  };
  theme_material: string;
} {
  return {
    theme_customColorset: {
      name: diceLookKey(look),
      foreground: look.numbers,
      background: look.face,
      outline: look.outline || "none",
      texture: look.texture,
      material: look.material,
    },
    theme_material: look.material,
  };
}
