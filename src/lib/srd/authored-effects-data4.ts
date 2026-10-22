// The engine hooks of issue 474's subclass audit, Appendix B: the authored
// features whose rules text states a number or a state that no engine held,
// across every class (the shape of an entry: authored-effects-data.ts). Each
// gets the hook that fits, or a `narrated` line saying why the DM holds it.

import type { AuthoredEntry, Formula } from "@/lib/srd/authored-effects-types";

const ALL_DAMAGE = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
];
const PHYSICAL = ["bludgeoning", "piercing", "slashing"];
// The martial arts die by monk level, plus the Wisdom modifier.
const MARTIAL_WIS: Formula = (level, mods) => `1${level >= 17 ? "d10" : level >= 11 ? "d8" : level >= 5 ? "d6" : "d4"}+${mods.wis ?? 0}`;
// A Psionic Energy die by class level, plus the Intelligence modifier.
const PSIONIC_INT: Formula = (level, mods) => `1${level >= 17 ? "d12" : level >= 11 ? "d10" : level >= 5 ? "d8" : "d6"}+${mods.int ?? 0}`;
// The subclass's spell table grants it, known or always prepared and free
// (subclasses.json `spells`).
const SPELL_TABLE = { file: "src/lib/srd/features.ts", call: "export function subclassSpellsFor(" };

