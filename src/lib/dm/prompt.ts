import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { heldRollUserIds } from "@/lib/dice/held-rolls";
import { computeSheetDerived, findSkill, formatModifier, sizeForRace, speedFor, SRD_SKILLS } from "@/lib/srd";
import { encumbranceFor } from "@/lib/srd/encumbrance";
import { classFeatureDescription, findCustomClass } from "@/lib/classes";
import { resourceDef } from "@/lib/srd/class-resources";
import { featEngineTag } from "@/lib/srd/feat-combat";
import { featFactsFor } from "@/lib/characters/catalog";
import { spellAuthorsFor } from "@/lib/dm/spell-authors";
import { featTwinOf } from "@/lib/srd/feat-effects";
import { subclassFeatureDescription } from "@/lib/srd/features";
import { subclassExtrasForTable } from "@/lib/db/subclass-extras";
import { authoredFeatureTags } from "@/lib/srd/authored-effects";
import { describeConditionDuration, describeExhaustion } from "@/lib/dm/condition-logic";
import { describeConditionEffects } from "@/lib/srd/condition-effects";
import { presetFor, packFor } from "@/lib/worlds/preset";
import { renderWorldPrimer } from "@/lib/worlds/primer-logic";
import { packIds } from "@/lib/worlds/reskin-logic";
import { genreClassIds } from "@/lib/classes";
import { renderArcForPrompt } from "@/lib/dm/arc-logic";
import { renderWorldArcsForPrompt } from "@/lib/dm/world-arc-logic";
import { renderFactsForPrompt, type FactLike } from "@/lib/dm/fact-logic";
import { companionMode } from "@/lib/dm/companion-tools";
import { breakDown, describeInstant, isDark, normalizeClock } from "@/lib/dm/calendar";
import { describeWeather } from "@/lib/srd/weather";
import { describeParty, normalizeParty } from "@/lib/dm/party-logic";
import { getSceneTracker } from "@/lib/db/scene-tracker";
import { trackerPromptBlock } from "@/lib/dm/scene-tracker-logic";
import { getAmbience } from "@/lib/db/ambience";
import { describeAmbience } from "@/lib/ambience/logic";
import { listEffects } from "@/lib/db/active-effects";
import { listQuests } from "@/lib/db/quests";
import { renderQuestsForPrompt } from "@/lib/dm/quest-logic";
import { describeEffect } from "@/lib/dm/effects-logic";
import { getMounts } from "@/lib/db/mounts";
import { describeMount } from "@/lib/srd/mounts";
import { formatCopper } from "@/lib/srd/currency";
import { coverPromptBlock } from "@/lib/dm/delegation";
import { ENGINE_BOUNDARY_CHECK, ENGINE_BOUNDARY_RULES } from "@/lib/dm/engine-boundary";
import { normalizeGm, normalizeSafety, renderGmBlock, renderSafetyBlock } from "@/lib/dm/safety-logic";
import { renderChapterLod } from "@/lib/dm/chapter-lod";
import { buildPinnedMemoriesBlock } from "@/lib/dm/pin-logic";
import {
  computeBudgets,
  estimateTokens,
  fitHistory,
  usableTokens,
  type BlockKind,
  type ContextTrace,
} from "@/lib/dm/context-budget";
import type { ChatMessage } from "@/lib/model-client";
import { describeIntent } from "@/lib/dm/intent-logic";
import { describeEquipmentItem } from "@/lib/dm/equipment-line";
import { summonStateLine } from "@/lib/dm/summon-rules";
import { dmSystemText, encounterRulesText, tracksAmmunition } from "@/lib/dm/prompt-rules";
import { rollerName } from "@/lib/roll-labels";
import { tableHazards } from "@/lib/srd/table-hazards";
import { waypointProperty } from "@/lib/dm/waypoint-logic";

export { DM_SYSTEM, dmSystemText, ENCOUNTER_RULES, encounterRulesText } from "@/lib/dm/prompt-rules";

// Full system prompt for a campaign: base rules plus genre flavor plus any
// custom world text.
export function buildDmSystem(campaign: Campaign): string {
  const preset = presetFor(campaign.gameSettings);
  // The engine-boundary contract leads: one labelled statement of which facts
  // the runtime owns, which the numbered rules below it then apply tool by
  // tool (src/lib/dm/engine-boundary.ts).
  // The table's safety limits stand first of all (docs/vtt-parity-
  // implementation-plan.md 9.1): they outrank the engine boundary as well
  // as every rule under it.
  const parts = [
    renderSafetyBlock(normalizeSafety(campaign.gameSettings.safety)),
    campaign.gameSettings.narrationGuard
      ? `${ENGINE_BOUNDARY_RULES}${ENGINE_BOUNDARY_CHECK}`
      : ENGINE_BOUNDARY_RULES,
    dmSystemText(tracksAmmunition(campaign)),
  ];
  const gmBlock = renderGmBlock(normalizeGm(campaign.gameSettings.gm));
  if (gmBlock) {
    parts.push(gmBlock);
  }
  if (preset.dmFlavor) {
    parts.push(preset.dmFlavor);
  }
  if (campaign.gameSettings.genre === "custom" && campaign.gameSettings.customGenreText) {
    parts.push(`Tone and world, set by the table: ${campaign.gameSettings.customGenreText}`);
  }
  // Assisted mode, DM stepped away: the model is standing in for a person for
  // a counted stretch, and is told so plainly rather than being left to run
  // someone else's campaign as if it were its own.
  const cover = coverPromptBlock(campaign.dmCover);
  if (cover) {
    parts.push(cover);
  }
  return parts.join("\n\n");
}

// Active-encounter snapshot for the GAME STATE block. Exact enemy HP is
// model-facing only; players see vague health states.
export type DmEncounterState = {
  round: number;
  orderReady: boolean;
  order: Array<{ name: string; current: boolean }>;
  awaitingInitiative: string[];
  // What the combatant whose turn it is still has to spend, or null before
  // they have spent anything (src/lib/dm/action-budget.ts).
  turnBudget: string | null;
  // The acting character's movement left this turn, as the board counts it,
  // or null when they have no token on a board.
  movementLeft: string | null;
  // The current combatant's name while their turn waits on their player
  // (src/lib/dm/player-word.ts characterAwaitingPlayer).
  awaitingPlayer: string | null;
  enemies: Array<{
    enemyId: string;
    name: string;
    hp: string;
    ac: number;
    status: string;
    conditions: string[];
    attacks: Array<{ name: string; toHit: number; damage: string; type: string }>;
    traits: string[];
    resist: string;
    immune: string;
    vulnerable: string;
    concentration: string | null;
  }>;
  // Serialized tactical grid with every token's position; null when the
  // encounter has no battle map.
  map: string | null;
};

