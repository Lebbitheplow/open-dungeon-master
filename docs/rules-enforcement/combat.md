# Enforcement report: combat

The second audit and repair (2026-09-30) and the state after it are in [`../rules-enforcement-audit.md`](../rules-enforcement-audit.md); this report describes the first audit.

Area: the combat engine through the real tool handlers (src/lib/dm/invoke.ts invokeEngine as a
human DM, and the two player routes a fight has: battle-map/move and encounter/end-turn), every
die forced. 14 test files and one helper. 187 test(), 60 gap(). Every file passes under
`node scripts/<file>.mjs` (five runs in a row each, identical counts) and under
`npx vitest run scripts/<file>.mjs` (14 files passed). Nothing under src/ was touched.

This was a continuation of an interrupted agent. What changed from what it left on disk is listed
under "Continuation notes" at the end.

## Ruleset as implemented

ODM runs SRD 5.1 (2014) combat, resolved on the server, with these shapes.

Supported, enforced and pinned by test():
- Initiative: d20 + DEX, + 5 for Alert, + half proficiency for Jack of All Trades, advantage
  from a lasting effect. Enemies roll on the server at spawn. Order sorted highest first, built
  once. Round counter moves when the order wraps.
- Action economy for the combatant at the pointer: one action, one bonus action, attacks inside
  the Attack action by Extra Attack (2 at 5 for barbarian, fighter, monk, paladin, ranger; fighter
  3 at 11, 4 at 20; checked for every class at every level), Haste's extra action, off-hand attack
  on the bonus action without the ability modifier.
- Attack resolution: to hit from the sheet (ability, proficiency, magic bonus, Archery), hit when
  the total meets AC, natural 20 hits and crits, natural 1 misses, a crit doubles dice and not
  modifiers (weapon, Sneak Attack, smite and Superiority dice all double), Improved Critical 19,
  Savage Attacks and Brutal Critical, Great Weapon Fighting reroll, Dueling, Sneak Attack
  conditions and once per turn (for the character at the pointer), Divine Smite dice for slots 1
  to 4 and slot spend, Rage on Strength melee only, Battle Master maneuvers (die size by level,
  DC, rider saves, Precision on the attack roll).
- Advantage and disadvantage: every condition source on both sides, long range, heavy weapon in
  Small hands, exhaustion 3, the caller's declaration; never stack; any of each cancels to one d20.
- Range, reach, cover (+2, +5), low walls, total cover for ranged attacks, enemy auto approach.
- Movement on the player's route: speed by square, difficult ground and water double, walls,
  occupancy, not on another's turn, speed 0 conditions, exhaustion, Dash, Disengage, opportunity
  attacks both sides with one reaction each, teleport and forced moves provoke nothing.
- Checks and saves: bonus from the sheet for all 18 skills and 6 saves, DC ladder 5 to 30, meets
  the DC, natural 20 and 1 decide nothing, passive scores, group checks by half, Reliable Talent,
  auto-fail STR and DEX saves when paralyzed and the like.
- Enemy side: stat block numbers only (caller cannot hand better ones), HP bounded 0 to max,
  dead and incapacitated enemies refused, last kill or last flight ends the fight, XP by CR split
  evenly (SRD table written into the test), deadly ceiling, legendary action costs, legendary
  resistance, lair action once a round.
- Narration guard: hit on a miss, miss on a hit, death the HP deny, damage figure no die rolled,
  spell nothing paid for, all fed from live engine results; the guard changes no state.

