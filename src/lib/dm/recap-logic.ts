// The dual-track recap (docs/vtt-parity-implementation-plan.md 13.4), the
// pure half: what each seat's "Previously" is allowed to be built from. The
// party's track is player-visible facts and the quest log; the DM's adds the
// secret facts and where the world's arcs stand.

export type RecapFact = { subject: string; fact: string; knownBy: unknown };
export type RecapQuest = { title: string; source: string; objectives: Array<{ text: string; done: boolean }> };
export type RecapArc = { name: string; rung: number; rungs: string[]; status: string };

export type RecapMaterial = { facts: string[]; quests: string[]; arcs: string[] };

function dmOnly(knownBy: unknown): boolean {
  return knownBy === "dm";
}

export function recapMaterial(
  input: { facts: RecapFact[]; quests: RecapQuest[]; arcs: RecapArc[] },
  dmView: boolean,
): RecapMaterial {
  const facts = input.facts
    .filter((fact) => dmView || !dmOnly(fact.knownBy))
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
