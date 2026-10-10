// The world, the people in it, and the story: what a DM does outside a
// fight and outside the party's own sheets. Names match the tool names the
// AI DM is offered exactly.
import type { CatalogEntry } from "@/lib/dm/catalog-types";
import { cueOptions, sceneOptions } from "@/lib/ambience/catalog";
import { RELATIONSHIP_BEAT_NAMES } from "@/lib/dm/relationship-logic";
import { TOLD_GENDERS } from "@/lib/gender";
import {
  ABILITY_OPTIONS as ABILITIES,
  DIFFICULTY_OPTIONS as DIFFICULTIES,
  OBJECT_MATERIAL_OPTIONS,
  OBJECT_SIZE_OPTIONS,
  SKILL_OPTIONS,
  damageTypeField,
} from "@/lib/dm/catalog-vocab";
import { REQUEST_ROLL_ADJUDICATION } from "@/lib/dm/catalog-roll";

const REASON = {
  name: "reason",
  label: "Reason",
  kind: "text" as const,
  placeholder: "Short in-fiction cause",
};

// One line for a relationship's memory, which those handlers call `note`.
const NOTE = {
  name: "note",
  label: "What happened",
  kind: "text" as const,
  placeholder: "One short line for the record",
};

// The kind of place, from the ambience beds: its sound, battle map and
// stand-in picture follow it.
const SCENE_FIELD = {
  name: "scene",
  label: "Kind of place",
  kind: "select",
  options: sceneOptions(),
  help: "Sets the place's sound, battle map and picture. Blank keeps what it was.",
} as const;

export const GENDER_FIELD = {
  name: "gender",
  label: "Gender",
  kind: "select",
  options: TOLD_GENDERS.map((gender) => ({ value: gender, label: gender })),
} as const;

