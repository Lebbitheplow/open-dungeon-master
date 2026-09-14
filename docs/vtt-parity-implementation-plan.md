# Implementation plan: closing the gaps in docs/vtt-feature-gap-report.md

Dated 2026-09-13, against 0.18.0. This is the build plan for every "Missing,
build", "Partial" and "behind the field" verdict in the gap report that
concerns the game, the world, the workshop and the way they look. Help
content, localisation, the help centre and the docs site are out of scope by
request. Presentation is in scope and is held to a higher bar than the rest:
every visual in this plan is tied to a fact the engine already knows, moves
with one easing family, respects reduced motion, and is specified to the
duration.

The plan is written to the house rules the earlier plans committed to
(`docs/workshop-plan.md` section 8, `docs/human-dm-plan.md` "Conventions"):
the engine owns the numbers, the model and the human narrate; a prep object
is one the engine runs; pick, do not type; nothing is drag-only because the
phone has no hover; every change ships with a test under `scripts/` and is
registered in `scripts/test-all.mjs`; every new DM tool exists in both the AI
tool family and the human DM's adjudication catalog
(`src/lib/dm/invoke-catalog.ts`), which the phase 4b guard test enforces.

---

## 0. Foundations every workstream uses

### 0.1 Schema changes

Tables are created in `src/lib/db/core.ts`; new columns on existing tables
go through the column-ensure loop near line 1160 (the `PRAGMA table_info`
check), which is how `lore_entries.visibility` and `image_path` arrived.
New tables get a `CREATE TABLE IF NOT EXISTS` block beside their siblings.
Every JSON column is validated by a zod schema under `src/lib/schemas/`
before it is written, and every reader normalises a missing column to a
default so an old database opens unchanged.

### 0.2 Events

`src/lib/events.ts` publishes per campaign: `publishPersisted` for anything
a reconnecting client must replay, `publishEphemeral` for anything that only
matters live. `useCampaignStream.ts` is the single client consumer. This
plan adds one persisted family and one ephemeral family:

- `scene_state` (persisted): weather, hour, ambient light, active overlays.
  Replayable so a late joiner sees the same sky.
- `fx` (ephemeral): a visual effect to play once. Never replayed, never a
  source of truth. Shape in section 1.3.

### 0.3 Projections

`src/lib/dm/viewer.ts` decides who sees what. Every new field that carries a
DM secret (real HP, hidden tokens, secret door state, DM-only labels, a
private handout, a lair action budget) is projected through `viewerCaps`,
never filtered in the client. The board's player projection is built in
`src/lib/battlemap/view.ts`; every new board field is added there with an
explicit `forViewer` branch.

### 0.4 Tools

An AI tool is declared in one of `src/lib/dm/catalog-*.ts`, handled in a
`*-tools.ts` module, and mirrored as an adjudication in
`invoke-catalog.ts`. Every tool in this plan lists its handler module. Tools
that only change presentation (a weather change, a camera pull) still go
through the server, because the server is the only thing all clients agree
with.

### 0.5 Tests

Pure logic gets a `scripts/test-<name>.mjs` against the module with no
database. Anything that touches a table gets an integration script against
a scratch `SQLITE_DB_PATH`. Both are listed under each workstream and are
the acceptance gate. Presentation gets a deterministic test where one is
possible (the FX planner is pure; the CSS is not tested).

### 0.6 The design language, restated for motion

`src/app/globals.css` already defines the palette (indigo stone, gold amber,
ember), `--ease-snap`, four animation tokens and glow shadows. This plan
adds a motion scale and uses nothing outside it:

| Token | Value | Use |
| --- | --- | --- |
| `--dur-instant` | 90ms | hover, focus, chip toggles |
| `--dur-quick` | 180ms | token nudge, HUD open, tooltip |
| `--dur-move` | 260ms | token move per tile, card reveal |
| `--dur-beat` | 420ms | hit flash, damage number rise, door swing |
| `--dur-scene` | 900ms | weather change, light change, title card in |
| `--dur-linger` | 1600ms | title card hold, aura pulse cycle |
| `--ease-snap` | existing | almost everything |
| `--ease-settle` | `cubic-bezier(0.22, 1, 0.36, 1)` | things landing (token arrival, dice) |
| `--ease-drift` | `cubic-bezier(0.45, 0, 0.55, 1)` | weather, ambient light, slow pans |

Rules. One motion at a time on any element. Nothing loops except the
current-turn ring, the aura breathing and weather. Light comes from gold;
danger comes from ember; nothing else glows. Every animation is inside
`@media (prefers-reduced-motion: no-preference)` or has a static
equivalent, and the two existing reduced-motion blocks in `globals.css`
remain the master switch. Performance budget on the board: at most 24
animated SVG nodes at once, particles on a single `<canvas>` overlay
capped at 400 sprites, all effects skipped when `document.hidden`, and a
"low effects" toggle in device settings (`DeviceSettings.tsx`) that also
switches on automatically when `navigator.deviceMemory` is under 4.

---

## 1. Workstream A: the board as a stage

Goal: the live battle map reads like a premium tabletop rather than a
diagram, and every visual states a fact the engine has.

### 1.1 Board view fields

`src/lib/battlemap/view.ts` `BoardView` grows:

```ts
tokenConditions?: Record<string, Array<{ id: string; label: string; rounds?: number }>>;
tokenHealth?: Record<string, "unharmed" | "scratched" | "bloodied" | "critical" | "down" | "dead">;
tokenAuras?: Record<string, Array<{ id: string; radiusFeet: number; tone: "ward" | "harm" | "bless" | "neutral" }>>;
tokenFootprint?: Record<string, 1 | 2 | 3 | 4>;   // squares per side from EnemyStats.size / race size
tokenElevation?: Record<string, "ground" | "flying" | "burrowing">;
turn?: { tokenId: string; round: number };
targets?: Record<string, string[]>;               // attacker token -> target token ids this turn
```

Sources. Conditions come from `character_sheets` conditions and
`encounter_enemies` conditions through `condition-logic.ts`; auras from
`active_effects` rows whose `modifiers_json` carries a `radiusFeet` (add the
field; Aura of Protection writes it, Spirit Guardians and Bless-style effects
opt in); footprint from `sizeForRace` and `EnemyStats.size`; elevation from
the sheet's current movement mode (new column `battle_tokens.movement`,
`walk | fly | burrow`, set by a `set_movement` tool and by Wild Shape into a
flying form); `targets` from the last `pc_attack` and enemy attack results
stored on the encounter row for the current round.

Projection. `tokenHealth` for enemies is a word for players and a word plus
`tokenHp` for the DM seat; `viewerCaps.seesEnemyNumbers` decides. Thresholds
are a pure function in `src/lib/battlemap/health-words.ts`: above 90 percent
unharmed, above 50 scratched, above 25 bloodied, above 0 critical, 0 and
saving is down, dead is dead. Test: `scripts/test-health-words.mjs`.

### 1.2 Rendering

`BattleMapGrid.tsx` gains four SVG groups in order: `auras` (under tokens),
`tokens`, `badges` (over tokens), `fx` (top, section 1.3). Everything stays
memoised on `view` identity.

