import type { WorkshopBundle } from "@/lib/workshop/bundle";
import { VARIANT_RULE_LABELS } from "@/lib/rulesets/logic";
import { typeFor, type BindingKind } from "@/lib/worldforge/model";
import type { Carried } from "@/lib/workshop/to-pack";
import type { BundleWorld } from "@/lib/workshop/to-pack-world";

// Everything a world pack leaves out of a workshop, kind by kind, each kind
// with the exact entries it leaves (audit finding WF-18). A pack is a
// setting: names, a line for each faction and place, hooks, a glossary and
// name seeds. A workshop holds a world and a scenario around it. This list
// is the difference, so the author reads it before publishing and knows
// what a table installing the pack will not get. The workshop bundle is the
// format that carries all of it (src/lib/workshop/bundle.ts).
//
// Three groups:
//   - world: World detail a pack has no place for (the Atlas, the timeline,
//     secrets, the storyboard, custom fields, relationships), and what of
//     the setting the compile kept back or cut short.
//   - scenario: scenario and mechanics (encounters, battle maps, homebrew,
//     hand-built monsters, roll tables, shops, pregens, rules).
//   - setting: what the compile carries but the draft does not hold
//     (./to-pack.ts notInDraft), worked out against the draft on screen.
//
// Pure. Asset lines are written for the person who wrote the entries, in
// the entries' own names.

export type PackOmission = {
  key: string;
  group: "world" | "scenario" | "setting";
  label: string;
  reason: string;
  assets: string[];
};

export const OMISSION_GROUPS: Record<PackOmission["group"], string> = {
  setting: "Setting the draft does not hold",
  world: "World detail a pack cannot carry",
  scenario: "Scenario and mechanics",
};