export const AUTHORED_DATA_C: Record<string, AuthoredEntry> = {
  // ---- barbarian ----
  "barbarian::Spirit Seeker": {
    subclass: "Path of the Totem Warrior",
    narrated: "Ritual castings of beast sense and speak with animals: information and talk the DM narrates, no number in a fight.",
  },
  "barbarian::Spirit Walker": {
    subclass: "Path of the Totem Warrior",
    narrated: "A ritual commune with nature: information the DM gives, no number in a fight.",
  },
  "barbarian::Vengeful Ancestors": {
    subclass: "Path of the Ancestral Guardian",
    // Spirit Shield's reaction: the damage it prevents strikes the attacker.
    heldBy: { file: "src/lib/dm/authored-reactions.ts", call: "does.reflect" },
  },
  "barbarian::Warrior of the Gods": {
    subclass: "Path of the Zealot",
    narrated: "A revival spell cast on the barbarian needs no material component: the caster's casting, not a number on this sheet.",
  },
  "barbarian::Rage Beyond Death": {
    subclass: "Path of the Zealot",
    narrated:
      "The death engine drops a character at 0 hit points; while the zealot rages the DM keeps them acting and rolling death saves, and only the rage's end at 0 kills them.",
  },
  "barbarian::Wild Surge": {
    subclass: "Path of Wild Magic",
    narrated: "The d8 table's effect is rolled and narrated by the DM; its damage goes through aoe_damage and apply_damage, its AC through set_effect.",
  },
  "barbarian::Controlled Surge": {
    subclass: "Path of Wild Magic",
    narrated: "Rolling the wild magic table twice and choosing is the DM's roll on that narrated table.",
  },

  // ---- bard ----
  "bard::Master's Flourish": {
    subclass: "College of Swords",
    narrated: "A flourish paid with a d6 instead of a Bardic Inspiration die: the DM adds the d6 when Blade Flourish is spent with nothing from the pool.",
  },
  "bard::Silver Tongue": {
    subclass: "College of Eloquence",
    effects: [{ kind: "check_floor", skills: ["persuasion", "deception"], floor: 10 }],
  },
  "bard::Unfailing Inspiration": {
    subclass: "College of Eloquence",
    narrated: "An inspiration die that changed nothing is handed back: the DM restores the Bardic Inspiration condition when the roll it rode still failed.",
  },
  "bard::Creative Crescendo": {
    subclass: "College of Creation",
    narrated: "More items from Performance of Creation, free of their gold limit: crafting the DM narrates, no number in a fight.",
  },
  "bard::Guiding Whispers": {
    subclass: "College of Spirits",
    heldBy: SPELL_TABLE,
    narrated: "Guidance at a 60-foot reach is the DM's to allow.",
  },
  "bard::Spiritual Focus": {
    subclass: "College of Spirits",
    effects: [
      {
        kind: "spell_rider",
        dice: "1d6",
        classes: ["bard"],
        damageTypes: ALL_DAMAGE,
        healing: true,
        gate: { level: 6 },
        note: "Cast through the spiritual focus; the DM keeps to that.",
      },
    ],
  },
  "bard::Tales from Beyond": {
    subclass: "College of Spirits",
    narrated: "The Spirit Tales table is the DM's to roll and narrate; the Bardic Inspiration die it spends is the bard's counter.",
  },
  "bard::Mystical Connection": {
    subclass: "College of Spirits",
    narrated: "Rolling the Spirit Tales table twice and choosing is the DM's roll on that narrated table.",
  },

  // ---- cleric ----
  "cleric::Potent Spellcasting": {
    subclass: "Knowledge, Light, Grave, Peace and Arcana Domains",
    effects: [{ kind: "spell_rider", dice: "wis", classes: ["cleric"], cantrips: true, note: "One damage roll of a cleric cantrip." }],
  },
  "cleric::Bonus Cantrip (Light)": { subclass: "Light Domain", heldBy: SPELL_TABLE },
  "cleric::Thunderbolt Strike": {
    subclass: "Tempest Domain",
    narrated: "Pushing a Large or smaller creature 10 feet after lightning damage is a move_token (forced) the DM makes.",
  },
  "cleric::Improved Duplicity": {
    subclass: "Trickery Domain",
    narrated: "Up to four illusory duplicates of Invoke Duplicity: positions the DM places, each casting and flanking as the one did.",
  },
  "cleric::Avatar of Battle": {
    subclass: "War Domain",
    effects: [{ kind: "resist", types: PHYSICAL, nonmagical: true }],
  },
  "cleric::Twilight Shroud": {
    subclass: "Twilight Domain",
    narrated: "Half cover for the cleric and allies inside Twilight Sanctuary: +2 AC the DM adds with set_effect while the sanctuary holds.",
  },
  "cleric::Spell Breaker": {
    subclass: "Arcana Domain",
    narrated: "Ending a spell on the creature a healing spell touched is an end_condition the DM makes, of a level no higher than the slot.",
  },
  "cleric::Arcane Mastery": {
    subclass: "Arcana Domain",
    narrated: "The four wizard spells (6th to 9th level) are the cleric's choice; once chosen they are written onto the sheet as always prepared.",
  },

  // ---- druid ----
  "druid::Circle Forms": {
    subclass: "Circle of the Moon",
    // Wild Shape's challenge rating ceiling for a Moon druid.
    heldBy: { file: "src/lib/srd/beast-forms.ts", call: "moonDruid ? Math.max(baseCr, moonCr)" },
  },
  "druid::Thousand Forms": {
    subclass: "Circle of the Moon",
    narrated: "Alter self at will, with no slot: the DM casts it for the druid whenever they ask.",
  },
  "druid::Hearth of Moonlight and Shadow": {
    subclass: "Circle of Dreams",
    spends: [
      {
        name: "Hearth of Moonlight and Shadow",
        action: "none",
        fight: "out",
        does: { kind: "buff", target: "allies", condition: "hearth of moonlight and shadow", rounds: 4800, rangeFt: 30, count: "12" },
      },
    ],
  },
  "druid::Mighty Summoner": {
    subclass: "Circle of the Shepherd",
    effects: [{ kind: "summon_hp_per_hd", amount: 2, types: ["beast", "fey"], note: "Their natural weapons count as magical against resistance; the DM keeps to that." }],
  },
  "druid::Guardian Spirit": {
    subclass: "Circle of the Shepherd",
    narrated: "Summoned creatures ending a turn in the Spirit Totem aura regain half the druid level: a heal the DM makes at the end of the druid's turn.",
  },
  "druid::Spreading Spores": {
    subclass: "Circle of Spores",
    narrated: "A 10-foot cube of spores is a zone the DM places; a creature entering or starting there takes the Halo of Spores damage on a failed Constitution save.",
  },
  "druid::Full of Stars": {
    subclass: "Circle of Stars",
    effects: [{ kind: "resist", types: PHYSICAL, gate: { condition: "starry form" } }],
  },

  // ---- fighter ----
  "fighter::Improved Combat Superiority": {
    subclass: "Battle Master",
    // The superiority die: a d10 at fighter 10, a d12 at 18.
    heldBy: { file: "src/lib/dm/maneuver-rules.ts", call: "export function superiorityDie(" },
  },
  "fighter::Arcane Charge": {
    subclass: "Eldritch Knight",
    narrated: "A 30-foot teleport with Action Surge: a move_token the DM makes when the fighter surges.",
  },
  "fighter::Improved War Magic": {
    subclass: "Eldritch Knight",
    effects: [{ kind: "bonus_attack", after: "spell" }],
  },
  "fighter::Ferocious Charger": {
    subclass: "Cavalier",
    spends: [
      {
        name: "Ferocious Charger",
        action: "none",
        oncePerTurn: true,
        fight: "in",
        does: {
          kind: "save_effect",
          save: "str",
          dcAbility: "str",
          condition: "prone",
          rangeFt: 5,
          onFail: "is knocked prone (the fighter moved 10 feet straight at it before the hit)",
        },
      },
    ],
  },
  "fighter::Echo Avatar": {
    subclass: "Echo Knight",
    narrated: "Seeing and hearing through the echo up to 1,000 feet away: scouting the DM narrates.",
  },
  "fighter::Psionic Strike": {
    subclass: "Psi Warrior",
    spends: [
      {
        name: "Psionic Strike",
        pool: { id: "sub_psionic_energy" },
        oncePerTurn: true,
        action: "none",
        does: { kind: "die_damage", dice: PSIONIC_INT, type: "force" },
      },
    ],
  },
  "fighter::Telekinetic Movement": {
    subclass: "Psi Warrior",
    narrated: "Moving an object or a willing creature 30 feet is a move_token the DM makes; the die it may spend is the Psionic Energy counter.",
  },
  "fighter::Master of Runes": {
    subclass: "Rune Knight",
    narrated: "Each rune is invoked twice per rest: the DM counts the second invocation.",
  },
  "fighter::Rallying Cry": {
    subclass: "Banneret",
    narrated: "Second Wind also heals up to three allies within 60 feet for the fighter level: heals the DM makes when Second Wind is spent.",
  },
  "fighter::Bulwark": {
    subclass: "Banneret",
    effects: [{ kind: "indomitable_ally", rangeFt: 60 }],
  },

  // ---- monk ----
  "monk::Shadow Arts": {
    subclass: "Way of Shadow",
    narrated:
      "Spells cast with 2 ki (darkness, darkvision, pass without trace, silence): the cast tools with the ki spent by use_resource. Minor illusion at will: a monk keeps no spell list, so the DM casts it when asked, as for a non-caster's racial cantrip.",
  },
  "monk::Cloak of Shadows": {
    subclass: "Way of Shadow",
    narrated: "Invisibility in dim light or darkness until the monk attacks, casts or steps into light: set_condition invisible, which the DM ends.",
  },
  "monk::Drunken Technique": {
    subclass: "Way of the Drunken Master",
    narrated: "Flurry of Blows also gives Disengage and 10 feet of movement: the DM moves the monk without opportunity attacks this turn.",
  },
  "monk::Unerring Accuracy": {
    subclass: "Way of the Kensei",
    narrated: "Rerolling one missed monk weapon attack a turn: the DM calls pc_attack again for it.",
  },
  "monk::Sun Shield": {
    subclass: "Way of the Sun Soul",
    effects: [{ kind: "retaliate", formula: (_level, mods) => 5 + (mods.wis ?? 0), type: "radiant", melee: true, note: "The bright light it sheds is the DM's to place." }],
  },
  "monk::Hour of Reaping": {
    subclass: "Way of the Long Death",
    spends: [
      {
        name: "Hour of Reaping",
        action: "action",
        does: {
          kind: "buff",
          condition: "hour of reaping",
          rounds: 1,
          burst: { save: "wis", dcAbility: "wis", rangeFt: 30, condition: "frightened", rounds: 1 },
        },
      },
    ],
  },
  "monk::Mastery of Death": {
    subclass: "Way of the Long Death",
    narrated: "Spending 1 ki to drop to 1 hit point instead of 0: the DM heals the monk to 1 and spends the ki with use_resource.",
  },
  "monk::Hand of Healing": {
    subclass: "Way of Mercy",
    spends: [
      {
        name: "Hand of Healing",
        pool: { id: "ki", amount: 1 },
        action: "action",
        does: { kind: "flames", formula: MARTIAL_WIS, type: "radiant", healOnly: true },
      },
    ],
  },
  "monk::Hand of Harm": {
    subclass: "Way of Mercy",
    spends: [
      {
        name: "Hand of Harm",
        pool: { id: "ki", amount: 1 },
        oncePerTurn: true,
        action: "none",
        does: { kind: "die_damage", dice: MARTIAL_WIS, type: "necrotic" },
      },
    ],
  },
  "monk::Physician's Touch": {
    subclass: "Way of Mercy",
    narrated: "Hand of Healing also ends a disease or condition (end_condition), and Hand of Harm can poison the creature (set_condition poisoned): the DM applies them.",
  },
  "monk::Flurry of Healing and Harm": {
    subclass: "Way of Mercy",
    narrated: "Hand of Healing in place of Flurry of Blows' strikes, with no ki, and one free Hand of Harm: the DM spends nothing for them.",
  },
  "monk::Draconic Disciple": {
    subclass: "Way of the Ascendant Dragon",
    narrated: "Changing an unarmed strike's damage type and rerolling a failed Intimidation or Persuasion check are the DM's; the language is the sheet's training.",
  },

  // ---- paladin ----
  "paladin::Scornful Rebuke": {
    subclass: "Oath of Conquest",
    effects: [{ kind: "retaliate", formula: (_level, mods) => Math.max(1, mods.cha ?? 0), type: "psychic" }],
  },
  "paladin::Aura of the Sentinel": {
    subclass: "Oath of the Watchers",
    effects: [{ kind: "init_prof", note: "Allies within 10 feet (30 from 18th level) add it too; the DM adds theirs." }],
  },
  "paladin::Aura of Hate": {
    subclass: "Oathbreaker",
    effects: [{ kind: "damage_ability", ability: "cha", when: "melee", note: "Fiends and undead within 10 feet (30 from 18th level) add it too; the DM adds theirs." }],
  },
  "paladin::Supernatural Resistance": {
    subclass: "Oathbreaker",
    effects: [{ kind: "resist", types: PHYSICAL, nonmagical: true }],
  },

  // ---- ranger ----
  "ranger::Umbral Sight": {
    subclass: "Gloom Stalker",
    effects: [{ kind: "darkvision", feet: 60, orAdd: 30, note: "Unseen by creatures that rely on darkvision in darkness: the DM keeps to that." }],
  },
  "ranger::Stalker's Flurry": {
    subclass: "Gloom Stalker",
    narrated: "One more weapon attack after a miss, once a turn: the DM calls pc_attack again for it.",
  },
  "ranger::Distant Strike": {
    subclass: "Horizon Walker",
    narrated: "A 10-foot teleport before each attack (move_token) and a third attack after striking two creatures: the DM allows them.",
  },
  "ranger::Bestial Fury": {
    subclass: "Beast Master",
    narrated: "The companion is its own sheet (pet-tools); the DM gives it two attacks when commanded to attack.",
  },
  "ranger::Share Spells": {
    subclass: "Beast Master",
    narrated: "A spell the ranger casts on themselves also affects the companion within 30 feet: the DM applies it to the companion's sheet.",
  },
  "ranger::Exceptional Training": {
    subclass: "Beast Master",
    effects: [
      {
        kind: "pet_magical",
        pets: ["beast_companion"],
        note: "A bonus action commands the companion to Dash, Disengage or Help on a turn it does not attack; the DM moves it.",
      },
    ],
  },
  "ranger::Fey Wanderer Magic": { subclass: "Fey Wanderer", heldBy: SPELL_TABLE },
  "ranger::Swarmkeeper Magic": { subclass: "Swarmkeeper", heldBy: SPELL_TABLE },
  "ranger::Draconic Gift": { subclass: "Drakewarden", heldBy: SPELL_TABLE },
  "ranger::Bond of Fang and Scale": {
    subclass: "Drakewarden",
    // The essence the drake was summoned with, "Bond of Fang and Scale
    // (Fire)": the ranger resists that damage. The drake's size, wings and
    // extra bite die are on its own sheet (pet-tools).
    spends: [{ name: "Drake Essence", aliases: ["Draconic Essence"], does: { kind: "choose", options: ["Acid", "Cold", "Fire", "Lightning", "Poison"] } }],
    effects: [
      { kind: "resist", types: ["acid"], gate: { choice: "Acid" } },
      { kind: "resist", types: ["cold"], gate: { choice: "Cold" } },
      { kind: "resist", types: ["fire"], gate: { choice: "Fire" } },
      { kind: "resist", types: ["lightning"], gate: { choice: "Lightning" } },
      { kind: "resist", types: ["poison"], gate: { choice: "Poison" } },
    ],
  },

  // ---- rogue ----
  "rogue::Infiltration Expertise": { subclass: "Assassin", narrated: "A false identity built over days: roleplay, nothing on a sheet changes." },
  "rogue::Impostor": { subclass: "Assassin", narrated: "Mimicking a studied person: roleplay the DM judges with a Deception check." },
  "rogue::Death Strike": {
    subclass: "Assassin",
    narrated: "A hit on a surprised creature: it makes a Constitution save (DC 8 + Dexterity + proficiency) or takes double damage, which the DM applies after the hit.",
  },
  "rogue::Mage Hand Legerdemain": {
    subclass: "Arcane Trickster",
    narrated: "An invisible mage hand that picks locks and pockets: Sleight of Hand checks the DM calls for.",
  },
  "rogue::Insightful Manipulator": { subclass: "Mastermind", narrated: "Information the DM gives after a minute of watching." },
  "rogue::Soul of Deceit": { subclass: "Mastermind", narrated: "Thoughts that cannot be read and lies that read as true: the DM keeps to that." },
  "rogue::Fancy Footwork": {
    subclass: "Swashbuckler",
    narrated: "A creature the rogue attacked in melee this turn makes no opportunity attack against them: the DM withholds it.",
  },
  "rogue::Panache": { subclass: "Swashbuckler", narrated: "A Persuasion contest that charms or goads a creature: the DM rolls it and sets the condition." },
  "rogue::Ear for Deceit": {
    subclass: "Inquisitive",
    effects: [{ kind: "check_floor", skills: ["insight"], floor: 8, note: "Only on an Insight check to tell whether a creature lies; the DM keeps to that." }],
  },
  "rogue::Whispers of the Dead": { subclass: "Phantom", narrated: "One skill or tool proficiency chosen after each rest: the DM notes it for the day." },
  "rogue::Death's Friend": {
    subclass: "Phantom",
    narrated: "Wails from the Grave's necrotic on the first creature too, and a soul trinket at a long rest's end: the DM applies the damage and the trinket.",
  },
  "rogue::Psi-Bolstered Knack": {
    subclass: "Soulknife",
    narrated: "A Psionic Energy die added to a failed proficient check: the DM rolls it, and the die is the counter's.",
  },
  "rogue::Psychic Whispers": { subclass: "Soulknife", narrated: "Telepathic links for hours: conversation, nothing on a sheet changes." },
  "rogue::Soul Blades": {
    subclass: "Soulknife",
    narrated: "Homing Strikes' die on a missed Psychic Blade and Psychic Teleportation's move: the DM rolls the die (the counter's) and moves the token.",
  },

  // ---- sorcerer ----
  "sorcerer::Wild Magic Surge": { subclass: "Wild Magic", narrated: "The d20 and the wild magic table are the DM's to roll and narrate." },
  "sorcerer::Controlled Chaos": { subclass: "Wild Magic", narrated: "Rolling the wild magic table twice and choosing is the DM's roll on that narrated table." },
  "sorcerer::Spell Bombardment": {
    subclass: "Wild Magic",
    narrated: "One damage die rolled again and added, once a turn: the DM adds it with apply_damage.",
  },
  "sorcerer::Empowered Healing": {
    subclass: "Divine Soul",
    narrated: "Rerolling healing dice for a sorcery point: the DM rolls them again and spends the point with use_resource.",
  },
  "sorcerer::Eyes of the Dark": {
    subclass: "Shadow Magic",
    effects: [{ kind: "darkvision", feet: 120, note: "Darkness for 2 sorcery points, seen through when cast that way, is the cast tools' with the points spent." }],
  },
  "sorcerer::Psionic Spells": { subclass: "Aberrant Mind", heldBy: SPELL_TABLE },
  "sorcerer::Psionic Sorcery": {
    subclass: "Aberrant Mind",
    narrated: "A psionic spell cast with sorcery points instead of a slot: the cast tools with the points spent by use_resource.",
  },
  "sorcerer::Revelation in Flesh": {
    subclass: "Aberrant Mind",
    spends: [
      {
        name: "Revelation in Flesh",
        pool: { id: "sorcery_points", perUnit: true, max: 4 },
        action: "bonus",
        does: {
          kind: "buff",
          condition: "revelation in flesh (fly)",
          variants: {
            fly: "revelation in flesh (fly)",
            swim: "revelation in flesh (swim)",
            see: "revelation in flesh (see)",
            squeeze: "revelation in flesh (squeeze)",
          },
          rounds: 100,
        },
      },
    ],
    effects: [
      { kind: "move", fly: "walk", gate: { condition: "revelation in flesh (fly)" } },
      { kind: "move", swim: "walk", gate: { condition: "revelation in flesh (swim)" }, note: "The swimming speed is twice the walking speed, and the sorcerer breathes water; one benefit per point spent." },
    ],
  },
  "sorcerer::Clockwork Magic": { subclass: "Clockwork Soul", heldBy: SPELL_TABLE },
  "sorcerer::Bastion of Law": {
    subclass: "Clockwork Soul",
    narrated: "A ward of d8s that soaks damage: the DM rolls the dice spent off the damage, the sorcery points spent with use_resource.",
  },

  // ---- warlock ----
  "warlock::Awakened Mind": { subclass: "The Great Old One", narrated: "Telepathic speech: conversation, nothing on a sheet changes." },
  "warlock::Thought Shield": {
    subclass: "The Great Old One",
    effects: [{ kind: "resist", types: ["psychic"], note: "Psychic damage dealt to the warlock is dealt back to its source: the DM applies it." }],
  },
  "warlock::Create Thrall": { subclass: "The Great Old One", narrated: "A charmed thrall in telepathic contact: set_condition charmed, held until a remove curse." },
  "warlock::Bonus Cantrips (Celestial)": { subclass: "The Celestial", heldBy: SPELL_TABLE },
  "warlock::Grave Touched": {
    subclass: "The Undead",
    narrated: "Changing a hit's damage to necrotic, with one more die in Form of Dread: the DM applies the type and the die.",
  },
  "warlock::Undying Nature": { subclass: "The Undying", narrated: "Needs no food, water, breath or sleep, and ages slowly: roleplay, nothing in a fight changes." },

  // ---- wizard ----
  "wizard::Abjuration Savant": { subclass: "School of Abjuration", narrated: "Copying abjuration spells costs half the time and gold: downtime the DM charges." },
  "wizard::Improved Abjuration": {
    subclass: "School of Abjuration",
    narrated: "The proficiency bonus on the ability check of an abjuration spell (counterspell, dispel magic): the DM adds it to that check.",
  },
  "wizard::Conjuration Savant": { subclass: "School of Conjuration", narrated: "Copying conjuration spells costs half the time and gold: downtime the DM charges." },
  "wizard::Minor Conjuration": { subclass: "School of Conjuration", narrated: "Conjuring a small nonmagical object for an hour: an item the DM adds and removes." },
  "wizard::Focused Conjuration": {
    subclass: "School of Conjuration",
    effects: [{ kind: "concentration_guard", school: "conjuration", tempHp: "0" }],
  },
  "wizard::Divination Savant": { subclass: "School of Divination", narrated: "Copying divination spells costs half the time and gold: downtime the DM charges." },
  "wizard::Expert Divination": {
    subclass: "School of Divination",
    effects: [{ kind: "slot_refund", school: "divination", minLevel: 2, maxLevel: 5 }],
  },
  "wizard::Enchantment Savant": { subclass: "School of Enchantment", narrated: "Copying enchantment spells costs half the time and gold: downtime the DM charges." },
  "wizard::Split Enchantment": {
    subclass: "School of Enchantment",
    effects: [{ kind: "twin_spell", school: "enchantment", minLevel: 1, maxLevel: 9 }],
  },
  "wizard::Alter Memories": { subclass: "School of Enchantment", narrated: "Making a charmed creature forget: the DM rolls its save and narrates what it loses." },
  "wizard::Illusion Savant": { subclass: "School of Illusion", narrated: "Copying illusion spells costs half the time and gold: downtime the DM charges." },
  "wizard::Improved Minor Illusion": {
    subclass: "School of Illusion",
    heldBy: SPELL_TABLE,
    narrated: "Sound and an image with the same casting is the DM's to allow.",
  },
  "wizard::Malleable Illusions": { subclass: "School of Illusion", narrated: "Reshaping a lasting illusion with an action: the DM narrates the change." },
  "wizard::Necromancy Savant": { subclass: "School of Necromancy", narrated: "Copying necromancy spells costs half the time and gold: downtime the DM charges." },
  "wizard::Grim Harvest": {
    subclass: "School of Necromancy",
    effects: [{ kind: "grim_harvest" }],
  },
  "wizard::Undead Thralls": {
    subclass: "School of Necromancy",
    narrated: "Animate dead raises one more corpse, and the undead gain the wizard level in hit points and the proficiency bonus on weapon damage: the DM writes those onto their stat blocks.",
  },
  "wizard::Command Undead": {
    subclass: "School of Necromancy",
    spends: [
      {
        name: "Command Undead",
        action: "action",
        does: {
          kind: "save_effect",
          save: "cha",
          dcAbility: "spell",
          condition: "charmed",
          rounds: 14400,
          rangeFt: 60,
          onFail: "becomes friendly and obeys the wizard until they use this again (an undead of Intelligence 8 or more saved with advantage, which the DM rolls; one of 12 or more saves again each hour)",
        },
      },
    ],
  },
  "wizard::Transmutation Savant": { subclass: "School of Transmutation", narrated: "Copying transmutation spells costs half the time and gold: downtime the DM charges." },
  "wizard::Minor Alchemy": { subclass: "School of Transmutation", narrated: "Changing a material for an hour: crafting the DM narrates." },
  "wizard::Master Transmuter": {
    subclass: "School of Transmutation",
    narrated: "Spending the Transmuter's Stone on a major transformation, a cure, youth or a raising: the DM resolves the one chosen.",
  },
  "wizard::Tactical Wit": { subclass: "War Magic", effects: [{ kind: "init_ability", ability: "int" }] },
  "wizard::Deflecting Shroud": {
    subclass: "War Magic",
    narrated: "When Arcane Deflection is used, up to three creatures within 60 feet take half the wizard level in force: the DM applies it with apply_damage.",
  },
  "wizard::Song of Victory": {
    subclass: "Bladesinging",
    effects: [{ kind: "damage_ability", ability: "int", when: "melee", requiresCondition: "bladesong" }],
  },
  "wizard::Temporal Awareness": { subclass: "Chronurgy Magic", effects: [{ kind: "init_ability", ability: "int" }] },
  "wizard::Gravity Well": {
    subclass: "Graviturgy Magic",
    narrated: "Moving a creature a spell affected 5 feet: a move_token (forced) the DM makes.",
  },
  "wizard::Awakened Spellbook": {
    subclass: "Order of Scribes",
    narrated: "Swapping a spell's damage type to one in the book, and casting a ritual at its normal time once a day: the DM applies both when the wizard asks.",
  },

  // ---- artificer ----
  "artificer::Alchemical Savant": {
    subclass: "Alchemist",
    effects: [
      {
        kind: "spell_rider",
        dice: (_level: number, mods: Record<string, number>) => Math.max(1, mods.int ?? 0),
        classes: ["artificer"],
        damageTypes: ["acid", "fire", "necrotic", "poison"],
        healing: true,
        note: "One roll of a spell cast through alchemist's supplies; the DM keeps to that.",
      },
    ],
  },
  "artificer::Arcane Armor": { subclass: "Armorer", narrated: "Armor that needs no Strength, stays on and replaces limbs: nothing in a fight changes." },
  "artificer::Armor Modifications": { subclass: "Armorer", narrated: "The armor's parts take infusions as separate items: picks of the Infuse Item list (options.json)." },
  "artificer::Fortified Position": {
    subclass: "Artillerist",
    narrated: "Two cannons at once, and half cover within 10 feet of one: +2 AC the DM adds with set_effect while it holds.",
  },
  "artificer::Battle Ready": {
    subclass: "Battle Smith",
    effects: [{ kind: "weapon_ability", ability: "int", magicOnly: true }],
  },
};
