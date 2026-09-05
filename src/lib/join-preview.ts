// What an invite link may reveal before anyone has signed in.
//
// The join page shows the campaign a link points at so a guest knows what
// they are taking a seat in. Nobody holding the page has a session yet, so
// this projection is deliberately thin: no member names, no premise, no
// invite code echoed back, nothing a stranger who guessed a code could use
// beyond "this table exists and looks like this". Pure so the route and the
// test agree on the exact shape.
import type { Campaign } from "@/lib/db/campaigns";
import { genrePreset } from "@/lib/genres";

export type JoinPreview = {
  title: string;
  status: Campaign["status"];
  playerCount: number;
  maxPlayers: number;
  startingLevel: number;
  genre: string;
  cover: { url: string } | null;
  // False when the table is already playing and the lead has not opened
  // mid-game joining, so the page can say so before the sign-up form.
  seatOpen: boolean;
};

export function joinPreviewFor(campaign: Campaign): JoinPreview {
  const seatOpen =
    campaign.status === "lobby" ||
    (campaign.status === "active" && campaign.gameSettings.midGameJoinOpen);
  return {
    title: campaign.title,
    status: campaign.status,
    playerCount: campaign.playerCount,
    maxPlayers: campaign.maxPlayers,
    startingLevel: campaign.startingLevel,
    genre: genrePreset(campaign.gameSettings.genre).name,
    cover: campaign.cover ? { url: campaign.cover.url } : null,
    seatOpen,
  };
}