- **Footprint.** A token with footprint 2 draws a 2 by 2 rounded square with
  the portrait centred; the LOS and movement engines already know size for
  reach, so `movement.ts` gains `occupiedTiles(token)` and the pathfinder
  refuses a path where any occupied tile is blocked. Test:
  `scripts/test-footprint-move.mjs`.
- **Condition badges.** Up to four 14 px glyphs on the token's lower edge,
  from a new `src/lib/battlemap/condition-glyphs.ts` mapping every SRD
  condition and registry buff to a Lucide icon and a tone. More than four
  collapses to a count chip; tapping the token lists them all with rounds
  remaining. Glyphs are drawn as `<use href="#cond-poisoned">` from one
  `<defs>` block so forty tokens cost forty references, not forty paths.
- **Auras.** A circle at `radiusFeet / 5` tiles, 1.5 px stroke in the tone
  colour at 55 percent, fill at 8 percent, with a `--dur-linger` breathing
  animation on opacity between 6 and 12 percent. Two auras on one token
  stack outward with a 2 px gap.
- **Health ring.** The HP bar stays for the DM seat. Players get the health
  word as a thin ring around the portrait whose stroke colour walks emerald,
  amber, ember, and a dashed grey ring for down. Dead tokens desaturate
  through a CSS filter and drop to 55 percent opacity.
- **Turn marker.** The current token's existing pulse is replaced by a gold
  ring with a slow rotating dash pattern (`stroke-dashoffset`,
  `--dur-linger`) and a soft `--shadow-glow-gold` through an SVG filter.
  Round number sits in the tracker, not on the board.
- **Targets.** A hairline from attacker to each target for the duration of
  the turn, ember for enemies targeting players, gold for the reverse,
  fading out with the FX event that resolves it.
- **Elevation.** Flying tokens lift 3 px with a soft shadow ellipse below
  and a small wing glyph; burrowing tokens sink into a dashed outline.
- **Movement tween.** Tokens are keyed by id and positioned by a CSS
  `transform` on the `<g>`, transitioned over `--dur-move` per tile (capped
  at 4 tiles worth) with `--ease-settle`. Path-following: the server
  already returns the path from `move`; the client animates through the
  waypoints with `offset-path` where supported and falls back to a straight
  tween. The pick-up-then-tap model stays; drag becomes a second way (section
  10).
- **Camera.** The player SVG gains the same zoom and pan the editor has
  (wheel at cursor, pinch, corner buttons) and a `follow turn` toggle that
  pans over `--dur-scene` with `--ease-drift` to the current token when it
  is off screen. The DM seat gets `pull everyone here` which publishes an
  ephemeral `camera` event; clients obey once, then are free again.

### 1.3 The FX layer and the effect planner

Every visual effect is planned on the server from a resolved outcome and
sent as one ephemeral `fx` event. The client never guesses.

```ts
type FxEvent = {
  id: string;
  kind: "attack" | "spell" | "heal" | "condition" | "death" | "door" | "hazard" | "template" | "ping";
  from?: { x: number; y: number };          // tile
  to?: { x: number; y: number } | Array<{ x: number; y: number }>;
  outcome?: "hit" | "miss" | "crit" | "fumble" | "save" | "fail" | "half";
  damageType?: DamageType;                    // fire, cold, radiant, ... from spell-mechanics
  school?: SpellSchool;
  amount?: number;                            // shown as a floating number
  shape?: { kind: "sphere" | "cone" | "line" | "cube"; sizeFeet: number; tiles: Array<{x:number;y:number}> };
  sting?: string;                             // ambience sting cue id
};
```

Planner: `src/lib/battlemap/fx-plan.ts`, pure, called from exactly four
places: `pc-attack.ts`, `enemy-attack.ts`, `cast-tools.ts` (buffs, saves,
areas) and `hazard-tools.ts`, plus `door` from the door handler and `death`
from `death-logic.ts`. It maps outcome and damage type to a palette entry
and a sting. Test: `scripts/test-fx-plan.mjs` asserts a nat 20 plans
`crit`, a fire spell plans `fire`, a save-for-half plans `half` on each
target that saved, and that no FX is planned for a roll the viewer cannot
see (blind rolls plan nothing).

Rendering, in `src/app/campaigns/[campaignId]/BoardFx.tsx`, a sibling of
the grid that reads a queue and plays at most one effect per token at a
time:

- **Attack, melee.** A 6 px arc swing at the target tile in the attacker's
  tone, `--dur-quick`. Hit: the target portrait jolts 2 px away from the
  attacker and back (`--dur-beat`, `--ease-settle`) with an ember rim
  flash. Crit: the same, plus a gold shard burst (8 triangles, 220ms) and
  the floating number in display type at 1.4 scale. Miss: a pale slash
  passing beside the token and a small "miss" caption. Fumble: the
  attacker's own token dips.
- **Attack, ranged.** A hairline bolt from attacker to target over 140ms
  with a 3 px head, then the hit or miss treatment.
- **Spell, single target.** A beam whose colour is the damage type
  (`src/lib/battlemap/damage-palette.ts`: fire ember, cold pale cyan,
  lightning white-violet, acid chartreuse, poison olive, necrotic violet-
  black, radiant gold-white, force lavender, psychic magenta, thunder grey
  with a ring, bludgeoning, piercing, slashing all bone) and a burst at the
  target of 12 sprites on the particle canvas. Healing is a gold-green
  bloom rising from the token base.
- **Spell, area.** The template tiles flash in the damage colour from the
  origin outward at 18ms per tile, then linger 600ms at 25 percent while
  each target shows `save`, `fail` or `half` as a caption. Concentration
  effects that persist keep a faint tile tint for their duration (data
  from `active_effects` with `area`).
- **Condition applied.** The condition glyph scales in from 0.6 at the
  token with a one-frame tone flash; removed fades out.
- **Death.** Portrait desaturates over `--dur-scene`, a ring collapses
  inward, a low sting.
- **Door.** A wedge sweeps open or shut over `--dur-beat`; a locked attempt
  shakes the door tile 2 px; a secret door found dissolves its wall
  texture into a door.
- **Hazard.** Falling: a shadow shrinks then the token drops in; fire and
  cold hazards reuse the spell palette.
- **Floating numbers.** Damage rises 18 px over `--dur-beat` and fades,
  ember for damage, emerald for healing, gold for crit; players see the
  number only when `viewerCaps` allows real enemy numbers, otherwise the
  health word changes and the ring recolours.
- **Sound.** Each FX carries a sting id resolved by `ambience/catalog.ts`;
  a new sting group (`sting.hit.melee`, `sting.hit.ranged`, `sting.crit`,
  `sting.miss`, `sting.spell.<type>`, `sting.heal`, `sting.door`,
  `sting.death`) is added to the catalog and `scripts/fetch-ambience.mjs`
  search list, ducked under narration like every sting.

Acceptance: a full round of combat produces one FX per resolved tool call,
none twice, none for redacted rolls; `document.hidden` drops the queue;
reduced motion plays only the caption and the ring change.

### 1.4 Token HUD

