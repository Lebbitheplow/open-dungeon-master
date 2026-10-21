import { z } from "zod";
import {
  CAMPAIGN_LENGTHS,
  COMPANION_SETTINGS,
  DICE_POLICIES,
  DM_MODES,
  GENRES,
  HP_METHODS,
  STARTING_WEALTH,
  TABLE_LANGUAGES,
} from "@/lib/schemas/game-settings-options";
import { parseKeepingValid } from "@/lib/schemas/parse-keeping-valid";

// The option lists and their labels live in ./game-settings-options (no
// zod) so the campaign wizard can draw them without the validator; the
// genres and the setting types are re-exported here, where the schema's
// readers find them.
export {
  GENRES,
  type CampaignLengthSetting,
  type DicePolicy,
  type DmModeSetting,
  type Genre,
  type TableLanguage,
} from "@/lib/schemas/game-settings-options";

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
  // The language the table plays in (game-settings-options.ts).
  tableLanguage: z.enum(TABLE_LANGUAGES).default("english"),
  // Selected pre-configured world (src/lib/worlds/packs), or "" for a plain
  // genre. Choosing a pack ALSO writes its baseGenre into `genre` above, so
  // every existing genre consumer keeps working and a pack that is later
  // removed from disk degrades silently back to its genre.
  worldPack: z.string().trim().max(50).default(""),
  aiStorySetup: z.boolean().default(true),
  campaignLength: z.enum(CAMPAIGN_LENGTHS).default("standard"),
  dicePolicy: z.enum(DICE_POLICIES).default("digital_only"),
  ttsEnabled: z.boolean().default(true),
  // Long enough for a custom voice: a blend ("af_heart(30)+af_bella(70)") or
  // a described one, on servers that take them (issue 89).
  ttsVoice: z.string().trim().max(120).default("af_heart"),
  // The narrator's pace, on the scale every speaker's voice uses
  // (src/lib/tts-segments.ts).
  ttsSpeed: z.number().min(0.7).max(1.4).default(1),
  // Character voices (issue 97). Off: only speakers someone chose a voice
  // for are heard in it. On: anyone who speaks without one is cast from the
  // server's voices the first time they do, and keeps that voice.
  ttsAutoCast: z.boolean().default(false),
  // Theatre inserts (docs/vtt-parity-implementation-plan.md 8.3): the
  // speaking NPC's portrait over the scene art while their lines play.
  presentation: z.enum(["plain", "theatre"]).default("plain"),
  // Several characters per player (docs/vtt-parity-implementation-plan.md
  // 11.3): off, one in play at a time (the others wait out fights), or
  // all of them fielded at once for a solo table running a whole party.
  multiCharacter: z.enum(["off", "one_active", "all_active"]).default("off"),
  // Safety tools (docs/vtt-parity-implementation-plan.md 9.1): the X-card,
  // lines the story never crosses, veils it cuts away from, and the
  // boundary that sets the stock tone limit and the picture negatives.
  safety: z
    .object({
      xCard: z.boolean().default(true),
      lines: z.array(z.string().trim().max(60)).max(12).default([]),
      veils: z.array(z.string().trim().max(60)).max(12).default([]),
      boundaries: z.enum(["family", "standard", "mature"]).default("standard"),
    })
    .default({ xCard: true, lines: [], veils: [], boundaries: "standard" }),
  // Strictness and tone (9.2): the DC ladder shift and the adjectives.
  gm: z
    .object({
      strictness: z.enum(["lenient", "standard", "harsh"]).default("standard"),
      tone: z.array(z.enum(["grim", "hopeful", "whimsical", "epic", "intimate", "pulpy", "eerie", "political"])).max(3).default([]),
    })
    .default({ strictness: "standard", tone: [] }),
  // The sound library (src/lib/ambience/catalog.ts). On by default and free
  // to leave on: a table with no audio files fetched hears nothing, because
  // the client only plays cues the server says are on disk.
  ambienceEnabled: z.boolean().default(true),
  // Whether the engine follows the scene on its own: a bed inferred from
  // each new place, battle music when initiative starts. Off leaves every
  // change to a deliberate set_ambience call, by the model or by a person.
  ambienceAuto: z.boolean().default(true),
  // Players may draw on the live board (a plan of attack, a circle round a
  // door); the DM always may (src/lib/battlemap/scene.ts drawings).
  boardDrawing: z.boolean().default(true),
  // The board shows what each enemy looks likely to do next: the DM's
  // declaration, else the engine's guess (src/lib/dm/intent.ts). Off drops
  // the projection entirely, so a client is never sent what it would hide.
  enemyIntent: z.boolean().default(true),
  mapsEnabled: z.boolean().default(true),
  // Whether characters may take levels in a second (or third) class at
  // level-up. On by default; turning it off keeps the level-up flow
  // single-class (already-multiclassed characters keep what they have).
  multiclassingEnabled: z.boolean().default(true),
  // How hit points are counted after 1st level, at creation and at every
  // level-up. The server derives the number (or rolls the die); a player
  // never types it. A table stored before the setting reads as "average".
  hpMethod: z.enum(HP_METHODS).default("average"),
  // What a new character starts with. "equipment" is the class's and the
  // background's gear with the background's coin; "rolled" is wealth the
  // server rolls by class, spent on gear at creation.
  startingWealth: z.enum(STARTING_WEALTH).default("equipment"),
  // The table's own rule for throwing the 4d6 ability dice again, for the
  // characters made at it (src/lib/srd/ability-rerolls.ts): a fresh six only
  // under this total, 0 never, 108 always. Null follows the server's rule
  // (Admin > Server), which the library uses.
  abilityRerollBelow: z.number().int().min(0).max(108).nullable().default(null),
  // Lets new players join with the invite code after the adventure started.
  midGameJoinOpen: z.boolean().default(false),
  // The living-world engines: off-screen world arcs advancing on background
  // dice, surprise/encounter sparks, and NPC goal simulation during
  // timeskips. Off preserves pre-engine behavior exactly.
  worldSimulation: z.boolean().default(true),
  // After each DM narration, block do and say for everyone until the party
  // lead opens responses. OOC and lead directions stay available.
  holdSubmissions: z.boolean().default(false),
  // Wait for the table (src/lib/dm/table-wait.ts): after a narration on an
  // open floor, the AI DM's next turn waits until every present player has
  // acted or passed, or waitForTableSeconds have passed since the latest
  // answer (each post or pass restarts the clock), then one turn reads them
  // all. On by default, as a person running the table waits for everyone:
  // a player alone at the table is answered at once (nobody else is present
  // to wait for), and the lead can set "Answers the first post" instead.
  waitForTable: z.boolean().default(true),
  waitForTableSeconds: z.number().int().min(15).max(900).default(300),
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
  companions: z.enum(COMPANION_SETTINGS).default("auto"),
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
  // The same offer step for a character's vitals: damage, healing and
  // conditions a DM tool call aims at a player character wait for the owning
  // player (or the lead) before they land. Covers the AI's turn and anything
  // a connected agent invokes, which is who the step is for; the engine's
  // own dice (an enemy's attack, a fall) are rules, not a judgment, and
  // apply as they always did. Off by default: it is a slower table.
  vitalsApprovals: z.boolean().default(false),
  // Cross-check the DM's finished narration against the tool outcomes the
  // turn actually resolved (a hit narrated on a miss, a death the hit points
  // deny, a damage figure no die produced), and spend one corrective model
  // call when the prose and the engine disagree (src/lib/dm/engine-boundary.ts).
  // On by default; off costs nothing but the check.
  narrationGuard: z.boolean().default(true),
  // How long the AI DM's narration runs, and the lead's own notes on how it
  // should write (issue #383): the model-agnostic way to fit a table's prose
  // to its model and its taste, where a per-model prompt would go stale.
  // Standard and blank change nothing in the prompt.
  narrationLength: z.enum(["short", "standard", "rich"]).default("standard"),
  styleNotes: z.string().trim().max(500).default(""),
  // How often the AI DM's world brings a fight (issue #432): the encounter
  // dice of the world tick (src/lib/dm/world-tick-logic.ts pacedTickConfig),
  // what an encounter spark asks for, and one pacing line in the prompt.
  // Balanced is the dice as they were and changes nothing in the prompt.
  combatPace: z.enum(["rare", "balanced", "frequent"]).default("balanced"),
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
      // Food and water (SRD 5.1): each dawn a character eats a ration and
      // drinks, and going without costs exhaustion. Off by default, as
      // ammunition is: the party is assumed supplied (src/lib/dm/supplies.ts).
      supplies: z.boolean().default(false),
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
      supplies: false,
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
      // Transcription (13.3): each speaker's microphone is cut into rings
      // and written down with their name. Off by default, and the lobby
      // says out loud when it is on.
      transcribe: z.boolean().default(false),
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
      transcribe: false,
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

