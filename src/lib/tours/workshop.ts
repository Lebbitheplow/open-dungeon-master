// The workshop tours: the shelf, the hub of a workshop, and one per tool.
// Anchors are data-tour values on the workshop pages and the prep panels;
// prepare names are broadcast by the page (src/lib/tours/prepare.ts) and
// answered by the panel that owns the editor or card in question. Lazy
// steps point at things inside those editors, which do not exist until the
// prepare runs. No "@/" imports here: scripts/test-tours.mjs loads this
// straight from disk.
import type { TourStep } from "./logic";

export const SHELF_TOUR_ID = "workshop-shelf";
export const HUB_TOUR_ID = "workshop-hub";

export function systemTourId(system: string): string {
  return `workshop-${system}`;
}

export const SHELF_TOUR: TourStep[] = [
  {
    id: "welcome",
    title: "The workshop shelf",
    body: "A workshop is a prep space with no players and no story running: maps, people, monsters, fights, tables and rules built on your own time, then brought into a campaign when the table sits down. Each one on this shelf stands alone.",
    anchors: [],
  },
  {
    id: "new",
    title: "Start a workshop",
    body: "Name it and say what party it is built for. Every encounter budget and odds preview inside measures against that party, so difficulty readouts mean something before real characters exist.",
    anchors: ["shelf-new"],
  },
  {
    id: "import",
    title: "Import a bundle",
    body: "A bundle is a whole workshop as one file, exported from the Share tool here or on another server. Importing makes a new workshop of your own; nothing is written into a campaign.",
    anchors: ["shelf-import"],
  },
  {
    id: "list",
    title: "Your workshops",
    body: "Tap one to open it. Duplicate copies everything in it, board included, for a second version of the same region without risking the first.",
    anchors: ["shelf-list"],
  },
  {
    id: "help",
    title: "Help and tours",
    body: "Every tool inside a workshop has a written guide and a tour of its own. Open them from this button, or from the same button inside any tool.",
    anchors: ["shelf-help"],
  },
];

export const HUB_TOUR: TourStep[] = [
  {
    id: "welcome",
    title: "Inside a workshop",
    body: "Thirteen tools, one card each, wearing a live count so you can see what is built and what is still empty. This tour shows the frame; each tool opens with a short tour of its own the first time.",
    anchors: [],
  },
  {
    id: "party",
    title: "Who it is built for",
    body: "The stand-in party. Change the size or level and every fight in Encounters is rebudgeted against it. It stays pinned inside every tool.",
    anchors: ["hub-party"],
  },
  {
    id: "systems",
    title: "The tools",
    body: "Storyboard plans the arc. Party, Battle maps, Region, Encounters, Cast, Bestiary, Homebrew, Lore and Tables each build one kind of material. Rules holds the house and variant rules. Plugin builds a world pack other servers can install. Share packs it all up.",
    anchors: ["hub-systems"],
  },
  {
    id: "actions",
    title: "Rename, copy, delete",
    body: "The pencil renames the workshop in place. The copy button duplicates it with everything inside. Delete is final for the workshop, though anything already imported into a campaign stays there.",
    anchors: ["hub-actions"],
  },
  {
    id: "import",
    title: "Import a bundle",
    body: "Reads a bundle file from another workshop or server into a new workshop of its own.",
    anchors: ["hub-import"],
  },
  {
    id: "help",
    title: "Guides and tours",
    body: "The help button opens a guide for every tool and replays any tour. It is on this page and inside each tool.",
    anchors: ["hub-help"],
  },
];

// Every tool's tour opens on the rail so the person knows how to leave it,
// and ends on the help button. Between those, its own controls in the order
// a first session uses them.
const RAIL_STEP: TourStep = {
  id: "rail",
  title: "Hop between tools",
  body: "The rail switches tools without going back to the hub. The back link above it returns to the cards.",
  anchors: ["system-rail"],
};

const HELP_STEP: TourStep = {
  id: "help",
  title: "The guide",
  body: "Help opens the written guide for this tool and replays this tour.",
  anchors: ["system-help"],
};

function tool(steps: TourStep[]): TourStep[] {
  return [RAIL_STEP, ...steps, HELP_STEP];
}