export const WORLD_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "move_party",
    label: "Move the party",
    category: "world",
    summary: "Takes the party somewhere, making the place if it is new and mapping it if they can see.",
    fields: [
      { name: "name", label: "Place", kind: "text", required: true },
      { name: "layoutDescription", label: "Layout", kind: "longtext", help: "Rooms, exits, landmarks. This is what the map is drawn from." },
      { name: "connections", label: "Leads to", kind: "text", help: "Other place names, comma separated." },
      { name: "visionClear", label: "They can see it", kind: "boolean", default: true, help: "Off in darkness or fog: no map is drawn." },
      SCENE_FIELD,
    ],
  },
  {
    name: "update_location",
    label: "Change the place",
    category: "world",
    summary: "Rewrites where the party already is and redraws the map when the layout moved.",
    fields: [
      { name: "layoutDescription", label: "Layout", kind: "longtext", required: true },
      { name: "connections", label: "Leads to", kind: "text" },
      { name: "visionClear", label: "They can see it", kind: "boolean", default: true, help: "Off in darkness or fog: the map is not redrawn." },
      SCENE_FIELD,
    ],
  },
  {
    name: "travel",
    label: "Travel",
    category: "world",
    summary: "Hours (or miles) on the road at a pace, with the distance covered and the forced-march saves that come with it.",
    fields: [
      { name: "hours", label: "Hours", kind: "number", min: 1, max: 48, help: "Give hours or miles." },
      { name: "miles", label: "Or miles", kind: "number", min: 1, max: 200, help: "The server works out the hours the pace and the ground need." },
      { name: "terrain", label: "Ground", kind: "select", options: [{ value: "normal", label: "Normal" }, { value: "difficult", label: "Difficult (half the distance)" }] },
      {
        name: "pace",
        label: "Pace",
        kind: "select",
        options: [
          { value: "slow", label: "Slow" },
          { value: "normal", label: "Normal" },
          { value: "fast", label: "Fast" },
        ],
      },
      { name: "characterIds", label: "Who travels", kind: "characters", help: "Leave empty for the whole party." },
      { name: "water", label: "Water to be found", kind: "select", options: [{ value: "plenty", label: "Plenty" }, { value: "half", label: "Half (DC 15 CON a day)" }, { value: "none", label: "None" }], help: "Supplies variant only; holds until set to plenty." },
      { name: "reason", label: "The journey", kind: "text", placeholder: "Toward the pass, by the old road" },
    ],
  },
  {
    name: "start_scene",
    label: "Start a structured scene",
    category: "world",
    summary: "A clock for a chase, a negotiation or a crossing: N successes before M failures.",
    fields: [
      {
        name: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        options: [
          { value: "exploration", label: "Exploration" },
          { value: "social", label: "Negotiation" },
          { value: "chase", label: "Chase" },
          { value: "ritual", label: "Ritual or task" },
        ],
      },
      { name: "title", label: "Called", kind: "text", required: true },
      { name: "successesNeeded", label: "Successes needed", kind: "number", min: 1, max: 12 },
      { name: "failuresAllowed", label: "Failures allowed", kind: "number", min: 1, max: 12 },
      { name: "onSuccess", label: "If they win it", kind: "longtext" },
      { name: "onFailure", label: "If they lose it", kind: "longtext" },
      { name: "characterIds", label: "Who is in it", kind: "characters" },
    ],
  },
  {
    name: "scene_check",
    label: "One attempt in the scene",
    category: "world",
    summary: "Rolls a character's check and moves the scene's clock.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "approach", label: "What they tried", kind: "text" },
      { name: "skill", label: "Skill", kind: "text", placeholder: "persuasion" },
      { name: "ability", label: "Or ability", kind: "select", options: ABILITIES },
      { name: "difficulty", label: "Difficulty", kind: "select", options: DIFFICULTIES },
      { name: "dc", label: "Or an exact DC", kind: "number", min: 1, max: 30 },
      { name: "endRound", label: "That was the last of them", kind: "boolean" },
    ],
  },
  {
    name: "end_scene",
    label: "Call off the scene",
    category: "world",
    summary: "Ends a structured scene that stopped mattering. One that resolves ends itself.",
    fields: [REASON],
  },
  {
    name: "mount_up",
    label: "Get on a mount",
    category: "world",
    summary: "Puts a character on a mount, at the mount's speed and half their movement.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "mount", label: "Mount", kind: "text", placeholder: "warhorse" },
      { name: "customName", label: "Or write one", kind: "text" },
      { name: "speed", label: "Its speed", kind: "number", min: 0, max: 200 },
      {
        name: "size",
        label: "Its size",
        kind: "select",
        options: [
          { value: "small", label: "Small" },
          { value: "medium", label: "Medium" },
          { value: "large", label: "Large" },
          { value: "huge", label: "Huge" },
        ],
      },
      { name: "controlled", label: "Trained to be ridden", kind: "boolean", default: true },
    ],
  },
  {
    name: "dismount",
    label: "Get off a mount",
    category: "world",
    summary: "Deliberately, or thrown: then it calls for the DC 10 Dexterity save.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      {
        name: "cause",
        label: "How",
        kind: "select",
        options: [
          { value: "voluntary", label: "They chose to" },
          { value: "forced-move", label: "The mount was moved" },
          { value: "mount-prone", label: "The mount went down" },
          { value: "rider-prone", label: "They were knocked prone" },
        ],
      },
    ],
  },
  {
    name: "set_weather",
    label: "Set the weather",
    category: "world",
    summary: "Overrules the sky the server rolled; light, Perception, ranged attacks and travel follow it.",
    fields: [
      {
        name: "sky",
        label: "Sky",
        kind: "select",
        required: true,
        options: [
          { value: "clear", label: "Clear" },
          { value: "overcast", label: "Overcast" },
          { value: "rain", label: "Rain" },
          { value: "storm", label: "Storm" },
          { value: "snow", label: "Snow" },
          { value: "fog", label: "Fog" },
          { value: "wind", label: "Wind" },
        ],
      },
      {
        name: "temperature",
        label: "Air",
        kind: "select",
        options: [
          { value: "frigid", label: "Frigid (a hazard on a long march)" },
          { value: "cold", label: "Cold" },
          { value: "mild", label: "Mild" },
          { value: "warm", label: "Warm" },
          { value: "hot", label: "Hot (a hazard on a long march)" },
        ],
      },
      {
        name: "wind",
        label: "Wind",
        kind: "select",
        options: [
          { value: "calm", label: "Calm" },
          { value: "breeze", label: "Breeze" },
          { value: "gale", label: "Gale (ranged attacks past 30 ft at disadvantage)" },
        ],
      },
      {
        name: "precipitation",
        label: "How heavy",
        kind: "number",
        min: 0,
        max: 3,
        help: "0 none to 3 heavy. Two or more cuts visibility to 60 ft in rain or snow.",
      },
      { name: "reason", label: "Reason", kind: "text", placeholder: "The storm the fisherfolk warned of" },
    ],
  },
  {
    name: "pass_time",
    label: "Time passes",
    category: "world",
    summary: "Moves the in-world clock forward. Travel and rests move it themselves.",
    fields: [
      { name: "amount", label: "How much", kind: "number", required: true, min: 1, max: 10000 },
      {
        name: "unit",
        label: "Of",
        kind: "select",
        options: [
          { value: "minutes", label: "minutes" },
          { value: "hours", label: "hours" },
          { value: "days", label: "days" },
          { value: "weeks", label: "weeks" },
        ],
      },
      { name: "water", label: "Water to be found", kind: "select", options: [{ value: "plenty", label: "Plenty" }, { value: "half", label: "Half (DC 15 CON a day)" }, { value: "none", label: "None" }], help: "Supplies variant only; holds until set to plenty." },
      REASON,
    ],
  },
  {
    name: "roll_treasure",
    label: "Roll treasure",
    category: "world",
    summary: "Rolls a hoard on the DMG tables for a challenge rating and hands it out.",
    fields: [
      { name: "cr", label: "Challenge rating", kind: "number", required: true, min: 0, max: 30 },
      { name: "characterIds", label: "Split between", kind: "characters" },
      { name: "individual", label: "Individual treasure", kind: "boolean", help: "Off rolls a hoard." },
      REASON,
    ],
  },
  {
    name: "damage_object",
    label: "Break something",
    category: "world",
    summary: "Doors, chests and chains with real AC and hit points for their material.",
    fields: [
      { name: "name", label: "The object", kind: "text", placeholder: "the oak door", help: "Named, it keeps its damage between blows. A Wall of Ice is struck a section at a time: \"Wall of Ice section 2\", the numbers on the board." },
      { name: "material", label: "Material", kind: "select", options: OBJECT_MATERIAL_OPTIONS },
      { name: "size", label: "Size", kind: "select", options: OBJECT_SIZE_OPTIONS },
      { name: "characterId", label: "Struck by", kind: "character", help: "The server rolls their weapon attack against its AC and their damage." },
      { name: "weapon", label: "With", kind: "text", placeholder: "warhammer", help: "From their equipment." },
      { name: "damage", label: "Or damage", kind: "dice", help: "Something other than a character's weapon." },
      damageTypeField("damageType", "Damage type", "Objects shrug off poison and psychic."),
      { name: "fragile", label: "Fragile", kind: "boolean" },
      { name: "ac", label: "Its armor class", kind: "number", min: 1, max: 30, help: "Overrides the material's." },
      { name: "hp", label: "Its hit points", kind: "number", min: 1, max: 1000, help: "Overrides the size's." },
      { name: "threshold", label: "Damage threshold", kind: "number", min: 1, max: 100, help: "A castle wall's or a ship's: a blow below it does nothing." },
      REASON,
    ],
  },
  {
    name: "group_check",
    label: "Group check",
    category: "world",
    summary: "Everyone rolls the same check at once and the server totals who made it.",
    fields: [
      { name: "skill", label: "Skill", kind: "select", options: SKILL_OPTIONS },
      { name: "ability", label: "Or ability", kind: "select", options: ABILITIES },
      { name: "difficulty", label: "Difficulty", kind: "select", options: DIFFICULTIES },
      { name: "dc", label: "Or an exact DC", kind: "number", min: 1, max: 30 },
      { name: "characterIds", label: "Who rolls", kind: "characters" },
      REASON,
    ],
  },
  {
    name: "check_notice",
    label: "Passive notice",
    category: "world",
    summary: "Compares passive Perception, Insight or Investigation against a DC without anyone rolling.",
    fields: [
      { name: "difficulty", label: "Difficulty", kind: "select", options: DIFFICULTIES },
      { name: "dc", label: "Or an exact DC", kind: "number", min: 1, max: 30 },
      {
        name: "sense",
        label: "Sense",
        kind: "select",
        options: [
          { value: "perception", label: "Perception" },
          { value: "insight", label: "Insight" },
          { value: "investigation", label: "Investigation" },
        ],
      },
      {
        name: "by",
        label: "Noticed by",
        kind: "select",
        options: [
          { value: "sight", label: "Sight (the light counts)" },
          { value: "hearing", label: "Hearing (the light does not)" },
        ],
        help: "Perception only.",
      },
      {
        name: "light",
        label: "Light there",
        kind: "select",
        options: [
          { value: "bright", label: "Bright" },
          { value: "dim", label: "Dim (-5)" },
          { value: "dark", label: "Dark" },
        ],
        help: "Off the board; left empty, the current location and the hour decide.",
      },
      { name: "againstEnemyId", label: "Hiding (enemy)", kind: "enemy", help: "The server rolls its Stealth (or Deception for Insight) as the DC." },
      { name: "againstMonster", label: "Hiding (stat block)", kind: "text", placeholder: "goblin", help: "Out of a fight: the creature's stat block by name." },
      { name: "characterIds", label: "Who might notice", kind: "characters" },
      REASON,
    ],
  },
];

