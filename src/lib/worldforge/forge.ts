import { LINK_LABELS, typeFor, type Shelf, type WorldDoc, type WorldType } from "./model.ts";
import { fieldLines, formatYear } from "./time.ts";
import { canonAdmits, canonTag, eventLine, pickEvents } from "./canon.ts";
import type { Named } from "./text.ts";
import { accountOf } from "./account.ts";
import { textKey } from "../language/text-logic.ts";

// WorldForge's AI tools, the pure half (the model calls are in
// src/lib/dm/world-ai.ts), after WorldForge's forge, ask and draft (by
// Smoebo). The rule WorldForge settled on holds here: resolve generously,
// store strictly. Whatever the model answers is coerced to what the world
// could hold before anyone sees it: a type that is not one of the world's
// becomes its catch-all, a link word that is not one of WorldForge's is
// dropped, a link to a name nobody has is dropped, and the forge only ever
// adds: a name the world already has is shown as there, never rewritten.

export type ForgeEntity = { key: string; name: string; typeId: string; summary: string; aliases: string[]; hiddenTruth: string; existing: string };
export type ForgeLink = { from: string; to: string; label: string };
export type ForgePreview = { entities: ForgeEntity[]; links: ForgeLink[] };

type Raw = Record<string, unknown>;
const rec = (value: unknown): Raw => (value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {});
const str = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// The JSON object in a model's reply: past a code fence or a sentence of
// preamble, with raw line breaks inside strings (which models write and
// JSON.parse refuses) escaped first.
export function replyJson(raw: string): Raw | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let body = "";
  let inString = false;
  let escaped = false;
  for (const char of cleaned.slice(start, end + 1)) {
    if (inString && !escaped && (char === "\n" || char === "\r" || char === "\t")) {
      body += char === "\n" ? "\\n" : char === "\t" ? "\\t" : "";
      continue;
    }
    if (char === '"' && !escaped) inString = !inString;
    escaped = char === "\\" && !escaped;
    body += char;
  }
  try {
    const parsed = JSON.parse(body);
    return rec(parsed);
  } catch {
    return null;
  }
}

// ---- forge ----

