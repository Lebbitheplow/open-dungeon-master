// Who may be sent each kind of campaign event.
//
// The stream used to deliver by default and hold back a short list; a new
// event type reached every seat until someone noticed what it carried
// (0.24.5's record of the DM's hidden token was found that way). This table
// is the other way round: an event type is delivered to nobody until it is
// written down here with its audience, and scripts/test-event-audience.mjs
// fails the build when a publish call names a type the table does not,
// so the question "who sees this?" is asked when the event is born.
//
// A spoiler is the one mistake a table cannot undo. Once a secret reaches a
// seat's device it is read, whatever the screen hides, by a curious player
// or by the agent they connected; so what a seat may not read is never sent
// to it, rather than sent and hidden.
//
//   table   every member is sent the stored payload as it is.
//   dm      only seats holding the named right are sent it; others nothing.
//   seat    each seat is sent its own projection (src/lib/table-delivery.ts):
//           a sheet with or without its notes, a roll with or without its
//           number, an effect with or without the real damage, the DM's
//           cover with or without the brief.
//
// Ephemeral events (no seq, never replayed) are in the same table: the
// fan-out is the same door.

export type SeatRight = "fullMap" | "secretStory" | "enemyNumbers";

export type Audience =
  | { kind: "table" }
  | { kind: "dm"; right: SeatRight }
  | { kind: "seat" };

const TABLE: Audience = { kind: "table" };
const SEAT: Audience = { kind: "seat" };

export const EVENT_AUDIENCE: Readonly<Record<string, Audience>> = {
  // ---- per seat: the payload differs by who reads it ----
  // The owner and the DM seats are sent the notes; everyone else the sheet without them.
  sheet_updated: SEAT,
  // A public roll to all; a blind roll to all without its number; a roll for the DM
  // or for one player to those seats alone, with the number, and to nobody else.
  roll_result: SEAT,
  // An effect on an enemy carries the real damage only to seats allowed real numbers.
  fx: SEAT,
  // Every seat learns the DM stepped out; the brief handed to the AI stays with
  // the seats that hold the story's secrets.
  dm_cover_changed: SEAT,

  // ---- the DM seats alone ----
  // The record of the DM's hands on the board names hidden pieces.
  dm_board_action: { kind: "dm", right: "fullMap" },

  // ---- the whole table ----
  // Narration and the transcript.
  message_added: TABLE,
  message_updated: TABLE,
  dm_delta: TABLE,
  dm_draft_seq: TABLE,
  dm_status: TABLE,
  dm_intent_queued: TABLE,
  dm_seat_changed: TABLE,
  utility_calls: TABLE,
  beat_recorded: TABLE,
  // Chapters and the arc: pings and player-safe chapter records; the arc's
  // secrets are read back through routes that answer per seat.
  arc_updated: TABLE,
  chapter_updated: TABLE,
  chapter_closed: TABLE,
  campaign_rewound: TABLE,
  campaign_updated: TABLE,
  // The fight: the public encounter projection, the floor, the board ping
  // (the board itself is fetched per seat), rolls that wait on someone.
  encounter_updated: TABLE,
  encounter_summary: TABLE,
  floor_changed: TABLE,
  battle_map_updated: TABLE,
  roll_pending: TABLE,
  map_ping: TABLE,
  camera: TABLE,
  effects_updated: TABLE,
  mounts_updated: TABLE,
  // Characters: deletions, audit deltas (the pre-image stays server-side),
  // level-ups, the party roster, coins moving, a relationship's record.
  sheet_deleted: TABLE,
  sheet_audit: TABLE,
  audit_reverted: TABLE,
  level_up_available: TABLE,
  party_updated: TABLE,
  roster_updated: TABLE,
  coins: TABLE,
  character_event: TABLE,
  relationships_updated: TABLE,
  attributes_updated: TABLE,
  // Offers and trades are party knowledge.
  item_proposal_added: TABLE,
  item_proposal_resolved: TABLE,
  // A disputed ruling and its outcome: who objected and to what is the
  // table's business, and the vote is the table's.
  ruling_disputed: TABLE,
  ruling_resolved: TABLE,
  shops_updated: TABLE,
  // Notes: public active notes travel; private ones never do (notes route).
  note_updated: TABLE,
  note_suggested: TABLE,
  note_deleted: TABLE,
  // Pings that make a seat refetch what it may read.
  facts_updated: TABLE,
  quests_updated: TABLE,
  lore_updated: TABLE,
  factions_updated: TABLE,
  // The table's WorldForge changed (src/lib/worldforge/model.ts). The ping
  // carries nothing, but the document is the DM's, so only DM seats refetch.
  world_updated: { kind: "dm", right: "secretStory" },
  pins_updated: TABLE,
  npc_updated: TABLE,
  location_updated: TABLE,
  location_map_ready: TABLE,
  calendar_updated: TABLE,
  schedule_updated: TABLE,
  clock_changed: TABLE,
  whisper_activity: TABLE,
  side_activity: TABLE,
  ask_activity: TABLE,
  transcript_updated: TABLE,
  // The director's arm is published already redacted.
  director_armed: TABLE,
  // Members and seats.
  member_joined: TABLE,
  member_ready: TABLE,
  member_updated: TABLE,
  // Scene furniture: what the DM chose to show everyone.
  scene_state: TABLE,
  scene_tracker: TABLE,
  title_card: TABLE,
  handout_shown: TABLE,
  handout_dismissed: TABLE,
  cast_updated: TABLE,
  // Safety: the X-card is for everyone by definition.
  x_card: TABLE,
  safety_resumed: TABLE,
  // Media and sound.
  image_ready: TABLE,
  media_status: TABLE,
  tts_stream: TABLE,
  tts_ready: TABLE,
  ambience_changed: TABLE,
  ambience_sting: TABLE,
  // Voice: who is on the call and who is speaking; signals carry no story.
  voice_roster: TABLE,
  voice_speaking: TABLE,
  voice_audibility_changed: TABLE,
  voice_mesh_signal: TABLE,
  // Presence and the heartbeat are not game events, but they pass the same door.
  presence: TABLE,
  ping: TABLE,
};

// The audience of a type, or null for one the table never declared: such an
// event is delivered to nobody and logged, which is the point.
export function audienceOf(type: string): Audience | null {
  return Object.prototype.hasOwnProperty.call(EVENT_AUDIENCE, type) ? EVENT_AUDIENCE[type] : null;
}

export function isDeclaredEvent(type: string): boolean {
  return audienceOf(type) !== null;
}
