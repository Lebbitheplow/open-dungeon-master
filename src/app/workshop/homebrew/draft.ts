import {
  ITEM_KINDS,
  normalizeItemData,
  normalizeSpellData,
  type ItemKind,
} from "@/lib/homebrew/gear";
import { validateDraft, type Finding } from "@/lib/rulesets/validate";
import type { VariantRules } from "@/lib/rulesets/logic";
import type { SrdArmor } from "@/lib/srd/armor";
import type { SrdWeapon } from "@/lib/srd/weapons";
import type { MagicItemEffect } from "@/lib/srd/magic-items";
import type { SpellMech } from "@/lib/srd/spell-mechanics";
import type { EditorKind } from "@/app/workshop/homebrew/types";

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
  }
}

// What the validator would say about this draft at this table. An item or a
// spell the normalizer refuses is one finding: the refusal, verbatim.
export function draftFindings(draft: HomebrewDraft, variantRules: Partial<VariantRules>): Finding[] {
  const context = { variantRules };
  if (draft.kind === "item") {
    const normalized = normalizeItemData(draft.data, draft.name || "This item");
    if ("error" in normalized) {
      return [{ level: "error", text: normalized.error }];
    }
    const data = normalized.data;
    return validateDraft(context, {
      kind: "item",
      item: {
        name: draft.name,
        itemKind: ITEM_KINDS.includes(data.itemKind as ItemKind) ? (data.itemKind as ItemKind) : "gear",
        weapon: data.weapon as SrdWeapon | undefined,
        armor: data.armor as SrdArmor | undefined,
        effects: data.effects as MagicItemEffect[] | undefined,
        requiresAttunement: data.requiresAttunement === true,
        rarity: String(data.rarity ?? ""),
        weight: typeof data.weight === "number" ? data.weight : undefined,
      },
    });
  }
  if (draft.kind === "spell") {
    const normalized = normalizeSpellData(draft.data);
    if ("error" in normalized) {
      return [{ level: "error", text: normalized.error }];
    }
    const data = normalized.data;
    return validateDraft(context, {
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
    });
  }
  return [];
}

// A catalog row turned into a draft the DM then edits. Spells and options
// come from the content pack in Open5e's own field names, which is what the
// builder reads too; nothing is renamed on the way in.
export function draftFromCatalog(
  kind: EditorKind,
  entry: { name: string; data: Data; level?: number; school?: string; rarity?: string; cost?: string; kind?: string },
  extra: { classSlug?: string } = {},
): HomebrewDraft {
  const data = entry.data;
  const base = blankDraft(kind);
  switch (kind) {
    case "spell":
      return {
        kind,
        name: entry.name,
        data: {
          ...base.data,
          desc: String(data.desc ?? ""),
          higher_level: String(data.higher_level ?? ""),
          level: entry.level ?? Number(data.level_int ?? data.level ?? 1),
          school: String(entry.school ?? (data.school as { name?: string })?.name ?? data.school ?? "evocation").toLowerCase(),
          classes: classesOf(data),
          ritual: data.ritual === true,
          concentration: data.concentration === true,
          casting_time: String(data.casting_time ?? "1 action"),
          range: String(data.range ?? "60 feet"),
          components: String(data.components ?? "V, S"),
          duration: String(data.duration ?? "Instantaneous"),
        },
      };
    case "item":
      return {
        kind,
        name: entry.name,
        data: {
          ...base.data,
          desc: String(data.desc ?? ""),
          itemKind: entry.kind === "magic_item" ? "magic_item" : "gear",
          rarity: String(entry.rarity ?? data.rarity ?? ""),
          cost: String(entry.cost ?? data.cost ?? ""),
          ...(typeof data.weight === "number" ? { weight: data.weight } : {}),
          ...(entry.kind === "magic_item"
            ? { requiresAttunement: /requires attunement/i.test(String(data.requires_attunement ?? data.desc ?? "")), effects: [] }
            : {}),
        },
      };
    case "feat":
      return { kind, name: entry.name, data: { desc: String(data.desc ?? ""), prerequisite: String(data.prerequisite ?? "") } };
    case "background":
      return {
        kind,
        name: entry.name,
        data: {
          desc: String(data.desc ?? ""),
          skill_proficiencies: String(data.skill_proficiencies ?? ""),
          tool_proficiencies: String(data.tool_proficiencies ?? ""),
          languages: String(data.languages ?? ""),
          equipment: String(data.equipment ?? ""),
          feature: String(data.feature ?? ""),
          feature_desc: String(data.feature_desc ?? ""),
        },
      };
    case "race":
      return {
        kind,
        name: entry.name,
        data: {
          desc: String(data.desc ?? ""),
          traits: String(data.traits ?? ""),
          size: String(data.size ?? "Medium").split(".")[0].slice(0, 40),
          speed: { walk: Number((data.speed as { walk?: number })?.walk ?? 30) || 30 },
          asi: Array.isArray(data.asi) ? data.asi : [],
          languages: String(data.languages ?? ""),
          vision: String(data.vision ?? ""),
        },
      };
    case "archetype":
      return {
        kind,
        name: entry.name,
        data: { desc: String(data.desc ?? ""), classSlug: extra.classSlug ?? "fighter", levels: {} },
      };
  }
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
