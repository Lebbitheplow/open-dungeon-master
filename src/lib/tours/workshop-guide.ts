// The written guide to each workshop tool: what it is for, how a first
// session goes, and the things people miss. WorkshopHelpDialog renders it;
// the tour of each tool covers the same ground with a spotlight. Kept as
// data so the test can check every tool has a guide, and so the copy sits
// beside the tours it matches.

export interface ToolGuide {
  id: string;
  title: string;
  // One line: what the tool is for.
  purpose: string;
  // A first session, in order.
  steps: string[];
  // The things people miss.
  tips: string[];
}

export const WORKSHOP_GUIDES: ToolGuide[] = [
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
    ],
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
    tips: [
      "Suggest fills a single field from a text model, when the server has one.",
      "Set aside hides someone without deleting them; the cast also fills itself in as the party meets people.",
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
    ],
    tips: [
      "Monsters belong to your account, not the workshop, so they follow you everywhere but do not travel in bundles sent to others.",
      "Put a round of casting into extra damage so the rating counts it.",
    ],
  },
  {
    id: "homebrew",
    title: "Homebrew",
    purpose: "Items, spells, feats, backgrounds, species and subclasses of your own.",
    steps: [
      "Pick the kind at the top, then press New.",
      "Start from something in the books: search the content pack and copy a row in.",
      "Change what you like. Skills, languages, conditions and damage types are dropdowns you can also type into.",
      "Read the findings under the description; an error blocks saving.",
      "Keep it. The character builder and the engine read it like the books' own.",
    ],
    tips: [
      "A spell's damage, save and damage type are read out of its description, the way the SRD's are.",
      "Everything is checked against the ruleset as you type.",
    ],
  },
  {
    id: "lore",
    title: "Lore",
    purpose: "The world bible: places, factions, history and secrets the narrator treats as canon.",
    steps: [
      "Press New entry. Pick a category and a title.",
      "Write the entry in Markdown. Link another entry from the dropdown; the link lands at the cursor.",
      "Choose whether the table reads it or only you do.",
      "Attach a picture to make it a handout, add tags, and Add.",
      "Pin the entries the narrator should see every turn.",
    ],
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
    tips: [
      "Applying a ruleset copies it; editing it later never reaches back.",
    ],
  },
  {
    id: "share",
    title: "Share",
    purpose: "The whole workshop as one file, or compiled into a draft world pack.",
    steps: [
      "Name the bundle and say what it is in a line.",
      "Fill in the author and version; add the rights holder if it is built on somebody else's setting.",
      "Download bundle, or Compile a world pack.",
    ],
    tips: [
      "Pictures travel with the bundle within the size caps; nothing from any campaign does.",
      "Hand-built monsters are yours, not the workshop's, so they are not in a bundle sent to other people.",
    ],
  },
];

export function guideFor(id: string): ToolGuide | undefined {
  return WORKSHOP_GUIDES.find((guide) => guide.id === id);
}