export const SOCIAL_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "set_npc",
    label: "Write an NPC",
    category: "social",
    summary: "Creates or updates a person the party can deal with, and how they feel about them.",
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      {
        name: "attitude",
        label: "Attitude",
        kind: "select",
        options: [
          { value: "hostile", label: "Hostile" },
          { value: "indifferent", label: "Indifferent" },
          { value: "friendly", label: "Friendly" },
        ],
      },
      { name: "trait", label: "Trait", kind: "text" },
      { name: "location", label: "Found at", kind: "text" },
      GENDER_FIELD,
      { name: "goal", label: "Wants", kind: "text" },
      { name: "ambition", label: "Long game", kind: "text" },
    ],
  },
  {
    name: "npc_reaction",
    label: "Reaction roll",
    category: "social",
    summary: "Rolls how an NPC takes the party on the DMG reaction table.",
    fields: [
      { name: "name", label: "NPC", kind: "text", required: true },
      { name: "modifier", label: "Modifier", kind: "number", min: -10, max: 10 },
      { name: "trait", label: "Trait", kind: "text" },
      { name: "location", label: "Found at", kind: "text" },
      { ...GENDER_FIELD, required: true },
    ],
  },
  {
    name: "social_check",
    label: "Social check",
    category: "social",
    summary: "Persuade, deceive or intimidate, against a DC set by how the NPC already feels.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "npc", label: "NPC", kind: "text", required: true },
      {
        name: "approach",
        label: "Approach",
        kind: "select",
        required: true,
        options: [
          { value: "persuade", label: "Persuade" },
          { value: "deceive", label: "Deceive" },
          { value: "intimidate", label: "Intimidate" },
        ],
      },
      REASON,
    ],
  },
  {
    name: "relationship_beat",
    label: "Relationship beat",
    category: "social",
    summary: "Moves a bond between a character and an NPC forward or back.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "subject", label: "NPC or companion", kind: "text", required: true, help: "Their name as the table tracks it." },
      {
        name: "beat",
        label: "What happened",
        kind: "select",
        required: true,
        options: RELATIONSHIP_BEAT_NAMES.map((beat) => ({ value: beat, label: beat.replace(/_/g, " ") })),
      },
      NOTE,
    ],
  },
  {
    name: "romance_advance",
    label: "Romance",
    category: "social",
    summary: "Advances a romance a stage, within the table's own limits.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "subject", label: "NPC or companion", kind: "text", required: true },
      {
        name: "to",
        label: "Becomes",
        kind: "select",
        required: true,
        options: [
          { value: "interested", label: "Interested" },
          { value: "courting", label: "Courting" },
          { value: "together", label: "Together" },
          { value: "betrothed", label: "Betrothed" },
          { value: "married", label: "Married" },
        ],
        help: "The next step only; the server refuses a skipped one.",
      },
      NOTE,
    ],
  },
  {
    name: "relationship_end",
    label: "End a relationship",
    category: "social",
    summary: "A falling out, a parting, a betrayal or a death.",
    confirm: { message: "Record this death? The relationship closes for good.", when: { field: "reason", equals: "death" } },
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "subject", label: "NPC or companion", kind: "text", required: true },
      {
        name: "reason",
        label: "How it ends",
        kind: "select",
        required: true,
        options: [
          { value: "falling_out", label: "Falling out" },
          { value: "parting", label: "Parting" },
          { value: "breakup", label: "Breakup" },
          { value: "betrayal", label: "Betrayal" },
          { value: "death", label: "Death" },
        ],
      },
      NOTE,
    ],
  },
];