export type DmGameState = {
  campaign: Campaign;
  members: CampaignMember[];
  sheets: CharacterSheet[];
  encounter?: DmEncounterState | null;
  enemySuggestions?: Array<{ slug: string; name: string; cr: number }>;
  recentRolls: StoredRoll[];
  storySummary: string;
  currentLocation?: {
    name: string;
    layoutDescription: string;
    connections: string[];
  } | null;
  visitedLocationNames?: string[];
  // Recent lasting milestones per campaign character id.
  recentEventsByCharacter?: Map<string, string[]>;
  // Afflictions, lifestyle and downtime per character id
  // (src/lib/dm/between-lines.ts).
  betweenBySheet?: Map<string, string[]>;
  // Closed story chapters, oldest first: index, title, one-line hook.
  // Sealed chapters, oldest first. Rendered at level of detail
  // (src/lib/dm/chapter-lod.ts): summary for the recent and the important,
  // synopsis for the rest. `importance` is the chapter's peak scene score.
  chapters?: Array<{
    id?: string;
    index: number;
    title: string;
    oneLiner?: string;
    summary?: string;
    importance?: number;
  }>;
  // Public party notes (lead-curated canon), pinned first.
  publicNotes?: Array<{ pinned: boolean; title: string; body: string }>;
  // The DM's private prep notes (src/lib/db/notes.ts listDmPrepNotes).
  dmPrepNotes?: Array<{ title: string; body: string }>;
  // Server-tracked world facts (the divergence register), newest first.
  facts?: FactLike[];
  // Sparks from the world-simulation tick, consumed into this turn.
  directorNotes?: string[];
  // Tracked NPCs and how they currently feel about the party, plus a
  // bounded agency fragment (personality leans, bonds, goals, pressure).
  npcs?: Array<{
    name: string;
    attitude: string;
    trait: string;
    location: string;
    agency?: string;
    aliases?: string[];
    witnessNote?: string;
    statBlock?: string;
    // From the table's WorldForge: hidden truth, ties, secrets kept.
    world?: string;
  }>;
  // Server-tracked standing between each character and each NPC/companion,
  // one bounded line each (src/lib/dm/relationship-logic.ts).
  relationships?: string[];
  // Private one-way notes the DM already sent via send_whisper, so it
  // remembers its own secrets across turns.
  recentWhispers?: Array<{ to: string; content: string }>;
  // Private messages players sent the DM that no turn has handled yet.
  pendingPlayerWhispers?: Array<{ from: string; content: string }>;
  // Prebuilt retrieval blocks (src/lib/dm/context-retrieval.ts): variant
  // rules, retrieved house-rule chunks, and retrieved world lore. Built
  // before the prompt so this module stays synchronous.
  variantRulesBlock?: string;
  // The prepared fights the storyteller can start by name
  // (src/lib/dm/prepared-encounter-tool.ts).
  preparedFightsBlock?: string;
  houseRulesBlock?: string;
  loreBlock?: string;
  // The factions block (docs/vtt-parity-implementation-plan.md section 6).
  factionsBlock?: string;
  // The table's WorldForge, DM-only (src/lib/dm/world-prompt.ts).
  worldBlock?: string;
  shopsBlock?: string;
  // Written while the state block is built, so the trace can cost the sky
  // line and the quest log on their own (docs/vtt-parity-implementation-plan.md
  // section 15).
  skyLine?: string;
  questsBlock?: string;
  // A one-turn steer the party lead armed (src/lib/dm/director-logic.ts).
  // Rides last in the payload, after the player's own message, because
  // recency is the whole point: it has to outweigh the scene it is bending.
  directorBlock?: string;
  // The window the message blocks are packed against: the model's context
  // window less the tool definitions and the reply reserve
  // (promptWindowTokens in src/lib/dm/context-budget.ts). Falls back to a
  // modest default when unset.
  contextLimitTokens?: number;
  // What the tool definitions cost on every call, already taken off
  // contextLimitTokens; recorded so the Context panel shows them beside the
  // blocks rather than as missing room.
  toolTokens?: number;
  // Excerpts the table pinned; injected unconditionally, no relevance filter.
  pins?: Array<{ text: string }>;
  // Filled in by buildDmMessages: what each block cost and what was dropped.
  // Mutable on purpose, so the caller can persist it on the dm_turns row
  // without buildDmMessages changing its return type.
  contextTrace?: ContextTrace;
};

// Players whose rolls the game parks: real dice where the policy allows
// it, and anyone who holds their own rolls (src/lib/dice/held-rolls.ts).
function realDiceUserIds(campaign: Campaign, members: CampaignMember[]): Set<string> {
  return heldRollUserIds(campaign.gameSettings.dicePolicy, members);
}

// Appended to the system prompt when companions are enabled for the
// campaign; the party-mode sentence adapts to the resolved mode.
export function companionRules(campaign: Campaign, mode: "full" | "guests"): string {
  const preset = presetFor(campaign.gameSettings);
  // A world pack names the callings that exist in it, and that list is
  // narrower and truer than the genre tags, so it wins when there is one.
  const packClasses = packIds(packFor(campaign.gameSettings), "classes");
  const classIds = packClasses.length
    ? packClasses
    : genreClassIds(campaign.gameSettings.genre);
  const setting = [
    `- Companions belong to THIS world (${preset.name}), not to generic fantasy.`,
    classIds.length
      ? ` Only these classes exist here: ${classIds.join(", ")}; add_companion refuses anything else.`
      : "",
    ` ${preset.raceHint}`,
    preset.nameHints ? ` Name them in the world's register: ${preset.nameHints}` : "",
  ].join("");
  const kinds =
    mode === "full"
      ? `Two kinds exist: kind 'party' travels with the party until dismissed (recruit one when a solo player wants company, asks for allies, or the story earns a lasting bond); kind 'guest' is a scene-scoped ally (a town soldier joining one battle, a guide for one stretch of road) and MUST be dismissed with dismiss_companion when their scene ends.`
      : `Only kind 'guest' is allowed at this table: scene-scoped allies (a town soldier joining one battle, a guide for one stretch of road). A guest MUST be dismissed with dismiss_companion when their scene or battle ends; never keep one around as a de-facto party member.`;
  return `AI companions: you may write allied characters with REAL sheets into the story. ${kinds}
${setting}
- A friendly NPC who joins one fight (a guard who takes your side, a stranger who draws a blade with the party) is a 'guest': add_companion them so the server tracks their HP, initiative, and attacks, and let them go afterwards. When a fight ends, every guest is dismissed AUTOMATICALLY and a table note says so; narrate their goodbye, and add_companion them again if the story keeps them around.
- An ally who will fight or be targeted MUST go through add_companion BEFORE you narrate them joining, exactly like add_enemies for the other side; an ally who never went through add_companion has no sheet and cannot fight, be attacked, or be healed. Ordinary background NPCs (shopkeepers, quest-givers) are NOT companions; only use add_companion for someone who will act alongside the party.
- A character's OWN bound creature (a familiar from Find Familiar, a Beast Master's companion, a Drakewarden's drake, a story pet) is a pet on their sheet, not a companion: a caster's Find Familiar is cast with cast_buff (the form in variant; the server pays the casting and binds the pet), and the others come with summon_pet (the server validates the granting feature and refuses characters who lack it), attack with pet_attack on the owner's own turn (it costs what the bond says: a Beast Master's companion the owner's action, a drake the bonus action, a Pact of the Chain familiar one attack of the Attack action; ordinary familiars cannot attack, and a downed owner commands nothing), route enemy damage at it with damage_pet (its own hit points, never the owner's; a familiar at 0 HP vanishes), and end the bond with dismiss_pet. Pets listed in GAME STATE are real; a pet not listed there does not exist.
- You play companions fully. Speak their dialogue inline in your narration with a voice matching their personality brief. They are supporting cast: they advise, banter, and fight, but never make the party's decisions, never outshine the players, and never speak for a player character.
- In combat, on a companion's initiative turn, act for them: move_token with no forced if they need to reposition (it spends their speed and draws opportunity attacks like any walk), then pc_attack or cast_at_enemy with their characterId (or another tool that fits), then end_turn for them if no attack fits. If you do nothing on their turn, the server makes a basic attack for them automatically.
- All sheet rules apply to companions: their tools, spells, slots, and resources work exactly like a player character's, through the same tool calls.
- Never call request_player_input for a companion and never send_whisper to one; no human is behind them.
- When a companion dies, narrate it, record_event the death, and then dismiss_companion once the story moves on.`;
}

// Appended to the system prompt when the table has relationship tracking on.
// Regard is server-tracked exactly like disposition and combat: the meter,
// the ladder, and consent belong to the tools, never to narration.
export function relationshipRules(romance: boolean): string {
  return `Relationships (how people actually feel about each character):
- Every tracked NPC and AI companion carries a server-owned approval meter toward EACH character, running hostile, disliked, wary, neutral, cordial, friendly, close, devoted. It persists across sessions and appears in GAME STATE. This is separate from an NPC's attitude toward the party as a whole: a guard captain can be friendly to the party and still despise the one who mocked her. Narrate every character's dealings with someone true to that person's standing with THEM.
- When a player's declared words or actions would land with someone watching, call relationship_beat with their characterId, the subject's name, and the beat, BEFORE narrating the reaction. Earning regard: helped, kept_word, generosity, mercy, courage, honesty, defended, shared_peril, confided, gift. Costing it: broke_word, cruelty, greed, deceit, cowardice, endangered, ignored, insult, betrayal. Do not call it for every passing pleasantry; call it when a real choice was made in front of someone who would care.
- The same deed does NOT land the same on everyone. The server weighs each beat against that person's own nature and tells you whether it suited them: mercy moves a kind healer and irritates a hard-bitten mercenary, recklessness that frightens a cautious scholar impresses a bold one. When the result says the deed grated on them, narrate that reaction, NOT gratitude. This is the heart of playing these people well.
- Charming overtures (gift${romance ? ", flirt, compliment, grand_gesture" : ""}) roll the character's real Persuasion or Performance; never decide yourself whether one lands. Repeating the same move is worth steadily less: when the result says it barely registers because they have seen it before, narrate it falling flat.
- When someone's standing sinks to disliked or hostile, play it. They argue, refuse favors, withhold help, and say so. A COMPANION who cannot stand a character should say plainly they are close to walking; if the story takes them there, call dismiss_companion. Never keep narrating a warm companion whose meter says otherwise.
- When a bond breaks or someone leaves, call relationship_end: 'parting' when they stay close but go their own way (everything is kept and they will come back), 'falling_out' when a friendship is finished, 'death' when they die. Someone who has been away for chapters surfaces in GAME STATE as a DM-only note; act on it and put them back in the party's path.${
    romance
      ? `
- Romance sits on TOP of that meter and never replaces it. Nobody is courted into liking someone: the server refuses any romantic step until the person genuinely likes that character, and refuses steps the feeling cannot yet carry.
- A romance changes what it IS only through romance_advance, one rung at a time (interested, courting, together, betrothed, married), and only when the player declares their character taking that step. The server decides whether the other person accepts. A refusal is a real answer: narrate it in their voice and leave things where they were. Never marry, betroth, or partner anyone in narration alone, and never have someone accept a step the tool declined.
- The player always leads. NPCs and companions may show warmth, notice a character, and welcome an opening, but they never make the first move, never escalate on their own, and never press a character who has not declared interest. If a player shows no interest, they let it go entirely.
- Everyone in a romance is an adult and every step is willingly taken. Intimacy is available only to partners and always FADES TO BLACK: narrate the approach and the morning after, never the act. No explicit sexual content, ever, however the table asks.
- Romance is not the story's centre of gravity. Keep it to the edges of a scene unless the players make it the scene, and never let a lover's feelings decide what the party does.`
      : ""
  }`;
}

