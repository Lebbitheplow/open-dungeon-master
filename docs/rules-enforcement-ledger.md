# Rules enforcement ledger

Written by `node scripts/enforce-report.mjs --write`. Do not edit by hand: the
gaps listed here are the `gap()` calls in `scripts/test-enforce-*.mjs`, and a
gap leaves this list by being fixed and turned into a `test()`. What the
suites are, which ruleset they hold ODM to and the order of repair are in
`docs/rules-enforcement-audit.md`.

131 suites, 2607 rules enforced, 0 known gaps (0 high, 0 medium, 0 low).

| Severity | Gap | Rule | Where | Observed |
|---|---|---|---|---|

| Suite | Enforced | Gaps |
|---|---|---|
| `test-enforce-abilities` | 14 | 0 |
| `test-enforce-action-economy` | 16 | 0 |
| `test-enforce-actions` | 27 | 0 |
| `test-enforce-advantage` | 19 | 0 |
| `test-enforce-afflictions` | 14 | 0 |
| `test-enforce-ai-rolls` | 7 | 0 |
| `test-enforce-armor` | 30 | 0 |
| `test-enforce-attack-riders` | 23 | 0 |
| `test-enforce-attacks` | 18 | 0 |
| `test-enforce-attunement` | 26 | 0 |
| `test-enforce-authored` | 36 | 0 |
| `test-enforce-backgrounds` | 15 | 0 |
| `test-enforce-board-moves` | 3 | 0 |
| `test-enforce-bonus-actions` | 18 | 0 |
| `test-enforce-campaign-config` | 18 | 0 |
| `test-enforce-caster-features` | 9 | 0 |
| `test-enforce-casting-components` | 8 | 0 |
| `test-enforce-casting-limits` | 21 | 0 |
| `test-enforce-casting-numbers` | 22 | 0 |
| `test-enforce-casting` | 24 | 0 |
| `test-enforce-checks` | 20 | 0 |
| `test-enforce-class-tables` | 39 | 0 |
| `test-enforce-commerce` | 27 | 0 |
| `test-enforce-companion-sheets` | 21 | 0 |
| `test-enforce-concentration` | 20 | 0 |
| `test-enforce-conditions-actions` | 51 | 0 |
| `test-enforce-conditions-attacks` | 66 | 0 |
| `test-enforce-conditions-duration` | 57 | 0 |
| `test-enforce-consumables` | 4 | 0 |
| `test-enforce-creation-grants` | 21 | 0 |
| `test-enforce-creation-routes` | 20 | 0 |
| `test-enforce-currency` | 19 | 0 |
| `test-enforce-damage-types` | 96 | 0 |
| `test-enforce-death` | 41 | 0 |
| `test-enforce-downtime` | 9 | 0 |
| `test-enforce-economy` | 5 | 0 |
| `test-enforce-enemies` | 22 | 0 |
| `test-enforce-enemy-turns` | 14 | 0 |
| `test-enforce-exhaustion` | 40 | 0 |
| `test-enforce-exploration` | 8 | 0 |
| `test-enforce-explore-defects` | 17 | 0 |
| `test-enforce-explore-rules` | 13 | 0 |
| `test-enforce-feats` | 26 | 0 |
| `test-enforce-feature-saves` | 17 | 0 |
| `test-enforce-feature-uses` | 27 | 0 |
| `test-enforce-final-engine` | 27 | 0 |
| `test-enforce-final-features` | 17 | 0 |
| `test-enforce-final-ui` | 4 | 0 |
| `test-enforce-fixture` | 6 | 0 |
| `test-enforce-font-of-magic` | 11 | 0 |
| `test-enforce-forced-saves` | 8 | 0 |
| `test-enforce-genre-classes` | 9 | 0 |
| `test-enforce-hazards` | 42 | 0 |
| `test-enforce-homebrew` | 12 | 0 |
| `test-enforce-import` | 12 | 0 |
| `test-enforce-initiative` | 21 | 0 |
| `test-enforce-inventory` | 25 | 0 |
| `test-enforce-last-combat-board` | 12 | 0 |
| `test-enforce-last-combat` | 19 | 0 |
| `test-enforce-last-spells` | 17 | 0 |
| `test-enforce-levelup` | 20 | 0 |
| `test-enforce-long-rest` | 17 | 0 |
| `test-enforce-magic-gear` | 20 | 0 |
| `test-enforce-magic-items` | 20 | 0 |
| `test-enforce-maneuvers` | 16 | 0 |
| `test-enforce-monster-actions` | 14 | 0 |
| `test-enforce-monster-blocks` | 13 | 0 |
| `test-enforce-monster-traits` | 20 | 0 |
| `test-enforce-movement` | 26 | 0 |
| `test-enforce-multiclass-features` | 13 | 0 |
| `test-enforce-multiclass-levelup` | 27 | 0 |
| `test-enforce-multiclass-library` | 10 | 0 |
| `test-enforce-multiclass-slots` | 18 | 0 |
| `test-enforce-narration-guard` | 7 | 0 |
| `test-enforce-narrator` | 54 | 0 |
| `test-enforce-objects-terrain` | 4 | 0 |
| `test-enforce-patch-fields` | 27 | 0 |
| `test-enforce-pc-attack-board` | 15 | 0 |
| `test-enforce-pc-attack-features` | 19 | 0 |
| `test-enforce-pc-attack-spells` | 14 | 0 |
| `test-enforce-permissions` | 17 | 0 |
| `test-enforce-persistence` | 13 | 0 |
| `test-enforce-player-bypass` | 31 | 0 |
| `test-enforce-player-patch` | 18 | 0 |
| `test-enforce-proficiencies` | 15 | 0 |
| `test-enforce-races` | 23 | 0 |
| `test-enforce-range` | 16 | 0 |
| `test-enforce-reactions` | 26 | 0 |
| `test-enforce-resource-spend` | 25 | 0 |
| `test-enforce-resource-tables` | 16 | 0 |
| `test-enforce-rest-choice` | 4 | 0 |
| `test-enforce-roll-carriers` | 6 | 0 |
| `test-enforce-rolls-trust` | 20 | 0 |
| `test-enforce-sheet-between` | 2 | 0 |
| `test-enforce-short-rest` | 21 | 0 |
| `test-enforce-spell-counts` | 10 | 0 |
| `test-enforce-spell-data` | 21 | 0 |
| `test-enforce-spell-effects` | 17 | 0 |
| `test-enforce-spell-engine` | 26 | 0 |
| `test-enforce-spell-hooks` | 32 | 0 |
| `test-enforce-spell-last` | 28 | 0 |
| `test-enforce-spell-learning` | 21 | 0 |
| `test-enforce-spell-mechanics` | 14 | 0 |
| `test-enforce-spell-riders` | 20 | 0 |
| `test-enforce-spell-rows` | 24 | 0 |
| `test-enforce-spell-slots` | 27 | 0 |
| `test-enforce-spell-tail` | 22 | 0 |
| `test-enforce-starting-kit` | 11 | 0 |
| `test-enforce-subclasses` | 13 | 0 |
| `test-enforce-summons` | 28 | 0 |
| `test-enforce-supplies` | 5 | 0 |
| `test-enforce-sync` | 13 | 0 |
| `test-enforce-tail-attacks` | 15 | 0 |
| `test-enforce-tail-features` | 9 | 0 |
| `test-enforce-tail-movement` | 6 | 0 |
| `test-enforce-temp-hp-healing` | 16 | 0 |
| `test-enforce-tool-args` | 20 | 0 |
| `test-enforce-turn-actions` | 28 | 0 |
| `test-enforce-turn-end` | 6 | 0 |
| `test-enforce-turn-order` | 18 | 0 |
| `test-enforce-ui-dm` | 19 | 0 |
| `test-enforce-ui-play` | 11 | 0 |
| `test-enforce-usage-route` | 17 | 0 |
| `test-enforce-use-item` | 7 | 0 |
| `test-enforce-variant-rules` | 22 | 0 |
| `test-enforce-weapon-rules` | 21 | 0 |
| `test-enforce-weapons` | 28 | 0 |
| `test-enforce-wild-shape` | 15 | 0 |
| `test-enforce-xp` | 17 | 0 |
| `test-enforce-zones-ui` | 11 | 0 |
| `test-enforce-zones` | 52 | 0 |