Deliberate deviations from SRD 5.1, each pinned as test() with the declaring comment:
| ODM rule | SRD 5.1 | Declared in |
|---|---|---|
| Initiative ties go to player characters, then by name | DM decides | src/lib/dm/encounter-logic.ts buildOrder |
| The pointer rests only on player characters; enemies act as it passes them | every creature has a turn | encounter-tools.ts header, advanceOrder |
| A PC at 0 HP (or incapacitated) is passed over and the server rolls the death save as the pointer goes by | they take the turn and roll at its start | encounter-tools.ts entryAlive, advancePointer |
| Reactions come back when the round wraps | at the start of the creature's own turn | encounter-tools.ts advancePointer comment ("one round is the granularity the server tracks them at") |
| An attack does not end a turn; only end_turn or the End Turn button does | same in effect | encounter-tools.ts markResolvedFromArgs |
| Multiattack is one enemy_attack call, every swing the same attack, stops when the target drops | per stat block | encounter-tools.ts handleEnemyAttack |
| Hide, Dash, Disengage, Grapple, Shove always cost the action slot | Cunning Action; grapple replaces one attack | action-tools.ts ACTION_COST |
| Ready, Search, Use an Object are not take_action options | standard actions | action-tools.ts takeActionSchema |
| A diagonal is one square; nobody moves through any token; water costs double | same diagonal; allies may be passed | battlemap/movement.ts |
| A kill by a character's opportunity attack leaves the fight open | n/a | docs/rules-coverage.md, Deliberate omissions |
| An attack-roll spell reaches 120 feet whatever the spell | per spell | attack-logic.ts spellAttackProfile |
| Powerful Critical and Critical Damage Modifiers variants, inert when off | DMG variants | schemas/game-settings.ts |
| Deadly ceiling by campaign difficulty (1.0, 1.25, 1.5, 2.0); fled or truce pays half XP | n/a | srd/encounter-math.ts, enemy-damage.ts |
| The maneuver is named with the attack; rider conditions other than prone last one round | declared on hit | pc-attack.ts |
| The per-turn caps bind the model and never a person | n/a | invoke.ts header |

Note on the reaction rule: the pin is kept because the code comment declares it, but the
use_reaction tool description and docs/rules-coverage.md both say "refreshed at the start of
their turn". The consequence is that a character in the middle of the order can react after their
own turn in round N and again before their own turn in round N+1. The maintainer may want to
decide which statement is the rule.

## Answers to the three "spent before a refusal" reports

| Reported by reading | Verdict | Evidence |
|---|---|---|
| A Divine Smite slot is spent before a refusal | CONFIRMED for the action-economy refusal; REFUTED for the no-slot, no-feature, ranged and out-of-reach refusals | riders-spent-before-the-attack-is-allowed (gap); "Divine Smite: refused with no slot, with no feature, and at range" (test) |
| A Superiority Die is spent before a refusal | CONFIRMED for the action-economy refusal (and by reading, the smite refusals below it); REFUTED for unknown maneuver, empty pool, spell, and out-of-reach refusals | maneuvers-die-spent-on-a-refused-attack (gap); four test() in test-enforce-maneuvers.mjs |
| Ammunition is spent before a refusal | CONFIRMED, already held by another area: test-enforce-weapon-rules.mjs ammo-spent-on-a-refused-shot. spendAmmo runs at pc-attack.ts:378, above the range check at 450 | not repeated here |

And the report that pc_attack resolves for a character whose turn it is not: CONFIRMED
(turn-offturn-attacks-unbounded, high).

## Files written

| File | test() | gap() |
|---|---|---|
| scripts/lib/enforce-combat.mjs (helper: board, dummy stat block, swing with forced dice) | | |
| scripts/test-enforce-initiative.mjs | 11 | 6 |
| scripts/test-enforce-turn-order.mjs | 8 | 9 |
| scripts/test-enforce-action-economy.mjs | 13 | 3 |
| scripts/test-enforce-actions.mjs | 16 | 8 |
| scripts/test-enforce-attacks.mjs | 16 | 2 |
| scripts/test-enforce-attack-riders.mjs | 16 | 6 |
| scripts/test-enforce-maneuvers.mjs (new) | 12 | 4 |
| scripts/test-enforce-advantage.mjs | 15 | 4 |
| scripts/test-enforce-movement.mjs | 20 | 5 |
| scripts/test-enforce-range.mjs | 13 | 3 |
| scripts/test-enforce-checks.mjs | 16 | 4 |
| scripts/test-enforce-forced-saves.mjs (new, split from checks) | 5 | 3 |
| scripts/test-enforce-enemies.mjs | 19 | 3 |
| scripts/test-enforce-narration-guard.mjs | 7 | 0 |
| Total | 187 | 60 |

Every file is under 500 lines (largest 454). No em or en dash in any of them.

## Findings

Reproduce any finding by running its file: the gap() body is the reproduction, and the line it
prints is the observed behaviour. 2 high, 31 medium, 27 low.

### High

