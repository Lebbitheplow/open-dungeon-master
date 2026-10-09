import { hasWorldDoc, worldView } from "@/lib/db/world-forge";

// What the AI DM is told from the table's WorldForge (src/lib/worldforge/
// model.ts), kept small: the prompt window is shared with everything else
// (issue 120). Each tracked NPC's line gains their hidden truth, their ties
// and the secrets they keep; one block carries the secrets the party has not
// learned and the hidden truths of places and factions. All of it is the
// DM's: told never to state it outright, only to let it surface in play.

const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`);
const NPC_NOTE_MAX = 280;
const BLOCK_MAX = 1_800;

export function worldForPrompt(campaignId: string): { npcNotes: Map<string, string>; block: string } {
  const npcNotes = new Map<string, string>();
  if (!hasWorldDoc(campaignId)) {
    return { npcNotes, block: "" };
  }
  const { doc, entities } = worldView(campaignId);
  const byRef = new Map(entities.map((entity) => [entity.ref, entity]));
  const nameOf = (ref: string) => byRef.get(ref)?.name ?? "";
  const open = doc.secrets.filter((secret) => !secret.partyKnows);

  for (const entity of entities.filter((entry) => entry.shelf === "npc")) {
    const parts: string[] = [];
    if (entity.entry.hiddenTruth) parts.push(`secretly: ${cut(entity.entry.hiddenTruth, 140)}`);
    const ties = doc.links
      .filter((link) => link.from === entity.ref || (link.to === entity.ref && !link.oneway))
      .slice(0, 4)
      .map((link) => {
        const other = nameOf(link.from === entity.ref ? link.to : link.from);
        const words = link.from === entity.ref ? `${link.label} ${other}` : `${other} is ${link.label} them`;
        return link.veracity === "hidden" ? `${words} (hidden)` : link.veracity === "believed" ? `${words} (believed, untrue)` : words;
      });
    if (ties.length) parts.push(ties.join("; "));
    const keeps = open.filter((secret) => secret.knownBy.includes(entity.ref)).slice(0, 3).map((secret) => secret.title);
    if (keeps.length) parts.push(`knows: ${keeps.join("; ")}`);
    if (parts.length) npcNotes.set(entity.name, cut(parts.join(" | "), NPC_NOTE_MAX));
  }

  const lines: string[] = [];
  for (const secret of open.slice(0, 8)) {
    const about = secret.subject ? ` (about ${nameOf(secret.subject)})` : "";
    const knowers = secret.knownBy.map(nameOf).filter(Boolean);
    lines.push(`- Secret: ${secret.title}${about}${secret.notes ? `: ${cut(secret.notes, 140)}` : ""}${knowers.length ? ` [known by ${knowers.slice(0, 4).join(", ")}]` : ""}`);
  }
  for (const entity of entities.filter((entry) => entry.shelf !== "npc" && entry.entry.hiddenTruth).slice(0, 6)) {
    lines.push(`- ${entity.name}: ${cut(entity.entry.hiddenTruth, 140)}`);
  }
  if (!lines.length) {
    return { npcNotes, block: "" };
  }
  const header =
    "From the world's WorldForge (DM-only; the party has not learned these, so let them surface through play and never state them outright):";
  let block = header;
  for (const line of lines) {
    if (block.length + line.length + 1 > BLOCK_MAX) break;
    block += `\n${line}`;
  }
  return { npcNotes, block };
}
