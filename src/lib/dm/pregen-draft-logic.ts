import type { PlaystyleId } from "@/app/characters/builder/playstyles";
import { textKey } from "@/lib/language/text-logic";

// AI-drafted pregens: what the AI DM is asked, and how its answer is read.
// The model only proposes (a concept, a class, a race, a background, a name,
// a short backstory with one tie to the adventure, and a role for each
// hero); the quick-build engine builds every sheet
// (src/lib/characters/pregen-drafts.ts) and the library's own door judges
// it (src/lib/characters/admit.ts). Nothing here touches the database or a
// model, so scripts/test-pregen-drafts.mjs drives it directly.

// One hero for each seat of the party the workshop is built for (its target
// party, src/lib/workshop/kind.ts), so the most is that party's largest.
export const DRAFT_COUNT_MAX = 8;

// The reply's budget: a short JSON entry per hero with its backstory, and
// room for the wrapper. A model that runs on past it is cut off and the
// reply refused, rather than left to write until the timeout.
export function draftReplyTokens(count: number): number {
  return 400 + count * 400;
}

// The adventure as the prompt carries it. Clipped piece by piece and as a
// whole, so a workshop with forty NPCs still sends a short request: the
// prompt stays well inside the compact profile's 16K window
// (src/lib/dm/tool-profiles.ts) with room for six heroes' answer, whatever
// size the narrator is.
export const CONTEXT_MAX_CHARS = 6000;
const PREMISE_MAX = 1200;
const LINE_MAX = 220;
const HOOKS_MAX = 6;
const PEOPLE_MAX = 10;
const PLACES_MAX = 8;

export type DraftAdventure = {
  title: string;
  premise: string;
  setting: string;
  // The storyboard's "a reason to go" cards, and its place cards.
  hooks: Array<{ title: string; body: string }>;
  places: string[];
  people: Array<{ name: string; role: string; trait: string }>;
};

export type DraftOptionNames = { classes: string[]; races: string[]; backgrounds: string[] };

// One hero as the model proposed it, before anything is built.
export type HeroProposal = {
  name: string;
  concept: string;
  className: string;
  race: string;
  background: string;
  backstory: string;
  // The job at the table, in the playstyle picker's words (playstyles.ts);
  // null when the model named none the picker has.
  role: PlaystyleId | null;
};

const ROLES: readonly PlaystyleId[] = ["tank", "dps", "healer", "support", "utility"];
const ROLE_WORDS: Record<PlaystyleId, string> = {
  tank: "holds the line",
  dps: "deals the damage",
  healer: "keeps everyone alive",
  support: "helps the team and controls the fight",
  utility: "scouts and solves problems",
};

export function roleWords(role: PlaystyleId | null): string {
  return role ? ROLE_WORDS[role] : "";
}

const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

export function draftSystemPrompt(count: number, options: DraftOptionNames): string {
  return [
    `You are the Game Master preparing ${count} pregenerated player characters for the adventure the user describes. Propose a balanced party: between them someone holds the line, someone heals, someone deals damage, and someone scouts or solves problems; give each hero a different class where you can.`,
    'Return STRICT JSON only, no code fences, shaped: {"heroes": [{"name": string, "concept": string, "class": string, "race": string, "background": string, "role": "tank" | "dps" | "healer" | "support" | "utility", "backstory": string}]}',
    `There are exactly ${count} heroes. class is one of: ${options.classes.join(", ")}. race is one of: ${options.races.join(", ")}. background is one of: ${options.backgrounds.join(", ")}.`,
    "name fits the setting, and no two heroes share one. concept is one short line. backstory is two or three sentences, and one of them ties the hero to something the adventure names: a place, a person or a hook. Use only what the adventure says; invent no secret of it.",
  ].join("\n");
}