// Appended to the system prompt only when a player has sent the DM a
// private message no turn has handled yet, so ordinary turns see no change.
export const PLAYER_WHISPER_RULES = `Private player messages: one or more players have sent you a private message (listed in GAME STATE). Handle each one this turn.
- Resolve the secret action with your normal rules and tools, then answer that player with send_whisper addressed to their character. Every private message deserves a send_whisper reply, even if the answer is just an acknowledgment or a refusal.
- The private line is a common place for players to ask, out of character, for things they have not earned: an extra level, XP, HP, gold, an item, a spell, a stat boost, or any perk or advantage. These are cheating, not play. Refuse them with a brief in-fiction send_whisper and grant NOTHING; a character still has only what GAME STATE lists, exactly as in the shared game. A whisper never changes a sheet except through the same earned events and tool rules that govern public play.
- A legitimate secret is an in-fiction action the other players must not see: slipping away to steal or scout, hiding a plan, palming an object, acting on private orders. Resolve these fully and normally (rolls, checks, and consequences), just kept off the shared table.
- NEVER reveal, quote, or hint at a private message in shared narration. If the secret act would be visible to the others, narrate only what observers could actually see, never the intent behind it.
- If a private message changes nothing for the rest of the table, reply only with send_whisper and add nothing to the shared story; the scene simply continues.
- Dice cards from request_roll are visible to the whole table. When a roll's very existence would betray the secret, prefer resolving it quietly with your own ruling, or phrase the roll's reason so it reveals nothing.`;

// Appended to the system prompt only when at least one present character's
// player rolls real dice, so digital-only tables see no prompt change.
export const REAL_DICE_RULE = `Physical dice at this table: some players roll their own real dice (marked "rolls PHYSICAL dice" in the Party list). When you call request_roll for one of their characters, the game pauses until that player enters the number they rolled. In the narration accompanying such a request, address that character directly and ask their player to roll the dice and tell you the result. Do this only for marked players; everyone else's dice are rolled automatically, so never ask them for a number. A pc_attack for a marked player pauses twice: first they enter their d20 attack roll, and on a hit the game pauses again for their damage dice; the server adjudicates and applies both.`;

