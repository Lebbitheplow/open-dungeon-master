// Freeform attributes: typed key/value facts a DM can hang on anything in the
// campaign without a schema change.
//
// ODM's schemas are deliberately specific, which is right for hit points and
// wrong for the thing a table invents on a Tuesday: a faction's standing with
// the harbour guild, a ritual's completion counter, how many barrels of
// lamp oil the warehouse still has, a die a cursed sword rolls each dawn.
// Every one of those used to need a migration or a note nobody could roll.
//
// The idea and the shape are reimplemented from the MIT-licensed Simple
// Worldbuilding system: attributes with a name, a type, a value and an
// optional group, plus formula attributes that are rollable. No code is
// copied; see docs/LICENSES.md.
//
// Pure by design: no imports at all, so scripts/test-attributes.mjs can load
// it and the client can validate a value before sending it.

export const ATTRIBUTE_TYPES = ["text", "number", "boolean", "resource", "formula"] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const ATTRIBUTE_TYPE_LABELS: Record<AttributeType, string> = {
  text: "Text",
  number: "Number",
  boolean: "Yes or no",
  resource: "Counter",
  formula: "Rollable",
};

export const ATTRIBUTE_TYPE_HINTS: Record<AttributeType, string> = {
  text: "A word or a line. A motto, a password, a colour.",
  number: "One number, which the DM can nudge up or down.",
  boolean: "On or off. Whether the gate is barred.",
  resource: "A counter with a maximum. Ritual progress, barrels of oil, a clock.",
  formula: "A dice expression the table can roll. 2d6+1, 1d100.",
};

// What a target can be. Deliberately open in kind but closed as a union, so a
// stray attribute can never be written against a kind nothing renders.
export const ATTRIBUTE_TARGETS = ["npc", "item", "location", "faction", "prop", "campaign"] as const;
export type AttributeTarget = (typeof ATTRIBUTE_TARGETS)[number];

export const NAME_MAX = 40;
export const GROUP_MAX = 30;
export const TEXT_VALUE_MAX = 200;
export const MAX_ATTRIBUTES_PER_TARGET = 40;

export type Attribute = {
  // Stable within a target. Lowercased and stripped so "Lamp Oil" and
  // "lamp oil" are the same fact rather than two rows that disagree.
  key: string;
  // What the DM typed, shown as-is.
  label: string;
  type: AttributeType;
  // The stored value, in the shape the type implies: string for text and
  // formula, number for number and resource, boolean for boolean.
  value: string | number | boolean;
  // Only meaningful for "resource": the ceiling the counter runs to.
  max?: number;
  // Optional heading the console groups by. Empty means ungrouped.
  group: string;
  // Shown to the players. Off by default: a DM inventing a faction track is
  // usually inventing a secret.
  visible: boolean;
};

export function attributeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, NAME_MAX);
}

// A dice expression, in the same shape src/lib/dice.ts accepts. Checked here
// with a deliberately narrow pattern rather than by importing the roller,
// because this module stays import-free and the roller validates again.
const FORMULA = /^\s*\d{0,3}d\d{1,3}(\s*[+-]\s*\d{1,4})?(\s*[+-]\s*\d{0,3}d\d{1,3})*\s*$/i;

export function isFormula(value: string): boolean {
  return FORMULA.test(value);
}

export type AttributeInput = {
  label: string;
  type: AttributeType;
  value?: unknown;
  max?: unknown;
  group?: unknown;
  visible?: unknown;
};

// Building one attribute from what a form or a tool call sent. Returns an
// error string rather than throwing, because every caller is a route or a
// tool handler that has to say what went wrong.
export function buildAttribute(input: AttributeInput): { attribute: Attribute } | { error: string } {
  const label = String(input.label ?? "").trim().slice(0, NAME_MAX);
  if (!label) {
    return { error: "Name the attribute." };
  }
  const key = attributeKey(label);
  if (!key) {
    return { error: "That name has no letters or numbers in it." };
  }
  if (!ATTRIBUTE_TYPES.includes(input.type)) {
    return { error: `Unknown attribute type "${input.type}".` };
  }

  const group = String(input.group ?? "").trim().slice(0, GROUP_MAX);
  const visible = input.visible === true;

  if (input.type === "boolean") {
    return {
      attribute: { key, label, type: "boolean", value: input.value === true, group, visible },
    };
  }
  if (input.type === "number" || input.type === "resource") {
    const value = Math.round(Number(input.value));
    if (!Number.isFinite(value)) {
      return { error: `${label} needs a number.` };
    }
    if (input.type === "number") {
      return { attribute: { key, label, type: "number", value, group, visible } };
    }
    const max = Math.round(Number(input.max));
    if (!Number.isFinite(max) || max <= 0) {
      return { error: `${label} is a counter; give it a maximum above zero.` };
    }
    // A counter is clamped to its own range on the way in, so nothing
    // downstream has to defend against a track reading 9 of 5.
    return {
      attribute: {
        key,
        label,
        type: "resource",
        value: Math.min(max, Math.max(0, value)),
        max,
        group,
        visible,
      },
    };
  }
  const text = String(input.value ?? "").trim().slice(0, TEXT_VALUE_MAX);
  if (input.type === "formula") {
    if (!isFormula(text)) {
      return { error: `"${text}" is not a dice expression; try something like 2d6+1.` };
    }
    return { attribute: { key, label, type: "formula", value: text, group, visible } };
  }
  return { attribute: { key, label, type: "text", value: text, group, visible } };
}

