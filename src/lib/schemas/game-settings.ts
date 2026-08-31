import { z } from "zod";

export const GENRES = [
  "high_fantasy",
  "dark_fantasy",
  "mystery",
  "horror",
  "cyberpunk",
  "steampunk",
  "post_apocalyptic",
  "custom",
] as const;
export type Genre = (typeof GENRES)[number];

export const DICE_POLICIES = ["digital_only", "real_allowed"] as const;
export type DicePolicy = (typeof DICE_POLICIES)[number];

// Who narrates. Mirrors DmMode in src/lib/dm/viewer.ts, which holds the pure
// rules about what each seat may see and do; this is the stored setting.
export const DM_MODES = ["ai", "human", "assisted"] as const;
export type DmModeSetting = (typeof DM_MODES)[number];

export const DM_MODE_LABELS: Record<DmModeSetting, string> = {
  ai: "AI Dungeon Master",
  human: "I run the game",
  assisted: "I run the game, with AI help",
};

export const DM_MODE_HINTS: Record<DmModeSetting, string> = {
  ai: "The AI narrates, adjudicates and runs the world. The party lead steers it.",
  human: "You narrate. The server still enforces every rule and rolls every die.",
  assisted: "You own the story; hand the AI the monsters, the prose, or a stretch of turns.",
};

// How far the secret story saga is planned: how many acts the arc spans and
// how many bosses/threads it seeds. Read when a saga is generated (activation,
// lead regenerate, the v2 upgrade pass, and each sequel saga), so changing it
// mid-campaign applies when the next saga is planned.
export const CAMPAIGN_LENGTHS = ["short", "standard", "epic"] as const;
export type CampaignLengthSetting = (typeof CAMPAIGN_LENGTHS)[number];

