// The creature a transformed character is, for every number read from the
// sheet (SRD 5.1): Polymorph's and Animal Shapes' beast has none of the
// character's proficiencies, features, feats or lineage, and its gear has
// melded into the form; Wild Shape and Shapechange keep them. The scores and
// the AC come from the form itself (wildShape), read where they are read.
//
// Apart from the shape spells' rules (src/lib/srd/shape-rules.ts) because
// the derived-stat engine, which the browser loads, reads it, and the rules
// read the beast table, which stays on the server.
export function formSees<T extends {
  wildShape?: { kind?: "wildshape" | "polymorph"; keepsTraining?: boolean } | null;
  features?: Array<{ name: string }>;
  feats?: string[];
  race?: string;
  equipment?: unknown[];
  proficiencies?: { saves: string[]; skills: string[]; expertise?: string[] };
}>(sheet: T): T {
  if (sheet.wildShape?.kind !== "polymorph" || sheet.wildShape.keepsTraining) {
    return sheet;
  }
  return {
    ...sheet,
    ...(sheet.features ? { features: [] } : {}),
    ...(sheet.feats ? { feats: [] } : {}),
    ...(sheet.race !== undefined ? { race: "beast" } : {}),
    ...(sheet.equipment ? { equipment: [] } : {}),
    ...(sheet.proficiencies ? { proficiencies: { ...sheet.proficiencies, saves: [], skills: [], expertise: [] } } : {}),
  };
}