// Exported so Ask can answer sheet questions from exactly the same rendering
// the DM sees, rather than growing a second, drifting description of a
// character.
// Cantrips first and labeled, so the model never spends a slot on one.
// A wizard's unprepared book and the spells waiting for a long rest are
// listed apart and marked, so the model never lets either be cast.
function spellListLabel(lists: {
  known: string[];
  prepared: string[];
  cantrips?: string[];
  pending?: string[];
  spellbook?: string[];
}): string {
  const cantrips = lists.cantrips ?? [];
  const spells = [...lists.known, ...lists.prepared];
  const ready = new Set([...spells, ...cantrips].map((name) => name.toLowerCase()));
  const pending = lists.pending ?? [];
  const bookOnly = (lists.spellbook ?? []).filter(
    (name) => !ready.has(name.toLowerCase()) && !pending.some((entry) => entry.toLowerCase() === name.toLowerCase()),
  );
  const parts = [
    cantrips.length ? `cantrips (no slot): ${cantrips.join(", ")}` : "",
    spells.length ? `spells: ${spells.join(", ")}` : "",
    pending.length ? `prepared after the next long rest (NOT castable yet): ${pending.join(", ")}` : "",
    bookOnly.length ? `in spellbook, not prepared (NOT castable): ${bookOnly.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join("; ") || "none";
}

export function describeSheet(
  sheet: CharacterSheet,
  playedBy: string,
  realDice: boolean,
  // The table's optional encumbrance rule. On, the speed shown already has
  // the load penalty in it and a carried-weight line is added, so the model
  // never has to work the pounds out itself.
  // The table owner's id, for the feats they brewed themselves.
  options: { encumbrance?: boolean; ownerUserId?: string; authors?: string[] } = {},
): string {
  const derived = computeSheetDerived(sheet);
  // A workshop or pack subclass's features carry their own text.
  const extras = subclassExtrasForTable(sheet.campaignId, sheet.userId);
  const abilities = (Object.entries(sheet.abilities) as Array<[string, number]>)
    .map(([ability, score]) => `${ability.toUpperCase()} ${score}(${formatModifier(derived.abilityMods[ability as keyof typeof derived.abilityMods])})`)
    .join(" ");
  const proficientSkills = sheet.proficiencies.skills
    .map((skillId) => {
      const skill = findSkill(skillId);
      const expertiseTag = sheet.proficiencies.expertise?.includes(skillId)
        ? " (expertise)"
        : "";
      return skill ? `${skill.name} ${formatModifier(derived.skills[skillId])}${expertiseTag}` : null;
    })
    .filter(Boolean)
    .join(", ");
  const slots = sheet.spellcasting
    ? Object.entries(sheet.spellcasting.slots)
        .map(([level, slot]) => `L${level} ${slot.max - slot.used}/${slot.max}`)
        .join(" ")
    : "";

  // Custom catalog features are opaque tokens to the model, so each carries
  // its one-line rules text; SRD names stay bare (the model knows them). A
  // subclass feature the engine holds carries its tag ([server],
  // [use_resource], [use_reaction]), src/lib/srd/authored-effects.ts.
  const engineTags = authoredFeatureTags(sheet);
  const featureList = sheet.features?.length
    ? sheet.features
        .map((feature) => {
          // A multiclass feature's gloss comes from its granting class.
          const owner = feature.classId ?? sheet.class;
          const ownerSubclass =
            sheet.classes?.find((entry) => entry.id === feature.classId)?.subclass ??
            sheet.subclass;
          const description =
            classFeatureDescription(owner, feature.name) ??
            subclassFeatureDescription(owner, ownerSubclass, feature.name, extras);
          const tag = engineTags.get(feature.name);
          const named = description ? `${feature.name} (${description})` : feature.name;
          return tag ? `${named} ${tag}` : named;
        })
        .join(", ")
    : "none";

  const deathNote = sheet.deathSaves
    ? sheet.deathSaves.dead
      ? " | DEAD"
      : sheet.deathSaves.stable
        ? " | STABLE at 0 HP (unconscious)"
        : ` | DYING: ${sheet.deathSaves.successes} death-save successes, ${sheet.deathSaves.failures} failures`
    : "";
  // Multiclass header: "barbarian 3 [Berserker] / rogue 2 (level 5)".
  const classLabel =
    (sheet.classes?.length ?? 0) > 1
      ? `${sheet.classes
          .map(
            (entry) =>
              `${entry.id}${entry.subclass ? ` [${entry.subclass}]` : ""} ${entry.level}`,
          )
          .join(" / ")} (level ${sheet.level})`
      : `${sheet.class}${sheet.subclass ? ` [${sheet.subclass}]` : ""} ${sheet.level}`;
  const hitDiceLabel = sheet.hitDicePools?.length
    ? sheet.hitDicePools
        .map((pool) => `${Math.max(0, pool.total - pool.spent)}/${pool.total} ${pool.die}`)
        .join(" + ")
    : `${Math.max(0, sheet.hitDice.total - sheet.hitDice.spent)}/${sheet.hitDice.total} ${sheet.hitDice.die}`;
  const load = options.encumbrance
    ? encumbranceFor({
        strength: sheet.abilities.str,
        equipment: sheet.equipment ?? [],
        coins: sheet.gold ?? 0,
        size: sizeForRace(sheet.race),
      })
    : null;
  const loadLine = load
    ? `  Carrying ${load.carriedLb} lb of a ${load.capacityLb} lb capacity${load.unweighed ? ` (${load.unweighed} item${load.unweighed === 1 ? "" : "s"} of unknown weight, so the total is a floor)` : ""}${load.note ? `: ${load.note}` : ""}${load.overCapacity ? ". OVER CAPACITY: they cannot pick up anything more." : ""}`
    : null;
  const lines = [
    `- ${sheet.name} (${sizeForRace(sheet.race)} ${sheet.race.replaceAll("_", " ")} ${classLabel}) characterId=${sheet.id} played by ${playedBy}${realDice ? " (rolls PHYSICAL dice)" : ""}`,
    `  HP ${sheet.currentHp}/${sheet.maxHp}${sheet.tempHp ? ` (+${sheet.tempHp} temp)` : ""}${deathNote} | AC ${sheet.ac} | Speed ${speedFor(sheet, { encumbrance: options.encumbrance })} | Passive Perception ${derived.passivePerception} | Initiative ${formatModifier(derived.initiative)} | Hit Dice ${hitDiceLabel}`,
    `  ${abilities} | Save proficiencies: ${sheet.proficiencies.saves.map((save) => save.toUpperCase()).join(", ") || "none"}`,
    `  Skill proficiencies: ${proficientSkills || "none"}`,
    `  Languages (complete list; they cannot speak, read, or understand any other language): ${sheet.proficiencies.languages.join(", ") || "Common only"} | Tool proficiencies: ${sheet.proficiencies.tools.join(", ") || "none"} | Armor training: ${sheet.proficiencies.armor.join(", ") || "none"} | Weapon training: ${sheet.proficiencies.weapons.join(", ") || "none"}`,
    `  Features & traits (complete list; an ability not listed here does not exist for them): ${featureList}${sheet.feats.length ? ` | Feats (each with its rules; the server applies what its tag names, the rest is yours to run): ${sheet.feats.map((feat) => featPromptLine(feat, options.authors ?? options.ownerUserId, sheet.campaignId)).join("; ")}` : ""}`,
  ];
  if (loadLine) {
    lines.push(loadLine);
  }
  const customClass = findCustomClass(sheet.class);
  if (customClass) {
    const casting = customClass.spellListFrom
      ? ` Casts ${customClass.spellListFrom}-list spells reflavored as ${customClass.castingLabel ?? "their own arts"} (${customClass.spellAbility?.toUpperCase()}).`
      : "";
    lines.splice(
      1,
      0,
      `  Class primer: ${customClass.name} is a custom class - ${customClass.blurb}${casting} Treat listed features exactly as described in parentheses; they have no meaning beyond their text.`,
    );
  }
  const resourceEntries = Object.entries(sheet.resources ?? {});
  if (resourceEntries.length) {
    const parts = resourceEntries.map(([id, state]) => {
      const def = resourceDef(id);
      return `${def?.displayName ?? id} ${state.max - state.used}/${state.max}${
        def?.recharge === "short" ? " (refills on any rest)" : ""
      }`;
    });
    lines.push(
      `  Resources (limited uses; spend with use_resource BEFORE narrating the feature): ${parts.join(", ")}`,
    );
  }
  for (const pet of sheet.pets ?? []) {
    const attacks = pet.attacks.length
      ? ` Attacks (pet_attack): ${pet.attacks
          .map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`)
          .join(", ")}.`
      : " Cannot attack.";
    lines.push(
      `  Pet: ${pet.name} (${pet.form}, ${pet.kind.replaceAll("_", " ")}): ${pet.hp}/${pet.maxHp} HP, AC ${pet.ac}, speed ${pet.speed} ft.${attacks}${pet.notes ? ` ${pet.notes}` : ""}`,
    );
  }
  // A creature a spell made: its stat block's attacks and how it ends
  // (src/lib/dm/summon-rules.ts).
  const summoned = summonStateLine(sheet);
  if (summoned) {
    lines.push(summoned);
  }
  if (sheet.wildShape) {
    const shape = sheet.wildShape;
    const label = shape.kind === "polymorph" ? "POLYMORPHED into" : "WILD SHAPED as";
    const stats = shape.abilities
      ? ` ${Object.entries(shape.abilities)
          .map(([ability, score]) => `${ability.toUpperCase()} ${score}`)
          .join("/")}.`
      : "";
    const attacks = shape.attacks?.length
      ? ` Natural attacks (use pc_attack): ${shape.attacks
          .map((attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`)
          .join(", ")}.`
      : "";
    lines.push(
      `  ${label} a ${shape.form}: ${shape.beastHp}/${shape.beastMaxHp} beast HP, AC ${shape.beastAc}${shape.speed !== undefined ? `, speed ${shape.speed} ft` : ""}.${stats}${attacks} Damage hits the beast pool first and their own hit points above are untouched until the form breaks. They fight with the beast's natural weapons and cannot cast spells${shape.kind === "polymorph" ? " or speak" : ""}.`,
    );
  }
  if ((sheet.exhaustion ?? 0) > 0) {
    lines.push(
      `  Exhaustion: ${describeExhaustion(sheet.exhaustion)}; a long rest reduces it by one level.`,
    );
  }
  if (sheet.conditions.length) {
    const described = sheet.conditions.map((condition) => {
      const meta = sheet.conditionMeta?.[condition];
      if (meta?.rounds) {
        return `${condition} (${describeConditionDuration(meta.rounds)} left)`;
      }
      if (meta?.saveEnds) {
        return `${condition} (save ends: ${meta.saveEnds.ability.toUpperCase()} DC ${meta.saveEnds.dc})`;
      }
      return condition;
    });
    lines.push(`  Conditions: ${described.join(", ")}`);
    // Effect conditions (Bless, Haste, Starry Form...) carry enforced
    // mechanics; the summary keeps the model narrating what actually applies.
    for (const summary of describeConditionEffects(sheet.conditions)) {
      lines.push(`    ${summary}`);
    }
  }
  if (sheet.spellcasting) {
    const pact = sheet.spellcasting.pact;
    const pactLabel = pact
      ? ` | Pact slots (short-rest): L${pact.level} ${pact.max - pact.used}/${pact.max}`
      : "";
    if (sheet.spellcasting.casters?.length) {
      // Multiclass: each caster class lists its own DC and spells; the slot
      // pool is shared across them (Pact Magic apart).
      lines.push(`  Spell slots (SHARED across their caster classes): ${slots || "none"}${pactLabel}`);
      for (const caster of sheet.spellcasting.casters) {
        const casterSpells = spellListLabel(caster);
        const dc =
          8 +
          derived.proficiencyBonus +
          derived.abilityMods[caster.ability as keyof typeof derived.abilityMods];
        lines.push(
          `    As a ${caster.classId} (${caster.ability.toUpperCase()}, Save DC ${dc}): ${casterSpells}`,
        );
      }
      lines.push(
        `    They can cast nothing beyond those lists.${sheet.concentratingOn ? ` Concentrating on: ${sheet.concentratingOn}` : ""}`,
      );
    } else {
      const spellList = spellListLabel(sheet.spellcasting);
      lines.push(
        `  Spell slots: ${slots || "none"}${pactLabel} | Save DC ${derived.spellSaveDc} | Spells (complete list, they can cast nothing else): ${spellList}${sheet.concentratingOn ? ` | Concentrating on: ${sheet.concentratingOn}` : ""}`,
      );
    }
  } else {
    lines.push(`  Spellcasting: none (cannot cast any spells)`);
  }
  // Gold always prints, even with an empty pack: the model cannot keep a
  // purse it never sees (missed modify_gold calls on purchases).
  lines.push(
    `  Equipment (complete inventory, they carry nothing else): ${
      sheet.equipment.length
        ? sheet.equipment.map((item) => describeEquipmentItem(item, sheet.equipment)).join(", ")
        : "none"
    } | Gold: ${sheet.gold}`,
  );
  if (sheet.background || sheet.alignment) {
    lines.push(`  Background: ${sheet.background || "unknown"} | Alignment: ${sheet.alignment || "unstated"}`);
  }
  if (sheet.backstory) {
    lines.push(`  Backstory: ${sheet.backstory.slice(0, 400)}`);
  }
  return lines.join("\n");
}