const BINDING_WORDS: Record<BindingKind, string> = {
  monster: "its stat block",
  item: "its item",
  map: "a battle map",
  encounter: "an encounter",
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function packOmissions(bundle: WorkshopBundle, world: BundleWorld, carried: Carried): PackOmission[] {
  const { doc, rows, nameOf } = world;
  const all = Object.values(rows).flat();
  const out: PackOmission[] = [];
  const add = (omission: PackOmission) => {
    if (omission.assets.length) out.push(omission);
  };

  // ---- world detail ----

  add({
    key: "atlas",
    group: "world",
    label: "Atlas maps",
    reason: "A pack has no maps. Each Atlas map, with its picture, pins and regions, stays in the workshop bundle.",
    assets: doc.maps.map((map) => {
      const pins = doc.pins.filter((pin) => pin.mapId === map.id).length;
      return `${map.name || "An unnamed map"}${pins ? ` (${plural(pins, "pin")})` : ""}`;
    }),
  });
  add({
    key: "timeline",
    group: "world",
    label: "Timeline",
    reason: "A pack has no timeline. Its calendar is a year of months and festivals, not the eras these events are dated in.",
    assets: [...doc.calendars.map((calendar) => `Calendar: ${calendar.name}`), ...doc.events.map((event) => `Event: ${event.title}`)],
  });
  add({
    key: "secrets",
    group: "world",
    label: "Secrets and hidden truths",
    reason: "A pack has no private part: whoever installs it can read every line. Secrets, and what an entry hides, stay in the workshop.",
    assets: [
      ...doc.secrets.map((secret) => `Secret: ${secret.title}${secret.subject ? ` (about ${nameOf(secret.subject)})` : ""}`),
      ...all.filter((row) => row.entry.hiddenTruth.trim()).map((row) => `${row.name}: its hidden truth`),
    ],
  });
  add({
    key: "held",
    group: "world",
    label: "Kept back",
    reason: "A lore entry kept for the DM, and an entry that is not canon yet, stay out of the pack: it has no private part and no way to mark a line as unsettled.",
    assets: all.filter((row) => row.held).map((row) => `${row.name} (${row.held})`),
  });
  add({
    key: "storyboard",
    group: "world",
    label: "Storyboard cards",
    reason: "Hook cards become the pack's hooks. The other cards, their arrows and what each one picks, stay in the workshop bundle.",
    assets: bundle.storyboard.filter((beat) => beat.kind !== "hook").map((beat) => `${beat.title} (${beat.kind})`),
  });
  add({
    key: "fields",
    group: "world",
    label: "Custom fields",
    reason: "A pack's entries are a name and a line, with no fields.",
    assets: all.flatMap((row) => {
      const type = typeFor(doc, row.shelf, row.entry.typeId);
      return Object.keys(row.entry.fields)
        .filter((id) => !carried.fields.has(`${row.ref} ${id}`))
        .map((id) => `${row.name}: ${type.fields.find((field) => field.id === id)?.name ?? "a field its type no longer has"}`);
    }),
  });
  add({
    key: "links",
    group: "world",
    label: "Relationships",
    reason: "A pack does not link its entries. A faction's members and seat ride in its line where they fit; the other links, and the roads between places, stay in the workshop.",
    assets: [
      ...doc.links
        .filter((link) => !carried.links.has(link.id))
        .map((link) => `${nameOf(link.from)} ${link.label} ${nameOf(link.to)}${link.veracity === "hidden" ? " (hidden)" : link.veracity === "believed" ? " (a false belief)" : ""}`),
      ...bundle.locations.flatMap((place) => place.connections.map((other) => `${place.name} leads to ${other}`)),
    ],
  });
  const people = rows.npc.filter((row) => !row.held);
  add({
    key: "cast",
    group: "world",
    label: "The Cast",
    reason: "A pack's people are name seeds: the first 40 names are offered in the character builder. Who each one is, their line, goals and stat block, stays in the workshop.",
    assets: people.map((row, index) => (index < 40 ? row.name : `${row.name} (past the first 40, so no name seed)`)),
  });
  add({
    key: "faction-details",
    group: "world",
    label: "Faction details",
    reason: "A pack's faction is a name and a line. What a faction wants, and its tags, stay in the workshop.",
    assets: rows.faction.flatMap((row, index) => {
      const faction = bundle.factions[index];
      return [...(faction.goal.trim() ? [`${row.name}: its goal`] : []), ...(faction.tags.length ? [`${row.name}: its tags`] : [])];
    }),
  });
  add({
    key: "notes",
    group: "world",
    label: "Author's notes",
    reason: "Your working notes on an entry are yours, and stay in the workshop.",
    assets: all.filter((row) => row.entry.notes.trim()).map((row) => row.name),
  });
  add({
    key: "pictures",
    group: "world",
    label: "Pictures",
    reason: "Pulling copies no pictures. A faction or place in the pack can have one from the Pictures tab.",
    assets: [
      ...bundle.factions.filter((faction) => faction.portrait).map((faction) => `${faction.name}: its portrait`),
      ...Object.keys(bundle.world?.entryImages ?? {}).map((ref) => `${nameOf(ref)}: its picture`),
      ...bundle.npcs.filter((npc) => npc.portrait).map((npc) => `${npc.name}: their portrait`),
      ...bundle.lore.filter((lore) => lore.image).map((lore) => `${lore.title}: its picture`),
    ],
  });
  add({
    key: "shortened",
    group: "world",
    label: "Cut to fit a pack line",
    reason: "A faction's or a place's line holds 200 characters and a glossary meaning 160. These accounts were cut where a sentence ends; the whole text stays in the workshop.",
    assets: carried.shortened,
  });

  // ---- scenario and mechanics ----

  add({
    key: "monsters",
    group: "scenario",
    label: "Hand-built monsters",
    reason: "A pack's monster list overlays a name onto an existing SRD stat block by slug, and a monster built from scratch has no slug to overlay.",
    assets: bundle.monsters.map((monster) => monster.name),
  });
  add({
    key: "homebrew",
    group: "scenario",
    label: "Homebrew",
    reason: "A pack renames what the rules already have; it does not add spells, items or options. Your homebrew stays in the workshop bundle.",
    assets: bundle.homebrew.map((entry) => `${entry.name} (${entry.kind})`),
  });
  add({
    key: "encounters",
    group: "scenario",
    label: "Encounters",
    reason: "A world pack is a setting, not a scenario. Prepared fights stay in the workshop bundle, which is the format that carries them.",
    assets: bundle.encounters.map((encounter) => encounter.name),
  });
  add({
    key: "maps",
    group: "scenario",
    label: "Battle maps",
    reason: "A world pack is a setting, not a scenario. Battle maps, with their walls, doors and light, stay in the workshop bundle.",
    assets: bundle.maps.map((map) => map.name),
  });
  add({
    key: "bindings",
    group: "scenario",
    label: "Links to playable records",
    reason: "A World entry's link to its stat block, item, battle map or encounter needs the record beside it, so it stays in the workshop bundle.",
    assets: all.flatMap((row) => row.entry.bindings.map((binding) => `${row.name}: ${BINDING_WORDS[binding.kind]}`)),
  });
  add({
    key: "tables",
    group: "scenario",
    label: "Roll tables",
    reason: "A pack has no roll tables. They stay in the workshop bundle.",
    assets: bundle.tables.map((table) => table.name),
  });
  add({
    key: "shops",
    group: "scenario",
    label: "Shops",
    reason: "A pack has no Market. Shops and their stock stay in the workshop bundle.",
    assets: bundle.shops.map((shop) => shop.name),
  });
  add({
    key: "pregens",
    group: "scenario",
    label: "Pregenerated characters",
    reason: "A pack has no characters to hand out. Pregens stay in the workshop bundle.",
    assets: bundle.pregens.map((pregen) => pregen.name),
  });
  add({
    key: "region",
    group: "scenario",
    label: "Region map",
    reason: "A pack has no maps. The region map stays in the workshop bundle.",
    assets: bundle.overworld ? [`The region map (${plural(bundle.overworld.anchors.length, "place")} on it)`] : [],
  });
  add({
    key: "rules",
    group: "scenario",
    label: "House rules",
    reason: "A pack sets no rules. A table that installs it plays by its own until it reads yours.",
    assets: [
      ...(bundle.houseRulesText.trim() ? ["The house rules text"] : []),
      ...Object.entries(VARIANT_RULE_LABELS)
        .filter(([key]) => bundle.variantRules[key] === true)
        .map(([, label]) => `Variant rule: ${label}`),
    ],
  });

  return out;
}