Tapping your own token on your turn opens a compact radial HUD anchored to
the token (six 40 px buttons in an arc, `--dur-quick` scale-in): Attack,
Cast, Dodge, Dash, Disengage, Help, plus Reaction when one is pending. Each
button is the existing composer action with the target pre-filled from the
tap that follows; the HUD is a shortcut to `take_action`, `pc_attack` and
`cast_*`, not a new path. The DM seat's HUD on any token is the existing
`TokenCard` actions plus Damage, Heal, Condition and Teleport, calling the
adjudication catalog. Files: `TokenHud.tsx`, wired through
`BattleMapPanel.tsx`; no engine change.

### 1.5 Teleport

`teleport_token` tool in `map-tools.ts`: moves a token without a path,
respects occupancy and hidden state, plans an FX of kind `spell` with a
misty-step violet. Catalogued for the human DM. Used by Misty Step, Dimension
Door and Thunder Step through `spell-mechanics.ts` `teleport: {selfFeet}`
data, and by the DM. Test: `scripts/test-teleport.mjs` (refuses a wall tile,
refuses out of range for a spell, allows any tile for the DM).

---

## 2. Workstream B: sky, weather, hour, scene

Goal: the world has weather and a time of day that the engine rolls, the
prompt reads, the ambience follows, the map lights, and the screen shows.

### 2.1 Weather engine

`src/lib/srd/weather.ts`, pure: `rollWeather(climate, season, previous,
rng)` returns `{ sky: clear | overcast | rain | storm | snow | fog | wind,
temperature: frigid | cold | mild | warm | hot, wind: calm | breeze | gale,
precipitation: 0..3 }` with persistence (60 percent chance to keep the sky)
and climate tables by genre preset (`genres.ts` gains a `climate` field:
temperate, arid, boreal, tropical, blighted). Mechanical riders, enforced:
heavy rain and fog give disadvantage on Perception by sight and light
obscurement in `los.ts` (dim beyond 60 ft in rain, 30 ft in fog); a gale
gives disadvantage on ranged attacks past 30 ft in `attack-logic.ts`;
frigid and hot feed `apply_hazard` extreme cold and heat automatically on a
long travel leg; snow is difficult terrain on the overworld travel pace.
Test: `scripts/test-weather.mjs` covers tables, persistence and each rider.

Storage: `clock.ts` (the `campaign clock` row) gains `weather_json`;
`world-tick.ts` rolls at each dawn the clock crosses and on every travel
leg of four hours or more; the DM gets `set_weather` in `catalog-world.ts`
and the human catalog. Prompt: a one-line block in `prompt.ts` after the
date ("A cold, driving rain; visibility is poor") so narration agrees with
the sky.

### 2.2 The hour lights the map

`calendar.ts` already has `dayPart` and `isDark`. `battle_maps.ambient` and
`prepared_maps.ambient` gain an `outdoors` flag (default true for generated
outdoor themes, false for dungeons and interiors). For outdoor maps the
effective ambient is derived from the hour at deploy and updated by
`clock_changed`: night is dark, dusk and dawn dim, day bright, overcast
caps at dim, storm at dim with a lightning flash FX every 20 to 60 seconds.
Indoor maps keep their authored ambient. The vision engine reads the
effective ambient, so darkvision matters at night outdoors. Test:
`scripts/test-ambient-by-hour.mjs`.

### 2.3 Sky and weather rendering

`SkyLayer.tsx` sits under the board and under the scene art:

- A gradient wash keyed to the hour: night deep indigo with the starfield
  the body already has, dawn a rose-gold band low on the frame, day
  neutral, dusk ember. Transitions over `--dur-scene` with `--ease-drift`.
- Weather on the particle canvas (the same canvas as spell bursts, one
  `requestAnimationFrame` loop): rain as 1 px streaks at two depths, snow
  as soft discs drifting, fog as three large translucent blobs sliding
  slowly, embers for blighted climates, motes of gold dust in bright
  forest daylight. Density from `precipitation`, direction from `wind`.
  Cap 400 sprites; low-effects mode uses 80 and no depth.
- A vignette that tightens at night by 8 percent.
- The ambience engine's bed follows: `ambience/logic.ts` `inferBedCue`
  gains weather and hour keywords so a storm picks the storm bed.

The scene art panel (`MapPanel.tsx` location art and the inline scene art
in `MessageList.tsx`) gets a slow Ken Burns drift (scale 1.0 to 1.06 over
40 seconds, alternating) and the same weather particles at half density
over the image, with a linear-gradient hour tint at 12 percent. This is the
Alchemy "animated scene" without a video asset.

### 2.4 Scene transitions and title cards

A `SceneTitle.tsx` overlay plays on three persisted events: chapter opened
(chapter name in display type over a dark scrim with the gold rule that
`Ribbon.tsx` draws, in over `--dur-scene`, hold `--dur-linger`, out over
`--dur-scene`), encounter started (the encounter name or "Ambush" with an
ember rule and the combat sting), and long rest completed (a dawn wash
with the date). The DM seat can arm a custom card through `show_title`
(text, tone, optional sting), catalogued. Cards are skipped on reduced
motion and replaced by a toast.

### 2.5 Camera pull and lock

`camera` ephemeral event: `{ mode: "pull" | "lock" | "free", x, y, zoom }`.
Pull pans everyone once. Lock keeps players' boards following the DM's view
until `free`; the client shows a small "the DM is steering the view" chip
with an escape hatch after ten seconds so nobody is trapped. DM control
lives in `DmBoardControls.tsx`.

---

## 3. Workstream C: the map engine's remaining mechanics

### 3.1 Terrain wall (the sixth tile)

Add tile `|` (low wall, fence, chasm edge): `blocksMove: true, blocksSight:
false`. Touch every consumer once: `paint.ts` alphabet and validator,
`stamp.ts`, `tools.ts` shape compilers, `uvtt.ts` (import "terrain" walls
and any wall shorter than the ceiling when the file carries heights),
`los.ts` (no sight block, but half cover to a creature directly behind
it), `movement.ts` (impassable unless flying), `generate.ts` (fences in
farmstead themes, railings in halls), `terrainDraw.ts` and the SVG cell
renderer (a thin double line), the DM prompt's map legend in
`map-tools.ts`. Test: `scripts/test-terrain-wall.mjs` and extend
`test-map-paint`, `test-uvtt-import`, `test-los`.

### 3.2 Senses in the light model