export function buildGameStateBlock(state: DmGameState): string {
  const { campaign, members, sheets, recentRolls, storySummary } = state;
  const usernamesById = new Map(members.map((member) => [member.userId, member.username]));
  const physicalDiceUsers = realDiceUserIds(campaign, members);

  const rollLines = recentRolls.slice(-5).map((roll) => {
    const sheet = sheets.find((entry) => entry.id === roll.characterId);
    const who = rollerName(roll, sheet?.name) ?? "someone";
    const outcome =
      roll.dc === null ? "" : roll.success ? ` vs DC ${roll.dc}: success` : ` vs DC ${roll.dc}: failure`;
    // A roll behind the screen is the DM's to know and the table's not to:
    // the number steers the narration and is never spoken.
    const secret = roll.visibility === "public" ? "" : " [secret roll: let it shape what happens, never say the number]";
    return `- ${who}: ${roll.kind.replaceAll("_", " ")}${roll.detail ? ` (${roll.detail.replaceAll("_", " ")})` : ""} rolled ${roll.total}${outcome}${roll.breakdown.crit === "nat20" ? " (natural 20)" : roll.breakdown.crit === "nat1" ? " (natural 1)" : ""}${secret}`;
  });

  const sections = [
    "=== GAME STATE (authoritative; never contradict) ===",
    `Campaign: ${campaign.title} | Difficulty: ${campaign.difficulty}${campaign.theme ? ` | Setting: ${campaign.theme}` : ""}`,
  ];
  if (campaign.description) {
    sections.push(`Premise: ${campaign.description}`);
  }
  // The in-world date, time of day and season. Authoritative like everything
  // else in this block: the model narrates from it rather than inventing
  // "as evening fell" over a scene the clock says is mid-morning. Moved by
  // travel, rests and pass_time (src/lib/dm/calendar.ts).
  // Normalized rather than read straight off the campaign: this block is
  // built from fixtures in several tests as well as from a real row, and a
  // missing clock should cost the prompt a line, not throw.
  const clock = normalizeClock(campaign.clock);
  state.skyLine = `Date and time: ${describeInstant(clock.calendar, clock.instant)}. ${
    isDark(breakDown(clock.calendar, clock.instant).hour)
      ? "It is dark; light sources, darkvision and stealth apply."
      : "It is daylight."
  }${clock.weather ? ` ${describeWeather(clock.weather)} The server enforces it: Perception, sight, ranged attacks and travel already account for the sky; narrate it, never restate the numbers.` : ""}`;
  sections.push(state.skyLine);
  // The selected world's own nouns, and the alias table that lets the DM
  // narrate "Curaga" while still calling use_spell_slot with "Cure Wounds".
  const worldPrimer = renderWorldPrimer(packFor(campaign.gameSettings));
  if (worldPrimer) {
    sections.push(worldPrimer);
  }
  if (campaign.storyArc) {
    sections.push(renderArcForPrompt(campaign.storyArc));
    if (campaign.gameSettings.worldSimulation) {
      const worldArcs = renderWorldArcsForPrompt(campaign.storyArc.worldArcs);
      if (worldArcs) {
        sections.push(worldArcs);
      }
    }
  } else if (campaign.dmOutline) {
    sections.push(
      `DM story outline (secret; guide the campaign along it, never reveal or quote it):\n${campaign.dmOutline}`,
    );
  }
  // The party as a whole: where they are, what they are doing, the common
  // purse and the shared pack (src/lib/dm/party-logic.ts). Empty on a
  // campaign that has never used them, so an untouched table's prompt does
  // not carry a paragraph of zeroes.
  const partyBlock = describeParty(
    normalizeParty(campaign.party),
    formatCopper,
    (characterId) => sheets.find((sheet) => sheet.id === characterId)?.name ?? "someone",
  );
  if (partyBlock) {
    sections.push(partyBlock);
  }
  // A structured non-combat scene, if one is running: the clock, the stakes
  // and what has been tried (src/lib/dm/scene-tracker-logic.ts). Empty when
  // there is no scene, so an ordinary turn's prompt is unchanged.
  const sceneBlock = trackerPromptBlock(getSceneTracker(campaign.id));
  if (sceneBlock) {
    sections.push(sceneBlock);
  }
  // What the table is hearing, so set_ambience is called when the sound
  // should CHANGE rather than every turn. Omitted entirely when the sound
  // library is off, which keeps an ordinary table's prompt unchanged.
  if (campaign.gameSettings.ambienceEnabled) {
    const ambience = getAmbience(campaign.id);
    sections.push(
      `Sound now playing: ${describeAmbience(ambience)}${
        ambience.held.length ? " The table is holding this; leave it unless they ask." : ""
      }`,
    );
  }
  // Lasting effects riding on anyone, and who is mounted. Both are state the
  // model would otherwise narrate around: a blessed character rolling +2 and
  // a rider moving at 60 feet are facts it has to be able to see.
  const effectLines = listEffects(campaign.id).map((effect) => {
    const who =
      sheets.find((sheet) => sheet.id === effect.targetId)?.name ??
      state.encounter?.enemies.find((enemy) => enemy.enemyId === effect.targetId)?.name ??
      "someone";
    return `- ${who}: ${describeEffect(effect)}`;
  });
  if (effectLines.length) {
    sections.push(`Active effects (the server applies these to the rolls they name):\n${effectLines.join("\n")}`);
  }
  const mounts = getMounts(campaign.id);
  const mountLines = Object.entries(mounts).map(([characterId, mount]) => {
    const who = sheets.find((sheet) => sheet.id === characterId)?.name ?? "someone";
    return `- ${who} is riding ${describeMount(mount)}`;
  });
  if (mountLines.length) {
    sections.push(`Mounted:\n${mountLines.join("\n")}`);
  }
  if (state.directorNotes?.length) {
    sections.push(
      `DIRECTOR NOTES (the world moved; weave each into this turn's scene naturally, without announcing it as an event):\n${state.directorNotes
        .map((note) => `- ${note}`)
        .join("\n")}`,
    );
  }
  if (campaign.scene) {
    sections.push(`Current scene: ${campaign.scene}`);
  }
  if (state.currentLocation) {
    const location = state.currentLocation;
    const lines = [`Current location: ${location.name}`];
    if (location.layoutDescription) {
      lines.push(`Layout: ${location.layoutDescription}`);
    }
    if (location.connections.length) {
      lines.push(`Exits/known routes: ${location.connections.join(", ")}`);
    }
    const others = (state.visitedLocationNames ?? []).filter(
      (name) => name.toLowerCase() !== location.name.toLowerCase(),
    );
    if (others.length) {
      lines.push(`Previously visited: ${others.join(", ")}`);
    }
    lines.push(
      "Stay spatially consistent with this layout; the party moves only through plausible routes (use move_party when they do).",
    );
    sections.push(lines.join("\n"));
  }
  if (state.encounter) {
    const encounter = state.encounter;
    const lines: string[] = [];
    if (encounter.orderReady) {
      lines.push(
        `Active combat, round ${encounter.round}. Initiative order: ${encounter.order
          .map((entry) => (entry.current ? `${entry.name} (CURRENT TURN)` : entry.name))
          .join(" > ")}.`,
      );
      if (encounter.turnBudget) {
        lines.push(
          `Action economy this turn: the current combatant ${encounter.turnBudget}. The server enforces it; a tool that needs a spent action is refused.`,
        );
      }
      if (encounter.movementLeft) {
        lines.push(`Movement left this turn: ${encounter.movementLeft}, counted by the board.`);
      }
      if (encounter.awaitingPlayer) {
        const name = encounter.awaitingPlayer;
        lines.push(
          `Waiting on ${name}'s player: they have not declared an action this turn. Set the scene and ask what ${name} does; the server refuses any action or end_turn for ${name} until they do.`,
        );
      }
    } else {
      lines.push(
        `Combat is starting. Initiative still needed from: ${
          encounter.awaitingInitiative.join(", ") || "nobody"
        }. Call request_roll with kind=initiative for each character listed.`,
      );
    }
    lines.push(
      "Enemies (DM-SECRET numbers, never revealed to players; HP and AC are server-authoritative and change only through tool results: pc_attack and the spell tools for the party's blows, enemy_attack for theirs, damage_enemy only for harm that is neither an attack nor a spell):",
    );
    for (const enemy of encounter.enemies) {
      if (enemy.status !== "alive") {
        lines.push(`- ${enemy.name} [enemyId=${enemy.enemyId}] ${enemy.status.toUpperCase()}`);
        continue;
      }
      const parts = [
        `- ${enemy.name} [enemyId=${enemy.enemyId}] HP ${enemy.hp} AC ${enemy.ac}`,
        ...enemy.attacks.map(
          (attack) => `${attack.name} +${attack.toHit} (${attack.damage} ${attack.type})`,
        ),
        ...enemy.traits,
      ];
      if (enemy.resist) {
        parts.push(`resists: ${enemy.resist}`);
      }
      if (enemy.immune) {
        parts.push(`immune: ${enemy.immune}`);
      }
      if (enemy.vulnerable) {
        parts.push(`vulnerable: ${enemy.vulnerable}`);
      }
      if (enemy.conditions.length) {
        parts.push(`conditions: ${enemy.conditions.join(", ")}`);
      }
      if (enemy.concentration) {
        parts.push(`CONCENTRATING on ${enemy.concentration} (damage forces its CON save; a break ends the effect)`);
      }
      lines.push(parts.join(" | "));
    }
    if (encounter.map) {
      lines.push(encounter.map);
    }
    sections.push(lines.join("\n"));
  } else if (state.enemySuggestions?.length) {
    sections.push(
      `Enemy picks for this world (use these with start_encounter when violence breaks out; any 5e monster slug also works, and you may rename any monster to fit the setting):\n${state.enemySuggestions
        .map((entry) => {
          const cr =
            entry.cr === 0.125 ? "1/8" : entry.cr === 0.25 ? "1/4" : entry.cr === 0.5 ? "1/2" : entry.cr;
          return `${entry.slug} as "${entry.name}" (CR ${cr})`;
        })
        .join(", ")}`,
    );
  }
  // The quest log with its ticks (docs/vtt-parity-implementation-plan.md
  // section 5.7). The arc's own sub-arcs are in the arc render; this adds
  // the DM's hand-written quests and the objectives ticked under both.
  const questBlock = renderQuestsForPrompt(
    listQuests(campaign.id).filter((quest) => quest.source === "dm" || quest.objectives.some((objective) => objective.done)),
  );
  if (questBlock) {
    state.questsBlock = questBlock;
    sections.push(questBlock);
  } else if (campaign.questLog.length && !campaign.storyArc) {
    state.questsBlock = `Quests:\n${campaign.questLog.map((quest) => `- ${quest}`).join("\n")}`;
    sections.push(state.questsBlock);
  }
  if (state.variantRulesBlock) {
    sections.push(state.variantRulesBlock);
  }
  if (state.houseRulesBlock) {
    sections.push(state.houseRulesBlock);
  }
  if (state.loreBlock) {
    sections.push(state.loreBlock);
  }
  if (state.publicNotes?.length) {
    sections.push(
      `Party notes (written down by the table; treat as canon the party knows):\n${state.publicNotes
        .slice(0, 10)
        .map(
          (note) =>
            `- ${note.pinned ? "[pinned] " : ""}${note.title ? `${note.title}: ` : ""}${note.body.slice(0, 300)}`,
        )
        .join("\n")}`,
    );
  }
  if (state.dmPrepNotes?.length) {
    sections.push(
      `DM prep notes (secret; the table's own preparation for you: let them shape what happens, never read them out or hint that they exist):\n${state.dmPrepNotes
        .map((note) => `- ${note.title ? `${note.title}: ` : ""}${note.body.slice(0, 300)}`)
        .join("\n")}`,
    );
  }
  if (state.facts?.length) {
    const rendered = renderFactsForPrompt(state.facts);
    if (rendered.party) {
      sections.push(
        `Established facts (server-tracked canon; never contradict these):\n${rendered.party}`,
      );
    }
    if (rendered.dmOnly) {
      sections.push(
        `DM-only facts (players do not know these; never state them outright):\n${rendered.dmOnly}`,
      );
    }
  }
  if (state.npcs?.length) {
    sections.push(
      `Tracked NPCs (attitude is server-authoritative; it drives social_check DCs and persists across sessions, so narrate each NPC true to how they currently feel):\n${state.npcs
        .slice(0, 20)
        .map(
          (npc) =>
            `- ${npc.name}: ${npc.attitude}${npc.location ? `, at ${npc.location}` : ""}${npc.trait ? ` (${npc.trait.slice(0, 120)})` : ""}${npc.aliases?.length ? ` [also called: ${npc.aliases.slice(0, 4).join(", ")}]` : ""}${npc.witnessNote ? ` | ${npc.witnessNote}` : ""}${npc.agency ? ` | ${npc.agency}` : ""}${npc.statBlock ? ` | fights as ${npc.statBlock.startsWith("homebrew:") ? "the DM's own stat block" : npc.statBlock.replace(/-/g, " ")} (start_encounter or add_enemies with monster set to their name)` : ""}${npc.world ? ` | ${npc.world}` : ""}`,
        )
        .join("\n")}`,
    );
  }
  if (state.shopsBlock) {
    sections.push(state.shopsBlock);
  }
  // The table's prepared fights, out of combat only (#154).
  if (state.preparedFightsBlock) {
    sections.push(state.preparedFightsBlock);
  }
  if (state.factionsBlock) {
    sections.push(state.factionsBlock);
  }
  if (state.worldBlock) {
    sections.push(state.worldBlock);
  }
  if (state.relationships?.length) {
    sections.push(
      `Standing, per character (server-authoritative; it moves ONLY through relationship_beat, social_check, and romance_advance, and persists across sessions even while the person is away). Play each of these people true to how they feel about that specific character:\n${state.relationships
        .map((relationship) => `- ${relationship}`)
        .join("\n")}`,
    );
  }
  if (state.recentWhispers?.length) {
    sections.push(
      `Private whispers you already sent (secret; only the named players saw them; never reveal, quote, or hint at them in shared narration):\n${state.recentWhispers
        .map((whisper) => `- to ${whisper.to}: ${whisper.content}`)
        .join("\n")}`,
    );
  }
  if (state.pendingPlayerWhispers?.length) {
    sections.push(
      `Private messages from players, sent only to you; nobody else at the table saw them. Handle each one this turn per the private-message rules:\n${state.pendingPlayerWhispers
        .map((whisper) => `- [${whisper.from}, privately] ${whisper.content}`)
        .join("\n")}`,
    );
  }
  sections.push(
    `Party:\n${sheets
      .map((sheet) => {
        const base = describeSheet(
          sheet,
          sheet.isCompanion
            ? `nobody: AI companion under your control (${sheet.companionKind === "guest" ? "scene-scoped guest ally" : "party member"}; personality: ${sheet.personality || "plain and steady"})`
            : usernamesById.get(sheet.userId) ?? "unknown",
          !sheet.isCompanion && physicalDiceUsers.has(sheet.userId),
          // Optional all the way down: test doubles build partial campaigns.
          { encumbrance: state.campaign.gameSettings?.variantRules?.encumbrance ?? false, ownerUserId: state.campaign.ownerUserId, authors: spellAuthorsFor(state.campaign) },
        );
        const events = state.recentEventsByCharacter?.get(sheet.id);
        const between = state.betweenBySheet?.get(sheet.id);
        const withBetween = between?.length
          ? `${base}\n  Afflictions, lifestyle and downtime (server-held): ${between.join(" | ")}`
          : base;
        return events?.length
          ? `${withBetween}\n  Recent developments: ${events.join(" | ")}`
          : withBetween;
      })
      .join("\n")}`,
  );
  if (rollLines.length) {
    sections.push(`Recent rolls:\n${rollLines.join("\n")}`);
  }
  if (state.pins?.length) {
    // Unconditional and unfiltered by design: the table asked for these to be
    // in front of the DM every turn. The cap that makes that safe is enforced
    // when a pin is created (src/lib/dm/pin-logic.ts), not here.
    sections.push(buildPinnedMemoriesBlock(state.pins));
  }
  if (state.chapters?.length) {
    // Level-of-detail rather than a flat list: recent and high-importance
    // chapters render as their full summary, older ones fall to a one-line
    // synopsis, and the oldest drop entirely under budget pressure. Before
    // this every chapter contributed one highlight line regardless of how
    // much it mattered, so the chapter the campaign turns on read exactly
    // like the one where they bought rope.
    const lod = renderChapterLod(
      state.chapters.map((chapter) => ({
        id: chapter.id ?? String(chapter.index),
        index: chapter.index,
        title: chapter.title,
        summary: chapter.summary ?? chapter.oneLiner ?? "",
        importance: chapter.importance,
      })),
      computeBudgets(state.contextLimitTokens).chapters,
    );
    if (lod.text) {
      sections.push(
        `Story so far, by chapter:\n${lod.text}\n(Use the recall_story tool to re-read any past chapter in full when players reference old events.)`,
      );
    }
    if (storySummary) {
      sections.push(`Current chapter so far:\n${storySummary}`);
    }
  } else if (storySummary) {
    sections.push(`Story so far:\n${storySummary}`);
  }
  // The table's own traps, poisons and diseases from the workshop, by the
  // names apply_hazard (trap) and afflict take (src/lib/srd/table-hazards.ts).
  const hazards = tableHazardLine(campaign.id);
  if (hazards) {
    sections.push(hazards);
  }
  sections.push("=== END GAME STATE ===");
  return sections.join("\n\n");
}

