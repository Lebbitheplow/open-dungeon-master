# D&D rules audit inventory — 2026-10-09

Audited commit: **9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6**. Companion to the [findings report](dnd-rules-audit-2026-10-09.md).

This inventories the complete bundled SRD entry set and the authored subclass classifier. Each lookup/field is a data-availability signal, **not a claim of full enforcement**. Rules-page, class and race inclusion is checked against the bundled reader. Spell lookups were run with the installed pack and without it; totals and per-title resolution/fact availability agree. Item lookups use the narrow magic-item table plus item-spell mappings. Monster catalog matches below are direct SRD name/slug matches; aliases and grouped/template pages require separate interpretation.

Source methods: [bundled reader](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/rulebook/srd-5.1.json), [casting fact / general mechanic lookups](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/content/index.ts), [dedicated summon table](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/summon-spells.ts), [dedicated zone table](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/battlemap/zones-spells.ts), [magic-item lookup](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/magic-items.ts), [item-spell mapping](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/item-spells.ts), [feature classifier](https://github.com/Lebbitheplow/open-dungeon-master/blob/9af14897e6552ec87a7c92ca1c80fd7d60ea8fa6/src/lib/srd/authored-coverage.ts).

## All 36 rules pages

| Page | Chapter | Representation |
| --- | --- | --- |
| Racial Traits (`racial-traits`) | races | Included; domain review in main report |
| Beyond 1st Level (`beyond-1st-level`) | beyond-1st-level | Included; domain review in main report |
| Multiclassing (`multiclassing`) | beyond-1st-level | Included; domain review in main report |
| Alignment (`alignment`) | personality | Included; domain review in main report |
| Languages (`languages`) | personality | Included; domain review in main report |
| Inspiration (`inspiration`) | personality | Included; domain review in main report |
| Backgrounds (`backgrounds`) | personality | Included; domain review in main report |
| Coinage (`coinage`) | equipment | Included; domain review in main report |
| Selling Treasure (`selling-treasure`) | equipment | Included; domain review in main report |
| Armor (`armor`) | equipment | Included; domain review in main report |
| Weapons (`weapons`) | equipment | Included; domain review in main report |
| Adventuring Gear (`adventuring-gear`) | equipment | Included; domain review in main report |
| Tools (`tools`) | equipment | Included; domain review in main report |
| Mounts and Vehicles (`mounts-and-vehicles`) | equipment | Included; domain review in main report |
| Trade Goods (`trade-goods`) | equipment | Included; domain review in main report |
| Expenses (`expenses`) | equipment | Included; domain review in main report |
| Feats (`feats`) | feats | Included; domain review in main report |
| Using Ability Scores (`using-ability-scores`) | ability-scores | Included; domain review in main report |
| Adventuring (`adventuring`) | adventuring | Included; domain review in main report |
| Combat (`combat`) | combat | Included; domain review in main report |
| Spellcasting (`spellcasting`) | spellcasting | Included; domain review in main report |
| Spell Lists (`spell-lists`) | spellcasting | Included; domain review in main report |
| Traps (`traps`) | running-the-game | Included; domain review in main report |
| Diseases (`diseases`) | running-the-game | Included; domain review in main report |
| Madness (`madness`) | running-the-game | Included; domain review in main report |
| Objects (`objects`) | running-the-game | Included; domain review in main report |
| Poisons (`poisons`) | running-the-game | Included; domain review in main report |
| Magic Items (`magic-items`) | magic-items | Included; domain review in main report |
| Sentient Magic Items (`sentient-magic-items`) | magic-items | Included; domain review in main report |
| Artifacts (`artifacts`) | magic-items | Included; domain review in main report |
| Monster Statistics (`monster-statistics`) | monsters | Included; domain review in main report |
| Nonplayer Characters (`nonplayer-characters`) | npcs | Included; domain review in main report |
| Conditions (`conditions`) | appendix | Included; domain review in main report |
| Gods of the Multiverse (`gods-of-the-multiverse`) | appendix | Included; domain review in main report |
| The Planes of Existence (`the-planes-of-existence`) | appendix | Included; domain review in main report |
| Legal Information (`legal-information`) | appendix | Included; domain review in main report |

## All 12 SRD class pages and nine race pages

| Kind | Entry | Representation |
| --- | --- | --- |
| class | Barbarian | Included; full feature/interaction certification not claimed |
| class | Bard | Included; full feature/interaction certification not claimed |
| class | Cleric | Included; full feature/interaction certification not claimed |
| class | Druid | Included; full feature/interaction certification not claimed |
| class | Fighter | Included; full feature/interaction certification not claimed |
| class | Monk | Included; full feature/interaction certification not claimed |
| class | Paladin | Included; full feature/interaction certification not claimed |
| class | Ranger | Included; full feature/interaction certification not claimed |
| class | Rogue | Included; full feature/interaction certification not claimed |
| class | Sorcerer | Included; full feature/interaction certification not claimed |
| class | Warlock | Included; full feature/interaction certification not claimed |
| class | Wizard | Included; full feature/interaction certification not claimed |
| race | Dwarf | Included; full feature/interaction certification not claimed |
| race | Elf | Included; full feature/interaction certification not claimed |
| race | Halfling | Included; full feature/interaction certification not claimed |
| race | Human | Included; full feature/interaction certification not claimed |
| race | Dragonborn | Included; full feature/interaction certification not claimed |
| race | Gnome | Included; full feature/interaction certification not claimed |
| race | Half-Elf | Included; full feature/interaction certification not claimed |
| race | Half-Orc | Included; full feature/interaction certification not claimed |
| race | Tiefling | Included; full feature/interaction certification not claimed |

## All 319 SRD spells

`none` means no general `spellMechanicsFor` block; dedicated engines can still exist. `utility` is itself a general block category. A zone/summon table entry identifies a dedicated metadata path, not all required behavior. Other dedicated engines (familiar, cure, revival, shape, light, etc.) are not exhaustively labeled here. Every row has casting facts in both modes.

| Spell | General resolution | Condition / buff field | Zone table | Summon table |
| --- | --- | --- | --- | --- |
| Acid Splash | save | — | — | — |
| Chill Touch | attack | — | — | — |
| Dancing Lights | none | — | — | — |
| Druidcraft | none | — | — | — |
| Eldritch Blast | attack | — | — | — |
| Fire Bolt | attack | — | — | — |
| Guidance | buff | guidance | — | — |
| Light | utility | — | — | — |
| Mage Hand | none | — | — | — |
| Mending | none | — | — | — |
| Message | none | — | — | — |
| Minor Illusion | none | — | — | — |
| Poison Spray | save | — | — | — |
| Prestidigitation | none | — | — | — |
| Produce Flame | attack | — | — | — |
| Ray of Frost | attack | — | — | — |
| Resistance | buff | resistance (spell) | — | — |
| Sacred Flame | save | — | — | — |
| Shillelagh | buff | shillelagh | — | — |
| Shocking Grasp | attack | — | — | — |
| Spare the Dying | none | — | — | — |
| Thaumaturgy | none | — | — | — |
| True Strike | buff | true strike | — | — |
| Vicious Mockery | save | mocked | — | — |
| Alarm | none | — | — | — |
| Animal Friendship | save | charmed | — | — |
| Bane | save | baned | — | — |
| Bless | buff | blessed | — | — |
| Burning Hands | save | — | — | — |
| Charm Person | save | charmed | — | — |
| Color Spray | auto | — | — | — |
| Command | save | commanded | — | — |
| Comprehend Languages | none | — | — | — |
| Create or Destroy Water | none | — | — | — |
| Cure Wounds | heal | — | — | — |
| Detect Evil and Good | none | — | — | — |
| Detect Magic | none | — | — | — |
| Detect Poison and Disease | none | — | — | — |
| Disguise Self | none | — | — | — |
| Divine Favor | buff | divine favor | — | — |
| Entangle | save | restrained | yes | — |
| Expeditious Retreat | buff | expeditious retreat | — | — |
| Faerie Fire | save | faerie fire | — | — |
| False Life | buff | false life | — | — |
| Feather Fall | buff | feather fall | — | — |
| Find Familiar | none | — | — | — |
| Floating Disk | none | — | — | — |
| Fog Cloud | none | — | yes | — |
| Goodberry | none | — | — | — |
| Grease | save | prone | yes | — |
| Guiding Bolt | attack | — | — | — |
| Healing Word | heal | — | — | — |
| Hellish Rebuke | save | — | — | — |
| Heroism | buff | heroism | — | — |
| Hideous Laughter | save | incapacitated | — | — |
| Hunter's Mark | buff | hunter's mark | — | — |
| Identify | none | — | — | — |
| Illusory Script | none | — | — | — |
| Inflict Wounds | attack | — | — | — |
| Jump | buff | jumping | — | — |
| Longstrider | buff | longstrider | — | — |
| Mage Armor | buff | mage armor | — | — |
| Magic Missile | auto | — | — | — |
| Protection from Evil and Good | buff | protected from evil and good | — | — |
| Purify Food and Drink | none | — | — | — |
| Sanctuary | buff | sanctuary | — | — |
| Shield | none | — | — | — |
| Shield of Faith | buff | shield of faith | — | — |
| Silent Image | none | — | — | — |
| Sleep | auto | — | — | — |
| Speak with Animals | none | — | — | — |
| Thunderwave | save | — | — | — |
| Unseen Servant | none | — | — | yes |
| Acid Arrow | attack | — | — | — |
| Aid | buff | aided | — | — |
| Alter Self | utility | — | — | — |
| Animal Messenger | none | — | — | — |
| Arcane Lock | none | — | — | — |
| Arcanist's Magic Aura | none | — | — | — |
| Augury | none | — | — | — |
| Barkskin | buff | barkskin | — | — |
| Blindness/Deafness | save | blinded | — | — |
| Blur | buff | blurred | — | — |
| Branding Smite | buff | branding smite | — | — |
| Calm Emotions | save | calmed | — | — |
| Continual Flame | none | — | — | — |
| Darkness | none | — | yes | — |
| Darkvision | none | — | — | — |
| Detect Thoughts | utility | — | — | — |
| Enhance Ability | buff | enhance ability (bear's endurance) | — | — |
| Enlarge/Reduce | buff | enlarged | — | — |
| Enthrall | save | — | — | — |
| Find Steed | none | — | — | yes |
| Find Traps | none | — | — | — |
| Flame Blade | buff | flame blade | — | — |
| Flaming Sphere | save | — | — | — |
| Gentle Repose | none | — | — | — |
| Gust of Wind | save | — | yes | — |
| Heat Metal | auto | — | — | — |
| Hold Person | save | paralyzed | — | — |
| Invisibility | buff | invisible | — | — |
| Knock | none | — | — | — |
| Lesser Restoration | buff | — | — | — |
| Levitate | save | levitating | — | — |
| Locate Animals or Plants | none | — | — | — |
| Locate Object | none | — | — | — |
| Magic Mouth | none | — | — | — |
| Magic Weapon | buff | magic weapon +1 | — | — |
| Mirror Image | buff | mirror image | — | — |
| Misty Step | none | — | — | — |
| Moonbeam | save | — | yes | — |
| Pass without Trace | buff | pass without trace | — | — |
| Prayer of Healing | heal | — | — | — |
| Protection from Poison | buff | protected from poison | — | — |
| Ray of Enfeeblement | attack | — | — | — |
| Rope Trick | none | — | — | — |
| Scorching Ray | attack | — | — | — |
| See Invisibility | buff | see invisibility | — | — |
| Shatter | save | — | — | — |
| Silence | none | — | yes | — |
| Spider Climb | buff | spider climb | — | — |
| Spike Growth | utility | — | yes | — |
| Spiritual Weapon | buff | spiritual weapon | — | — |
| Suggestion | save | suggested | — | — |
| Warding Bond | buff | warding bond | — | — |
| Web | save | restrained | yes | — |
| Zone of Truth | utility | — | — | — |
| Animate Dead | none | — | — | yes |
| Beacon of Hope | buff | beacon of hope | — | — |
| Bestow Curse | save | cursed (str) | — | — |
| Blink | buff | blink | — | — |
| Call Lightning | save | — | — | — |
| Clairvoyance | none | — | — | — |
| Conjure Animals | none | — | — | yes |
| Counterspell | none | — | — | — |
| Create Food and Water | none | — | — | — |
| Daylight | none | — | yes | — |
| Dispel Magic | utility | — | — | — |
| Fear | save | frightened | — | — |
| Fireball | save | — | — | — |
| Fly | buff | flying | — | — |
| Gaseous Form | buff | gaseous form | — | — |
| Glyph of Warding | utility | — | — | — |
| Haste | buff | hasted | — | — |
| Hypnotic Pattern | save | charmed | — | — |
| Lightning Bolt | save | — | — | — |
| Magic Circle | utility | — | — | — |
| Major Image | none | — | — | — |
| Mass Healing Word | heal | — | — | — |
| Meld into Stone | utility | — | — | — |
| Nondetection | none | — | — | — |
| Phantom Steed | none | — | — | yes |
| Plant Growth | none | — | yes | — |
| Protection from Energy | buff | protection from energy (fire) | — | — |
| Remove Curse | buff | — | — | — |
| Revivify | heal | — | — | — |
| Sending | none | — | — | — |
| Sleet Storm | save | prone | yes | — |
| Slow | save | slowed | — | — |
| Speak with Dead | none | — | — | — |
| Speak with Plants | none | — | — | — |
| Spirit Guardians | buff | spirit guardians | yes | — |
| Stinking Cloud | save | — | yes | — |
| Tiny Hut | none | — | — | — |
| Tongues | none | — | — | — |
| Vampiric Touch | attack | — | — | — |
| Water Breathing | none | — | — | — |
| Water Walk | buff | water walk | — | — |
| Wind Wall | save | — | yes | — |
| Arcane Eye | none | — | — | — |
| Banishment | save | banished | — | — |
| Black Tentacles | save | restrained | yes | — |
| Blight | save | — | — | — |
| Compulsion | save | — | — | — |
| Confusion | save | confused | — | — |
| Conjure Minor Elementals | none | — | — | yes |
| Conjure Woodland Beings | none | — | — | yes |
| Control Water | save | — | — | — |
| Death Ward | buff | death ward | — | — |
| Dimension Door | utility | — | — | — |
| Divination | none | — | — | — |
| Dominate Beast | save | charmed | — | — |
| Fabricate | none | — | — | — |
| Faithful Hound | utility | — | — | yes |
| Fire Shield | buff | fire shield (cold) | — | — |
| Freedom of Movement | buff | freedom of movement | — | — |
| Giant Insect | none | — | — | yes |
| Greater Invisibility | buff | invisible | — | — |
| Guardian of Faith | save | — | yes | — |
| Hallucinatory Terrain | none | — | — | — |
| Ice Storm | save | — | yes | — |
| Locate Creature | none | — | — | — |
| Phantasmal Killer | save | frightened | — | — |
| Polymorph | buff | polymorphed | — | — |
| Private Sanctum | none | — | — | — |
| Resilient Sphere | save | enclosed | — | — |
| Secret Chest | none | — | — | — |
| Stone Shape | none | — | — | — |
| Stoneskin | buff | stoneskin | — | — |
| Wall of Fire | save | — | yes | — |
| Animate Objects | summon | — | — | yes |
| Antilife Shell | utility | — | yes | — |
| Arcane Hand | attack | — | — | yes |
| Awaken | none | — | — | — |
| Cloudkill | save | — | yes | — |
| Commune | none | — | — | — |
| Commune with Nature | none | — | — | — |
| Cone of Cold | save | — | — | — |
| Conjure Elemental | none | — | — | yes |
| Contact Other Plane | utility | — | — | — |
| Contagion | attack | — | — | — |
| Creation | none | — | — | — |
| Dispel Evil and Good | buff | dispel evil and good | — | — |
| Dominate Person | save | charmed | — | — |
| Dream | utility | — | — | — |
| Flame Strike | save | — | — | — |
| Geas | save | charmed | — | — |
| Greater Restoration | buff | — | — | — |
| Hallow | utility | — | — | — |
| Hold Monster | save | paralyzed | — | — |
| Insect Plague | save | — | yes | — |
| Legend Lore | none | — | — | — |
| Mass Cure Wounds | heal | — | — | — |
| Mislead | buff | invisible | — | — |
| Modify Memory | save | charmed | — | — |
| Passwall | none | — | yes | — |
| Planar Binding | utility | — | — | — |
| Raise Dead | heal | — | — | — |
| Reincarnate | none | — | — | — |
| Scrying | utility | — | — | — |
| Seeming | utility | — | — | — |
| Telekinesis | none | — | — | — |
| Telepathic Bond | none | — | — | — |
| Teleportation Circle | none | — | — | — |
| Tree Stride | none | — | — | — |
| Wall of Force | none | — | yes | — |
| Wall of Stone | utility | — | yes | — |
| Blade Barrier | save | — | yes | — |
| Chain Lightning | save | — | — | — |
| Circle of Death | save | — | — | — |
| Conjure Fey | none | — | — | yes |
| Contingency | none | — | — | — |
| Create Undead | none | — | — | yes |
| Disintegrate | save | — | — | — |
| Eyebite | save | unconscious | — | — |
| Find the Path | none | — | — | — |
| Flesh to Stone | save | restrained | — | — |
| Forbiddance | utility | — | — | — |
| Freezing Sphere | save | — | — | — |
| Globe of Invulnerability | none | — | yes | — |
| Guards and Wards | none | — | — | — |
| Harm | save | — | — | — |
| Heal | heal | — | — | — |
| Heroes' Feast | buff | heroes' feast | — | — |
| Instant Summons | none | — | — | — |
| Irresistible Dance | save | dancing | — | — |
| Magic Jar | utility | — | — | — |
| Mass Suggestion | save | suggested | — | — |
| Move Earth | none | — | — | — |
| Planar Ally | none | — | — | — |
| Programmed Illusion | none | — | — | — |
| Sunbeam | save | blinded | — | — |
| Transport via Plants | none | — | — | — |
| True Seeing | buff | true seeing | — | — |
| Wall of Ice | save | — | yes | — |
| Wall of Thorns | save | — | yes | — |
| Wind Walk | buff | wind walk | — | — |
| Word of Recall | none | — | — | — |
| Arcane Sword | attack | — | — | — |
| Conjure Celestial | none | — | — | yes |
| Delayed Blast Fireball | save | — | — | — |
| Divine Word | save | — | — | — |
| Etherealness | buff | ethereal | — | — |
| Finger of Death | save | — | — | — |
| Fire Storm | save | — | — | — |
| Forcecage | utility | — | yes | — |
| Magnificent Mansion | none | — | — | — |
| Mirage Arcane | none | — | — | — |
| Plane Shift | attack | — | — | — |
| Prismatic Spray | save | — | — | — |
| Project Image | none | — | — | — |
| Regenerate | heal | — | — | — |
| Resurrection | heal | — | — | — |
| Reverse Gravity | save | — | — | — |
| Sequester | none | — | — | — |
| Simulacrum | none | — | — | — |
| Symbol | save | — | — | — |
| Teleport | utility | — | — | — |
| Animal Shapes | buff | polymorphed | — | — |
| Antimagic Field | utility | — | yes | — |
| Antipathy/Sympathy | save | frightened | — | — |
| Clone | none | — | — | — |
| Control Weather | none | — | — | — |
| Demiplane | none | — | — | — |
| Dominate Monster | save | charmed | — | — |
| Earthquake | save | prone | yes | — |
| Feeblemind | save | feebleminded | — | — |
| Glibness | none | — | — | — |
| Holy Aura | buff | holy aura | — | — |
| Incendiary Cloud | save | — | yes | — |
| Maze | save | mazed | — | — |
| Mind Blank | buff | mind blank | — | — |
| Power Word Stun | save | stunned | — | — |
| Sunburst | save | blinded | — | — |
| Astral Projection | none | — | — | — |
| Foresight | buff | foresight | — | — |
| Gate | none | — | — | — |
| Imprisonment | save | imprisoned | — | — |
| Mass Heal | heal | — | — | — |
| Meteor Swarm | save | — | — | — |
| Power Word Kill | auto | — | — | — |
| Prismatic Wall | save | blinded | — | — |
| Shapechange | buff | polymorphed | — | — |
| Storm of Vengeance | save | deafened | — | — |
| Time Stop | none | — | — | — |
| True Polymorph | save | — | — | — |
| True Resurrection | heal | — | — | — |
| Weird | save | frightened | — | — |
| Wish | utility | — | — | — |

## All 239 SRD item entries

`no table match` is not a missing catalog item. Special-case consumable, curse, potion, scroll and narrator behavior may exist outside this lookup. `Attune` is the matched table definition, not an independent correctness check. Grouped bonus families have different names from individual table rows.

| Item | Table match | Attune | Structured fields / item-spell mappings observed |
| --- | --- | --- | --- |
| Adamantine Armor | yes | no | armor |
| Ammunition, +1, +2, or +3 | — | — | no table match |
| Amulet of Health | yes | yes | set_ability |
| Amulet of Proof Against Detection and Location | — | — | no table match |
| Amulet of the Planes | — | — | no table match |
| Animated Shield | yes | yes | armor |
| Apparatus of the Crab | — | — | no table match |
| Armor of Invulnerability | yes | yes | resistance; armor; charges |
| Armor of Resistance | yes | yes | armor |
| Armor of Vulnerability | yes | yes | armor; cursed |
| Armor, +1, +2, or +3 | — | — | no table match |
| Arrow of Slaying | — | — | no table match |
| Arrow-Catching Shield | yes | yes | armor |
| Bag of Beans | — | — | no table match |
| Bag of Devouring | — | — | no table match |
| Bag of Holding | — | — | no table match |
| Bag of Tricks | — | — | no table match |
| Bead of Force | — | — | no table match |
| Belt of Dwarvenkind | yes | yes | resistance |
| Belt of Giant Strength | — | — | no table match |
| Berserker Axe | yes | yes | weapon; cursed |
| Boots of Elvenkind | — | — | no table match |
| Boots of Levitation | — | — | no table match |
| Boots of Speed | — | — | no table match |
| Boots of Striding and Springing | — | — | no table match |
| Boots of the Winterlands | yes | yes | resistance |
| Bowl of Commanding Water Elementals | — | — | no table match |
| Bracers of Archery | — | — | no table match |
| Bracers of Defense | yes | yes | ac_unarmored |
| Brazier of Commanding Fire Elementals | — | — | no table match |
| Brooch of Shielding | yes | yes | resistance |
| Broom of Flying | — | — | no table match |
| Candle of Invocation | — | — | no table match |
| Cape of the Mountebank | — | — | no table match |
| Carpet of Flying | — | — | no table match |
| Censer of Controlling Air Elementals | — | — | no table match |
| Chime of Opening | — | — | no table match |
| Circlet of Blasting | — | — | no table match |
| Cloak of Arachnida | yes | yes | resistance |
| Cloak of Displacement | — | — | no table match |
| Cloak of Elvenkind | — | — | no table match |
| Cloak of Protection | yes | yes | ac_bonus; save_bonus |
| Cloak of the Bat | — | — | no table match |
| Cloak of the Manta Ray | — | — | no table match |
| Crystal Ball | — | — | no table match |
| Cube of Force | yes | yes | charges |
| Cubic Gate | yes | no | charges |
| Dagger of Venom | yes | no | weapon; charges |
| Dancing Sword | yes | yes | weapon |
| Decanter of Endless Water | — | — | no table match |
| Deck of Illusions | — | — | no table match |
| Deck of Many Things | — | — | no table match |
| Defender | yes | yes | weapon |
| Demon Armor | yes | yes | armor; cursed |
| Dimensional Shackles | — | — | no table match |
| Dragon Scale Mail | yes | yes | armor; charges |
| Dragon Slayer | yes | no | weapon |
| Dust of Disappearance | — | — | no table match |
| Dust of Dryness | — | — | no table match |
| Dust of Sneezing and Choking | — | — | no table match |
| Dwarven Plate | yes | no | armor |
| Dwarven Thrower | yes | yes | weapon |
| Efficient Quiver | — | — | no table match |
| Efreeti Bottle | — | — | no table match |
| Elemental Gem | — | — | no table match |
| Elven Chain | yes | no | armor |
| Eversmoking Bottle | — | — | no table match |
| Eyes of Charming | yes | yes | charges |
| Eyes of Minute Seeing | — | — | no table match |
| Eyes of the Eagle | — | — | no table match |
| Feather Token | — | — | no table match |
| Figurine of Wondrous Power | yes | no | charges |
| Flame Tongue | yes | yes | weapon |
| Folding Boat | — | — | no table match |
| Frost Brand | yes | yes | resistance; weapon |
| Gauntlets of Ogre Power | yes | yes | set_ability |
| Gem of Brightness | yes | no | charges |
| Gem of Seeing | yes | yes | charges |
| Giant Slayer | yes | no | weapon |
| Glamoured Studded Leather | yes | no | armor |
| Gloves of Missile Snaring | — | — | no table match |
| Gloves of Swimming and Climbing | — | — | no table match |
| Goggles of Night | — | — | no table match |
| Hammer of Thunderbolts | yes | no | weapon; charges |
| Handy Haversack | — | — | no table match |
| Hat of Disguise | — | — | no table match |
| Headband of Intellect | yes | yes | set_ability |
| Helm of Brilliance | yes | yes | resistance |
| Helm of Comprehending Languages | — | — | no table match |
| Helm of Telepathy | — | — | no table match |
| Helm of Teleportation | yes | yes | charges |
| Holy Avenger | yes | yes | weapon |
| Horn of Blasting | — | — | no table match |
| Horn of Valhalla | — | — | no table match |
| Horseshoes of a Zephyr | — | — | no table match |
| Horseshoes of Speed | — | — | no table match |
| Immovable Rod | — | — | no table match |
| Instant Fortress | — | — | no table match |
| Ioun Stone | — | — | no table match |
| Iron Bands of Binding | — | — | no table match |
| Iron Flask | — | — | no table match |
| Javelin of Lightning | yes | no | weapon; charges |
| Lantern of Revealing | — | — | no table match |
| Luck Blade | yes | yes | save_bonus; weapon; charges; carried |
| Mace of Disruption | yes | yes | weapon |
| Mace of Smiting | yes | no | weapon |
| Mace of Terror | yes | yes | weapon; charges |
| Mantle of Spell Resistance | — | — | no table match |
| Manual of Bodily Health | — | — | no table match |
| Manual of Gainful Exercise | — | — | no table match |
| Manual of Golems | — | — | no table match |
| Manual of Quickness of Action | — | — | no table match |
| Marvelous Pigments | — | — | no table match |
| Medallion of Thoughts | yes | yes | charges |
| Mirror of Life Trapping | — | — | no table match |
| Mithral Armor | yes | no | armor |
| Necklace of Adaptation | — | — | no table match |
| Necklace of Fireballs | — | — | no table match |
| Necklace of Prayer Beads | yes | yes | no structured fields in this lookup |
| Nine Lives Stealer | yes | yes | weapon; charges |
| Oathbow | yes | yes | weapon |
| Oil of Etherealness | — | — | no table match |
| Oil of Sharpness | — | — | no table match |
| Oil of Slipperiness | — | — | no table match |
| Pearl of Power | yes | yes | no structured fields in this lookup |
| Periapt of Health | — | — | no table match |
| Periapt of Proof against Poison | — | — | no table match |
| Periapt of Wound Closure | — | — | no table match |
| Philter of Love | — | — | no table match |
| Pipes of Haunting | yes | no | charges |
| Pipes of the Sewers | yes | yes | charges |
| Plate Armor of Etherealness | yes | yes | armor; charges |
| Portable Hole | — | — | no table match |
| Potion of Animal Friendship | — | — | no table match |
| Potion of Clairvoyance | — | — | no table match |
| Potion of Climbing | — | — | no table match |
| Potion of Diminution | — | — | no table match |
| Potion of Flying | — | — | no table match |
| Potion of Gaseous Form | — | — | no table match |
| Potion of Giant Strength | — | — | no table match |
| Potion of Growth | — | — | no table match |
| Potion of Healing | — | — | no table match |
| Potion of Heroism | — | — | no table match |
| Potion of Invisibility | — | — | no table match |
| Potion of Mind Reading | — | — | no table match |
| Potion of Poison | — | — | no table match |
| Potion of Resistance | — | — | no table match |
| Potion of Speed | — | — | no table match |
| Potion of Water Breathing | — | — | no table match |
| Restorative Ointment | — | — | no table match |
| Ring of Animal Influence | yes | no | charges; spells: Animal Friendship, Fear, Speak with Animals |
| Ring of Djinni Summoning | — | — | no table match |
| Ring of Elemental Command | yes | yes | charges |
| Ring of Evasion | yes | yes | charges |
| Ring of Feather Falling | — | — | no table match |
| Ring of Free Action | — | — | no table match |
| Ring of Invisibility | — | — | no table match |
| Ring of Jumping | — | — | no table match |
| Ring of Mind Shielding | — | — | no table match |
| Ring of Protection | yes | yes | ac_bonus; save_bonus |
| Ring of Regeneration | — | — | no table match |
| Ring of Resistance | — | — | no table match |
| Ring of Shooting Stars | yes | yes | charges; spells: Faerie Fire |
| Ring of Spell Storing | — | — | no table match |
| Ring of Spell Turning | — | — | no table match |
| Ring of Swimming | — | — | no table match |
| Ring of Telekinesis | — | — | no table match |
| Ring of the Ram | yes | yes | charges |
| Ring of Three Wishes | yes | no | charges |
| Ring of Warmth | yes | yes | resistance |
| Ring of Water Walking | — | — | no table match |
| Ring of X-ray Vision | — | — | no table match |
| Robe of Eyes | — | — | no table match |
| Robe of Scintillating Colors | yes | yes | charges |
| Robe of Stars | yes | yes | save_bonus |
| Robe of the Archmagi | yes | yes | no structured fields in this lookup |
| Robe of Useful Items | — | — | no table match |
| Rod of Absorption | — | — | no table match |
| Rod of Alertness | — | — | no table match |
| Rod of Lordly Might | — | — | no table match |
| Rod of Rulership | — | — | no table match |
| Rod of Security | — | — | no table match |
| Rope of Climbing | — | — | no table match |
| Rope of Entanglement | — | — | no table match |
| Scarab of Protection | yes | yes | charges |
| Scimitar of Speed | yes | yes | weapon |
| Shield of Missile Attraction | yes | yes | armor; cursed |
| Shield, +1, +2, or +3 | — | — | no table match |
| Slippers of Spider Climbing | — | — | no table match |
| Sovereign Glue | — | — | no table match |
| Spell Scroll | — | — | no table match |
| Spellguard Shield | yes | yes | armor |
| Sphere of Annihilation | — | — | no table match |
| Staff of Charming | yes | yes | charges; spells: Charm Person, Command, Comprehend Languages |
| Staff of Fire | yes | yes | resistance; charges; spells: Burning Hands, Fireball, Wall of Fire |
| Staff of Frost | yes | yes | resistance; charges; spells: Cone of Cold, Fog Cloud, Ice Storm, Wall of Ice |
| Staff of Healing | yes | yes | charges; spells: Cure Wounds, Lesser Restoration, Mass Cure Wounds |
| Staff of Power | yes | yes | ac_bonus; save_bonus; charges; spells: Cone of Cold, Fireball, Globe of Invulnerability, Hold Monster, Levitate, Lightning Bolt, Magic Missile, Ray of Enfeeblement, Wall of Force |
| Staff of Striking | yes | yes | charges |
| Staff of Swarming Insects | yes | yes | charges; spells: Giant Insect, Insect Plague |
| Staff of the Magi | yes | yes | charges; spells: Conjure Elemental, Dispel Magic, Fireball, Flaming Sphere, Ice Storm, Invisibility, Knock, Lightning Bolt, Passwall, Plane Shift, Telekinesis, Wall of Fire, Web |
| Staff of the Python | yes | yes | no structured fields in this lookup |
| Staff of the Woodlands | yes | yes | charges; spells: Animal Friendship, Awaken, Barkskin, Locate Animals or Plants, Speak with Animals, Speak with Plants, Wall of Thorns |
| Staff of Thunder and Lightning | — | — | no table match |
| Staff of Withering | yes | yes | charges |
| Stone of Controlling Earth Elementals | — | — | no table match |
| Stone of Good Luck (Luckstone) | yes | yes | save_bonus; carried |
| Sun Blade | yes | yes | weapon |
| Sword of Life Stealing | yes | yes | weapon |
| Sword of Sharpness | yes | yes | weapon |
| Sword of Wounding | yes | yes | weapon |
| Talisman of Pure Good | yes | yes | charges |
| Talisman of the Sphere | — | — | no table match |
| Talisman of Ultimate Evil | yes | yes | charges |
| Tome of Clear Thought | — | — | no table match |
| Tome of Leadership and Influence | — | — | no table match |
| Tome of Understanding | — | — | no table match |
| Trident of Fish Command | yes | yes | weapon; charges |
| Universal Solvent | — | — | no table match |
| Vicious Weapon | yes | no | weapon |
| Vorpal Sword | yes | yes | weapon |
| Wand of Binding | yes | yes | charges; spells: Hold Monster, Hold Person |
| Wand of Enemy Detection | yes | yes | charges |
| Wand of Fear | yes | yes | charges; spells: Command |
| Wand of Fireballs | yes | yes | charges; spells: Fireball |
| Wand of Lightning Bolts | yes | yes | charges; spells: Lightning Bolt |
| Wand of Magic Detection | yes | no | charges; spells: Detect Magic |
| Wand of Magic Missiles | yes | no | charges; spells: Magic Missile |
| Wand of Paralysis | yes | yes | charges |
| Wand of Polymorph | yes | yes | charges; spells: Polymorph |
| Wand of Secrets | yes | no | charges |
| Wand of the War Mage, +1, +2, or +3 | yes | yes | no structured fields in this lookup |
| Wand of Web | yes | yes | charges; spells: Web |
| Wand of Wonder | yes | yes | charges |
| Weapon, +1, +2, or +3 | yes | no | weapon |
| Well of Many Worlds | — | — | no table match |
| Wind Fan | — | — | no table match |
| Winged Boots | — | — | no table match |
| Wings of Flying | — | — | no table match |

## All 318 SRD monster / creature / NPC entries

All are represented in the bundled reader. Direct catalog matching uses the installed `wotc-srd` rows. A family-qualified name, template or NPC customization instruction can lack a direct match while its playable base creature exists. Runtime numbers, traits and riders are **not certified** by a catalog match; see F21–F22 for concrete parser/runtime failures.

| Book entry | Direct SRD catalog row(s) |
| --- | --- |
| Aboleth | Aboleth (aboleth) |
| Adult Black Dragon | Adult Black Dragon (adult-black-dragon) |
| Adult Blue Dragon | Adult Blue Dragon (adult-blue-dragon) |
| Adult Brass Dragon | Adult Brass Dragon (adult-brass-dragon) |
| Adult Bronze Dragon | Adult Bronze Dragon (adult-bronze-dragon) |
| Adult Copper Dragon | Adult Copper Dragon (adult-copper-dragon) |
| Adult Gold Dragon | Adult Gold Dragon (adult-gold-dragon) |
| Adult Green Dragon | Adult Green Dragon (adult-green-dragon) |
| Adult Red Dragon | Adult Red Dragon (adult-red-dragon) |
| Adult Silver Dragon | Adult Silver Dragon (adult-silver-dragon) |
| Adult White Dragon | Adult White Dragon (adult-white-dragon) |
| Air Elemental | Air Elemental (air-elemental) |
| Ancient Black Dragon | Ancient Black Dragon (ancient-black-dragon) |
| Ancient Blue Dragon | Ancient Blue Dragon (ancient-blue-dragon) |
| Ancient Brass Dragon | Ancient Brass Dragon (ancient-brass-dragon) |
| Ancient Bronze Dragon | Ancient Bronze Dragon (ancient-bronze-dragon) |
| Ancient Copper Dragon | Ancient Copper Dragon (ancient-copper-dragon) |
| Ancient Gold Dragon | Ancient Gold Dragon (ancient-gold-dragon) |
| Ancient Green Dragon | Ancient Green Dragon (ancient-green-dragon) |
| Ancient Red Dragon | Ancient Red Dragon (ancient-red-dragon) |
| Ancient Silver Dragon | Ancient Silver Dragon (ancient-silver-dragon) |
| Ancient White Dragon | Ancient White Dragon (ancient-white-dragon) |
| Androsphinx | Androsphinx (androsphinx) |
| Animated Armor (Animated Object) | No direct name/slug match; investigate alias/family/template mapping |
| Ankheg | Ankheg (ankheg) |
| Azer | Azer (azer) |
| Balor | Balor (balor) |
| Barbed Devil | Barbed Devil (barbed-devil) |
| Basilisk | Basilisk (basilisk) |
| Bearded Devil | Bearded Devil (bearded-devil) |
| Behir | Behir (behir) |
| Black Dragon Wyrmling | Black Dragon Wyrmling (black-dragon-wyrmling) |
| Black Pudding | Black Pudding (black-pudding) |
| Blue Dragon Wyrmling | Blue Dragon Wyrmling (blue-dragon-wyrmling) |
| Bone Devil | Bone Devil (bone-devil) |
| Brass Dragon Wyrmling | Brass Dragon Wyrmling (brass-dragon-wyrmling) |
| Bronze Dragon Wyrmling | Bronze Dragon Wyrmling (bronze-dragon-wyrmling) |
| Bugbear | Bugbear (bugbear) |
| Bulette | Bulette (bulette) |
| Centaur | Centaur (centaur) |
| Chain Devil | Chain Devil (chain-devil) |
| Chimera | Chimera (chimera) |
| Chuul | Chuul (chuul) |
| Clay Golem | Clay Golem (clay-golem) |
| Cloaker | Cloaker (cloaker) |
| Cloud Giant | Cloud Giant (cloud-giant) |
| Cockatrice | Cockatrice (cockatrice) |
| Copper Dragon Wyrmling | Copper Dragon Wyrmling (copper-dragon-wyrmling) |
| Couatl | Couatl (couatl) |
| Darkmantle | Darkmantle (darkmantle) |
| Deva | Deva (deva) |
| Djinni | Djinni (djinni) |
| Doppelganger | Doppelganger (doppelganger) |
| Dragon Turtle | Dragon Turtle (dragon-turtle) |
| Dretch | Dretch (dretch) |
| Drider | Drider (drider) |
| Dryad | Dryad (dryad) |
| Duergar | Duergar (duergar) |
| Dust Mephit | Dust Mephit (dust-mephit) |
| Earth Elemental | Earth Elemental (earth-elemental) |
| Efreeti | Efreeti (efreeti) |
| Elf, Drow | No direct name/slug match; investigate alias/family/template mapping |
| Erinyes | Erinyes (erinyes) |
| Ettercap | Ettercap (ettercap) |
| Ettin | Ettin (ettin) |
| Fire Elemental | Fire Elemental (fire-elemental) |
| Fire Giant | Fire Giant (fire-giant) |
| Flesh Golem | Flesh Golem (flesh-golem) |
| Flying Sword (Animated Object) | No direct name/slug match; investigate alias/family/template mapping |
| Frost Giant | Frost Giant (frost-giant) |
| Gargoyle | Gargoyle (gargoyle) |
| Gelatinous Cube | Gelatinous Cube (gelatinous-cube) |
| Ghast | Ghast (ghast) |
| Ghost | Ghost (ghost) |
| Ghoul | Ghoul (ghoul) |
| Gibbering Mouther | Gibbering Mouther (gibbering-mouther) |
| Glabrezu | Glabrezu (glabrezu) |
| Gnoll | Gnoll (gnoll) |
| Gnome, Deep | No direct name/slug match; investigate alias/family/template mapping |
| Goblin | Goblin (goblin) |
| Gold Dragon Wyrmling | Gold Dragon Wyrmling (gold-dragon-wyrmling) |
| Gorgon | Gorgon (gorgon) |
| Gray Ooze | Gray Ooze (gray-ooze) |
| Green Dragon Wyrmling | Green Dragon Wyrmling (green-dragon-wyrmling) |
| Green Hag | Green Hag (green-hag) |
| Grick | Grick (grick) |
| Griffon | Griffon (griffon) |
| Grimlock | Grimlock (grimlock) |
| Guardian Naga | Guardian Naga (guardian-naga) |
| Gynosphinx | Gynosphinx (gynosphinx) |
| Half-Dragon Template | No direct name/slug match; investigate alias/family/template mapping |
| Harpy | Harpy (harpy) |
| Hell Hound | Hell Hound (hell-hound) |
| Hezrou | Hezrou (hezrou) |
| Hill Giant | Hill Giant (hill-giant) |
| Hippogriff | Hippogriff (hippogriff) |
| Hobgoblin | Hobgoblin (hobgoblin) |
| Homunculus | Homunculus (homunculus) |
| Horned Devil | Horned Devil (horned-devil) |
| Hydra | Hydra (hydra) |
| Ice Devil | Ice Devil (ice-devil) |
| Ice Mephit | Ice Mephit (ice-mephit) |
| Imp | Imp (imp) |
| Invisible Stalker | Invisible Stalker (invisible-stalker) |
| Iron Golem | Iron Golem (iron-golem) |
| Kobold | Kobold (kobold) |
| Kraken | Kraken (kraken) |
| Lamia | Lamia (lamia) |
| Lemure | Lemure (lemure) |
| Lich | Lich (lich) |
| Lizardfolk | Lizardfolk (lizardfolk) |
| Magma Mephit | Magma Mephit (magma-mephit) |
| Magmin | Magmin (magmin) |
| Manticore | Manticore (manticore) |
| Marilith | Marilith (marilith) |
| Medusa | Medusa (medusa) |
| Merfolk | Merfolk (merfolk) |
| Merrow | Merrow (merrow) |
| Mimic | Mimic (mimic) |
| Minotaur | Minotaur (minotaur) |
| Minotaur Skeleton | Minotaur Skeleton (minotaur-skeleton) |
| Mummy | Mummy (mummy) |
| Mummy Lord | Mummy Lord (mummy-lord) |
| Nalfeshnee | Nalfeshnee (nalfeshnee) |
| Night Hag | Night Hag (night-hag) |
| Nightmare | Nightmare (nightmare) |
| Ochre Jelly | Ochre Jelly (ochre-jelly) |
| Ogre | Ogre (ogre) |
| Ogre Zombie | Ogre Zombie (ogre-zombie) |
| Oni | Oni (oni) |
| Orc | Orc (orc) |
| Otyugh | Otyugh (otyugh) |
| Owlbear | Owlbear (owlbear) |
| Pegasus | Pegasus (pegasus) |
| Pit Fiend | Pit Fiend (pit-fiend) |
| Planetar | Planetar (planetar) |
| Plesiosaurus | Plesiosaurus (plesiosaurus) |
| Pseudodragon | Pseudodragon (pseudodragon) |
| Purple Worm | Purple Worm (purple-worm) |
| Quasit | Quasit (quasit) |
| Rakshasa | Rakshasa (rakshasa) |
| Red Dragon Wyrmling | Red Dragon Wyrmling (red-dragon-wyrmling) |
| Remorhaz | Remorhaz (remorhaz) |
| Roc | Roc (roc) |
| Roper | Roper (roper) |
| Rug of Smothering (Animated Object) | No direct name/slug match; investigate alias/family/template mapping |
| Rust Monster | Rust Monster (rust-monster) |
| Sahuagin | Sahuagin (sahuagin) |
| Salamander | Salamander (salamander) |
| Satyr | Satyr (satyr) |
| Sea Hag | Sea Hag (sea-hag) |
| Shadow | Shadow (shadow) |
| Shambling Mound | Shambling Mound (shambling-mound) |
| Shield Guardian | Shield Guardian (shield-guardian) |
| Shrieker | Shrieker (shrieker) |
| Silver Dragon Wyrmling | Silver Dragon Wyrmling (silver-dragon-wyrmling) |
| Skeleton | Skeleton (skeleton) |
| Solar | Solar (solar) |
| Specter | Specter (specter) |
| Spirit Naga | Spirit Naga (spirit-naga) |
| Sprite | Sprite (sprite) |
| Steam Mephit | Steam Mephit (steam-mephit) |
| Stirge | Stirge (stirge) |
| Stone Giant | Stone Giant (stone-giant) |
| Stone Golem | Stone Golem (stone-golem) |
| Storm Giant | Storm Giant (storm-giant) |
| Succubus/Incubus | Succubus/Incubus (succubusincubus) |
| Tarrasque | Tarrasque (tarrasque) |
| Treant | Treant (treant) |
| Triceratops | Triceratops (triceratops) |
| Troll | Troll (troll) |
| Tyrannosaurus Rex | Tyrannosaurus Rex (tyrannosaurus-rex) |
| Unicorn | Unicorn (unicorn) |
| Vampire | Vampire (vampire) |
| Vampire Spawn | Vampire Spawn (vampire-spawn) |
| Violet Fungus | Violet Fungus (violet-fungus) |
| Vrock | Vrock (vrock) |
| Warhorse Skeleton | Warhorse Skeleton (warhorse-skeleton) |
| Water Elemental | Water Elemental (water-elemental) |
| Werebear | Werebear (werebear) |
| Wereboar | Wereboar (wereboar) |
| Wererat | Wererat (wererat) |
| Weretiger | Weretiger (weretiger) |
| Werewolf | Werewolf (werewolf) |
| White Dragon Wyrmling | White Dragon Wyrmling (white-dragon-wyrmling) |
| Wight | Wight (wight) |
| Will-o'-Wisp | Will-o'-Wisp (will-o-wisp) |
| Wraith | Wraith (wraith) |
| Wyvern | Wyvern (wyvern) |
| Xorn | Xorn (xorn) |
| Young Black Dragon | Young Black Dragon (young-black-dragon) |
| Young Blue Dragon | Young Blue Dragon (young-blue-dragon) |
| Young Brass Dragon | Young Brass Dragon (young-brass-dragon) |
| Young Bronze Dragon | Young Bronze Dragon (young-bronze-dragon) |
| Young Copper Dragon | Young Copper Dragon (young-copper-dragon) |
| Young Gold Dragon | Young Gold Dragon (young-gold-dragon) |
| Young Green Dragon | Young Green Dragon (young-green-dragon) |
| Young Red Dragon | Young Red Dragon (young-red-dragon) |
| Young Silver Dragon | Young Silver Dragon (young-silver-dragon) |
| Young White Dragon | Young White Dragon (young-white-dragon) |
| Zombie | Zombie (zombie) |
| Ape | Ape (ape) |
| Awakened Shrub | Awakened Shrub (awakened-shrub) |
| Awakened Tree | Awakened Tree (awakened-tree) |
| Axe Beak | Axe Beak (axe-beak) |
| Baboon | Baboon (baboon) |
| Badger | Badger (badger) |
| Bat | Bat (bat) |
| Black Bear | Black Bear (black-bear) |
| Blink Dog | Blink Dog (blink-dog) |
| Blood Hawk | Blood Hawk (blood-hawk) |
| Boar | Boar (boar) |
| Brown Bear | Brown Bear (brown-bear) |
| Camel | Camel (camel) |
| Cat | Cat (cat) |
| Constrictor Snake | Constrictor Snake (constrictor-snake) |
| Crab | Crab (crab) |
| Crocodile | Crocodile (crocodile) |
| Death Dog | Death Dog (death-dog) |
| Deer | Deer (deer) |
| Dire Wolf | Dire Wolf (dire-wolf) |
| Draft Horse | Draft Horse (draft-horse) |
| Eagle | Eagle (eagle) |
| Elephant | Elephant (elephant) |
| Elk | Elk (elk) |
| Flying Snake | Flying Snake (flying-snake) |
| Frog | Frog (frog) |
| Giant Ape | Giant Ape (giant-ape) |
| Giant Badger | Giant Badger (giant-badger) |
| Giant Bat | Giant Bat (giant-bat) |
| Giant Boar | Giant Boar (giant-boar) |
| Giant Centipede | Giant Centipede (giant-centipede) |
| Giant Constrictor Snake | Giant Constrictor Snake (giant-constrictor-snake) |
| Giant Crab | Giant Crab (giant-crab) |
| Giant Crocodile | Giant Crocodile (giant-crocodile) |
| Giant Eagle | Giant Eagle (giant-eagle) |
| Giant Elk | Giant Elk (giant-elk) |
| Giant Fire Beetle | Giant Fire Beetle (giant-fire-beetle) |
| Giant Frog | Giant Frog (giant-frog) |
| Giant Goat | Giant Goat (giant-goat) |
| Giant Hyena | Giant Hyena (giant-hyena) |
| Giant Lizard | Giant Lizard (giant-lizard) |
| Giant Octopus | Giant Octopus (giant-octopus) |
| Giant Owl | Giant Owl (giant-owl) |
| Giant Poisonous Snake | Giant Poisonous Snake (giant-poisonous-snake) |
| Giant Rat | Giant Rat (giant-rat) |
| Giant Scorpion | Giant Scorpion (giant-scorpion) |
| Giant Sea Horse | Giant Sea Horse (giant-sea-horse) |
| Giant Shark | Giant Shark (giant-shark) |
| Giant Spider | Giant Spider (giant-spider) |
| Giant Toad | Giant Toad (giant-toad) |
| Giant Vulture | Giant Vulture (giant-vulture) |
| Giant Wasp | Giant Wasp (giant-wasp) |
| Giant Weasel | Giant Weasel (giant-weasel) |
| Giant Wolf Spider | Giant Wolf Spider (giant-wolf-spider) |
| Goat | Goat (goat) |
| Hawk | Hawk (hawk) |
| Hunter Shark | Hunter Shark (hunter-shark) |
| Hyena | Hyena (hyena) |
| Jackal | Jackal (jackal) |
| Killer Whale | Killer Whale (killer-whale) |
| Lion | Lion (lion) |
| Lizard | Lizard (lizard) |
| Mammoth | Mammoth (mammoth) |
| Mastiff | Mastiff (mastiff) |
| Mule | Mule (mule) |
| Octopus | Octopus (octopus) |
| Owl | Owl (owl) |
| Panther | Panther (panther) |
| Phase Spider | Phase Spider (phase-spider) |
| Poisonous Snake | Poisonous Snake (poisonous-snake) |
| Polar Bear | Polar Bear (polar-bear) |
| Pony | Pony (pony) |
| Quipper | Quipper (quipper) |
| Rat | Rat (rat) |
| Raven | Raven (raven) |
| Reef Shark | Reef Shark (reef-shark) |
| Rhinoceros | Rhinoceros (rhinoceros) |
| Riding Horse | Riding Horse (riding-horse) |
| Saber-Toothed Tiger | Saber-Toothed Tiger (saber-toothed-tiger) |
| Scorpion | Scorpion (scorpion) |
| Sea Horse | Sea Horse (sea-horse) |
| Spider | Spider (spider) |
| Swarm of Bats | Swarm of Bats (swarm-of-bats) |
| Swarm of Insects | Swarm of Insects (swarm-of-insects) |
| Swarm of Poisonous Snakes | Swarm of Poisonous Snakes (swarm-of-poisonous-snakes) |
| Swarm of Quippers | Swarm of Quippers (swarm-of-quippers) |
| Swarm of Rats | Swarm of Rats (swarm-of-rats) |
| Swarm of Ravens | Swarm of Ravens (swarm-of-ravens) |
| Tiger | Tiger (tiger) |
| Vulture | Vulture (vulture) |
| Warhorse | Warhorse (warhorse) |
| Weasel | Weasel (weasel) |
| Winter Wolf | Winter Wolf (winter-wolf) |
| Wolf | Wolf (wolf) |
| Worg | Worg (worg) |
| Acolyte | Acolyte (acolyte) |
| Archmage | Archmage (archmage) |
| Assassin | Assassin (assassin) |
| Bandit | Bandit (bandit) |
| Bandit Captain | Bandit Captain (bandit-captain) |
| Berserker | Berserker (berserker) |
| Commoner | Commoner (commoner) |
| Cult Fanatic | Cult Fanatic (cult-fanatic) |
| Cultist | Cultist (cultist) |
| Customizing NPCs | No direct name/slug match; investigate alias/family/template mapping |
| Druid | Druid (druid) |
| Gladiator | Gladiator (gladiator) |
| Guard | Guard (guard) |
| Knight | Knight (knight) |
| Mage | Mage (mage) |
| Noble | Noble (noble) |
| Priest | Priest (priest) |
| Scout | Scout (scout) |
| Spy | Spy (spy) |
| Thug | Thug (thug) |
| Tribal Warrior | Tribal Warrior (tribal-warrior) |
| Veteran | Veteran (veteran) |

## Current authored subclass-feature classifications (533 entries)

This reproduces `authoredCoverage()` output: typed 189, counter 150, narrated 11, plain 183, uncovered 0. Multiple entries can share a feature key. `typed` means a structured entry/parser effect exists, `counter` means a pool exists, `plain` means the classifier found no matching mechanical wording, and `narrated` means an explicit reason is recorded. **None of these categories certifies complete rule behavior.** F29 explains the classifier limits.

| Class / feature key | Classifier category |
| --- | --- |
| barbarian::Totem Spirit | typed |
| barbarian::Aspect of the Beast | typed |
| barbarian::Totemic Attunement | typed |
| barbarian::Ancestral Protectors | typed |
| barbarian::Spirit Shield | typed |
| barbarian::Storm Aura | typed |
| barbarian::Storm Soul | typed |
| barbarian::Shielding Storm | typed |
| barbarian::Raging Storm | typed |
| barbarian::Divine Fury | typed |
| barbarian::Fanatical Focus | typed |
| barbarian::Form of the Beast | typed |
| barbarian::Bestial Soul | typed |
| barbarian::Mighty Impel | typed |
| barbarian::Demiurgic Colossus | typed |
| barbarian::Elemental Fury | typed |
| bard::Combat Inspiration | typed |
| bard::Extra Attack | typed |
| bard::Battle Magic | typed |
| bard::Mantle of Inspiration | typed |
| bard::Blade Flourish | typed |
| bard::Extra Attack | typed |
| bard::Psychic Blades | typed |
| bard::Unsettling Words | typed |
| bard::Mote of Potential | typed |
| cleric::Corona of Light | typed |
| cleric::Dampen Elements | typed |
| cleric::Divine Strike | typed |
| cleric::Divine Strike | typed |
| cleric::Stormborn | typed |
| cleric::Blessing of the Trickster | typed |
| cleric::Divine Strike | typed |
| cleric::Divine Strike | typed |
| cleric::Avatar of Battle | typed |
| cleric::Inescapable Destruction | typed |
| cleric::Divine Strike | typed |
| cleric::Improved Reaper | typed |
| cleric::Blessing of the Forge | typed |
| cleric::Soul of the Forge | typed |
| cleric::Divine Strike | typed |
| cleric::Saint of Forge and Fire | typed |
| cleric::Circle of Mortality | typed |
| cleric::Keeper of Souls | typed |
| cleric::Voice of Authority | typed |
| cleric::Divine Strike | typed |
| cleric::Order's Wrath | typed |
| cleric::Protective Bond | typed |
| cleric::Vigilant Blessing | typed |
| cleric::Divine Strike | typed |
| druid::Primal Strike | typed |
| druid::Mighty Summoner | typed |
| druid::Halo of Spores | typed |
| druid::Symbiotic Entity | typed |
| druid::Fungal Body | typed |
| druid::Twinkling Constellations | typed |
| druid::Summon Wildfire Spirit | typed |
| druid::Enhanced Bond | typed |
| druid::Cauterizing Flames | typed |
| fighter::Relentless | typed |
| fighter::War Magic | typed |
| fighter::Eldritch Strike | typed |
| fighter::Magic Arrow | typed |
| fighter::Curving Shot | typed |
| fighter::Ever-Ready Shot | typed |
| fighter::Born to the Saddle | typed |
| fighter::Unwavering Mark | typed |
| fighter::Hold the Line | typed |
| fighter::Vigilant Defender | typed |
| fighter::Elegant Courtier | typed |
| fighter::Tireless Spirit | typed |
| fighter::Rapid Strike | typed |
| fighter::Legion of One | typed |
| fighter::Protective Field | typed |
| fighter::Telekinetic Adept | typed |
| fighter::Guarded Mind | typed |
| fighter::Bulwark of Force | typed |
| fighter::Telekinetic Master | typed |
| fighter::Great Stature | typed |
| fighter::Runic Juggernaut | typed |
| fighter::Inspiring Surge | typed |
| monk::Shadow Step | typed |
| monk::Opportunist | typed |
| monk::Tipsy Sway | typed |
| monk::Drunkard's Luck | typed |
| monk::Intoxicated Frenzy | typed |
| monk::Path of the Kensei | typed |
| monk::Kensei's Shot | typed |
| monk::One with the Blade | typed |
| monk::Sharpen the Blade | typed |
| monk::Radiant Sun Bolt | typed |
| monk::Searing Arc Strike | typed |
| monk::Searing Sunburst | typed |
| monk::Touch of Death | typed |
| monk::Touch of the Long Death | typed |
| monk::Arms of the Astral Self | typed |
| monk::Visage of the Astral Self | typed |
| monk::Body of the Astral Self | typed |
| monk::Awakened Astral Self | typed |
| monk::Ascendant Aspect | typed |
| paladin::Aura of Warding | typed |
| paladin::Elder Champion | typed |
| paladin::Relentless Avenger | typed |
| paladin::Soul of Vengeance | typed |
| paladin::Avenging Angel | typed |
| paladin::Aura of Conquest | typed |
| paladin::Invincible Conqueror | typed |
| paladin::Aura of the Guardian | typed |
| paladin::Protective Spirit | typed |
| paladin::Emissary of Redemption | typed |
| paladin::Aura of Alacrity | typed |
| paladin::Living Legend | typed |
| paladin::Vigilant Rebuke | typed |
| paladin::Mortal Bulwark | typed |
| paladin::Divine Allegiance | typed |
| paladin::Unyielding Spirit | typed |
| paladin::Exalted Champion | typed |
| paladin::Supernatural Resistance | typed |
| paladin::Dread Lord | typed |
| ranger::Exceptional Training | typed |
| ranger::Dread Ambusher | typed |
| ranger::Shadowy Dodge | typed |
| ranger::Planar Warrior | typed |
| ranger::Spectral Defense | typed |
| ranger::Slayer's Prey | typed |
| ranger::Supernatural Defense | typed |
| ranger::Slayer's Counter | typed |
| ranger::Dreadful Strikes | typed |
| ranger::Beguiling Twist | typed |
| ranger::Gathered Swarm | typed |
| ranger::Mighty Swarm | typed |
| ranger::Bond of Fang and Scale | typed |
| rogue::Assassinate | typed |
| rogue::Magical Ambush | typed |
| rogue::Versatile Trickster | typed |
| rogue::Master of Tactics | typed |
| rogue::Misdirection | typed |
| rogue::Rakish Audacity | typed |
| rogue::Elegant Maneuver | typed |
| rogue::Eye for Detail | typed |
| rogue::Insightful Fighting | typed |
| rogue::Steady Eye | typed |
| rogue::Eye for Weakness | typed |
| rogue::Skirmisher | typed |
| rogue::Superior Mobility | typed |
| rogue::Ambush Master | typed |
| rogue::Sudden Strike | typed |
| rogue::Tokens of the Departed | typed |
| rogue::Psychic Blades | typed |
| sorcerer::Bend Luck | typed |
| sorcerer::Otherworldly Wings | typed |
| sorcerer::Hound of Ill Omen | typed |
| sorcerer::Shadow Walk | typed |
| sorcerer::Umbral Form | typed |
| sorcerer::Tempestuous Magic | typed |
| sorcerer::Heart of the Storm | typed |
| sorcerer::Storm's Fury | typed |
| sorcerer::Wind Soul | typed |
| sorcerer::Psychic Defenses | typed |
| warlock::Beguiling Defenses | typed |
| warlock::Radiant Soul | typed |
| warlock::Celestial Resilience | typed |
| warlock::Gift of the Sea | typed |
| warlock::Oceanic Soul | typed |
| warlock::Guardian Coil | typed |
| warlock::Grasping Tentacles | typed |
| warlock::Elemental Gift | typed |
| warlock::Among the Dead | typed |
| wizard::Arcane Ward | typed |
| wizard::Projected Ward | typed |
| wizard::Spell Resistance | typed |
| wizard::Durable Summons | typed |
| wizard::Inured to Undeath | typed |
| wizard::Transmuter's Stone | typed |
| wizard::Arcane Deflection | typed |
| wizard::Durable Magic | typed |
| wizard::Extra Attack | typed |
| wizard::Song of Defense | typed |
| wizard::Convergent Future | typed |
| wizard::Adjust Density | typed |
| artificer::Chemical Mastery | typed |
| artificer::Armor Model | typed |
| artificer::Extra Attack | typed |
| artificer::Perfected Armor | typed |
| artificer::Arcane Firearm | typed |
| artificer::Explosive Cannon | typed |
| artificer::Steel Defender | typed |
| artificer::Extra Attack | typed |
| artificer::Arcane Jolt | typed |
| artificer::Improved Defender | typed |
| barbarian::Consult the Spirits | counter |
| barbarian::Zealous Presence | counter |
| barbarian::Infectious Fury | counter |
| barbarian::Call the Hunt | counter |
| barbarian::Magic Awareness | counter |
| barbarian::Bolstering Magic | counter |
| bard::Enthralling Performance | counter |
| bard::Mantle of Majesty | counter |
| bard::Unbreakable Majesty | counter |
| bard::Words of Terror | counter |
| bard::Mantle of Whispers | counter |
| bard::Shadow Lore | counter |
| bard::Infectious Inspiration | counter |
| bard::Performance of Creation | counter |
| bard::Animating Performance | counter |
| bard::Spirit Session | counter |
| cleric::Channel Divinity: Knowledge of the Ages | counter |
| cleric::Channel Divinity: Read Thoughts | counter |
| cleric::Warding Flare | counter |
| cleric::Channel Divinity: Radiance of the Dawn | counter |
| cleric::Improved Warding Flare | counter |
| cleric::Channel Divinity: Charm Animals and Plants | counter |
| cleric::Wrath of the Storm | counter |
| cleric::Channel Divinity: Destructive Wrath | counter |
| cleric::Channel Divinity: Invoke Duplicity | counter |
| cleric::Channel Divinity: Cloak of Shadows | counter |
| cleric::War Priest | counter |
| cleric::Channel Divinity: Guided Strike | counter |
| cleric::Channel Divinity: War God's Blessing | counter |
| cleric::Channel Divinity: Touch of Death | counter |
| cleric::Channel Divinity: Artisan's Blessing | counter |
| cleric::Eyes of the Grave | counter |
| cleric::Channel Divinity: Path to the Grave | counter |
| cleric::Sentinel at Death's Door | counter |
| cleric::Channel Divinity: Order's Demand | counter |
| cleric::Embodiment of the Law | counter |
| cleric::Channel Divinity: Balm of Peace | counter |
| cleric::Eyes of Night | counter |
| cleric::Channel Divinity: Twilight Sanctuary | counter |
| cleric::Steps of Night | counter |
| cleric::Channel Divinity: Arcane Abjuration | counter |
| druid::Combat Wild Shape | counter |
| druid::Elemental Wild Shape | counter |
| druid::Balm of the Summer Court | counter |
| druid::Hidden Paths | counter |
| druid::Walker in Dreams | counter |
| druid::Spirit Totem | counter |
| druid::Faithful Summons | counter |
| druid::Fungal Infestation | counter |
| druid::Star Map | counter |
| druid::Starry Form | counter |
| druid::Cosmic Omen | counter |
| druid::Blazing Revival | counter |
| fighter::Combat Superiority | counter |
| fighter::Maneuvers | counter |
| fighter::Arcane Shot | counter |
| fighter::Warding Maneuver | counter |
| fighter::Fighting Spirit | counter |
| fighter::Strength before Death | counter |
| fighter::Unleash Incarnation | counter |
| fighter::Shadow Martyr | counter |
| fighter::Reclaim Potential | counter |
| fighter::Psionic Power (Psi Warrior) | counter |
| fighter::Giant's Might | counter |
| fighter::Runic Shield | counter |
| monk::Hand of Ultimate Mercy | counter |
| monk::Breath of the Dragon | counter |
| monk::Wings Unfurled | counter |
| monk::Aspect of the Wyrm | counter |
| paladin::Channel Divinity: Nature's Wrath | counter |
| paladin::Channel Divinity: Turn the Faithless | counter |
| paladin::Undying Sentinel | counter |
| paladin::Channel Divinity: Abjure Enemy | counter |
| paladin::Channel Divinity: Vow of Enmity | counter |
| paladin::Channel Divinity: Conquering Presence | counter |
| paladin::Channel Divinity: Guided Strike | counter |
| paladin::Channel Divinity: Emissary of Peace | counter |
| paladin::Channel Divinity: Rebuke the Violent | counter |
| paladin::Channel Divinity: Peerless Athlete | counter |
| paladin::Channel Divinity: Inspiring Smite | counter |
| paladin::Glorious Defense | counter |
| paladin::Channel Divinity: Watcher's Will | counter |
| paladin::Channel Divinity: Abjure the Extraplanar | counter |
| paladin::Channel Divinity: Champion Challenge | counter |
| paladin::Channel Divinity: Turn the Tide | counter |
| paladin::Channel Divinity: Control Undead | counter |
| paladin::Channel Divinity: Dreadful Aspect | counter |
| ranger::Detect Portal | counter |
| ranger::Ethereal Step | counter |
| ranger::Hunter's Sense | counter |
| ranger::Magic-User's Nemesis | counter |
| ranger::Fey Reinforcements | counter |
| ranger::Misty Wanderer | counter |
| ranger::Writhing Tide | counter |
| ranger::Swarming Dispersal | counter |
| ranger::Drake Companion | counter |
| ranger::Drake's Breath | counter |
| rogue::Spell Thief | counter |
| rogue::Master Duelist | counter |
| rogue::Unerring Eye | counter |
| rogue::Wails from the Grave | counter |
| rogue::Ghost Walk | counter |
| rogue::Psionic Power (Soulknife) | counter |
| rogue::Psychic Veil | counter |
| rogue::Rend Mind | counter |
| sorcerer::Tides of Chaos | counter |
| sorcerer::Favored by the Gods | counter |
| sorcerer::Unearthly Recovery | counter |
| sorcerer::Strength of the Grave | counter |
| sorcerer::Warping Implosion | counter |
| sorcerer::Restore Balance | counter |
| sorcerer::Trance of Order | counter |
| sorcerer::Clockwork Cavalcade | counter |
| sorcerer::Lunar Phenomenon | counter |
| warlock::Fey Presence | counter |
| warlock::Misty Escape | counter |
| warlock::Entropic Ward | counter |
| warlock::Healing Light | counter |
| warlock::Searing Vengeance | counter |
| warlock::Hexblade's Curse | counter |
| warlock::Accursed Specter | counter |
| warlock::Tentacle of the Deep | counter |
| warlock::Fathomless Plunge | counter |
| warlock::Genie's Vessel | counter |
| warlock::Sanctuary Vessel | counter |
| warlock::Limited Wish | counter |
| warlock::Form of Dread | counter |
| warlock::Necrotic Husk | counter |
| warlock::Spirit Projection | counter |
| warlock::Defy Death | counter |
| warlock::Indestructible Life | counter |
| wizard::Benign Transposition | counter |
| wizard::Portent | counter |
| wizard::Greater Portent | counter |
| wizard::Hypnotic Gaze | counter |
| wizard::Instinctive Charm | counter |
| wizard::Illusory Self | counter |
| wizard::Shapechanger | counter |
| wizard::Bladesong | counter |
| wizard::Chronal Shift | counter |
| wizard::Momentary Stasis | counter |
| wizard::Arcane Abeyance | counter |
| wizard::Violent Attraction | counter |
| wizard::Event Horizon | counter |
| wizard::Manifest Mind | counter |
| wizard::Master Scrivener | counter |
| wizard::One with the Word | counter |
| artificer::Experimental Elixir | counter |
| artificer::Restorative Reagents | counter |
| artificer::Eldritch Cannon | counter |
| barbarian::Unstable Backlash | narrated |
| cleric::Master of Nature | narrated |
| fighter::Know Your Enemy | narrated |
| fighter::Weapon Bond | narrated |
| fighter::Manifest Echo | narrated |
| ranger::Ranger's Companion | narrated |
| sorcerer::Storm Guide | narrated |
| sorcerer::Telepathic Speech | narrated |
| sorcerer::Moon Fire | narrated |
| wizard::Illusory Reality | narrated |
| wizard::Wizardly Quill | narrated |
| barbarian::Spirit Seeker | plain |
| barbarian::Spirit Walker | plain |
| barbarian::Vengeful Ancestors | plain |
| barbarian::Warrior of the Gods | plain |
| barbarian::Rage Beyond Death | plain |
| barbarian::Wild Surge | plain |
| barbarian::Controlled Surge | plain |
| barbarian::Giant's Power | plain |
| barbarian::Elemental Cleaver | plain |
| bard::Bonus Proficiencies (Valor) | plain |
| bard::Bonus Proficiencies (Swords) | plain |
| bard::Fighting Style (Blade) | plain |
| bard::Master's Flourish | plain |
| bard::Silver Tongue | plain |
| bard::Unfailing Inspiration | plain |
| bard::Creative Crescendo | plain |
| bard::Guiding Whispers | plain |
| bard::Spiritual Focus | plain |
| bard::Tales from Beyond | plain |
| bard::Mystical Connection | plain |
| cleric::Blessings of Knowledge | plain |
| cleric::Potent Spellcasting | plain |
| cleric::Visions of the Past | plain |
| cleric::Bonus Cantrip (Light) | plain |
| cleric::Potent Spellcasting | plain |
| cleric::Acolyte of Nature | plain |
| cleric::Bonus Proficiency (heavy armor) | plain |
| cleric::Bonus Proficiencies (Tempest) | plain |
| cleric::Thunderbolt Strike | plain |
| cleric::Improved Duplicity | plain |
| cleric::Bonus Proficiencies (War) | plain |
| cleric::Bonus Proficiency (martial weapons) | plain |
| cleric::Reaper | plain |
| cleric::Bonus Proficiencies (Forge) | plain |
| cleric::Potent Spellcasting | plain |
| cleric::Bonus Proficiencies (Order) | plain |
| cleric::Implement of Peace | plain |
| cleric::Emboldening Bond | plain |
| cleric::Potent Spellcasting | plain |
| cleric::Expansive Bond | plain |
| cleric::Bonus Proficiencies (Twilight) | plain |
| cleric::Twilight Shroud | plain |
| cleric::Arcane Initiate | plain |
| cleric::Spell Breaker | plain |
| cleric::Potent Spellcasting | plain |
| cleric::Arcane Mastery | plain |
| druid::Circle Forms | plain |
| druid::Thousand Forms | plain |
| druid::Hearth of Moonlight and Shadow | plain |
| druid::Speech of the Woods | plain |
| druid::Guardian Spirit | plain |
| druid::Spreading Spores | plain |
| druid::Full of Stars | plain |
| fighter::Student of War | plain |
| fighter::Spellcasting (Eldritch Knight) | plain |
| fighter::Arcane Charge | plain |
| fighter::Improved War Magic | plain |
| fighter::Arcane Archer Lore | plain |
| fighter::Bonus Proficiency (Cavalier) | plain |
| fighter::Ferocious Charger | plain |
| fighter::Bonus Proficiency (Samurai) | plain |
| fighter::Echo Avatar | plain |
| fighter::Psionic Strike | plain |
| fighter::Telekinetic Movement | plain |
| fighter::Bonus Proficiencies (Rune Knight) | plain |
| fighter::Rune Carver | plain |
| fighter::Master of Runes | plain |
| fighter::Rallying Cry | plain |
| fighter::Royal Envoy | plain |
| fighter::Bulwark | plain |
| monk::Shadow Arts | plain |
| monk::Cloak of Shadows | plain |
| monk::Disciple of the Elements | plain |
| monk::Elemental Discipline (6th) | plain |
| monk::Elemental Discipline (11th) | plain |
| monk::Elemental Discipline (17th) | plain |
| monk::Bonus Proficiencies (Drunken Master) | plain |
| monk::Drunken Technique | plain |
| monk::Unerring Accuracy | plain |
| monk::Sun Shield | plain |
| monk::Hour of Reaping | plain |
| monk::Mastery of Death | plain |
| monk::Implements of Mercy | plain |
| monk::Hand of Healing | plain |
| monk::Hand of Harm | plain |
| monk::Physician's Touch | plain |
| monk::Flurry of Healing and Harm | plain |
| monk::Draconic Disciple | plain |
| paladin::Scornful Rebuke | plain |
| paladin::Aura of the Sentinel | plain |
| paladin::Aura of Hate | plain |
| ranger::Bestial Fury | plain |
| ranger::Share Spells | plain |
| ranger::Umbral Sight | plain |
| ranger::Iron Mind | plain |
| ranger::Stalker's Flurry | plain |
| ranger::Distant Strike | plain |
| ranger::Otherworldly Glamour | plain |
| ranger::Fey Wanderer Magic | plain |
| ranger::Swarmkeeper Magic | plain |
| ranger::Draconic Gift | plain |
| ranger::Perfected Bond | plain |
| rogue::Bonus Proficiencies (Assassin) | plain |
| rogue::Infiltration Expertise | plain |
| rogue::Impostor | plain |
| rogue::Death Strike | plain |
| rogue::Spellcasting (Arcane Trickster) | plain |
| rogue::Mage Hand Legerdemain | plain |
| rogue::Master of Intrigue | plain |
| rogue::Insightful Manipulator | plain |
| rogue::Soul of Deceit | plain |
| rogue::Fancy Footwork | plain |
| rogue::Panache | plain |
| rogue::Ear for Deceit | plain |
| rogue::Survivalist | plain |
| rogue::Whispers of the Dead | plain |
| rogue::Death's Friend | plain |
| rogue::Psi-Bolstered Knack | plain |
| rogue::Psychic Whispers | plain |
| rogue::Soul Blades | plain |
| sorcerer::Wild Magic Surge | plain |
| sorcerer::Controlled Chaos | plain |
| sorcerer::Spell Bombardment | plain |
| sorcerer::Divine Magic | plain |
| sorcerer::Empowered Healing | plain |
| sorcerer::Eyes of the Dark | plain |
| sorcerer::Wind Speaker | plain |
| sorcerer::Psionic Spells | plain |
| sorcerer::Psionic Sorcery | plain |
| sorcerer::Revelation in Flesh | plain |
| sorcerer::Clockwork Magic | plain |
| sorcerer::Bastion of Law | plain |
| sorcerer::Lunar Embodiment | plain |
| sorcerer::Lunar Boons | plain |
| sorcerer::Waxing and Waning | plain |
| warlock::Dark Delirium | plain |
| warlock::Awakened Mind | plain |
| warlock::Thought Shield | plain |
| warlock::Create Thrall | plain |
| warlock::Bonus Cantrips (Celestial) | plain |
| warlock::Hex Warrior | plain |
| warlock::Armor of Hexes | plain |
| warlock::Master of Hexes | plain |
| warlock::Grave Touched | plain |
| warlock::Undying Nature | plain |
| wizard::Abjuration Savant | plain |
| wizard::Improved Abjuration | plain |
| wizard::Conjuration Savant | plain |
| wizard::Minor Conjuration | plain |
| wizard::Focused Conjuration | plain |
| wizard::Divination Savant | plain |
| wizard::Expert Divination | plain |
| wizard::The Third Eye | plain |
| wizard::Enchantment Savant | plain |
| wizard::Split Enchantment | plain |
| wizard::Alter Memories | plain |
| wizard::Illusion Savant | plain |
| wizard::Improved Minor Illusion | plain |
| wizard::Malleable Illusion | plain |
| wizard::Necromancy Savant | plain |
| wizard::Grim Harvest | plain |
| wizard::Undead Thralls | plain |
| wizard::Command Undead | plain |
| wizard::Transmutation Savant | plain |
| wizard::Minor Alchemy | plain |
| wizard::Master Transmuter | plain |
| wizard::Tactical Wit | plain |
| wizard::Power Surge | plain |
| wizard::Deflecting Shroud | plain |
| wizard::Training in War and Song | plain |
| wizard::Song of Victory | plain |
| wizard::Temporal Awareness | plain |
| wizard::Gravity Well | plain |
| wizard::Awakened Spellbook | plain |
| artificer::Tool Proficiency (Alchemist) | plain |
| artificer::Alchemical Savant | plain |
| artificer::Tool Proficiency (Armorer) | plain |
| artificer::Arcane Armor | plain |
| artificer::Armor Modifications | plain |
| artificer::Tool Proficiency (Artillerist) | plain |
| artificer::Fortified Position | plain |
| artificer::Tool Proficiency (Battle Smith) | plain |
| artificer::Battle Ready | plain |
