# Roadmap

Phase 1 (done) delivered the fork foundation: accounts, campaigns with
invite codes and lobbies, structured SRD 5.1 character sheets, the
server-side dice engine, the SSE real-time layer, and the AI Dungeon Master
tool loop with server-enforced rolls.

Later phases, roughly in order of value:

## Phase 2: Combat engine

- Structured combat mode: initiative order, strict turn ownership, round
  tracking; the DM opens combat via a tool call and the server enforces
  whose turn it is
- Action economy: action, bonus action, reaction, movement tracking
- Conditions with mechanical effects (advantage/disadvantage wiring)
- Death saves, temporary HP, concentration checks
- Timeouts with skip/delay/auto-dodge options

## Phase 3: Encounters and monsters

- SRD monster stat blocks (CC-BY-4.0) as structured data the server owns
- Encounter builder respecting party level, size, and difficulty
- DM-driven sheet mutations via tool calls (damage, healing, conditions,
  loot, gold) with an audit log instead of player-only edits
- Loot generation rules

## Phase 4: Spells and progression

- Full SRD spell database with slot enforcement server-side
- XP awards, leveling flow, milestone leveling option
- Ritual casting, concentration duration tracking

## Phase 5: World persistence

- Quest tracker UI backed by structured quest objects
- NPC memory layer (first impressions, trust, debts, promises)
- Faction reputation
- Dynamic economy and merchant inventories
- Layered memory: session summaries as first-class records

## Phase 6: GM tools and polish

- Owner console: pause the DM, edit memories, inject events, override
  rolls, spawn NPCs
- Session recaps generated at the end of a play session
- Per-player whispers and private rolls
- Campaign export/import
- Multiple DM personalities
- Split the solo-mode monolith (src/app/solo/page.tsx) into components
- Remove the vestigial mflux/sdnq image backend enum values

## Known limitations of Phase 1

- Combat is narrative only; initiative and turn order are not enforced
- The DM cannot change character sheets; players adjust their own HP,
  slots, and conditions
- Prepared spells are free-text names; nothing stops a wizard from writing
  in Wish (the DM prompt pushes back, but the server does not)
- One character per player per campaign
- The Ollama provider works but calls the dice tool far less reliably than
  the OpenAI-compatible path
