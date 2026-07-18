// Pure normalizers turning raw Open5e API rows into content-db rows. Shared
// by scripts/import-open5e.mjs and scripts/test-content.mjs so the shape
// contract is tested without hitting the network.

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csv(values) {
  return values
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(",");
}

// "Bard, Sorcerer, Wizard" or spell_lists ["bard", ...] -> "bard,sorcerer,wizard"
export function spellClassesCsv(raw) {
  if (Array.isArray(raw.spell_lists) && raw.spell_lists.length) {
    return csv(raw.spell_lists);
  }
  return csv(String(raw.dnd_class || "").split(","));
}

export function normalizeSpell(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    level: Number.isInteger(raw.level_int) ? raw.level_int : 0,
    school: String(raw.school || "").toLowerCase(),
    classes_csv: spellClassesCsv(raw),
    ritual: raw.can_be_cast_as_ritual || /yes/i.test(String(raw.ritual || "")) ? 1 : 0,
    concentration:
      raw.requires_concentration || /yes/i.test(String(raw.concentration || "")) ? 1 : 0,
    data: raw,
  };
}

export function normalizeFeat(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    data: raw,
  };
}

export const normalizeCondition = normalizeFeat;

export function normalizeBackground(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    skills_csv: csv(String(raw.skill_proficiencies || "").split(/[,;]/)),
    data: raw,
  };
}

// One parent race row plus one row per nested subrace.
export function normalizeRaceRows(raw) {
  const parent = {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    is_subrace: 0,
    parent_slug: "",
    data: { ...raw, subraces: undefined },
  };
  const subraces = Array.isArray(raw.subraces) ? raw.subraces : [];
  const children = subraces.map((sub) => ({
    slug: sub.slug || `${raw.slug}-${slugify(sub.name)}`,
    name: sub.name,
    document_slug: sub.document__slug || raw.document__slug || "",
    is_subrace: 1,
    parent_slug: raw.slug,
    data: sub,
  }));
  return [parent, ...children];
}

// One class row; archetypes returned separately with class_slug.
export function normalizeClassRows(raw) {
  const hitDie = Number.parseInt(String(raw.hit_dice || "").replace(/^\d*d/i, ""), 10);
  const cls = {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    hit_die: Number.isFinite(hitDie) ? hitDie : 8,
    data: { ...raw, archetypes: undefined },
  };
  const archetypes = (Array.isArray(raw.archetypes) ? raw.archetypes : []).map((arch) => ({
    slug: arch.slug || `${raw.slug}-${slugify(arch.name)}`,
    name: arch.name,
    document_slug: arch.document__slug || raw.document__slug || "",
    class_slug: raw.slug,
    data: arch,
  }));
  return { cls, archetypes };
}

export function normalizeWeapon(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    kind: "weapon",
    rarity: "",
    cost: String(raw.cost || ""),
    category: String(raw.category || "").toLowerCase(),
    data: raw,
  };
}

export function normalizeArmor(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    kind: "armor",
    rarity: "",
    cost: String(raw.cost || ""),
    category: String(raw.category || "").toLowerCase(),
    data: raw,
  };
}

export function normalizeMagicItem(raw) {
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    kind: "magic_item",
    rarity: String(raw.rarity || "").toLowerCase(),
    cost: "",
    category: String(raw.type || "").toLowerCase(),
    data: raw,
  };
}

// v2 items: only plain adventuring gear (weapon/armor sub-objects are null);
// v1 weapons/armor already cover the rest. v2 uses `key` and a document URL.
export function normalizeGearItem(raw) {
  if (raw.weapon || raw.armor) {
    return null;
  }
  const documentSlug =
    typeof raw.document === "string"
      ? raw.document.replace(/\/+$/, "").split("/").pop() || ""
      : String(raw.document?.key || "");
  const cost = Number.parseFloat(String(raw.cost ?? ""));
  return {
    slug: raw.key || slugify(raw.name),
    name: raw.name,
    document_slug: documentSlug,
    kind: "gear",
    rarity: "",
    cost: Number.isFinite(cost) ? `${cost} gp` : "",
    category: String(raw.category?.name || raw.category || "").toLowerCase(),
    data: raw,
  };
}

export function normalizeMonster(raw) {
  const cr = Number.parseFloat(String(raw.cr ?? ""));
  return {
    slug: raw.slug,
    name: raw.name,
    document_slug: raw.document__slug || "",
    cr: Number.isFinite(cr) ? cr : 0,
    type: String(raw.type || "").toLowerCase(),
    data: raw,
  };
}

export function normalizeDocument(raw) {
  return {
    slug: raw.slug,
    name: raw.title,
    title: raw.title,
    license: String(raw.license || ""),
    author: String(raw.author || ""),
    url: String(raw.url || raw.license_url || ""),
    data: raw,
  };
}
