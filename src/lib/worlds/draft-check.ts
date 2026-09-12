// What stands between a draft and a pack, said all at once.
//
// scripts/validate-world-packs.mjs is the author-facing validator for a
// folder of finished manifests. This is the same list of rules, asked of a
// draft while it is still being written, so the editor can show a person
// what is left rather than making them export to find out. The two must
// agree: a draft this passes is a manifest the validator passes, except for
// the content-pack checks (real monster slugs, real spell names), which need
// the server and live in ./draft-integrity.ts.
//
// Two grades. A `problem` is something worldPackSchema or the validator
// refuses, so the export button waits on it. `advice` is the size targets
// and the DM brief floor: a pack under them installs fine and plays thin,
// and the person deciding that is the one who wrote it.
//
// Client-safe: the catalogs it reads are the same JSON the character builder
// already ships to the browser.
import { findClass, findRace, SRD_BACKGROUNDS } from "@/lib/srd";
import { CUSTOM_BACKGROUNDS } from "@/lib/backgrounds";
import { MAX_PACK_ART_BYTES, packArtSlots } from "@/lib/worlds/art";
import { finishDraft, type WorldPackDraft } from "@/lib/worlds/draft";

export type DraftCheck = {
  // Blocks export.
  problems: string[];
  // Worth doing before sharing.
  advice: string[];
};

const ALIGNMENT_CODES = new Set(["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"]);

// The floors scripts/validate-world-packs.mjs enforces on a bundled pack,
// offered here as targets.
export const SIZE_TARGETS: Array<{ key: string; label: string; floor: number }> = [
  { key: "races", label: "races", floor: 6 },
  { key: "classes", label: "classes", floor: 6 },
  { key: "backgrounds", label: "backgrounds", floor: 4 },
  { key: "monsters", label: "monsters", floor: 15 },
  { key: "spells", label: "spells", floor: 10 },
  { key: "items", label: "items", floor: 6 },
  { key: "factions", label: "factions", floor: 3 },
  { key: "locations", label: "places", floor: 4 },
  { key: "hooks", label: "hooks", floor: 4 },
  { key: "glossary", label: "glossary lines", floor: 6 },
];

export const DM_FLAVOR_FLOOR = 200;

function dataUrlBytes(dataUrl: string): number {
  return Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
}

// Every string in the pack, with the path it sits at, for the em dash walk
// the validator does.
function walkStrings(value: unknown, trail: string, visit: (text: string, at: string) => void) {
  if (typeof value === "string") {
    visit(value, trail);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => walkStrings(entry, `${trail}[${index + 1}]`, visit));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "art") continue;
      walkStrings(entry, trail ? `${trail}.${key}` : key, visit);
    }
  }
}

