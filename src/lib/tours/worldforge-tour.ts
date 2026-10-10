import type { TourStep } from "./logic.ts";

// The WorldForge tool's tour (src/app/workshop/world), between the rail and
// help steps every workshop tour shares (src/lib/tours/workshop.ts). Steps
// past the wiki switch the panel's view first: the panel answers the
// "world-view-<view>" prepare names, and those steps are lazy so a target
// that appears a beat later is still found.

export const WORLD_TOUR_STEPS: TourStep[] = [
  {
    id: "import",
    title: "A world from WorldForge",
    body: "Open a WorldForge export and it joins this world whole: characters, places, factions, every other entry, their links, calendars, events, secrets and maps. Opening the same file again updates what is here rather than doubling it.",
    anchors: ["world-import"],
  },
  {
    id: "wiki",
    title: "The wiki",
    body: "Every Cast member, place, faction and lore entry of the workshop is an entry here. Pick a type for a new one and it lands on that type's shelf, so the Cast or the Lore tool sees it at once.",
    anchors: ["world-new-entry"],
    prepare: "world-view-wiki",
    lazy: true,
  },
  {
    id: "forge",
    title: "The forge",
    body: "Paste notes and the model lists what in them deserves an entry and how those things stand with each other. Nothing is written until you tick what to keep, and a name the world already has is never rewritten. Offered when the server has a text model.",
    anchors: ["world-forge"],
    prepare: "world-view-forge",
    lazy: true,
  },
  {
    id: "ask",
    title: "Ask the world",
    body: "A question answered from this world only, hidden truths included, with every entry the answer names linked. When the world does not say, the answer says so.",
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
    title: "The timeline",
    body: "Calendars are reckonings with an offset, so a year in one reads in all of them. Events run in order, grouped by era, and anyone named outside their own lifetime is flagged.",
    anchors: ["world-new-event"],
    prepare: "world-view-timeline",
    lazy: true,
  },
  {
    id: "atlas",
    title: "The atlas",
    body: "Maps with a pin on each place that matters, maps inside maps, and regions drawn as shapes. Pins bound to places stand on the Region map too when a WorldForge file brings them.",
    anchors: ["world-atlas"],
    prepare: "world-view-atlas",
    lazy: true,
  },
  {
    id: "secrets",
    title: "Secrets",
    body: "What the secret is, whom it is about and who keeps it. The AI DM is told the ones the party has not learned, so a keeper can let one slip; mark it learned when the party finds out.",
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
    body: "Saves this world as a WorldForge file, pictures and all, to open in WorldForge itself or to share.",
    anchors: ["world-export"],
  },
];