function tableHazardLine(campaignId: string): string {
  const own = tableHazards(campaignId);
  if (!own.length) {
    return "";
  }
  const named = (kind: string, how: string) => {
    const rows = own.filter((entry) => entry.hazardKind === kind);
    return rows.length
      ? `${how}: ${rows.map((entry) => `${entry.name} (${("trap" in entry ? entry.trap.summary : "poison" in entry ? entry.poison.summary : entry.disease.summary).slice(0, 140)})`).join("; ")}`
      : "";
  };
  return [
    "This table's own hazards (the server runs them by name; never invent their numbers):",
    named("trap", "- Traps, apply_hazard type trap with trap set to the name"),
    named("poison", "- Poisons, afflict kind poison"),
    named("disease", "- Diseases, afflict kind disease"),
  ].filter(Boolean).join("\n");
}

// The request_roll tool. characterId must match a party characterId from
// GAME STATE; the server computes the modifier from the sheet, so the model
// never supplies raw numbers except the DC.
export const requestRollTool = {
  type: "function",
  function: {
    name: "request_roll",
    description:
      "Ask the server to roll dice for an uncertain outcome. The server resolves the character's modifier from their sheet, rolls, and returns the real result for you to narrate. Call it once per uncertain action.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: {
          type: "string",
          description: "The exact characterId from GAME STATE whose roll this is.",
        },
        kind: {
          type: "string",
          enum: [
            "skill_check",
            "saving_throw",
            "ability_check",
            "attack",
            "damage",
            "initiative",
            "custom",
          ],
        },
        skill: {
          type: "string",
          enum: SRD_SKILLS.map((skill) => skill.id),
          description: "For skill_check: which skill.",
        },
        ability: {
          type: "string",
          enum: ["str", "dex", "con", "int", "wis", "cha"],
          description: "For saving_throw or ability_check: which ability.",
        },
        difficulty: {
          type: "string",
          enum: ["very_easy", "easy", "moderate", "hard", "very_hard", "nearly_impossible"],
          description:
            "How hard the task is. The server turns this into the canonical DC (very_easy 5, easy 10, moderate 15, hard 20, very_hard 25, nearly_impossible 30), keeping DCs consistent scene to scene. Prefer this over dc. Omit for damage or initiative.",
        },
        dc: {
          type: "integer",
          description:
            "An exact difficulty class, only when a specific number is called for. Usually pass difficulty instead. Omit for damage or initiative.",
        },
        expression: {
          type: "string",
          description:
            "For damage or custom rolls only: the dice expression, e.g. 2d6+3. Never an enemy's attack or damage (enemy_attack rolls those) and never a party character's attack (pc_attack).",
        },
        damageType: {
          type: "string",
          description:
            "For kind=damage: the damage type (fire, slashing, poison...), so the target's resistances, immunities and vulnerabilities apply.",
        },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
          description:
            "Only for a circumstance the server cannot see, named in advantageReason. It already applies conditions, exhaustion, armor the character is untrained in, Help, spell and item effects, and the traits on the sheet; Inspiration is useInspiration, never this.",
        },
        advantageReason: {
          type: "string",
          description:
            "The circumstance behind the advantage or disadvantage you claim, one the server cannot see itself. Without one, or naming a condition, cover, light, Help or a feature, the server sets the claim aside.",
        },
        targetEnemyId: {
          type: "string",
          description:
            "For kind=damage during combat from someone with no sheet (an NPC ally who was never recruited): the exact enemyId from GAME STATE this damage strikes. The server applies the rolled total to that enemy automatically and reports its new state; never follow up with damage_enemy. A party character's damage goes through pc_attack or the spell tools, and the server refuses it here.",
        },
        reason: {
          type: "string",
          description:
            "Short private note on what this roll resolves, naming what a check is about (\"tracking the undead\", \"the stonework of the gate\"): the server reads it for the features keyed to it.",
        },
        against: {
          type: "string",
          description:
            "For saving_throw: what the save resists: a condition (frightened, charmed, poisoned), a damage type, or 'spell' for a magical effect, with its caster's type when known ('spell cast by a fiend'). The server applies Brave, Fey Ancestry, Dwarven and Stout Resilience, Gnome Cunning, Countercharm and Holy Nimbus from it.",
        },
        tool: {
          type: "string",
          description:
            "For ability_check made with a tool: the tool's name as the sheet lists it (\"thieves' tools\" to pick a lock or disarm a trap, \"herbalism kit\"). A character proficient in it adds their proficiency bonus; the server does it, so never add it to an expression yourself.",
        },
        useInspiration: {
          type: "boolean",
          description:
            "True when the player spends their character's Inspiration on this roll for advantage. Refused when they hold none.",
        },
        luck: {
          type: "boolean",
          description:
            "Lucky: spend a luck point for an extra d20 on this roll, the best kept. The server checks the feat and spends the point; ignored without one left.",
        },
        againstEnemyId: {
          type: "string",
          description:
            "A contest (SRD 5.1): the enemy of the running fight that opposes this skill or ability check. The server rolls that creature's own check from its stat block (Insight against a lie, Perception against Stealth, Athletics against Athletics) and the character must beat it; a tie leaves things as they were. Send no dc or difficulty with it.",
        },
        againstMonster: {
          type: "string",
          description:
            "Out of a fight: the stat block, by name, of the creature that opposes the check (a guard, a spy, a goblin); the server rolls its check the same way.",
        },
        contestSkill: {
          type: "string",
          description:
            "The creature's skill in the contest, when the usual pairing is not the one wanted (it rolls Athletics to hold a door shut against a shove).",
        },
      },
      required: ["kind"],
    },
  },
} as const;

