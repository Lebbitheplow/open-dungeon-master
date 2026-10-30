# SRD 5.1 text audit (issue #570)

An audit that started from the rules text itself rather than from the
engine: the whole SRD 5.1 as the app bundles it
(`src/lib/rulebook/srd-5.1.json`), read page by page and heading by heading,
each rule held up against what the engine does. It came after two audits
that started from the engine's own reading of the rules and ended at "0
open gaps"; reading the text found 110 more.

- **The inventory**: `scripts/fixtures/srd-text-audit.json`, one row per
  page and per heading of every rules, class and race page (1,811 rows):
  held (with the code or suite that holds it), a finding, narrated (with the
  reason it is left to the GM), or not mechanical.
  `scripts/test-srd-text-audit.mjs` keeps it whole: a rebuilt rulebook with
  a page or heading nobody has read fails it.
- **The findings**: each was written as a failing `gap()` before anything
  was fixed, in `scripts/test-enforce-srd-<slice>.mjs`, quoting the SRD
  sentence it breaks. A fix turns its gap into a `test()`.

| Slice | Pages | Suite | Findings |
| --- | --- | --- | --- |
| Combat and conditions | combat, conditions | `test-enforce-srd-combat.mjs` | 15 (CMB) |
| Ability scores and adventuring | using-ability-scores, adventuring, beyond-1st-level, multiclassing, feats, inspiration, backgrounds | `test-enforce-srd-adventuring.mjs` | 11 (ADV) |
| Equipment and hazards | the equipment pages, traps, diseases, madness, objects, poisons | `test-enforce-srd-equipment.mjs` | 26 (EQP) |
| Spellcasting and spells | spellcasting, spell-lists, the 319 spells | `test-enforce-srd-spells.mjs` | 10 (SPL) |
| Classes and races | the 12 classes, the 10 race pages | `test-enforce-srd-classes.mjs` | 27 (CLS) |
| Stat blocks | the monster rules and 318 creatures | `test-enforce-srd-bestiary.mjs` | 12 (MON) |
| Magic items | the item rules and 239 items | `test-enforce-srd-magic-items.mjs` | 9 (ITM) |

The pages no slice took (alignment, languages, the pantheons, the planes,
the legal page) have rows too: the language tables are the engine's; the
rest is not mechanical.

## Findings

