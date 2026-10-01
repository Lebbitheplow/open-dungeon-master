# Equipment enforcement report

The second audit and repair (2026-09-30) and the state after it are in [`../rules-enforcement-audit.md`](../rules-enforcement-audit.md); this report describes the first audit.

Area: weapons, armor, shields, gear, inventory, currency, encumbrance, shops and trade, magic
items and attunement, item use, homebrew gear.

Result: 8 test files, 146 test() enforced, 38 gap() recorded. Every file passes with
`node scripts/<file>` (5 runs in a row each, identical counts) and under
`npx vitest run` (8 files passed). ESLint is clean on all nine new files. No em or en dashes.
Nothing under src/ was edited and no existing test or shared helper was touched.

## Files written

| File | lines | test() | gap() |
|---|---|---|---|
| scripts/lib/enforce-equipment.mjs (local helper: dummy target, flat board, forced swing) | 126 | | |
| scripts/test-enforce-weapons.mjs | 378 | 23 | 5 |
| scripts/test-enforce-weapon-rules.mjs | 294 | 13 | 8 |
| scripts/test-enforce-armor.mjs | 362 | 23 | 7 |
| scripts/test-enforce-inventory.mjs | 346 | 22 | 3 |
| scripts/test-enforce-currency.mjs | 271 | 17 | 2 |
| scripts/test-enforce-commerce.mjs | 404 | 24 | 1 |
| scripts/test-enforce-attunement.mjs | 254 | 13 | 6 |
| scripts/test-enforce-magic-items.mjs | 315 | 11 | 6 |

Determinism: every combat case runs on a board the helper flattens to open floor, indoors, with
the dummy at (0,0) and heroes placed on known squares; every die is forced and the unused queue
is checked. The suites seat an "anchor" hero first in the order and swing with a second hero,
because the action budget binds only the combatant whose turn it is; the economy cases swing
with the anchor and reset `turnBudget` between cases.

## Ruleset as implemented

Weapons
- All 37 SRD 5.1 weapons are in `src/lib/srd/weapons.ts` with the book's category, kind, die,
  type and mechanical properties. 25 further genre weapons (firearm, exotic) share the table.
- One range per weapon (`rangeFt`, the normal range). The engine allows a shot to twice that at
  disadvantage (`map-tools.ts checkPcAttackRange`). Not declared as a deviation anywhere; the
  code comment calls it "the SRD long-range rule". Recorded as a gap.