export const STORY_ADJUDICATIONS: CatalogEntry[] = [
  REQUEST_ROLL_ADJUDICATION,
  {
    name: "request_player_input",
    label: "Give the floor",
    category: "story",
    summary: "Hands the moment to named players and waits for them.",
    fields: [
      { name: "characterIds", label: "Characters", kind: "characters", required: true },
      { name: "prompt", label: "What you need", kind: "text" },
    ],
  },
  {
    name: "send_whisper",
    label: "Whisper",
    category: "story",
    summary: "A private line to one player or several; nobody else sees it.",
    fields: [
      { name: "characterIds", label: "To", kind: "characters", required: true },
      { name: "message", label: "Message", kind: "longtext", required: true },
    ],
  },
  {
    name: "record_event",
    label: "Record a milestone",
    category: "story",
    summary: "Something worth remembering months later; it survives every compaction.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      {
        name: "kind",
        label: "Kind",
        kind: "select",
        required: true,
        options: [
          { value: "achievement", label: "Achievement" },
          { value: "item", label: "Treasure" },
          { value: "relationship", label: "Bond" },
          { value: "death", label: "Death" },
          { value: "level_up", label: "Level up" },
          { value: "story", label: "Story beat" },
        ],
      },
      { name: "summary", label: "One sentence", kind: "text", required: true, dictate: true },
    ],
  },
  {
    name: "complete_beat",
    label: "Beat achieved",
    category: "story",
    summary: "Marks the arc's current beat done, which is what closes a chapter.",
    fields: [{ name: "beat", label: "Beat number", kind: "number", min: 1, max: 99 }],
  },
  {
    name: "write_campaign_note",
    label: "Campaign note",
    category: "story",
    summary: "Proposes a note for the table; the lead approves it.",
    fields: [
      { name: "title", label: "Title", kind: "text", help: "Optional; the note stands on its body." },
      { name: "body", label: "Note", kind: "longtext", required: true },
    ],
  },
  {
    name: "recall_story",
    label: "Recall a chapter",
    category: "story",
    summary: "Pulls a sealed chapter back up, by number or by what you remember of it.",
    fields: [
      {
        name: "chapter",
        label: "Chapter number",
        kind: "number",
        help: "Leave blank to search by what you remember instead.",
      },
      { name: "query", label: "What you remember", kind: "text", placeholder: "the burned mill" },
    ],
  },
  {
    name: "search_lore",
    label: "Search lore",
    category: "story",
    summary: "Searches the campaign's own lore entries.",
    fields: [
      { name: "query", label: "Query", kind: "text", required: true },
      {
        name: "category",
        label: "Category",
        kind: "text",
        placeholder: "any",
        help: "Blank searches every category.",
      },
    ],
  },
  {
    name: "generate_image",
    label: "Illustrate",
    category: "story",
    summary: "Draws the scene, and hangs it under your latest passage.",
    fields: [
      {
        name: "prompt",
        label: "What to draw",
        kind: "longtext",
        required: true,
        placeholder: "a flooded stone stair descending into black water, lit by one lantern",
      },
      { name: "reason", label: "Why", kind: "text" },
      {
        name: "characterIds",
        label: "Who is in it",
        kind: "characters",
        help: "Two at most: their portraits are passed as references.",
      },
    ],
  },
];

