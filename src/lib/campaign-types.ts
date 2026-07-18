export type SessionUser = {
  id: string;
  username: string;
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
  playerCount: number;
  role: "owner" | "player";
  createdAt: string;
  updatedAt: string;
};

export type CampaignMember = {
  userId: string;
  username: string;
  role: "owner" | "player";
  ready: boolean;
  useRealDice: boolean;
  joinedAt: string;
};