// The adventure, as the user message: whatever the workshop holds, and a
// plain line for what it does not.
export function draftUserPrompt(adventure: DraftAdventure): string {
  const lines: string[] = [];
  lines.push(`Adventure: ${clip(adventure.title, LINE_MAX) || "Untitled"}`);
  lines.push(`Premise: ${clip(adventure.premise, PREMISE_MAX) || "Not written yet."}`);
  if (adventure.setting.trim()) {
    lines.push(`Setting: ${clip(adventure.setting, LINE_MAX)}`);
  }
  const places = adventure.places.map((place) => clip(place, 80)).filter(Boolean).slice(0, PLACES_MAX);
  if (places.length) {
    lines.push(`Places: ${places.join("; ")}`);
  }
  const hooks = adventure.hooks.filter((hook) => hook.title.trim() || hook.body.trim()).slice(0, HOOKS_MAX);
  if (hooks.length) {
    lines.push("Hooks:");
    for (const hook of hooks) {
      lines.push(`- ${clip([hook.title, hook.body].filter((part) => part.trim()).join(": "), LINE_MAX)}`);
    }
  }
  const people = adventure.people.filter((person) => person.name.trim()).slice(0, PEOPLE_MAX);
  if (people.length) {
    lines.push("People:");
    for (const person of people) {
      const about = [person.role, person.trait].map((part) => part.trim()).filter(Boolean).join(", ");
      lines.push(`- ${clip(about ? `${person.name} (${about})` : person.name, LINE_MAX)}`);
    }
  }
  const text = lines.join("\n");
  return text.length > CONTEXT_MAX_CHARS ? text.slice(0, CONTEXT_MAX_CHARS) : text;
}

// The first JSON object or array in a reply: a model that wraps it in a
// fence or a sentence still answered.
function jsonIn(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((at) => at >= 0);
  if (!starts.length) {
    return null;
  }
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const field = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

export type ParsedDraft = { ok: true; heroes: HeroProposal[] } | { ok: false; error: string };

// The model's answer read whole, or refused whole: a reply that is not the
// shape asked for, holds fewer heroes than asked, or leaves a hero without
// a name, a class, a race, a background or a backstory drafts nothing.
// More heroes than asked keeps the first ones.
export function parseDraftReply(raw: string, count: number): ParsedDraft {
  const parsed = jsonIn(raw);
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { heroes?: unknown }).heroes)
      ? (parsed as { heroes: unknown[] }).heroes
      : null;
  if (!list) {
    return { ok: false, error: "The AI GM's reply was not a list of heroes, so nothing was drafted. Try again." };
  }
  if (list.length < count) {
    return {
      ok: false,
      error: `The AI GM proposed ${list.length} ${list.length === 1 ? "hero" : "heroes"}, not ${count}, so nothing was drafted. Try again.`,
    };
  }
  const heroes: HeroProposal[] = [];
  for (const [index, entry] of list.slice(0, count).entries()) {
    const hero = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const proposal: HeroProposal = {
      name: field(hero.name, 60),
      concept: field(hero.concept, 160),
      className: field(hero.class ?? hero.className, 60),
      race: field(hero.race ?? hero.species, 60),
      background: field(hero.background, 60),
      backstory: field(hero.backstory, 1200),
      role: ROLES.find((role) => role === textKey(field(hero.role, 20))) ?? null,
    };
    const missing = (["name", "className", "race", "background", "backstory"] as const).find((key) => !proposal[key]);
    if (missing) {
      const words = { name: "a name", className: "a class", race: "a race", background: "a background", backstory: "a backstory" }[missing];
      return { ok: false, error: `The AI GM's hero ${index + 1} came without ${words}, so nothing was drafted. Try again.` };
    }
    heroes.push(proposal);
  }
  return { ok: true, heroes };
}

// What a drafted sheet's notes say: who the AI DM meant this hero to be,
// and what the engine changed to build it.
export function draftNotes(proposal: HeroProposal, changes: string[]): string {
  return [
    "Drafted by the AI GM.",
    proposal.concept ? `Concept: ${proposal.concept}` : "",
    proposal.role ? `Role: ${roleWords(proposal.role)}.` : "",
    ...changes,
  ]
    .filter(Boolean)
    .join("\n");
}
