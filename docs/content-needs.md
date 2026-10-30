# Content that needs rules the engine does not have

Some of the content pack's entries use rules SRD 5.1 does not have and the
engine does not play: Level Up Advanced 5e's strife, fatigue, rattled,
expertise dice, exertion, maneuvers and "while bloodied" triggers, and Deep
Magic's ley lines. Nothing in the SRD uses them. This is the list, by rule
and by book, as the pack build reads it (`src/lib/content/needs-logic.ts`,
stored in the pack's `entry_needs` table). A creature's immunity to Level
Up's fatigue is not counted: the engine reads it as exhaustion.

How a table meets them, and the add-on that would play strife and fatigue,
is decided in issue #570. A Level Up spell's expertise die and maneuver DC
are already read in 2014 terms (a d4, and the DC's formula), so they are not
listed.

Regenerate this file with
`node scripts/pack-readings.mjs <release pack> --needs-markdown` after
building the pack (`node scripts/import-open5e.mjs`).

## Strife (16)

- **Level Up Advanced 5e**: spells (3): Contact Other Plane, Dream, Greater Restoration; items (1): Crown of the Crystal Sovereign
- **Level Up Advanced 5e Monstrous Menagerie**: monsters (12): Adult Earth Dragon, Adult River Dragon, Adult Shadow Dragon, Ancient Earth Dragon, Ancient River Dragon, Ancient Shadow Dragon, Earth Dragon Wyrmling, River Dragon Wyrmling, Shadow Dragon Wyrmling, Young Earth Dragon, Young River Dragon, Young Shadow Dragon

## Fatigue (18)

- **Level Up Advanced 5e**: spells (3): Dream, Greater Restoration, Raise Dead; items (1): Mask of Relentless Fury
- **Adventurer's Guide**: classes (1): Marshal
- **Level Up Advanced 5e Monstrous Menagerie**: monsters (12): Adult Earth Dragon, Adult River Dragon, Adult Shadow Dragon, Ancient Earth Dragon, Ancient River Dragon, Ancient Shadow Dragon, Earth Dragon Wyrmling, River Dragon Wyrmling, Shadow Dragon Wyrmling, Young Earth Dragon, Young River Dragon, Young Shadow Dragon
- **Tome of Beasts**: monsters (1): Broodiken

## Rattled (21)

- **Level Up Advanced 5e**: spells (5): Confusion, Contagion, Power Word Stun, Sleep, Slow; feats (1): Fear Breaker
- **Level Up Advanced 5e Monstrous Menagerie**: monsters (15): Abominable Snowman, Arcane Blademaster, Archmage, Assassin, Flesh Guardian, Frost Giant, Frost Giant Jarl, Half-Shadow Dragon Assassin, Hydra, Intellect Devourer, Lich, Master Assassin, Pyrohydra, Spymaster, Yeti

## Expertise dice (61)

- **Level Up Advanced 5e**: spells (2): Guidance, Resistance; feats (8): Ace Driver, Battle Caster, Combat Thievery, Crafting Expert, Empathic, Fear Breaker, Monster Hunter, Surgical Combatant; backgrounds (1): Exile; items (30): Ancient Broom, Archaic Creed, Badge of Seasons, Barbed Devil’s Bracelet, Bead of Tracking, Celestial Aegis, Crafter’s Codex, Cunning Tools, Deck of Many Things, Devil’s Eye Ring, Dungeon Delver's Guide, Earth Charm, Eye of Elsewhere, Focusing Eye, Friendly Joybuzzer, Hopeful Slippers, Jade Tiger, Jarred Brain, Mask of the White Stag, Maternal Cameo, Paramour’s Daisy, Plague Doctor's Mask, Raiment of the Devouring King, Satyr Boots, Scrap of Forbidden Text, Seafarer's Quill, Seven-Sided Coin, Spellcasting Symphony, Wand of Elocution, Wood Woad Amulet
- **Adventurer's Guide**: classes (1): Marshal; subclasses (2): Gambling General, Talented Tactician
- **Dungeon Delver’s Guide**: backgrounds (1): Dungeon Robber
- **Gate Pass Gazette**: backgrounds (1): Cursed
- **Level Up Advanced 5e Monstrous Menagerie**: monsters (15): Adult Brass Dragon, Alchemist, Ancient Brass Dragon, Cosmopolitan Alchemist, Gladiator, Hobgoblin Captain, Hobgoblin Warlord, Holy Knight, Knight, Knight Captain, Merfolk Knight, Mountain Dwarf Defender, Mountain Dwarf Lord, Pirate Captain, Shadow Elf Spellcaster Drider

## Exertion (14)

- **Level Up Advanced 5e**: feats (11): Combat Thievery, Deadeye, Fear Breaker, Martial Scholar, Monster Hunter, Mounted Warrior, Natural Warrior, Powerful Attacker, Spellbreaker, Surgical Combatant, Swift Combatant; items (1): Sword of Three Traditions
- **Adventurer's Guide**: classes (1): Marshal; subclasses (1): Talented Tactician

## Maneuvers (15)

- **Level Up Advanced 5e**: spells (1): Mental Grip; feats (10): Bull Rush, Fear Breaker, Martial Scholar, Monster Hunter, Mounted Warrior, Natural Warrior, Powerful Attacker, Spellbreaker, Street Fighter, Surgical Combatant; items (3): Schooled Weapon, Sword of Three Traditions, Tome of the Spellblade
- **Adventurer's Guide**: classes (1): Marshal

## Bloodied (49)

- **Level Up Advanced 5e Monstrous Menagerie**: monsters (49): Aboleth, Adult Amethyst Dragon, Adult Earth Dragon, Adult Emerald Dragon, Adult River Dragon, Alpha Werewolf, Ancient Aboleth, Ancient Amethyst Dragon, Ancient Earth Dragon, Ancient Emerald Dragon, Ancient Green Dragon, Ancient River Dragon, Ancient Shadow Dragon, Berserker, Cave Ogre, Clay Guardian, Dead Mans Fingers, Djinni, Djinni Noble, Elder Vampire, Fallen Solar, Fire Giant, Fire Giant War Priest, Flesh Guardian, Forgotten God, Great Wyrm Green Dragon, Hill Giant, Hill Giant Chief, Hobgoblin Warlord, Horde Demon, Horned Devil, King Fomor, Marid, Marid Noble, Ork Urk, Pit Fiend, Pit Fiend General, Sea Serpent, Solar, Storm Giant, Storm Giant Monarch, Tarrasque, Titanic Kraken, Werebear, Wereboar, Wererat, Weretiger, Werewolf, Wyvern

## Ley lines (18)

- **Deep Magic 5e**: spells (1): Torrent of Fire
- **Deep Magic Extended**: spells (5): Amplify Ley Field, Ley Disruption, Ley Sense, Ley Surge, Ley Whip
- **Kobold Press Compilation**: spells (4): Greater Ley Protection, Lesser Ley Protection, Ley Disturbance, Open Red Portal
- **Tome of Beasts**: monsters (2): Herald Of Blood, Ramag
- **Tome of Beasts 2**: monsters (2): Hverhuldra, Runeswarm
- **Tome of Beasts 3**: monsters (1): Ley Wanderer
- **Tome of Heroes**: subclasses (1): Rifthopper
- **Warlock Archives**: spells (2): Reassemble, Vengeful Panopy of the Ley Line Ignited