export type CompanionMode = "full" | "guests" | "off";

// 'auto' resolves per table size: a solo player gets lasting party members, a
// multiplayer table gets only scene-scoped guest allies. Pure so the server
// (companion-tools) and the client panels resolve it identically.
// `partySize` is the number of PLAYERS, not the number of people at the table:
// a DM seat holds no party slot, so a lone player with a human DM still counts
// as one and still gets a full companion out of "auto".
// `humanDm`: the guests-only rule exists to stop an AI padding a multiplayer
// party with allies of its own. When a person runs the table there is no AI
// to pad anything, and a lasting ally the DM plays by hand is the only way
// for them to hold a character sheet at all, so "auto" gives them the full
// mode at any party size.
export function resolveCompanionMode(
  settings: GameSettings,
  partySize: number,
  humanDm = false,
): CompanionMode {
  const setting = settings.companions;
  if (setting === "off" || setting === "full" || setting === "guests") {
    return setting;
  }
  return partySize <= 1 || humanDm ? "full" : "guests";
}

// Whether the DM could still write an ally in: party members and scene guests
// have separate caps, so either kind having room is enough.
export function companionSlotsFree(
  settings: GameSettings,
  partySize: number,
  companionKinds: Array<"party" | "guest">,
  humanDm = false,
): boolean {
  const mode = resolveCompanionMode(settings, partySize, humanDm);
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

// Why a LASTING party companion cannot join this table right now, and how
// whoever runs the story can allow one; null when one can (issue 209). The
// handoff of a misfiled ally (companions/adopt) and the library's "Join the
// party" (companions/create) refuse with it, and the Party panel says it
// beside the handoff before anyone presses it. Auto is named for what it
// resolved to, since "not available" alone sent a lead hunting. Only the
// story's authority sees it: the same seat that may change the setting.
// `partyCompanions` counts lasting companions already seated (guests have a
// cap of their own).
export type LastingCompanionBlock = {
  code: "off" | "guests" | "auto-guests" | "full-roster";
  reason: string;
  remedy: string;
};

const ALLIES_ROW = "Settings tab, Table settings, Allies";
export const MAX_COMPANIONS_CAP = 4;

export function lastingCompanionBlock(
  settings: GameSettings,
  partySize: number,
  partyCompanions: number,
  humanDm = false,
): LastingCompanionBlock | null {
  const mode = resolveCompanionMode(settings, partySize, humanDm);
  const allow = `To allow one, set AI companions to "Party members and guests" (${ALLIES_ROW}). That setting lets the DM keep other lasting companions at this table too.`;
  if (mode === "off") {
    return { code: "off", reason: "AI companions is set to Off at this table, so no companion can join the party.", remedy: allow };
  }
  if (mode === "guests") {
    return settings.companions === "auto"
      ? {
          code: "auto-guests",
          reason:
            "AI companions is on Auto, and at a table the AI runs for several players Auto allows only temporary guests. A companion who travels with the party is a lasting one.",
          remedy: allow,
        }
      : {
          code: "guests",
          reason: 'AI companions is set to "Temporary guests only", which allows no lasting party companions.',
          remedy: allow,
        };
  }
  if (partyCompanions >= settings.maxCompanions) {
    const count = settings.maxCompanions;
    return {
      code: "full-roster",
      reason: `The party already has ${count} lasting ${count === 1 ? "companion" : "companions"}, the most this table allows.`,
      remedy:
        count < MAX_COMPANIONS_CAP
          ? `Raise "Most lasting party companions allowed at once" (${ALLIES_ROW}), or dismiss a companion first.`
          : "Dismiss a companion first.",
    };
  }
  return null;
}

export function normalizeGameSettings(raw: unknown): GameSettings {
  return parseKeepingValid(gameSettingsSchema, raw ?? {});
}