// Game-facing campaign settings. Stored in campaigns.game_settings_json,
// separate from settings_json (the model/image StorySettings) so the two
// never fight over shape.
export const gameSettingsSchema = z.object({
  // Who runs the game. "ai" is the original behavior and the default.
  // "human" silences the AI narrator entirely: player actions queue for the
  // DM instead of waking a turn. "assisted" keeps the AI available for the
  // parts the DM delegates. The seat itself (which member is the DM) lives
  // on the campaign row; this is only the mode.
  dmMode: z.enum(DM_MODES).default("ai"),
  // What "assisted" actually hands over, one capability at a time. Read
  // through delegated() in src/lib/dm/delegation.ts, which ignores all three
  // outside assisted mode, so a table that switches to "human" gets a silent
  // DM back without having to untick anything. All three start on: a DM who
  // chose the middle setting asked for the help, and each one is still opt-in
  // at the moment of use (a beat is expanded only when they tick the box, the
  // AI covers only when they hand it over).
  dmAssist: z
    .object({
      monsters: z.boolean().default(true),
      narration: z.boolean().default(true),
      cover: z.boolean().default(true),
    })
    .default({ monsters: true, narration: true, cover: true }),
  genre: z.enum(GENRES).default("high_fantasy"),
  customGenreText: z.string().trim().max(500).default(""),
  // Selected pre-configured world (src/lib/worlds/packs), or "" for a plain
  // genre. Choosing a pack ALSO writes its baseGenre into `genre` above, so
  // every existing genre consumer keeps working and a pack that is later
  // removed from disk degrades silently back to its genre.
  worldPack: z.string().trim().max(50).default(""),
  aiStorySetup: z.boolean().default(true),
  campaignLength: z.enum(CAMPAIGN_LENGTHS).default("standard"),
  dicePolicy: z.enum(DICE_POLICIES).default("digital_only"),
  ttsEnabled: z.boolean().default(true),
  ttsVoice: z.string().trim().max(40).default("af_heart"),
  // The sound library (src/lib/ambience/catalog.ts). On by default and free
  // to leave on: a table with no audio files fetched hears nothing, because
  // the client only plays cues the server says are on disk.
  ambienceEnabled: z.boolean().default(true),
  // Whether the engine follows the scene on its own: a bed inferred from
  // each new place, battle music when initiative starts. Off leaves every
  // change to a deliberate set_ambience call, by the model or by a person.
  ambienceAuto: z.boolean().default(true),
  mapsEnabled: z.boolean().default(true),
  // Whether characters may take levels in a second (or third) class at
  // level-up. On by default; turning it off keeps the level-up flow
  // single-class (already-multiclassed characters keep what they have).
  multiclassingEnabled: z.boolean().default(true),
  // Lets new players join with the invite code after the adventure started.
  midGameJoinOpen: z.boolean().default(false),
  // The living-world engines: off-screen world arcs advancing on background
  // dice, surprise/encounter sparks, and NPC goal simulation during
  // timeskips. Off preserves pre-engine behavior exactly.
  worldSimulation: z.boolean().default(true),
  // After each DM narration, block do and say for everyone until the party
  // lead opens responses. OOC and lead directions stay available.
  holdSubmissions: z.boolean().default(false),
  // Human-DM story capture: how much play may pass with nothing written down
  // before the console nudges the DM to record a beat. Two units because a
  // session has two tempos (src/lib/dm/beat-cadence.ts); either one at 0 turns
  // that half of the nudge off, and both at 0 turns it off entirely. Ignored
  // in AI mode, where the narration is typed by definition.
  beatReminder: z
    .object({
      messages: z.number().int().min(0).max(100).default(10),
      rolls: z.number().int().min(0).max(100).default(12),
    })
    .default({ messages: 10, rolls: 12 }),
  // AI companions the DM can write into the story. 'full' allows lasting
  // party members plus scene-scoped guest allies; 'guests' allows only the
  // temporary allies (a soldier helping for one battle) so the AI never
  // fabricates campaign-long members; 'off' disables both. 'auto' resolves
  // to full for solo campaigns and guests for multiplayer ones.
  companions: z.enum(["auto", "full", "guests", "off"]).default("auto"),
  // Lasting party companions allowed at once. Scene-scoped guests have their
  // own cap so a temporary ally never eats a party slot.
  maxCompanions: z.number().int().min(1).max(4).default(2),
  maxGuests: z.number().int().min(1).max(4).default(2),
  // Server-tracked standing between each character and each NPC or AI
  // companion: one approval meter from hostility to devotion, plus a memory
  // of the beats that got them there (src/lib/dm/relationship-logic.ts).
  // 'off' removes the tools and the prompt rules entirely.
  relationships: z.enum(["on", "off"]).default("on"),
  // The romance ladder layered on top of the approval meter (interested,
  // courting, together, betrothed, married). Requires relationships to be
  // on. Intimate scenes always fade to black; there is no explicit mode.
  romance: z.enum(["on", "off"]).default("on"),
  // When on, DM-initiated item and gold changes to player characters become
  // pending offers the owning player accepts or declines instead of applying
  // immediately (src/lib/dm/proposal-logic.ts). Off preserves auto-apply.
  inventoryApprovals: z.boolean().default(false),
  // Cross-check the DM's finished narration against the tool outcomes the
  // turn actually resolved (a hit narrated on a miss, a death the hit points
  // deny, a damage figure no die produced), and spend one corrective model
  // call when the prose and the engine disagree (src/lib/dm/engine-boundary.ts).
  // On by default; off costs nothing but the check.
  narrationGuard: z.boolean().default(true),
  // Optional 5e variant rules the server engines and DM prompt honor.
  // Rendered as one line each in the prompt by src/lib/dm/rules-logic.ts.
  // Optional turn stages (src/lib/dm/stages.ts). All default on; this exists
  // so an operator on a small local model can trade quality for speed
  // deliberately, and the panel labels which ones actually save a model call.
  stages: z
    .object({
      compaction: z.boolean().default(true),
      recall: z.boolean().default(true),
      retrieval: z.boolean().default(true),
      chapterSummary: z.boolean().default(true),
    })
    .default({ compaction: true, recall: true, retrieval: true, chapterSummary: true }),
  // Workshop only (docs/workshop-plan.md): the party a DM is building prep
  // for, before any character sheet exists. The encounter calculator, the
  // odds panel and the map studio all read it instead of a live roster. A
  // playing campaign has real sheets and ignores this entirely, which is why
  // it can live here rather than in a workshop-only column.
  targetParty: z
    .object({
      size: z.number().int().min(1).max(8).default(4),
      level: z.number().int().min(1).max(20).default(3),
    })
    .default({ size: 4, level: 3 }),
  variantRules: z
    .object({
      flanking: z.boolean().default(false),
      criticalFumbles: z.boolean().default(false),
      // Variant: Encumbrance (PHB 176). Off by default because the default
      // rule is a ceiling nobody hits; on, the server weighs every pack
      // (src/lib/srd/encumbrance.ts) and slows the overloaded.
      encumbrance: z.boolean().default(false),
      lingeringInjuries: z.boolean().default(false),
      // Powerful Critical (DMG p.264): the extra critical dice are maximized
      // rather than rolled. Critical Damage Mods: flat modifiers double on a
      // crit too, not just the dice. Both are enforced server-side.
      powerfulCritical: z.boolean().default(false),
      criticalDamageMods: z.boolean().default(false),
      // Ammunition tracking: arrows, bolts and bullets are spent on a shot
      // and recovered after the fight. Off by default because most tables
      // assume quivers are full; on, the server counts them.
      ammunition: z.boolean().default(false),
      restVariant: z.enum(["standard", "gritty", "heroic"]).default("standard"),
    })
    .default({
      flanking: false,
      criticalFumbles: false,
      encumbrance: false,
      lingeringInjuries: false,
      powerfulCritical: false,
      criticalDamageMods: false,
      ammunition: false,
      restVariant: "standard",
    }),
  // Live voice chat. `enabled` is the table's own switch; the server also has
  // one (VOICE_ENABLED in src/lib/voice/config.ts) for owners who cannot open
  // the media port, and the stricter of the two wins.
  //
  // `rules` shapes who hears whom. Every entry is a toggle held by whoever
  // passes requireStoryAuthority, because "players only hear people within 30
  // feet" is one table's house rule, not a law, and the next table will want a
  // different one. They are all inputs to one function
  // (src/lib/voice/audibility.ts) rather than separate features.
  voice: z
    .object({
      enabled: z.boolean().default(true),
      // How hard the floor (open / hold / spotlight / initiative) is enforced
      // on microphones. "soft" shows whose turn it is without muting anyone,
      // and is the default because hard-muting a friend mid-sentence is an
      // aggressive thing to do to a game night. "strict" pauses the producer
      // server-side, so the mute is real rather than a greyed-out button.
      // Rules live in src/lib/voice/turn-logic.ts.
      turnEnforcement: z.enum(["off", "soft", "strict"]).default("soft"),
      rules: z
        .object({
          // Distance gates hearing, using the battle map's own geometry.
          // Off by default: it is a strong effect and a table that has not
          // asked for it would experience it as broken audio.
          proximity: z.boolean().default(false),
          // How far a normal speaking voice carries, in feet. Only consulted
          // when proximity is on. 30 is a conversational distance in 5e terms.
          hearingRangeFeet: z.number().int().min(5).max(500).default(30),
          // Lets a speaker pick whisper (5ft) / normal / shout (120ft).
          sayRange: z.boolean().default(false),
          // A wall on the line costs attenuation rather than blocking, so a
          // conversation through a door is muffled instead of silent.
          wallsAttenuate: z.boolean().default(false),
          // A character at 0 HP stops hearing the table.
          downedGoDeaf: z.boolean().default(false),
        })
        .default({
          proximity: false,
          hearingRangeFeet: 30,
          sayRange: false,
          wallsAttenuate: false,
          downedGoDeaf: false,
        }),
    })
    .default({
      enabled: true,
      turnEnforcement: "soft",
      rules: {
        proximity: false,
        hearingRangeFeet: 30,
        sayRange: false,
        wallsAttenuate: false,
        downedGoDeaf: false,
      },
    }),
});

