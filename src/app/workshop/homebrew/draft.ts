import {
  ITEM_KINDS,
  normalizeItemData,
  normalizeSpellData,
  type ItemKind,
} from "@/lib/homebrew/gear";
import { itemEngineSummary, validateDraft, type Finding, type ItemDraft } from "@/lib/rulesets/validate";
import { publishedNameProblem } from "@/lib/homebrew/published-names";
import { backgroundFindings, featFindings, hazardFindings, speciesFindings, subclassFindings } from "@/lib/rulesets/validate-options";
import type { VariantRules } from "@/lib/rulesets/logic";
import type { SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import type { EditorKind } from "@/app/workshop/homebrew/types";
import { engineSpellNamed, materialOf, spellFlagsOf } from "@/lib/srd/spell-facts";

// The editor's working copy of an entry and what can be said about it
// before it is saved. Pure so the panel's findings run client-side on
// every keystroke through the same validator the server would run.

export type Data = Record<string, unknown>;
export type HomebrewDraft = { kind: EditorKind; name: string; data: Data };

export function blankDraft(kind: EditorKind): HomebrewDraft {
  switch (kind) {
    case "item":
      return { kind, name: "", data: { desc: "", itemKind: "gear", rarity: "", cost: "" } };
    case "spell":
      return {
        kind,
        name: "",
        data: {
          desc: "",
          level: 1,
          school: "evocation",
          classes: [],
          casting_time: "1 action",
          range: "60 feet",
          components: "V, S",
          duration: "Instantaneous",
        },
      };
    case "feat":
      return { kind, name: "", data: { desc: "", prerequisite: "" } };
    case "background":
      return {
        kind,
        name: "",
        data: { desc: "", skill_proficiencies: "", tool_proficiencies: "", languages: "", equipment: "", feature: "", feature_desc: "" },
      };
    case "race":
      return {
        kind,
        name: "",
        data: { desc: "", traits: "", size: "Medium", speed: { walk: 30 }, asi: [], languages: "Common", vision: "" },
      };
    case "archetype":
      return { kind, name: "", data: { desc: "", classSlug: "fighter", levels: {} } };
    case "hazard":
      return {
        kind,
        name: "",
        data: {
          desc: "",
          hazardKind: "trap",
          trap: { kind: "mechanical", trigger: "", save: { ability: "dex", dc: 13, halfOnSave: true }, damage: { dice: "2d10", type: "piercing" }, summary: "" },
        },
      };
  }
}

// What the validator would say about this draft at this table. An item or a
// spell the normalizer refuses is one finding: the refusal, verbatim.
// `savedName`: the name the entry was saved under, when it already exists.
// A published name it already had is said, not refused (the server lets an
// entry keep the name it was saved under before the rule).
export function draftFindings(draft: HomebrewDraft, variantRules: Partial<VariantRules>, savedName?: string): Finding[] {
  const published = publishedNameProblem(draft.kind, draft.name);
  const kept = savedName !== undefined && savedName.trim().toLowerCase() === draft.name.trim().toLowerCase();
  const naming: Finding[] = published ? [{ level: kept ? "warn" : "error", text: published }] : [];
  const page = pageFor(draft);
  return [...naming, ...kindFindings(draft, variantRules).map((finding) => (finding.page || !page ? finding : { ...finding, page }))];
}

// The twelve classes the bundled book prints a page for, under their slugs.
const SRD_CLASSES = new Set(["barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard"]);

// The book page a kind's findings measure against, where a finding does not
// name its own (validate.ts tags the item and spell ones by section).
function pageFor(draft: HomebrewDraft): string | null {
  if (draft.kind === "feat") return "feats";
  if (draft.kind === "background") return "backgrounds";
  if (draft.kind === "race") return "racial-traits";
  if (draft.kind === "archetype") return SRD_CLASSES.has(String(draft.data.classSlug ?? "")) ? String(draft.data.classSlug) : null;
  if (draft.kind === "hazard") return ({ trap: "traps", poison: "poisons", disease: "diseases" } as Record<string, string>)[String(draft.data.hazardKind ?? "")] ?? null;
  return null;
}

function kindFindings(draft: HomebrewDraft, variantRules: Partial<VariantRules>): Finding[] {
  const context = { variantRules };
  if (draft.kind === "item") {
    const normalized = normalizeItemData(draft.data, draft.name || "This item");
    if ("error" in normalized) {
      return [{ level: "error", text: normalized.error }];
    }
    const data = normalized.data;
    const item: ItemDraft = {
      name: draft.name,
      itemKind: ITEM_KINDS.includes(data.itemKind as ItemKind) ? (data.itemKind as ItemKind) : "gear",
      weapon: data.weapon as SrdWeapon | undefined,
      armor: data.armor as SrdArmor | undefined,
      effects: data.effects as MagicItemEffect[] | undefined,
      requiresAttunement: data.requiresAttunement === true,
      rarity: String(data.rarity ?? ""),
      weight: typeof data.weight === "number" ? data.weight : undefined,
      weaponRiders: data.weaponRiders as ItemDraft["weaponRiders"],
      armorRiders: data.armorRiders as ItemDraft["armorRiders"],
      charges: data.charges as ItemDraft["charges"],
      checks: data.checks as ItemDraft["checks"],
      spells: data.spells as ItemDraft["spells"],
      cursed: data.cursed === true,
    };
    const summary = itemEngineSummary(item);
    return [...validateDraft(context, { kind: "item", item }), ...(summary ? [{ level: "note" as const, text: summary }] : [])];
  }
  if (draft.kind === "spell") {
    const normalized = normalizeSpellData(draft.data);
    if ("error" in normalized) {
      return [{ level: "error", text: normalized.error }];
    }
    const data = normalized.data;
    const runsAs = typeof data.runsAs === "string" ? data.runsAs : "";
    return [
      ...validateDraft(context, {
        kind: "spell",
        spell: {
          name: draft.name,
          level: Number(data.level ?? 0),
          desc: String(data.desc ?? ""),
          duration: String(data.duration ?? ""),
          concentration: data.concentration === true,
          higherLevel: String(data.higher_level ?? ""),
          mech: (data.mech as SpellMech | undefined) ?? null,
        },
      }),
      ...(runsAs
        ? [{ level: "note" as const, text: `Runs as ${runsAs}: the area it lays, the creatures it calls, the reaction it answers and the shape it gives come from ${runsAs}'s rules, under this spell's own name. The block below and the casting facts above are this spell's own.` }]
        : []),
    ];
  }
  // Character options and hazards, measured against the SRD's own norms
  // (src/lib/rulesets/validate-options.ts).
  if (draft.kind === "feat") return featFindings(draft.name, draft.data);
  if (draft.kind === "background") return backgroundFindings(draft.data);
  if (draft.kind === "race") return speciesFindings(draft.data);
  if (draft.kind === "archetype") return subclassFindings(draft.data);
  if (draft.kind === "hazard") return hazardFindings(draft.data);
  return [];
}

// The name a copy starts under: one of its own, so it never saves under a
// published name the table would read as the published entry. Not "(copy)":
// the magic item matcher reads a bracketed note off a name, so "Ring of
// Protection (copy)" would still be the published ring on a sheet. The DM
// renames it.
export function copyName(name: string): string {
  return `${name.trim()} Variant`.slice(0, 80);
}

// What a copy remembers of where it came from (src/lib/homebrew/gear.ts
// normalizeCopiedFrom keeps it through a save): the entry's name, whether it
// was published, the bundled book or the table's own homebrew, its book,
// its catalog slug and the rulebook page it is printed on.
export type CopiedFrom = {
  name: string;
  source: "published" | "bundled" | "homebrew";
  document?: string;
  slug?: string;
  rulebook?: string;
};

type CatalogEntry = {
  name: string;
  slug?: string;
  source?: string;
  document?: string;
  rulebook?: string;
  data: Data;
  level?: number;
  school?: string;
  rarity?: string;
  cost?: string;
  kind?: string;
  // Pounds, the catalog's own reading of the row's weight.
  weight?: number;
  // What the engine runs for the published row (catalog-mechanics.ts).
  mech?: Data;
  gear?: Data;
  table?: Data;
};

export function copiedFromOf(entry: CatalogEntry): CopiedFrom {
  const source = entry.source === "homebrew" ? "homebrew" : entry.source === "srd" || entry.source === "bundled" ? "bundled" : "published";
  return {
    name: entry.name,
    source,
    ...(entry.document ? { document: entry.document } : {}),
    ...(entry.slug ? { slug: entry.slug } : {}),
    ...(entry.rulebook ? { rulebook: entry.rulebook } : {}),
  };
}

// "3 lb.", "5.000", 3: a catalog weight in pounds, or null.
export function poundsOf(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const text = String(value ?? "").trim();
  const match = /^(\d+(?:\.\d+)?)(?:\s*(?:lb\.?|lbs\.?|pounds?))?$/i.exec(text) ?? /^(\d+)\/(\d+)\s*lb/i.exec(text);
  if (!match) {
    return null;
  }
  const pounds = match[2] && /\//.test(text) ? Number(match[1]) / Number(match[2]) : Number(match[1]);
  return pounds > 0 ? pounds : null;
}

// A catalog row turned into a draft the DM then edits. Spells and options
// come from the content pack in Open5e's own field names, which is what the
// builder reads too; nothing is renamed on the way in. A row of the table's
// own homebrew is copied as it is stored (the stored schema is already the
// draft's), so every engine field and choice survives; a published one is
// read into that schema with the mechanics the engines run for it.
export function draftFromCatalog(
  kind: EditorKind,
  entry: CatalogEntry,
  extra: { classSlug?: string } = {},
): HomebrewDraft {
  const data = entry.data;
  const base = blankDraft(kind);
  const copiedFrom = copiedFromOf(entry);
  if (entry.source === "homebrew") {
    const stored = JSON.parse(JSON.stringify(data ?? {})) as Data;
    // A copy of a copy still reads the book page the first one came from.
    const page = (stored.copiedFrom as CopiedFrom | undefined)?.rulebook;
    delete stored.copiedFrom;
    return { kind, name: copyName(entry.name), data: { ...base.data, ...stored, copiedFrom: { ...copiedFrom, ...(page && !copiedFrom.rulebook ? { rulebook: page } : {}) } } };
  }
  switch (kind) {
    case "spell": {
      // The material and its price where the row keeps them: the 2014 rows'
      // separate material line, the 2024 rows' cost and consumed flags, or a
      // material named in brackets after the M.
      const material = materialOf(data);
      const runsAs = engineSpellNamed(entry.name);
      return {
        kind,
        name: copyName(entry.name),
        data: {
          ...base.data,
          desc: String(data.desc ?? ""),
          higher_level: String(data.higher_level ?? ""),
          level: entry.level ?? Number(data.level_int ?? data.level ?? 1),
          school: String(entry.school ?? (data.school as { name?: string })?.name ?? data.school ?? "evocation").toLowerCase(),
          classes: classesOf(data),
          // "yes" and "no" in the 2014 rows, flags in the 2024 ones.
          ...spellFlagsOf(data),
          casting_time: String(data.casting_time ?? "1 action"),
          range: String(data.range ?? "60 feet"),
          components: componentsOf(data),
          duration: String(data.duration ?? "Instantaneous"),
          ...(material.text ? { material: material.text } : {}),
          ...(material.costGp ? { materialCostGp: material.costGp } : {}),
          ...(material.costGp && material.consumed ? { materialConsumed: true } : {}),
          // The block the engine casts the published spell with, so the copy
          // resolves the same way until the DM changes it.
          ...(entry.mech ? { mech: entry.mech } : data.mech ? { mech: data.mech } : {}),
          // The published spell whose area, summons, reaction or
          // transformation the engines lay for the copy under its own name.
          ...(runsAs ? { runsAs } : {}),
          copiedFrom,
        },
      };
    }
    case "item": {
      const pounds = poundsOf(entry.weight) ?? poundsOf(data.weight);
      return {
        kind,
        name: copyName(entry.name),
        data: {
          ...base.data,
          desc: String(data.desc ?? ""),
          itemKind: entry.kind === "magic_item" ? "magic_item" : "gear",
          rarity: String(entry.rarity ?? data.rarity ?? ""),
          cost: String(entry.cost ?? data.cost ?? ""),
          // The catalog's own weight (its top-level reading of "3 lb."), so
          // a renamed copy still weighs what the original does.
          ...(pounds !== null ? { weight: pounds } : {}),
          ...(entry.kind === "magic_item"
            ? { requiresAttunement: /requires attunement/i.test(String(data.requires_attunement ?? data.desc ?? "")), effects: [] }
            : {}),
          // What the engine runs for the published item: the weapon or suit
          // it is built on, its riders, effects, charges, spells and checks
          // (catalog-mechanics.ts), so the copy works the same way.
          ...(entry.gear ?? {}),
          ...(pounds !== null && entry.gear?.weight === undefined ? { weight: pounds } : {}),
          copiedFrom,
        },
      };
    }
    case "feat": {
      // The whole text and the feat it runs as, when the catalog sent them.
      const table = (entry.table ?? {}) as Record<string, unknown>;
      return {
        kind,
        name: copyName(entry.name),
        data: {
          desc: String(table.desc ?? data.desc ?? ""),
          prerequisite: String(table.prerequisite ?? data.prerequisite ?? ""),
          ...(typeof table.runsAs === "string" ? { runsAs: table.runsAs } : {}),
          copiedFrom,
        },
      };
    }
    case "background":
      return {
        kind,
        name: copyName(entry.name),
        data: {
          desc: String(data.desc ?? ""),
          skill_proficiencies: String(data.skill_proficiencies ?? ""),
          tool_proficiencies: String(data.tool_proficiencies ?? ""),
          languages: String(data.languages ?? ""),
          equipment: String(data.equipment ?? ""),
          feature: String(data.feature ?? ""),
          feature_desc: String(data.feature_desc ?? ""),
          // The published option's grants and feature, when the catalog sent them.
          ...(entry.table ?? {}),
          copiedFrom,
        },
      };
    case "race":
      return {
        kind,
        name: copyName(entry.name),
        data: {
          desc: String(data.desc ?? ""),
          traits: String(data.traits ?? ""),
          size: String(data.size ?? "Medium").split(".")[0].slice(0, 40),
          speed: { walk: Number((data.speed as { walk?: number })?.walk ?? 30) || 30 },
          asi: Array.isArray(data.asi) ? data.asi : [],
          languages: String(data.languages ?? ""),
          vision: String(data.vision ?? ""),
          // What the builder offers for the published race: a subrace's
          // parent traits and scores, its speed, languages, skills, tools,
          // training and cantrip (catalog-mechanics.ts raceMechanicsOf).
          ...(entry.table ?? {}),
          copiedFrom,
        },
      };
    case "hazard":
      // The SRD hazard's whole block (src/lib/workshop/hazard-catalog.ts).
      return { kind, name: copyName(entry.name), data: { desc: String(data.desc ?? ""), ...(entry.table ?? {}), copiedFrom } };
    case "archetype":
      return {
        kind,
        name: copyName(entry.name),
        data: {
          desc: String(data.desc ?? "").split(/^#{3,6}\s/m)[0].trim() || String(data.desc ?? ""),
          classSlug: extra.classSlug ?? "fighter",
          // The published subclass's features by level, with their words, and
          // its always-prepared spells (catalog-mechanics.ts).
          levels: (entry.table?.levels as Data | undefined) ?? {},
          ...(entry.table?.spells ? { spells: entry.table.spells } : {}),
          copiedFrom,
        },
      };
  }
}

// The component letters as a row prints them, with the 2024 rows' flags
// turned back into letters.
function componentsOf(data: Data): string {
  if (typeof data.components === "string" && data.components.trim()) {
    return data.components;
  }
  const flag = (value: unknown) => value === true || value === 1 || value === "yes";
  const letters = [
    flag(data.verbal) || flag(data.requires_verbal_components) ? "V" : "",
    flag(data.somatic) || flag(data.requires_somatic_components) ? "S" : "",
    flag(data.material) || flag(data.requires_material_components) || typeof data.material_specified === "string" ? "M" : "",
  ].filter(Boolean);
  return letters.join(", ") || "V, S";
}

function classesOf(data: Data): string[] {
  if (Array.isArray(data.classes)) {
    return data.classes.map((entry) => String((entry as { name?: string })?.name ?? entry).toLowerCase());
  }
  return String(data.dnd_class ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}
