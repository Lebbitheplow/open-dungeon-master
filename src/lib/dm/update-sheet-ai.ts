// What update_sheet may write when the AI DM sends it.
//
// update_sheet is the table's correction tool, and at the DM's console it
// stays one: a person may set any field it names, audited. From the model it
// is something else. The engine resolves and the model narrates, so a field
// the rules move (a level from the player's own level-up, hit points from
// heal and apply_damage, a condition from set_condition, an armor class from
// the armor worn) is never the model's to type in; a number it could assert
// that way would skip the roll, the cost and the rule behind it. What is left
// to the model is who a character is in the story: a name, a race after a
// reincarnation, a background, an alignment, a speed a curse changed, a
// score a tome raised, a feat or a lasting ability the story granted.
//
// Pure, so the refusal text is testable without a database.

// Each field the model may not write, and where that change really comes
// from, in the words the refusal gives it.
const ENGINE_OWNED: Record<string, string> = {
  level: "a level comes from the player's own level-up once award_xp makes one available",
  xp: "experience moves through award_xp",
  maxHp: "a hit point maximum comes from the level-up and the rules that change it",
  currentHp: "hit points move through heal and apply_damage",
  tempHp: "temporary hit points come from heal with temp:true",
  ac: "armor class is derived from what the character wears; a lasting bonus goes through set_effect",
  conditions: "conditions move through set_condition and clear_condition",
  gold: "coins move through modify_gold",
  class: "a class changes only through the player's level-up",
  subclass: "a subclass is the player's pick at level-up",
};

export const AI_SHEET_FIELDS_REFUSED = Object.keys(ENGINE_OWNED);

// The refusal for the first engine-owned field a model's patch names, or
// null when every field is the story's.
export function aiSheetFieldRefusal(fields: readonly string[]): string | null {
  const owned = fields.find((field) => field in ENGINE_OWNED);
  if (!owned) {
    return null;
  }
  return `update_sheet from the DM cannot set ${owned}: ${ENGINE_OWNED[owned]}. Send only the story fields (name, race, background, alignment, speed, abilities, feats, story features).`;
}