// The table itself: what the room is hearing. Not the world, because the
// party cannot act on it, and not the story, because it says nothing about
// what happened; it is the DM reaching for the volume knob.
export const TABLE_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "set_ambience",
    label: "Set the sound",
    category: "table",
    summary: "Changes the ambience bed, the music, or both. Leave a layer blank to keep it.",
    fields: [
      {
        name: "bed",
        label: "Where they are",
        kind: "select",
        options: [{ value: "none", label: "Silence" }, ...cueOptions("bed")],
        help: "Blank keeps whatever is already playing.",
      },
      {
        name: "music",
        label: "Mood",
        kind: "select",
        options: [{ value: "none", label: "Silence" }, ...cueOptions("music")],
        help: "Blank keeps whatever is already playing.",
      },
      {
        name: "hold",
        label: "Hold it here",
        kind: "boolean",
        help: "Stops the engine changing this on its own when the party moves.",
      },
    ],
  },
  {
    name: "show_title",
    label: "Show a title card",
    category: "table",
    summary: "A few words on every screen for a moment: a chapter, a place, a reveal.",
    fields: [
      { name: "title", label: "Title", kind: "text", required: true, placeholder: "The Sunken Chapel" },
      { name: "subtitle", label: "Under it", kind: "text", placeholder: "Where the bells still ring" },
      {
        name: "tone",
        label: "Tone",
        kind: "select",
        options: [
          { value: "gold", label: "Gold (wonder, a chapter)" },
          { value: "ember", label: "Ember (danger)" },
          { value: "dawn", label: "Dawn (relief)" },
          { value: "plain", label: "Plain" },
        ],
      },
    ],
  },
  {
    name: "play_sting",
    label: "Play a sound",
    category: "table",
    summary: "One sound, once, over whatever is playing. Changes nothing else.",
    fields: [
      {
        name: "cue",
        label: "Sound",
        kind: "select",
        required: true,
        options: cueOptions("sting"),
      },
    ],
  },
];