**initiative-party-surprised-never-starts** (test-enforce-initiative.mjs)
Rule: when the party is surprised the enemies act in round 1 and the party from round 2.
Observed: start_encounter with surprised: "party", every initiative rolled, orderReady stays false.
Root cause: src/lib/dm/encounter-tools.ts recordInitiativeRoll:632-638. advanceOrder is asked for
the first combatant the pointer may rest on; with every PC in surprisedIds there is none, it
returns null and the function saves and returns without locking the order. No round, no turn, no
initiative floor, and since budgetFor needs a current combatant the action economy binds nobody
for the rest of the fight.
Fix: when nobody can act in round 1, lock the order anyway, run the enemies that pass, clear
surprisedIds and open round 2 on the first living PC.

**turn-offturn-attacks-unbounded** (test-enforce-turn-order.mjs)
Rule: off their own turn a character attacks only with their reaction, one a round.
Observed: three pc_attack calls in a row resolved for a character while the pointer was on
somebody else; nothing was spent.
Root cause: src/lib/dm/action-tools.ts budgetFor:172 returns null for anyone but the combatant at
the pointer, and src/lib/dm/pc-attack.ts handlePcAttack:681 treats null as no economy to enforce.
The comment on currentCombatantId says this is on purpose so a reaction is never refused for a
spent action, but nothing is charged in its place.
Fix: when a fight is ready and the attacker is not at the pointer, charge encounter.reactionsUsed
(refuse if already there), or refuse outright unless the call is marked as a reaction.

### Medium

**initiative-effect-bonus**: a lasting effect that adds to initiative is not added. Observed 11
for d20 8 + DEX 3 with a +4 effect. Root cause: src/lib/dm/rolls.ts resolveRollExpression:663-668
builds the roll from derived.initiative alone; extras.effectBonus is read only at 637 (saves and
raw ability checks). docs/rules-coverage.md lists initiative as covered. Fix: add effectBonus in
the initiative branch.

**initiative-surprised-enemy-acts**: a surprised enemy attacks in round 1. Root cause:
encounter-tools.ts handleEnemyAttack:805-827 never reads encounter.surprisedIds; it only steers
the pointer. Fix: refuse enemy_attack (and the auto-act fallback) for an id in surprisedIds.

**turn-offturn-sneak-attack-repeats**: second hit in the same turn dealt 7, Sneak Attack
included. Root cause: pc-attack.ts:694-712, the once-per-turn claim lives on the turn budget and
an attacker who is not at the pointer has none. Fix: keep once-per-turn claims on the encounter
keyed by character and round or turn index.

**turn-offturn-actions-unbounded**: Dodge and Dash both resolved for a character on somebody
else's turn. Root cause: action-tools.ts handleTakeAction:258-270, same null budget. Fix: refuse
take_action for a character who is not at the pointer while a fight is ready.

**turn-attack-before-initiative**: pc_attack resolves while the order is still being collected.
Root cause: currentCombatantId returns null when orderReady is false (action-tools.ts:151), so
handlePcAttack has nothing to check. Fix: refuse pc_attack, take_action and enemy_attack until
orderReady.

**turn-enemy-attacks-twice**: the same enemy resolved two enemy_attack calls in one round, on one
AI turn. Root cause: encounter-tools.ts handleEnemyAttack:1016 records turn.actedEnemyIds, which
only the auto-act fallback at 1299 reads; the handler never does. The comment in invoke.ts:206
calls that bookkeeping "what stops an enemy swinging twice", which it does not. Fix: track acted
enemies per round on the encounter and refuse a second action, with an explicit exception for
legendary actions and reactions.

**turn-console-end-turn-noop**: the DM console's "End a turn" reports success and the pointer
stays. Root cause: handleEndTurn:1140 only marks the turn resolved; advanceAfterTurn is called
from src/lib/dm/turn.ts:2062 alone and src/app/api/campaigns/[campaignId]/dm/invoke/route.ts never
calls it. Fix: for a human actor, call advancePointer (and the skipped-enemy handling) from
end_turn.

**turn-console-player-attack-target**: the console's "Player attacks" form is refused as invalid
arguments. Root cause: src/lib/dm/catalog-combat.ts:83 names the field enemyId; pcAttackArgsSchema
(pc-attack.ts:143) reads targetEnemyId. Fix: rename the catalog field or alias it in
normalizeArgs. (pet_attack at catalog-combat.ts:342 has the same field name and was not tested.)

