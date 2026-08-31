// Client-safe voice types. Kept apart from src/lib/voice/peers.ts so a browser
// bundle can import the shape of a roster without dragging in mediasoup.

// What a client is told about everyone on the call. Deliberately not the peer
// itself: transports, producers and consumers are server-side handles and none
// of them should ever be serialized to a browser.
export type VoiceRosterEntry = {
  userId: string;
  username: string;
  channelId: string;
  muted: boolean;
  // Silenced by the floor rather than by choice, under strict turn
  // enforcement. Shown differently from a self-mute: one is your decision.
  forceMuted: boolean;
  // When they asked for the floor, or null.
  handRaisedAt: string | null;
  // whisper / normal / shout, when the say-range rule is on.
  sayRange: "whisper" | "normal" | "shout";
  // False between joining and the mic actually being published, which is the
  // window where a browser is still showing its permission prompt.
  producing: boolean;
  joinedAt: string;
};

export type VoiceChannelView = {
  id: string;
  name: string;
};
