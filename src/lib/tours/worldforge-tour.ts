import type { TourStep } from "./logic.ts";

// The WorldForge tool's tour (src/app/workshop/world), between the rail and
// help steps every workshop tour shares (src/lib/tours/workshop.ts). Steps
// past the wiki switch the panel's view first: the panel answers the
// "world-view-<view>" prepare names, and those steps are lazy so a target
// that appears a beat later is still found.
//
// Each step says what the author ends up with and where it goes, not only
// what the control is (plan M5 item 6, audit WF-22). The AI views' steps
// say what they need, because on a server with no text model their view is
// not there and the card stands on its own.

export const WORLD_TOUR_STEPS: TourStep[] = [
  {
    id: "create",
    title: "Start from what you want",
    body: "Create asks what you want to end up with (a person, a place, a monster, an item, a fight, a map or a whole world) and opens the tool that makes it, so a monster gets a stat block the table can fight and an item rules the sheet can use. Each can be made by hand or copied from one that exists; Draft with AI is offered where the server has a text model.",
    anchors: ["workshop-create"],
  },
  {
    id: "import",
    title: "A world from WorldForge",
    body: "Open a WorldForge export and it joins this world: characters, places, factions, every other entry, their links, calendars, events, secrets and maps. Opening the same file again updates what is here rather than doubling it. A file that would not come in whole says what each scene would lose before anything is written.",
    anchors: ["world-import"],
  },
  {
    id: "wiki",
    title: "Every entry is a record the table uses",
    body: "A person here is in the Cast, a place in the Region's places, a faction in Factions and the rest in Lore, so a change in either tool shows in both. Open an entry to write it and link it to others, and to what the table plays with: a stat block or an item it is about, and for a place its battle maps and encounters. Add to a fight puts that exact monster into an encounter.",
    anchors: ["world-new-entry"],
    prepare: "world-view-wiki",
    lazy: true,
  },
  {
    id: "outline",
    title: "Draft a world from an idea",
    body: "Write a line or two and a model drafts an outline: people, places, factions and lore, and a few creatures and items, each counted. Nothing is made until you tick rows. Creatures are built and checked in the Bestiary and items in Homebrew, each with a World entry linked to it, and a row that fails says why and can be retried on its own. Needs a text model, which an admin adds under Admin > Text model defaults.",
    anchors: ["world-outline"],
    prepare: "world-view-outline",
    lazy: true,
  },
  {
    id: "forge",
    title: "Extract from your notes",
    body: "Paste notes you already have and the model lists what they name and how those things stand with each other; it never invents what the notes leave out. Nothing is written until you tick what to keep, a name the world already has is never rewritten, and the report after names anything not added, and why. Needs a text model, as Outline does.",
    anchors: ["world-forge"],
    prepare: "world-view-forge",
    lazy: true,
  },
  {
    id: "ask",
    title: "Ask the world",
    body: "A question answered from this world only, hidden truths included. Each answer lists the passages it rests on, with where each one is and whether it is settled canon; an answer that cites nothing says to check it first. Needs a text model, as Outline does.",
    anchors: ["world-ask"],
    prepare: "world-view-ask",
    lazy: true,
  },
  {
    id: "web",
    title: "The web",
    body: "Every link drawn as a web, a family tree read off the family words, and a chain of command read off the chain words. Switch to what people believe to see the world as the players will hear it.",
    anchors: ["world-web"],
    prepare: "world-view-web",
    lazy: true,
  },
  {
    id: "timeline",
    title: "The world's history",
    body: "Calendars are reckonings with an offset, so a year in one reads in all of them. Events run in order, grouped by era, and anyone named outside their own lifetime is flagged. This dates the world's past: a campaign keeps its own clock, and an event here schedules nothing at the table.",
    anchors: ["world-new-event"],
    prepare: "world-view-timeline",
    lazy: true,
  },
  {
    id: "atlas",
    title: "The atlas",
    body: "Maps with a pin on each place that matters, maps inside maps, and regions drawn as shapes. Use a map as the Region backdrop, then place its pinned places on the playable Region; each then moves with its pin. Every change is reviewed before it is made, and a deleted map can be undone straight after. Players see a map only once you show it to the party, and then only its shown pins and regions.",
    anchors: ["world-atlas"],
    prepare: "world-view-atlas",
    lazy: true,
  },
  {
    id: "secrets",
    title: "Secrets",
    body: "What the secret is, whom it is about and who keeps it. The AI DM is told the ones the party has not learned, so a keeper can let one slip. In a campaign's World tab, Reveal to the party writes it into the players' lore as they learn it and marks it learned.",
    anchors: ["world-new-secret"],
    prepare: "world-view-secrets",
    lazy: true,
  },
  {
    id: "stubs",
    title: "Still to write",
    body: "Reads the whole world for names nothing answers to yet. Keep one as a stub, write it as an entry, or dismiss it for good.",
    anchors: ["world-scan"],
    prepare: "world-view-stubs",
    lazy: true,
  },
  {
    id: "types",
    title: "Types and fields",
    body: "Make the types your world needs and the fields each keeps: text, a number, a pick from a list, or a year. A year can mark a birth or a death; any field can be yours alone.",
    anchors: ["world-new-type"],
    prepare: "world-view-types",
    lazy: true,
  },
  {
    id: "export",
    title: "Back to WorldForge",
    body: "Saves this world as a WorldForge file, pictures and all. When the storyboard holds more than a file can carry (a card's kind, its routes, its fight), it first lists what each card would lose and offers a workshop bundle, which carries all of it.",
    anchors: ["world-export"],
  },
];
