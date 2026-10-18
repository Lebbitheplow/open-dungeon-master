import type { SystemId } from "@/app/workshop/[workshopId]/systems";

// What the workshop's Create chooser offers (audit finding WF-08). WorldForge
// pulls entries out of notes; it does not make playable things, and a World
// type called Monster or Item adds no stat block. So Create starts from what
// the author wants to end up with, says where it will live, and sends them
// to the tool that already makes it: its own editor, validation and store.
// It is a router, not another editor. Pure: the chooser
// (src/app/workshop/[workshopId]/CreateChooser.tsx) draws it, and
// scripts/test-create-chooser.mjs checks that every way in is answered.

// How a thing gets made. "extract" is WorldForge's Forge, which keeps only
// what the notes say; "draft" asks a model to write from a line.
export type CreateWay = "blank" | "copy" | "upload" | "draft" | "extract";

export const WAY_LABELS: Record<CreateWay, string> = {
  blank: "Start blank",
  copy: "Copy one that exists",
  upload: "Bring in a picture",
  draft: "Draft with AI",
  extract: "Extract from notes",
};

export type CreateStep = {
  // The button, and what happens after it.
  label: string;
  detail: string;
  ways: CreateWay[];
  // A workshop tool (and WorldForge's view), asked to open its own editor
  // by the name its panel answers (src/lib/tours/prepare.ts); or a page
  // outside the workshop.
  system?: SystemId;
  view?: string;
  prepare?: string;
  href?: string;
  // The model the step cannot work without: off when the server has none.
  needs?: "story";
  // The model its "draft" way uses; the way is not offered without it.
  drafts?: "story" | "images";
};

export type CreateGroup = "world" | "playable" | "picture";

export const GROUP_LABELS: Record<CreateGroup, string> = {
  world: "For the world",
  playable: "For the table",
  picture: "Pictures",
};

export type CreateChoice = {
  id: string;
  label: string;
  blurb: string;
  // Where the result lives, in the words the hub uses.
  lands: string;
  group: CreateGroup;
  steps: CreateStep[];
};

