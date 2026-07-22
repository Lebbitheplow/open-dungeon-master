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

// --- Open5e v2 ---
//
// v2 covers sources v1 never got (SRD 5.2, Black Flag, Gate Pass Gazette) and
// describes classes as level-tagged feature lists instead of one prose blob.
// Its rows use `key` where v1 used `slug` and nest the document, so each of
// these lands on exactly the same column shape as its v1 sibling and no query
// in src/lib/content/index.ts has to know which half a row came from.

function v2Document(raw) {
  return String(raw.document?.key || raw.document || "");
}

// v2 keys are prefixed by document ("srd-2024_acid-arrow"). The bare slug is
// what sheets and the SRD tables use, so it is preferred; the importer only
// falls back to the prefixed key when the bare one is already taken by a v1
// row, which keeps v1 slugs stable for existing characters.
export function v2Slug(raw) {
  const key = String(raw.key || "");
  const bare = key.includes("_") ? key.slice(key.indexOf("_") + 1) : key;
  return { bare: bare || slugify(raw.name), key: key || slugify(raw.name) };
}

export function normalizeSpellV2(raw) {
  const { bare, key } = v2Slug(raw);
  return {
    slug: bare,
    altSlug: key,
    name: raw.name,
    document_slug: v2Document(raw),
    level: Number.isInteger(raw.level) ? raw.level : 0,
    school: String(raw.school?.name || raw.school || "").toLowerCase(),
    classes_csv: csv((Array.isArray(raw.classes) ? raw.classes : []).map((entry) => entry.name)),
    ritual: raw.ritual ? 1 : 0,
    concentration: raw.concentration ? 1 : 0,
    data: raw,
  };
}

export function normalizeFeatV2(raw) {
  const { bare, key } = v2Slug(raw);
  // The pickers render `desc`; v2 splits a feat's real content into benefits.
  const benefits = (Array.isArray(raw.benefits) ? raw.benefits : [])
    .map((benefit) => String(benefit.desc || "").trim())
    .filter(Boolean);
  const desc = [String(raw.desc || "").trim(), ...benefits].filter(Boolean).join("\n\n");
  return {
    slug: bare,
    altSlug: key,
    name: raw.name,
    document_slug: v2Document(raw),
    data: { ...raw, desc, prerequisite: raw.prerequisite || "" },
  };
}

export function normalizeBackgroundV2(raw) {
  const { bare, key } = v2Slug(raw);
  const benefits = Array.isArray(raw.benefits) ? raw.benefits : [];
  const skillText = benefits
    .filter((benefit) => String(benefit.type || "").includes("skill"))
    .map((benefit) => benefit.desc)
    .join(", ");
  const desc = [
    String(raw.desc || "").trim(),
    ...benefits.map((benefit) =>
      [benefit.name, benefit.desc].filter(Boolean).join(": ").trim(),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    slug: bare,
    altSlug: key,
    name: raw.name,
    document_slug: v2Document(raw),
    skills_csv: csv(skillText.split(/[,;]/)),
    data: { ...raw, desc },
  };
}

// v2 calls races species and keeps subspecies in a separate endpoint, so a
// species row is always a parent here.
export function normalizeSpeciesV2(raw) {
  const { bare, key } = v2Slug(raw);
  const parentKey = raw.subrace_of?.key || raw.species?.key || "";
  return {
    slug: bare,
    altSlug: key,
    name: raw.name,
    document_slug: v2Document(raw),
    is_subrace: parentKey ? 1 : 0,
    parent_slug: parentKey ? v2Slug({ key: parentKey, name: parentKey }).bare : "",
    data: raw,
  };
}

// v2 flattens classes and subclasses into one endpoint: a row with
// `subclass_of` is an archetype of that class. Its features carry the level
// they are gained at, which is what makes v2 worth importing at all.
export function normalizeClassRowsV2(raw) {
  const { bare, key } = v2Slug(raw);
  const hitDie = Number.parseInt(String(raw.hit_dice || "").replace(/^\d*d/i, ""), 10);
  const features = (Array.isArray(raw.features) ? raw.features : []).map((feature) => ({
    name: feature.name,
    desc: feature.desc,
    levels: (Array.isArray(feature.gained_at) ? feature.gained_at : [])
      .map((entry) => entry.level)
      .filter((level) => Number.isInteger(level)),
  }));
  const parentKey = raw.subclass_of?.key || raw.subclass_of || "";
  const base = {
    slug: bare,
    altSlug: key,
    name: raw.name,
    document_slug: v2Document(raw),
    data: { ...raw, features },
  };
  if (parentKey) {
    return {
      archetype: { ...base, class_slug: v2Slug({ key: parentKey, name: parentKey }).bare },
    };
  }
  return {
    cls: { ...base, hit_die: Number.isFinite(hitDie) ? hitDie : 8 },
  };
}

export function normalizeDocumentV2(raw) {
  const title = raw.display_name || raw.name || raw.key;
  return {
    slug: String(raw.key || ""),
    altSlug: String(raw.key || ""),
    name: title,
    title,
    license: (Array.isArray(raw.licenses) ? raw.licenses : [])
      .map((entry) => entry.name)
      .filter(Boolean)
      .join(", "),
    author: String(raw.publisher?.name || ""),
    url: String(raw.permalink || raw.url || ""),
    data: raw,
  };
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
