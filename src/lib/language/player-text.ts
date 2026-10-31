// A rules line written for the GM model, as the table reads it. The
// registry's condition summaries and the spells' mechanics notes are read by
// the model (a tool result, GAME STATE) and shown to players (a condition
// chip, a Hand card) from one string, so a chip read "Resolve it with
// pc_attack, weapon 'Spiritual Weapon'" (issue 659). What names a GM tool
// (a snake_case word such as pc_attack) is the model's alone: the clause
// inside brackets that names one is dropped, and so is a sentence that still
// names one, while the rules words around them stay.
//
// Pure: a string in, a string out.

const TOOL = /\b[a-z]+(?:_[a-z]+)+\b/;
// A tool named after its verb ("Clenched Fist via pc_attack"): the verb's
// object stays, "via pc_attack" goes.
const VIA_TOOL = /\s+(?:via|with|through)\s+[a-z]+(?:_[a-z]+)+\b/g;
// The model's argument for the attack, "weapon 'Spiritual Weapon'".
const WEAPON_ARG = /^weapon\s+["'].*["']$/i;

function bracketed(inner: string): string {
  const items = inner
    .replace(VIA_TOOL, "")
    .split(/,\s*/)
    .map((item) => item.trim())
    .filter((item) => item && !TOOL.test(item) && !WEAPON_ARG.test(item) && !/^resolve(?:d| it)?$/i.test(item));
  return items.join(", ");
}

export function forPlayers(text: string): string {
  if (!TOOL.test(text)) {
    return text;
  }
  const kept = text.replace(/\s*\(([^()]*)\)/g, (whole, inner: string) => {
    if (!TOOL.test(inner) && !WEAPON_ARG.test(inner.trim())) {
      return whole;
    }
    const left = bracketed(inner);
    return left ? ` (${left})` : "";
  });
  const sentences = kept.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() && !TOOL.test(sentence));
  return sentences.join(" ").replace(/\s+([,.;:])/g, "$1").trim();
}
