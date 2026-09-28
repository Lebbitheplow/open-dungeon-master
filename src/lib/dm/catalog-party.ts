// The party half of the adjudication catalog: hit points, coin, gear,
// resources, conditions and rests. Names match the tool names the AI DM is
// offered exactly, because both callers reach the same engine
// (src/lib/dm/invoke.ts).
import type { CatalogEntry } from "@/lib/dm/catalog-types";
import { UPDATE_SHEET_FIELDS } from "@/lib/dm/update-sheet-args";
import { DRACONIC_ANCESTRIES } from "@/lib/srd/racial-grants";

const ABILITIES = [
  { value: "str", label: "Strength" },
  { value: "dex", label: "Dexterity" },
  { value: "con", label: "Constitution" },
  { value: "int", label: "Intelligence" },
  { value: "wis", label: "Wisdom" },
  { value: "cha", label: "Charisma" },
];

const REASON = {
  name: "reason",
  label: "Reason",
  kind: "text" as const,
  placeholder: "Short in-fiction cause",
};

export const PARTY_ADJUDICATIONS: CatalogEntry[] = [
  {
    name: "apply_damage",
    label: "Damage a character",
    category: "party",
    summary: "Temp hit points absorb first, hit points floor at zero, death saves start themselves.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "amount", label: "Damage", kind: "number", required: true, min: 1, max: 200 },
      { name: "type", label: "Type", kind: "text", placeholder: "slashing, fire, ..." },
      {
        name: "magical",
        label: "From a spell or a magic weapon",
        kind: "boolean",
        help: "Resistance to nonmagical attacks does not apply to it.",
      },
      REASON,
    ],
  },
  {
    name: "heal",
    label: "Heal",
    category: "party",
    summary: "Flat hit points, or a healing spell the server rolls with the caster's modifier.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "amount", label: "Hit points", kind: "number", min: 1, max: 200 },
      { name: "spell", label: "Spell", kind: "text", help: "Cure Wounds, Healing Word... the server rolls it." },
      { name: "casterId", label: "Caster", kind: "character" },
      { name: "level", label: "Slot level", kind: "number", min: 1, max: 9 },
      { name: "temp", label: "Temporary hit points", kind: "boolean" },
      REASON,
    ],
  },
  {
    name: "stabilize",
    label: "Stabilize",
    category: "party",
    summary: "Ends a dying character's death saves without healing them. It takes the helper's action.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "healerId", label: "Tended by", kind: "character", required: true },
      {
        name: "method",
        label: "How",
        kind: "select",
        options: [
          { value: "check", label: "Medicine check, DC 10" },
          { value: "kit", label: "A use of their healer's kit" },
          { value: "spell", label: "Spare the Dying" },
        ],
        help: "The server rolls the check; a kit or the spell needs none.",
      },
      REASON,
    ],
  },
  {
    name: "award_xp",
    label: "Award XP",
    category: "party",
    summary: "Gives XP to whoever earned it; levels follow on their own.",
    fields: [
      { name: "characterIds", label: "Characters", kind: "characters", required: true },
      { name: "amount", label: "XP each", kind: "number", required: true, min: 1, max: 10000 },
      REASON,
    ],
  },
  {
    name: "party_stash",
    label: "The party's pack and purse",
    category: "party",
    summary: "Moves an item or coin between one character and the party's shared kit.",
    fields: [
      {
        name: "do",
        label: "Do",
        kind: "select",
        required: true,
        options: [
          { value: "stow", label: "Put an item in the pack" },
          { value: "take", label: "Take an item from the pack" },
          { value: "deposit", label: "Put money in the purse" },
          { value: "withdraw", label: "Take money from the purse" },
        ],
      },
      { name: "characterId", label: "Whose hands", kind: "character", required: true },
      { name: "name", label: "Item", kind: "text" },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 999 },
      { name: "coins", label: "Money", kind: "text", placeholder: "3 gp 4 sp" },
      { name: "amount", label: "Or gold", kind: "number", min: 0, max: 1000000 },
      REASON,
    ],
  },
  {
    name: "party_award",
    label: "Award the party",
    category: "party",
    summary: "XP each, a purse split evenly, and one item to the finder, in a single action.",
    fields: [
      { name: "characterIds", label: "Who shares it", kind: "characters", required: true },
      { name: "amount", label: "XP each", kind: "number", min: 1, max: 20000 },
      { name: "delta", label: "Gold in total", kind: "number", min: -100000, max: 100000, help: "Split evenly; the remainder goes to the first share." },
      { name: "name", label: "Item", kind: "text", help: "Goes to the first character listed." },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 99 },
      REASON,
    ],
  },
  {
    name: "modify_gold",
    label: "Gold",
    category: "party",
    summary: "Adds or removes coin; a negative number spends it.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "delta", label: "Change in gold", kind: "number", required: true, min: -100000, max: 100000 },
      {
        name: "coins",
        label: "Or in coins",
        kind: "text",
        placeholder: "340 silver",
        help: "Overrides the amount above; the sign of the change still says gain or spend.",
      },
      REASON,
    ],
  },
  {
    name: "grant_item",
    label: "Give an item",
    category: "party",
    summary: "Puts an item in a character's hands, weight and all.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "name", label: "Item", kind: "text", required: true },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 99 },
      {
        name: "unidentified",
        label: "They cannot tell what it is",
        kind: "boolean",
        help: "Type the description they would use, not the real name. Reveal it later with Name a mystery item.",
      },
      REASON,
    ],
  },
  {
    name: "reveal_item",
    label: "Name a mystery item",
    category: "party",
    summary: "Turns an unidentified item into what it actually is, on the sheet and in the log.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "name", label: "Called on the sheet", kind: "text", required: true },
      { name: "revealedName", label: "Actually", kind: "text", placeholder: "Ring of Protection" },
      REASON,
    ],
  },
  {
    name: "remove_item",
    label: "Take an item",
    category: "party",
    summary: "Lost, stolen or destroyed. Consumables being used go through Use an item.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "name", label: "Item", kind: "text", required: true },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 99 },
      REASON,
    ],
  },
  {
    name: "use_item",
    label: "Use an item",
    category: "party",
    summary: "Spends a consumable and applies what it does, potions rolled properly.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "item", label: "Item", kind: "text", required: true },
      { name: "targetCharacterId", label: "Used on", kind: "character" },
      REASON,
    ],
  },
  {
    name: "purchase",
    label: "Buy or sell",
    category: "party",
    summary: "Moves the coin and the goods in one action.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      {
        name: "action",
        label: "Do",
        kind: "select",
        required: true,
        options: [
          { value: "buy", label: "Buy" },
          { value: "sell", label: "Sell" },
        ],
      },
      { name: "item", label: "Item", kind: "text", required: true },
      { name: "price", label: "Gold each", kind: "number", required: true, min: 0, max: 100000 },
      { name: "qty", label: "How many", kind: "number", min: 1, max: 99 },
      REASON,
    ],
  },
  {
    name: "use_resource",
    label: "Spend a resource",
    category: "party",
    summary: "Rage, Ki, Bardic Inspiration, Wild Shape: the counter moves and the effect lands.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "resource", label: "Resource", kind: "text", required: true },
      { name: "amount", label: "How much", kind: "number", min: 1, max: 100, help: "Points from a pool: Lay on Hands, Ki. One use when left empty." },
      { name: "variant", label: "Option", kind: "text", help: "For a feature with choices." },
      { name: "targetCharacterId", label: "Target", kind: "character" },
      { name: "form", label: "Beast form", kind: "text", help: "Wild Shape: the beast's name. The server reads its stat block." },
      { name: "formHp", label: "Form's hit points", kind: "number", min: 1, max: 300 },
      { name: "formAc", label: "Form's armor class", kind: "number", min: 1, max: 30 },
      { name: "formCr", label: "Form's challenge rating", kind: "number", min: 0, max: 30, help: "For a beast the server has no stat block for; the druid's level limits it." },
      { name: "formFlies", label: "The form flies", kind: "boolean" },
      { name: "formSwims", label: "The form swims", kind: "boolean" },
      REASON,
    ],
  },
  {
    name: "set_condition",
    label: "Condition",
    category: "party",
    summary: "Applies a condition, with rounds or a save that ends it; the server re-rolls both.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "condition", label: "Condition", kind: "text", required: true },
      { name: "rounds", label: "Rounds", kind: "number", min: 1, max: 100 },
      { name: "minutes", label: "Or minutes", kind: "number", min: 1, max: 1440 },
      { name: "hours", label: "Or hours", kind: "number", min: 1, max: 24 },
      { name: "saveAbility", label: "Save to end", kind: "select", options: ABILITIES },
      { name: "saveDc", label: "Save DC", kind: "number", min: 1, max: 30 },
      {
        name: "sourceEnemyId",
        label: "Caused by enemy",
        kind: "enemy",
        help: "Who they are frightened of, charmed or grappled by; it ends when that enemy falls.",
      },
      { name: "sourceCharacterId", label: "Or by character", kind: "character" },
      REASON,
    ],
  },
  {
    name: "set_effect",
    label: "A lasting effect",
    category: "party",
    summary: "A blessing, curse or potion that moves real numbers until it runs out.",
    fields: [
      { name: "characterId", label: "Character", kind: "character" },
      { name: "enemyId", label: "Or enemy", kind: "enemy" },
      { name: "name", label: "Called", kind: "text", required: true, placeholder: "Bless" },
      { name: "source", label: "From", kind: "text", placeholder: "Aldric's spell" },
      {
        name: "field",
        label: "Changes",
        kind: "select",
        required: true,
        options: [
          { value: "ac", label: "Armor Class" },
          { value: "attack", label: "Attack rolls" },
          { value: "damage", label: "Damage rolls" },
          { value: "save", label: "Saving throws" },
          { value: "check", label: "Ability checks" },
          { value: "initiative", label: "Initiative" },
          { value: "speed", label: "Speed" },
          { value: "maxHp", label: "Maximum hit points" },
        ],
      },
      {
        name: "mode",
        label: "How",
        kind: "select",
        options: [
          { value: "add", label: "By an amount" },
          { value: "override", label: "Set it to" },
          { value: "advantage", label: "Advantage" },
          { value: "disadvantage", label: "Disadvantage" },
        ],
      },
      { name: "value", label: "Amount", kind: "number", min: -30, max: 30 },
      {
        name: "auraFeet",
        label: "Reaches (feet)",
        kind: "number",
        min: 5,
        max: 120,
        help: "Set when the effect surrounds its target; the board draws the ring at this radius.",
      },
      {
        name: "auraTone",
        label: "Ring reads as",
        kind: "select",
        options: [
          { value: "ward", label: "Protective" },
          { value: "harm", label: "Hostile" },
          { value: "bless", label: "Blessing" },
          { value: "neutral", label: "Neutral" },
        ],
      },
      {
        name: "duration",
        label: "Lasts",
        kind: "select",
        options: [
          { value: "rounds", label: "rounds" },
          { value: "minutes", label: "minutes" },
          { value: "encounter", label: "until the fight ends" },
          { value: "manual", label: "until removed" },
        ],
      },
      { name: "remaining", label: "How many", kind: "number", min: 1, max: 1000 },
      { name: "saveAbility", label: "Save to end", kind: "select", options: ABILITIES },
      { name: "saveDc", label: "Save DC", kind: "number", min: 1, max: 30 },
      { name: "visible", label: "The party can tell", kind: "boolean" },
    ],
  },
  {
    name: "clear_effect",
    label: "Lift an effect",
    category: "party",
    summary: "Ends a lasting effect early: dispelled, cured, or the curse broken.",
    fields: [
      { name: "characterId", label: "Character", kind: "character" },
      { name: "enemyId", label: "Or enemy", kind: "enemy" },
      { name: "name", label: "Called", kind: "text", required: true },
    ],
  },
  {
    name: "clear_condition",
    label: "Clear a condition",
    category: "party",
    summary: "Cured, dispelled, rested off or shaken off.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "condition", label: "Condition", kind: "text", required: true },
      REASON,
    ],
  },
  {
    name: "use_spell_slot",
    label: "Spend a slot",
    category: "party",
    summary: "Marks a spell slot used and starts concentration when the spell needs it.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "level", label: "Slot level", kind: "number", required: true, min: 1, max: 9 },
      // The handler reads `spell`: the name is what it checks the list, the
      // slot level, the casting time and concentration against. It may be
      // left out: a slot burned with no spell (Divine Smite) still spends.
      { name: "spell", label: "Spell", kind: "text" },
      { name: "concentration", label: "Concentration", kind: "boolean" },
      { name: "ritual", label: "Cast as a ritual", kind: "boolean" },
    ],
  },
  {
    name: "learn_spell",
    label: "Learn a spell",
    category: "party",
    summary: "Adds a spell to what a character knows, or takes one away.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      { name: "action", label: "Learn or forget", kind: "select", required: true, options: [
          { value: "add", label: "Learn it" },
          { value: "remove", label: "Forget it" },
        ],
      },
      { name: "spell", label: "Spell", kind: "text", required: true },
      REASON,
    ],
  },
  {
    name: "update_sheet",
    label: "Correct a sheet",
    category: "party",
    summary: "For what the other actions do not cover. Everything is audited and undoable.",
    fields: [
      { name: "characterId", label: "Character", kind: "character", required: true },
      // One field at a time, as a name and what it becomes. The handler
      // turns the pair into the patch it takes from the model
      // (src/lib/dm/update-sheet-args.ts), so the form stays two inputs
      // rather than one per key of a sheet.
      // Neither is required here: the model, and an assisted table's AI,
      // send the sheet's own keys through this same entry, and the handler
      // refuses a call that changes nothing.
      {
        name: "field",
        label: "Field",
        kind: "select",
        options: UPDATE_SHEET_FIELDS.map((field) => ({ value: field.name, label: field.label })),
      },
      {
        name: "value",
        label: "Becomes",
        kind: "text",
        help: "A whole number for a number. Conditions as a list (poisoned, prone), or none to clear them.",
      },
      REASON,
    ],
  },
  {
    name: "take_rest",
    label: "Rest",
    category: "party",
    summary: "A short or long rest for the whole party, on the table's rest variant.",
    fields: [
      {
        name: "kind",
        label: "Rest",
        kind: "select",
        required: true,
        options: [
          { value: "short", label: "Short rest" },
          { value: "long", label: "Long rest" },
        ],
      },
      REASON,
    ],
  },
  {
    name: "add_companion",
    label: "Add a companion",
    category: "party",
    summary: "Builds an AI-played party member or scene ally with a real sheet.",
    fields: [
      { name: "name", label: "Name", kind: "text", required: true },
      { name: "class", label: "Class", kind: "text", required: true },
      { name: "race", label: "Race", kind: "text" },
      {
        name: "ancestry",
        label: "Draconic ancestry",
        kind: "select",
        help: "For a dragonborn; rolled on the SRD table when left unset.",
        options: DRACONIC_ANCESTRIES.map((entry) => ({ value: entry.id, label: entry.dragon })),
      },
      { name: "level", label: "Level", kind: "number", min: 1, max: 20, help: "The party's average when left empty." },
      { name: "kind", label: "Kind", kind: "select", required: true, options: [
        { value: "party", label: "Party member" },
        { value: "guest", label: "Scene ally" },
      ] },
      { name: "personality", label: "Personality", kind: "text", required: true },
    ],
  },
  {
    name: "dismiss_companion",
    label: "Dismiss a companion",
    category: "party",
    summary: "Writes an AI-played ally out of the party.",
    fields: [
      // The handler takes the companion's id and answers to their name too.
      { name: "characterId", label: "Companion", kind: "character", required: true },
      REASON,
    ],
  },
];