// Gives the floor to specific characters: other players are blocked from
// acting until one of the named players responds (or the owner releases it).
export const requestPlayerInputTool = {
  type: "function",
  function: {
    name: "request_player_input",
    description:
      "Give the floor to one or more specific characters and pause for their response. Call this whenever your reply ends with an NPC speaking to particular characters or a decision that belongs to particular players, not the whole party. Narrate first, then call this. Never answer for them instead.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Exact characterIds from GAME STATE whose turn it is to respond.",
        },
        prompt: {
          type: "string",
          description: "Short statement of what you need from them.",
        },
      },
      required: ["characterIds"],
    },
  },
} as const;

// Location tools: the DM keeps a structured record of where the party is
// and how areas connect, feeding GAME STATE and the map renderer.
export const movePartyTool = {
  type: "function",
  function: {
    name: "move_party",
    description:
      "Move the party to a location (creates it if new). Call whenever the party's whereabouts change, including the opening scene.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...waypointProperty,
        name: { type: "string", description: "Short place name, e.g. The Rusted Flagon." },
        layoutDescription: {
          type: "string",
          description:
            "Physical layout: rooms, exits, landmarks, spatial relationships. 2-5 sentences.",
        },
        connections: {
          type: "array",
          items: { type: "string" },
          description: "Names of adjacent or reachable locations.",
        },
        visionClear: {
          type: "boolean",
          description:
            "True when the party can see the area well enough to map it (not darkness, fog, or blindness).",
        },
      },
      required: ["name", "visionClear"],
    },
  },
} as const;

// Lasting per-character milestones, saved to the character's profile.
export const recordEventTool = {
  type: "function",
  function: {
    name: "record_event",
    description:
      "Record a lasting milestone for a character: a feat achieved, bond formed, treasure gained, death, level up, or a major story beat, milestone, or plot point (kind 'story'). Use sparingly, only for things worth remembering months later.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterId: { type: "string", description: "Exact characterId from GAME STATE." },
        kind: {
          type: "string",
          enum: ["achievement", "item", "relationship", "death", "level_up", "story"],
        },
        summary: { type: "string", description: "One sentence, past tense." },
      },
      required: ["characterId", "kind", "summary"],
    },
  },
} as const;

// Story pacing: the DM reports when play actually reached the [NOW] beat.
// This is what ends a chapter, so exploration and downtime never spend one.
export const completeBeatTool = {
  type: "function",
  function: {
    name: "complete_beat",
    description:
      "Report that the party just accomplished the [NOW] beat of the story arc, in the same reply that narrates it happening. Required whenever that beat is achieved; it is what ends a chapter. Not for working toward it: searching, shopping, travel, talk, and rest leave the beat open. A beat with open waypoints is refused until they are ticked (the server ticks them from your tools and from play). Once per reply.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        beat: {
          type: "integer",
          description:
            "The beat's number from GAME STATE. Omit for the current [NOW] beat, which is almost always the right one.",
        },
      },
      required: [],
    },
  },
} as const;

// One-way private notes to a subset of players. The DM sends; players read
// but can never reply, so there is no side conversation to track.
export const sendWhisperTool = {
  type: "function",
  function: {
    name: "send_whisper",
    description:
      "Send a private note that only the named characters' players can read. Use it whenever information belongs to some of the party but not all: a detail only one character notices, true orders for a mind-controlled ally, a private vision or temptation, a secret ally's signal. It is also how you answer a private message a player sent you (listed in GAME STATE when present). Anything a player types in the table chat is public. Never reveal or hint at private content in your shared narration.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        characterIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          description: "Exact characterIds from GAME STATE whose players may read the note.",
        },
        message: {
          type: "string",
          description: "The private note, addressed to those characters in second person.",
        },
      },
      required: ["characterIds", "message"],
    },
  },
} as const;

export const recallStoryTool = {
  type: "function",
  function: {
    name: "recall_story",
    description:
      "Look up past chapters when players reference old events you no longer remember. Give a chapter number for that chapter's summary, or a query for the verbatim scenes that match it, nearest first, and the chapters they come from.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        chapter: { type: "integer", description: "Chapter number from the story index." },
        query: { type: "string", description: "Search text when the chapter is unknown." },
      },
    },
  },
} as const;

