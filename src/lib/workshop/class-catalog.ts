// A published class as the workshop copies it (src/lib/homebrew/class-data.ts):
// the numbers every class has, and its features by level with their words.
// The SRD's twelve and the setting classes come from the bundled tables, so
// a copy keeps the names the engines run them by; a content pack's own
// class brings its numbers, and its features are the copy's to write.
//
// Kept apart from catalog-mechanics.ts, which holds the other kinds.

import "@/lib/classes/feature-text-all";
import { ALL_CLASSES, findClass } from "@/lib/srd";
import { classFeaturesFor, subclassLevelFor } from "@/lib/srd/features";
import { describeFeature } from "@/lib/help";
import { classMechanics } from "@/lib/content/mechanics";
import { findCustomClass } from "@/lib/classes";
import { SPELL_LISTS, type ClassFeatureRow, type WorkshopClassData } from "@/lib/homebrew/class-data";
import { textKey } from "@/lib/language/text-logic";

type Row = { name: string; slug?: string; source?: string; data: Record<string, unknown> };

// A caster's list: its own when it has one, the list a setting class
// borrows, else the wizard's.
function listOf(classId: string): string | null {
  const own = (SPELL_LISTS as readonly string[]).includes(classId) ? classId : null;
  return own ?? findCustomClass(classId)?.spellListFrom ?? null;
}

// A bundled class's whole table, as a workshop class's data.
export function bundledClassTable(classId: string): WorkshopClassData | null {
  const klass = findClass(classId);
  if (!klass) {
    return null;
  }
  const levels: Record<string, ClassFeatureRow[]> = {};
  for (const feature of classFeaturesFor(classId, "", 20)) {
    const level = String(feature.level ?? 1);
    (levels[level] ??= []).push({ n: feature.name, d: describeFeature(classId, "", feature.name) ?? "" });
  }
  const casterType = klass.casterType === "artificer" ? "half" : klass.casterType;
  return {
    desc: klass.blurb ?? "",
    hitDie: klass.hitDie,
    saves: klass.saves,
    skillChoices: klass.skillChoices,
    armor: klass.armor,
    weapons: klass.weapons,
    tools: klass.tools ?? [],
    casterType,
    spellAbility: casterType === "none" ? null : klass.spellAbility,
    spellListFrom: casterType === "none" ? null : (listOf(classId) ?? "wizard"),
    subclassLevel: Math.max(1, Math.min(3, subclassLevelFor(classId) ?? 3)),
    levels,
  };
}

// A catalog row's copy: a bundled class's table under its own id, or a pack
// class's numbers. Null for the table's own homebrew (copied as stored).
export function classMechanicsOf(row: Row): WorkshopClassData | null {
  if (row.source === "homebrew") {
    return null;
  }
  const bundled = row.slug ? bundledClassTable(row.slug.toLowerCase()) : null;
  if (bundled) {
    return bundled;
  }
  const numbers = classMechanics(row.slug ?? row.name, row.data);
  return {
    desc: String(row.data.desc ?? "").slice(0, 8_000),
    hitDie: numbers.hitDie,
    saves: numbers.saves,
    skillChoices: numbers.skillChoices,
    armor: numbers.armor,
    weapons: numbers.weapons,
    tools: numbers.tools ?? [],
    casterType: numbers.casterType === "artificer" ? "half" : numbers.casterType,
    spellAbility: numbers.spellAbility,
    spellListFrom: numbers.casterType === "none" ? null : "wizard",
    subclassLevel: 3,
    levels: {},
  };
}

// The bundled classes no row in `results` already stands for, whose name
// holds `q`, as catalog rows with their tables.
export function bundledClassRows(q: string, results: Array<{ name: string }>): Array<Record<string, unknown>> {
  const wanted = textKey(q);
  const held = new Set(results.map((row) => textKey(row.name)));
  return ALL_CLASSES.filter((klass) => !held.has(textKey(klass.name)) && (!wanted || textKey(klass.name).includes(wanted))).flatMap((klass) => {
    const table = bundledClassTable(klass.id);
    return table
      ? [
          {
            slug: klass.id,
            name: klass.name,
            source: "bundled",
            documentSlug: findCustomClass(klass.id) ? "odm" : "wotc-srd",
            document: findCustomClass(klass.id) ? "Open Dungeon Master" : "SRD 5.1 (bundled)",
            data: { desc: klass.blurb ?? "" },
            table,
          },
        ]
      : [];
  });
}
