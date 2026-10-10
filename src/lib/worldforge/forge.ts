import { LINK_LABELS, typeFor, type Shelf, type WorldDoc, type WorldType } from "./model.ts";
import { fieldLines, formatYear, sortEvents } from "./time.ts";
import { mentionSegments, type Named } from "./text.ts";

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
  for (const entry of named) for (const handle of [entry.name, ...entry.aliases]) byHandle.set(handle.trim().toLowerCase(), entry.ref);
  const catchAll = doc.types.find((type) => type.name.toLowerCase() === "other") ?? doc.types.find((type) => type.shelf === "lore") ?? doc.types[0];
  const entities: ForgeEntity[] = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(reply?.entities) ? reply!.entities : []).slice(0, 60)) {
    const row = rec(raw);
    const name = str(row.name, 80);
    const low = name.toLowerCase();
    if (!name || seen.has(low)) continue;
    seen.add(low);
    const type = doc.types.find((entry) => entry.name.toLowerCase() === str(row.type, 40).toLowerCase()) ?? catchAll;
    entities.push({
      key: `new:${entities.length}`,
      name,
      typeId: type.id,
      summary: str(row.summary, 2_000),
      aliases: (Array.isArray(row.aliases) ? row.aliases : []).map((alias) => str(alias, 80)).filter((alias) => alias && alias.toLowerCase() !== low).slice(0, 6),
      hiddenTruth: str(row.hiddenTruth, 1_000),
      existing: byHandle.get(low) ?? "",
    });
  }
  const endpoint = (value: unknown) => {
    const low = str(value, 80).toLowerCase();
    const fresh = entities.find((entity) => entity.name.toLowerCase() === low || entity.aliases.some((alias) => alias.toLowerCase() === low));
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

export type DigestEntity = { ref: string; shelf: Shelf; name: string; aliases: string[]; tagline: string; text: string; entry: WorldDoc["entries"][string] };

// The world for a model to answer from, the entries the question names
// first, then the rest, until the budget runs out. Hidden truths ride along
// marked as the DM's: the answers go to the DM.
export function worldDigest(doc: WorldDoc, entities: DigestEntity[], focus: string, budget: number): string {
  const named = entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases }));
  const asked = new Set(mentionSegments(focus, named).filter((segment) => segment.ref).map((segment) => segment.ref!));
  const order = [...entities].sort((a, b) => Number(asked.has(b.ref)) - Number(asked.has(a.ref)));
  const nameOf = new Map(entities.map((entity) => [entity.ref, entity.name]));
  const lines: string[] = [];
  let used = 0;
  const push = (line: string) => {
    if (used + line.length > budget) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  for (const entity of order) {
    const type = typeFor(doc, entity.shelf, entity.entry.typeId);
    const about = (entity.entry.article || entity.text || entity.tagline).replace(/\s+/g, " ").slice(0, asked.has(entity.ref) ? 900 : 280);
    const fields = fieldLines(type, entity.entry, doc.calendars, true).map(({ def, text }) => `${def.name}: ${text}`).join("; ");
    const ties = doc.links
      .filter((link) => link.from === entity.ref && nameOf.has(link.to))
      .map((link) => `${link.label} ${nameOf.get(link.to)}${link.veracity === "hidden" ? " (hidden)" : link.veracity === "believed" ? " (believed, untrue)" : ""}`)
      .slice(0, 8)
      .join("; ");
    const line = [
      `## ${entity.name} (${type.name})${entity.aliases.length ? `, also ${entity.aliases.join(", ")}` : ""}`,
      about,
      fields ? `Facts: ${fields}` : "",
      ties ? `Ties: ${ties}` : "",
      entity.entry.hiddenTruth ? `DM only: ${entity.entry.hiddenTruth.slice(0, 400)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (!push(line)) break;
  }
  const events = sortEvents(doc.events, doc.calendars).map((event) => `- ${formatYear(event.when, doc.calendars).primary || "undated"}: ${event.title}${event.body ? `, ${event.body.slice(0, 160)}` : ""}`);
  if (events.length) push(`## Timeline\n${events.slice(0, 40).join("\n")}`);
  const secrets = doc.secrets.map((secret) => `- ${secret.title}${secret.knownBy.length ? ` (kept by ${secret.knownBy.map((ref) => nameOf.get(ref)).filter(Boolean).join(", ")})` : ""}${secret.partyKnows ? ", the party knows" : ""}`);
  if (secrets.length) push(`## Secrets (DM only)\n${secrets.slice(0, 30).join("\n")}`);
  return lines.join("\n\n");
}

export function askMessages(digest: string, question: string, worldName: string) {
  return [
    {
      role: "system" as const,
      content: [
        `You keep the lore of ${worldName}, a tabletop world, and answer its game master.`,
        "Answer from the world below and nothing else. When it does not say, say so plainly and suggest what the game master could decide.",
        "Name entries exactly as they are written, so the answer links to them. Lines marked DM only are the game master's own and may be used.",
        "Be brief: a short paragraph or a few lines.",
      ].join("\n"),
    },
    { role: "user" as const, content: `${digest}\n\n# The question\n${question}` },
  ];
}

export function draftMessages(input: { worldName: string; name: string; typeName: string; known: string[]; hiddenTruth: string; hint: string }) {
  return [
    {
      role: "system" as const,
      content: [
        `You write encyclopedia entries for ${input.worldName}, a tabletop world.`,
        "Write the entry asked for in two or three short paragraphs, in the world's own voice: no game statistics, no mention of players or of the game.",
        "Use only what you are told and what follows from it. A hidden truth may colour the entry with hints, but it must never be stated.",
        "Reply with the entry's text only.",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `The entry: ${input.name}, a ${input.typeName.toLowerCase()}.`,
        ...input.known,
        input.hiddenTruth ? `Hidden truth (never state it): ${input.hiddenTruth}` : "",
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
