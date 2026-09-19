# Implementation plan: the visual overhaul

Dated 2026-09-16, against server 0.19.0 and client 0.10.0. This is the build
plan for the mockup archive `open dungeon master visual overhaul.zip` (nine
Claude Design documents plus screenshots), the LLM Saga teardown
(`/NAS/llmsaga-ux-notes.md`, the same file that ships inside the archive as
`uploads/llmsaga-ux-notes.md`), and the paused map art work in
`docs/map-art-wip.md`. It covers five areas:

1. The workshop maps overhaul: a new tile set and object set rendered through
   ComfyUI to an Inkarnate standard, a deterministic renderer that composes
   them, and the Map Forge and Map Editor screens.
2. The combat visual system (the Hand, the board as a stage, rolls and
   effects, the damage delivery table).
3. The character creator (lineage grid, dice grid, stepper, wipe).
4. The campaign creator (world portals, table sheet, review cover).
5. The motion kit that the rest sits on.

The first rule of this plan is the one the user set: **no feature is lost.**
Section 1 is a ledger of every control, field, option, mode, hotkey and limit
the current app has in each area, with the place it lives in the new UI. A
phase does not close until its ledger rows are checked off in the app and in
the client apps' native screens.

The second rule is the one the map art work already learned: **AI makes
reusable assets once; the renderer composes every map deterministically.**
Nothing repaints a map per session. The third is the house standard for
presentation (`docs/vtt-parity-implementation-plan.md` section 0.6): every
animation has a duration, an easing from the motion scale, a reduced-motion
fallback and a phone budget, and every effect plays from a resolved engine
fact.

The fourth is the workflow the user asked for on the map art: **the new tiles,
objects and rendered sample maps are published to a preview page on the NAS
before anything touches `src/`.** Sign-off on that page is a gate.

---

## 0. Decisions made in this plan

These are called here so nothing below re-litigates them.

| Decision | Choice | Why |
| --- | --- | --- |
| Model for the new tile and object set | **Flux schnell** (`flux1-schnell.safetensors`, already installed, 4 steps, about 18 s per 1024 px image on this machine) | Tested 2026-09-16: a painted flagstone, a grass field, a barrel, an oak canopy and a dungeon wall all came back in the Inkarnate register (gouache, muted, flat lit, readable shapes). The SDXL checkpoint paints photographs and produced the "screaming urn" and "toast on a board" props. Flux also cut out cleanly under BEN2. |
| Seamless surfaces | **SDXL circular padding for structure, Flux img2img at 0.55 denoise for the paint** (section 3.4) | Flux is a transformer, so the convolution-patching node only wraps its VAE; measured column wrap 0.6 to 1.4 but row wrap 1.8 to 4.0 across four seeds. Flux inpainting of the seam cross paints a frame instead. SDXL circular padding measures 0.89 / 1.03, and the Flux restyle of that base keeps it at 0.92 / 1.32 with no visible join. |
| Combat direction | **1a, The Hand**, as built out in `The Hand.dc.html` | The archive's Turn 2 builds it out; the Dial's sigil ring survives as the DM's radial HUD (which already exists as `TokenHud`), and the Ledger's round log survives as the "round so far" strip and the phone log. |
| Map editor shape | **Rail, canvas, layers** as in `Map Editor.dc.html`, but with all fifteen tool modes, six brushes, six stamps and every dial the current toolbox has, not the mockup's eleven and four | The mockup dropped Line, Box, Fill, Pick and Move and two stamps for brevity. Section 1.1 lists them; they stay. |
| Tileset in the editor | A **skin** per map: one material per terrain character (floor, wall, water, rough, door, low wall) chosen from the catalogue, plus a theme default; the terrain string format does not change | Keeps every rule, every test and every import unchanged. A crystal wall and a hedge are both `#`. |
| Props | Two layers: **automatic dressing** from the skin (deterministic, cosmetic, never on a doorway or corridor) and **placed stamps** the DM puts down with the existing Prop tool, which already exists as `MapProp` | Answers the open question in `map-art-wip.md`: DMs get both. A placed prop keeps today's semantics (an npc or a thing, deployed as a token); a dressing prop is art only. |
| Fonts | Cinzel for display (already `--font-display` in `layout.tsx`), Geist, Geist Mono and Source Serif 4 as today | The mockups use exactly this set; nothing to add. |
| Campaign creator shell | Stays a Radix dialog (`CreateCampaignDialog`), widened to `min(96vw, 60rem)` for the portal grid | The client apps have no `/create-campaign` route; the dialog is reachable from the home screen in the apps today. |
| Character creator shell | Stays `Wizard.tsx`, which gains the diamond stepper and the gold wipe as options | Same reason: `/characters/new` and the campaign character page both mount it. |
| Enemy intent telegraph | Built as a small engine feature (section 5.6), shown only when a fact exists | The mockup says "the server already knows". It does not: nothing in `src/lib/dm/turn.ts` or `encounter-tools.ts` records what an enemy will do next. |
| Page transitions | **React `<ViewTransition>` on the server pages, `document.startViewTransition` in the apps, CSS crossfade as the fallback**; a skeleton per route, never a page-level spinner (8d) | Next 16.3 ships it with no flag and no library; the apps are Chromium |
| The screens outside the mockups | **Restyled in place with the same controls** (8c), one `EmptyState`, one `PageSkeleton`, one `MomentLayer`; the kit gains `Select`, `Slider`, `NumberStepper`, `DatePicker` | The inventory found no skeleton, three empty-state tiers, five dialogs outside the kit and native controls in four places |

---

## 1. The feature ledger

Every row is a thing the app does today. "Lands in" says where it is in the
new UI. A row marked **keep as is** is untouched by this plan. This is the
list the acceptance pass checks.

### 1.1 Workshop maps and the map editor

Source: `src/app/workshop/maps/*`, `src/app/campaigns/[campaignId]/MapToolbox.tsx`,
`MapTools.tsx`, `MapSceneTools.tsx`, `TerrainCanvas.tsx`, `usePainter.ts`,
`useMapSelection.tsx`, `DmMapLibraryPanel.tsx`, `DmMapStudioPanel.tsx`,
`src/lib/battlemap/*`.

**Creating a map (Map Forge, section 4)**

| Today | Lands in |
| --- | --- |
| Name field, required before any roll (`MapCreateControls.tsx:53`) | Forge name field; roll buttons disabled until named, note copy "Name it first." |
| Hint field "what the place is like" (`:60`) | Forge hint field with the **read-back panel**: matched words light, theme and light chips, the three explanation sentences |
| Width 12 to 24, height 10 to 18 (`MAP_SIZE`) | Two range sliders with feet readout and the aspect box; numbers still typeable (the sliders get a paired number input, because a phone slider cannot land on 17) |
| Roll one (`do:"create"`) | Roll one, with the seeded flood reveal |
| Blank rock, Blank ground (`blank`) | Same two buttons |
| Import `.dd2vtt` / `.uvtt` / `.df2vtt` / One Page Dungeon JSON | Same button, same client-side backdrop extraction and upload |
| Keep the board (`do:"capture"`) when a board is live | Same button, shown under the same condition |
| Theme override select (studio only today; the library reads the hint) | Forge "Or say outright" six-button grid on both surfaces |
| Ambient override (studio) | Forge light chip becomes a three-way override (Daylight / Dim / Dark) beside the theme grid |
| Seed shown after creation | Seed chip in the facts row, plus the **rolls history strip** (new): last 7 rolls of this session, restorable by seed |
| Studio: Roll a map / Roll another / Put it on the table / Open it as a scene / Close the scene | Same four actions; the studio adopts the Forge controls and preview |
| Tour hooks `maps-create`, `maps-new`, `maps-gallery`, `open-map-create` | Keep the `data-tour` ids on the new elements |

**The gallery**

| Today | Lands in |
| --- | --- |
| Search, tag chips (top 8), sort Recent / By name (`ListControls`) | Keep as is above the gallery |
| Thumbnail is a real `TerrainCanvas` | Thumbnail is the new renderer at thumbnail scale (cached PNG per map, section 3.7) |
| Caption `w × h · theme` | Same, plus the skin name |
| Empty and no-match copy | Keep as is |

**The editor: tool modes (`MapToolbox.tsx:136`)**

| Mode | Key | Today | Lands in |
| --- | --- | --- | --- |
| Brush | B | paint group | Rail |
| Line | L | paint | Rail (mockup omitted it; kept) |
| Outline (rect) | R | paint | Rail |
| Box (filled) | X | paint | Rail (mockup omitted; kept) |
| Fill | F | paint | Rail (mockup omitted; kept) |
| Stamp | S | paint | Rail |
| Pick (eyedropper) | I | paint | Rail (mockup omitted; kept) |
| Select | V | scene | Rail |
| Light | T | scene, `lights` cap | Rail; hidden on the live board (`BOARD_CAPS`) as today |
| Door | D | scene | Rail |
| Label | A | scene | Rail |
| Prop | P | scene, `props` cap | Rail; hidden on the live board as today |
| Light zone | Z | scene | Rail |
| Move (pan) | M | other | Rail (mockup omitted; kept) |
| Align picture (backdrop) | K | other | Rail |
| Roll (new in the mockup) | N | none | Rail, opens the Forge controls in the options column |

The mockup's hotkey letters (V N B R S D L T P Z G) collide with the app's
(`L` is Line, `T` is Light, `G` is not a mode). **The app's letters win.**
The mockup's `G` for backdrop and `Z` for undo are dropped; Undo stays on
Ctrl/Cmd+Z, Redo on Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y, Escape puts the tool
down, `?` opens the hotkey sheet, Delete/Backspace deletes the selection,
digits 1 to 6 pick brushes (`BRUSH_KEYS`). The grid toggle gets no key.

**Brushes and dials**

