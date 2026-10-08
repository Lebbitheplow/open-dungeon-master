// The console's request_roll form: every argument the roll tool takes, from
// the check and its difficulty to a contest, a tool, and Inspiration spent.
// Split from catalog-world.ts, whose story entries it leads.

import type { CatalogEntry } from "@/lib/dm/catalog-types";
import {
  ABILITY_OPTIONS as ABILITIES,
  DIFFICULTY_OPTIONS,
  SKILL_OPTIONS,
  damageTypeField,
} from "@/lib/dm/catalog-vocab";

export const REQUEST_ROLL_ADJUDICATION: CatalogEntry = {
    name: "request_roll",
    label: "Ask for a roll",
    category: "story",
    summary: "Asks a player for a check, save or attack; the modifier comes from their sheet.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", help: "Empty only for an NPC's attack, damage or custom roll with its dice below." },
      {
        name: "kind",
        label: "Roll",
        kind: "select",
        required: true,
        options: [
          { value: "skill_check", label: "Skill check" },
          { value: "saving_throw", label: "Saving throw" },
          { value: "ability_check", label: "Ability check" },
          { value: "attack", label: "Attack" },
          { value: "damage", label: "Damage" },
          { value: "initiative", label: "Initiative" },
          { value: "custom", label: "Something else" },
        ],
      },
      { name: "skill", label: "Skill", kind: "select", options: SKILL_OPTIONS },
      { name: "ability", label: "Ability", kind: "select", options: ABILITIES },
      { name: "difficulty", label: "Difficulty", kind: "select", options: DIFFICULTY_OPTIONS },
      { name: "dc", label: "Or an exact DC", kind: "number", min: 1, max: 30 },
      {
        name: "advantage",
        label: "Advantage",
        kind: "select",
        options: [
          { value: "none", label: "Straight" },
          { value: "advantage", label: "Advantage" },
          { value: "disadvantage", label: "Disadvantage" },
        ],
      },
      {
        name: "advantageReason",
        label: "Why",
        kind: "text",
        placeholder: "the rope is slick with rain",
        help: "Kept with the roll as your ruling. Your pick stands either way; the AI DM's needs a circumstance the server cannot see.",
      },
      {
        name: "visibility",
        label: "Who sees it",
        kind: "select",
        options: [
          { value: "public", label: "Everyone (default)" },
          { value: "blind", label: "Blind: they know they rolled, not what" },
          { value: "self", label: "The roller and you" },
          { value: "dm", label: "You alone" },
        ],
        help: "Your screen. The dice are still the server's, and the number is still real.",
      },
      {
        name: "expression",
        label: "Dice",
        kind: "dice",
        help: "For an attack, damage or something else: 1d20+5, 2d6+3. Checks and saves come from the sheet.",
      },
      damageTypeField("damageType", "Damage type", "For a damage roll: the target's resistances apply."),
      { name: "tool", label: "With a tool", kind: "text", placeholder: "thieves' tools", help: "An ability check made with a tool: proficiency is added when they have it." },
      { name: "useInspiration", label: "Spend their Inspiration", kind: "boolean", help: "Advantage on this roll; refused when they hold none." },
      { name: "luck", label: "Spend a luck point", kind: "boolean", help: "Lucky: an extra d20 on this roll, the best kept; the point is spent. Ignored without the feat or a point left." },
      { name: "againstEnemyId", label: "Contested by (enemy)", kind: "enemy", help: "A contest: the server rolls the enemy's opposing check (Insight against a lie, Perception against a sneak) as the DC." },
      { name: "againstMonster", label: "Contested by (stat block)", kind: "text", placeholder: "guard", help: "Out of a fight: the creature's stat block by name; its check is rolled as the DC." },
      { name: "contestSkill", label: "Their skill", kind: "text", placeholder: "insight", help: "The creature's skill, when the usual pairing is not the one." },
      {
        name: "targetEnemyId",
        label: "Damage lands on",
        kind: "enemy",
        help: "For a damage roll in a fight: the server applies the total to this enemy.",
      },
      {
        name: "against",
        label: "The save resists",
        kind: "text",
        placeholder: "frightened, poison, a fireball",
        help: "So a trait that helps against it is applied.",
      },
      { name: "reason", label: "What they are trying", kind: "text" },
    ],
  };
