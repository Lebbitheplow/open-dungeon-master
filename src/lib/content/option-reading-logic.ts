// The readings (reading-logic.ts) of the builder's options: races, classes,
// backgrounds and subclasses. The SRD's own rows are hand-written in the
// bundled tables (src/lib/srd/), which the builder lays over the pack's
// text; every other row is what the builder's readers take from its text.

import {
  backgroundField,
  backgroundMechanics,
  classMechanics,
  raceMechanics,
} from "@/lib/content/mechanics";
import { srdRaceFor } from "@/lib/content/race-options";
import { srdBackgroundOptions } from "@/lib/characters/options";
import { SRD_CLASSES } from "@/lib/srd/index";
import { bundledSubclassName, subclassLevelFor } from "@/lib/srd/features";
import { extraSubclassOf } from "@/lib/srd/subclass-tables";
import { reading, readingChecked, type EntryReading, type ReadingRow } from "@/lib/content/reading-logic";

const BUNDLED_BACKGROUNDS = new Set(srdBackgroundOptions().map((option) => option.id));

export function readRace(row: ReadingRow): EntryReading {
  const parsed = raceMechanics(row.data);
  const unread: string[] = [];
  if (!Object.keys(parsed.asi).length && !parsed.asiChoice && /\bincrease/i.test(String(row.data.asi_desc ?? ""))) {
    unread.push("ability increase");
  }
  if (!parsed.speed) {
    unread.push("speed");
  }
  if (String(row.data.languages ?? "").trim() && !parsed.languages.length && !parsed.bonusLanguages && !parsed.languageChoice) {
    unread.push("languages");
  }
  // The bundled SRD race (src/lib/srd/races.json) answers for the rows it
  // names (race-options.ts withSrd).
  return reading({ handWritten: srdRaceFor(row.slug), parsed, unread, checked: readingChecked("race", row) });
}

export function readClass(row: ReadingRow): EntryReading {
  const parsed = classMechanics(row.slug, row.data);
  const unread: string[] = [];
  const die = Number.parseInt(String(row.data.hit_dice ?? row.data.hit_die ?? "").replace(/^\d*d/i, ""), 10);
  if (![6, 8, 10, 12].includes(die)) {
    // classMechanics plays a d8 when the text gives no die it knows.
    unread.push("hit die");
  }
  if (!parsed.saves.length) {
    unread.push("saving throws");
  }
  if (!parsed.skillChoices.count && String(row.data.prof_skills ?? "").trim()) {
    unread.push("skills");
  }
  const bundled = SRD_CLASSES.find((klass) => klass.id === row.slug) ?? null;
  return reading({ handWritten: bundled ? { ...parsed, armor: bundled.armor, weapons: bundled.weapons, tools: bundled.tools ?? [] } : null, parsed, unread, checked: readingChecked("class", row) });
}

export function readBackground(row: ReadingRow): EntryReading {
  const parsed = backgroundMechanics(row.data);
  const unread: string[] = [];
  const said = (field: string) => backgroundField(row.data, field).trim();
  if (said("skill_proficiencies") && !parsed.skills.length && !parsed.skillChoice) {
    unread.push("skills");
  }
  if (said("tool_proficiencies") && !/^no(?:ne)?\b/i.test(said("tool_proficiencies")) && !parsed.tools.length) {
    unread.push("tools");
  }
  if (said("languages") && !/^no(?:ne)?\b/i.test(said("languages")) && !parsed.languages && !parsed.knownLanguages.length) {
    unread.push("languages");
  }
  if (said("equipment") && !parsed.equipment.length) {
    unread.push("equipment");
  }
  const bundled = BUNDLED_BACKGROUNDS.has(row.slug.toLowerCase().replace(/-/g, "_"));
  return reading({ handWritten: bundled ? parsed : null, parsed, unread, checked: readingChecked("background", row) });
}

export function readArchetype(row: ReadingRow): EntryReading {
  const classId = String(row.classSlug ?? "").toLowerCase();
  // The bundled subclass table answers first wherever both do
  // (content/archetype-tables.ts).
  const bundled = classId ? bundledSubclassName(classId, row.name) : null;
  const extra = extraSubclassOf({ name: row.name, source: "open5e", data: row.data }, subclassLevelFor(classId) ?? 3);
  // The features by level, by name: their text is the row's own.
  const levels = extra
    ? Object.fromEntries(Object.entries(extra.levels).map(([level, rows]) => [level, rows.map((feature) => feature.n)]))
    : {};
  const parsed = Object.keys(levels).length
    ? { levels, ...(extra?.spells ? { spells: extra.spells } : {}), ...(extra?.castingProfile ? { castingProfile: extra.castingProfile } : {}) }
    : null;
  const unread = !parsed && String(row.data.desc ?? "").trim() ? ["features"] : [];
  return reading({ handWritten: bundled ? { bundled } : null, parsed, unread, checked: readingChecked("archetype", row) });
}
