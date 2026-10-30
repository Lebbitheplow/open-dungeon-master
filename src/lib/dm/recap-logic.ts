// The dual-track recap (docs/vtt-parity-implementation-plan.md 13.4), the
// pure half: what each seat's "Previously" is allowed to be built from. The
// party's track is player-visible facts and the quest log; the DM's adds the
// secret facts and where the world's arcs stand.

import { isStorytellerFact } from "./fact-logic.ts";

export type RecapFact = { subject: string; fact: string; knownBy: unknown };
export type RecapQuest = { title: string; source: string; objectives: Array<{ text: string; done: boolean }> };
export type RecapArc = { name: string; rung: number; rungs: string[]; status: string };

export type RecapMaterial = { facts: string[]; quests: string[]; arcs: string[] };

function dmOnly(knownBy: unknown): boolean {
  return knownBy === "dm";
}

// The storyteller's own secrets (src/lib/dm/viewer.ts) never ride a recap:
// the DM's track is read by the lead who steers an AI table.

export function recapMaterial(
  input: { facts: RecapFact[]; quests: RecapQuest[]; arcs: RecapArc[] },
  dmView: boolean,
): RecapMaterial {
  const facts = input.facts
    .filter((fact) => !isStorytellerFact(fact.knownBy) && (dmView || !dmOnly(fact.knownBy)))
    .slice(-12)
    .map((fact) => `${fact.subject ? `${fact.subject}: ` : ""}${fact.fact}${dmView && dmOnly(fact.knownBy) ? " (the party does not know this)" : ""}`);
  const quests = input.quests
    .filter((quest) => dmView || quest.source !== "dm-secret")
    .slice(0, 8)
    .map((quest) => {
      const done = quest.objectives.filter((objective) => objective.done).length;
      return `${quest.title}${quest.objectives.length ? ` (${done} of ${quest.objectives.length} done)` : ""}`;
    });
  const arcs = dmView
    ? input.arcs.filter((arc) => arc.rung >= 0 && arc.status !== "done").map((arc) => `${arc.name}: ${arc.rungs[arc.rung] ?? "underway"}`)
    : [];
  return { facts, quests, arcs };
}

export function renderRecapMaterial(material: RecapMaterial): string {
  return [
    material.facts.length ? `Established facts:\n${material.facts.map((line) => `- ${line}`).join("\n")}` : "",
    material.quests.length ? `Quests:\n${material.quests.map((line) => `- ${line}`).join("\n")}` : "",
    material.arcs.length ? `World arcs (secret):\n${material.arcs.map((line) => `- ${line}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type RecapLine = { speaker: string; text: string };

// The last session's story, from its first line to where it stopped, fitted
// to what a recap prompt can carry (a 16K model reads it beside the chapter
// and the facts). The end is what the table returns to, so its last lines go
// whole; the rest of the budget samples the earlier lines evenly, in order,
// so the session's start and middle are in the recap too and not only its
// last twelve lines.
export function sessionTranscript(lines: RecapLine[], budget = 8_000): string {
  const render = (line: RecapLine, cap: number) => `${line.speaker}: ${line.text.replace(/\s+/g, " ").trim().slice(0, cap)}`;
  const tail = lines.slice(-10).map((line) => render(line, 600));
  const tailSize = tail.reduce((sum, line) => sum + line.length + 1, 0);
  const earlier = lines.slice(0, -10);
  const room = Math.max(0, budget - tailSize);
  const picked: string[] = [];
  if (earlier.length && room > 0) {
    const each = earlier.map((line) => render(line, 300));
    const average = each.reduce((sum, line) => sum + line.length + 1, 0) / each.length;
    const fits = Math.max(1, Math.floor(room / average));
    const step = Math.max(1, earlier.length / fits);
    let used = 0;
    for (let at = 0; at < earlier.length; at += step) {
      const line = each[Math.floor(at)];
      if (used + line.length + 1 > room) break;
      picked.push(line);
      used += line.length + 1;
    }
  }
  return [...picked, ...tail].join("\n");
}
