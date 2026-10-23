// The creature a transformed character is, for every number read from the
// sheet (SRD 5.1): the creature of Polymorph, Animal Shapes or True
// Polymorph has none of the character's proficiencies, features, feats or
// lineage, and its gear has melded into the form; Wild Shape and
// Shapechange keep them. The scores and the AC come from the form itself
// (wildShape), read where they are read.
//
// Apart from the shape spells' rules (src/lib/srd/shape-rules.ts) because
// the derived-stat engine, which the browser loads, reads it, and the rules
// read the beast table, which stays on the server.
export function formSees<T extends {
  wildShape?: { kind?: "wildshape" | "polymorph"; keepsTraining?: boolean; type?: string; saves?: string[] } | null;
  features?: Array<{ name: string }>;
  feats?: string[];
  race?: string;
  equipment?: unknown[];
  proficiencies?: { saves: string[]; skills: string[]; expertise?: string[] };
}>(sheet: T): T {
  const shape = sheet.wildShape;
  if (!shape) {
    return sheet;
  }
  // Wild Shape and Shapechange keep the character's saving throw
  // proficiencies and gain the form's (an adult dragon's Dexterity save).
  if (shape.kind !== "polymorph" || shape.keepsTraining) {
    return shape.saves?.length && sheet.proficiencies
      ? { ...sheet, proficiencies: { ...sheet.proficiencies, saves: [...new Set([...sheet.proficiencies.saves, ...shape.saves])] } }
      : sheet;
  }
  // Polymorph, Animal Shapes, True Polymorph: the form's alone, and its
  // kind of creature in place of the character's lineage (a record from
  // before the type was kept is a beast's).
  return {
    ...sheet,
    ...(sheet.features ? { features: [] } : {}),
    ...(sheet.feats ? { feats: [] } : {}),
    ...(sheet.race !== undefined ? { race: shape.type ?? "beast" } : {}),
    ...(sheet.equipment ? { equipment: [] } : {}),
    ...(sheet.proficiencies ? { proficiencies: { ...sheet.proficiencies, saves: [...(shape.saves ?? [])], skills: [], expertise: [] } } : {}),
  };
}