`los.ts` `canSee(viewer, target)` gains a `senses` argument: blindsight
(sees within range regardless of light, through fog and darkness, not
through walls), tremorsense (perceives ground tokens within range,
ignores flying tokens), truesight (sees through magical darkness and
invisibility within range). Monster senses already exist on `EnemyStats`;
PC senses come from feature effects (`feature-effects.ts` gains
`sense: {kind, feet}` for Blind Fighting, Devil's Sight, Ghostly Gaze).
The enemy attack engine and `check_notice` consult the same function so a
hidden rogue behind a wall of fog is still found by a bat. Test: extend
`test-los.mjs` with one case per sense.

### 3.3 Darkness sources and magical darkness

`prepared_maps` and `battle_maps` light zones (the `zones` scene column)
gain `kind: "light" | "darkness" | "magical_darkness"`. Darkness lowers the
tile to dark regardless of ambient; magical darkness also defeats
darkvision and is pierced only by truesight or Devil's Sight. `cast_buff`
for Darkness, Hunger of Hadar and similar writes a zone with the spell's
duration onto the live map through an `active_effects` row carrying
`area`, removed when concentration breaks (`concentration.ts
clearSpellConditions` gains area cleanup). Rendering: darkness zones are a
soft-edged black at 85 percent with a subtle inward churn on the particle
canvas for magical darkness. Test: `scripts/test-darkness-zones.mjs`.

### 3.4 Doors that sound and move

The door handler publishes `fx` kind `door` with `state`; the FX layer
sweeps the wedge and plays `sting.door.open`, `sting.door.close`,
`sting.door.locked`, `sting.door.secret`. A locked door tried by a player
token's move is refused by `movement.ts` with a sentence and the shake FX,
and the DM prompt is told so the model can offer the lock or the key.

### 3.5 Map notes on the battle map

The `labels` scene column gains an optional `ref: { kind: "lore" | "npc" |
"monster" | "table", id }`. A label with a ref renders with a small gold
pin glyph; tapping opens the referenced entry in a `Sheet` for whoever the
entry's visibility allows. DM-only labels stay DM-only. The place-to-map
link the audit left out lands here too: `locations` gains
`prepared_map_id` and `ambience_json`; `move_party` into a place with a map
offers the DM seat a one-tap deploy and sets the bed. Test: extend
`test-map-scene.mjs` and `test-content-import.mjs` (refs renumber on
import).

### 3.6 Freehand annotations

A `drawings` scene column: `{ id, kind: "stroke" | "arrow" | "rect" |
"ellipse", points, tone, dmOnly, ttlRounds? }`. Drawn on the live board by
the DM (and by players when `viewerCaps.canDraw`, a new campaign setting
default on) with the existing pointer model; strokes simplify with
Ramer-Douglas-Peucker to at most 64 points server-side; a `ttlRounds`
lets a plan-of-attack arrow vanish after the round. Rendered as a soft
2 px line with a 6 px 20 percent halo in the author's colour. Not a
mechanic; not fogged (a drawing is a shared intention, not a fact), but
DM-only drawings are projected out. Test: `scripts/test-drawings.mjs`
(simplification, cap, projection).

### 3.7 Image alignment with handles

The backdrop register (four sliders today) gains a direct-manipulation
mode: two draggable corner handles on the editor canvas set the image
transform, with a snapped grid overlay and a live "one square is N px"
readout. The sliders remain for fine work and phones; the handles are the
first drag-and-drop in the app and use the shared drag hook from section
10.

---

## 4. Workstream D: combat depth

### 4.1 Legendary actions, lair actions, legendary resistance

`EnemyStats` gains `legendary: { actionsPerRound, resistances, actions:
Array<{ name, cost, text }> }` and `lair: { initiative: 20, actions: [] }`,
filled by the bestiary editor's existing legendary section (the tagged
lines become rows with a cost). Engine: `action-budget.ts` learns a
legendary pool per enemy per round that refills at the start of that
enemy's turn and is spent by a new `legendary_action` tool (enemy id,
action name, target) callable only at the end of another creature's turn,
which `initiative.ts` exposes as a hook. Legendary resistance: on a failed
save `cast_tools` offers the model a `legendary_resist` choice only while
the counter is above zero; the human DM sees the counter on the tracker.
Lair actions: at initiative count 20 the encounter inserts a `lair` turn
when the map or template flags a lair; the DM or model picks one. The
tracker shows a violet crown pip per remaining legendary action and a
shield pip per resistance. Tests: `scripts/test-legendary.mjs`.

### 4.2 Encounter statistics

`finishEncounter` in `enemy-damage.ts` already runs at the end of a fight.
It gains a summary computed from `sheet_audit` and `rolls` for the
encounter's span: damage dealt and taken per character, healing, kills,
natural 20s and 1s, rounds, time. Stored in `encounters.summary_json`,
shown as an "After the fight" card in the message list with small gold
stat tiles (display numerals, eyebrow labels) that fade-up in sequence, and
carried into the chapter summary. Test: `scripts/test-encounter-summary.mjs`.

### 4.3 Your turn

On `encounter_updated` where the current token belongs to the viewer, play
`sting.turn` once and pulse the composer's border gold for `--dur-beat`.
Opt-out in device settings. No server change.

### 4.4 Shared targeting

`pc_attack` and `cast_*` already name targets; the encounter row stores the
current round's `targets_json` (section 1.1) so every client draws the
hairlines. A player may pre-target from the HUD before their tool call;
that is client state until the call, then it is fact.

---

## 5. Workstream E: the binder becomes a wiki with a stage

### 5.1 Secret blocks and per-player visibility

`Markdown.tsx` learns a fenced block:

```
:::secret
Only the DM reads this.
:::
```

The renderer drops secret blocks in any projection that is not the DM
seat; the lore body is otherwise unchanged. `lore_entries` gains
`audience_json`: `null` for the table, or an array of user ids. The Lore
tab and `search_lore` filter by audience through `viewer.ts`; the DM
prompt sees everything. The editor's visibility control grows a third chip
"some players" with a member picker. Tests: extend `test-lore-links.mjs`
with secret blocks and a projection case; extend `test-lore-visibility`
if present, else add.

### 5.2 Show this now

`show_handout` tool (lore id or an uploaded image path, optional caption)
publishes a persisted `handout_shown` event; every allowed client opens the
handout in `ImageLightbox` or a parchment sheet (section 5.6) with a
`--dur-scene` fade and a paper-unfold scale from 0.96. Persisted so a late
joiner sees it in the log; the DM can `dismiss`. Catalogued for the human
DM; the AI may call it only for entries marked party-visible. Test:
`scripts/test-show-handout.mjs` (a DM-only entry is refused).

### 5.3 PDF pages

`lore_entries` gains `attachment_path`; the upload guard
(`uploads.ts`) accepts `application/pdf` up to 25 MB for the DM seat. The
entry renders the PDF in an `<iframe>` with the browser viewer inside the
Sheet, and the text layer is extracted once with `pdf-lib` plus a small
text extractor into `rule_chunks` when the entry is tagged `rules`, so a
sourcebook the table owns feeds Ask and retrieval (the gap report's PDF
sourcebook item). Test: `scripts/test-pdf-attachment.mjs` (size cap, type
check, chunking).

### 5.4 Backlinks, autocomplete, preview

`lore-search.ts` already parses `[[links]]`; a `backlinksFor(entryId)`
query over bodies of lore, NPC notes and beats renders as a "Mentioned in"
list on the entry. The lore editor's textarea gets a `[[` autocomplete
popover (the `AddFromList` component in inline form, filtered as you type,
Enter inserts). A split preview toggle renders the markdown live beside
the textarea above `lg` and as a tab below it. No schema change.

### 5.5 Timeline and relationship graph

`TimelinePanel.tsx`: a read-only vertical timeline built from chapters,
`world_facts` with a date, `scheduled_sessions`, calendar events (section
7.2) and world arcs, on the in-world calendar axis; each row a card with
the chapter's summary line; the party marker at "now". Filters by kind.
Below `lg` it is a list; above it is two columns with a centre rule in
gold.

`RelationGraph.tsx`: the fetched but undrawn `RelationGraph` becomes an SVG
force layout (a small pure simulation in `src/lib/npcs/graph-layout.ts`,
deterministic from a seed so it does not jump), nodes as portrait discs,
edges as lines with a mid-label, mutual edges solid, one-sided edges
dashed, factions (section 6) as translucent hulls. Tap a node to open the
NPC. Test: `scripts/test-graph-layout.mjs` (determinism, no overlap
beyond threshold).

