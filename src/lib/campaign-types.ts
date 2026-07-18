export type SessionUser = {
  id: string;
  username: string;
  avatar?: { url: string } | null;
};

export type CampaignStatus = "lobby" | "active" | "ended";

export const CAMPAIGN_DIFFICULTIES = ["easy", "normal", "hard", "deadly"] as const;
export type CampaignDifficulty = (typeof CAMPAIGN_DIFFICULTIES)[number];

export type CampaignSummary = {
  id: string;
  title: string;
  description: string;
  status: CampaignStatus;
  inviteCode: string;
  maxPlayers: number;
  startingLevel: number;
  difficulty: CampaignDifficulty;
  theme: string;
  ownerUserId: string;
  // The player who steers the story and fixes stats when the AI DM errs.
  // Defaults to the owner; transferable.
  leadUserId: string;
  playerCount: number;
  role: "owner" | "player";
  createdAt: string;
  updatedAt: string;
};

// Marks system messages the party lead injected to steer the story; the DM
// prompt reframes them as authoritative table direction and the client
// styles them as a lead note.
export const LEAD_NOTE_PREFIX = "[Party lead direction] ";

// Marks the system message announcing a mid-game joiner's new character.
// The lead's "new adventurer" banner derives from it: shown until a DM
// message lands after it (the DM had its "next natural moment").
export const JOIN_NOTE_PREFIX = "[New adventurer] ";

// The latest join announcement the DM has not yet narrated past, if any.
// Pure so tests can drive it; seq comparison decides "answered".
export function latestUnintroducedJoin<
  T extends { authorType: string; content: string; seq: number },
>(messages: T[]): T | null {
  let joinNotice: T | null = null;
  for (const message of messages) {
    if (message.authorType === "system" && message.content.startsWith(JOIN_NOTE_PREFIX)) {
      joinNotice = message;
    }
  }
  if (!joinNotice) {
    return null;
  }
  const notice = joinNotice;
  return messages.some((message) => message.authorType === "dm" && message.seq > notice.seq)
    ? null
    : notice;
}

export type CampaignMember = {
  userId: string;
  username: string;
  avatar?: { url: string } | null;
  role: "owner" | "player";
  ready: boolean;
  useRealDice: boolean;
  joinedAt: string;
};