export type GameSettings = z.infer<typeof gameSettingsSchema>;

// Shared by the create dialog and the lobby settings panel.
export const CAMPAIGN_LENGTH_LABELS: Record<CampaignLengthSetting, string> = {
  short: "Short (3 acts, a focused adventure)",
  standard: "Standard (4-5 acts)",
  epic: "Epic (6-8 acts, a sprawling saga)",
};

export const COMPANION_LABELS: Record<GameSettings["companions"], string> = {
  auto: "Auto (solo: full; multiplayer: guests only)",
  full: "Party members and guests",
  guests: "Temporary guests only",
  off: "Off",
};

export type CompanionMode = "full" | "guests" | "off";

// 'auto' resolves per table size: a solo player gets lasting party members, a
// multiplayer table gets only scene-scoped guest allies. Pure so the server
// (companion-tools) and the client panels resolve it identically.
export function resolveCompanionMode(
  settings: GameSettings,
  memberCount: number,
): CompanionMode {
  const setting = settings.companions;
  if (setting === "off" || setting === "full" || setting === "guests") {
    return setting;
  }
  return memberCount <= 1 ? "full" : "guests";
}

// Whether the DM could still write an ally in: party members and scene guests
// have separate caps, so either kind having room is enough.
export function companionSlotsFree(
  settings: GameSettings,
  memberCount: number,
  companionKinds: Array<"party" | "guest">,
): boolean {
  const mode = resolveCompanionMode(settings, memberCount);
  if (mode === "off") {
    return false;
  }
  const guests = companionKinds.filter((kind) => kind === "guest").length;
  if (guests < settings.maxGuests) {
    return true;
  }
  const party = companionKinds.length - guests;
  return mode === "full" && party < settings.maxCompanions;
}

export function normalizeGameSettings(raw: unknown): GameSettings {
  const parsed = gameSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : gameSettingsSchema.parse({});
}
