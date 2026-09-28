// A tool proficiency the rules leave to the player ("three musical
// instruments of your choice", "one artisan's tools", "one gaming set") is a
// choice among named tools, and the sheet should name the ones chosen: a
// tool check needs a tool to be proficient with, and a sentence is none.
//
// The class and background rows keep their SRD wording; this module reads
// that wording as a pick, so the builder can offer it and the server can
// check it, and a sheet stored with the sentence still reads.

// SRD 5.1, Equipment, Tools.
export const ARTISANS_TOOLS = [
  "alchemist's supplies",
  "brewer's supplies",
  "calligrapher's supplies",
  "carpenter's tools",
  "cartographer's tools",
  "cobbler's tools",
  "cook's utensils",
  "glassblower's tools",
  "jeweler's tools",
  "leatherworker's tools",
  "mason's tools",
  "painter's supplies",
  "potter's tools",
  "smith's tools",
  "tinker's tools",
  "weaver's tools",
  "woodcarver's tools",
];

export const MUSICAL_INSTRUMENTS = [
  "bagpipes",
  "drum",
  "dulcimer",
  "flute",
  "lute",
  "lyre",
  "horn",
  "pan flute",
  "shawm",
  "viol",
];

export const GAMING_SETS = ["dice set", "dragonchess set", "playing card set", "three-dragon ante set"];

export type ToolChoice = { count: number; from: string[]; label: string };

const COUNTS: Record<string, number> = { one: 1, two: 2, three: 3, a: 1, any: 1 };

// The pick a tool entry stands for, or null when the entry names a tool.
export function toolChoiceOf(entry: string): ToolChoice | null {
  const text = entry.trim().toLowerCase();
  const kinds: Array<[RegExp, string[], string]> = [
    [/artisan'?s? tools?/, ARTISANS_TOOLS, "artisan's tools"],
    [/musical instruments?/, MUSICAL_INSTRUMENTS, "musical instrument"],
    [/gaming sets?/, GAMING_SETS, "gaming set"],
  ];
  const from: string[] = [];
  const labels: string[] = [];
  for (const [pattern, tools, label] of kinds) {
    if (pattern.test(text)) {
      from.push(...tools);
      labels.push(label);
    }
  }
  if (!from.length) {
    return null;
  }
  // "one artisan's tools or one musical instrument": one pick from both.
  const word = /^(one|two|three|a|any)\b/.exec(text)?.[1];
  const count = word ? COUNTS[word] : /^(\d+)/.test(text) ? Number(/^(\d+)/.exec(text)![1]) : 1;
  return { count, from, label: labels.join(" or ") };
}

// A grant's tool list split into what it names and what it leaves to the
// player: ["disguise kit", "one musical instrument"] is the disguise kit and
// one pick among the instruments.
export function splitToolGrants(tools: string[]): { fixed: string[]; choices: ToolChoice[] } {
  const fixed: string[] = [];
  const choices: ToolChoice[] = [];
  for (const entry of tools) {
    const choice = toolChoiceOf(entry);
    if (choice) {
      choices.push(choice);
    } else {
      fixed.push(entry);
    }
  }
  return { fixed, choices };
}

// What is still to choose once these tools are placed on the choices they
// fit, as the sentence a player acts on, or null when every choice is
// answered. Tools that fit no open choice are passed over: this asks only
// whether anything is owed (a character made here must name its tools).
export function toolPicksOwed(choices: ToolChoice[], tools: string[]): string | null {
  const left = choices.map((choice) => choice.count);
  for (const tool of tools.map((entry) => entry.trim().toLowerCase())) {
    const slot = choices.findIndex((choice, index) => left[index] > 0 && choice.from.includes(tool));
    if (slot >= 0) {
      left[slot] -= 1;
    }
  }
  const owed = choices
    .map((choice, index) => ({ choice, left: left[index] }))
    .filter((entry) => entry.left > 0);
  return owed.length
    ? `Choose ${owed.map((entry) => `${entry.left} ${entry.choice.label}${entry.left === 1 ? "" : "s"}`).join(" and ")} to be proficient with.`
    : null;
}

// Why these picks do not answer these choices, or null. Each pick must be a
// tool one of the choices offers, a choice takes no more picks than its
// count, and every choice is answered in full.
export function toolPickProblem(choices: ToolChoice[], picks: string[]): string | null {
  const left = choices.map((choice) => choice.count);
  const wanted = picks.map((pick) => pick.trim().toLowerCase()).filter(Boolean);
  for (const pick of wanted) {
    const slot = choices.findIndex((choice, index) => left[index] > 0 && choice.from.includes(pick));
    if (slot < 0) {
      return `${pick} is not a tool this character may choose; the choices are ${choices.map((choice) => `${choice.count} ${choice.label}`).join(" and ")}.`;
    }
    left[slot] -= 1;
  }
  const owed = choices
    .map((choice, index) => ({ choice, left: left[index] }))
    .filter((entry) => entry.left > 0);
  if (owed.length) {
    return `Choose ${owed.map((entry) => `${entry.left} more ${entry.choice.label}`).join(" and ")}.`;
  }
  return null;
}
