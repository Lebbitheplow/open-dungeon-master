// The written guide to each workshop tool: what it is for and where what it
// makes lives, how a first session goes, how it is used at the table, and
// the things people miss. Those are the plan's three questions for anything
// made (M5 item 6, audit WF-22): where did it go, what can I do with it,
// how do I use it at the table. WorkshopHelpDialog renders it; the tour of
// each tool covers the same ground with a spotlight. Kept as data so the
// test can check every tool has a guide, and so the copy sits beside the
// tours it matches.

export interface ToolGuide {
  id: string;
  title: string;
  // One line: what the tool is for.
  purpose: string;
  // A first session, in order.
  steps: string[];
  // How what it makes is used once a campaign brings it in.
  atTable: string;
  // The things people miss.
  tips: string[];
}

export const WORKSHOP_GUIDES: ToolGuide[] = [
  {
    id: "world",
    title: "WorldForge",
    purpose: "The world itself, after Smoebo's WorldForge: a wiki of typed entries that are this workshop's people, places, factions and lore, the links between them, a timeline, an atlas, secrets, and the names still to write.",
    steps: [
      "Start from Create: a person, a place, a monster, an item or a whole world. Draft a world from an idea drafts an outline you tick rows from; making a first entry by hand, or opening a WorldForge file, needs no model at all.",
      "Open an entry to write its article, fill its type's fields, and add the hidden truth players never read.",
      "Add links to other entries: pick the other entry, choose the words, and say whether it is common knowledge, a hidden truth or a false belief.",
      "Link an entry to what the table plays with: the stat block or item it is about, and for a place its battle maps and encounters. Add to a fight puts that exact monster into an encounter.",
      "With an image backend, Paint an entry's picture: the new picture waits for you to keep or turn down, and one that fails says why and can be retried.",
      "Add calendars and the world's history, maps in the Atlas, and the secrets and who keeps them.",
      "Ask the world a question, and read the passages each answer rests on.",
      "Save it back out as a WorldForge file, or share the whole workshop from Share as a bundle.",
    ],
    atTable: "A campaign that brings the world in gets its own copy in its World tab, which only whoever runs the story sees. There, Reveal to the party turns a secret into lore the players read, and an Atlas map reaches the players' Map tab once you show it to the party.",
    tips: [
      "Every entry is the same row the Cast, Region, Factions and Lore tools edit: change it in either place.",
      "Canon says what is settled. The AI DM is told a draft or an alternate telling as unsettled and leaves a retired entry out, and a lore entry that is not canon is kept from what players read until it is.",
      "Players never read a hidden truth. The AI DM is told the hidden truths of people, places and factions, their ties, and the secrets the party has not learned, and never to state them outright.",
      "Calendars date the world's history. A campaign keeps its own clock, and an event here schedules nothing at the table.",
      "Choose What people believe in the web to see the world as the players will hear it.",
      "Without a text model, Outline, Forge, Ask and Draft are not offered, and without an image backend Paint is not; everything else works the same. An admin adds them under Admin > Text model defaults and Admin > Image generation.",
    ],
  },
  {
    id: "storyboard",
    title: "Storyboard",
    purpose: "The plan of the adventure as cards: scenes, fights, places, people and payoffs.",
    steps: [
      "Pick a card kind and give it a title, then Add.",
      "Open a card to write it up and link it to an NPC, a map, a prepared fight or a place from the dropdowns.",
      "Use Leads to on a card to chain it to the cards that follow.",
      "Read What this board is missing and add the cards it suggests.",
      "Check What this becomes: it is what the board turns into when imported into a campaign.",
    ],
    atTable: "A campaign that brings the board in gets its lore, quests, prepared fights, DM notes and story arc. A card that came from a WorldForge file says so, and opening that file again updates the card rather than adding another.",
    tips: [
      "Links are dropdowns over the other tools, so build the NPC or the map first and the card can point at it.",
      "The missing list is counted, never guessed by a model.",
    ],
  },
  {
    id: "party",
    title: "Party",
    purpose: "The stand-in party the prep is measured against, and the pregens that travel with it.",
    steps: [
      "Set the size and level in the bar at the top of the workshop and Save.",
      "Pick a character from your library and Add it, or Build a new one.",
      "Take one off with the cross; it stays in your library.",
    ],
    atTable: "The pregens are sheets ready for anyone who sits down without a character.",
    tips: [
      "A pregen whose level differs from the stand-in party is flagged on its card.",
      "Pregens ride along inside the bundle when you share the workshop.",
    ],
  },
  {
    id: "maps",
    title: "Battle maps",
    purpose: "Rooms to fight in, drawn, rolled or imported, with lights, doors, labels and props.",
    steps: [
      "Open New map, name it, and choose Roll one, Blank rock, Blank ground or Import .dd2vtt.",
      "Tap the map in the drawer to open the editor.",
      "Paint with the brush, line, outline, box and fill tools; undo is there when a stroke goes wrong.",
      "Place lights, doors, labels and props with their tools; a bystander prop offers the cast as a dropdown.",
      "Set the theme, ambient light, tags and notes, and the sound the map makes.",
      "Put it on the table when a campaign is running, or open it as a scene.",
    ],
    atTable: "A fight or a place that uses the map opens on it, with its walls, doors and light, and you can put it on the table yourself whenever a campaign is running.",
    tips: [
      "Nothing here touches a table until you put it there.",
      "A backdrop picture hangs behind the grid, so a hand-drawn map still gets the engine's lighting and doors.",
      "Tags you have used on other maps are offered as a dropdown beside the tag field.",
    ],
  },
  {
    id: "region",
    title: "Region",
    purpose: "The overworld: the land, roads, rivers, borders, labels and the places on it.",
    steps: [
      "Pick a mode (Add pin, Paint terrain, Draw a line, Write a label) and tap the map.",
      "Under Shape the region, describe the land in a sentence to set the dials, or Roll a world.",
      "Add places by name so NPCs, cards and fights can point at them.",
      "Use a picture instead of tiles, read in an Azgaar map, or save the region as a PNG.",
      "Or use a WorldForge Atlas map as the backdrop, from the Atlas, and place its pinned places here; each then moves with its pin.",
    ],
    atTable: "It is the overworld the party travels. Players see a place only once the party has discovered it.",
    tips: [
      "Players see a place only once the party has discovered it.",
      "Regenerate rerolls the terrain; places keep their spots where the new ground allows.",
    ],
  },
  {
    id: "encounters",
    title: "Encounters",
    purpose: "Fights prepared in advance and budgeted against the stand-in party.",
    steps: [
      "Open How hard is this? to weigh a roster before saving it: pick monsters from the search, then Work it out.",
      "Press New encounter. Name it and pick monsters into the roster; edit the counts in the box below.",
      "Choose the map it opens on, then place each creature and the party's entrance on it.",
      "Write the plan: what the fight is worth, and what happens when.",
      "Prepare it. At the table the fight is one press of Deploy.",
    ],
    atTable: "Deploy lays the fight down on its map with its plan. A hand-built monster in its roster is copied into the campaign that brings the fight in.",
    tips: [
      "The difficulty pill is the same maths the engine enforces; every number in the workbench shows its parts.",
      "A monster the world does not know is flagged on the card rather than failing at the table.",
    ],
  },
  {
    id: "cast",
    title: "Cast",
    purpose: "The people of the world, with personalities, goals and relationships.",
    steps: [
      "Press Someone new. Give them a name, a role and an attitude to the party.",
      "Pick where they are found from the places the world has, or type a new one.",
      "Fill in who they are underneath, what they want, and how they feel about the others.",
      "Save them, then add a face: upload one or have one painted.",
    ],
    atTable: "The AI DM plays them by their personality and what they want, and a human DM finds them in the Cast.",
    tips: [
      "Suggest fills a single field from a text model, when the server has one; an admin adds one under Admin > Text model defaults.",
      "Set aside hides someone without deleting them; the cast also fills itself in as the party meets people.",
    ],
  },
  {
    id: "factions",
    title: "Factions",
    purpose: "The powers of the world: what the table knows of them, what they want, and where the party stands with each.",
    steps: [
      "Press Add one and name the faction.",
      "Write what the table knows of them, and what they want, which players never read.",
      "Pick their attitude and power, and add a picture and tags.",
      "Set where the party stands with the pips on its row.",
      "Edit it and open its World entry to write its members, seat and ties in WorldForge.",
    ],
    atTable: "The AI DM is told each faction, the party's standing with it and what it wants, and in a campaign a goal moves on in the background as chapters close.",
    tips: [
      "A faction is the same record as its WorldForge entry: change it in either place.",
      "A world pack's Pull from this workshop takes these factions, with where each is based and who belongs.",
    ],
  },
  {
    id: "bestiary",
    title: "Bestiary",
    purpose: "Your own monsters as full stat blocks the engine can run.",
    steps: [
      "Open Build a monster. Name it and pick a challenge rating, or find a catalogue monster to start from.",
      "Open the block. Set abilities, attacks and traits; Saves from scores fills the saves for you.",
      "Use Build it out of the catalogue to take size, hit points, armour and attacks from an ancestry, class and gear.",
      "Add spells known from the catalogue search, languages from the dropdown, and where it is found.",
      "Save the block. The rating is derived and shows its working.",
      "Give it a World entry from its sheet to tie it to your setting; from that entry, Add to a fight puts it into an encounter.",
    ],
    atTable: "A monster made here answers to its name wherever a fight starts, and its stat block is the one the engine runs.",
    tips: [
      "Monsters belong to your account, so they follow you into every workshop. Prep that uses one carries it: a campaign that brings that prep in gets its own copy in its Bestiary, and the workshop's bundle carries it to other servers.",
      "Put a round of casting into extra damage so the rating counts it.",
    ],
  },
  {
    id: "homebrew",
    title: "Homebrew",
    purpose: "Items, spells, feats, backgrounds, species, classes, subclasses and hazards of your own.",
    steps: [
      "Pick the kind at the top, then press New.",
      "Start from something in the books: search the content pack and copy a row in.",
      "Change what you like. Skills, languages, conditions and damage types are dropdowns you can also type into.",
      "Read the findings under the description; an error blocks saving.",
      "Keep it. The character builder and the engine read it like the books' own; the editor then says where it is offered.",
      "Give an item a World entry from its editor, to tie it to your setting.",
    ],
    atTable: "The character builder, shops and inventories offer it beside the books' own, for your own characters and at every table you run as its owner, DM or assistant DM; the engine reads it the same way. At someone else's table it counts once that table's owner or DM keeps a copy, from a Workshop bundle with your Homebrew in it. Bring in prep does not copy Homebrew: it is yours already.",
    tips: [
      "An item a World entry links to is copied into a campaign that brings that world in, and the workshop's bundle can carry your whole shelf or only what the workshop uses.",
      "A class of your own is a class to every engine: the builder offers it under From Homebrew, and its subclasses are made under it here.",
      "A subclass is offered under its class from the level that class picks a subclass (level 3 for a fighter), and at that level-up.",
      "Rename freely: the characters, entries and tables that use the old name follow the new one.",
      "A spell's damage, save and damage type are read out of its description, the way the SRD's are.",
      "Everything is checked against the ruleset as you type.",
    ],
  },
  {
    id: "lore",
    title: "Lore",
    purpose: "The world bible: places, factions, history and secrets the narrator knows, and the handouts the players read.",
    steps: [
      "Press New entry. Pick a category and a title.",
      "Write the entry in Markdown. Link another entry from the dropdown; the link lands at the cursor.",
      "Choose whether the table reads it or only you do.",
      "Attach a picture to make it a handout, add tags, and Add.",
      "Pin the entries the narrator should see every turn.",
    ],
    atTable: "Pinned entries reach the narrator every turn and the rest are found when relevant. Players read the entries that are theirs in the Story tab; one kept for the DM, or not canon yet in WorldForge, they do not.",
    tips: [
      "Unpinned entries are retrieved by relevance, so a long bible costs nothing until it is needed.",
      "Tags already in use are offered beside the tag field.",
    ],
  },
  {
    id: "tables",
    title: "Tables",
    purpose: "Random tables: rumours, treasure, weather, encounters, anything rolled.",
    steps: [
      "Press New table and name it.",
      "Write one row per line, with a range (1-3) or a weight (x3), or paste a table from a book.",
      "Use the picker under the box to add a row that is a thing: another table, a monster, an item, a person or a lore entry.",
      "Watch the coverage line for gaps and overlaps.",
      "Save table. Roll from the card; Draw without replacement makes it a deck.",
    ],
    atTable: "Roll it from the card during play: everyone sees the roll, and what the row says comes back to you alone.",
    tips: [
      "Rolling writes an ordinary roll everyone can see, but what the row says comes back to you alone.",
      "Look up a monster beside the tables is a catalogue stat block for reference.",
    ],
  },
  {
    id: "rules",
    title: "Rules",
    purpose: "Variant rules the engine honours and house rules the narrator retrieves.",
    steps: [
      "Toggle the variant rules and set the rest length.",
      "Write house rules grouped by heading, and Save rules.",
      "Switch a section off to silence it, or pin it to include it every turn.",
      "Save these rules as a ruleset to reuse in other campaigns and workshops.",
      "Apply a saved ruleset here; the preview says what changes first.",
    ],
    atTable: "A campaign that brings the rules in plays by them: the engine honours the variants, and the narrator reads the house rules that apply.",
    tips: [
      "Applying a ruleset copies it; editing it later never reaches back.",
      "A ruleset carries rules, not Homebrew: your Homebrew already counts at every table you run.",
    ],
  },
  {
    id: "plugin",
    title: "Plugin",
    purpose: "A world pack of your own: the setting's names over the rules, its lore, and its pictures, as one file any server can install.",
    steps: [
      "Run Guided setup: name the world, say what it is inspired by and who owns that, pick the base genre, and write the narrator's brief.",
      "Pull from this workshop to bring in the lore, places, hook cards and cast you already built.",
      "In People, Magic and gear, and Bestiary, pick the thing from the catalog and give it the world's name for it.",
      "In Pictures, upload a cover and a picture for any race, class, monster, place or faction; they are resized to fit on the way in.",
      "Open Publish. Fix what it lists, then Download the pack, or Install it here if you run this server.",
    ],
    atTable: "A server that installs the pack offers it as a world when a campaign is created.",
    tips: [
      "Publish lists what a pack leaves out, kind by kind: secrets and hidden truths, entries kept back, hand-built monsters, homebrew, encounters, battle maps and more. The workshop bundle carries all of it.",
      "A pack renames; it never changes a rule. Anything mechanical is a homebrew entry, not a pack.",
      "Fill in the rights holder for anything built on somebody else's setting; it turns the notice into a proper disclaimer.",
      "The draft travels inside the workshop bundle, so sharing the workshop shares the half-built pack too.",
    ],
  },
  {
    id: "share",
    title: "Share",
    purpose: "The whole workshop as one file, or compiled into a draft world pack.",
    steps: [
      "Name the bundle and say what it is in a line.",
      "Fill in the author and version; add the rights holder if it is built on somebody else's setting.",
      "Choose whether the bundle carries all of your homebrew shelf or only what this workshop uses.",
      "Download bundle, or Compile a world pack.",
    ],
    atTable: "Another server imports the bundle as a workshop of its own, which its campaigns then bring in.",
    tips: [
      "Pictures travel with the bundle within the size caps; nothing from any campaign does.",
      "Hand-built monsters and homebrew travel in the bundle. Whoever imports it keeps their own entry of the same name, and a different one arrives beside theirs under the bundle's name, with the bundle's pregens, tables and shelves pointed at it.",
      "Only what this workshop uses follows everything it names: its tables, shelves and pregens, a subclass's later spells, a class's subclasses, an item's spells.",
      "Compile a world pack lists what a pack leaves out that the bundle carries.",
    ],
  },
];

export function guideFor(id: string): ToolGuide | undefined {
  return WORKSHOP_GUIDES.find((guide) => guide.id === id);
}