### 5.6 Handout presentation

A `Parchment` variant for `Markdown.tsx`: cream paper texture from the
existing noise SVG, deckled edge mask, serif body, a wax-seal tone chip for
the author, optional "found" stamp. Every party-visible lore entry with the
`handout` category renders this way in the Lore tab and in Show this now.
A second style, `Notice` (wanted poster: heavy display type, torn edge),
picked in the entry editor. Inline rolls `[[1d6]]` in handouts and house
rules render as a chip that rolls through `POST rolls` (public) when
tapped; the rules chunker leaves the marker in place.

### 5.7 Quest objectives by hand

The quest log is arc-derived; a human DM needs to write one. `campaign_pins`
already holds structured pins; add a `quests` table `{ id, campaign_id,
title, status, objectives_json, source: "arc" | "dm", visibility }`. The AI
arc compiles into it as today; the DM edits objectives and ticks them; a
ticked objective the model can read shows in the prompt's quest block.
Test: `scripts/test-quests.mjs`.

---

## 6. Workstream F: factions and reputation

`factions` table `{ id, campaign_id, name, blurb, goal, attitude_to_party,
power, tags_json, portrait_path }`. `npcs.faction_id`. `party` gains
`reputation_json` keyed by faction id, an integer from minus 5 to 5.
Engine: `social.ts socialCheckDc` adds a faction offset when the NPC has a
faction; `npc-agency.ts` advances faction goals once per chapter the way it
advances NPC goals and writes a world fact; `world-arc.ts` may bind an arc
to a faction so an arc beat moves faction power. Tools: `adjust_reputation`
(faction, delta, reason) and `faction_note`, both catalogued. Workshop: a
Factions system card (fourteenth) with a form editor, portrait, member list
drawn from NPCs, and a reputation ladder preview; the storyboard gains a
`faction` card kind that compiles to a row. Prompt: a factions block after
NPCs, DM-only power and goal, player-safe attitude. Rendering: faction
crest chip on NPC rows and on the relation graph hulls. Tests:
`scripts/test-factions.mjs` (DC offset, agency tick, import renumbering).

---

## 7. Workstream G: time, calendar, events

### 7.1 Calendar editor and pack months

`calendar.ts` `CalendarDefinition` is already data. Store a campaign's own
definition in `clock.ts` as `calendar_json` (null means the preset); world
packs gain an optional `calendar` block (`worlds/schema` and
`draft-check.ts`) so a pack names its months and moons. Workshop Rules
system gets a Calendar section: month rows (name, days), weekday names,
moons (name, cycle days, offset), festival rows (month, day, name), all
with pick-from-preset. `formatDate` and `describeInstant` read moons and
festivals so the prompt says "the night of the Harvest Moon". Test: extend
`test-calendar.mjs`.

### 7.2 Calendar events and reminders

`calendar_events` `{ id, campaign_id, at_instant, title, body, visibility,
repeat: none | yearly | monthly, fired }`. The world tick fires events the
clock crosses: a DM-only event becomes a director nudge; a party-visible
one becomes a world fact and a title card. Timeline (5.5) reads them. The
DM seat and the workshop author them in the Calendar section.

### 7.3 Torch and spell timers

A light source carried by a token (`battle_tokens.light_radius`) gains
`burns_until` in clock minutes when lit from a torch or Light spell; the
condition tick expires it and the FX layer gutters the light out over
`--dur-scene`. The party panel shows a small burning-down bar on the
carrier. Test: `scripts/test-light-timers.mjs`.

---

## 8. Workstream H: voices, faces and speaking as

### 8.1 Speaking as

The DM composer (`DmActionForm.tsx` narrate mode) gets a speaker picker:
Narrator, or any NPC from the cast, or a monster on the board. The message
row stores `speaker_json { kind, id, name }`; `MessageList.tsx` renders NPC
speech with the portrait at the left, name in eyebrow caps, the line in a
speech tone, entering with `--animate-fade-up`. The AI's narration is
parsed for quoted dialogue attributed to a known NPC name (a pure
`attributeSpeech()` in `src/lib/dm/speech.ts`, conservative: requires the
name within eight words of the quote) so AI tables get the same portraits.
Test: `scripts/test-speech-attribution.mjs`.

### 8.2 Per-NPC voices

`npcs.voice_json { voiceId, speed, pitch }`; the NPC forge offers a voice
picker with a preview (Kokoro's voice list in `tts-voices.ts`, filtered by
an age and tone tag). `tts.ts` renders a message as segments: narrator
voice for prose, the NPC's voice for attributed speech, concatenated on the
media queue. The transcript keeps one message; the audio has several
voices. Test: `scripts/test-tts-segments.mjs` (segmentation is pure).

### 8.3 Theatre inserts

When a message carries attributed speech and the campaign's `presentation`
setting is `theatre`, the speaking NPC's portrait slides in at the lower
edge of the scene art (`--dur-move`, `--ease-settle`), stays while their
lines play, and slides out. Two speakers sit left and right. This is the
Alchemy and Theatre Inserts look, driven by data the table already has.

---

## 9. Workstream I: safety, tone and strictness

### 9.1 Safety tools

Campaign settings gain `safety: { xCard: boolean, lines: string[], veils:
string[], boundaries: "family" | "standard" | "mature" }`, authored in the
creation wizard's Feel step and the lobby. Engine:

- **X-card.** A button in the composer's utility strip for every player,
  always visible, no confirmation. `POST safety/x-card` pauses the DM turn
  queue (`queue.ts` gains a `paused` reason), publishes an anonymous
  persisted `x_card` event, and the DM seat (human) or the lead (AI table)
  sees "Someone raised the X-card" with three actions: rewind the last
  narration (the existing chapter-rewind path for one message), reroll it
  with the guidance "avoid the last subject", or continue. Players see a
  calm gold-scrim overlay "The table is taking a breath" with no attribution.
- **Lines and veils.** Ride into the prompt as a hard-constraint block
  before the engine boundary block; the narration guard gains a check that
  refuses a narration containing a line's keywords and requests one
  rewrite, the same path it uses for a hit written on a miss.
- **Boundaries** map to a stock block of tone limits and to the image
  prompt negative terms in `image-generate.ts`.

Tests: `scripts/test-safety.mjs` (queue pause and resume, anonymity in the
projection, guard refusal).

### 9.2 Strictness and tone

`gm: { strictness: "lenient" | "standard" | "harsh", tone: string[] }`.
Strictness shifts the difficulty ladder in `srd/dc.ts` by minus 2, 0, plus
2, biases `npc_reaction` by one step, and swaps a prompt block. Tone is up
to three chips (grim, hopeful, whimsical, epic, intimate, pulpy, eerie,
political) that become prompt adjectives and weight the ambience music
picker. Both editable mid-campaign by the lead. The multiple DM
personalities item on the roadmap is a preset over these two fields plus a
narrator voice, stored as `library_personalities` and offered in the
wizard. Test: `scripts/test-strictness.mjs`.

---

## 10. Workstream J: the editors become editors

Applies to the battle map editor, the region map, the live board, and
every list. All of it is client work over existing routes except the two
route additions named.