export const CREATE_CHOICES: CreateChoice[] = [
  {
    id: "outline",
    label: "World outline",
    blurb: "People, places, factions and lore as linked World entries.",
    lands: "WorldForge",
    group: "world",
    steps: [
      {
        label: "Extract from your notes",
        detail: "Paste notes and WorldForge lists who and what they name. You keep the ones you want; it does not invent what the notes leave out.",
        ways: ["extract"],
        system: "world",
        view: "forge",
        needs: "story",
      },
      {
        label: "Start with one entry",
        detail: "A new World entry of any type, in the wiki.",
        ways: ["blank"],
        system: "world",
        view: "wiki",
        prepare: "open-world-entry",
      },
    ],
  },
  {
    id: "npc",
    label: "NPC",
    blurb: "Someone the party can meet, with a voice, wants and secrets.",
    lands: "Cast, with a World entry of their own",
    group: "world",
    steps: [
      {
        label: "Open the NPC editor",
        detail: "A new person in the Cast. Generate in the editor drafts one from a line.",
        ways: ["blank", "draft"],
        system: "cast",
        prepare: "open-npc-editor",
        drafts: "story",
      },
    ],
  },
  {
    id: "place",
    label: "Place",
    blurb: "A town, a ruin or a room the party can go to.",
    lands: "Region's places, with a World entry",
    group: "world",
    steps: [
      {
        label: "Name a new place",
        detail: "A place in the wiki, which the Region map can then pin.",
        ways: ["blank"],
        system: "world",
        view: "wiki",
        prepare: "open-world-entry:location",
      },
    ],
  },
  {
    id: "pc",
    label: "Player character",
    blurb: "A hero for a player, built under the class and level rules.",
    lands: "Your character library, or this party as a pregen",
    group: "playable",
    steps: [
      {
        label: "Build a character",
        detail: "The character builder. It saves to your library.",
        ways: ["blank"],
        // A player character, so the builder does not ask (door.ts).
        href: "/characters/new?as=pc",
      },
      {
        label: "A pregen for this party",
        detail: "The Party tool: put one of your library's characters on this workshop's roster, or build a new one for it.",
        ways: ["copy", "blank"],
        system: "party",
      },
    ],
  },
  {
    id: "creature",
    label: "Creature",
    blurb: "A monster with a stat block the table can fight.",
    lands: "Bestiary",
    group: "playable",
    steps: [
      {
        label: "Build a monster",
        detail: "Name it and pick a starting CR, or start from a rulebook monster. From its stat block, give it a World entry; from that entry, add it to a fight.",
        ways: ["blank", "copy"],
        system: "bestiary",
        prepare: "open-monster-build",
      },
    ],
  },
  {
    id: "item",
    label: "Item",
    blurb: "Something to carry, wield or sell, with real mechanics.",
    lands: "Homebrew",
    group: "playable",
    steps: [
      {
        label: "Open the item editor",
        detail: "A new item on your Homebrew shelf, or a copy of a rulebook one. Shops and inventories can offer it.",
        ways: ["blank", "copy"],
        system: "homebrew",
        prepare: "open-homebrew-editor:item",
      },
    ],
  },
  {
    id: "spell",
    label: "Spell",
    blurb: "A spell with its level, school, range and effect.",
    lands: "Homebrew",
    group: "playable",
    steps: [
      {
        label: "Open the spell editor",
        detail: "A new spell on your Homebrew shelf, or a copy of a rulebook one.",
        ways: ["blank", "copy"],
        system: "homebrew",
        prepare: "open-homebrew-editor:spell",
      },
    ],
  },
  {
    id: "option",
    label: "Character option",
    blurb: "A feat, background, species or subclass the builder can offer.",
    lands: "Homebrew",
    group: "playable",
    steps: [
      {
        label: "Open the option editor",
        detail: "Starts on feats; the editor's kind picker has backgrounds, species and subclasses.",
        ways: ["blank", "copy"],
        system: "homebrew",
        prepare: "open-homebrew-editor:feat",
      },
    ],
  },
  {
    id: "region",
    label: "Region",
    blurb: "The overworld map the party travels, with its places.",
    lands: "Region",
    group: "playable",
    steps: [
      {
        label: "Open the Region",
        detail: "Roll the terrain, place locations, and lay art behind it.",
        ways: ["blank"],
        system: "region",
      },
    ],
  },
  {
    id: "map",
    label: "Battle map",
    blurb: "A room to fight in, with its grid, walls and light.",
    lands: "Battle maps",
    group: "playable",
    steps: [
      {
        label: "Make a battle map",
        detail: "Roll one, start blank, or bring in a drawing.",
        ways: ["blank", "upload"],
        system: "maps",
        prepare: "open-map-create",
      },
    ],
  },
  {
    id: "encounter",
    label: "Encounter",
    blurb: "A fight of real monsters, budgeted against the party.",
    lands: "Encounters",
    group: "playable",
    steps: [
      {
        label: "Open the encounter editor",
        detail: "Pick monsters from your Bestiary or the rulebook, and a map to fight on.",
        ways: ["blank"],
        system: "encounters",
        prepare: "open-encounter-editor",
      },
    ],
  },
  {
    id: "table",
    label: "Roll table",
    blurb: "Rumours, loot or wandering monsters to roll on.",
    lands: "Tables",
    group: "playable",
    steps: [
      {
        label: "Open the table editor",
        detail: "Write the rows, or have them drafted from a line.",
        ways: ["blank", "draft"],
        system: "tables",
        prepare: "open-table-editor",
        drafts: "story",
      },
    ],
  },
  {
    id: "illustration",
    label: "Illustration",
    blurb: "A picture belongs to what it shows: there is no shelf of loose pictures.",
    lands: "On the record it shows",
    group: "picture",
    steps: [
      {
        label: "An NPC's portrait",
        detail: "Open the person in the Cast, then Add a face.",
        ways: ["upload", "draft"],
        system: "cast",
        drafts: "images",
      },
      {
        label: "A map of the world",
        detail: "An Atlas map in WorldForge: a picture with places pinned on it.",
        ways: ["upload"],
        system: "world",
        view: "atlas",
      },
      {
        label: "The Region's backdrop",
        detail: "The art laid behind the Region map.",
        ways: ["upload"],
        system: "region",
      },
    ],
  },
];

// The ways a step offers on this server: drafting only where its model is.
export function offeredWays(step: CreateStep, models: { story: boolean; images: boolean }): CreateWay[] {
  return step.ways.filter((way) => way !== "draft" || !step.drafts || models[step.drafts]);
}

// A step the server cannot do at all: every way it has needs a missing model.
export function stepUnavailable(step: CreateStep, models: { story: boolean; images: boolean }): boolean {
  return (step.needs !== undefined && !models[step.needs]) || offeredWays(step, models).length === 0;
}
