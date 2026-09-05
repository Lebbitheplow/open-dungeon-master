import type { CampaignKind } from "@/lib/workshop/kind";

export type SessionUser = {
  id: string;
  username: string;
  avatar?: { url: string } | null;
  isAdmin?: boolean;
  mustChangePassword?: boolean;
  // Set while the account is scheduled for deletion; the header banner
  // offers to keep it until then.
  deletionDueAt?: string | null;
};

export type CampaignStatus = "lobby" | "active" | "ended";

export const CAMPAIGN_DIFFICULTIES = ["easy", "normal", "hard", "deadly"] as const;
export type CampaignDifficulty = (typeof CAMPAIGN_DIFFICULTIES)[number];

export type CampaignSummary = {
  id: string;
  title: string;
  description: string;
  // 'campaign' plays; 'workshop' is a DM's prep space that reuses the same
  // row and the same content tables but never runs a turn. The rules live in
  // src/lib/workshop/kind.ts.
  kind: CampaignKind;
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
  // Human-DM mode: the member running the game, and an optional co-DM.
  // Null on both means the AI runs it. What each seat may see and do is
  // decided in src/lib/dm/viewer.ts, never by comparing ids at a call site.
  dmUserId: string | null;
  assistantDmUserId: string | null;
  playerCount: number;
  role: "owner" | "player";
  // Cover art for the campaign tile and hero: an uploaded or painted image
  // under /uploads/, or null for the themed placeholder
  // (src/components/CampaignCover.tsx). On the summary rather than the full
  // campaign because the home screen and the shells list it without opening
  // the table.
  cover: CampaignCover | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignCover = { id: string; url: string };

// What a player is doing when they hit send. Shared by the composer and the
// routes on purpose: this used to live in Composer.tsx while the actions
// route re-declared its own narrower enum, so the two could drift, and a
// mode the server did not recognise fell through to "do" silently.
//
// "lead" is labelled "Direct" in the UI and posts to /lead-note; everything
// else posts to /actions.
//
// Asking the DM a question is deliberately NOT in here. It is not a composer
// mode: it lives entirely in the Ask strip above the composer, which posts to
// /ask itself (src/app/campaigns/[campaignId]/AskPanel.tsx). Adding "ask"
// back would put a second Ask entry point in the same column as the first.
// "narrate" is the DM seat's only authoring mode and posts to /dm/narrate.
// It is in this union so the composer stays one component, and it can never
// reach /actions because that route validates against its own narrower enum.
export const INPUT_KINDS = ["do", "say", "ooc", "lead", "narrate"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

// The modes that do not consume the floor: table talk and lead directions
// work during a hold, a spotlight, another player's initiative turn, and
// while the DM is narrating. Asking is exempt too, but it never routes
// through here because it is not an InputKind.
// The DM is never subject to the floor they control, so "narrate" joins the
// exempt set alongside table talk and lead directions.
export const FLOOR_EXEMPT_KINDS: readonly InputKind[] = ["ooc", "lead", "narrate"];

export function isFloorExempt(kind: InputKind): boolean {
  return FLOOR_EXEMPT_KINDS.includes(kind);
}

// Marks system messages the party lead injected to steer the story; the DM
// prompt reframes them as authoritative table direction and the client
// styles them as a lead note.
export const LEAD_NOTE_PREFIX = "[Party lead direction] ";

// Marks the system message a halted DM turn writes. The client pairs it with
// the message's dmTurnId to offer the lead a retry of that exact turn.
export const DM_HALTED_PREFIX = "The DM ran into a problem: ";

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
  // Muted by the party lead: reads along, cannot act, ask or side-chat.
  muted: boolean;
  joinedAt: string;
};