**economy-action-surge-grants-nothing**: after Action Surge the third attack is refused. Root
cause: use_resource (src/lib/dm/resource-tools.ts) spends action_surge and returns guidance;
nothing touches encounter.turnBudget. Fix: on a successful Action Surge spend, reset actionUsed
and attacksMade on the owner's budget (or add to extraActions with no restriction).

**economy-spell-attack-rides-extra-attack**: a second Fire Bolt is cast inside one action by a
character with Extra Attack. Root cause: pc-attack.ts:682-686 spends every attack, spell or
weapon, through spendAttack. Fix: a spell attack spends the action with attacksMade set to
attacksAllowed.

**actions-dodge-ends-at-round-wrap**: the Dodge is gone before the enemies ahead of the dodger in
the next round have swung. Root cause: action-tools.ts:278 writes dodging with rounds: 1 and
condition-tick counts down at round wrap (encounter-tools.ts:1246). Fix: end dodging, helped,
shielded and protected when the pointer arrives back on their owner, not at the wrap.

**actions-help-ignored-by-attacks**: a helped character's attack is a straight roll. Root cause:
rolls.ts:471 reads the helped condition; pc-attack.ts never does, although take_action help
promises "their next ability check or attack". Fix: add helped as an advantage source in
handlePcAttack and spend it with the other one-shot conditions at 739.

**actions-hide-in-plain-sight**: a rogue toe to toe with its target on open floor becomes hidden.
Root cause: action-tools.ts:305-347 is the Stealth roll against passive Perception only; token
positions, cover and light are never read. Fix: on a mapped encounter require that no living
enemy has line of sight, or cover or obscurement between.

**actions-grapple-out-of-reach**: a grapple lands from 70 feet. Root cause: action-tools.ts
grapple and shove branch:365-448 reads no token positions. Fix: reuse checkPcAttackRange with
reach 1.

**advantage-ranged-in-melee**: a longbow fired with an enemy adjacent is a straight roll. Root
cause: src/lib/dm/map-tools.ts pcAttackSpatials reports cover and long range only. Fix: add an
adjacent hostile check (living, not incapacitated) as a disadvantage source for ranged attacks.

**advantage-attack-effects-unread**: a set_effect granting advantage on attack rolls changes
nothing. Root cause: src/lib/dm/effect-tools.ts rollEffectExtras:278-291 maps save, check and
initiative only, and pc-attack.ts never asks for the attack or damage field. Fix: read
effectOutcome for "attack" and "damage" in handlePcAttack.

**attacks-enemy-ac-ignores-effects**: an effect on an enemy's AC is never rolled against.
Observed vsAc 13 under a +2 effect. Root cause: enemyAcWithEffects (encounter-tools.ts:511) has
no caller; pc-attack.ts:466 and opportunity.ts:271 read enemy.ac. Fix: call enemyAcWithEffects in
both, and in the pending attack context.

**riders-smite-capped-at-5d8**: a 5th level slot smites for 6d8. Root cause: pc-attack.ts:661
Math.min(6, 1 + slot). Fix: Math.min(5, 1 + slot) before the undead or fiend die.

**riders-smite-spent-on-a-miss**: a miss burns the slot. Root cause: pc-attack.ts:645-655 spends
before the roll at 825. Fix: validate the slot up front, spend it after adjudicateHit says hit
(the physical dice path: spend when the to-hit is resolved).

**riders-spent-before-the-attack-is-allowed**: an attack refused for having no attacks left still
costs the smite slot. Root cause: the spend at pc-attack.ts:645 sits above the budget check at
675-688. Fix: move every refusal above every spend (ammunition 378, Superiority Die 526, smite
645), or run them in one transaction rolled back on error.

**riders-smite-undead-by-name**: an enemy whose stat block says type undead is smitten for 2d8.
Root cause: pc-attack.ts:658 guesses from displayName and slug with an unanchored pattern; the
comment says the stat block carries no type, but EnemyStats.type exists
(src/lib/bestiary/statblock.ts:46). Also gives the die against anything with imp, shadow or devil
in its name. Fix: read creatureTypeOf(enemy.stats), fall back to the name only when type is absent.

**maneuvers-die-spent-on-a-miss**: Trip, Menacing, Disarming, Goading are on-hit maneuvers; the
die is spent on a miss. Root cause: pc-attack.ts:526-540 spends before the roll. Fix: spend after
the hit for every maneuver but Precision.