| Today | Lands in |
| --- | --- |
| Six brushes with `BRUSH_LABELS` and `BRUSH_EFFECTS` tooltips, active brush toggles off on second click | Options column brush list, six rows with tone swatch (the swatch is now the skin's material thumbnail) |
| Radius 0 to 3 slider, freehand brush only | Nib buttons 1×1 / 3×3 / 5×5 / 7×7 (mockup) **and** the slider stays for the keyboard; digits 1 to 4 do not move to the nib because they are brush keys |
| Six stamps (room, hall, cavern, pillars, pool, rubble) with Across / Down 1 to 12 | Stamp grid with six previews (mockup had four) and the two sliders with feet readout |
| Light presets Candle / Torch / Lantern / Bonfire, Bright and Dim sliders 1 to 8, dim ≥ bright, "Put out all n", cap 24 | Light dial, unchanged content, new chrome |
| Label text (max 60), "Only I see it", "Clear all n" | Label dial |
| Prop name (max 40), A thing / A bystander, NPC datalist, cap 30 | Prop dial, plus a **stamp picker** over the new object catalogue (section 4.5); a picked stamp fills the name and keeps the kind |
| Zone kinds Light / Darkness / Magical darkness, ambient Lit / Dim / Dark, cap 12 | Zone dial |
| Door hint (tap cycles open, locked, secret) | Door blurb |
| Backdrop: add / replace / take away, Across, Down, Size, Strength sliders, corner drag on canvas | Backdrop column (the mockup stubbed this with a toast; the real controls return) |
| DM overlay upload / replace / take away | Layers panel, "Overlay" row with its controls |
| Ambience bed and music selects | Details panel |
| Theme select (six) and Ambient select (three) | Details panel, plus the **skin picker** (new) |
| Name, tags (max 8 × 24, `AddFromList` of used tags), notes (max 4000), 700 ms autosave with `SaveBadge` | Top bar name input and save dot (mockup); tags and notes in the Details panel |
| Put it on the table (deploy), Open it as a scene (hidden in workshop), Duplicate, Forget it | Top bar primary button plus a kebab for the other three |
| Seed line | Facts row |
| Undo / Redo, 30 entries per map, refused undo kept | Top bar buttons and "n back" (mockup) |
| Selection: tap smallest, Shift-tap adds, move by next tap, edit, duplicate, DM only, delete; `ObjectsPanel` list with checkboxes | Inspector panel (mockup) shows the selection; the objects list stays as the Layers panel's expandable rows |
| Hotkey overlay `?` | Keys button on the rail |
| Zoom 1 to 6 wheel and pinch, fit, pan | Zoom readout in the top bar plus the three corner buttons on the canvas |
| Touch: pinch, one-finger pan, `touch-none` | Kept; phone layout in section 4.7 |
| Border never painted; painter refusals as toasts | Dashed border guard on the canvas and the five refusal toasts |
| Selection boxes, backdrop handles, tool preview | Same drawing, on the new canvas layer |
| Studio-only: preview vs live, `BOARD_CAPS`, painter key `seed:wxh` | Kept |
| Deploy places props as tokens, clears fog, plays ambience | Kept; dressing props (art) are not tokens and never deploy |

**Rules and limits that must not move:** `TERRAIN` six characters, `MAX_STROKES` 600,
`MAX_BRUSH_RADIUS` 3, `SCENE_LIMITS`, `LIGHT_LIMITS`, `BACKDROP_LIMITS`,
`UVTT_SIZE`, `STAMP_SIZE`, name uniqueness per campaign, terrain applied before
the word fields on PATCH, `effectiveTerrain` for locked and secret doors, fog
memory as the per-character bitfield.

### 1.2 The live board and combat

Source: `EncounterPanel.tsx`, `BattleMapPanel.tsx`, `BattleMapGrid.tsx`,
`BoardStage.tsx`, `BoardFx.tsx`, `battleMapCells.tsx`, `TokenHud.tsx`,
`Composer.tsx`, `SessionView.tsx`, `SessionTabs.tsx`, `FloorBanners.tsx`,
`DmInitiativePanel.tsx`, `PendingRollCard.tsx`, `RollCard.tsx`,
`DiceOverlay.tsx`.

| Today | Lands in |
| --- | --- |
| Composer modes Do / Say / OOC / Direct (lead and narrate), `KIND_TIPS`, Enter to send, Shift+Enter newline, X-card, push to talk, send | **Kept whole.** The Hand sits above the composer on the Battle tab; the tutorial says "or type your move" |
| DM status strip with `D20Spinner` | Kept |
| `SpeakerPicker`, `DirectorPresets`, private toggle | Kept |
| Pending roll cards, floor banners, director banner, story nudge, new adventurer banner | Kept; `PendingRollCard` gets the skill-check card presentation (section 5.4) with every source (manual, Pixels, digital, held rolls, shake) intact |
| Token HUD, player six actions (Attack, Cast, Dodge, Dash, Disengage, Help) | Kept as the tap-a-figure menu; the Hand offers the same six as cards when the sheet has nothing better, so a level 1 commoner still has a hand |
| Token HUD, DM seven actions (Pick up, Teleport, Reveal/Hide, Damage, Condition, Heal, Take off) | Kept unchanged; the Dial's sigil styling is applied to it |
| Targeting mode fills the composer ("I attack X.") | Kept as the typed path; the Hand commits through the engine (section 5.3) |
| Encounter roster: mob grouping, CR pills, health words, DM HP/AC chip, legendary economy, condition chips with rounds, End encounter | Kept; restyled to the mockup's roster rows |
| Initiative panel: back / forward / reset, give the turn, up / down, delay, remove, insert slot | Kept; the initiative rail on the board is display only and links to this panel |
| Floor banners: initiative chain, End turn, Skip turn, spotlight, hold | Kept; End turn also appears as the board's bottom-right button |
| Board tools: handle, point, place, measure, draw; drawing kinds and tones, fade next round, erase, clear | Kept |
| Camera: zoom, fit, follow the turn, pull, lock, free, "look around anyway" | Kept |
| Drag a figure, drag ruler with budget, two-tap touch model, enlarge dialog, pings with focus | Kept; the two-tap model is the phone Hand's confirm step |
| Health rings, condition badges (max 4), footprints, elevation glyphs, auras, target lines, drawings, labels, door badges, templates, vignette, grain | Kept on the SVG stage above the new canvas terrain |
| Token face: portrait `<image>` when the sheet has one, else an initial letter | Portrait always (section 5.1): own portrait, bestiary or pack art, placeholder plate by race and class or creature type, class emblem; the letter only when no image loads; the name in the tooltip |
| FX player: one per target, hidden-tab drop, reduced motion 320 ms, haptics; effects for attack, spell, heal, condition, death, door, hazard, template, teleport, ping, gutter | Kept; the delivery table (section 5.5) extends `EffectShape` per damage type |
| Fog: server-blanked terrain, opaque unexplored, 55 % explored-not-visible | Kept in the projection; drawn as a soft-edged mask above the terrain (section 3.6) |
| Sky layer, weather, hour lighting, scene titles, handout stage, dice overlay | Kept |
| Tabs, bottom tab bar, unread badges, tours, guided tour targets | Kept; the Hand adds tour step `battle-hand` |
| `data-effects="low"` and reduced motion | Every new animation honours both |

### 1.3 The character creator

Source: `src/app/characters/builder/**`, `Wizard.tsx`, `Ribbon.tsx`.

| Today | Lands in |
| --- | --- |
| Six steps: Identity, Ancestry, Calling, Ability scores, Spells and gear, Finishing touches; blockers per step | Same six, same order, same blockers |
| Identity: pack notice, world pack banner, name (60), name seeds, role segmented control, gender, level or fixed level, background picker with skill info, alignment picker | **Keep as is** (mockup leaves it) |
| Ancestry: race picker over grouped `OptionPicker` (pack peoples first), race info, bonus languages selects, `RacialChoicesSection` (ASI picks, skills, tool, cantrip with catalog browser) | **Lineage grid** replaces the picker: one card per race including pack reskins and all 31 SRD races, grouped by the same tiers; the **detail carousel** shows ASI, speed, size, languages, "leaves you to choose", traits accordion; **bonus languages and racial choices stay as the section under the grid** exactly as today |
| Calling: class picker with meta line, subclass picker, granted features, class skills, expertise, fighting styles, option slots | **Keep as is** |
| Abilities: three methods with info, standard array de-duplicating selects, point buy 8 to 15 with 27 budget, roll with number inputs and Roll all, racial badge, final and mod, `AsiFeatEditor` cards | **Dice grid** for roll (per-row roll, reroll all, drop lowest, tiers, summary cascade); standard array becomes the six-slot rows; point buy becomes the steppers; **the number inputs stay** (a row can still be typed, which the mockup dropped) so a DM can enter rolled-at-the-table numbers; ASI editor unchanged; point buy stays enforced (the blocker refuses a negative budget; the mockup only recoloured) |
| Spells and gear: starters, catalog browser, search, chips, starter pack, class suggestions, gold | **Keep as is** |
| Finish: portrait upload / replace / regenerate / remove, appearance (500), backstory (2000), feats, derived stats with Max HP override and AC override | **Keep as is**, plus the "How your health is worked out" explainer button beside Max HP |
| Wizard header, progress bar, track, footer, `canContinue` gating | Diamond stepper replaces the bar (clickable back to completed steps only, forward only through Continue as today); the gold wipe plays on step change |
| Submit: `validateBuilder`, `buildBuilderResult`, caster warning second press | Unchanged |
| Library create, campaign join / edit / replace, companion builder, level-up dialog | Unchanged mounts |

### 1.4 The campaign creator

Source: `src/app/create-campaign/**`, `CreateCampaignDialog.tsx`,
`WorldSetupFields.tsx`, `SafetyToneFields.tsx`, `VoiceChatFields.tsx`,
`ContentImportPicker.tsx`, `RulesPanel.tsx`.

| Today | Lands in |
| --- | --- |
| Premise: title (80), DM mode (ai / human / assisted with capability gating), world pack picker with cover and unofficial notice | **Keep as is** |
| World: genre tiles (8), custom text (500), premise (500), theme notes (120), cover art note | **World portals**: eight art cards with blurb, climate chip, humans-only chip; the theme field **types itself** from the preset unless touched; the DM flavour card and four fact chips; the custom callout; **premise and theme stay editable inputs** (the mockup made theme read-only) and `themeTouched` / `descriptionTouched` keep their meaning; picking a bare genre still clears a pack |
| Party: players 1 to 8 (hidden solo), level 1 to 20, difficulty with hints, length (AI only), dice policy cards | **Keep as is** |
| Feel: sixteen toggles (thirteen counted), `NarratorFields` (companions, party members, guests, voice with preview), `SafetyToneFields` (X-card, boundaries, lines, veils, strictness, tones max 3, personalities) | **Table sheet**: the toggle grid with the counter and the group headers; every toggle keeps its gating (`aiOnly`, `tableOnly`, `needs`), the tri-state multi-character toggle and the presentation toggle stay; **NarratorFields and SafetyToneFields stay under the grid unchanged** |
| Advanced: variant rules (7 + rest variant), house rules (20000), lore drafts, content import, voice chat fields | **Keep as is** |
| Review: six read-back rows, next-step line, solo warning, error | **The cover**: assembled from the genre plate, title, theme, party line, difficulty stamp; the read-back rows cascade in; **the cover is a preview of `CampaignCover`, and cover art still comes from the lobby** as today |
| Submit payload, `submitWorldSetup`, `submitContentImport`, the deliberately omitted keys and `test-create-campaign-options.mjs` | Unchanged; the test keeps passing because the surface still names every key |

### 1.5 Shared primitives

`ui.btnPrimary`, `btnSecondary`, `btnSmall`, `iconAction`, `input`, `card`,
`cardHover`, `dialog`, `tile`, `tileHover`, `railCell`, `railCellActive`,
`railCellActiveEmber`, `PixelTile`, `MonsterTile`, `UserAvatar`,
`CharacterPortrait`, `IconChip`, `CampaignCover`, `PartyPanel`, `SessionTabs`,
Radix menus and dialogs, `Sheet`, `D20Spinner`, tooltips, toasts, the
parchment handout. All keep their props and class names; section 6 adds
motion to them without renaming anything.

---

## 2. Foundations

### 2.1 Motion scale

`globals.css` already defines `--ease-snap`, `--ease-settle`, `--ease-drift`
and the six durations. This plan adds one token and one rule set.

| Token | Value | Use |
| --- | --- | --- |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | anything a finger or cursor pushes: switch knobs, segmented pills, tab indicators, card release, verdict pops, the diamond stepper |

Rules, in addition to section 0.6 of the parity plan:

1. **A pointer never changes React state.** Tilt, sheen, magnet pull, parallax
   and ripple origin are written as CSS custom properties from one delegated
   `pointermove` and `pointerdown` listener per page (`src/lib/motion/pointer.ts`,
   new). The listener is a no-op under `prefers-reduced-motion` and under
   `data-effects="low"`, and never attaches on coarse pointers.
2. **Every release springs.** Transforms on interactive elements use
   `--ease-spring`; colour, border and opacity use `--ease-snap`.
3. **No hover-only affordance.** Every hover state has a press state. The
   phone is the primary target for combat.
4. **Replay by reflow.** One-shot animations on mounted elements restart by
   `animation: none`, forced reflow, then the `data-replay` value
   (`replayAnimation(el)` in `src/lib/motion/replay.ts`, new).
5. **Loops stop under low effects; beats stay.** `[data-effects="low"]` removes
   foil shimmer, badge breathing, dust, aura breathing and torch flicker, and
   keeps card lift, dice landing, hit flash, damage rise and the wipe.

### 2.2 Files added

| File | Purpose |
| --- | --- |
| `src/lib/motion/pointer.ts` | the page-level pointer physics (tilt, magnet, sheen, parallax, ripple) |
| `src/lib/motion/replay.ts` | `replayAnimation` |
| `src/lib/motion/beats.ts` | the fixed beat sheet for combat playback (announce 420, roll 820, impact 420, status 1500, clear 260; quick set 180 / 350 / 260 / 900 / 90) |
| `src/components/ui/DiamondStepper.tsx` | the six-diamond stepper |
| `src/components/ui/StepWipe.tsx` | dim, beam and ring wipe, 700 ms |
| `src/components/ui/GoldTitle.tsx` | gradient-clipped Cinzel title with the eight-layer bronze extrusion and the fly-in |
| `src/components/ui/Ripple.tsx` | the `data-press` ripple child |
| `src/components/ui/Foil.tsx` | the travelling foil band and cursor sheen layers for cards |
| `src/lib/battlemap/render/*` | renderer v3 (section 3.6) |
| `src/lib/battlemap/skins.ts` | skin definitions, theme defaults, catalogue lookups |
| `src/lib/battlemap/hand.ts` | card derivation from a sheet and the outcome preview arithmetic (pure, tested) |
| `src/lib/battlemap/delivery.ts` | the damage delivery table (pure, tested) |
| `scripts/tile-set.mjs`, `scripts/generate-tiles.mjs` | already present, extended (section 3) |
| `scripts/prop-set.mjs`, `scripts/generate-props.mjs` | the object catalogue and renderer |
| `scripts/decal-set.mjs` | edge and scatter decals, rendered by `generate-props.mjs` |
| `scripts/build-map-preview.mjs` | the NAS preview page (replaces `data/map-render-wip/renderer/build.mjs`) |
| `scripts/icon-set.mjs`, `scripts/generate-icons.mjs` | the icon catalogue (built from the app's own data) and renderer (8b.2) |
| `scripts/vfx-set.mjs`, `scripts/generate-vfx.mjs` | the VFX flipbook catalogue and the LTX Video renderer (8b.3) |
| `scripts/ui-set.mjs`, `scripts/generate-ui.mjs` | the painted UI furniture catalogue and renderer (8b.4) |
| `src/lib/icons.ts` | `iconFor(kind, slug)` with family fallbacks, reading `public/assets/icons/manifest.json` |
| `src/components/ui/Scroll.tsx`, `Book.tsx`, `IconPlate.tsx`, `CardFrame.tsx` | the animated furniture built on the painted parts |
| `src/components/EmptyState.tsx`, `src/components/PageSkeleton.tsx` | the one empty state and the per-route skeletons (8c.3) |
| `src/components/MomentLayer.tsx` | the queue for titles, handouts, level-up, death saves, rests (8c.5) |
| `src/components/ui/Select.tsx`, `Slider.tsx`, `NumberStepper.tsx`, `DatePicker.tsx` | the four controls that replace native inputs (8c.4) |
| `src/components/RestSheet.tsx`, `src/components/DeathSaveStrip.tsx` | the two missing surfaces (8c.6) |
| `src/components/CommandPalette.tsx` | the DM console and workshop hub palette (8c.7) |
| `src/app/template.tsx`, `src/app/**/loading.tsx` | route transitions and route skeletons (8d.3) |
| `scripts/test-screens.mjs`, `scripts/test-page-transitions.mjs` | 8c.8 and 8d.5 |
| `scripts/test-map-skins.mjs`, `test-map-render.mjs`, `test-hand.mjs`, `test-delivery.mjs`, `test-map-assets.mjs` | new suites, registered in `test-all.mjs` (the runner discovers every `scripts/test-*.mjs`, so the asset check lives at `scripts/map-preview/check-map-assets.mjs` until the set is complete and moves into `scripts/` when it is) |

### 2.3 Byte budgets

`scripts/test-placeholders.mjs` gains three budgets, because the client apps
vendor `public/` from git HEAD:

| Folder | Cap | Notes |
| --- | --- | --- |
| `public/assets/tiles/` | 9 MB | 182 materials × 3 variants at 256 px WebP, quality 82, about 14 KB each |
| `public/assets/props/` | 6 MB | about 160 objects at 256 px alpha WebP plus 40 decals |
| `public/fx/` | 8 MB | raised from the parity plan's 1.5 MB for the flipbooks in 8b.3 |
| `public/assets/icons/` | 12 MB | 2,008 icons at 128 px alpha WebP, measured 4.7 KB each |
| `public/assets/ui/` | 3 MB | the scroll, the book, plates and frames |
| `public/assets/tiles/` and `props/` with the genre sets | 9 MB becomes 30 MB, 6 MB becomes 12 MB | five more genres (8b.1); the desktop installer carries it all, Android fetches at runtime from the host and caches |

Every asset is also listed in a manifest the renderer reads, so a missing file
is a test failure, not a blank square.

---

## 3. Workstream A: map art, renderer v3, the NAS preview

Goal: a battle map composed from the terrain string and a skin reads like an
Inkarnate map: painted materials with organic edges, walls with weight and
shadow, water with a wet margin and depth, dressing that sits against walls,
lighting and tone over everything, and a grid that is visible when asked for
and otherwise implied.

### 3.1 What was wrong with the previous attempts, in one list

From `docs/map-art-wip.md` and the reference sheets:

- Photographic checkpoint: 182 separately lit photos read as a texture sampler.
- One texture per square: hard terrain edges on grid lines, "a bunch of squares".
- Soft-edge renderer v1: better; walls still uniform bands; water a rounded rectangle.
- Renderer v2 (`data/map-render-wip/reference/renderer-v2-latest.png`): masks
  and props exist, but water is still a square with soft corners, rough regions
  read as rectangles when they fill a room, props are photographs of objects,
  several props are wrong objects, and there is no lighting, no vignette, no
  ambient occlusion, no edge decals, so nothing pulls the layers into one
  painting.
- The rejected img2img sheet shows what "right" looks like: the Flux
  0.65-denoise panel has painted stones, dark outline strokes on every edge,
  shore foam, scattered debris, and a unified warm grade. That look is the
  target for the deterministic renderer, made from assets instead of a repaint.

### 3.2 Asset classes

Each class has a catalogue file (pure data, `--dry-run`able), a generator that
drives `scripts/lib/comfy-render.mjs`, kept 1024 px originals under `data/`
(gitignored), and shipped WebP under `public/assets/`.

| Class | Count | Format | Generator | Notes |
| --- | --- | --- | --- | --- |
| **Surfaces** (floor, wall top, water, rough, hazard, chasm, low wall) | 182 materials × 3 variants = 546 | 256 px seamless WebP | `generate-tiles.mjs` with `--variants 3` | The variant is chosen per texture-bomb layer by the map seed, which is the fix for content repetition the WIP doc calls out |
| **Fittings** (doors, stairs, bridges, ladders, wells, trapdoors) | 28 | 256 px WebP, one object in one square, fixed orientation convention: **spans run left to right, doors close top to bottom** | `generate-tiles.mjs` | Orientation is fixed by prompt plus a review pass; the renderer rotates to the wall run |
| **Wall edge decals** | 12 per wall family × 4 families = 48 | 256 × 64 px alpha WebP strips | `generate-props.mjs` (decal mode) | The painted outline and highlight along a wall's floor edge: mortar lip, moss, rubble crumbs, ice rime. Laid along the wall mask contour |
| **Shore and edge decals** | 6 water, 4 lava, 4 chasm, 4 rough | 256 × 64 alpha strips | decal mode | Foam, wet stain, scorch, root fringe |
| **Scatter decals** | 40 | 128 px alpha WebP | decal mode | Cracks, puddles, leaf drifts, moss patches, blood, ash, bone chips, footprints, straw, sand ripples. Placed by noise, never on rules |
| **Objects (dressing and stamps)** | about 160 | 256 px alpha WebP, top-down, drop shadow **not** baked | `generate-props.mjs` | The 34 in the WIP list, re-rendered on Flux, plus a catalogue per theme: furniture, containers, camp, forge, temple, crypt, cave, forest, swamp, river, field, ruin, market, ship deck, laboratory |
| **Light cookies** | 6 | 256 px greyscale WebP | hand-made SVG, not AI | Torch, brazier, lantern, candle cluster, window shaft, magical |

Total about 900 renders at roughly 18 s each on this machine, about 4.5 hours
of GPU time, run in the background in category order so a review can start
after the first hour.

### 3.3 Prompt rules

Carried over from the WIP notes, all learned the hard way:

- Never write "battle map", "Inkarnate", "Dungeondraft", "map" in a prop or
  decal prompt; it draws parchment and compass roses.
- State the fantasy context without the word map: "a single medieval fantasy
  RPG prop, hand painted digital illustration".
- Objects: "seen from directly above, top-down orthographic, isolated on a plain
  flat white background, centred, whole object visible with empty margin".
  The bookshelf test came back in elevation, so **every object prompt names
  what the top view shows** ("only the top edge of the shelf and the tops of
  the books"). Objects that have no readable top view (a portrait, a sword on
  a wall) are not in the catalogue.
- Surfaces: "seamless repeating texture ... fills the frame edge to edge, no
  focal point". Flux ignores negatives, so the anti-vignette and anti-photo
  terms move into positive phrasing ("flat even lighting, no vignette, no
  border").
- One style line for everything, so a lava fissure and a flagstone share a
  palette: "hand painted fantasy tabletop art, painterly digital illustration,
  gouache and dry brush, soft brush strokes, muted harmonised earthy palette,
  flat even lighting, view from directly above, top-down orthographic".
- The per-tile saturation ceiling (0.46) stays in the encoder, and the grass
  test (very green) is why.
- Re-rendering a bad asset on the same seed repeats the mistake: `--seed-salt`
  stays.

### 3.4 Seamless surfaces on Flux

Measured 2026-09-16 with the interior-column-ratio metric (1.0 means the wrap
is like any interior column pair):

| Approach | Columns | Rows | Verdict |
| --- | --- | --- | --- |
| SDXL + `SeamlessTile` + `CircularVAEDecode` (the shipped set) | 0.89 | 1.03 | wraps |
| Flux + `SeamlessTile` + `CircularVAEDecode`, four seeds | 0.63 to 1.41 | 1.76 to 4.02 | one axis only, not usable alone |
| Flux, roll by half, inpaint the cross with a noise mask | 2.2 | 2.0 | fails; the model paints a frame in the masked cross |
| SDXL seamless base, Flux img2img restyle at 0.55 denoise with circular VAE | 0.92 | 1.32 | wraps, no visible join when rolled by half; the paint is Flux's |
| Same at 0.70 denoise | 0.88 | 1.57 | borderline; the stones start to drift from the base |

The pipeline is therefore: **SDXL circular padding makes the wrapping
structure; Flux repaints it at 0.55 denoise with the circular VAE decode** so
the paint is Flux's and the wrap is SDXL's. The generator takes
`--paint flux|sdxl` so both paths stay reproducible, and the seam metric runs
in `test-map-assets.mjs` against the shipped WebP: a surface above 1.6 on
either axis fails the build.

### 3.5 Object cut-outs

`generate-props.mjs` runs Flux, then `easy imageRemBg` (BEN2) from the
installed Easy-Use pack, then the `cutout.sh` steps (hole fill, trim, margin)
inlined in Node with ImageMagick. Two additions:

- A **contact sheet** per run (`data/prop-src/contact-<date>.png`) so every
  object is reviewed by eye, which the WIP notes say never happened for 22 of
  the 28.
- A **review file** `scripts/prop-review.json` listing rejected ids with a
  salt, read by the generator, so re-rolls are recorded and reproducible.

The drop shadow is not baked (the prompt asks for none; BEN2 removes what
slips through). The renderer draws the shadow, so a prop against a north wall
and one in open floor shade differently.

### 3.6 Renderer v3

One module, `src/lib/battlemap/render/`, pure canvas 2D, no dependencies,
used by the editor canvas, the play board, the gallery thumbnails and the NAS
preview. Input: terrain string, width, height, skin id, seed, fog sets,
lights, zones, hour and weather (from `daylight.ts`), and an options block
(grid on or off, dressing on or off, quality tier). Output: a set of cached
layers.

Draw order and what changed from v2:

1. **Ground.** Skin floor material texture-bombed at `floorSpan` squares per
   texture (1.6 for stone, 3 for grass), the second bomb layer at 1.37× and a
   quarter turn, both picking a variant by seed. A second material shows
   through in noise patches (dirt in grass, ash on basalt). Grime and wear
   from the stain field.
2. **Region masks.** Each terrain's squares blurred into a field, perturbed by
   fbm, cut with smoothstep. New: **rough and water regions get a second,
   lower-frequency displacement (period about 3 squares) and corner rounding
   proportional to region size**, so a pool that fills a room is a pond, not
   a pillow. The mask never crosses more than 0.35 of a square into a
   neighbour, so boundaries stay near the grid lines the rules use.
3. **Rough ground and hazards.** Material through the mask, tinted; scatter
   decals along the mask edge (bramble twigs, rubble crumbs) at 14 per cent of
   edge squares.
4. **Water, lava, chasm.** Dark wet margin, near-bank depth band, outline, and
   now **shore decals laid along the contour** (foam for water, scorch for
   lava, root fringe for chasm) and a subtle caustic pattern (a second water
   variant at 0.4 alpha, screen blend) drifting by seed. Lava keeps the
   additive glow.
5. **Low walls.** As v2 with the outline and shadow.
6. **Walls.** Low blur, fine noise, contact shade, drop shadow, masonry tint,
   lit top edge, shaded bottom edge, hard outline, and now **wall edge decals
   laid along the floor-side contour** so every wall has the painted lip
   Inkarnate walls have. Never `wall-castle-block`.
7. **Fittings.** A door is a slab rotated to the run; stairs, bridges and
   ladders are rotated to their long axis (the run of floor between walls or
   across water), and a well or trapdoor is placed as is.
8. **Dressing.** As v2 (26 per cent of wall-adjacent floor, 5 to 10 per cent of
   open floor, never doorways, corridors or beside another prop), with per-prop
   outline and contact shadow drawn by the renderer, and a size jitter. New:
   the DM's placed `MapProp` objects with a catalogue stamp draw here too, at
   full size, with the same shadow, and a placed prop suppresses dressing on
   its tile and the eight neighbours.
9. **Ambient occlusion.** A wide blur of the wall mask multiplied at 0.28 over
   the floor, and a darker inside corner term (mask eroded and blurred) so
   rooms feel enclosed.
10. **Light.** Lights from `MapLight[]` and carried torches draw cookies in
    additive blend at their bright radius and a wider soft falloff to the dim
    radius; ambient `bright`, `dim`, `dark` sets the base exposure; zones
    multiply per their kind. Outdoors takes `skyLight(hour, weather)` as the
    ambient and a colour cast. This is art only; the rules still use `los.ts`.
11. **Grade.** Slow tonal drift (soft-light), skin tint, a **vignette at 0.22**,
    and a **paper grain** (the existing `feTurbulence` grain moves to the canvas
    at 0.35, overlay).
12. **Grid.** Hairlines at 0.18 when the grid toggle is on; when off, nothing.
    Inkarnate has no grid; the VTT keeps one because the rules do.
13. **Fog.** The unexplored set, blurred by 0.4 of a square and cut, drawn as an
    opaque paper-dark layer with a soft edge; the explored-but-not-visible set
    at 0.55. Because the soft edge could reveal a sliver of unexplored art, the
    fog mask is **dilated by 0.5 of a square before blurring**, so it always
    covers more than the square, never less. `view.ts` continues to blank
    unexplored terrain server-side, which is the real guarantee.

Performance: masks and the ground are cached per (terrain, skin, seed, size);
lights, fog and grid are cheap per-frame layers. A 24 × 18 map renders in under
80 ms on this machine at 56 px per square; at 32 px it is under 40 ms. The play
board draws the canvas beneath the existing SVG stage (tokens, badges, FX stay
SVG). Phones use the `low` tier: no decals, one bomb layer, no AO blur.

### 3.7 Thumbnails

The gallery and the map studio history strip use the renderer at 8 px per
square with dressing off, cached as a data URL per map id and version in
memory. A saved PNG thumbnail is not stored; the renderer is fast enough.

### 3.8 Skins

`src/lib/battlemap/skins.ts` binds each `MapTheme` to a default skin and lets
a map override any of the six characters with a material from the catalogue:

| Theme | Default skin | Floor | Wall | Water | Rough | Door | Low wall | Dressing set |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cave | Cavern | cave-rock-smooth | wall-cave-rock | water-cave-pool | rough-rubble-scree | door-cave-mouth (weak; falls back to door-stone-slab) | lowwall-stalagmite-row | cave |
| forest | Forest floor | grass-dark | wall-tree-canopy | water-shallow-clear | rough-bramble | door-wood-plain | lowwall-log-barricade | forest |
| swamp | Mire | peat-swamp | wall-mangrove | water-swamp-murky | rough-reed-bed | door-wood-plain | lowwall-wood-fence | swamp |
| riverside | River bank | sand-beach | wall-earth-cut | water-river-flowing | rough-driftwood | door-wood-plain | lowwall-stone-parapet | river |
| interior | Stone dungeon | flagstone-granite | wall-dungeon-mossy | water-flooded-floor | rough-debris-crates | door-wood-iron-banded | lowwall-stone-parapet | dungeon |
| field | Open ground | grass-meadow | wall-hedge-dense | water-deep-blue | rough-tall-grass | door-gate-timber | lowwall-wood-fence | field |

Plus named skins the picker offers (Sunken crypt, Overgrown ruin, Volcanic
deep, Ship deck, Temple, Sewer, Frozen, Desert, Laboratory, Tavern). A skin
is stored on the prepared map as `skin_json` (new column, normalised like the
scene columns, unknown materials fall back to the theme default) and travels
with deploy into `battle_maps`, with capture back, with duplicate, and in the
workshop bundle. The play view carries `skin` in `PlayerMapView`.

### 3.9 The NAS preview page (the gate)

`scripts/build-map-preview.mjs` writes `/NAS/odm-map-preview.html`, replacing
the stale comparison page:

- The same 20 × 14 room in every default skin and every named skin, rendered by
  v3, with a grid toggle, a dressing toggle, a fog demo and a light demo.
- Three real maps from the generator (cave, interior, field) at a random seed,
  so the layout is not hand-picked.
- Every surface as a 3 × 3 repeat with its seam scores printed.
- Every object on a contact sheet with its id, and a "rejected" list.
- Every decal strip.
- A "what is not done" list, kept honest.

Sign-off on this page precedes phase 3 (the app port). The page is rebuilt on
every asset run.

### 3.11 Genre sets

Section 8b.1. The materials live in the same `tile-set.mjs` with a `genre`
field (fantasy entries carry none), the objects in `prop-set.mjs` with genre
sets, the skins in `skins.mjs` with a `genre` field, and the preview page
gets a section per genre. The Forge and the Editor filter the palette and the
stamp picker by the campaign's genre first and offer the rest under "other
settings".

### 3.10 What the user's ComfyUI needs

Already installed: `ComfyUI-seamless-tiling`, `ComfyUI-Easy-Use` (BEN2 remove
background), Flux schnell with `t5xxl_fp8_e4m3fn`, `clip_l`, `ae`. Nothing
else is required. The generator checks `object_info` for `SeamlessTile`,
`CircularVAEDecode`, `UNETLoader`, `DualCLIPLoader` and `easy imageRemBg` and
prints the missing node's repository if any is absent.

---

## 4. Workstream B: the Map Forge and the Map Editor

### 4.1 Map Forge (`MapCreateControls.tsx` and `DmMapStudioPanel.tsx`)

Both surfaces adopt one component, `MapForge.tsx`, with the mockup's two
panels: controls and preview. The generator is unchanged; the preview runs the
real `generateBattleMap` client-side for the reveal and history, then the
server creates the map from the same seed, so what was previewed is what is
saved (a test asserts the client and server generators agree on ten seeds).

The read-back panel uses a new pure export `readHint(hint)` in `generate.ts`
that returns `{ theme, ambient, roughWord, themeWord, lightWord }` alongside
the existing `pickTheme`, so the UI can name the matched word without
duplicating the regexes.

Animation, from the mockup: tiles flood from the centre at 26 ms per Chebyshev
ring, 380 ms each on `--ease-settle`; the gold sweep runs over `520 + (w + h) × 16`
ms on `--ease-drift`; spawn discs pop at 70 per cent of that with a 60 ms
stagger; torches pulse 3.6 s; the matched words hit for `--dur-beat`; the theme
chip claims on `--ease-spring`. Under low effects the flood is a single fade.

The history strip keeps seven entries of `{ seed, width, height, hint, theme,
ambient }` in component state; restoring re-runs the generator at 900 ms. The
strip's thumbnails come from the renderer at 8 px per square.

### 4.2 Map Editor layout (`MapEditor.tsx`)

Desktop, four columns: rail (50 px), options (232 px), canvas (flex), layers
and inspector (228 px). The top bar carries the name input, save dot, undo /
redo with "n back", GRID, SNAP (dropped: the app has no free-position objects,
so the toggle would be inert; the mockup's stub is not carried), DM VIEW
(labels marked DM only hide when off), zoom, and "Put it on the table" with a
kebab for Open as scene, Duplicate, Forget it.

The canvas is the new renderer with the existing `TerrainCanvas` interaction
layer on top (zoom, pan, pinch, strokes, shapes, stamps, selection, backdrop
handles, previews). `terrainDraw.ts` keeps `drawScene`, `drawToolPreview`,
`drawGrid`, `drawLights`; `drawGround` is replaced by the renderer's cached
ground layer.

### 4.3 The rail and options

The rail lists the sixteen modes of section 1.1 in three groups with the
existing letters, the hotkey printed at 7 px, the active spine, and the Keys
button. The options column shows the current tool's blurb, then the dial the
current `MapToolbox` shows for that mode, restyled. The brush list shows the
skin's material thumbnail as the swatch; the stamp grid shows six previews.

### 4.4 Layers, tileset, inspector

Layers panel rows: Labels, Props, Lights, Light zones, Doors, Terrain,
Backdrop, Overlay, Drawings (prepared maps carry drawings too). Eye toggles hide
a layer on the canvas (terrain and backdrop included, which the mockup stubbed).
Each row expands into the existing objects list for that kind with the
checkbox, DM marker and trash.

Tileset panel: the skin picker (a select of named skins) and six material
rows, each a button opening a picker sheet over the catalogue filtered to that
role and sorted by theme affinity, with the material's 3 × 3 repeat as the
preview. A "Flat" toggle draws the old flat fills for anyone who wants the
diagram back; it is a device preference, not map data.

Inspector: the mockup's three states (selection, under the pointer, empty),
with the selection actions (edit, move, duplicate, DM only, delete) as today.

### 4.5 Props as stamps

The Prop dial gains a stamp picker over the object catalogue grouped by set,
with search. Picking one sets `prop.name` to the object's label and stores
`prop.stamp` (new optional field on `MapProp`, normalised to a known catalogue
id or dropped). Deploy still turns props into `npc` or `prop` tokens; a token
with a stamp draws the stamp as its figure on the board instead of the rounded
square. Dressing (automatic) is not a `MapProp` and never becomes a token.

### 4.6 Toasts

The five painter refusals and the three scene refusals become the ember toast
(`toast-up` 2.4 s). Copy stays the server's strings.

### 4.7 Phone

Below `lg`: canvas full width, the rail as a 46 px scrolling strip along the
bottom, two sheet handles (tool, layers) rising over the canvas (`sheet-up`
320 ms), the held tool floating top-left of the canvas, undo / redo at 44 px
in the title row. The same state drives both layouts.

### 4.8 Tests

- `test-map-skins.mjs`: every theme has a default skin whose materials exist;
  every named skin resolves; unknown materials fall back; the skin survives
  the prepared-map round trip, deploy, capture, duplicate and the workshop
  bundle.
- `test-map-render.mjs` (node canvas is not a dependency, so this tests the
  pure parts): mask dilation never uncovers an unexplored square; dressing
  never lands on a doorway, in a corridor or beside another prop; fittings
  rotate to their run; the render plan for a map is deterministic for a seed.
- `test-map-assets.mjs`: manifest completeness, byte budgets, seam scores.
- `test-battlemap-generate.mjs` gains the client and server agreement check
  and `readHint` coverage.
- Existing map suites stay green untouched.

---

## 5. Workstream C: combat, the Hand, rolls and effects

### 5.1 The board as a stage

The play board keeps `BattleMapGrid` and `BoardStage`; the terrain SVG cells in
`battleMapCells.tsx` are replaced by the renderer's canvas beneath the SVG.
The stage adds, from `Board.dc.html` and `The Hand.dc.html`:

- **Attention cone and spotlight** while aiming (`cone-in` and `spot-in`
  260 ms `--ease-snap`), the ember arc with `arrow-flow`, the dim scrim.
- **Reticles** on legal targets with `+N vs AC n · d ft` labels
  (`pop-centred` `--dur-quick`, 40 ms stagger), 64 px, 84 px for a large
  footprint, `cursor: crosshair`.
- **Range ring** for the held card (dashed gold, `r = tiles × TILE + TILE / 2`).
- **Shards, rings, rising number, crit label** as today's `BoardFx`, re-timed
  to the beat sheet.
- **Health ring transition** 420 ms on the new health word.
- **Dust motes** (18, CSS clock) and **torch flicker**, both loops that stop
  under low effects.
- **The die on the field**: the repo's `D20Spinner` geometry at 104 px, six
  held faces at 720 ms, with `d20 + N` under it; the number lands on the beat.
- **Stage shake** on hit (420 ms, ±3 px) and crit (620 ms, ±7 px, plus the
  torch flare), translate only.
- **Turn banner** on turn change (`banner-wipe` `--dur-linger`) with the
  hairline rule; text is the actor's name or "Your turn".
- **Initiative rail** top-left with portrait plates (46 × 56), the current
  plate framed and breathing; tapping it opens the initiative panel.
- **Turn HUD** top-right: ACTION, BONUS, REACTION pips from the action budget
  (`test-action-budget.mjs` owns the facts), speed left, AC, HP.
- **Miss chip** on the target (`miss-pop` `--ease-spring`).
- **Tokens wear faces, not letters.** The mockups draw an initial letter in
  each token; the app already clips the sheet portrait into the token circle
  (`BoardStage.tsx` `TokenFigure`) and falls back to a letter. The rule from
  the user (2026-09-17): every token shows a picture. Order of preference:
  the character's own portrait (uploaded or painted), the monster's portrait
  from the bestiary or the pack's `monster-<slug>` art, the placeholder plate
  by race and class (`characterPlaceholder`) or by creature type (the
  `monster/` placeholders), then the icon set's class emblem for an NPC with
  nothing else. The letter survives only as the last resort when no image
  loads. The name lives in the tooltip (the existing `<title>`, restyled as
  the board's hover plate: name, health word, conditions) and in the
  initiative rail. The same rule applies to the phone's target chips and the
  encounter roster.

### 5.2 The Hand: card derivation

`src/lib/battlemap/hand.ts` derives cards from the sheet and the encounter,
pure and tested:

| Card type | Source | Fields |
| --- | --- | --- |
| Attack | each equipped weapon from `weapons.ts` and the sheet's equipment, plus unarmed | cost Action, range, dice with the ability and magic bonus, to hit, damage type, Extra Attack note when the class grants it |
| Rider | Divine Smite, Sneak Attack, Rage damage, Hunter's Mark riders, from `feature-effects.ts` | cost Rider, resource line |
| Control / Attack spell / Mend / Ward | prepared or known spells with a slot available, from `spell-mechanics.ts` and `spell-slots` | cost (Action or Bonus), range, dice or save with DC, condition applied, slot line |
| Ward | Shield of Faith, Shield, Dodge | Bonus or Reaction where the rules say |
| Terrain | placed props with a `hazard` kind on the current map, and hazards from `hazards.ts` within reach | Action, save, scope, uses; only when the map carries one |
| Basic | Dodge, Dash, Disengage, Help, Hide, Ready | always present, so every character has a hand |

The card carries the same numbers the engine will use. The outcome preview
rows are arithmetic: expected damage from the dice expression's mean, hit
chance from `odds.ts` against the hovered target's AC (or the nearest enemy's
when nothing is hovered), the DC for a save, the cost and resource. Nothing on
a card is a label the engine does not enforce.

Cards are capped at nine on desktop (the fan) and scroll on the phone rail;
beyond nine, a "more" spine opens a sheet with the rest, sorted attacks, spells
by level, then basics.

### 5.3 The Hand: commit path

Picking a card enters aim; picking a target commits. The commit goes through
the existing engine, never through prose:

- Attack cards call the same route the HUD's targeting mode would have driven,
  but directly: `POST /api/campaigns/:id/actions` with `kind: "do"` and a
  structured `intent` body (new optional field) `{ card: "attack", weapon,
  targetTokenId }` that `pc-attack.ts` resolves before the model sees it. The
  model still narrates from the resolved outcome, which is how `fx-plan.ts`
  already works. If the structured path is unavailable (an older server, a
  custom class the engine cannot resolve), the card falls back to composing
  the sentence the HUD composes today and the composer sends it.
- Spell cards call `cast-tools.ts` through the same structured intent.
- Basic cards compose the sentence, as the HUD does today.
- Terrain cards compose a sentence naming the prop; the engine's hazard tools
  resolve it.

The phone's two-tap confirm sheet shows the target plate, `dice · +N vs AC n ·
d ft`, the health word, Back and the gold commit button named after the card.

The committed card plays `card-play` (`--dur-beat` `--ease-settle`), the die
lands on the beat sheet, the result plays through `BoardFx`, then `card-spend`.
The round strip above the board files the result (`log-in` `--dur-move`).
The chronicle line is the engine's existing roll line.

### 5.4 Rolls: the skill-check card and the announce

- `PendingRollCard` keeps every source and control and gains the violet card
  presentation: halo breathing (1.8 s), the 1500 ms beat (tumble, flicker,
  modifier chip flies in and merges, total lands with the 1.35 overshoot, glow
  burst at 1080 ms, verdict pop at 1180 ms), then the one-line log. The digital
  path plays the whole beat; a manual or Pixels roll plays from the modifier
  chip onward once the number is in; held rolls keep the phone bounce.
- `GoldTitle` (the announce) is used by `SceneTitle` for "Roll for initiative",
  "Your turn", "Victory" and the encounter title card: eight bronze layers,
  `announce-fly` 900 ms `--ease-spring`, the rule and diamond ornaments, the
  shock ring and 18 sparks on landing at 620 ms. Under low effects: one layer,
  a fade.

### 5.5 The damage delivery table

`src/lib/battlemap/delivery.ts` adds the layer `damage-palette.ts` does not
carry: how a type arrives.

| Type | Mode | Impact delay | Shake | Extra |
| --- | --- | --- | --- | --- |
| fire | lob | 420 | 7 | ember streak, spark burst |
| cold | straight | 200 | 4 | shard burst, frost tint stays at 0.28 |
| lightning | bolt | 90 | 6 | jagged double strike, white core |
| acid | lob | 380 | 3 | drips run down |
| poison | lob | 380 | 2 | mist keeps expanding |
| necrotic | none | 90 | 3 | dark mist drawn inward |
| radiant | beam | 120 | 4 | column drops, bloom at the feet, motes rise |
| force | none | 90 | 5 | clean violet ring |
| psychic | none | 90 | 4 | concentric pink rings |
| thunder | none | 90 | 9 | one wide ring, heaviest shake |
| bludgeoning / piercing / slashing | swing | 150 | 5 / 4 / 4 | bone crescent, dust or thinner debris |
| heal | none | 90 | 0 | bloom rising, green |
| teleport | none | 90 | 0 | mist collapsing, violet |

Burst counts: spark 14, shard 13, mist 9, drip 11, bloom 10, ring 3 rings.
Particles are deterministic from the effect id (the seed), so the same hit
replays the same way. `BoardFx.emitParticles` and `EffectShape` read the table;
`test-delivery.mjs` asserts every palette type has a delivery row, that shake
is zero for heal and teleport, and that the low tier halves counts.

### 5.6 Enemy intent (engine feature)

Nothing in the engine records what an enemy plans to do. Two sources are
added, both projected through `view.ts` and both redacted for a target that
cannot perceive the actor:

1. **Declared**: a DM tool `declare_intent` (`encounter-tools.ts`, mirrored in
   `invoke-catalog.ts`) storing `{ actorTokenId, verb, targetTokenId, expected }`
   on the encounter for the current round. The AI DM is prompted to declare
   after resolving an enemy turn ("the warlord turns toward Ysolde"); the
   human DM has it as an adjudication.
2. **Likely**: when nothing is declared, `tactics.ts` derives the likely intent
   from the monster's primary attack and nearest reachable hostile, labelled
   "likely" on the badge.

The board draws the intent badges (breathing, 2.6 s), the diamond-scale arc
(30 scales, 12 ms stagger) and the toast on hover or long press. Test:
`test-intent.mjs`.

### 5.7 Tutorial and help

The first battle shows the two-row tutorial card (Play a card / Or type your
move) once per account, stored with the existing tour-seen mechanism; it is
replayable from Help. The Hand's chips carry `data-tour="battle-hand"` and the
player tour gains the step.

### 5.8 Tests

`test-hand.mjs` (derivation, preview arithmetic against `odds.ts`, the cap and
ordering, the fallback sentence), `test-delivery.mjs`, `test-intent.mjs`,
`test-beats.mjs` (the beat sheet sums, the quick set, reduced motion clamps),
and `test-fx-plan.mjs` extended so a card commit plans exactly one effect.

---

## 6. Workstream D: the motion kit

Applied to the shared primitives without renaming a class:

| Primitive | Motion |
| --- | --- |
| `btnPrimary` | magnet pull ±4 / ±3 px, cursor sheen, ripple from the press point, hover lift 2 px, active 0.97, 220 ms `--ease-spring` |
| `btnSecondary`, destructive variant | border and glow on `--ease-snap`, same press |
| `iconAction` | nudge −2 px, active 0.9, 200 ms spring |
| Segmented control (composer kinds, builder methods) | one travelling pill animating transform and width, 320 ms spring |
| Switch (`role=switch`) | knob 340 ms spring, track colour `--dur-move` |
| `input` | focus bloom `--dur-quick`; invalid submit `shake-x` `--dur-beat` |
| `cardHover`, `CampaignCover` | tilt 16°, parallax art, holographic band on the cursor axis, corner brackets drawing in, lift −8 px, 1.03 |
| `MonsterTile` rows | slide 4 px, plate 1.09 and −3°, 220 ms spring |
| Radix menu | `scale-in` `--dur-quick` spring, items `item-in` staggered 26 ms, chevron 180° |
| Radix dialog | scrim `fade-up`, panel `scale-in` spring, brackets `bracket-in` at 120 and 180 ms |
| Tooltip | opacity 140 ms, transform 240 ms spring, out of the anchor's edge |
| `PartyPanel` card | lift −3 px, portrait 1.06, HP bar 500 ms with `bar-shine` on change, condition chips `fx-pop` |
| `SessionTabs` rail | one travelling indicator, 340 ms spring; cell lift −3 px; unread wiggle stays |
| `Sheet` | `sheet-up` 320 ms, rows staggered 40 ms |
| Toast | `toast-in` `--dur-move` spring with the `rule-wipe` progress line |
| Purse and level | `coin-arc` and `level-ring` on `--dur-scene` |
| `.parchment` | tilt 7°, lift −4 px, spotlight at 0.7 |
| `D20Spinner` | unchanged geometry; faces already cross-fade |

Everything above is inside `@media (prefers-reduced-motion: no-preference)` or
has a static equivalent; the pointer physics module does not attach under
reduced motion or low effects.

### 6.1 The LLM Saga teardown, item by item

From `/NAS/llmsaga-ux-notes.md` section 10 ("what I'd lift first"), mapped:

| Item | Where in this plan |
| --- | --- |
| 1. Dice grid stat roll | section 7.2 |
| 2. Violet d20 skill-check card | section 5.4 |
| 3. Card-battler arena: intent badges, intent arc, lunge and recoil, cracks, shards, HP header | The Hand keeps the board as the arena rather than portrait cards (section 5.1); intent in 5.6; recoil is `card-recoil` on the target's figure; cracks are not carried (tokens are round portraits, not cards) |
| 4. Fanned action hand with outcome preview and terrain cards | sections 5.2 and 5.3 |
| 5. Element recipe table | section 5.5 |
| 6. Stepper diamonds, gold-beam wipe, "how it works" formula modal | sections 7.1 and 7.4 |
| 7. Reward reveal tiers | **phase 9, optional**: the loot drawer and the reveal tiers (common / rare / epic with rays, holo, shockwave, flick to take) applied to `inventoryApprovals` item offers |
| 8. NPC conversation panel with three tone-varied replies and relationship deltas | **phase 9, optional**: a conversation mode on the Story tab; relationship deltas already exist as bonds |

Other lifts noted from the teardown and where they go: the gold CTA and ghost
pill (section 6), glass rows (`panel`), breathing titles (`GoldTitle`), the
Cinzel 3D title recipe (`GoldTitle`), the "Working..." disabled label on busy
buttons (`btnPrimary` gains `data-busy`), flavour loading copy (composer status
strip already has it), the animated travel banner ("New place discovered") as
a `SceneTitle` variant when the party moves location, the parchment burn
transition (not carried; video assets are out of budget for the apps).

---

## 7. Workstream E: the character creator

### 7.1 Stepper and wipe

`Wizard.tsx` gains `variant="diamonds"`: six diamonds joined by rules, the
current one with the ping ring (2.5 s `--ease-drift`), completed ones solid
gold, and a 500 ms transition. Clicking a completed diamond goes back; forward
still requires Continue so `canContinue` gating holds. The header keeps the
`Step n / total` live region. Step change plays `StepWipe` (dim 700 ms
`--ease-drift`, beam 700 ms `--ease-snap`, ring), with the step swap at 300 ms.
The progress bar variant stays for other wizards.

### 7.2 The dice grid

`AbilityEditor.tsx` keeps the three methods and their info text. In roll mode
each row shows four pipped d6 SVGs (`dieBody`, `dieBevel`, `pipFace`
gradients), a per-row Roll button and a total. The roll uses the existing
`rollFourDropLowest()`; the animation is `die-toss` per die at 820 + i × 90 ms
on `--ease-settle`, `die-wobble` while airborne, the six-face flicker at 100 ms,
`flicker-out` and `value-in` at 86 to 90 per cent, the dropped die's red ✕, the
tiered total (`total-pop` at `tossMs(3) + 150`), and `row-settle`. Settled dice
keep a random rest offset. The number input stays beside the total so a value
can be typed; typing clears the dice for that row. "Reroll all" is the
existing "Roll all". When the sixth row settles, the summary panel cascades in
(120 ms stagger) with Base, Racial, Final, Mod; it does not auto-advance the
wizard, because the ASI editor may still need input on the same step.

Standard array: six slot buttons per row over 15, 14, 13, 12, 10, 8, taken
values dimmed, picking clears the other holder (today's rule). Point buy:
steppers 8 to 15 with the 27-point counter, red when negative, and the
blocker still refuses a negative budget.

### 7.3 The lineage grid and carousel

`AncestryStep.tsx` replaces the race `OptionPicker` with the card grid: every
race the picker offers today (pack peoples first, then all), each card with
the race plate (`characterPlaceholder` family art), name, tagline from the top
ASI, two ASI chips, the ✓ Selected badge, the ? button. The detail carousel
walks the same ordered list with wrap, shows every ASI chip, speed, size,
trait count, tongues, "leaves you to choose" (asiChoice, bonus languages,
skills, cantrip, tools), and the traits accordion parsed by the three-shape
rule from the mockup, with `describeRace` text as the fallback body. Choose
sets the race through `changeRace` (so the racial choices reset as today).
Bonus languages and `RacialChoicesSection` follow under the grid unchanged.
Pack reskins show the pack name and the canonical SRD name in the carousel
header.

### 7.4 Explainers

The method info dialog becomes the three-card sheet with the chosen one
highlighted; the HP explainer is the formula chip modal (hit die max, CON mod,
starting HP, sum line, four steps, the override note) reachable from the
abilities summary and from the Max HP field on Finish. Both use the dialog
motion from section 6.

### 7.5 Tests

`test-pointbuy.mjs`, `test-asi.mjs`, `test-character-grants.mjs` stay the
source of truth. New: `test-lineage-cards.mjs` for the tagline rule, the trait
parser (all 31 races parse to a body or a locked row, no exceptions) and the
carousel order matching the picker's groups.

---

## 8. Workstream F: the campaign creator

### 8.1 World portals

`WorldStep.tsx`: the eight portal cards from `GENRE_PRESETS` with the plate
from `campaignPlaceholder(genre, seed)`, blurb, climate chip, humans-only
chip, ✓ Chosen badge, `card-rise` stagger. Picking a genre runs `pickGenre`
(clears a pack, as today). The theme input types itself from
`defaultTheme` when `themeTouched` is false (`typeline` at 22 ms per
character with the caret and gold sweep); typing in it sets `themeTouched`
and stops the animation for good. The premise textarea and custom text
behave as today. The DM flavour card shows `dmFlavor`, and the four fact chips
show `mapStyle`, `nameHints`, `raceHint` and the climate.

### 8.2 The table sheet

`FeelStep.tsx`: the counter card (`count-pop` on every flip), the four group
headers, the toggle cards with the 30 × 17 switch, the counted dot on rows
`featuresOn()` counts, dependent rows arriving with `row-reveal`. Gating is
the existing gating: `aiNarrates` hides the narrator rows, `solo` hides the
table-only rows, the TTS and maps capability disables their rows with the
existing copy. The multi-character tri-state and presentation toggles keep
their current behaviour and are shown uncounted, and the footnote names
them correctly (the mockup's footnote named a toggle that does not exist).
`NarratorFields` and `SafetyToneFields` render under the grid unchanged.

### 8.3 The cover

`ReviewStep.tsx`: the cover card assembled with `cover-assemble`
(`--dur-scene` spring) from the genre plate, the title, the theme line, the
party line and the difficulty stamp (`stamp-down` at 420 ms), then the six
read-back rows at 70 ms steps and the three chips. All values are the draft's,
not constants. The solo warning and the error stay.

### 8.4 Dialog shell

`CreateCampaignDialog` widens to `min(96vw, 60rem)` at `lg` and keeps the
`Wizard` with the diamond variant and the wipe. On a phone the portal grid is
two columns and the sheet grid one.

### 8.5 Tests

`test-create-campaign-options.mjs` must stay green with the moved markup.
New: `test-world-portals.mjs` asserting every preset renders a card, the
type-in respects `themeTouched`, and `featuresOn` still counts thirteen.

---

## 8b. Workstream I: the art program beyond maps

Added 2026-09-16 at the user's request. ComfyUI makes every asset the premium
look needs, once, into catalogued sets under `public/assets/`; the app
composes and animates them. Four sets, plus the genre tile sets in 3.11.

### 8b.1 Genre tile sets and objects (section 3.11)

Every genre in `GENRE_PRESETS` gets materials, objects and skins of its own, so
a cyberpunk table never fights in a stone dungeon. The terrain alphabet does
not change; the skin does. `skins.ts` gains a `genre` dimension: the default
skin is looked up by `(genre, theme)` and falls back to the fantasy default.

| Genre | Floors, walls, liquids, rough, doors, low walls (examples) | Objects (examples) |
| --- | --- | --- |
| cyberpunk | wet neon asphalt, steel grating, holo tile, concrete; chrome panel, neon sign wall, chain link, concrete barrier; coolant, oil slick; cable tangle, scrap; blast door, glass door; crash barrier, server rack | terminal, vending machine, holo table, drone wreck, neon sign, dumpster, motorcycle, cable spool |
| steampunk | brass plate, riveted iron, cobbles, parquet; boiler pipes, brick, gear wall, iron lattice; steam vent water, oil; gears and scrap, coal; iron hatch, brass door; pipe rail, crate row | boiler, gear cluster, pressure gauge, airship crate, automaton wreck, coal cart, workbench, telescope |
| post-apocalyptic | cracked asphalt, rusted plate, ash, dust; wrecked car wall, rubble barricade, corrugated fence, container; toxic sludge, oil; scrap field, glass; chain gate, welded door; sandbags, tyres | wreck, fuel barrel, scrap pile, tent, radio, generator, sign post, skeleton |
| horror | rotting boards, blood tile, mould stone, wet flagstone; fleshy wall, mould brick, boarded wall; blood, black water; bone heap, rot; nailed door, iron gate; pews, cages | coffin, ritual circle, cage, operating table, candles, mirror, doll, hanging chains |
| mystery | Victorian parquet, cobbled street, gaslit pavement, tiled hall; wallpapered wall, brick alley, iron fence; rain puddle, canal; leaves, rubbish; panelled door, shop door; railing, hedge | writing desk, gramophone, tea set, armchair, street lamp, carriage, crates, umbrella stand |
| dark fantasy | uses the fantasy set with the crypt, sewer and ruin skins first | as fantasy |
| custom | fantasy set | as fantasy |

Five new genres × about 28 materials × 3 variants is about 840 surface renders
(SDXL base plus Flux repaint), plus about 40 objects per genre. The catalogue
entries carry `genre` so the picker groups them and the theme defaults resolve.

**What the genre surfaces taught (2026-09-17 and 18).** The fantasy look string
("hand painted fantasy battle map art, earthy palette") must not reach a genre
surface: on cyberpunk it returned cobblestones for asphalt and for steel
grating alike. A plain material base returned grey slabs that the Flux repaint
could not light. Flux alone gave the right look but does not wrap on both
axes, and every post-process tried (crossfade, mirror, a rotated second pass,
rolling the seams to the centre) either ghosted patterns or moved a joint onto
the join. What works is the normal seamless pipeline with the setting's style
on **both** stages (`SETTING_STYLE` in `tile-set.mjs`), material words with no
scene nouns (street, alley, corridor) and nothing negated, and "neon" removed
from the shared negative for a neon setting. Stale bases must be deleted before
a re-render, since the generator reuses `<id>.base.png`.

### 8b.2 The icon set

One painted icon per thing a card, a sheet, a picker or a log line can name.
Rendered on Flux at 768 px on a black backdrop, cut out with BEN2 so the app
draws the plate (dark disc, gold rim, rarity ribbon) and every icon matches;
shipped at 128 px alpha WebP (about 6 KB each).

| Group | Source | Count | Key |
| --- | --- | --- | --- |
| Spells | `src/lib/srd/manifest/spells.json` (name, school, level, classes); the authored spells are a subset | 517 | spell slug |
| Weapons and armour | `srd/weapons.ts`, `srd/armor.ts` | 81 | item slug |
| Adventuring gear and SRD magic items | content pack, `document_slug = wotc-srd` | 230 | item slug |
| Class features, SRD | `srd/class-features.json` every level, every class | 137 unique | feature name |
| Class features, genre | `src/lib/classes/<genre>-features.json`, six settings, 36 classes | 533 unique | feature name |
| Options (invocations, maneuvers, metamagic, boons, infusions, runes, disciplines) | `srd/options.json` | 124 | option id |
| Conditions | `condition-glyphs.ts` | 27 | condition id |
| Basic actions | Attack, Cast, Dodge, Dash, Disengage, Help, Hide, Ready, Grapple, Shove, Use an object, End turn | 12 | action id |
| Feats | SRD plus the content pack's, most common | 60 | feat slug |
| Glyphs | skills 18, abilities 6, coins 6, dice 7, sheet states 15 (rests, exhaustion, inspiration, death save, level up, HP, AC, speed, initiative, slot, XP), sky 10, day parts 6, climates 5, mounts 10, senses 5, paces 3, quest states 4, faction attitudes 5, session and app tabs 30, workshop systems 15 | 145 | `glyph-<group>-<id>` |
| Ambience cues | `src/lib/ambience/catalog.ts`, beds, layers and stings | 61 | `glyph-cue-<id>` |
| Fallbacks | one per spell school, per item category, per class (13 SRD and 36 genre), per option kind, per damage type | 81 | family |

That is 2,008 icons in `buildIconList()` (`node scripts/generate-icons.mjs
--list` prints them), about 4.5 hours of GPU at 8 s each, and 9.5 MB at the
measured 4.7 KB per shipped icon. Lookup is `iconFor(kind, slug)` in
`src/lib/icons.ts`: exact slug, then family fallback, never a broken image.

**What is deliberately not an icon.** These already have art, or need a
picture rather than a symbol:

| Thing | What it uses instead |
| --- | --- |
| Monsters (322 SRD, 3,200 pack) | pack `art` (`monster-<slug>`), then the creature-type placeholder plate (`public/assets/placeholders/monster/`), then the genre boss plate |
| Races, classes, backgrounds in the builder | the race, class and genre portrait placeholders (31 races × 3, 49 classes × 2 or 3) and the class emblem family icon on the card corner |
| Pack magic items beyond the SRD (1,381), pack gear (338) | `family/item-<kind>` fallback; `--only item` can be widened to `document_slug != wotc-srd` later at 1,750 more icons and 8 MB |
| Subclasses (105) | the parent class emblem, tinted by the subclass's first feature icon |
| Homebrew spells, items, features | family fallback at once; the on-demand painter in phase 9 paints one when the workshop saves the entry |
| Campaign covers, workshop covers, NPC and party plates, empty-state vignettes | the placeholder set, extended in 8c.3 |

**Text in icons.** A prompt that names a spell invites the model to write the
name; saying "the name is never written" made it worse. The prompts now say "a
wordless pictogram", and `scripts/scan-icon-text.py` reads every raw render
with a CPU OCR model (`~/.cache/odm-art/ocr`), gives each icon that contains
letters a new seed salt in `scripts/icon-review.json`, and the next plain run
of `generate-icons.mjs` re-renders exactly those. The first pass flagged 348 of
2,008; the loop repeats until a scan comes back clean, capped at five rounds.

Uses: the Hand's card art slot (section 5.2, which closes the second open
question in section 12), the character sheet's ability tiles, spell list,
equipment list and feature list, the pickers in the builder, the roll log,
the encounter roster's action icons, the shop and loot drawers.

### 8b.3 VFX flipbooks in place of the SVG effects

The current `BoardFx` draws crescents, rings and particles as SVG and canvas
primitives. Each becomes a painted flipbook: a short clip rendered by LTX
Video (installed: `ltx-video-2b-v0.9.5` for speed, `ltxv-13b-0.9.8-distilled`
for quality) on a pure black background, luma keyed so black is transparent,
cut to 32 frames of 128 px on a 1024 × 512 sheet, shipped as WebP (about
150 KB each). The board draws them additively in the existing particle canvas
at the beat sheet's timings; the SVG primitives stay as the reduced-motion and
low-tier fallback.

| Family | Sheets |
| --- | --- |
| Impact bursts, one per damage type | fire, cold, lightning, acid, poison, necrotic, radiant, force, psychic, thunder, bludgeoning, piercing, slashing (13) |
| Projectiles | ember lob, ice shard, acid glob, poison lob (4) plus the lightning bolt as a still with a flicker |
| Beams and columns | radiant column, necrotic drain (2) |
| Heal, teleport out, teleport in, death collapse, door open, door locked shake, secret found | 7 |
| Crit flare, shock ring, sparks, dust burst, blood spray (bone family) | 5 |
| Ambient | torch, brazier, candle, campfire, lantern, arcane sigil and water caustics loops (7); rain, snow, motes, embers, fireflies and fog are procedural |

34 sheets, inside a raised `public/fx/` budget of 8 MB. The physical hits (bludgeoning, piercing, slashing, blood spray), the door dust puff and the shock ring stay on the drawn effects: the video model drifts to red fire for anything mundane, and two prompt rounds did not fix it. Rain, snow, motes,
embers, fireflies and fog are **not** flipbooks: a video model returns black
for sparse particles on black, and the board's particle canvas already draws
them. Prompts must ask for large, bright, glowing content; "grey dust", "dark
red" and "dim" rendered as black frames and were rewritten (round b in
`scripts/vfx-review.json`). Each
flipbook is reviewed on a contact sheet like the objects; a clip that drifts
off centre or shows scenery gets a salt. Measured 2026-09-16: the 2B model
renders 41 frames at 512 px in 105 s on this machine and gives a clean
radial burst that fades to black; the colour needs the prompt to insist
(the first fire came out red) and the 13B distilled model is being compared
on the same clips. Catalogue: `scripts/vfx-set.mjs`; generator:
`scripts/generate-vfx.mjs` (`--model 2b|13b`, sheets under `public/fx/`).

### 8b.4 Painted UI furniture that stays animatable

Text is never baked into a picture; the parts are painted and the app animates
them, so a scroll can hold any narration and a book any chapter.

- **The scroll** (narration, handouts, the "show this now" stage, the travel
  banner): a seamless parchment body texture, two roller cut-outs, a ribbon
  and a wax seal. Unrolls with a clip-path from the centre over `--dur-scene`
  on `--ease-settle`, the rollers translating outward; the text fades in
  behind the roller's leading edge. Closes in reverse.
- **The book** (the story archive: chapters, the log, the timeline): a closed
  tome cut-out, an open spread, a single page texture, a ribbon bookmark and
  corner ornaments. Pages turn with a 3D transform (`rotateY` on a page whose
  two faces are the page texture, 900 ms `--ease-settle`), a soft shadow
  sweeping under the turning page, and the text of the next chapter already
  laid on the page beneath. Chapters are the pages; the ribbon marks where
  the table is. Reduced motion: the page crossfades.
- **Plates, frames, ribbons**: the card frame, the icon plate, the type ribbon,
  the title cartouche, the section dividers with the diamond, the corner
  brackets. Painted once as nine-slice pieces so any size works.

About 30 renders. Assets under `public/assets/ui/`, budget 3 MB.

### 8b.5 The character sheet

The sheet (the dialog opened from the session and the character page) adopts
the icon set and the LLM Saga live-sheet layout (teardown section 2.5): the
portrait with a medallion, ability tiles with painted icons and tiered
numbers, the vitals bars, proficiency and bonus chips, the spell and
equipment lists with icons and rarity plates, the feature accordion with
icons, and the "how it works" explainers. No field is removed; the ledger for
it is every field `computeSheetDerived` and the sheet dialog show today, and
it is checked the same way as the creators.

## 8c. Workstream J: the screens the mockups did not draw

The nine mockups cover the board, the Hand, the two creators, the Forge and
the Editor. Everything else the user meets is inventoried here with what it
keeps and what it becomes. The rule from section 1 holds: **every control in
the "keeps" column ships**, restyled, never removed.

### 8c.1 Findings

1. **Loading is one spinner everywhere.** `Loader2` at the page level in
   eleven routes and about forty buttons; not one skeleton in the codebase.
   The only content-shaped waits are the workshop hub's "counting" figures
   (`systems.ts`) and the reference page's in-field spinner.
2. **Empty states come in three tiers** that never match on one screen: an
   illustrated plate (`EmptyHero`, `ScheduleSection`, `SystemCards`), an icon
   chip card (characters, friends, workshop shelf), and an 11 px grey italic
   sentence (every session panel, every workshop list).
3. **Five dialogs bypass the motion kit** and hand-roll Radix with a flat
   scrim and no entrance: `EditCampaignDialog`, `CharacterSheetDialog`, the
   settings delete dialog, the story rewind and log undo alert dialogs, the
   map enlarge dialog.
4. **Native browser controls leak in four places**: `datetime-local` and
   `<select>` in `ScheduleSection`, `<select>` in friends and the campaign
   editor, `<input type="range">` in the session header, `type="number"` in
   the workshop shelf and the campaign editor.
5. **Three strong surfaces to extend, not replace**: `SceneTitle` (the
   900/1600/900 title choreography with a reduced-motion toast), `HandoutStage`
   (parchment, notice, image, wax seal, found stamp), `SystemCards` (count,
   plate, blurb).
6. **The three biggest moments have the least presentation**: "Enter world"
   is a plain anchor and a full document load; "Begin the adventure" is a
   full-width primary button at the bottom of seven stacked cards; level-up is
   a lazy dialog whose Suspense fallback is `null`.
7. **No dedicated rest or death-save surface.** Rests and death saves are rows
   in the DM console's generic adjudication list; death saves on the party
   card are six 8 px dots.

### 8c.2 Screen by screen

Columns: what the screen keeps (the ledger), what it becomes, the art and
motion it draws on. Plates are `public/assets/placeholders/*`, parts are
`public/assets/ui/*` (8b.4, 8e), glyphs are `public/assets/icons/glyph/*`
(8b.2), loops are `public/fx/loop-*` (8b.3, 8e).

**The front door**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| Root checking state (`page.tsx`) | the auth check, forced password change | a branded first paint: wordmark on the night sky with the loading sigil, never a bare circle | `stars-sky`, `sigil-loading` turning at `--dur-linger` |
| Auth screen, `AuthForm` | Log in / Create account segmented control, username, password, invite code, error box, submit, consent line, Discord button, mode swap, seat-join copy, reset step, How to play, legal links | a two-panel door on desktop (key art left, form right), single column on the phone; fields get a leading glyph, focus bloom and inline validation; Discord stays but takes the secondary weight | campaign genre plate as key art (rotates per visit), `loop-fireflies` over the sky, `input` motion from section 6 |
| Join (`join/[code]`) | cover, campaign title, party line, code chip, loading, error, sign-in with `joinCode`, back link | an invitation letter: parchment body, wax seal, the cover as the letterhead; the genre string is formatted (the `high_fantasy` underscore bug is fixed here) | `parchment-body`, `wax-seal`, `handout-in` |

**Home**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `Dashboard` | header cluster, deletion banner, hero, quick tiles, campaign list, workshop section, join card, footer, both create dialogs, how to play, clone, delete, retry, focus-join | a tabletop: sections enter staggered on first paint (`fade-up` 40 ms apart), the hero owns the top half on desktop | staggered entrance per rule 3 in 8d.2 |
| `ContinueHero` | eyebrow, title, status line, cover, Enter world | the cover becomes the lobby hero on navigation (shared element); "Enter world" is a `Link` with the primary button motion and a haptic; the status line gains the live candle when a session is running | `viewTransitionName="campaign-cover"`, `candle` + `loop-candle` |
| `EmptyHero` | the plate and both lines | unchanged, plus a "New campaign" action on the plate | `misc/empty` |
| `QuickTiles` | New campaign, Solo, Characters, Workshop, Join | five doors with a painted glyph on the icon plate and a tilt on hover | `icon-plate` + `glyph-tab-*`, `cardHover` |
| `CampaignList` and `CampaignTile` | cover, title, status pill, level and difficulty and theme, party count, `ExportMenu`, duplicate, delete, loading, failure and retry, deliberate `null` empty | tiles get the campaign card motion from section 6; the three icon actions sit in one kebab menu on the phone and stay inline on desktop; a skeleton grid replaces the spinner | `PageSkeleton kind="home"` |
| `WorkshopSection` | chip, blurb, Open workshop, rows with party line, duplicate, empty copy | rows carry the workshop's own plate (a hash of the workshop id picks one of the fourteen system plates so a shelf of six is six pictures); a pending state replaces the false empty flash | `placeholders/workshop/*` |
| `JoinCard` | code input, Join, error | eight sigil boxes that fill as you type, paste fills all eight, the seal stamps on a valid code | `wax-seal`, `fx-pop` |
| `HomeFooter`, auth footer | all links | one shared `LegalLinks` with the divider rule | `divider-rule` |

**Chrome**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `AppHeader` | brand, home button, bell, account menu, deletion banner, the `/api/auth/me` fetch | the right cluster fades in from a 36 px reserved slot; the wordmark gets the gold title treatment | `GoldTitle` |
| `AccountMenu` | every item including theme toggle, admin, app home, log out | the kit menu with a portrait medallion header, icon column, section rules; the theme row is a brass switch that animates | `portrait-medallion`, `toggle-track` and `toggle-knob` |
| `NotificationBell` | count badge, SSE and poll, list, relative time, empty line | the kit popover; each row carries the glyph for its kind; unread rows have a gold left rule; the empty state is the notice board | `glyph-tab-*`, `empty-notice-board` |
| `PageShell`, `PageSection`, `PageLoading`, `PageNotice` | widths, ribbons, danger tone, padded | `PageLoading` renders the route's skeleton; `PageNotice` gets a plate and a styled action | `PageSkeleton`, `misc/*` |

**The lobby**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `Lobby` | back link, masthead with cover and pencil, room code, game settings, rules, lore, bring in prep, real-dice toggle, voice and transcription warning, schedule, party, actions, edit and companion dialogs, every seat power | a two-column table on desktop (party and start on the right, settings on the left), a tabbed sheet on the phone (Party, Settings, Schedule); the cover is the shared element from home; presence changes animate (a seat filling slides its card in) | `viewTransitionName="campaign-cover"`, `PartyPanel` motion |
| `LobbyRoomCode` | code, copy code, copy link, share, join URL, the check swap | the QR is on the card, not one click away; copy gives a toast and a `fx-pop` | `wax-seal` |
| `LobbyParty` | avatar, name, seat badges, character line, seat actions, muted and real-dice badges, ready pill, companions with trash, add companion, full-company line | badges and actions separate: badges are chips on the plate, actions live in one per-row menu; ready flips with the switch knob and a `fx-pop`; portraits are 56 px medallions | `chip-plate`, `portrait-medallion` |
| `LobbyActions`, `StartBlock` | all four branches, ready and un-ready, begin, begin solo, blocker sentence, delete campaign | "Begin the adventure" is the lobby's hero action: a wide gold plate button with the magnet and sheen, disabled with the blocker sentence under it; ready uses the gold system, not emerald | `button-plate`, section 6 `btnPrimary` |
| `ScheduleSection` | plan toggle, date and time, duration, title, note, rows, RSVP tallies and buttons, move, call off, reschedule, empty plate | the kit `DatePicker` (a calendar sheet) and `Select` replace the native controls; RSVP names show as avatar stacks | `Select`, `DatePicker` (8c.4) |
| `InviteShareDialog` | tunnel row and its three states, QR, code, URL, copy link, copy code, share, new code | the kit dialog; the QR slot is reserved at 192 px so nothing reflows; hierarchy is "scan this" first, regenerate last | `Dialog` |
| `EditCampaignDialog` | title, premise, world notes, players, level, difficulty, cover preview, upload, paint one, remove, painting poll | the kit dialog and the kit `Select` and `NumberStepper` | `Dialog` |

**The session shell**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `SessionView` | every overlay it mounts | the floating layer becomes one `MomentLayer` (8c.5); the `LevelUpDialog` fallback is the level skeleton, never `null`; `!campaign` renders the table skeleton | `PageSkeleton kind="table"` |
| `SessionHeader` | title, scene line, voice dock, dice menu, narration and ambience controls, help, home, account | the kit `Slider` replaces the range inputs; on the phone the audio controls fold into one sheet | `Slider` (8c.4) |
| `SidePanel`, `SessionTabs`, `SubTabs`, `BottomTabBar` | width toggle, every tab, badges, auto-jump rules | tab content crossfades (`--dur-quick`) with the travelling indicator from section 6; the sub-tab pill row becomes wooden tab plates | `tab-plate`, `glyph-tab-*` |
| `SidePanelRouter` | every branch | the final `null` fallback renders the empty plate with the tab's name | `misc/empty` |

**Party tab**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `PartyPanel` card | portrait, name, light bar, playing chip, online dot, crown, bot, race and classes, note count, `CharacterMenu`, wild shape banner, HP bar, pets, death saves, AC and PP and initiative, resources, conditions, concentration, exhaustion, all owner controls, companion request and build | the card is grouped into three bands (identity, vitals, state); chips use painted glyphs; HP loss flashes the bar and shakes the card (`fx-jolt`), healing shines it; death saves become a dedicated strip (8c.6) | `glyph-rest-*`, condition icons |
| `BondsPanel` | loading, empty, list | the relation graph already in `RelationGraph.tsx` above the list; hearts become the bonds glyph | `glyph-tab-bonds` |
| `FactionsPanel` | add, edit, delete, attitude, reputation | each faction gets a crest (shield blank tinted with a hue from its name, attitude glyph on the boss) and a standing bar from -5 to 5 | `shield-blank`, `glyph-attitude-*` |
| `MarketPanel` | purse, shops, stock lines, buy, haggle, sell list, coin FX, all empty lines | stalls: each shop a parchment card with an awning plate; each line an item icon plate; the purse is the coin glyph with the `coin-arc` | `item icons`, `glyph-coin-*`, `loop-lantern` |

**Story tab**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `StoryPanel` | chapters, the arc, generate, rewind with confirm, writing states | this is the book from 8b.4: chapters are pages, the arc is the contents page, rewind is tearing a page (confirm stays, in the kit dialog) | `book-spread`, `page-turning` |
| `QuestsPanel` | add, hide, complete, delete, empty | a quest scroll rack: each quest a scroll with its status glyph and a seal; the empty state is the empty rack | `glyph-quest-*`, `empty-scroll-rack` |
| `TimelinePanel` | rows and icons, empty | a real spine: a vertical rule with day-part glyphs at each node, events on alternating sides | `glyph-daypart-*` |
| `FactsPanel`, `PinsPanel`, `LorePanel` | pin, save, lore rows, all empty copy | index cards on a board (the notice board empty state); pins are map pins | `empty-notice-board`, `map-pin` |
| `EventLog` | rows, undo with confirm, empty | a ledger with a glyph per event kind (damage, loot, XP, condition, milestone) and the kit confirm | `glyph-*`, damage family icons |

**Notes, chat, context, settings tabs**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `NotesPanel` | four sections, suggest, publish, visibility toggle, both empties | notes are parchment chips with author medallions; the four sections become one list with filter tabs | `chip-plate` |
| `SideChatPanel`, `DmWhisperPanel` | thread list, thread view, mute, start chat, send, empty | bubbles with avatars; list to thread slides (`drawer-in-right`), back slides out | section 6 |
| `ContextPanel` | refresh, budget bar, blocks, kinds, dropped reasons, empty | the budget bar is 10 px with a scale and the over-budget stripe; blocks are cards with a coloured spine; a skeleton while loading | `PageSkeleton kind="list"` |
| `SessionSettings`, `GameSettingsPanel` | every toggle | grouped into collapsible sections with the brass switch; a search field at the top of the 971-line panel | `toggle-*` |

**DM and lead tabs**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `DmConsolePanel` | ribbon, floor control, beat composer, delegation, waiting queue with "what should I press", the nine chips, every adjudication button and `DmActionForm` | the adjudication list gets a command palette (type to filter, grouped by kind: rests, death, conditions, loot, story) reachable with `/` and a button; rests and death saves get their own rows with glyphs and open the dedicated surfaces in 8c.6 | `glyph-rest-*` |
| `LeadPanel` | ribbon, floor, notes to approve, director presets, invites card, seat card, details | six cards become a command desk: two columns on desktop, each card with a glyph title plate | `title-cartouche` |

**Session dialogs and overlays**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `CharacterSheetDialog`, `SheetSections` | every section and control, adjust hand-off | one implementation (8b.5) used by the session dialog and the character page | 8b.5 |
| `LevelUpDialog` | HP roll, ASI and feat, search, spells, apply | opens with the level-up moment (8c.6) then the form; the apply button is the gold plate | `glyph-rest-level-up`, `burst-radiant` |
| `TradeDialog` | both columns, gold fields, offer | a give and get axis with item icon plates; the offer button animates the exchange | item icons |
| `HandoutStage` | three styles, markdown with inline rolls, wax seal, download, take down, fold | unchanged in design; the lore body is fetched before the stage opens so there is no reflow; the parchment style uses the painted parchment | `parchment-body`, `parchment-edge` |
| `SceneTitle` | four tones, timing, skip rule, reduced-motion toast | unchanged; becomes the first client of the `MomentLayer` | |
| `DiceOverlay` | the tray, WebGL init | a visible fallback when WebGL fails (the 2D `D20Spinner` roll in a toast) | |
| `HelpDialog`, `HowToPlayDialog` | every section, mode rows, tours | a contents rail on the left with anchors and a search field | |
| `GuidedTour` | spotlight, card, keys, prepare, re-measure | the card and the spotlight move on one transition; re-measure by `ResizeObserver`, not polling | |

**Map tab**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| `MapPanel` | thumbnails, upload, regenerate, remove, populate, enlarge | the empty state is the map table plate; enlarge uses the kit lightbox | `empty-map-table` |
| `OverworldPanel` | canvas, zoom, pan, authoring | a map-shaped skeleton (parchment with the compass rose turning) while charting | `parchment-dark`, `compass-rose` |

**Characters**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| Roster (`characters/page.tsx`) | import, new, error banner, ribbon, cards with portrait and chips and assignment, the three actions, painting poll, empty | portrait medallion cards with the class emblem on the corner; the three actions in one menu; the portrait is the shared element into the detail page; the empty state is a plate | `portrait-medallion`, `class-*` family icons, `viewTransitionName="portrait-<id>"` |
| Detail (`[characterId]/page.tsx`) | back, lightbox portrait, name, chips, assignment, the six actions, sheet sections, story so far, not found | one primary (Use in a campaign) and a menu for the rest; the sheet is 8b.5 | 8b.5 |
| Pick from library (`campaigns/[id]/character`) | join, edit, replace flows, library list, create new | the list shows portraits, not icon chips | portraits |

**Workshop**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| Shelf (`workshop/page.tsx`) | help, tour, new, import bundle, inline create form with party and level, tiles, duplicate, delete, empty | tiles pick a plate by workshop id (see WorkshopSection); the number inputs are the kit stepper; skeleton grid | `NumberStepper` |
| Hub (`[workshopId]/page.tsx`, `SystemCards`) | sticky party bar, counts, fourteen cards, help, tour, not found | one nested spinner, not two, then the skeleton; the party bar gains a shadow on scroll; cards lift and tilt; the first empty card reads "start here" | section 6 `cardHover` |
| `SystemView` | back, name, count phrase, help, the rail of fourteen, every panel in every layout | the "rows" layouts get a wide variant with 13 px type and two columns; every list gets `ListControls` (search, tags, sort) | |
| Every system list (storyboard, party, encounters, cast, bestiary, homebrew, lore, tables, factions, plugin, rules, share) | every row, editor, control and empty sentence in `systems.ts` | one `EmptyState` (8c.3) with the system's plate and its existing sentence; rows carry the icon for their kind (monster type plate, item icon, spell icon, NPC portrait) | `placeholders/workshop/*`, icons |
| Storyboard `BeatBoard` | cards, editor, asides | a board: cards on cork with pins and drawn threads between linked beats; drag to reorder on desktop, move buttons on the phone (both stay) | `map-pin` |
| Cast `CastList` | portraits, editor | an empty state (it has none today) | `placeholders/npc/*` |

**Flat pages**

| Screen | Keeps | Becomes | Art and motion |
| --- | --- | --- | --- |
| Settings | avatar, dice, password, Discord, appearance, blocked players, deletion and delete with password or DELETE, about | the kit alert dialog; the danger section keeps its ribbon; sections get glyph title plates | `Dialog`, `glyph-*` |
| Friends | add, requests, friends with invite select and unfriend, sent with cancel, 30 s refresh, empty | the kit `Select` for invites; rows with medallions and the online candle; the empty state plate | `Select`, `candle` |
| Admin | all four panels and every field | grouped sections with a sticky contents rail; inline validation; unchanged otherwise (an admin surface stays plain by design) | |
| Reference | four modes, nine categories, search with in-field spinner, compare, results, all empties | results carry school colour, CR badge, rarity ribbon and the icon plate; "load more" past sixty | icons, `icon-plate-*` |
| Licenses, privacy, terms | all prose and lists | the book's typography (drop caps, rules) on the same content | `divider-rule` |

### 8c.3 One empty state, one skeleton

`src/components/EmptyState.tsx` (new): a plate (from the placeholder set or
the four `empty-*` cutouts), a serif line, a grey sub-line and an optional
action. The tier-three sentences in `systems.ts` and the session panels move
into it unchanged as the serif line. `PageSkeleton` kinds: `home`, `lobby`,
`table`, `roster`, `sheet`, `shelf`, `hub`, `system`, `list`, `flat`,
`region`. Skeleton blocks use `shimmer` on `parchment-dark` at 6 percent.

### 8c.4 The kit gains four controls

| Primitive | Replaces | Design |
| --- | --- | --- |
| `Select` | every native `<select>` | Radix select in the menu's skin; painted chevron; keyboard as native |
| `Slider` | the two `range` inputs | a brass rail and knob (`toggle-knob` at 20 px); haptic tick on the phone at each tenth |
| `NumberStepper` | every `type="number"` | minus and plus plates around the value; hold to repeat; typing still allowed |
| `DatePicker` | `datetime-local` | a calendar sheet with the day-part glyphs for the time row; typing the date still allowed |

Each keeps the underlying input in the DOM for forms and tests.

### 8c.5 The moment system

`src/components/MomentLayer.tsx` (new) owns the floating layer above the
table: one queue, one at a time, the z ladder in `globals.css` collapses to
three levels (moment, sheet, toast). Clients: `SceneTitle` (unchanged
choreography), `HandoutStage`, the level-up moment, the death-save strip's
climax, the rest sequence, the reward reveal (section 9 optional lift), and
the DM's "thinking" sigil. A moment declares `priority` and `interruptible`;
a title never collides with a handout again.

### 8c.6 The three moments and the two missing surfaces

| Moment | What happens |
| --- | --- |
| Enter world | the cover morphs from the tile to the lobby hero (8d), the title rules draw in, the party cards slide in staggered |
| Begin the adventure | the button fills gold left to right over `--dur-beat`, the lobby fades under a scrim, the `SceneTitle` "dawn" tone announces the campaign title, the table skeleton crossfades to the table |
| Level up | the `MomentLayer` shows the level ring (`level-ring` from section 6) around the portrait medallion with `burst-radiant` behind it and the level-up glyph; then the dialog opens on the same medallion |
| Death saves | a strip on the party card: three gold and three black pips as painted studs (`stamp-diamond`), a heartbeat pulse on the card border while dying, `fx-jolt` on a failure, `burst-radiant` on stabilising; the DM's adjudication opens the same strip in the console |
| Rest | a rest sheet (short or long) with the campfire loop, the party medallions around it, hit dice as dice glyphs to spend, and the recovery list; the DM's row in the console opens it for the table | 

Both surfaces are new components over existing engine calls; no engine
change. The rest sheet's recovery list is what the log already records.

### 8c.7 Interactive menus

- **Context menus on cards.** Campaign tile, character card, workshop tile,
  party card, monster row: right-click on desktop, long-press on the phone,
  the kit menu with glyphs. Every action in the menu is also reachable
  another way (the inline buttons stay on desktop).
- **Hover previews.** A spell, item or feature name anywhere (log, sheet,
  reference, the Hand) shows its icon plate and one line on hover or long
  press, from `iconFor` and the glossary, on the tooltip's motion.
- **The command palette** in the DM console (8c.2) and on the workshop hub
  (jump to a system, create an entry), bound to `/`.
- **Rails with travelling indicators** everywhere a row of tabs exists
  (session rail, sub-tabs, workshop rail, reference categories, admin
  segments).

### 8c.8 Tests

`scripts/test-screens.mjs` (new): every `Loader2` at page level is gone
(grep, allow-list of button spinners); every native `<select>`, `range`,
`number` and `datetime-local` in `src/app` is inside the kit primitives; the
five listed dialogs import the kit `Dialog`; every system in `systems.ts`
renders `EmptyState` with its sentence; the ledger columns above are
walked as a checklist in `docs/visual-overhaul-ledger.md` when phase 8c
closes.

## 8d. Workstream K: page transitions and loading

The complaint to fix: a new page arrives all at once after a blank or a
spinner, and the app "clings" to the old one while it loads. Two shells, two
mechanisms, one rule set.

### 8d.1 How navigation works today

| Shell | Mechanism | What the user sees |
| --- | --- | --- |
| Server pages (Next 16.3, React 19.2) | `next/link` in 24 files, but the hero navigations are plain anchors (`ContinueHero` "Enter world", `CampaignList` tile, the character card, the legal links) and `navigateTo` in `src/lib/navigation.ts` sets `window.location.href`; no `loading.tsx`, `template.tsx`, `error.tsx` or `not-found.tsx` anywhere; pages fetch their own data in effects | a full document load on the most important clicks; elsewhere the old page stays until the new route's JS is here, then the new page mounts empty and fills in list by list |
| Desktop and Android (Preact, `src/renderer/game/index.tsx`) | `GameRouter` swaps `location`; the matched page is `lazy(route.load)` inside `Suspense` with a bare spinner; the `Boundary` is keyed by pattern, params and query, so every navigation remounts from scratch; `prefetch(path)` exists but warms the module only; plain anchors are intercepted into `router.push`, which is why the apps feel faster than the browser | a spinner flash on first visit to a route, then a hard cut; a query change remounts the whole page; an unmatched path hands off to a web view with only a spinner |

### 8d.2 The rules

1. **Never a blank frame.** The outgoing page stays painted until the incoming
   page's shell is ready (its chrome and skeleton, not its data). The swap is
   one crossfade of `--dur-move` on `--ease-settle`.
2. **Skeleton in the page's own shape.** Each route ships a skeleton that is
   the page's real layout with parchment shimmer blocks in place of text
   (`shimmer` already exists in `globals.css`). No generic spinner on any
   route; the `D20Spinner` is reserved for the DM's turn.
3. **Content lands, it does not pop.** Lists reveal with `fade-up` staggered
   at 24 ms per row, capped at twelve rows; anything below the fold mounts
   still. Hero art fades from its blurred thumbnail (the placeholders are
   small enough to inline) to the full image on `decode()`.
4. **The chrome never reloads.** Top bar, account menu, session tab rail and
   the side drawer are shared layout: they keep their state and animate only
   their indicator.
5. **Shared elements morph.** A campaign cover in the list becomes the lobby
   hero; a character portrait in the roster becomes the sheet's medallion; a
   workshop cover becomes the tool's title plate. One `viewTransitionName`
   per element, `view-transition-class` for the timing.
6. **Direction has meaning.** Forward (list to detail) slides the new page in
   from the right by 24 px while fading; back slides it out; sibling tabs
   crossfade in place. Reduced motion: opacity only, 120 ms.
7. **Prefetch on intent.** Hover for 80 ms or `touchstart` on a link preloads
   the route module and its first data call. The apps' router gets
   `prefetch(url)` that calls `route.load()` and warms the page's `GET`.
8. **A slow host shows the scroll, not a wheel.** Past 600 ms the skeleton's
   title plate reads one line of flavour from `dmStatusPhrases.ts` ("The
   archivist is fetching the ledger"), rotated every 2.4 s. Past 8 s a retry
   link appears; the skeleton never spins forever.

### 8d.3 Server pages

- `src/app/template.tsx` (new) wraps every route in React's `<ViewTransition>`
  with `default="route"` and `enter`/`exit` classes bound to the direction
  flag that `navigation.ts` sets on `push` (`data-nav="forward|back|tab"`).
  The Next guide in `node_modules/next/dist/docs/01-app/02-guides/view-transitions.md`
  is the reference; no library.
- `loading.tsx` per route group: `home`, `campaigns/[campaignId]`,
  `characters`, `characters/[characterId]`, `workshop`,
  `workshop/[workshopId]`, `settings`, `friends`, `reference`, `admin`. Each
  renders the page's skeleton component (`<PageSkeleton kind="lobby" />` in
  `src/components/PageSkeleton.tsx`, new, one file, a switch over kinds).
- Data hooks return `{ data, pending }` so the skeleton and the content share
  a slot; the swap is `<ViewTransition>` around the `Suspense` boundary, the
  crossfade of rule 1.
- Every in-app anchor becomes `next/link` (the nine plain anchors in the
  inventory); `navigateTo` uses the App Router in the browser too and records
  the direction from the route depth (`/campaigns` to `/campaigns/x` is
  forward). Full document loads remain only for downloads and external links.
- Fonts: `display: swap` already; the title face is preloaded in `layout.tsx`
  so the first title never reflows.

### 8d.4 The apps

- `index.tsx`: keep the outgoing page mounted while `route.load()` resolves
  (`useTransition` from `preact/compat`, `startTransition(() => setLocation(next))`);
  the `Suspense` fallback becomes the route's `PageSkeleton` and only shows on
  a cold load of a route that has never loaded.
- The `Boundary` key drops `location.search`: a query change is a state
  change inside the page, not a remount. Pages that read `searchParams` already
  re-render on the prop.
- `document.startViewTransition` when present (Electron always; Android
  WebView on Chrome 111 and later), with the same `data-nav` direction classes
  as the server; otherwise a CSS crossfade on a wrapper that holds the old
  page's last paint as an `opacity` fade (no double-render: the old tree is
  kept for one frame under `pointer-events: none`).
- `GameRouter.prefetch(url)`: `matchRoute`, `route.load()`, and the page's
  declared `warm(params)` (a static on each page module, optional) which fires
  the first fetch through the patched `fetch` so the cache is hot.
- Android: `hardwareAccelerated` is already on; the crossfade uses `opacity`
  and `transform` only, never `filter`, so the WebView composites it.
- Haptic tick on route commit (`window.odm.haptic("nav")`, light) so the phone
  feels the page turn.

### 8d.5 Tests

`scripts/test-page-transitions.mjs` (new): every route in the server's app
tree has a `loading.tsx` or is a dialog route; every `PageSkeleton` kind is
used; `template.tsx` exists and wraps children once; the client router's
`prefetch` resolves every `ROUTES` entry without throwing; the direction
helper classifies the twenty listed pairs correctly. The Playwright rig
records one navigation per route and asserts no frame is fully blank
(sampled at 60 fps over the first 400 ms, luminance never 0 across the
viewport).

## 8e. Workstream L: more painted and animated furniture

Everything ComfyUI adds beyond 8b.4, in the same catalogues (`ui-set.mjs`,
`vfx-set.mjs`), rendered by the same generators and shown on the NAS page.

| Part | Catalogue id | Where it goes |
| --- | --- | --- |
| Arcane loading sigil | `sigil-loading` cutout, `loop-sigil` flipbook | route skeleton title plate past 600 ms; the DM "thinking" state on the phone |
| Compass rose | `compass-rose` | region and battle-map pages loading; the Forge's "generate" wait |
| Hourglass, quill, candle | `hourglass`, `quill`, `candle`, `loop-candle` | waiting-for-players, DM-is-writing indicator, live-session badge in the lobby list |
| Brass switch, parchment chip, wooden tab | `toggle-track`, `toggle-knob`, `chip-plate`, `tab-plate` | `role=switch`, condition and tag chips, the session tab rail and workshop tabs; text still lives in the DOM |
| Blank shield and hanging banner | `shield-blank`, `banner-vertical` | faction crests (the app composites the faction's colour and the `glyph-attitude-*` icon), the lobby's party banner |
| Map pin | `map-pin` | region map markers, quest locations, the Forge's placed-stamp cursor |
| Night sky | `stars-sky` tiling | home hero backdrop under the `dust-motes` layer and procedural fireflies; auth screen |
| Empty chest, scroll rack, notice board, map table | `empty-*` | empty states: inventory and loot, quests and handouts, notes and facts, maps and region |
| Campfire, lantern, caustics (fog is procedural) | `loop-campfire`, `loop-lantern`, `loop-caustics` | the rest sequence (8c.2), tavern and shop drawers, horror and mystery scene bars, coast and flooded maps on the board |

Rendering cost: 17 cutouts and flats at about 20 s, five loops (candle, campfire, lantern, sigil, caustics) at about
110 s, under twenty minutes; queued as `/tmp/odm-chain-loops.sh` behind the
icon remainder. `public/assets/ui/` stays under its 3 MB cap (the flats are
the cost; the night sky ships at 512 px).

## 9. Phases

| Phase | Contents | Depends on | Gate |
| --- | --- | --- | --- |
| **1. Assets** | Catalogues for objects and decals; `--variants`, `--paint`, contact sheets and review file; the full GPU run in category order; seam and byte tests; `build-map-preview.mjs` | none | `/NAS/odm-map-preview.html` published |
| **2. Renderer v3 on the preview** | `src/lib/battlemap/render/*` as a module the preview page imports; skins; the sample maps; fog, light and grid demos | 1 | **user sign-off on the preview page** |
| **3. Map port** | Renderer under the editor canvas and the play board; skin column, projection, deploy, capture, duplicate, bundle; gallery thumbnails; `test-map-skins`, `test-map-render` | 2 | ledger 1.1 rows for rendering checked |
| **4. Motion kit** | Section 2 files, section 6 primitives, `GoldTitle`, `DiamondStepper`, `StepWipe` | none | reduced motion and low effects verified on a phone |
| **5. Map Forge and Map Editor** | Sections 4.1 to 4.7, phone layout, props as stamps, the studio adopting the Forge | 3, 4 | ledger 1.1 complete |
| **6. Board as a stage, rolls, delivery** | Sections 5.1, 5.4, 5.5 | 3, 4 | `test-delivery`, `test-beats` green; frame time under 16 ms at p95 with forty tokens on a mid-range phone (the Playwright rig) |
| **7. The Hand and intent** | Sections 5.2, 5.3, 5.6, 5.7 | 6 | ledger 1.2 complete; `test-hand`, `test-intent` green |
| **8. Creators** | Sections 7 and 8 | 4 | ledgers 1.3 and 1.4 complete; creator tests green |
| **1b. Art program** | Genre tile sets and objects (8b.1), the icon set (8b.2), VFX flipbooks (8b.3), UI furniture (8b.4); each set on its own contact sheet on the NAS page | 1 | the sets on the preview page, reviewed |
| **6b. Flipbooks on the board** | `BoardFx` plays the sheets from 8b.3 through the delivery table; SVG stays the fallback | 6, 1b | frame time gate as phase 6 |
| **8b. Sheet, scroll, book** | 8b.5 character sheet with icons; the scroll for narration and handouts; the book for the archive | 4, 1b | ledger for the sheet complete |
| **4b. Transitions and chrome** | 8d (template, skeletons, prefetch, the apps' router), 8c.3 and 8c.4 (`EmptyState`, `PageSkeleton`, the four controls), the five dialogs onto the kit, `AppHeader` and `AccountMenu` and the bell | 4 | `test-page-transitions`, `test-screens` green; no blank frame in the Playwright navigation recordings |
| **8c. The rest of the app** | 8c.2 screen by screen in this order: front door and home, lobby and the three moments (8c.6), session tabs, characters, workshop, flat pages; 8c.5 `MomentLayer`; 8c.7 menus and previews | 4b, 1b (icons and furniture) | every "keeps" cell walked on both shells; `docs/visual-overhaul-ledger.md` complete |
| **8e. Furniture** | the 8e parts and loops on the NAS page, then wired into 8c.2 | 1b | contact sheet reviewed |
| **9. Optional lifts** | Reward reveal tiers on item offers; NPC conversation mode; on-demand icon painting for homebrew | 4 | as scheduled |
| **10. Release** | `docs/ROADMAP.md`, `docs/rules-coverage.md` (intent, structured attack intent), bump `NATIVE_MIN_SERVER`, server tag then client bundle then client release | all | |

### 9.0 What shipped in 0.20.0

The first slice, chosen because each piece stands alone and none removes a
control: the painted board under the existing grid, fog and light (phase 3,
play board only; the editor canvas and the gallery thumbnails still draw the
old way), token faces (5.1), icons on the sheets, conditions, market and
reference (part of 8b.2 and 8b.5), flipbooks for energy damage, healing, death
and crits (6b), route crossfades on both shells with the three hard
navigations made soft (the first part of 8d), and the device setting for
painted maps. Everything else in the phase table is still to build. The
renderer lives in `src/lib/battlemap/render/renderer.js` and the preview page
inlines that same file, so there is one renderer, not a reference and a port.

### 9.0b What shipped in 0.21.0 (client 0.12.0)

The redesign the mockups drew, and its carry-through to the screens they did
not draw. It was reviewed on the local service before it was published, which
is the rule for every slice of this plan.

| Area | What is built | Ledger |
| --- | --- | --- |
| Motion kit (4) | one delegated pointer listener (`src/lib/motion/pointer.ts`) driving magnet, tilt, sheen, ripple and nudge on the shared `ui.*` classes; spring dialogs, menus and tooltips; `GoldTitle`; travelling indicators on the session rail and `SegmentedControl`; busy sweep on `aria-busy` buttons; all still under reduced motion, loops off under low effects | no control changed |
| Character creator (7) | diamond stepper, gold step wipe, the 4d6 dice grid with the dropped die, standard array slots, point buy steppers, lineage and class card grids with the detail carousel, method and hit point explainers | every row of 1.3 kept; setting and pack recommendations now lead their grid with a starred heading and a badge on each card; descriptions behind the card's "?" and the chosen line's info button |
| Campaign creator (8) | six-step wizard on the diamonds, world portals with climate and "humans only" chips, the typed theme, the table sheet with its running total, the cover read-back | every row of 1.4 kept; all 30 settings still sent |
| The Hand (5.2, 5.3) | fanned cards for weapons, prepared spells, class features and the basic actions, aim bar with target chips and the outcome preview, two-step commit, "+n more" sheet, tutorial, phone layout | composer, modes, banners, token HUD untouched; typing a move still works |
| Board stage, rolls, delivery (5.1, 5.4, 5.5) | turn spotlight, initiative rail of portraits, turn HUD with action pips from the engine's budget, turn banner, aim scrim and reticles, violet roll cards with the landing animation, delivery shapes per damage type, faces on every token and row | every row of 1.2 kept; 3D dice untouched |
| Enemy intent (5.6) | likely and declared intent projected with redaction, the `declare_intent` tool, a table setting to turn it off | new; off hides it entirely |
| Map Forge and Editor (3, 4) | see the workstream report | every tool kept |
| Character sheet (8b.5) | one implementation (`src/components/sheet/SheetParts.tsx`) for the session dialog and the character page: medallion, painted ability tiles with tiered numbers and saves, hit point bar, vitals medallions, skill rows with icons, icon chips that preview on hover and open their entry; carried items now open their library description | every field kept; the library sheet gained saves, skills, initiative, passive perception and spell DC |
| Furniture (8e) | the painted scroll unrolls parchment handouts; the chronicle book turns pages through closed chapters from the Story tab; drifting dust under every page | handout stamp, seal, download, take down and fold kept; chapter list, edit, rewind kept |
| Moments (8c.5, 8c.6) | level-up flourish before the dialog, rest by the campfire, loot reveal in three tiers, travel banner on a new place, death-save strip with painted studs | pictures over what the engine already did |
| Rest of the app (8c) | page skeletons in place of spinners on every route, painted empty states in every panel, kit switch, notification bell and account menu on the kit, lobby, schedule, invite and campaign editor restyle, context menus, command palette, workshop shelf and lists, reference badges | every control kept; menu actions stay reachable inline |
| Motion on everything (6) | `src/lib/motion/answer.ts` gives every button, chip, tab, link tile and menu row a hover lift, a press that sinks and springs back, and a pop when it turns on, with no class needed; `src/lib/motion/pill.ts` slides one highlight between the choices of any row marked `data-pill-group` and every `role="tablist"` (the composer's Do, Say, OOC, Direct and some 25 other rows); each mockup was then audited control by control and the gaps built | elements with kit physics or their own `translate` and `scale` are left alone; nothing runs under reduced motion |
| Kit controls (8c.4) | `Select`, `NumberStepper` (hold to repeat, typing held as a draft until it is inside the limits), `Slider`, `DateTimePicker`, `Switch`, `SectionHead`, `ContextMenu`, `Reveal` and `CountPop`; the browser's own select, number, range and date controls are replaced across the app | same values, limits, handlers and accessible names |
| Design carry-over (8c.2) | session panels (`panels.css`, `PanelKit.tsx`), the DM console (`dm-console.css`, `DmConsoleParts.tsx`), the workshop systems (`workshop/kit.tsx`), account, help and admin (`account.css`), the session frame (`session.css`: painted rail, glyph headings, message medallions, mode pills) | invite revoke and world pack removal now confirm first; every other action as before |
| Icon plate | the disc behind every painted icon is lit from its centre and the painting carries a thin warm rim light, so the dark paintings (hooded, petrified, hidden) read on the night theme; the party glyph was re-rendered in colour | none |
| Guided tours | the table tour (13 steps), the workshop shelf tour (4) and the in-workshop tour (6) were walked in a browser after the redesign; every step finds its anchor | anchors kept through every restyle (`scripts/test-tours.mjs`) |
| Front door (8c.2) | two panels on a desk (`AuthScreen` in `src/app/page.tsx`, styles in `account.css`): a portrait crop of one genre painting per visit from `public/assets/ui/door/`, a slow drift, fourteen CSS fireflies, a caption pinned to the screen; the form alone below 1024 px | every login option, the Discord button, How to play and the legal links kept |
| Day theme | glass surfaces (table header, composer) were unreadable in daylight; fixed | none |
| Client apps (10) | `build-renderer.mjs` inlines the stylesheets `globals.css` imports and ships `public/assets/ui` beside the game sheet so CSS backgrounds resolve; the game router shows the server's page skeletons, keeps a page mounted across a query change, warms a route on hover or touch, and lays the dust layer | both shells build from the same components |

Found and fixed on the way: 25 of the pack's 81 races (Hill Dwarf, High Elf
and the rest of the expanded set) wrote their ability bumps as a map, which
`raceMechanics` read as none; trait names were cut at the full stop inside
"(adv. vs poison)". Both are covered in `scripts/test-character-grants.mjs`.

Not built: the NPC conversation panel (section 6.1 item 8), which is a new
play mode with its own model calls rather than a restyle.

### 9.1 Where the art stands (2026-09-18)

| Set | Count | State |
| --- | --- | --- |
| Surfaces and fittings | 346 tiles, 293 seamless in three variants | rendered; the seam suite passes (`scripts/test-map-assets.mjs`), with two lined textures on a checked allow-list |
| Genre tile sets | cyberpunk, steampunk, wasteland, horror, mystery | rendered; cyberpunk redone on the corrected pipeline |
| Objects and decals | 253 and 72 | rendered and re-rolled from `prop-review.json` |
| Icons | 2,008 | rendered; OCR text loop running to clean |
| Effect flipbooks | 34 | magical and elemental effects, projectiles, beams, moments and flame loops; physical hits, dust and rings stay drawn |
| UI furniture | 45 | rendered |
| Preview page | `/NAS/odm-map-preview.html` | maps, surfaces, objects, decals, icons, effects, UI furniture |

The preview page was signed off on 2026-09-18 and the first slice shipped the
same day (9.0). The asset suites are `scripts/test-map-assets.mjs`,
`test-map-painted.mjs`, `test-icons.mjs` and `test-flipbooks.mjs`.

Phases 1 and 4 run in parallel from day one. Phase 1's GPU run is a background
job; the review of its contact sheets is the bulk of its human time.

---

## 10. Carrying every change into the client apps

The apps draw the server's pages as their own screens (client 0.8.0 and later;
`src/renderer/game/index.tsx` in `open-dungeon-master-client` compiles
`src/app` components with Preact; `runtime.ts` patches fetch, EventSource and
media). Everything in this plan is built once in `src/app`, `src/components`
and `src/lib` as client components, and reaches the apps at their next bundle.
The client repo changes only where listed.

| Phase | Client change | Kind |
| --- | --- | --- |
| 1 Assets | Nothing at build time. The payload budget (`scripts/test-placeholders.mjs`) gains the three caps in 2.3; `prune-server-payload.mjs` must keep `public/assets/tiles` and `public/assets/props` | payload rule |
| 2 Renderer on the preview | Nothing | none |
| 3 Map port | The renderer loads tiles through `<img>` from root-relative `/assets/...` paths, which the media patch turns into token-fetched object URLs; the LRU in `runtime.ts` (cap 64) is too small for 546 surfaces, raise it to 1024 entries keyed by path. Canvas 2D `createPattern` needs the image decoded; use `decode()` before drawing. Verify hardware canvas on the Android WebView | runtime patch, verify |
| 4 Motion kit | Pointer physics attach only on fine pointers; on Android nothing attaches. Haptics on card commit, hit and crit through `window.odm.haptic(kind)` (exists since the parity plan) | none |
| 5 Forge and Editor | Hotkeys stay desktop affordances with on-screen twins; the phone rail and sheets are the Android path. The stamp picker sheet and the material picker sheet are ordinary sheets. `contextmenu` prevented on the rail so long-press does not select text | verify |
| 6 Stage, rolls, delivery | The delivery particles run on the existing single particle canvas under `requestAnimationFrame`; `document.hidden` already drops effects. Low tier halves counts on `deviceClass === "low"` | none |
| 7 The Hand | The structured `intent` body on `POST /actions` is a new field an older host ignores; the card falls back to composing prose when the host's `/api/capabilities` does not report `handIntent: true` (new capability flag). No new route | version gate via capability, not `NATIVE_MIN_SERVER` |
| 8 Creators | The campaign dialog is reachable from the home screen in the apps; the wider dialog must fit the phone (two-column portals). `/characters/new` already routes | verify |
| 4b Transitions | `index.tsx` keeps the outgoing page mounted through `startTransition`, drops `location.search` from the `Boundary` key, renders `PageSkeleton` as the Suspense fallback, and calls `document.startViewTransition` when present; `GameRouter.prefetch` warms the page's first `GET` as well as the module; the unmatched-path hand-off shows the skeleton, not a spinner | client repo, `src/renderer/game/index.tsx` and `src/shared/game-router.ts` |
| 8c Screens | Nothing at build time: every screen is a server-repo client component. Long-press replaces right-click for the context menus; the four kit controls must be touch-sized; the `Slider` haptic uses `window.odm.haptic("tick")` | none, checked on both shells |
| 8e Furniture | The parts ship under `public/assets/ui/` inside the existing budget; loops under `public/fx/` | payload budget test |
| 9 Optional | Conversation mode is a Story tab state, no route | none |
| 10 Release | Bump `NATIVE_MIN_SERVER` only if phase 7 keeps the capability fallback out; otherwise the fallback means older hosts keep working and the bump is not needed | version gate |

Constraints restated: no server components or actions in any new file, every
request root-relative, every media path root-relative, no window dialogs, no
`next/dynamic` with server loaders.

Every phase is checked on **both shells**: the desktop app (Electron, connected
to a host and in app-only mode, where the bundled server serves `public/`
from the vendored tree) and the Android app (Capacitor, connected to a LAN
host). The check is the phase's ledger rows walked through the app's native
screens, plus the renderer bundle build (`scripts/build-renderer.mjs`), the
Android `www` payload build, and the two client test suites. The desktop
app-only mode is the one that must carry the tile and object folders inside
its payload, so the payload budget in 2.3 is the desktop installer's budget
too.

---

## 11. Acceptance

A phase closes when:

1. Its ledger rows in section 1 are checked in the browser and on a phone
   through the app's native screens.
2. Its tests exist, pass, and are in `scripts/test-all.mjs`; the full suite is
   green in CI and on the Windows smoke runner (no content pack there; any test
   reading pack data carries a fallback).
3. Every new secret (declared intent for a target that cannot see the actor,
   DM-only labels, hidden tokens) is projected in `view.ts` with a test that a
   player payload does not contain it.
4. Every animation is inside the motion scale, has a reduced-motion fallback,
   stops its loops under low effects, and the board stays under 16 ms at p95
   with forty tokens and a storm on a mid-range phone.
5. The byte budgets hold and the renderer bundle builds in the client repo.
6. `docs/ROADMAP.md` records the phase.
7. For phases 4b and 8c: no route paints a page-level spinner, no screen has
   more than one empty-state style, no native `select`, `range`, `number` or
   `datetime-local` control is visible, and every "keeps" cell in 8c.2 is
   ticked in the ledger file.

---

## 12. Open questions

Four, none blocking phase 1:

1. **Should dressing be editable?** This plan draws dressing automatically and
   lets the DM place stamps. A "sweep this tile clean" eraser for dressing is
   a small addition (a per-map list of suppressed tiles) if the automatic
   dressing lands somewhere a DM dislikes. Deferred until the preview shows
   whether it is needed.
2. **Card art.** Closed by 8b.2: the icon set gives every card its own
   painted art, with a family fallback for anything the set does not name.
3. **Pack items beyond the SRD.** 1,750 more icons (8 MB, four hours) would
   give every pack magic item its own picture instead of the kind fallback.
   Decide after the first 2,008 are reviewed; the generator already accepts
   the wider filter.
4. **Sound for the new moments.** The level-up, death-save and rest moments
   want stings the ambience library does not have. ComfyUI can run an audio
   model (ACE-Step, not installed today) to make them; out of scope here,
   noted so it is not lost.