### 10.1 Selection model

A shared `useSelection()` hook and a `SelectionBar` component. Tapping a
placed label, prop, light, zone, door, pin, line or drawing selects it
(gold 2 px outline, `--dur-instant`); a compact action bar floats above it
(Edit, Move, Duplicate, Delete, and Link for labels) with 40 px targets.
Edit opens the value dial pre-filled. Move enters a one-shot "tap the new
tile" state and also accepts a drag. Arrow keys nudge one tile on desktop.
Shift-tap extends the selection; a marquee (drag on empty canvas with the
Select tool) selects many; the bar then offers Delete and Move as a group.
Escape clears. The region map gets the same for pins, places, labels and
lines (a line selects whole and can have a point dragged).

### 10.2 Drag as a second way

`useDrag()` hook with pointer events, 8 px threshold, a ghost at 70 percent
opacity, drop targets highlighted gold, Escape cancels. Used by: token move
on the live board (drag ends where the pick-up-then-tap would; the path
preview follows the pointer live), the storyboard card order (grid
reorder with a slot placeholder), the encounter roster order, the backdrop
corner handles, and dropping a portrait file onto a map or NPC card. Every
drag keeps its tap alternative.

### 10.3 Undo everywhere

`useUndoRing(key, size = 20)` stores the full object the server returned
after each patch; undo re-sends the previous object as a full replace on
the route (routes for prepared maps, region maps, lore, NPCs, tables,
encounters and beats gain `replace: true` semantics that validate the whole
object). Ctrl+Z and a toolbar button. The terrain painter's ring is folded
into the same hook.

### 10.4 One save model

Every editor moves to the plugin panel's model: local draft, debounced
700 ms autosave, `saving / saved / unsaved / not saved` badge in the sheet
header with `aria-live`, and a discard dialog on close while unsaved.
Explicit Save buttons remain only where a save is a semantic act (publish
a pack, save the monster block which recomputes CR, apply a ruleset).
Blur-to-save and change-to-save fields are removed.

### 10.5 The app's own dialogs

Replace every `window.confirm`, `alert` and `prompt` (about fifteen) with
`Dialog`, `InfoDialog` and `PromptDialog`. A lint rule
(`eslint.config.mjs` `no-restricted-globals`) keeps them out.

### 10.6 Region map parity with the battle map

Drag-paint with the radius brush, pan with a held Space or a two-finger
drag while a tool is in hand, corner zoom buttons, an undo ring, the
selection model, and the 90 ms full redraw replaced by a marker-only
overlay canvas so idle cost is near zero.

### 10.7 Toolbox and hotkeys

The thirteen chips become two grouped rows (Paint: brush, line, outline,
box, fill, stamp, pick; Scene: light, zone, door, label, prop, drawing;
Move stays a corner button) at 36 px targets with icons and labels. A `?`
key and a toolbar button open a hotkey overlay listing every key; hotkeys
extend to the region map (same letters) and the board (T target, Space end
turn when allowed, M map tab, C sheet). A Keys page in settings lists and
rebinds them, stored in the user's `settings_json`.

### 10.8 Objects panel

A collapsible list beside the map editor above `lg`, a sheet below: every
placed label, prop, light, zone, door, drawing with hover-to-highlight,
tap-to-select, multi-select checkboxes, bulk delete and bulk DM-only
toggle.

### 10.9 Grouped card lists

Tag filters and a sort on every workshop list; duplicate on beats and
tables; bulk select on rows (long-press on touch) with delete and tag.

---

## 11. Workstream K: commerce and the party's things

### 11.1 Shops

`shops` table `{ id, campaign_id, location_id, name, keeper_npc_id,
stock_json: Array<{ itemName, qty, priceCp, note }>, markup, buys:
boolean, restock_days }`. Prices default from the content pack's costs
through `currency.ts` with a markup by settlement size. Tools: `open_shop`
(creates or restocks from a roll table or a size preset), `buy_item`,
`sell_item`, both server-priced and clamped by the purse, writing the same
audit rows `grant_item` and `modify_gold` write. Human DM catalogued. The
workshop's places gain a Shops sub-list; the storyboard place card may
carry one. Presentation: a Shop sheet with the keeper's portrait, stock as
`QuickTile`s with price chips in gold, a haggle button that runs
`social_check` and adjusts the markup by one step, and coin FX (a small
gold arc into the purse) on purchase. Test: `scripts/test-shops.mjs`
(pricing, purse clamp, restock).

### 11.2 Player-to-player trade

`item_proposals` already carries DM-to-player proposals. Add `kind:
"trade"` with `from_character_id`, `to_character_id`, offered and requested
lines and coins; both players accept in a two-column trade sheet; the
server moves everything in one transaction with two audit rows. Test:
extend `test-item-proposals.mjs`.

### 11.3 Multiple characters per player

`campaign_members` gains `active_character_id`; `character_sheets` allows
several rows per user per campaign; the composer, party panel and turn
flow read the active one; a "switch character" control in the party panel
with a `--dur-quick` crossfade. Solo tables may set the party size to N and
build N sheets. Guards: one active at a time in initiative unless the
campaign setting `multiActive` is on. Test: extend
`test-workshop-integration.mjs` and `test-turns.mjs` if present.

---

## 12. Workstream L: generators and imports for the world

### 12.1 Settlement generator

`src/lib/overworld/settlement.ts`, pure and seeded: from a size (thorp to
city), a terrain and a genre it emits a place with a layout description,
three to eight NPCs through `npcs/forge.ts` field seeds, one to four
shops from 11.1 presets, two rumours as a roll table, and one hook card
for the storyboard. Offered on the region map's place form ("Populate")
and as a `generate_settlement` DM tool when the party arrives somewhere
unwritten and the world simulation is on. Test:
`scripts/test-settlement.mjs`.

### 12.2 Watabou import

`src/lib/battlemap/watabou.ts`: read One Page Dungeon JSON (rects, doors,
notes) into terrain, doors and labels; read the city generator's GeoJSON
into a region-map overlay of roads and a place with district labels. Same
shape as `uvtt.ts` and `azgaar.ts`. Test: `scripts/test-watabou-import.mjs`
with fixture files under `scripts/fixtures/`.

### 12.3 Bundles in the registry

The world registry manifest gains `bundles: []` entries pointing at
workshop bundle JSON files; the admin gallery lists them beside packs with
the same non-affiliation notice; install creates a workshop for the
installing user. No ratings.

---

## 13. Workstream M: the call and the room

### 13.1 Video

`src/lib/voice/peers.ts` and `room.ts` gain a `video` producer kind; a
campaign setting `voice.video` (off by default) and a per-user camera
toggle. Layout: a filmstrip of 96 px tiles along the top of the side panel
or a 2 by 2 grid in a `Drawer`, speaking tile ringed gold, the DM's tile
first. Bandwidth guard: 360p at 15 fps, simulcast off, and the SFU drops
video for a peer whose audio is already struggling. Test: the signalling
test extends to a video transport.

### 13.2 Table view

`/campaigns/[id]/table` renders the player projection of the board, the
scene art, the sky layer and the current title card with no chrome, meant
for a television at an in-person table. It authenticates as any member and
never shows DM data. Reads the same stream.