export const SYSTEM_TOURS: Record<string, TourStep[]> = {
  storyboard: tool([
    {
      id: "add",
      title: "Add a card",
      body: "Pick what kind of thing it is (a scene, a fight, a place, a person, a payoff) and give it a title. Cards are the plan of the adventure.",
      anchors: ["storyboard-add"],
    },
    {
      id: "board",
      title: "The board",
      body: "Tap a card to write it up and link it to the material in the other tools: which NPC, which map, which prepared fight, which place. Linking is by dropdown, so a card never points at something that is not there.",
      anchors: ["storyboard-board"],
    },
    {
      id: "missing",
      title: "What the board is missing",
      body: "Counted, not guessed: a fight with no map, a payoff with no scene before it. Each line has a button that adds the card.",
      anchors: ["storyboard-missing"],
    },
    {
      id: "compile",
      title: "What it becomes",
      body: "The preview of what the board turns into when imported into a campaign: lore, quests, prepared fights, DM notes and the story arc.",
      anchors: ["storyboard-compile"],
    },
  ]),
  party: tool([
    {
      id: "roster",
      title: "The pregens",
      body: "Sheets ready for anyone who sits down without a character. A level that differs from the stand-in party is flagged so the budgets stay honest.",
      anchors: ["party-roster"],
    },
    {
      id: "add",
      title: "Add to the roster",
      body: "Pick a character from your library, or build a new one and come back. Pregens travel inside the bundle when you share the workshop.",
      anchors: ["party-add"],
    },
  ]),
  maps: tool([
    {
      id: "new",
      title: "A new map",
      body: "Open this to make one. Name it first; nothing here reaches a table until you put it there.",
      anchors: ["maps-new"],
    },
    {
      id: "create",
      title: "Roll, draw or import",
      body: "Roll one generates a layout from the size and a hint. Blank rock and Blank ground start empty for painting. Import reads a Universal VTT file from Dungeondraft and its neighbours.",
      anchors: ["maps-create"],
      prepare: "open-map-create",
      lazy: true,
    },
    {
      id: "gallery",
      title: "The drawer",
      body: "Every prepared map. Tap one to open the editor: paint terrain, stamp props, place lights, doors, labels and bystanders, hang a backdrop picture, and set the sound the map makes.",
      anchors: ["maps-gallery"],
    },
  ]),
  region: tool([
    {
      id: "canvas",
      title: "The overworld",
      body: "Drag to pan, scroll or pinch to zoom. Places appear to the party as they discover them; you see all of them.",
      anchors: ["region-canvas"],
    },
    {
      id: "modes",
      title: "The modes",
      body: "Add a pin, place the party, move a place, paint terrain, draw a road, river or border, write a label, or erase. Pick a mode, then tap the map.",
      anchors: ["region-modes"],
    },
    {
      id: "files",
      title: "Pictures and files",
      body: "Hang a picture in place of the tiles, read in a map from Azgaar's Fantasy Map Generator, or save the region as a PNG.",
      anchors: ["region-files"],
    },
    {
      id: "shape",
      title: "Shape the region",
      body: "Describe the land in a sentence and let it set the dials, roll a fresh world, or add named places by hand.",
      anchors: ["region-shape"],
    },
  ]),
  encounters: tool([
    {
      id: "workbench",
      title: "How hard is this?",
      body: "Weigh a roster before saving it. The readout is the same maths the engine enforces at the table, and every number shows its parts.",
      anchors: ["encounters-workbench"],
    },
    {
      id: "workbench-roster",
      title: "Pick the monsters",
      body: "Search what this world holds, the catalogue and your own bestiary, and the pick lands in the roster. Typing works too: one per line, optional x4.",
      anchors: ["encounters-workbench-roster"],
      prepare: "open-workbench",
      lazy: true,
    },
    {
      id: "list",
      title: "Prepared fights",
      body: "Each card carries its difficulty against the stand-in party and the map it opens on. Deploy puts it on a running table in one press.",
      anchors: ["encounters-list"],
    },
    {
      id: "new",
      title: "A new encounter",
      body: "Opens the editor for a fight.",
      anchors: ["encounters-new"],
    },
    {
      id: "picker",
      title: "The roster",
      body: "Search and pick monsters here; each pick is appended below, where you can still change the counts by hand.",
      anchors: ["encounters-picker"],
      prepare: "open-encounter-editor",
      lazy: true,
    },
    {
      id: "map",
      title: "On which map",
      body: "A prepared map from the drawer, or the generator's choice. With a map chosen you can place each creature and the party's entrance on it below.",
      anchors: ["encounters-map"],
      prepare: "open-encounter-editor",
      lazy: true,
    },
    {
      id: "save",
      title: "Prepare it",
      body: "Saves the fight. It is one button at the table from then on.",
      anchors: ["encounters-save"],
      prepare: "open-encounter-editor",
      lazy: true,
    },
  ]),
  cast: tool([
    {
      id: "search",
      title: "Find a person",
      body: "By name or alias. The list also fills itself in as the party meets people at the table.",
      anchors: ["cast-search"],
    },
    {
      id: "new",
      title: "Someone new",
      body: "Opens the editor for a person.",
      anchors: ["cast-new"],
    },
    {
      id: "fields",
      title: "Who they are",
      body: "Name, role, attitude to the party and where they are found; the role and the place are dropdowns you can also type into. Below that, their personality, what they want, and how they feel about everyone else.",
      anchors: ["cast-fields"],
      prepare: "open-npc-editor",
      lazy: true,
    },
    {
      id: "save",
      title: "Save them",
      body: "Keeps the person. Once saved you can add a face, set them aside, or duplicate them.",
      anchors: ["cast-save"],
      prepare: "open-npc-editor",
      lazy: true,
    },
  ]),
  bestiary: tool([
    {
      id: "build",
      title: "Build a monster",
      body: "Open this to start one.",
      anchors: ["bestiary-build"],
    },
    {
      id: "controls",
      title: "From a baseline or from the books",
      body: "Name it and pick a challenge rating for a baseline block, or search for a catalogue monster to start from and change what you like.",
      anchors: ["bestiary-build-controls"],
      prepare: "open-monster-build",
      lazy: true,
    },
    {
      id: "list",
      title: "Your monsters",
      body: "Tap one to open the full stat block: abilities, attacks, traits, senses, spells, and a kit that assembles it from ancestry, class and gear. The rating is derived for you and shows its working. Monsters belong to your account, so they follow you into every workshop.",
      anchors: ["bestiary-list"],
    },
  ]),
  homebrew: tool([
    {
      id: "kinds",
      title: "What kind",
      body: "Items, spells, feats, backgrounds, species and subclasses. Each kind writes the fields the character builder and the engine already read.",
      anchors: ["homebrew-kinds"],
    },
    {
      id: "search",
      title: "Find one of yours",
      body: "By name, within the kind you have open.",
      anchors: ["homebrew-search"],
    },
    {
      id: "new",
      title: "Make one",
      body: "Opens the editor for that kind.",
      anchors: ["homebrew-new"],
    },
    {
      id: "start",
      title: "Start from the books",
      body: "Search the content pack and copy a row in, then change one number instead of retyping nine fields. Everything is checked against the ruleset as you type.",
      anchors: ["homebrew-start"],
      prepare: "open-homebrew-editor",
      lazy: true,
    },
    {
      id: "save",
      title: "Keep it",
      body: "Saves the piece. A finding marked as an error blocks saving until it is fixed.",
      anchors: ["homebrew-save"],
      prepare: "open-homebrew-editor",
      lazy: true,
    },
  ]),
  lore: tool([
    {
      id: "search",
      title: "Search the lore",
      body: "By title, body or tag.",
      anchors: ["lore-search"],
    },
    {
      id: "new",
      title: "A new entry",
      body: "Opens the editor.",
      anchors: ["lore-new"],
    },
    {
      id: "title",
      title: "Category and title",
      body: "Geography, factions, history and the rest. The category is what the search tool at the table filters by.",
      anchors: ["lore-title"],
      prepare: "open-lore-editor",
      lazy: true,
    },
    {
      id: "body",
      title: "The entry",
      body: "Markdown is fine. Pinned entries reach the narrator every turn; the rest are retrieved when relevant.",
      anchors: ["lore-body"],
      prepare: "open-lore-editor",
      lazy: true,
    },
    {
      id: "link",
      title: "Link another entry",
      body: "Pick an entry and a [[link]] to it lands where the cursor is. Links open the other entry when read.",
      anchors: ["lore-link"],
      prepare: "open-lore-editor",
      lazy: true,
    },
    {
      id: "save",
      title: "Add it",
      body: "Saves the entry. Choose whether the table reads it or only you do, and attach a picture to make it a handout.",
      anchors: ["lore-save"],
      prepare: "open-lore-editor",
      lazy: true,
    },
  ]),
  tables: tool([
    {
      id: "search",
      title: "Your tables",
      body: "Each card shows what die it rolls on and whether every number is covered. Roll writes an ordinary roll everyone sees; what the row says comes back to you alone.",
      anchors: ["tables-search"],
    },
    {
      id: "new",
      title: "A new table",
      body: "Opens the editor.",
      anchors: ["tables-new"],
    },
    {
      id: "lookup",
      title: "Look up a monster",
      body: "A stat block from the catalogue, for reference while you write.",
      anchors: ["tables-lookup"],
    },
    {
      id: "body",
      title: "The rows",
      body: "One row per line, with a range or a weight. Paste a table straight out of a book. The line under the box reports gaps and overlaps as you type.",
      anchors: ["tables-body"],
      prepare: "open-table-editor",
      lazy: true,
    },
    {
      id: "ref",
      title: "A row that is a thing",
      body: "Pick what kind of thing (another table, a monster, an item, a person, a lore entry) and then the thing itself from what this workshop holds. The row is written for you.",
      anchors: ["tables-ref"],
      prepare: "open-table-editor",
      lazy: true,
    },
    {
      id: "save",
      title: "Save table",
      body: "Draw without replacement turns it into a deck: a rumour heard once is not heard again.",
      anchors: ["tables-save"],
      prepare: "open-table-editor",
      lazy: true,
    },
  ]),
  rules: tool([
    {
      id: "library",
      title: "Saved rulesets",
      body: "A ruleset is variant rules and house rulings kept as one thing, reusable across campaigns. Open one to see what applying it here would change.",
      anchors: ["rules-library"],
    },
    {
      id: "save-as",
      title: "Save these rules",
      body: "Keeps the rules below as a ruleset you can apply anywhere.",
      anchors: ["rules-save-as"],
    },
    {
      id: "variants",
      title: "Variant rules",
      body: "Switches the engine honours: flanking, rest lengths and the rest.",
      anchors: ["rules-variants"],
    },
    {
      id: "house",
      title: "House rules",
      body: "Written rules, grouped by heading. The narrator retrieves only the relevant sections each turn; pin one to include it always.",
      anchors: ["rules-house"],
    },
  ]),
  plugin: tool([
    {
      id: "sections",
      title: "The parts of a world pack",
      body: "A pack is a name mapping over the rules: the world's own races, classes, spells, gear and monsters, plus its factions, places, hooks and pictures. Each part is a tab here.",
      anchors: ["plugin-sections"],
    },
    {
      id: "guided",
      title: "Guided setup",
      body: "Walks through the identity of the world one question at a time: what it is called, whose setting it stands on, its genre and how the narrator should sound. Come back to it any time.",
      anchors: ["plugin-guided"],
    },
    {
      id: "pull",
      title: "Pull from this workshop",
      body: "Reads the lore, places, hook cards and cast you already built here into the pack's setting lists. It adds; it never overwrites what you wrote by hand.",
      anchors: ["plugin-pull"],
    },
    {
      id: "publish",
      title: "Check, download, install",
      body: "The Publish tab lists what is missing, then hands you the pack as one file. An admin can install it straight onto this server.",
      anchors: ["plugin-publish"],
    },
  ]),
  share: tool([
    {
      id: "manifest",
      title: "Name the bundle",
      body: "Name, a line about it, author and version. The rights holder line turns the notice into a proper non-affiliation disclaimer when the world is built on somebody else's setting.",
      anchors: ["share-manifest"],
    },
    {
      id: "export",
      title: "Download or compile",
      body: "Download bundle writes everything here as one file another server can import. Compile a world pack builds a draft pack from it.",
      anchors: ["share-export"],
    },
  ]),
};

// Every anchor any workshop tour can point at, for the tests and for a
// glance at what the pages must carry.
export function workshopTourAnchors(): string[] {
  const all = [
    ...SHELF_TOUR,
    ...HUB_TOUR,
    ...Object.values(SYSTEM_TOURS).flat(),
  ];
  return [...new Set(all.flatMap((step) => step.anchors))];
}