**maneuvers-die-spent-on-a-refused-attack**: as the smite finding, for the Superiority Die.
Root cause: pc-attack.ts:526 above 675.

**movement-passing-through-reach**: a move that starts outside an enemy's reach, runs past it and
ends outside provokes nothing. Root cause: src/lib/dm/opportunity.ts:103-107 compares the two
ends of the move only. Fix: walk the path reachableTiles found (or the cheapest one) and fire on
the first step that leaves a reach.

**movement-enemy-approach-provokes-nothing**: an enemy next to one character walks off to hit
another unanswered. Root cause: map-tools.ts approachForAttack:689 and 720 call moveToken
directly; resolvePcOpportunityAttacks is called from handleMoveToken:476 only. Fix: call it from
approachForAttack too.

**range-no-cover-for-characters**: a character behind half cover gets no +2 against an enemy's
shot. Root cause: handleEnemyAttack:916 rolls against acWithEffects; coverBetween is used for
pc_attack only. Fix: add cover for the target in enemy_attack and the enemy opportunity attack.

**checks-effect-bonus-skips-skills**: a +2 effect on checks is not added to a skill check. Root
cause: rolls.ts:573-603, the skill branch builds from derived.skills alone. Fix: add effectBonus.

**saves-effects-skip-forced-saves**: a +3 effect on saves is not added to a save forced by
cast_at_player. Root cause: src/lib/dm/cast-tools.ts handleCastAtPlayer:800 calls
resolveRollExpression without rollEffectExtras (only invoke-roll.ts:58 passes them). aoe_damage
by reading has the same shape. Fix: pass rollEffectExtras in every save path.

**saves-inspiration-kept-after-forced-save**: a Bardic Inspiration die is rolled into a forced
save and stays on the sheet. Root cause: resolveRollExpression returns spendInspiration for the
caller to clear; invoke-roll.ts:75 clears it, cast-tools.ts and check-tools.ts:201 do not. Fix:
clear it inside one shared helper.

**saves-console-cast-forms**: the console's "Cast at a player" form cannot satisfy its handler.
Root cause: catalog-combat.ts:129-139 offers spell, characterIds, casterEnemyId, dc; the handler
needs characterId, saveAbility and dc with damage or a condition. cast_at_enemy (116-127) has the
same mismatch by reading. Fix: align the catalog fields with the handler schemas, and add a test
that every catalog entry's required fields parse in its handler.

**enemies-legendary-actions-never-refill**: round 2 begins with 0 legendary actions. Root cause:
encounter-tools.ts advancePointer:1232-1235 refills when the pointer ARRIVES on an enemy, and
advanceOrder rests the pointer on player characters only, so the branch is unreachable. Fix:
refill for every legendary enemy in next.enemiesPassed.

### Low