### 13.3 Transcription for human-DM tables

When `voice.transcribe` is on, `room.ts` forks each speaker's audio into a
30 second ring, and `stt` batches it to faster-whisper with speaker labels
(the SFU knows who is producing). Transcript lines land in a
`voice_transcript` table with speaker and clock, never in the DM prompt.
Story-beat capture (`beats.ts`) offers "draft a beat from the last five
minutes", and the chapter close can summarise from the transcript. The
whole feature is off by default and the lobby says out loud that the table
is being transcribed while it is on. Test: `scripts/test-transcript.mjs`
(batching and labelling are pure).

### 13.4 Dual-track recap

`recap.ts` renders twice through `viewer.ts`: the party recap from
player-visible facts and quests, the DM recap adding secret beats and
world arcs. The "Previously" card uses the party version for everyone but
the DM seat.

---

## 14. Workstream N: light theme, scale, keys

- **Theme.** A second token set in `globals.css` under `[data-theme="light"]`
  (parchment stone ramp, deep gold on cream, ember unchanged), OS preference
  by default, a toggle in settings and the account menu. Glass panels use
  a warm white with 60 percent alpha; the starfield becomes a faint paper
  grain. Every glow shadow has a light-theme value.
- **UI scale.** A `--ui-scale` root variable from 0.9 to 1.25 in settings,
  applied to `font-size` on `html`; the board and canvases ignore it.
- **Keys.** Covered in 10.7.

---

## 15. Workstream O: prompt and context edits that ride along

Every new fact needs a place in the prompt and a cost in the budget.
`context-budget.ts` gains sections with floors: `sky` (one line), `factions`
(up to 200 tokens, DM-only power), `quests` (replaces the arc's derived
list when a DM has written objectives), `safety` (hard block, stable,
ordered before the boundary contract so it is cached), `shop` (only while a
shop is open), `legendary` (in the combat block, per legendary enemy).
`engine-boundary.ts` adds three facts the engine owns: the weather and
hour, faction reputation, and shop prices. The narration guard learns the
lines-and-veils check (9.1). The context inspector shows the new blocks
with their cost like every other block.

---

## 16. Sequencing

Ordered so presentation lands early on the fact plumbing that already
exists, and so nothing waits on a schema change more than one phase back.

| Phase | Weeks | Contents | Depends on |
| --- | --- | --- | --- |
| 16 Foundations | 1 | Motion tokens, FX event and planner, particle canvas, low-effects mode, `scene_state` event, viewer projection stubs for every new field | none |
| 17 The board as a stage | 3 | Workstream A entire: view fields, badges, auras, health words, footprints, tween, camera, FX renderer, HUD, teleport | 16 |
| 18 Sky and scene | 2 | Workstream B: weather engine and riders, hour lighting, sky layer, scene art motion, title cards, camera lock | 16 |
| 19 Map mechanics | 2 | Workstream C: terrain wall, senses, darkness, door FX, map notes and place links, drawings, alignment handles | 17 |
| 20 Editors | 3 | Workstream J entire | 19 (selection covers new objects) |
| 21 Binder and stage | 2 | Workstream E: secrets, audiences, show now, PDF, backlinks, preview, timeline, graph, parchment, quests | 16 |
| 22 Voices | 1.5 | Workstream H: speaking as, per-NPC voice, theatre inserts | 21 (portraits in messages) |
| 23 Safety and tone | 1 | Workstream I | none |
| 24 Combat depth | 1.5 | Workstream D | 17 |
| 25 Factions and time | 2 | Workstreams F and G | 21 (timeline) |
| 26 Commerce | 1.5 | Workstream K | 25 (settlements reference factions) |
| 27 World generators | 1.5 | Workstream L | 26 |
| 28 The room | 2 | Workstream M | none |
| 29 Theme and scale | 1 | Workstream N | 20 (editor chrome settled) |
| 30 Prompt sweep | 0.5 | Workstream O, and a pass of `test-feature-coverage.mjs` | all |

Total about 25 weeks of focused work. Phases 21, 23 and 28 have no
dependency on the board and can run in parallel with 17 to 20.

---

## 17. Acceptance, per phase

Each phase closes only when:

1. Every test named in its workstream exists, passes, and is in
   `scripts/test-all.mjs`; the full suite is green in CI.
2. Every new DM tool is in the AI catalog and the human adjudication
   catalog, and the phase 4b guard passes.
3. Every new secret is projected in `viewer.ts` or `view.ts`, with a test
   that a player payload does not contain it.
4. Every animation is inside the motion scale, has a reduced-motion
   fallback, and the board stays under the node and sprite caps with forty
   tokens and a storm on a mid-range phone (measured once per phase with
   the Playwright rig in the store-screenshot harness, frame time under
   16 ms at the 95th percentile).
5. Content import and workshop bundles carry every new prep column
   (factions, shops, calendar, quests, drawings on prepared maps, map note
   refs), with `test-content-import.mjs` and `test-workshop-bundle.mjs`
   extended.
6. `docs/rules-coverage.md` gains a row for every enforced rider (weather,
   senses, legendary economy, darkness, terrain wall cover, strictness
   ladder, shop clamps) and `docs/ROADMAP.md` records the phase as
   delivered.
7. The client apps build and pass against the phase: the renderer bundle
   compiles (`scripts/build-renderer.mjs`), the Android `www` bundle
   builds, the desktop and Android test suites are green, and every
   screen the phase touched is checked on a phone through the app's
   native screens, not a browser. Section 18 lists what each phase owes
   the client repo.

---

## 18. Carrying every change into the client apps

The desktop and Android apps are not a browser onto the server. Since
client 0.8.0 they render the game as their own screens: the renderer's
game bundle (`src/renderer/game/index.tsx` in `open-dungeon-master-client`)
compiles the server's page components through the `@/` alias with Preact,
`runtime.ts` patches `fetch`, `EventSource` and media sources so
root-relative requests reach the host with a bearer token, and
`scripts/build-renderer.mjs` builds the CSS from the server's
`globals.css` with the Tailwind CLI. The apps vendor the server from git
HEAD through `bundle-server.mjs` and `mobile/scripts/bundle-android-payload.mjs`,
pruned by `scripts/prune-server-payload.mjs`. So the rule for this plan is:

**Every feature is built once, in the server repo's `src/app`,
`src/components` and `src/lib`, as client components that need nothing
from Next at runtime, and reaches the apps at their next bundle. The
client repo changes only when a feature needs a new route, a new runtime
patch, a new native capability, or a payload rule.** Each item below
names which of those it is.

### 18.1 Constraints on how server UI is written, so it compiles into the apps

- Pages and panels stay client components. No server components, no
  server actions, no `next/headers`, no `next/dynamic` with server-only
  loaders. The shims cover `next/link`, `next/navigation`, React, ReactDOM
  and the Radix portal; anything else from Next is unavailable in the
  bundle and fails the renderer build, which is the first client gate.
- Every request is root-relative (`/api/...`) so the fetch patch can route
  it to the host with the token. Absolute URLs bypass the token and break
  in the app.
- Every media source (audio cues, particle sprites, handout images, PDFs,
  TTS segments, video tiles) is set as a root-relative path on an element
  or through `new Audio(path)`, which the media patch turns into a
  token-fetched object URL. Streams that cannot be object URLs (the video
  tracks in 13.1, the SFU audio) come from WebRTC, not from a path, and
  are unaffected.
