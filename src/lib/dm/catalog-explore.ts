// The console forms for the exploration tools (src/lib/dm/explore-tools.ts):
// shifting a load, lifestyles, downtime, and the SRD's diseases, madness and
// poisons. A person running the table reaches each the way the model does.

import type { CatalogEntry } from "@/lib/dm/catalog-types";
import { REASON_FIELD } from "@/lib/dm/catalog-vocab";
import { LIFESTYLES } from "@/lib/dm/between-state";
import { DISEASES, POISONS } from "@/lib/srd/afflictions";

const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export const EXPLORE_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "lift",
    label: "Lift, push or drag",
    category: "world",
    summary: "Checks a heavy load against the character's Strength: 30 x Strength at most, 5 feet of speed past their carrying capacity.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "weightLb", label: "Weight (lb)", kind: "number", required: true, min: 1, max: 100000 },
      {
        name: "how",
        label: "How",
        kind: "select",
        options: [
          { value: "lift", label: "Lift" },
          { value: "push", label: "Push" },
          { value: "drag", label: "Drag" },
        ],
      },
      REASON_FIELD,
    ],
  },
  {
    name: "set_lifestyle",
    label: "Set lifestyle",
    category: "party",
    summary: "The lifestyle characters live in town; each dawn that passes there and each day of downtime is charged to their purse.",
    fields: [
      {
        name: "lifestyle",
        label: "Lifestyle",
        kind: "select",
        required: true,
        options: [
          ...LIFESTYLES.map((lifestyle) => ({ value: lifestyle, label: title(lifestyle) })),
          { value: "none", label: "None (on the road)" },
        ],
      },
      { name: "characterIds", label: "Who", kind: "characters", help: "Leave empty for the whole party." },
      REASON_FIELD,
    ],
  },
  {
    name: "downtime",
    label: "Downtime",
    category: "party",
    summary: "Days between adventures on one activity: crafting, a profession, recuperating, research or training. Moves the clock, charges the costs, keeps the progress.",
    fields: [
      { name: "days", label: "Days", kind: "number", required: true, min: 1, max: 365 },
      { name: "characterId", label: "Character", kind: "character", required: true },
      {
        name: "activity",
        label: "Activity",
        kind: "select",
        required: true,
        options: [
          { value: "crafting", label: "Crafting" },
          { value: "profession", label: "Practicing a profession" },
          { value: "recuperating", label: "Recuperating" },
          { value: "research", label: "Researching" },
          { value: "training", label: "Training" },
        ],
      },
      { name: "item", label: "Item to craft", kind: "text", help: "Crafting: a nonmagical item; 5 gp of its value a day per crafter." },
      { name: "tool", label: "Tools", kind: "text", help: "Crafting: the artisan's tools; every crafter must be proficient." },
      { name: "helperIds", label: "Helping crafters", kind: "characters" },
      { name: "subject", label: "Language or tool to learn", kind: "text", help: "Training: 250 days at 1 gp a day." },
      {
        name: "kind",
        label: "Training in",
        kind: "select",
        options: [
          { value: "language", label: "A language" },
          { value: "tool", label: "A tool" },
        ],
      },
      { name: "topic", label: "Research topic", kind: "text", help: "Research: 1 gp a day; what is found is yours to tell." },
      {
        name: "recover",
        label: "Recuperating for",
        kind: "select",
        options: [
          { value: "advantage", label: "Advantage against their disease or poison" },
          { value: "end_effect", label: "End what stops their healing" },
        ],
      },
      { name: "organization", label: "Employed by an organization", kind: "boolean", help: "Profession: covers a comfortable lifestyle." },
      { name: "perform", label: "Performing", kind: "boolean", help: "Profession: a proficient performer covers a wealthy lifestyle." },
      REASON_FIELD,
    ],
  },
  {
    name: "afflict",
    label: "Disease, madness or poison",
    category: "party",
    summary: "Lays a disease, madness or poison on a character, the SRD's or one from this table's workshop: the server rolls the save and holds what follows.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      {
        name: "kind",
        label: "What",
        kind: "select",
        required: true,
        options: [
          { value: "disease", label: "Disease" },
          { value: "madness", label: "Madness" },
          { value: "poison", label: "Poison" },
        ],
      },
      {
        name: "name",
        label: "Which",
        kind: "select",
        required: true,
        options: [
          ...Object.values(DISEASES).map((disease) => ({ value: disease.name, label: `Disease: ${disease.name}` })),
          { value: "short", label: "Madness: short-term" },
          { value: "long", label: "Madness: long-term" },
          { value: "indefinite", label: "Madness: indefinite" },
          ...POISONS.map((poison) => ({ value: poison.name, label: `Poison: ${poison.name} (${poison.type})` })),
        ],
        // The table's own diseases and poisons from the workshop, by name.
        other: { label: "One of this table's diseases or poisons", placeholder: "Marsh Fever" },
      },
      { name: "save", label: "Roll the save", kind: "boolean", default: true, help: "Untick when they are already infected or have no save." },
      { name: "dc", label: "Infection DC", kind: "number", min: 1, max: 30, help: "Disease: when the source sets its own DC." },
      { name: "saveDc", label: "Madness save DC", kind: "number", min: 1, max: 30 },
      {
        name: "saveAbility",
        label: "Madness save",
        kind: "select",
        options: [
          { value: "wis", label: "Wisdom" },
          { value: "cha", label: "Charisma" },
        ],
      },
      { name: "symptomsNow", label: "Symptoms now", kind: "boolean", help: "Disease: skip the incubation." },
      REASON_FIELD,
    ],
  },
];
