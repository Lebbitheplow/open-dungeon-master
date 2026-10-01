// The six ability ids, in sheet order. Split from sheet.ts (which re-exports
// both) so the schemas beside it can use them without loading the sheet
// schema.

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type Ability = (typeof ABILITIES)[number];