- New SSE event types need nothing from the client: `HostEventSource` is
  a fetch-backed stand-in that carries every event type through.
- Static assets that a feature ships (the sting set in 1.3, the condition
  glyph sprite in 1.2, the paper and deckle textures in 5.6, the light
  theme has none) live under `public/` and count against the client
  payload budget that `scripts/test-placeholders.mjs` enforces for
  placeholders. Extend that test's byte budget to cover a new
  `public/fx/` folder (cap 1.5 MB) and keep stings as short Opus files
  under 40 KB each. The ambience library itself is fetched at runtime and
  stays out of the payload.
- Window-level dialogs are already forbidden by 10.5; the desktop shell
  has no `prompt`, so the lint rule is also a client gate.

### 18.2 Client repo work by phase

| Phase | Client change | Kind |
| --- | --- | --- |
| 16 Foundations | `low effects` default on Android when `navigator.deviceMemory` is under 4 or the WebView reports no GPU rasterisation; expose `window.odm.deviceClass` from the bridge (`mobile/src/bridge.ts`) and `src/main` preload-free channel so the server UI can read it without user agent sniffing | native capability |
| 17 Board as a stage | Haptics on hit, crit and your-turn through a `window.odm.haptic(kind)` bridge call, backed by `@capacitor/haptics` (add the plugin) on Android and a no-op on desktop; the particle canvas must run under `requestAnimationFrame` only, since Electron throttles background windows and the WebView pauses hidden tabs, which `document.hidden` already covers | native capability |
| 18 Sky and scene | Nothing; title cards, sky and Ken Burns are CSS and canvas. Verify the WebView keeps hardware acceleration (`activity_main.xml` WebView, `android:hardwareAccelerated` on the application) so the gradient washes do not fall to software | verify |
| 19 Map mechanics | Nothing for the engine. Drawing strokes (3.6) and alignment handles (3.7) use pointer events, which both shells pass through; `touch-none` on the surfaces as today | none |
| 20 Editors | Keyboard hotkeys and the `?` overlay are desktop-only affordances and must keep their on-screen twins for Android; the key rebinding page stores in the user's settings on the host, so it follows the account into the app. Long-press bulk select (10.9) must not collide with the WebView's text-selection long-press: call `preventDefault` on `contextmenu` inside lists | verify |
| 21 Binder and stage | PDF pages (5.3) render in an `<iframe>` with the browser viewer in a plain browser; Electron renders PDFs natively in a `WebContentsView` but the Android WebView does not. Add `openDocument(path)` to the bridge that fetches with the token to the app's cache (`@capacitor/filesystem`, already present) and opens it with the system viewer; the server component calls `window.odm.openDocument` when present and falls back to the iframe. Show this now (5.2) also fires a local notification when the app is backgrounded, through `@capacitor/local-notifications`, already present | native capability |
| 22 Voices | Per-NPC TTS segments are ordinary audio paths through the media patch; nothing to add. Theatre inserts are CSS | none |
| 23 Safety | The X-card button must be reachable with the keyboard closed on Android: it lives in the composer's utility strip, which the bottom tab bar never covers; verify on a phone | verify |
| 24 Combat depth | Nothing | none |
| 25 Factions and time | Calendar events (7.2) with a real-world reminder (session scheduled) already reach the phone through the Phase 5 notification path; in-world events do not notify | none |
| 26 Commerce | Nothing | none |
| 27 Generators | Watabou and Azgaar imports use `<input type=file>`, which both shells support; drag-drop of files is the desktop-only second way | none |
| 28 The room | Video (13.1): Electron's `setPermissionRequestHandler` allowlist in `src/main/window.ts` gains `media` for camera per host origin; Android adds `CAMERA` to the manifest and the WebView chrome client's `onPermissionRequest` grants it for the host origin; the mesh path (client `useVoiceRoom` mesh branch) gains the video track alongside audio. Table view (13.2): a new entry in the game bundle's `ROUTES` for `/campaigns/:campaignId/table`, and the desktop shell offers "open on a second screen" which creates a second `WebContentsView` on the chosen display with `screen.getAllDisplays()`. Transcription (13.3) is server-side; the lobby's "this table is transcribed" notice is server UI | route, native capability |
| 29 Theme and scale | The app's own chrome (topbar, drawer, home) reads `[data-theme]` from the game bundle's root so the shell and the screens agree; Electron sets `nativeTheme.themeSource` to match; Android sets the status bar style through `@capacitor/status-bar` (add the plugin). UI scale applies inside the game root only; the shell's chrome keeps the OS scale | native capability |
| 30 Prompt sweep | Bump `NATIVE_MIN_SERVER` in `src/shared/portal-logic.ts` to the release that carries phases 16 to 30, since the screens now call routes an older host does not have; the portal already explains the mismatch in a sentence | version gate |

### 18.3 Runtime patches that need to grow

- **Object URL lifetime.** The media patch turns each protected path into
  an object URL. The FX layer plays many short stings; add a small LRU in
  `runtime.ts` keyed by path (cap 64 entries, revoke on eviction) so a
  crit sting is fetched once per session, not once per crit.
- **Range requests.** PDF viewers and long TTS segments seek. The fetch
  patch must forward `Range` headers and return the host's 206 as is;
  today it forwards the request wholesale, so this is a test to add, not a
  change, unless the token replay strips headers.
- **EventSource replay.** `scene_state` and `handout_shown` are persisted
  events; `HostEventSource` reconnects with the last sequence id the way
  the browser does. Add a test in the client repo that a persisted event
  published while the app was backgrounded is delivered on resume.
- **Web Bluetooth.** Pixels already work through `src/main/bluetooth.ts`
  on desktop and `@capacitor-community/bluetooth-le` on Android. Nothing
  in this plan changes dice; the per-account dice-source sync on the
  roadmap remains a server change that both apps pick up.

### 18.4 Testing on the apps

Every phase's acceptance runs the client's own checks: `npm test` in the
client repo (desktop and Android suites), `scripts/build-renderer.mjs`
against the server checkout at the phase's commit, and the Android `www`
bundle build. The headless Android emulator does not run on the build
machine, so the phone pass is a real device through Android Studio, using
the store-screenshot harness accounts and the staged campaign so the same
scenes are compared across browser, desktop app and phone. The desktop GUI
pass covers the second-screen table view and camera permission prompts.

### 18.5 Releasing

The apps ship the server they were bundled with. A phase is released as a
server tag first, then a client bundle from that tag, then a client
release whose notes name the server version, following the existing
release checklist. Hosts older than the bumped
`NATIVE_MIN_SERVER` fall back to the legacy webview path with the portal's
explanation, which keeps mixed fleets playable during the rollout.

---

## 19. What this plan still leaves out, on purpose

Hex and gridless grids, elevation and multi-level maps, stacked art tiles
and roof occlusion, positioned sound emitters, one-way walls and windows,
macros and scripting, card decks as a separate object, a canvas storyboard,
a hosted service, purchased official content, an extension SDK, 3D. The
reasons in the gap report's section 17 stand. Localisation, the help centre
and documentation beyond the ledgers named in section 17 are out of scope
by request.