export function normalizeAttributes(raw: unknown): Attribute[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Attribute[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    const built = buildAttribute({
      label: String(entry?.label ?? entry?.key ?? ""),
      type: (entry?.type as AttributeType) ?? "text",
      value: entry?.value,
      max: entry?.max,
      group: entry?.group,
      visible: entry?.visible,
    });
    if ("attribute" in built) {
      out.push(built.attribute);
    }
    if (out.length >= MAX_ATTRIBUTES_PER_TARGET) {
      break;
    }
  }
  return out;
}

// Setting one attribute, replacing any with the same key. Ordered by
// insertion so the console shows them in the order the DM invented them.
export function setAttribute(
  attributes: Attribute[],
  attribute: Attribute,
): { attributes: Attribute[] } | { error: string } {
  const index = attributes.findIndex((entry) => entry.key === attribute.key);
  if (index < 0) {
    if (attributes.length >= MAX_ATTRIBUTES_PER_TARGET) {
      return {
        error: `That already carries ${MAX_ATTRIBUTES_PER_TARGET} attributes; clear one first.`,
      };
    }
    return { attributes: [...attributes, attribute] };
  }
  const next = [...attributes];
  next[index] = attribute;
  return { attributes: next };
}

export function removeAttribute(attributes: Attribute[], key: string): Attribute[] {
  return attributes.filter((entry) => entry.key !== key);
}

// Nudging a number or a counter without restating it. A counter stays inside
// its own range; a plain number is free to go anywhere, because a debt and a
// temperature are both legitimate.
export function adjustAttribute(
  attributes: Attribute[],
  key: string,
  delta: number,
): { attributes: Attribute[]; attribute: Attribute } | { error: string } {
  const index = attributes.findIndex((entry) => entry.key === key);
  if (index < 0) {
    return { error: `Nothing here has an attribute called "${key}".` };
  }
  const current = attributes[index];
  if (current.type !== "number" && current.type !== "resource") {
    return { error: `${current.label} is ${ATTRIBUTE_TYPE_LABELS[current.type].toLowerCase()}, not a number.` };
  }
  const raw = Number(current.value) + Math.round(delta);
  const value =
    current.type === "resource" ? Math.min(current.max ?? raw, Math.max(0, raw)) : raw;
  const attribute = { ...current, value };
  const next = [...attributes];
  next[index] = attribute;
  return { attributes: next, attribute };
}

// One line per attribute, for the DM prompt and for anything that renders a
// list. A counter reads "3/5" because that is the whole of what it says.
export function describeAttribute(attribute: Attribute): string {
  if (attribute.type === "resource") {
    return `${attribute.label}: ${attribute.value}/${attribute.max ?? attribute.value}`;
  }
  if (attribute.type === "boolean") {
    return `${attribute.label}: ${attribute.value ? "yes" : "no"}`;
  }
  if (attribute.type === "formula") {
    return `${attribute.label}: roll ${attribute.value}`;
  }
  return `${attribute.label}: ${attribute.value}`;
}

// Grouped for rendering, ungrouped first so the plain facts lead.
export function groupAttributes(
  attributes: Attribute[],
): Array<{ group: string; attributes: Attribute[] }> {
  const groups = new Map<string, Attribute[]>();
  for (const attribute of attributes) {
    const list = groups.get(attribute.group) ?? [];
    list.push(attribute);
    groups.set(attribute.group, list);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0])))
    .map(([group, list]) => ({ group, attributes: list }));
}

// What the players may see. Every projection asks this rather than filtering
// at the call site, which is the same rule the viewer model already holds:
// one place to get "is this a secret" wrong instead of several.
export function visibleAttributes(attributes: Attribute[], secretsAllowed: boolean): Attribute[] {
  return secretsAllowed ? attributes : attributes.filter((attribute) => attribute.visible);
}