export function forgeMessages(text: string, types: WorldType[], known: string[], hint: string) {
  return [
    {
      role: "system" as const,
      content: [
        "You read a game master's notes about their tabletop world and list what in them deserves an encyclopedia entry: people, places, factions, objects, gods, peoples, anything with a proper name.",
        'Reply with one JSON object and nothing else: {"entities":[{"name":"","type":"","summary":"","aliases":[],"hiddenTruth":""}],"links":[{"from":"","to":"","label":""}]}',
        `"type" is exactly one of: ${types.map((type) => type.name).join(", ")}.`,
        `"label" is exactly one of: ${LINK_LABELS.join(", ")}. Leave a relationship out rather than invent a word.`,
        '"summary" is one to three sentences in the world\'s own voice: never mention the notes, the game or the players.',
        '"hiddenTruth" only for what the notes say is secret, false or unknown to the world; otherwise "".',
        '"from" and "to" are names from your entities or from the names the world already has.',
        "List each thing once. Do not invent things the notes do not mention.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        known.length ? `The world already has: ${known.slice(0, 200).join(", ")}.` : "",
        hint ? `The game master asks: ${hint}` : "",
        "The notes:",
        text,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

export function readForgeReply(reply: Raw | null, doc: Pick<WorldDoc, "types">, named: Named[]): ForgePreview {
  const byHandle = new Map<string, string>();
  for (const entry of named) for (const handle of [entry.name, ...entry.aliases]) byHandle.set(textKey(handle), entry.ref);
  const catchAll = doc.types.find((type) => textKey(type.name) === "other") ?? doc.types.find((type) => type.shelf === "lore") ?? doc.types[0];
  const entities: ForgeEntity[] = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(reply?.entities) ? reply!.entities : []).slice(0, 60)) {
    const row = rec(raw);
    const name = str(row.name, 80);
    const low = textKey(name);
    if (!name || seen.has(low)) continue;
    seen.add(low);
    const type = doc.types.find((entry) => textKey(entry.name) === textKey(str(row.type, 40))) ?? catchAll;
    entities.push({
      key: `new:${entities.length}`,
      name,
      typeId: type.id,
      summary: str(row.summary, 2_000),
      aliases: (Array.isArray(row.aliases) ? row.aliases : []).map((alias) => str(alias, 80)).filter((alias) => alias && textKey(alias) !== low).slice(0, 6),
      hiddenTruth: str(row.hiddenTruth, 1_000),
      existing: byHandle.get(low) ?? "",
    });
  }
  const endpoint = (value: unknown) => {
    const low = textKey(str(value, 80));
    const fresh = entities.find((entity) => textKey(entity.name) === low || entity.aliases.some((alias) => textKey(alias) === low));
    return fresh ? fresh.existing || fresh.key : byHandle.get(low) ?? "";
  };
  const labels = new Map((LINK_LABELS as readonly string[]).map((label) => [label, label]));
  const links: ForgeLink[] = [];
  const linkSeen = new Set<string>();
  for (const raw of (Array.isArray(reply?.links) ? reply!.links : []).slice(0, 120)) {
    const row = rec(raw);
    const label = labels.get(str(row.label, 40).toLowerCase());
    const from = endpoint(row.from);
    const to = endpoint(row.to);
    const key = `${from}|${to}|${label}`;
    if (!label || !from || !to || from === to || linkSeen.has(key)) continue;
    linkSeen.add(key);
    links.push({ from, to, label });
  }
  return { entities, links };
}

// ---- the world, in words a model can read ----

// An entry as Ask (ask.ts) and Draft read it.
export type DigestEntity = { ref: string; shelf: Shelf; name: string; aliases: string[]; tags: string[]; tagline: string; text: string; entry: WorldDoc["entries"][string] };

// What Draft is told about an entry: its own texts and fields, its open
// ties and its events. It follows the canon policy every model path shares
// (canon.ts): a retired neighbour or event is left out, a draft or alternate
// one is tagged so the draft never writes it as fact, and the events are the
// settled and the latest, read forward in the world's own calendars.
export function draftKnown(doc: WorldDoc, entities: DigestEntity[], entity: DigestEntity): string[] {
  const type = typeFor(doc, entity.shelf, entity.entry.typeId);
  const ref = entity.ref;
  const nameOf = new Map(
    entities.filter((entry) => canonAdmits(entry.entry.canon, "play")).map((entry) => [entry.ref, `${entry.name}${canonTag(entry.entry.canon)}`]),
  );
  const account = accountOf(entity);
  return [
    entity.tagline ? `In one line: ${entity.tagline}` : "",
    account ? `What is written so far: ${account.slice(0, 1_500)}` : "",
    entity.aliases.length ? `Also called: ${entity.aliases.join(", ")}` : "",
    ...fieldLines(type, entity.entry, doc.calendars, false).map(({ def, text }) => `${def.name}: ${text}`),
    ...doc.links
      .filter((link) => link.veracity !== "hidden" && ((link.from === ref && nameOf.has(link.to)) || (link.to === ref && !link.oneway && nameOf.has(link.from))))
      .slice(0, 12)
      .map((link) => (link.from === ref ? `${entity.name} ${link.label} ${nameOf.get(link.to)}` : `${nameOf.get(link.from)} ${link.label} ${entity.name}`)),
    ...pickEvents(doc.events.filter((event) => event.refs.includes(ref)), doc.calendars, "play", 8).map(
      (event) => `Event, ${formatYear(event.when, doc.calendars).primary ? "" : "undated: "}${eventLine(event, doc.calendars, true)}`,
    ),
  ].filter(Boolean);
}

// `asks` is what the entry's kind needs covered (adapters.ts DRAFT_ASKS);
// `rules` the playable record it links to, read back so the entry agrees
// with what the table plays.
export function draftMessages(input: { worldName: string; name: string; typeName: string; known: string[]; hiddenTruth: string; hint: string; asks?: string; rules?: string[] }) {
  return [
    {
      role: "system" as const,
      content: [
        `You write encyclopedia entries for ${input.worldName}, a tabletop world.`,
        "Write the entry asked for in two or three short paragraphs, in the world's own voice: no game statistics, no mention of players or of the game.",
        input.asks ?? "",
        "Use only what you are told and what follows from it. A hidden truth may colour the entry with hints, but it must never be stated.",
        "A fact tagged [draft] is not settled and one tagged [alternate] is another telling, not what happened: write neither as plain fact.",
        "Reply with the entry's text only.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `The entry: ${input.name}, a ${input.typeName.toLowerCase()}.`,
        ...input.known,
        input.hiddenTruth ? `Hidden truth (never state it): ${input.hiddenTruth}` : "",
        ...(input.rules ?? []).map((line) => `Its rules at the table, which the entry must agree with but never quote: ${line}`),
        input.hint ? `The game master asks: ${input.hint}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

// WorldForge paints each type its own way: a face, a vista, a sigil, an
// illustration. The name is left out on purpose: an image model is not
// improved by a proper noun it has never seen.
export function paintPrompt(shelf: Shelf, typeName: string, about: string, style: string): string {
  const what =
    shelf === "npc"
      ? "Tabletop RPG character portrait, head and shoulders, centered, looking at viewer"
      : shelf === "location"
        ? "Sweeping fantasy landscape painting of a place, atmospheric, cinematic lighting, matte painting"
        : shelf === "faction"
          ? "Heraldic sigil of a faction, a crest on a shield or banner, rich symbolic detail, centered emblem, no people"
          : /artifact|item|relic|weapon|object/i.test(typeName)
            ? "A single legendary object on its own, museum-quality rendering on a dark background, no people, no figures"
            : "Detailed fantasy illustration of the subject described, evocative and painterly";
  return [what, style, about.replace(/\s+/g, " ").slice(0, 400), "No text, no letters"].filter(Boolean).join(". ");
}

// ---- what an apply did ----

// The forge's apply, answered (src/lib/db/world-forge-io.ts applyForge):
// what was made, and every entry, link and name that was not, with why.
export type ForgeApplied = {
  created: number;
  links: number;
  stubs: number;
  skipped: string[];
  made: Array<{ key: string; name: string; ref: string }>;
  failed: Array<{ key: string; name: string; error: string }>;
  linksLeft: Array<{ from: string; to: string; label: string; why: string }>;
  stubsLeft: Array<{ name: string; why: string }>;
};

const counted = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const bare = (reason: string) => (reason.endsWith(".") ? reason.slice(0, -1) : reason);

// The report, line by line: what was applied first, then each kind of thing
// that was not, with why (`left`). `partial` is true when anything asked for
// was left out, so a links-only or partial apply never reads as whole.
export type ReportLine = { text: string; left: boolean };

export function forgeReport(applied: ForgeApplied): { lines: ReportLine[]; partial: boolean } {
  const added = [
    applied.created ? counted(applied.created, "entry", "entries") : "",
    applied.links ? counted(applied.links, "link", "links") : "",
  ].filter(Boolean);
  const kept = applied.stubs ? `kept ${counted(applied.stubs, "name", "names")} to write` : "";
  const first = added.length ? `Added ${added.join(" and ")}${kept ? `, and ${kept}` : ""}.` : kept ? `Only ${kept}.` : "Nothing was added.";
  const lines: ReportLine[] = [{ text: first, left: false }];
  if (applied.made.length) lines.push({ text: `New: ${applied.made.map((row) => row.name).join(", ")}.`, left: false });
  if (applied.failed.length) lines.push({ text: `Not added: ${applied.failed.map((row) => `${row.name} (${bare(row.error)})`).join("; ")}.`, left: true });
  if (applied.linksLeft.length) lines.push({ text: `Links not added: ${applied.linksLeft.map((link) => `${link.from} ${link.label} ${link.to} (${link.why})`).join("; ")}.`, left: true });
  if (applied.stubsLeft.length) lines.push({ text: `Names not kept to write: ${applied.stubsLeft.map((stub) => `${stub.name} (${stub.why})`).join("; ")}.`, left: true });
  return { lines, partial: lines.some((line) => line.left) };
}
