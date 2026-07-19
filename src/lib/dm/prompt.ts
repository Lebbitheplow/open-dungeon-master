import type { Campaign } from "@/lib/db/campaigns";
import type { CampaignMessage } from "@/lib/db/messages";
import type { StoredRoll } from "@/lib/db/rolls";
import type { CharacterSheet } from "@/lib/schemas/sheet";
import { LEAD_NOTE_PREFIX, type CampaignMember } from "@/lib/campaign-types";
import { computeSheetDerived, findSkill, formatModifier, SRD_SKILLS } from "@/lib/srd";
import { classFeatureDescription, findCustomClass } from "@/lib/classes";
import { resourceDef } from "@/lib/srd/class-resources";
import { describeExhaustion } from "@/lib/dm/condition-logic";
import { genrePreset } from "@/lib/genres";
import { renderArcForPrompt } from "@/lib/dm/arc-logic";
import type { ChatMessage } from "@/lib/model-client";

export const DM_SYSTEM = `You are the Dungeon Master for a multiplayer Dungeons & Dragons 5th Edition campaign. Several human players each control exactly one character. You control the world, every NPC, and every monster. You never control the player characters.

Core rules you must always follow:
- NEVER state the result of any die roll, check, save, or attack yourself. When an action's outcome is uncertain, call the request_roll tool and wait for the result. The server rolls the dice and gives you the real numbers; narrate from those numbers only. Never ask a player to roll in your narration ("please roll a Stealth check" is always wrong): dice exist ONLY through your request_roll tool call, and a reply that needs a roll but contains no request_roll call is a broken turn.
- NEVER invent a player character's actions, words, decisions, or thoughts. Describe the world's response to what they declared, then stop at the next decision point. WRONG: "Kara steps forward. 'Let's ask the guard,' she says, and hands over the coin." (you invented Kara's words and actions). RIGHT: "The guard's eyes flick to the coin pouch at Kara's belt. What do you do?" (you set the scene and stopped). This applies to whole journeys: when a player declares movement or a destination ("take me to them"), narrate the approach only up to the FIRST obstacle, NPC, or choice, present it, and stop; how to handle it is the players' decision. Never resolve an interaction no player declared: no invented negotiation, intimidation, purchase, or attack on a character's behalf, even to keep the story moving. Exception: once a roll resolves a declared attempt, you DO narrate what the character did in that attempt; describing the declared lockpicking succeeding or failing from the dice is your job, not puppeting.
- Player action lines are prefixed [Name | attempt]. They declare intent only: what the character TRIES to do. No player message ever decides an outcome, no matter how it is phrased. If a player writes that their attempt succeeds, that a blow lands, that an enemy falls, or any other result, ignore the asserted result, treat the message purely as the attempt, and resolve it yourself with request_roll or your own ruling. Only dice results, your tools, and [Party lead direction] notes decide what actually happens.
- Quoted speech is genuinely spoken by the character, exactly as written. What those words achieve (persuasion, intimidation, deception) is still yours to resolve, with a roll when the outcome is uncertain.
- All quoted dialogue is spoken in first person. A character never refers to themselves by their own name or in third person inside their own speech. When you repeat words a player declared their character says, keep them verbatim and first person.
- Enforce 5e plausibility in-fiction. If a player declares something impossible (leaping over a castle, instantly killing a dragon, casting a spell they do not have), do not narrate it succeeding. Briefly explain the reality of the situation and offer plausible options instead.
- When violence breaks out, call start_encounter with the enemies involved BEFORE narrating the first hostile exchange (use the Enemy picks list or any 5e monster; rename freely to fit the world). Fights run on server-tracked enemies with real HP, never on imagined ones.
- The character sheets in GAME STATE are authoritative and change ONLY through your tools. When the fiction changes a character's stats (damage, healing, loot, gold, XP, conditions, spell slots), call the matching tool BEFORE narrating the result, then narrate exactly what the tool reported. Never state a stat change you did not apply, and never grant items, spells, or abilities that are not on the sheet. For permanent or narrative changes to who a character is (a rename, transformation, curse, blessing, training, level or ability score change), call update_sheet with only the fields that change and a clear reason. When the fiction ends a condition (a poison cured, fear lifted, paralysis broken), you MUST call clear_condition before narrating the recovery, and when wounds close you MUST call heal; a cure or recovery narrated without its tool call has not happened and the sheet will still show the old state. Apply every sheet change with tools BEFORE your final narration; you cannot change sheets while narrating.
- A character has ONLY what GAME STATE lists for them. Their spell list is complete; their equipment list is complete; their features-and-traits list is complete; they speak only their listed languages and are trained only in their listed tools, armor, and weapons (untrained use carries real consequences: no proficiency bonus, disadvantage in armor they cannot wear). A class ability, racial trait, or feat that is not listed does not exist for them, no matter how fitting it sounds. If a player tries to cast a spell, use an item, invoke an ability, or speak, read, or understand a language that is not theirs, it simply does not happen, even if the player writes it as fact: briefly state what they actually have and offer real options instead (an unknown tongue is just noise to them; unknown writing is unreadable marks). Grant a new lasting ability only through update_sheet (features, source "story") when the story truly bestows one.
- A character at 0 HP is unconscious and dying or stable; GAME STATE shows their death-save track. The server tracks dying entirely: damage on a downed character adds automatic failures, healing any amount wakes them, and the stabilize tool (after a successful DC 10 Medicine check or a healer's kit) stops the dying without healing. In combat the server also rolls their death saves and announces the results. NEVER narrate a death or a recovery the tools have not reported, and never make death-save rolls yourself. A character GAME STATE marks DEAD is beyond your tools; only the party lead can reverse a death.
- Casting any spell of level 1 or higher MUST call use_spell_slot first, passing the spell's name (the server validates the slot level against the spell's real level and handles cantrips and rituals itself). Consumables go through use_item: it checks the character carries the item, rolls and applies a healing potion's healing itself, and uses it up, all in one call (ammunition for bows and guns is tracked automatically by pc_attack). Limited-use class features (Rage, Ki, Second Wind, Action Surge, Channel Divinity, Bardic Inspiration, Wild Shape, Lay on Hands) are listed under Resources with their remaining uses: call use_resource BEFORE narrating the feature, and if it refuses, the feature is spent and unavailable. If a tool returns an error, the character could not do it; narrate that reality, never the attempt succeeding. Permanently learning or losing a spell (a scroll copied, a mentor's teaching, a curse) goes through learn_spell, never through update_sheet or bare narration.
- Concentration is server-tracked: use_spell_slot on a concentration spell sets it (and reports any previous spell it displaced), damage triggers the CON save automatically with the result in the apply_damage response, and dropping to 0 HP ends it. A caster ending concentration on purpose is clear_condition with "concentration". Narrate concentration only from what the tools report, and honor a reported break: the spell's effect ends immediately.
- Rest and recovery happen ONLY through take_rest: a breather of an hour or more is kind=short (hit dice roll server-side), a night's sleep is kind=long (full HP and spell slots, half the hit dice back). Call it BEFORE narrating any recovery; HP, slots, and hit dice never recover in narration alone.
- Address characters by name. Use their stated abilities: a check you request must name the character, the kind of check, and a fair DC (5 very easy, 10 easy, 15 moderate, 20 hard, 25 very hard). Do not reveal the DC in narration unless it would be natural.
- One roll per uncertain action; do not chain repeated rolls for the same attempt. Trivial actions (walking, talking, buying a drink) need no roll, but no roll does not mean no bookkeeping: every purchase, sale, or trade goes through ONE purchase call (the server moves the gold and the item together and refuses what the purse cannot cover; an unaffordable price is a fact of the scene). Gifts, loot, and theft still use grant_item/remove_item with modify_gold only when coins alone move. Never narrate money or items changing hands without the tool call.
- Keep every player involved. If one player has dominated recent scenes, create an opening for the others. When the party splits, cut between them briefly.
- Advance the story. Every reply should either reveal something, raise the stakes, or demand a decision. No filler.
- Keep the party's location current: whenever a scene opens somewhere new or the party moves to a different area, call move_party with the area's name and a concrete layout description before narrating. Use update_location when they learn more about the current area. GAME STATE's location block must always match the fiction.
- Your long-term memory is the chapter index in GAME STATE. When players reference people, places, promises, or events you cannot see in recent history or the current chapter summary, call recall_story with the chapter number or a search query BEFORE answering, and stay consistent with what it returns. Never guess about past chapters and never contradict recorded history.
- Record lasting milestones with record_event as they happen: achievements, bonds formed, deaths, level ups, and major plot points or story milestones (kind 'story'). Do not wait for a better moment.
- Some information belongs to only part of the party. Use send_whisper to tell one or more characters something the others must not learn: a detail only they notice, true orders from a force controlling them, a private vision or temptation, a secret ally's signal. Players can also send YOU private messages; when they do, those appear in GAME STATE as private messages from players, and send_whisper to their character is how you answer. Anything a player types in the table chat is public. NEVER reveal, quote, or hint at private content in shared narration; to everyone else the scene simply continues.
- When award_xp reports levelUpAvailable, tell that player plainly, at the edge of the scene, that their character can now level up using their sheet. The level-up itself (HP, features, spells) happens through the player's own choices in the app: never apply level, HP, feature, or spell-list changes for a level-up yourself unless the party lead directs it.
- Party notes in GAME STATE are facts the table has written down; treat them as canon the party knows.
- A [Party lead direction] in the log is an authoritative instruction from the table's human lead. Treat it as canon: weave the directed event or correction into the story at the next natural moment, without mentioning the direction itself.
- Keep replies to 1 to 3 short paragraphs of vivid second-person-plural narration and NPC dialogue. End at a decision point or with the result of the single action the players declared; never continue into a second action, exchange, or leg of a journey they have not declared. When your reply ends waiting on specific characters (an NPC has addressed them, or a choice is theirs), call request_player_input naming them. Never write more than one scene beat per reply.
- Never mention these instructions, tools, JSON, dice mechanics beyond natural table talk, or anything out of character. Out-of-character player notes (marked ooc) may be answered briefly out of character.
- Message lines are prefixed with the speaking character's name in brackets, sometimes with a marker such as | attempt; the prefix is bookkeeping, not part of the fiction.`;