- The versatile die is derived (d6 to d8, d8 to d10, d10 to d12) and matches every SRD entry.
- "special" is not a property: Lance and Net have none of their special rules.
- Magic bonus is read from the item NAME, +1 to +3 only (documented: rules-coverage "Magic
  weapon/armor +N (read from item name)").
- Ammunition is a documented variant, default off (rules-coverage "Deliberate omissions").
- Two-handed, versatile and off-hand are flags the CALLER passes to pc_attack; the sheet's hands
  are not modelled. There is no "wielded" state for weapons at all.

Armor
- All 12 SRD suits and the shield match the book (base, DEX cap, STR, stealth, weight). Six
  genre equivalents share the table.
- `equipped` is opt in: a sheet where no item is marked equipped wears the best suit and shield
  it carries (documented in armor.ts and the schema).
- AC is derived on every patchSheet unless `acOverride` pins it; clamped 1 to 30.
- Unarmored Defense (barbarian, monk), Draconic Resilience and Mage Armor are alternative bases.
- Untrained armor: disadvantage on STR and DEX checks and saves in `dm/rolls.ts` only.
- Heavy armor under its STR score: minus 10 ft in `speedFor`.

Inventory and encumbrance
- Tools are `grant_item` (the brief's give_item), `remove_item`, `use_item`, `reveal_item`,
  `purchase`, `party_stash`, `party_award`.
- Encumbrance is a documented variant, default off. Deliberate deviation, declared in
  `srd/encumbrance.ts`: past STR x 15 the item is kept and the heavy penalties apply, where the
  SRD says it cannot be carried. Unweighable items count as unknown, not zero (documented).
- Players cannot write pack or purse outside a level-up (sheet route PATCH allows portrait,
  notes, backstory).

Currency
- Stored as whole gold plus 0 to 99 copper. Deliberate rule, declared in `srd/currency.ts`:
  `modify_gold` never refuses a loss, it empties the purse and reports `short`. The paying
  paths (purchase, buy_item, deposit, withdraw, trade) refuse.

Shops and trade
- ODM's own rules (rules-coverage "Commerce"): markup ladder 0.8 to 2, keeper buys at half
  list, one haggle per character per shop, haggle DC by settlement size.
- Trades are validated at offer and again at acceptance, inside one transaction.

Magic items
- 101 generated rows in `classes/magic-items.json`, five effect kinds. Documented omission:
  items whose prose does not parse stay narrative (about 1500 of 1618).
- Deliberate rule, declared in the `magic-items.ts` header: an effect counts while the item is
  CARRIED and, if required, attuned. SRD also requires it to be worn.
- Attunement cap of 3 enforced in `patchSheet` (capAttunement keeps the first three).

Homebrew
- Bounded where written (`homebrew/gear.ts GEAR_LIMITS`): armour 10 to 21, shield 1 to 5,
  bonus within 5, score 3 to 30, six effects. Weapon damage has no bound beyond being a valid
  dice expression. Matched to a sheet row by slug, then by NAME against the sheet owner's own
  entries, on every read.

## Findings

Severity high

1. inventory-level-up-carries-loot (test-enforce-inventory)
   Rule: gold and equipment come from the table, never from the player's own request.
   Observed: a PATCH with `level: current + 1` also set gold to 1,000,000 and replaced the pack
   with "+3 Plate" and 999 Potions of Supreme Healing. Status 200.
   Root cause: `src/app/api/campaigns/[campaignId]/sheet/route.ts` PATCH, lines 721 to 734:
   `levelingUp` opens every key of patchSheetSchema (gold, copper, equipment, ac, conditions,
   currentHp). The route also never checks XP.
   Reproduce: PATCH /sheet `{ level: L+1, gold: 1000000, equipment: [...] }`.
   Fix: on a level-up accept only the level-up keys (level, maxHp, hitDice, abilities, feats,
   features, spellcasting, subclass, expertise, levelUp*); drop or refuse the rest.

2. weapons-not-carried (test-enforce-weapons)
   Rule: a character attacks with a weapon they hold.
   Observed: a hero with an empty pack swung "Greatsword" for 2d6 (14 damage applied).
   Root cause: `src/lib/dm/attack-logic.ts resolveAttackWeapon`, lines 84 to 93:
   `weaponOf(carried) ?? matchWeapon(arg)` falls through to the SRD table when nothing carried
   matches.
   Fix: when a name is given and no carried item matches, resolve to improvised or refuse.

3. magic-item-generic-names (test-enforce-attunement)
   Rule: an item has a magic item's effect only if it is that item.
   Observed: a carried "Pouch" (SRD gear, 5 sp) stores AC 12 on an unarmored DEX 10 hero. By
   the same path "Potion" sets STR to 25 (Potion of Ebbing Strength) and "Staff" resists cold
   (Staff of Winter and Ice); none requires attunement.
   Root cause: `src/lib/srd/magic-items.ts matchMagicItem`, lines 62 to 66: the candidate filter
   includes `item.match.includes(wanted)`, so a carried name that is a fragment of a magic
   item's name resolves to the longest such item.
   Fix: drop the reverse containment; match exact, or carried name contains the full item name
   on word boundaries.

4. homebrew-redefines-srd-gear (test-enforce-magic-items)
   Rule: what a player writes in their own workshop does not change a campaign's weapons.
   Observed: the player POSTed a homebrew item named "Dagger" with damage "12d12 piercing";
   their sheet's Dagger then rolled 12d12 (144) in pc_attack.
   Root cause: `src/lib/db/homebrew.ts hydrateHomebrewGear`, lines 125 to 150 (name match
   against the sheet OWNER's entries on every read) plus `attack-logic.ts resolveAttackWeapon`
   line 87 (the snapshot beats the SRD table). Same path for armour and magic effects.
   `homebrew/gear.ts normalizeWeapon` puts no bound on the dice.
   Fix: hydrate only rows that carry a `homebrew:` slug, require the campaign to have admitted
   the entry (DM approval or campaign-scoped homebrew), and bound weapon dice.

5. homebrew-snapshot-from-the-client (test-enforce-magic-items)
   Rule: the gear snapshot on an equipment row is the server's to write.
   Observed: a creation payload with `equipment[0].gear.magic = { requiresAttunement: false,
   effects: [set STR 30, save +50] }` was stored; derived STR +10 and WIS save +50.
   Root cause: `src/lib/schemas/sheet.ts equipmentItemSchema` line 104 accepts `gear` from the
   wire and `schemas/homebrew.ts homebrewGearSchema` (lines 31 to 60) has no bounds;
   `hydrateHomebrewGear` returns a row with no matching entry unchanged (line 137).
   Reachable from POST /sheet, PUT /sheet, /api/characters and the level-up PATCH.
   Fix: strip `gear` from every incoming equipment row and let hydration be the only writer.

Severity medium

6. hands-versatile-with-shield, 7. hands-two-handed-with-shield (test-enforce-weapon-rules)
   Observed: with Shield, Chain Mail and the weapon all equipped (AC 18) a longsword rolled
   1d10 with twoHanded, and a greatsword hit for 2d6.
   Root cause: `src/lib/dm/pc-attack.ts handlePcAttack` lines 365 to 370 takes `twoHanded` from
   the caller; nothing reads the sheet's equipped shield. `armor.ts computeArmorClass` never
   reads the wielded weapon.
   Fix: refuse (or drop the shield's +2 for the round) when a two-handed swing meets an
   equipped shield.

8. twf-light-weapons-only, 9. twf-needs-the-attack-action (test-enforce-weapon-rules)
   Observed: an off-hand longsword hit; an off-hand swing was accepted as the first thing in a
   turn.
   Root cause: `pc-attack.ts` lines 682 to 686: `offHand` only selects the bonus-action spend.
   Fix: require the `light` property and melee kind, and `attacksMade > 0` with a light weapon.

10. loading-one-shot-per-action (test-enforce-weapon-rules)
   Observed: a level 5 fighter fired a heavy crossbow twice in one Attack action.
   Root cause: the `loading` property is never read outside the table (pc-attack.ts).
   Fix: track a loading shot in the turn budget and refuse the second.

11. ammo-spent-on-a-refused-shot (test-enforce-weapon-rules)
   Observed: a hand crossbow shot refused for range left 9 of 10 bolts.
   Root cause: `pc-attack.ts` lines 378 to 394 spend and persist the round before
   `checkPcAttackRange` (line 450) and before the turn budget (line 675). By reading, the same
   ordering burns a Superiority Die (line 526) and a Divine Smite slot (line 645) when the
   budget then refuses.
   Fix: run every refusal check first, then spend.

12. armor-heavy-negative-dex (test-enforce-armor)
   Observed: Ring Mail at DEX 6 stores AC 12 (book 14); Plate stores 16 (book 18).
   Root cause: `src/lib/srd/armor.ts computeArmorClass` lines 234 and 252:
   `Math.min(dexMod, dexCap)` with a cap of 0 lets a negative modifier through.
   Fix: for heavy armor use 0.

13. armor-unequip-everything (test-enforce-armor)
   Observed: after unequipping the last worn item through POST /sheet/usage (both rows
   `equipped: false`) the sheet went back to AC 18, the whole kit.
   Root cause: `armor.ts computeArmorClass` lines 218 to 219: `anyExplicit` looks for an item
   with `equipped: true`; a sheet whose rows are all explicitly false reads as never toggled.
   Fix: treat any row with `equipped !== undefined` as explicit.

14. armor-untrained-attacks (test-enforce-armor)
   Observed: a swing in untrained plate rolled one d20.
   Root cause: `pc-attack.ts` never reads `acBreakdownFor(sheet).unproficient`; only
   `dm/rolls.ts` lines 504 to 506 does. rules-coverage lists the rule as enforced.

15. armor-untrained-casting (test-enforce-armor)
   Observed: a caster in untrained plate spent a level 1 slot.
   Root cause: `mutations.ts use_spell_slot` (line 1277) and `cast-tools.ts` do not read the
   breakdown. armor.ts's own AcBreakdown comment states the rule.

16. armor-donning-time (test-enforce-armor), 17. attunement-takes-a-short-rest
   (test-enforce-attunement)
   Observed: with an encounter active the player's usage route equipped plate (AC 12 to 20) and
   attuned a Ring of Protection (AC 10 to 11) at once.
   Root cause: `sheet/usage/route.ts` lines 74 to 94 gate only resource recovery during a
   fight; the gear block (lines 140 to 164) is ungated.
   Fix: refuse armor and attunement changes while an encounter is active (shield as an action
   if wanted); attune on take_rest.

18. attunement-cap-at-creation (test-enforce-attunement)
   Observed: a sheet created through POST /sheet with four attuned items kept all four, AC 12.
   Root cause: `src/lib/db/sheets.ts createSheet` stores `input.equipment` as sent (line 311);
   `capAttunement` runs only in patchSheet (line 574). Library instantiate and sync use the same
   createSheet, so the library path shares it.
   Fix: cap in createSheet (and before deriveAc there).

19. attunement-one-copy (test-enforce-attunement)
   Observed: two attuned rows naming Ring of Protection store AC 12 and +2 saves.
   Root cause: `magic-items.ts magicItemRiders` lines 98 to 136 sum per row.
   Fix: dedupe by resolved item before summing.

20. attunement-class-restriction (test-enforce-attunement)
   Observed: a fighter attuned to a Staff of Power and stored +2 AC.
   Root cause: `magic-items.json` carries `requiresAttunement` as a boolean; no restriction data
   exists, so no route can check it.

21. magic-item-substring-names (test-enforce-attunement)
   Observed: an attuned "Basilisk Fang" stores AC 12 (matches the third-party item "Asi").
   Root cause: `matchMagicItem` line 63 `wanted.includes(item.match)` with short keys ("asi",
   "defender").

22. magic-items-that-grant-too-much (test-enforce-magic-items)
   Observed: the wielder of a Vorpal Sword took 5 of 10 slashing damage; Defender is a standing
   +2 AC.
   Root cause: generated rows in `classes/magic-items.json` (scripts/generate-magic-items.mjs
   reads "resistance" and "+N ... AC" without the sentence). Also seen by reading: Ioun Stone
   gives +1 AC for any stone, several rows resist non-types ("one", "that", "the", "a", "such",
   "all"), Potion rows apply while carried.
   Fix: review the 101 rows by hand or tighten the generator; add a guard test that every
   resistance type is one of the 13 damage types.

23. purchase-sells-more-than-held (test-enforce-currency)
   Observed: selling qty 5 of an item held 2 at 10 gold paid 50 gold; two gems left the pack.
   Root cause: `src/lib/dm/resource-tools.ts computePurchase` line 222:
   `goldMath(sheet.gold, total)` uses price x asked qty, the result reports price x removed.
   Fix: pay `price * removal.removed`, or refuse when `removed < qty`.

Severity low

24. weapons-long-range: dagger at 45 ft refused ("beyond this attack's 40 ft maximum range").
    `map-tools.ts checkPcAttackRange` line 608 doubles the one stored range. Fix: add `longFt`.
25. weapons-net-range: Net `rangeFt` is 15 (the SRD long range), `weapons.ts` line 57.
26. weapons-net-damage: a net hit deals 1 damage of type "restrains" and sets no condition;
    `pc-attack.ts` line 911 `Math.max(1, damage)` over damage "0 (restrains)".
27. weapons-lance-special: no disadvantage within 5 ft (`weapons.ts` line 41).
28. twf-negative-modifier: off-hand d6 showing 5 at STR 6 dealt 5; `attack-logic.ts` line 253
    zeroes the modifier even when negative.
29. ammo-recovery-named-count: four shots from "Arrows (20)" left "Arrows (16)" after the
    fight. `pc-attack.ts` line 387 keys the tally by the row's name, which withAmmoCount
    rewrites each shot, so every tally is 1 and half rounds to 0.
30. armor-monk-shield: monk WIS 16 with a shield stores 16 (book 15); `armor.ts` line 282
    drops the shield and keeps the formula; speedFor then keeps Unarmored Movement.
31. armor-dwarf-heavy-speed: dwarf in plate at STR 10 moves 15 ft; `index.ts speedFor` ignores
    race.
32. inventory-count-cap: a stack reached 1089 (schema max 999); `mutation-math.ts grantItemMath`.
33. inventory-row-cap: 61 rows stored (schema max 60); `mutations.ts grant_item` line 938.
34. currency-purse-cap: purse reached 1,099,999 gold (schema max 1,000,000); `modify_gold`.
    For 32 to 34 the sheet then fails its own schema on the next validated write.
35. trade-keeps-what-the-item-is: a traded unidentified ring arrived as `{name, qty}`;
    `trade-logic.ts computeTrade` lines 96 and 104 drop identified, slug, weight.
36. magic-strength-item-carrying: STR 19 from gauntlets, 90 lb carried, speed 10;
    encumbranceFor is handed `sheet.abilities.str` in `index.ts` line 301, `rolls.ts` line 513,
    `pc-attack.ts` line 588.
37. magic-items-missing-from-the-table: no Belt of Giant Strength row; Staff of Power lacks its
    save bonus; Ring of Resistance and Dragon Scale Mail resist the type "one".
38. homebrew-armour-on-a-new-sheet: created wearing homebrew AC 15 armour, stored AC 12;
    `createSheet` and `patchSheet` derive AC from the equipment as sent, before hydration.

## Enforced today (highlights)

- Ability choice for every weapon kind, proficiency only when trained, +N weapons, unarmed and
  improvised strikes, reach, long-range disadvantage, heavy weapons for all four Small SRD races.
- Every suit at five DEX scores, shields, double suits, Unarmored Defense and Mage Armor never
  adding to armor, acOverride pinning, stealth disadvantage for every noisy suit, STR penalty at
  the exact threshold.
- Ammunition variant on and off; encumbrance variant on and off, at exact thresholds, in speed
  (pcMoveBudget), checks, saves and attacks.
- Potions of all four tiers with forced dice, target feeding, refusal with no dice rolled.
- party_award conserving every coin for party sizes 1 to 4 and eight hoard sizes; common purse
  and shared pack conserving totals.
- Shops through the player route: price to the copper at every markup, one copper short,
  stock limits, acting only for one's own character, cross-campaign shop refused, haggle once.
- Trades through the routes: revalidation on accept from both sides, only the counterparty
  accepts, double accept refused, double-offered goods move once, conservation of coin and
  items across a mixed sequence.
- Attunement gating and the cap of three through the usage route, patchSheet and update_sheet.

## Not modelled

- Weapon "wielded" state and hands; drawing or stowing a weapon; ranged attacks in melee.
- Lance two-handed unless mounted; net special rules; silvered weapons; adamantine.
- Donning and doffing times; sleeping in armor.
- Charges and recharge (homebrew stores `charges`, no engine reads it); cursed items; rarity
  as a mechanic; identify spell; Boots of Speed and every activated item.
- Amulet of Health changing hit points; Belt of Dwarvenkind CON +2.
- Attunement ending at 100 ft or after 24 hours, or on death.
- Container capacity, mounts carrying gear, lifestyle expenses, electrum as stored coin.
- SRD selling rules by item kind (arms and armor half price only if undamaged, gems full).

## Could not test, and why

- pack-priced half-list sale through the player route without the content pack: the route
  passes no priceCp, so it is covered by the DM tool with priceCp and, beside the pack, by the
  Longsword case (guarded by an actual pack lookup).
- Library sync as a separate write path for the attunement cap: it lands in the same
  createSheet the creation gap covers; not given its own case.
- Physical-dice (parked roll) attack path: the suites use the digital path only.

## Notes for the maintainer

- Out of my area, seen while testing: pc_attack is not refused for a character whose turn it
  is not (budgetFor returns null and the swing resolves with no economy); the player sheet
  PATCH accepts a level-up with no XP check.
- One side effect to disclose: an early run of test-enforce-attunement POSTed a character
  without a portrait and the host queued one real portrait render. Both creation cases now
  send a portrait; five further runs of each file queued nothing.
- enforce-world's `close()` removes the scratch directory shared by every world in the
  process, so my files call it once, at the end.
