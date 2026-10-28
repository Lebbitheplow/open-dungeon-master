import { abilityName } from "./lineage";

// A card's words with each ability code ("CON +2", "INT caster") printed as
// it is and spoken as the ability's name (backlog F11): the code is hidden
// from a screen reader and the name sits beside it for one only, so "CON +2"
// is heard as "Constitution +2". The abbreviation's title shows the name to a
// pointer that rests on it.
const CODE = /\b(STR|DEX|CON|INT|WIS|CHA)\b/;

export function AbilityText({ text }: { text: string }) {
  const parts = text.split(CODE);
  if (parts.length === 1) {
    return text;
  }
  return parts.map((part, index) => {
    if (index % 2 === 0) {
      return part;
    }
    const name = abilityName(part.toLowerCase());
    return (
      <abbr key={index} title={name} className="no-underline">
        <span aria-hidden="true">{part}</span>
        <span className="sr-only">{name}</span>
      </abbr>
    );
  });
}
