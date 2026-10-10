import { hasWorldDoc, worldView, type WorldEntity } from "@/lib/db/world-forge";
import { typeFor, type FieldValue, type WorldDoc } from "@/lib/worldforge/model";

// What the AI DM is told from the table's WorldForge (src/lib/worldforge/
// model.ts), kept small: the prompt window is shared with everything else
// (issue 120).
//
// Each tracked NPC's line gains their hidden truth, their ties and the
// secrets they keep. One block then carries what the world says about who
// and what is in play now: the entries the newest messages name or the
// scene stands in (the current place and the people who live there), each
// with its article, its fields and the dated events that name it, ranked by
// relevance, so an entry made last week is found as surely as the first;
// then the secrets the party has not learned and the hidden truths of places
// and factions, the relevant ones first. Hidden truths and secrets are the
// DM's: told never to state them outright. An entry that is not canon yet
// (a draft, an alternate) is marked as such; a retired one is left out.
//
// WorldForge's calendars date the world's history; the table's in-game
// clock (src/lib/db/clock.ts) runs on its own, and nothing here moves it.

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);
const NPC_NOTE_MAX = 280;
const BLOCK_MAX = 2_600;
const ARTICLE_MAX = 320;
const RELEVANT_MAX = 5;

export type WorldPromptContext = {
  // The newest messages and the scene label, newest last.
  text?: string;
};

function valueText(value: FieldValue): string {
  if (typeof value === "object" && value) {
    return value.year || (value.yearNum !== null ? String(value.yearNum) : "");
  }
  return String(value ?? "").trim();
}

