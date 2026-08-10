// The world primer: a compact block of the selected pack's own nouns, rendered
// into GAME STATE so the DM narrates in the world's language.
//
// The load-bearing part is the alias table. A pack is a display-only reskin, so
// the sheets and the rules engine only ever know canonical names. Without this
// block the DM would either narrate canonically (defeating the pack) or invent
// a name and then pass it to a tool that cannot resolve it. The table tells the
// model to do both at once: narrate the world's word, call the tool with the
// canonical one.
//
// Pure and dependency-free so a plain-node test can render it.
import type { WorldPack } from "@/lib/worlds/types";

// The primer is rebuilt into GAME STATE on EVERY turn, so it is budgeted hard.
// A full-depth pack carries far more than this; the rest is not lost, it just
// reaches the model by a cheaper route:
//
//   factions, locations, hooks -> packWorldHints(), spent once during story
//                                 setup and arc planning, after which they
//                                 come back as real NPCs, places and quests
//                                 already in GAME STATE.
//   every reskin               -> still renames the UI for players regardless.
//
// What has to be here every turn is only what the DM cannot reconstruct: the
// world's name, its vocabulary, and the alias table that keeps narration and
// tool calls in sync.
const MAX_ALIASES_PER_KIND = 10;
const MAX_GLOSSARY = 8;

function aliasLine(entries: Array<{ from: string; name: string }>, limit: number): string {
  return entries
    .slice(0, limit)
    .map((entry) => `${entry.name} = ${entry.from}`)
    .join("; ");
}

export function renderWorldPrimer(pack: WorldPack | null): string {
  if (!pack) {
    return "";
  }
  const sections: string[] = [];
  sections.push(`This campaign runs in ${pack.name}. ${pack.blurb}`);

  // Names only. The blurbs went in during setup and arc planning, and the
  // ones that matter are already tracked NPCs and locations by now.
  if (pack.factions.length) {
    sections.push(`Powers of this world: ${pack.factions.map((entry) => entry.name).join(", ")}`);
  }
  if (pack.locations.length) {
    sections.push(`Places of this world: ${pack.locations.map((entry) => entry.name).join(", ")}`);
  }
  if (pack.glossary.length) {
    sections.push(
      `The world's words: ${pack.glossary
        .slice(0, MAX_GLOSSARY)
        .map((entry) => `${entry.term} means ${entry.meaning}`)
        .join("; ")}`,
    );
  }

  // The alias table, and the instruction that makes it safe.
  const aliases: string[] = [];
  if (pack.spells.length) {
    aliases.push(`Spells: ${aliasLine(pack.spells, MAX_ALIASES_PER_KIND)}`);
  }
  if (pack.items.length) {
    aliases.push(`Gear: ${aliasLine(pack.items, MAX_ALIASES_PER_KIND)}`);
  }
  if (pack.features.length) {
    aliases.push(`Abilities: ${aliasLine(pack.features, MAX_ALIASES_PER_KIND)}`);
  }
  if (pack.classes.length) {
    aliases.push(
      `Callings: ${pack.classes
        .slice(0, MAX_ALIASES_PER_KIND)
        .map((entry) => `${entry.name} = ${entry.id}`)
        .join("; ")}`,
    );
  }
  if (aliases.length) {
    sections.push(
      [
        "In this world these go by other names. Narrate the world's name; call every tool with the canonical name on the right, because the sheets and the rules engine only know those.",
        ...aliases,
      ].join("\n"),
    );
  }

  if (pack.nameHints) {
    sections.push(`Naming: ${pack.nameHints}`);
  }

  return sections.join("\n\n");
}
