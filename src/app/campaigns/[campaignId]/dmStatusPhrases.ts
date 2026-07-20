import type { DmStatus } from "./useCampaignStream";

// 6+ variants per active DM status. The first entry in each pool is the
// original string (unchanged), so the current voice is preserved and simply
// joined by atmospheric and lightly comedic alternates. One is chosen at
// random per status transition (see useDmStatusPhrase in MessageList.tsx).
export const DM_STATUS_PHRASES: Record<Exclude<DmStatus, "idle">, string[]> = {
  thinking: [
    "The DM weighs the outcome…",
    "The DM consults the whims of fate…",
    "Somewhere, a d20 holds its breath…",
    "The DM strokes an imaginary beard…",
    "The DM ponders your fate…",
    "Buffering vibes…",
    "Rolling a Wisdom check to make good decisions…",
  ],
  rolling: [
    "The dice clatter across the table…",
    "The dice tumble into the dark…",
    "Bones are cast…",
    "Fate rattles in the cup…",
    "The dice go bouncing off the pizza box…",
    "Yeeting the dice…",
    "Praying to the RNG gods…",
  ],
  awaiting_rolls: [
    "The table waits on real dice…",
    "Grab your dice, the table waits…",
    "The DM taps the table, waiting on a roll…",
    "The party holds its breath for a roll…",
    "Real dice required, no pressure…",
    "Someone find the d20 that rolled under the couch…",
  ],
  narrating: [
    "The next passage is forming…",
    "The story draws its next breath…",
    "The tale continues to unspool…",
    "Words gather at the edge of the page…",
    "The DM finds the next words…",
    "The scene shimmers into focus…",
  ],
  writing_chapter: [
    "The DM writes the chapter into the record…",
    "Ink meets parchment…",
    "The chronicle gains another page…",
    "The scribe dips the quill…",
    "The DM seals the chapter with wax…",
    "This tale is committed to the annals…",
  ],
  plotting_arc: [
    "The DM plots the road ahead…",
    "The DM unrolls a suspiciously large map…",
    "Threads of destiny are being tied…",
    "Storm clouds gather on the horizon…",
    "The DM adds another red string to the murder board…",
    "The DM plots something you'll regret…",
  ],
};