- **CMB-01** (low): crawling through difficult terrain costs 4 feet a foot, not 3
- **CMB-02** (low): a flying creature knocked prone stays aloft
- **CMB-03** (low): Dodge still works against an attacker the dodger cannot see
- **CMB-04** (low): an invisible creature is refused the Hide action in the open
- **CMB-05** (medium): grappling or shoving an incapacitated creature is contested
- **CMB-06** (medium): cover adds nothing to Dexterity saving throws
- **CMB-07** (medium): an enemy cannot knock a character out
- **CMB-08** (low): a rider whose mount is knocked prone rolls a save instead of using the reaction
- **CMB-09** (low): mounting and dismounting both fit in one move
- **CMB-10** (low): a controlled mount has no action of its own
- **CMB-11** (low): identical creatures each roll their own initiative
- **CMB-12** (low): the charmer has no advantage on social checks against the charmed creature
- **CMB-13** (medium): frightened imposes disadvantage with its source out of sight
- **CMB-14** (low): a petrified creature is not immune to poison
- **CMB-15** (medium): being raised from the dead leaves exhaustion untouched
- **ADV-01** (medium): a 1st-level paladin or ranger counts as a second Spellcasting class
- **ADV-02** (medium): under Variant: Encumbrance the armor table's Strength column still slows
- **ADV-03** (medium): initiative misses the Dexterity-check disadvantage of untrained armor and heavy encumbrance
- **ADV-04** (medium): two disadvantages on a passive check count as -10
- **ADV-05** (low): Halfling Lucky at disadvantage rerolls both 1s
- **ADV-06** (medium): a rolled Perception check by sight ignores the darkness the engine knows
- **ADV-07** (low): Grappler's pin is not an action
- **ADV-08** (low): Grappler works with Strength below 13
- **ADV-09** (low): Help on a tool check from a helper without the tool
- **ADV-10** (low): Inspiration cannot be passed to another character
- **ADV-11** (low): a day's travel is the hour column times 8, not the Day column
- **EQP-01** (medium): Object hit points are not the SRD's table
- **EQP-02** (low): The foci are priced and weighed as one row each
- **EQP-03** (medium): A lamp gives no light
- **EQP-04** (low): Two SRD sample traps are missing
- **EQP-05** (low): Doffing armor with help is not halved
- **EQP-06** (high): Acid is thrown as a 1d4 bludgeoning improvised weapon
- **EQP-07** (high): Alchemist's fire does not burn
- **EQP-08** (medium): Holy water hurts anything, with bludgeoning
- **EQP-09** (low): Oil leaves nothing on its target
- **EQP-10** (low): A torch hits with bludgeoning, not fire
- **EQP-11** (low): A real weapon cannot be used as an improvised one
- **EQP-12** (medium): A net does not end the Attack action
- **EQP-13** (medium): Caltrops and ball bearings place nothing
- **EQP-14** (low): Cackle fever's laughter does not spread
- **EQP-15** (medium): Crawler mucus paralyzes for two minutes, and its poison outlasts the save
- **EQP-16** (medium): Antitoxin does nothing
- **EQP-17** (medium): Pale tincture's damage heals
- **EQP-18** (low): A gnome catches cackle fever
- **EQP-19** (low): Fear is no stress for cackle fever
- **EQP-20** (medium): Poison darts fire one dart per victim
- **EQP-21** (low): Anyone can craft a potion of healing
- **EQP-22** (medium): Using a healer's kit throws away all ten uses
- **EQP-23** (low): Durable gear is deleted when used
- **EQP-24** (low): A griffon is ridden without an exotic saddle
- **EQP-25** (medium): Trade goods sell at half
- **EQP-26** (low): A block and tackle lifts nothing more
- **SPL-01** (high): with the content pack a Self spell's cone, line or radius is lost, and cast_at_enemy reaches any distance
- **SPL-02** (medium): five area spells resolve as single-creature castings
- **SPL-03** (medium): "one additional creature for each slot level above" is not held for Heroism, Longstrider and Invisibility
- **SPL-04** (medium): Wall of Thorns rolls the caller's dice
- **SPL-05** (medium): a Contagion hit lays nothing
- **SPL-06** (low): a condition's own printed lifetime is replaced by the spell's
- **SPL-07** (low): Prismatic Wall's approach save carries the red layer's damage
- **SPL-08** (low): three schools differ from the rulebook
- **SPL-09** (low): Plane Shift is off the druid list
- **SPL-10** (low): a spell of a minute or more cannot be cast during a fight at all
- **CLS-01** (medium): Action Surge twice on the same turn
- **CLS-02** (high): a turned undead stays turned after taking damage
- **CLS-03** (medium): a turned undead still attacks
- **CLS-04** (medium): a turned undead keeps its reactions
- **CLS-05** (low): two Bardic Inspiration dice held at once
- **CLS-06** (medium): a dying paladin adds their own aura to death saves
- **CLS-07** (medium): Sacred Weapon does not make the weapon magical
- **CLS-08** (low): Step of the Wind does not double the jump
- **CLS-09** (low): Remarkable Athlete's longer running jump
- **CLS-10** (low): Second-Story Work's longer running jump
- **CLS-11** (medium): Metamagic options are bought at any price, learned or not
- **CLS-12** (high): Thirsting Blade gives no second attack
- **CLS-13** (medium): Lifedrinker adds nothing
- **CLS-14** (medium): the pact weapon is not magical
- **CLS-15** (medium): Beguiling Influence grants no skills
- **CLS-16** (low): Eldritch Spear does not lengthen Eldritch Blast
- **CLS-17** (medium): at-will invocation spells cannot be cast
- **CLS-18** (medium): once-a-rest invocation spells cannot be cast
- **CLS-19** (medium): the Book of Shadows' cantrips are refused
- **CLS-20** (medium): Pact of the Chain's find familiar is refused
- **CLS-21** (high): Magical Secrets spells are refused
- **CLS-22** (medium): Additional Magical Secrets are refused
- **CLS-23** (medium): a tiefling's Infernal Legacy cannot be cast
- **CLS-24** (medium): a high elf's racial cantrip uses the class's ability
- **CLS-25** (low): Repelling Blast pushes nothing
- **CLS-26** (low): One with Shadows cannot be used
- **CLS-27** (low): Archdruid still needs a focus
- **MON-01** (high): enemies fight with the pack's misprinted AC, HP, CR, XP, saves and attack numbers
- **MON-02** (high): damage and condition defences read wrong for the wight, ice devil and mummy lord
- **MON-03** (medium): speeds and special senses from misprinted rows
- **MON-04** (medium): skills and passive Perception the pack row drops or misprints
- **MON-05** (low): the rug of smothering's Smother deals its damage on the hit
- **MON-06** (medium): a lone green hag or night hag casts its coven's spells
- **MON-07** (medium): on-hit saves the enemy reader drops with no note
- **MON-08** (medium): Multiattack read as N copies of the asked attack
- **MON-09** (low): CR 0 creatures with no attack award 10 XP
- **MON-10** (medium): without the content pack an SRD creature fights with synthesized stats
- **MON-11** (medium): the creature table loses Multiattack for 34 SRD creatures
- **MON-12** (low): the creature table drops ranged spell attacks printed with one range
- **ITM-01** (medium): six staffs roll no d20 on their last charge
- **ITM-02** (medium): spells cast from an item that use_item does not know
- **ITM-03** (medium): bonuses to spell attack rolls and spell save DC are not added
- **ITM-04** (medium): advantage on saving throws against spells from a worn item
- **ITM-05** (high): the Periapt of Proof against Poison does nothing
- **ITM-06** (medium): an item's flying, swimming or climbing speed is not the wearer's
- **ITM-07** (medium): "your score increases by 2, to a maximum of 20" is not applied
- **ITM-08** (low): single-use items that use_item refuses as kept
- **ITM-09** (medium): Bracers of Archery give neither the proficiency nor the +2 damage