// "Rank: Captain; Born: 1203": the entry's fields with something in them,
// less those its type keeps for the author alone.
function fieldsLine(doc: WorldDoc, entity: WorldEntity): string {
  const type = typeFor(doc, entity.shelf, entity.entry.typeId);
  return type.fields
    .filter((def) => !def.authorOnly)
    .map((def) => {
      const value = entity.entry.fields[def.id];
      const text = value === undefined ? "" : valueText(value);
      return text ? `${def.name}: ${cut(text, 80)}` : "";
    })
    .filter(Boolean)
    .join("; ");
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// How strongly the text points at an entity: each mention of its name or an
// alias, the later in the text the more (the newest message last).
function mentionScore(entity: WorldEntity, text: string): number {
  if (!text) return 0;
  let score = 0;
  for (const name of [entity.name, ...entity.aliases, ...entity.entry.aliases]) {
    const clean = name.trim();
    if (clean.length < 3) continue;
    for (const match of text.matchAll(new RegExp(`\\b${escape(clean)}\\b`, "gi"))) {
      score += 1 + (match.index ?? 0) / Math.max(1, text.length);
    }
  }
  return score;
}

export function worldForPrompt(campaignId: string, context: WorldPromptContext = {}): { npcNotes: Map<string, string>; block: string } {
  const npcNotes = new Map<string, string>();
  if (!hasWorldDoc(campaignId)) {
    return { npcNotes, block: "" };
  }
  const { doc, entities: all } = worldView(campaignId);
  // A retired entry is history the world no longer holds to.
  const entities = all.filter((entity) => entity.entry.canon !== "retired");
  const byRef = new Map(entities.map((entity) => [entity.ref, entity]));
  const nameOf = (ref: string) => byRef.get(ref)?.name ?? "";
  const open = doc.secrets.filter((secret) => !secret.partyKnows);
  const text = context.text ?? "";

  for (const entity of entities.filter((entry) => entry.shelf === "npc")) {
    const parts: string[] = [];
    if (entity.entry.hiddenTruth) parts.push(`secretly: ${cut(entity.entry.hiddenTruth, 140)}`);
    const ties = doc.links
      .filter((link) => link.from === entity.ref || (link.to === entity.ref && !link.oneway))
      .slice(0, 4)
      .map((link) => {
        const other = nameOf(link.from === entity.ref ? link.to : link.from);
        const words = link.from === entity.ref ? `${link.label} ${other}` : `${other} is ${link.label} them`;
        const ranked = link.rank ? `${words} (${link.rank})` : words;
        return link.veracity === "hidden" ? `${ranked} (hidden)` : link.veracity === "believed" ? `${ranked} (believed, untrue)` : ranked;
      });
    if (ties.length) parts.push(ties.join("; "));
    const keeps = open.filter((secret) => secret.knownBy.includes(entity.ref)).slice(0, 3).map((secret) => secret.title);
    if (keeps.length) parts.push(`knows: ${keeps.join("; ")}`);
    if (parts.length) npcNotes.set(entity.name, cut(parts.join(" | "), NPC_NOTE_MAX));
  }

  // Who and what is in play: named in the newest messages, or where the
  // party stands and who lives there.
  const here = entities.find((entity) => entity.shelf === "location" && entity.table.here === true);
  const present = new Set<string>([
    ...(here ? [here.ref] : []),
    ...entities.filter((entity) => entity.shelf === "npc" && here && String(entity.table.home ?? "").toLowerCase() === here.name.toLowerCase()).map((entity) => entity.ref),
  ]);
  const scored = entities
    .map((entity) => ({ entity, score: mentionScore(entity, text) * 2 + (present.has(entity.ref) ? 1 : 0) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const relevant = new Set(scored.map((row) => row.entity.ref));

  const inPlay: string[] = [];
  for (const { entity } of scored.slice(0, RELEVANT_MAX)) {
    const article = entity.entry.article || entity.text;
    const fields = fieldsLine(doc, entity);
    const events = doc.events
      .filter((event) => event.refs.includes(entity.ref) && event.canon !== "retired")
      .slice(-2)
      .map((event) => `${event.when.year ? `${event.when.year}: ` : ""}${event.title}${event.body ? ` (${cut(event.body, 100)})` : ""}`);
    const status = entity.entry.canon === "canon" ? "" : ` [${entity.entry.canon}: not canon yet, use only if it fits]`;
    const parts = [
      article ? cut(article.replace(/\s+/g, " "), ARTICLE_MAX) : "",
      fields,
      events.length ? `history: ${events.join("; ")}` : "",
      entity.shelf !== "npc" && entity.entry.hiddenTruth ? `secretly: ${cut(entity.entry.hiddenTruth, 140)}` : "",
    ].filter(Boolean);
    if (parts.length) {
      inPlay.push(`- ${entity.name}${status}: ${parts.join(" | ")}`);
    }
  }

  // Secrets and hidden truths, the ones about what is in play first.
  const aboutPlay = (refs: string[]) => refs.some((ref) => relevant.has(ref));
  const secrets = [...open].sort((a, b) => Number(aboutPlay([b.subject, ...b.knownBy])) - Number(aboutPlay([a.subject, ...a.knownBy])));
  const lines: string[] = [];
  for (const secret of secrets.slice(0, 8)) {
    const about = secret.subject ? ` (about ${nameOf(secret.subject)})` : "";
    const knowers = secret.knownBy.map(nameOf).filter(Boolean);
    lines.push(`- Secret: ${secret.title}${about}${secret.notes ? `: ${cut(secret.notes, 140)}` : ""}${knowers.length ? ` [known by ${knowers.slice(0, 4).join(", ")}]` : ""}`);
  }
  const truths = entities
    .filter((entry) => entry.shelf !== "npc" && entry.entry.hiddenTruth && !scored.slice(0, RELEVANT_MAX).some((row) => row.entity.ref === entry.ref))
    .sort((a, b) => Number(relevant.has(b.ref)) - Number(relevant.has(a.ref)));
  for (const entity of truths.slice(0, 6)) {
    lines.push(`- ${entity.name}: ${cut(entity.entry.hiddenTruth, 140)}`);
  }
  if (!inPlay.length && !lines.length) {
    return { npcNotes, block: "" };
  }
  let block = "";
  const add = (line: string) => {
    if (block.length + line.length + 1 > BLOCK_MAX) return false;
    block = block ? `${block}\n${line}` : line;
    return true;
  };
  if (inPlay.length) {
    add("From the world's WorldForge, about who and what is in play now (the article is what the world knows and may surface as the party learns it; anything marked secretly is the DM's):");
    for (const line of inPlay) if (!add(line)) break;
  }
  if (lines.length) {
    add("From the world's WorldForge (DM-only; the party has not learned these, so let them surface through play and never state them outright):");
    for (const line of lines) if (!add(line)) break;
  }
  return { npcNotes, block };
}