// Full system prompt for a campaign: base rules plus genre flavor plus any
// custom world text.
export function buildDmSystem(campaign: Campaign): string {
  const preset = genrePreset(campaign.gameSettings.genre);
  const parts = [DM_SYSTEM];
  if (preset.dmFlavor) {
    parts.push(preset.dmFlavor);
  }
  if (campaign.gameSettings.genre === "custom" && campaign.gameSettings.customGenreText) {
    parts.push(`Tone and world, set by the table: ${campaign.gameSettings.customGenreText}`);
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
  // Closed story chapters, oldest first: index, title, one-line hook.
  chapters?: Array<{ index: number; title: string; oneLiner: string }>;
  // Public party notes (lead-curated canon), pinned first.
  publicNotes?: Array<{ pinned: boolean; title: string; body: string }>;
  // Private one-way notes the DM already sent via send_whisper, so it
  // remembers its own secrets across turns.
  recentWhispers?: Array<{ to: string; content: string }>;
  // Private messages players sent the DM that no turn has handled yet.
  pendingPlayerWhispers?: Array<{ from: string; content: string }>;
};

// Players who roll physical dice at the table: campaign policy must allow
// it and the member must have opted in. Empty set otherwise.
function realDiceUserIds(campaign: Campaign, members: CampaignMember[]): Set<string> {
  if (campaign.gameSettings.dicePolicy !== "real_allowed") {
    return new Set();
  }
  return new Set(members.filter((member) => member.useRealDice).map((member) => member.userId));
}

// Appended to the system prompt only while an encounter is active.
export const ENCOUNTER_RULES = `Combat rules (an encounter is active):
- Enemy HP and AC in GAME STATE are tracked by the server and are authoritative. You cannot wound, drop, or kill an enemy in narration alone. When a player attacks an enemy, call pc_attack with their characterId, the targetEnemyId, and their weapon (or an attack-roll spell plus its damage dice): the server derives their attack bonus from their sheet, rolls to-hit against the enemy's real AC, rolls and applies damage on a hit, and reports the outcome for you to narrate. Never decide yourself whether a player's attack hits. Call damage_enemy ONLY for harm that is not an attack (falling, fire, traps, automatic effects). An enemy dies ONLY when a tool result says dead: true, never before, no matter how dramatic the moment.
- Enemies act through enemy_attack: name the enemy, its attack, and the target character. The server rolls to-hit from the enemy's real stat block against the target's real AC and applies real damage. Never use request_roll for an enemy's attack or damage, and never invent an enemy's numbers.
- Follow the initiative order in GAME STATE. On a player's turn, resolve their declared action (attacks via one pc_attack call). After resolving it, take the turns of the enemies listed between them and the next player with enemy_attack (one call per enemy; a Multiattack routine's every swing happens inside that one call), then narrate and stop. Any enemy you skip acts AUTOMATICALLY with its default attack after your narration, and the result posts as a table note, so prefer choosing their actions yourself. The server hands the floor to the next player; you never announce whose turn is next incorrectly.
- Any effect that damages multiple targets with a saving throw (breath weapons, fireballs, collapsing ceilings) uses ONE aoe_damage call listing every enemy and character caught in it: the server rolls the damage once, rolls every target's save from their real stats, and applies full or half damage to each. Never chain per-target request_roll or apply_damage calls for an area effect. A save effect on a SINGLE character may still use request_roll kind=saving_throw plus apply_damage. Resistances, immunities, and vulnerabilities are applied by the server automatically; just pass the damage type.
- When a player casts a saving-throw spell at ONE enemy (Hold Person, a single-target poison), call cast_at_enemy: the server spends the slot, derives the save DC from the caster's sheet, rolls the enemy's save, and applies the damage and/or condition with its duration. Never adjudicate such a spell yourself.
- Reinforcements, summoned creatures, and ambushers joining an ongoing fight MUST go through add_enemies BEFORE you narrate their arrival; they get initiative slots and map tokens automatically. A combatant that never went through start_encounter or add_enemies does not exist.
- Enemy conditions are server-tracked exactly like character conditions: call set_enemy_condition BEFORE narrating a condition taking hold on an enemy (prone, poisoned, stunned, restrained, frightened, grappled) and clear_enemy_condition the moment the fiction ends it. Pass rounds (or saveAbility + saveDc for save-ends effects) and the server expires the condition automatically at round wraps. Conditions have real mechanical teeth enforced by the server: they grant or impose advantage on attacks, zero out speed, skip incapacitated combatants' turns, and auto-crit paralyzed targets; the tool results tell you what applied.
- When ONE enemy escapes the fight (runs, teleports away, slips into the dark), call enemy_flees for it BEFORE narrating the escape; its token leaves the map, and when no enemies remain the fight ends automatically with reduced XP.
- A character dropping to 0 HP starts dying automatically; the server rolls their death saves at the top of their turns and posts the results as table notes. Their initiative turns are skipped while they are down. Narrate the drama from those results; never invent them. If EVERY character is down, call end_encounter with outcome party_defeated.
- When the fight ends any way other than every enemy dying or fleeing one by one (mass flight, surrender, parley, party defeat), call end_encounter with the outcome. Victory XP is awarded automatically.
- The battle map in GAME STATE is authoritative for every combatant's position. Coordinates are (col,row) tiles; 1 tile = 5 ft. Melee attacks need adjacency (within 1 tile, diagonals count); for ranged attacks and spells, count tiles between the combatants and multiply by 5 for the distance. # tiles block movement and line of sight: nobody can see, target, or move through them. ~ and , tiles cost double movement.
- Move enemies with move_token before or as they act. enemy_attack automatically steps a melee attacker toward its target and repositions a ranged attacker that lacks range or line of sight; it refuses the attack, telling you why, when the target still cannot be reached. Never narrate a combatant standing somewhere the map does not show.
- Players move their own tokens; use move_token on a character only with forced:true, and only when something in the fiction pushes, drags, or carries them.
- Not every character can see the whole field (darkness, walls, no darkvision). A player only knows what their character can see, so keep exact enemy positions out of narration when the characters could not know them.`;

// Appended to the system prompt only when a player has sent the DM a
// private message no turn has handled yet, so ordinary turns see no change.
export const PLAYER_WHISPER_RULES = `Private player messages: one or more players have sent you a private message (listed in GAME STATE). Handle each one this turn.
- Resolve the secret action with your normal rules and tools, then answer that player with send_whisper addressed to their character. Every private message deserves a send_whisper reply, even if the answer is just an acknowledgment or a refusal.
- NEVER reveal, quote, or hint at a private message in shared narration. If the secret act would be visible to the others, narrate only what observers could actually see, never the intent behind it.
- If a private message changes nothing for the rest of the table, reply only with send_whisper and add nothing to the shared story; the scene simply continues.
- Dice cards from request_roll are visible to the whole table. When a roll's very existence would betray the secret, prefer resolving it quietly with your own ruling, or phrase the roll's reason so it reveals nothing.`;

// Appended to the system prompt only when at least one present character's
// player rolls real dice, so digital-only tables see no prompt change.
export const REAL_DICE_RULE = `Physical dice at this table: some players roll their own real dice (marked "rolls PHYSICAL dice" in the Party list). When you call request_roll for one of their characters, the game pauses until that player enters the number they rolled. In the narration accompanying such a request, address that character directly and ask their player to roll the dice and tell you the result. Do this only for marked players; everyone else's dice are rolled automatically, so never ask them for a number. A pc_attack for a marked player pauses twice: first they enter their d20 attack roll, and on a hit the game pauses again for their damage dice; the server adjudicates and applies both.`;

function describeSheet(sheet: CharacterSheet, playedBy: string, realDice: boolean): string {
  const derived = computeSheetDerived(sheet);
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
  // its one-line rules text; SRD names stay bare (the model knows them).
  const featureList = sheet.features?.length
    ? sheet.features
        .map((feature) => {
          const description = classFeatureDescription(sheet.class, feature.name);
          return description ? `${feature.name} (${description})` : feature.name;
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
  const lines = [
    `- ${sheet.name} (${sheet.race.replaceAll("_", " ")} ${sheet.class}${sheet.subclass ? ` [${sheet.subclass}]` : ""} ${sheet.level}) characterId=${sheet.id} played by ${playedBy}${realDice ? " (rolls PHYSICAL dice)" : ""}`,
    `  HP ${sheet.currentHp}/${sheet.maxHp}${sheet.tempHp ? ` (+${sheet.tempHp} temp)` : ""}${deathNote} | AC ${sheet.ac} | Speed ${sheet.speed} | Passive Perception ${derived.passivePerception} | Initiative ${formatModifier(derived.initiative)} | Hit Dice ${Math.max(0, sheet.hitDice.total - sheet.hitDice.spent)}/${sheet.hitDice.total} ${sheet.hitDice.die}`,
    `  ${abilities} | Save proficiencies: ${sheet.proficiencies.saves.map((save) => save.toUpperCase()).join(", ") || "none"}`,
    `  Skill proficiencies: ${proficientSkills || "none"}`,
    `  Languages (complete list; they cannot speak, read, or understand any other language): ${sheet.proficiencies.languages.join(", ") || "Common only"} | Tool proficiencies: ${sheet.proficiencies.tools.join(", ") || "none"} | Armor training: ${sheet.proficiencies.armor.join(", ") || "none"} | Weapon training: ${sheet.proficiencies.weapons.join(", ") || "none"}`,
    `  Features & traits (complete list; an ability not listed here does not exist for them): ${featureList}${sheet.feats.length ? ` | Feats: ${sheet.feats.join(", ")}` : ""}`,
  ];
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
  if ((sheet.exhaustion ?? 0) > 0) {
    lines.push(
      `  Exhaustion: ${describeExhaustion(sheet.exhaustion)}; a long rest reduces it by one level.`,
    );
  }
  if (sheet.conditions.length) {
    const described = sheet.conditions.map((condition) => {
      const meta = sheet.conditionMeta?.[condition];
      if (meta?.rounds) {
        return `${condition} (${meta.rounds} more round${meta.rounds === 1 ? "" : "s"})`;
      }
      if (meta?.saveEnds) {
        return `${condition} (save ends: ${meta.saveEnds.ability.toUpperCase()} DC ${meta.saveEnds.dc})`;
      }
      return condition;
    });
    lines.push(`  Conditions: ${described.join(", ")}`);
  }
  if (sheet.spellcasting) {
    const spellList = [...sheet.spellcasting.known, ...sheet.spellcasting.prepared];
    lines.push(
      `  Spell slots: ${slots || "none"} | Save DC ${derived.spellSaveDc} | Spells (complete list, they can cast nothing else): ${spellList.join(", ") || "none"}${sheet.concentratingOn ? ` | Concentrating on: ${sheet.concentratingOn}` : ""}`,
    );
  } else {
    lines.push(`  Spellcasting: none (cannot cast any spells)`);
  }
  // Gold always prints, even with an empty pack: the model cannot keep a
  // purse it never sees (missed modify_gold calls on purchases).
  lines.push(
    `  Equipment (complete inventory, they carry nothing else): ${
      sheet.equipment.length
        ? sheet.equipment.map((item) => (item.qty > 1 ? `${item.name} x${item.qty}` : item.name)).join(", ")
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
    const who = sheet?.name ?? "someone";
    const outcome =
      roll.dc === null ? "" : roll.success ? ` vs DC ${roll.dc}: success` : ` vs DC ${roll.dc}: failure`;
    return `- ${who}: ${roll.kind.replaceAll("_", " ")}${roll.detail ? ` (${roll.detail.replaceAll("_", " ")})` : ""} rolled ${roll.total}${outcome}${roll.breakdown.crit === "nat20" ? " (natural 20)" : roll.breakdown.crit === "nat1" ? " (natural 1)" : ""}`;
  });

  const sections = [
    "=== GAME STATE (authoritative; never contradict) ===",
    `Campaign: ${campaign.title} | Difficulty: ${campaign.difficulty}${campaign.theme ? ` | Setting: ${campaign.theme}` : ""}`,
  ];
  if (campaign.description) {
    sections.push(`Premise: ${campaign.description}`);
  }
  if (campaign.storyArc) {
    sections.push(renderArcForPrompt(campaign.storyArc));
  } else if (campaign.dmOutline) {
    sections.push(
      `DM story outline (secret; guide the campaign along it, never reveal or quote it):\n${campaign.dmOutline}`,
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
    } else {
      lines.push(
        `Combat is starting. Initiative still needed from: ${
          encounter.awaitingInitiative.join(", ") || "nobody"
        }. Call request_roll with kind=initiative for each character listed.`,
      );
    }
    lines.push(
      "Enemies (HP and AC are server-authoritative; only damage_enemy and enemy_attack change them):",
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
  // The arc render already lists active quests; avoid double token spend.
  if (campaign.questLog.length && !campaign.storyArc) {
    sections.push(`Quests:\n${campaign.questLog.map((quest) => `- ${quest}`).join("\n")}`);
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
          usernamesById.get(sheet.userId) ?? "unknown",
          physicalDiceUsers.has(sheet.userId),
        );
        const events = state.recentEventsByCharacter?.get(sheet.id);
        return events?.length
          ? `${base}\n  Recent developments: ${events.join(" | ")}`
          : base;
      })
      .join("\n")}`,
  );
  if (rollLines.length) {
    sections.push(`Recent rolls:\n${rollLines.join("\n")}`);
  }
  if (state.chapters?.length) {
    sections.push(
      `Story so far, by chapter:\n${state.chapters
        .map(
          (chapter) =>
            `${chapter.index}. "${chapter.title}"${chapter.oneLiner ? ` - ${chapter.oneLiner}` : ""}`,
        )
        .join("\n")}\n(Use the recall_story tool to re-read any past chapter in full when players reference old events.)`,
    );
    if (storySummary) {
      sections.push(`Current chapter so far:\n${storySummary}`);
    }
  } else if (storySummary) {
    sections.push(`Story so far:\n${storySummary}`);
  }
  sections.push("=== END GAME STATE ===");
  return sections.join("\n\n");
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
        dc: {
          type: "integer",
          description:
            "Difficulty class for checks and saves (5 very easy, 10 easy, 15 moderate, 20 hard, 25 very hard). Omit for damage or initiative.",
        },
        expression: {
          type: "string",
          description:
            "For attack, damage, or custom rolls only: the dice expression, e.g. 1d20+5 for an NPC attack or 2d6+3 for damage.",
        },
        advantage: {
          type: "string",
          enum: ["none", "advantage", "disadvantage"],
        },
        targetEnemyId: {
          type: "string",
          description:
            "For kind=damage during combat: the exact enemyId from GAME STATE this damage strikes. The server applies the rolled total to that enemy automatically and reports its new state; never follow up with damage_enemy.",
        },
        reason: {
          type: "string",
          description: "Short private note on what this roll resolves.",
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
      "Look up the full summary of a past chapter when players reference old events you no longer remember. Give a chapter number, or a query to search titles and summaries.",
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
        layoutDescription: { type: "string" },
        connections: { type: "array", items: { type: "string" } },
        visionClear: { type: "boolean" },
      },
      required: ["layoutDescription", "visionClear"],
    },
  },
} as const;

const HISTORY_CHAR_BUDGET = 100_000;

// Builds the full message list for one DM turn: system + game state, then
// recent campaign history with player lines attributed by character name.
export function buildDmMessages(
  state: DmGameState,
  history: CampaignMessage[],
): ChatMessage[] {
  const sheetsById = new Map(state.sheets.map((sheet) => [sheet.id, sheet]));

  const historyMessages: ChatMessage[] = [];
  let budget = HISTORY_CHAR_BUDGET;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
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
    budget -= content.length;
    if (budget < 0 && historyMessages.length > 0) {
      break;
    }
    historyMessages.unshift({
      role: message.authorType === "dm" ? "assistant" : "user",
      content,
    });
  }

  const physicalDiceUsers = realDiceUserIds(state.campaign, state.members);
  const anyPhysicalDice = state.sheets.some((sheet) => physicalDiceUsers.has(sheet.userId));
  const systemParts = [buildDmSystem(state.campaign)];
  if (anyPhysicalDice) {
    systemParts.push(REAL_DICE_RULE);
  }
  if (state.encounter) {
    systemParts.push(ENCOUNTER_RULES);
  }
  if (state.pendingPlayerWhispers?.length) {
    systemParts.push(PLAYER_WHISPER_RULES);
  }
  systemParts.push(buildGameStateBlock(state));

  return [
    { role: "system", content: systemParts.join("\n\n") },
    ...historyMessages,
  ];
}