| Id | Rule | Observed | Root cause | Fix |
|---|---|---|---|---|
| initiative-surprised-reaction | a surprised creature has no reaction until its first turn ends | use_reaction accepted | action-tools.ts handleUseReaction:504-523 never reads surprisedIds | refuse while the id is in surprisedIds |
| initiative-alert-surprise | Alert: cannot be surprised while conscious | the Alert character is in surprisedIds | encounter-tools.ts:410 marks every sheet | skip sheets with the feat |
| initiative-late-joiner | a character joining a running fight rolls and takes a place | no order entry | recordInitiativeRoll:596 returns once orderReady; add_enemies inserts enemies only | insert the PC entry sorted when the order is locked |
| turn-multiattack-capped-at-three | as many attacks as the block says | 3 swings for 5 | handleEnemyAttack:891 Math.min(3, ...) | raise or remove the clamp |
| turn-caps-on-delegated-ai | the per-turn caps apply to the AI's share (delegation.ts header) | 13 encounter actions on one AI turn | caps are counted in turn.ts:1146 and 1234 only; invokeEngine never counts | count in invokeEngine for actor ai, or correct the header |
| economy-haste-action-unrestricted | Haste's action: one weapon attack, Dash, Disengage, Hide, Use an Object | it bought a Dodge | action-budget.ts spendExtraAction:78 ignores `what` | pass an allow list |
| actions-dodge-kept-at-speed-zero | Dodge is lost at speed 0 | a grappled dodger still imposes disadvantage | condition-logic.ts attackContext:124 checks incapacitation only | also check speed-zero conditions |
| actions-refused-action-still-spent | a refused action costs nothing | a grapple refused for size spent the action | handleTakeAction:264-270 spends before the action's own checks | validate first, spend last |
| actions-grapple-ignores-enemy-skill | defender contests with Athletics or Acrobatics | 16 vs 11 with Athletics +9 on the block | action-tools.ts:384 uses saveModFor | read stats.skills, fall back to ability modifiers |
| actions-shove-push-moves-nothing | a won shove pushes 5 feet | token stays | action-tools.ts:444 reports and asks the DM to move it | move the token one square away when the square is free |
| advantage-flanking-switch-inert | flanking variant gives advantage | straight roll with the switch on | no engine reads variantRules.flanking (also held as variant-flanking-unread) | compute from token positions in handlePcAttack and handleEnemyAttack |
| advantage-prone-target-at-reach | prone target: advantage only within 5 feet | a glaive at 10 feet has advantage | pc-attack.ts:474 adjacent: !profile.ranged | pass the real distance |
| attacks-minimum-one-damage | a penalty can bring damage to 0 | a hit for -1 took 1 | pc-attack.ts:911, encounter-tools.ts:973, opportunity.ts:161 and 301 Math.max(1, ...) | Math.max(0, ...) |
| riders-critical-dice-on-ranged | Savage Attacks, Brutal Critical: melee weapon crits | longbow crit rolled 4d8 | pc-attack.ts:787 passes critExtraDice for every attack | pass 0 when ranged or a spell |
| riders-dueling-with-a-second-weapon | Dueling: no other weapon in hand | main hand dealt +2 with a dagger in the other | attack-logic.ts weaponAttackProfile never reads what else is equipped | withhold when a second weapon is equipped |
| maneuvers-trip-any-size | Trip Attack: Large or smaller | a Gargantuan creature is tripped | pc-attack.ts:923-958 reads the save only | check sizeRank |
| maneuvers-rider-ignores-condition-immunity | immune creatures do not take the condition | an immune creature is frightened | pc-attack.ts:946 writes the condition without reading stats.conditionImmune | reuse the check take_action makes |
| movement-opportunity-attack-ignores-conditions | an opportunity attack is an attack roll | a poisoned enemy rolls straight | opportunity.ts:117-119 reads dodging only, both directions | build the roll through attackContext |
| movement-blinded-enemy-still-reacts | the attacker must see the target | a blinded enemy strikes | opportunity.ts:88 checks incapacitation and reaction only | skip blinded attackers and unseen movers |
| movement-character-opportunity-critical | a crit doubles the dice | critical dealt 7, not 12 | opportunity.ts:282 rolls profile.damageExpression whatever adjudicated.crit says | use critDamageExpression |
| range-reach-through-a-wall | total cover stops an attack | a glaive strikes through a wall square | map-tools.ts checkPcAttackRange:594 returns before the sight line | check line of sight for reach over 1 |
| range-enemy-ranged-in-melee | ranged attack with a hostile adjacent: disadvantage | an enemy bow at 5 feet rolls straight | handleEnemyAttack reads conditions and weather | add the adjacent check |
| checks-help-on-saving-throws | Help never applies to a save | a helped save rolled with advantage and spent the help | rolls.ts:471 reads helped for every kind but initiative | exclude saving_throw |
| checks-passive-ignores-disadvantage | passive check -5 with disadvantage | a poisoned lookout notices at full passive | check-tools.ts passiveScore:256 | apply -5 or +5 from conditions and exhaustion |
| checks-console-notice-sense | the console's sense pick is used | always passive Perception | catalog-world.ts:291 field is `skill`, handler reads `sense` | rename the field |
| enemies-shield-on-a-pinned-armor-class | Shield is +5 whatever the AC was | slot and reaction spent, AC unchanged at 12 | srd/index.ts effectiveAcFor:250 returns the pinned sheet.ac; condition AC is folded in only when the armor engine derives it | add condition AC on top of a pinned number |
| enemies-opportunity-attack-ignores-effects | an AC effect counts against every attack | a 13 hit AC 14 | opportunity.ts:134 uses effectiveAcFor, not acWithEffects | use acWithEffects |

## Findings in this area held by other areas (not repeated here)

