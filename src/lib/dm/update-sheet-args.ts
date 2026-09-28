// "Correct a sheet", as a person fills it in.
//
// The model sends update_sheet the sheet's own keys ({ level: 5 }). The
// console's form cannot: a form is a fixed list of inputs, and one input per
// key of a sheet would be a second sheet editor. So the form sends the name
// of ONE field and what it becomes, and this module turns that pair into the
// keys the handler takes. The form used to send the pair with nothing to
// read it, and every correction answered "changed nothing".
//
// Pure by design: no "@/" value imports and no I/O, so the catalog and the
// guard tests can load it.

type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export type UpdateSheetField = {
  name: string;
  label: string;
  kind: "text" | "number" | "ability" | "list";
};

// What the form offers. Feats and features are structured rows, which the
// sheet's own edit dialog writes; everything else update_sheet may write is
// here.
export const UPDATE_SHEET_FIELDS: UpdateSheetField[] = [
  { name: "name", label: "Name", kind: "text" },
  { name: "race", label: "Race", kind: "text" },
  { name: "class", label: "Class", kind: "text" },
  { name: "subclass", label: "Subclass", kind: "text" },
  { name: "background", label: "Background", kind: "text" },
  { name: "alignment", label: "Alignment", kind: "text" },
  { name: "level", label: "Level", kind: "number" },
  { name: "xp", label: "Experience points", kind: "number" },
  { name: "maxHp", label: "Maximum hit points", kind: "number" },
  { name: "currentHp", label: "Current hit points", kind: "number" },
  { name: "tempHp", label: "Temporary hit points", kind: "number" },
  { name: "ac", label: "Armor class", kind: "number" },
  { name: "speed", label: "Speed", kind: "number" },
  { name: "gold", label: "Gold", kind: "number" },
  { name: "str", label: "Strength", kind: "ability" },
  { name: "dex", label: "Dexterity", kind: "ability" },
  { name: "con", label: "Constitution", kind: "ability" },
  { name: "int", label: "Intelligence", kind: "ability" },
  { name: "wis", label: "Wisdom", kind: "ability" },
  { name: "cha", label: "Charisma", kind: "ability" },
  { name: "conditions", label: "Conditions", kind: "list" },
];

const squash = (text: string) => text.toLowerCase().replace(/[^a-z]/g, "");

// A person types "Max HP" or "hp" where the key is maxHp or currentHp.
const SPOKEN: Record<string, string> = {
  hp: "currentHp",
  hitpoints: "currentHp",
  maxhp: "maxHp",
  maxhitpoints: "maxHp",
  temphp: "tempHp",
  armorclass: "ac",
  experience: "xp",
};

function fieldNamed(raw: string): UpdateSheetField | null {
  const wanted = squash(raw);
  if (!wanted) {
    return null;
  }
  const key = SPOKEN[wanted];
  return (
    UPDATE_SHEET_FIELDS.find(
      (field) => field.name === key || squash(field.name) === wanted || squash(field.label) === wanted,
    ) ?? null
  );
}

export type FoldedArgs = { args: Record<string, unknown> } | { error: string };

// The arguments with `field` and `value` folded into the sheet's own keys.
// Arguments that carry no `field` pass through untouched, which is every
// call the model makes. A key sent beside the pair is kept, and wins over it.
export function foldFieldValue(
  raw: Record<string, unknown>,
  abilities: Record<Ability, number>,
): FoldedArgs {
  const { field, value, ...rest } = raw;
  if (field === undefined || field === null || field === "") {
    // `value` alone names nothing; it is dropped as it always was.
    return { args: rest };
  }
  const found = typeof field === "string" ? fieldNamed(field) : null;
  if (!found) {
    return {
      error: `A sheet has no field called "${String(field)}". Pick one of: ${UPDATE_SHEET_FIELDS.map((entry) => entry.name).join(", ")}.`,
    };
  }
  if (value === undefined || value === null) {
    return { error: `Say what ${found.label.toLowerCase()} becomes.` };
  }
  if (found.kind === "list") {
    const list = Array.isArray(value)
      ? value.map(String)
      : String(value).split(/[,\n]/);
    const names = list.map((entry) => entry.trim()).filter(Boolean);
    const cleared = names.length === 1 && /^(none|nothing|clear)$/i.test(names[0]);
    return { args: { [found.name]: cleared ? [] : names, ...rest } };
  }
  if (found.kind === "text") {
    return { args: { [found.name]: String(value).trim(), ...rest } };
  }
  const text = String(value).trim().replace(/,/g, "");
  const number = Number(text);
  if (!text || !Number.isFinite(number) || !Number.isInteger(number)) {
    return { error: `${found.label} takes a whole number, and "${String(value)}" is not one.` };
  }
  if (found.kind === "ability") {
    const current = (rest.abilities ?? abilities) as Record<Ability, number>;
    return { args: { ...rest, abilities: { ...current, [found.name]: number } } };
  }
  return { args: { [found.name]: number, ...rest } };
}