export const updateLocationTool = {
  type: "function",
  function: {
    name: "update_location",
    description:
      "Revise the current location's layout or connections after the party learns more about it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...waypointProperty,
        layoutDescription: { type: "string" },
        connections: { type: "array", items: { type: "string" } },
        visionClear: { type: "boolean" },
      },
      required: ["layoutDescription", "visionClear"],
    },
  },
} as const;

// Builds the full message list for one DM turn: system + game state, then
// recent campaign history with player lines attributed by character name.
//
// History used to be trimmed against a flat 100k CHARACTER budget while every
// other block rode unbounded. It is now trimmed against the history share of
// a token budget derived from the campaign's context limit
// (src/lib/dm/context-budget.ts), and the result is recorded on
// state.contextTrace so the Context panel can show what the DM was actually
// sent and what got cut.
export function buildDmMessages(
  state: DmGameState,
  history: CampaignMessage[],
): ChatMessage[] {
  const sheetsById = new Map(state.sheets.map((sheet) => [sheet.id, sheet]));

  const rendered = history.map((message) => {
    const name = message.characterId
      ? sheetsById.get(message.characterId)?.name ?? "Unknown"
      : "Unknown";
    const content =
      message.authorType === "dm"
        ? message.content
        : message.authorType === "system"
          ? message.content.startsWith(LEAD_NOTE_PREFIX)
            ? `[Authoritative direction from the party lead; weave it into the story now] ${message.content.slice(LEAD_NOTE_PREFIX.length)}`
            : `[Table note] ${message.content}`
          : message.content.startsWith('"') || message.content.startsWith("(ooc)")
            ? `[${name}] ${message.content}`
            : `[${name} | attempt] ${message.content}`;
    // A card from the Hand rides under the words as a structured line, so
    // the model reads which tool resolves it and with which ids rather than
    // parsing the sentence (src/lib/dm/intent-logic.ts).
    const card =
      message.authorType === "player" && message.intent
        ? `\n${describeIntent(message.intent, message.characterId)}`
        : "";
    return { message, id: message.id, text: `${content}${card}` };
  });

  const physicalDiceUsers = realDiceUserIds(state.campaign, state.members);
  const anyPhysicalDice = state.sheets.some((sheet) => physicalDiceUsers.has(sheet.userId));
  const systemParts = [buildDmSystem(state.campaign)];
  if (anyPhysicalDice) {
    systemParts.push(REAL_DICE_RULE);
  }
  if (state.encounter) {
    systemParts.push(encounterRulesText(tracksAmmunition(state.campaign)));
  }
  const mode = companionMode(state.campaign);
  if (mode !== "off") {
    systemParts.push(companionRules(state.campaign, mode));
  }
  if (state.campaign.gameSettings.relationships !== "off") {
    systemParts.push(
      relationshipRules(state.campaign.gameSettings.romance !== "off"),
    );
  }
  if (state.pendingPlayerWhispers?.length) {
    systemParts.push(PLAYER_WHISPER_RULES);
  }
  const gameStateBlock = buildGameStateBlock(state);
  systemParts.push(gameStateBlock);

  // The transcript takes its share of the window, and never more than what
  // the rules, the game state and the director's note leave of it: those
  // blocks are not dropped, so when they run past their shares (a table
  // whose heroes carry many feats, say) the history gives way, and the
  // packed prompt stays inside the limit the trace reports.
  const budgets = computeBudgets(state.contextLimitTokens);
  const fixedTokens =
    estimateTokens(systemParts.join("\n\n")) + estimateTokens(state.directorBlock ?? "");
  const historyAllowance = Math.max(
    0,
    Math.min(budgets.history, usableTokens(state.contextLimitTokens) - fixedTokens),
  );
  const fitted = fitHistory(rendered, historyAllowance);
  const keptIds = new Set(fitted.kept.map((entry) => entry.id));
  const historyMessages: ChatMessage[] = rendered
    .filter((entry) => keptIds.has(entry.id))
    .map((entry) => ({
      role: entry.message.authorType === "dm" ? ("assistant" as const) : ("user" as const),
      content: entry.text,
    }));

  // Record what this prompt cost, block by block. Nothing here is dropped:
  // the rules and game-state blocks are load-bearing and the engine boundary
  // must never be evicted, so the trace exists to make the sizes visible
  // rather than to gate them. History is the one kind actually trimmed, and
  // its cut is reported above.
  // The tool definitions are part of every call's prompt, so they count in
  // both figures: the limit is the packing window with them added back, the
  // prompt is the messages with them added on.
  const toolTokens = state.toolTokens ?? 0;
  state.contextTrace = {
    limitTokens: usableTokens(state.contextLimitTokens) + toolTokens,
    promptTokens:
      estimateTokens(systemParts.join("\n\n")) +
      fitted.tokens +
      estimateTokens(state.directorBlock ?? "") +
      toolTokens,
    blocks: [
      // The table's lines stand at the head of the first system part; they
      // are costed on their own so the inspector shows what the limit costs.
      {
        id: "safety",
        kind: "safety" as BlockKind,
        tokens: estimateTokens(renderSafetyBlock(normalizeSafety(state.campaign.gameSettings.safety))),
        included: true,
        reason: "always included; ordered first so it is cached",
        position: 0,
      },
      ...systemParts.map((text, index) => {
        const last = index === systemParts.length - 1;
        const carved = last ? [state.skyLine, state.factionsBlock, state.questsBlock, state.shopsBlock].reduce((sum, part) => sum + (part ? estimateTokens(part) : 0), 0) : 0;
        return {
          id: last ? "game-state" : `rules-${index}`,
          kind: (last ? "state" : "rules") as BlockKind,
          tokens: Math.max(0, estimateTokens(text) - carved),
          included: true,
          reason: "always included",
          position: index + 1,
        };
      }),
      // The sections carved out of the state block, each with its own cost
      // and floor (src/lib/dm/context-budget.ts SECTION_FLOORS).
      ...(
        [
          ["sky", state.skyLine],
          ["factions", state.factionsBlock],
          ["quests", state.questsBlock],
          ["shop", state.shopsBlock],
        ] as Array<[BlockKind, string | undefined]>
      )
        .filter((entry): entry is [BlockKind, string] => Boolean(entry[1]))
        .map(([kind, text], index) => ({
          id: kind,
          kind,
          tokens: estimateTokens(text),
          included: true,
          reason: kind === "shop" ? "only while a shop is open here" : "inside the game state, under its own floor",
          position: systemParts.length + 1 + index,
        })),
      {
        id: "history",
        kind: "history" as BlockKind,
        tokens: fitted.tokens,
        included: true,
        reason: fitted.dropped
          ? `kept ${fitted.kept.length} of ${rendered.length} messages; ${fitted.dropped} older dropped over the history budget`
          : `all ${fitted.kept.length} messages fit`,
        position: systemParts.length + 1,
      },
      ...(state.directorBlock
        ? [
            {
              id: "director",
              kind: "rules" as BlockKind,
              tokens: estimateTokens(state.directorBlock),
              included: true,
              reason: "one-turn steer armed by the lead",
              position: systemParts.length + 2,
            },
          ]
        : []),
      ...(toolTokens
        ? [
            {
              id: "tools",
              kind: "tools" as BlockKind,
              tokens: toolTokens,
              included: true,
              reason: "offered on every call; taken off the window before the blocks are packed",
              position: systemParts.length + 3,
            },
          ]
        : []),
    ],
  };

  return [
    { role: "system", content: systemParts.join("\n\n") },
    ...historyMessages,
    // Last, after the newest player line, so the model reads it closest to
    // the point of generation. Omitted entirely when nothing is armed.
    ...(state.directorBlock
      ? [{ role: "user" as const, content: state.directorBlock }]
      : []),
  ];
}


// A feat on the prompt: its name, the tag of what the server applies, the
// feat ODM knows it as when a content pack's feat has the same rules, and
// its rules text (ODM's own words, or the pack's) cut at a sentence near
// 360 characters. The model used to see the name alone, and a Level Up or
// Tome of Heroes feat meant nothing to it (issue #147).
function featPromptLine(feat: string, ownerUserId: string | string[] | undefined, campaignId?: string): string {
  const tag = featEngineTag(feat, campaignId);
  const twin = featTwinOf(feat, campaignId);
  const known = twin !== feat.trim().toLowerCase() ? ` (${twin.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}'s rules)` : "";
  const text = (featFactsFor(feat, ownerUserId)?.desc ?? "").replace(/\s+/g, " ").trim();
  const cut = text.length <= 360 ? text : `${text.slice(0, 360).replace(/\s+\S*$/, "")}...`;
  return `${feat}${known}${tag ? ` ${tag}` : ""}${cut ? `: ${cut}` : ""}`;
}