export function checkDraft(draft: WorldPackDraft): DraftCheck {
  const problems: string[] = [];
  const advice: string[] = [];
  const pack = finishDraft(draft) as ReturnType<typeof finishDraft> & {
    races: Array<{ id: string; name: string }>;
    classes: Array<{ id: string; name: string; castingLabel: string | null }>;
    backgrounds: Array<{ id: string; name: string }>;
    spells: Array<{ from: string; name: string }>;
    items: Array<{ from: string; name: string }>;
    features: Array<{ from: string; name: string }>;
    monsters: Array<{ slug: string; name: string; cr: number }>;
    factions: Array<{ name: string }>;
    locations: Array<{ name: string }>;
    hooks: string[];
    glossary: Array<{ term: string }>;
    nameSeeds: { people: string[]; places: string[] };
    companionRaces: string[];
    alignments: string[];
    art: Record<string, string>;
  };

  // ---- the identity a pack cannot ship without ----
  if (!String(pack.name)) problems.push("Give the world a name.");
  if (!String(pack.blurb)) problems.push("Write the one-line blurb the picker shows.");
  if (!String(pack.inspiredBy)) problems.push("Say what the world is inspired by, even if the answer is 'my own'.");
  if (!String(pack.theme)) problems.push("Set the theme line: it seeds every campaign that picks this world.");
  if (pack.baseGenre === "custom") problems.push("Pick a base genre; a pack cannot be 'custom'.");
  if (!/^[a-z][a-z0-9_]{2,49}$/.test(String(pack.id))) {
    problems.push("The name does not fold to a usable id; give it a few letters.");
  }

  // ---- reskins by id ----
  for (const entry of pack.races) {
    if (!findRace(entry.id)) problems.push(`Race "${entry.id}" is not in the catalog.`);
  }
  for (const entry of pack.classes) {
    const klass = findClass(entry.id);
    if (!klass) {
      problems.push(`Class "${entry.id}" is not in the catalog.`);
    } else if (klass.spellAbility === null && entry.castingLabel) {
      problems.push(`${klass.name} does not cast, so its casting label must stay empty.`);
    }
  }
  const backgroundIds = new Set([
    ...SRD_BACKGROUNDS.map((entry) => entry.id),
    ...CUSTOM_BACKGROUNDS.map((entry) => entry.id),
  ]);
  for (const entry of pack.backgrounds) {
    if (!backgroundIds.has(entry.id)) problems.push(`Background "${entry.id}" is not in the catalog.`);
  }
  for (const id of pack.companionRaces) {
    if (!findRace(id)) problems.push(`Companion race "${id}" is not in the catalog.`);
  }
  for (const [key, list] of [
    ["races", pack.races],
    ["classes", pack.classes],
    ["backgrounds", pack.backgrounds],
  ] as const) {
    const names = new Set<string>();
    const ids = new Set<string>();
    for (const entry of list) {
      if (entry.name.toLowerCase() === entry.id.toLowerCase()) {
        problems.push(`In ${key}, "${entry.id}" is renamed to its own id.`);
      }
      if (names.has(entry.name.toLowerCase())) problems.push(`Two ${key} are both called "${entry.name}".`);
      if (ids.has(entry.id)) problems.push(`"${entry.id}" is reskinned twice in ${key}; only one would show.`);
      names.add(entry.name.toLowerCase());
      ids.add(entry.id);
    }
  }

  // ---- reskins by name ----
  for (const [key, list] of [
    ["spells", pack.spells],
    ["items", pack.items],
    ["features", pack.features],
  ] as const) {
    const names = new Set<string>();
    const sources = new Set<string>();
    for (const entry of list) {
      if (entry.name.toLowerCase() === entry.from.toLowerCase()) {
        problems.push(`In ${key}, "${entry.from}" is renamed to itself.`);
      }
      if (names.has(entry.name.toLowerCase())) problems.push(`Two ${key} are both called "${entry.name}".`);
      if (sources.has(entry.from.toLowerCase())) problems.push(`"${entry.from}" is reskinned twice in ${key}.`);
      names.add(entry.name.toLowerCase());
      sources.add(entry.from.toLowerCase());
    }
  }

  // ---- monsters ----
  const slugs = new Set<string>();
  for (const entry of pack.monsters) {
    if (slugs.has(entry.slug)) problems.push(`Monster "${entry.slug}" is listed twice.`);
    slugs.add(entry.slug);
  }

  for (const code of pack.alignments) {
    if (!ALIGNMENT_CODES.has(code)) problems.push(`"${code}" is not an alignment code.`);
  }

  // ---- art ----
  const slotKeys = new Set<string>();
  for (const slot of packArtSlots(pack)) {
    if (slotKeys.has(slot.key)) {
      problems.push(`Two ${slot.kind}s fold to the same picture key "${slot.key}"; rename one.`);
    }
    slotKeys.add(slot.key);
  }
  for (const [key, dataUrl] of Object.entries(pack.art)) {
    const bytes = dataUrlBytes(dataUrl);
    if (bytes > MAX_PACK_ART_BYTES) {
      problems.push(`The picture for "${key}" is ${Math.round(bytes / 1024)} KB; the cap is ${MAX_PACK_ART_BYTES / 1024} KB.`);
    }
  }

  // ---- the house style ----
  walkStrings(pack, "", (text, at) => {
    if (text.includes("—")) problems.push(`There is an em dash in ${at}; packs use plain dashes.`);
  });

  // ---- advice ----
  if (String(pack.dmFlavor).length < DM_FLAVOR_FLOOR) {
    advice.push(
      `The DM brief is ${String(pack.dmFlavor).length} characters; ${DM_FLAVOR_FLOOR} or more is what steers the narrator.`,
    );
  }
  for (const target of SIZE_TARGETS) {
    const count = (pack[target.key as keyof typeof pack] as unknown[]).length;
    if (count < target.floor) advice.push(`${count} ${target.label}; a full pack has at least ${target.floor}.`);
  }
  if (pack.nameSeeds.people.length < 6) advice.push("Fewer than six people names to suggest in the builder.");
  if (pack.nameSeeds.places.length < 6) advice.push("Fewer than six place names to suggest in the builder.");
  if (!String(pack.rightsHolder)) {
    advice.push("No rights holder, so this ships as an original world. Fill it in if it stands on somebody else's setting.");
  }
  if (!pack.art.cover) advice.push("No cover picture; the picker will show the genre plate.");

  return { problems, advice };
}