| Finding | Held by |
|---|---|
| Spells through cast_at_enemy, cast_buff, aoe_damage spend no action | test-enforce-casting-limits.mjs limit-casting-spends-no-action |
| Off-hand attack needs neither the Attack action nor a light weapon | test-enforce-weapon-rules.mjs twf-needs-the-attack-action, twf-light-weapons-only |
| Incapacitated characters still take actions and reactions | test-enforce-conditions-actions.mjs |
| A prone character walks at full speed | test-enforce-conditions-actions.mjs conditions-prone-moves-at-full-speed |
| Long range is taken as twice normal range | test-enforce-weapons.mjs weapons-long-range |
| request_roll ignores strictness | test-enforce-variant-rules.mjs variant-strictness-request-roll |
| Ammunition spent on a refused shot | test-enforce-weapon-rules.mjs ammo-spent-on-a-refused-shot |
| Physical dice: parked attack judged against stored AC, faces on the die | test-enforce-rolls-trust.mjs |

## Not modelled (no gap recorded)

- Monster traits as mechanics (Pack Tactics, Nimble Escape, Sunlight Sensitivity). They are text
  on the stat block; enemy_attack takes advantage from conditions, weather and the caller.
- Ready, Search, Use an Object, and readied actions spending the reaction.
- Critical fumbles and lingering injuries variants (prompt text only; held by variant-rules).
- Squeezing, climbing, swimming and jumping costs; mounted movement was not in this area.
- The player's choice to take or decline an opportunity attack: the server makes it for them and
  spends their reaction, with the first melee weapon the sheet resolves.
- Enemy reactions other than the opportunity attack, and enemy bonus actions.
- Different attacks inside one Multiattack (claw, claw, bite).
- Two creatures in the same initiative count choosing their order.

## Could not test, and why

- The AI turn loop itself (src/lib/dm/turn.ts): the per-turn caps, the auto-act fallback for
  skipped enemies, and advanceAfterTurn need a model call. The caps are pinned as constants and
  the handlers are reached through invokeEngine with an ai actor instead.
- enforceEngineBoundary (src/lib/dm/narration-guard.ts): the rewrite costs a model call. The pure
  checkNarration it calls is what is tested, against live engine results.
- Companion auto-act: recruiting a companion can queue a portrait render (owner decision 4), and
  the path runs inside advanceAfterTurn.
- Content pack stat blocks: every staged enemy is rewritten to one fixed stat block so the files
  read the same with and without the pack. Two assertions about the real goblin are guarded by
  world.hasPack.
- Weather riders on ranged attacks (gale): the boards staged here are not marked outdoors.

## Helper notes

- scripts/lib/enforce-world.mjs and enforce-harness.mjs were not edited. No bug found in either.
- start_encounter places tokens at random (owner decision 5): combatKit.fight repaints the board
  as open floor and parks every token along the far edge three squares apart, and each test then
  places the tokens its rule is about. Tests that call start_encounter or world.beginFight
  directly either make no attack or call kit.openField and kit.place first.
- world.close() is called once, at the end of each file, including the files that open several
  worlds.
- kit.attack sends both enemyId and targetEnemyId because of turn-console-player-attack-target;
  the gap itself sends the form's shape only.

## Continuation notes

What the interrupted agent left: the helper and 12 files, 11 green, 63 gaps.
- Fixed red: test-enforce-narration-guard.mjs failed on its first test. The prose "bites deep
  into" is not one of the guard's hit verbs ("bites into" is). The guard is documented as biased
  toward missing a contradiction, so this was the test's wording and not a finding. Reworded.
- 500 line limit: test-enforce-checks.mjs was 531 lines. The cast_at_player tests and three gaps
  moved to test-enforce-forced-saves.mjs (ids renamed from checks-* to saves-*), with two tests
  added.
- Removed 7 gaps that duplicated another area's gap (listed above) and 1 that was a rule not
  modelled at all (advantage-pack-tactics). Each removal left a comment naming where it is held.
- Severity corrected on 2 gaps from high to medium, by the harness's own definition (high is a
  player gaining or keeping something): turn-enemy-attacks-twice and riders-smite-spent-on-a-miss.
- riders-spent-before-the-attack-is-allowed narrowed to the smite slot it actually tests.
- Added test-enforce-maneuvers.mjs (12 tests, 4 gaps) and movement-passing-through-reach.
- Every remaining gap was re-read against its source and re-run; each fails for the reason stated.
