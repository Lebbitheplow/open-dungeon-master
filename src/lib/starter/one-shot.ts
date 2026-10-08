import { createCampaign, setDmOutline, type Campaign } from "@/lib/db/campaigns";

// The starter one-shot: a table that opens in ten minutes for people who
// have never played. One evening, level 1, a village, a crypt, a twist.
// The premise below is what the players read; the outline is the DM's
// secret spine, written into the campaign's DM outline so the story-arc
// planner keeps to it (src/lib/dm/arc.ts reads dmOutline). The heroes are
// src/lib/starter/pregens.ts, picked from the lobby.

export const STARTER_ONE_SHOT = {
  id: "silent-bell",
  title: "The Silent Bell of Marrow's Crossing",
  tagline: "A one-evening adventure for newcomers, with ready-made heroes.",
  // What the players are told.
  description:
    "Marrow's Crossing is a river village of forty souls whose chapel bell has rung the hour for two hundred years. Three nights ago it stopped. The sexton has not been seen since, the ferry will not run after dark, and the village council will pay twenty gold a head to whoever finds out why. You arrive at dusk, as the fog comes off the water.",
  theme: "A fog-bound river village, a chapel on the hill, and the crypt beneath it",
  // The DM's secret spine. Short on purpose: a one-shot wants three beats
  // and a turn, not a saga.
  outline: [
    "ONE-SHOT, three beats, one evening. Keep scenes short, give the party a decision every few passages, and land the ending by the third beat. Level 1 throughout; no level-up.",
    "The truth: the sexton, Aldo Merrin, stole the chapel bell himself to pay a smuggler's debt. His brother-in-law Tam (the ferryman) helped him lower it into the flooded crypt under the chapel, meaning to sell it downriver. Aldo went back alone the next night to move it, disturbed the old dead, and was killed; he now walks the crypt as a ghoul. Tam is terrified, lying, and guilty.",
    "Beat 1, the village at dusk: the council's offer (Mother Hesk, sharp and tired), the empty sexton's cottage (a ledger with crossed-out debts and a smuggler's mark: a fish hook), Tam at the ferry who will not meet anyone's eye. A Persuasion or Insight success on Tam reveals the debt; a failure sends the party to the chapel with only the ledger. Reward curiosity, never block the path.",
    "Beat 2, the chapel and the crypt: the belfry's rope cut clean, drag marks to the crypt stair, the lower crypt knee-deep in black water. Threats, in order: a swarm of giant rats in the ossuary, a snare trap on the stair (DC 12 Perception to spot, 1d6 if sprung), then the ghoul that was Aldo in the bell chamber beside the bell. Four heroes at level 1 can take the ghoul; two or three should get the chance to lure it into the water or bar a door. Aldo still wears the sexton's key on a cord; the ghoul's paralysis is the danger to telegraph.",
    "Beat 3, the reckoning: the bell is found, the heroes decide what to say. If they expose Tam, the council banishes him and the ferry needs a new hand; if they cover for him, the bell rings again and the debt follows them downriver as a hook for another evening. Either way the bell is rung at dawn. Close with the sound carrying over the water, and ask each player what their hero does with twenty gold.",
    "Tone: Ravenloft-lite river gothic, fog and lamplight, no gore. NPC names: Mother Hesk (council), Tam Rill (ferryman), Aldo Merrin (sexton), Widow Pell (runs the inn, knows everyone's business, trades gossip for help with the stove).",
  ].join("\n\n"),
};

export function createStarterCampaign(userId: string, options: { solo: boolean }): Campaign {
  const campaign = createCampaign(userId, {
    title: STARTER_ONE_SHOT.title,
    description: STARTER_ONE_SHOT.description,
    theme: STARTER_ONE_SHOT.theme,
    maxPlayers: options.solo ? 1 : 5,
    startingLevel: 1,
    difficulty: "normal",
    gameSettings: {
      dmMode: "ai",
      genre: "high_fantasy",
      campaignLength: "short",
      // The premise is written; the setup pass still fills the world's
      // small print (places, faces) from it.
      aiStorySetup: true,
    },
  });
  setDmOutline(campaign.id, STARTER_ONE_SHOT.outline);
  return campaign;
}
