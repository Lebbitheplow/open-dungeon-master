// Why this party is together, as the table tells it: the party backstory,
// one optional text written in the lobby (the lead may write it before
// anyone has a character, and the players once they have) and kept up
// during play. It can name the characters and tie their own backstories
// together. It lives on the party record (src/lib/dm/party-logic.ts) beside
// the purse and the marching order, because it is a fact about this group of
// characters, not a setting: a clone, whose seats start empty, does not
// carry it. What the table wants before the first scene, before any seat is
// filled, already has its place in the campaign creator: the premise.
//
// An empty backstory changes nothing: every builder below returns nothing
// for it, so a table that skips it sends the DM, the saga planner and the
// story-setup pass exactly what it sent before.
//
// Pure (no database, no model), so the prompt, the planner, the route and
// the lobby panel share one copy of the rules, and scripts/test-party-story.mjs
// can hold them.

// Shorter than a character's own (2000): enough to say how they met and what
// binds them, short enough to ride every turn's prompt for the whole party.
export const PARTY_BACKSTORY_MAX = 800;

export type PartyStory = { backstory: string };

// The text off a campaign, trimmed and clipped. Clipped here as well as at
// the door because the prompt is built from test fixtures too, and a long
// fixture should cost the prompt its tail rather than its budget.
export function partyStoryOf(campaign: { party?: { backstory?: string } | null }): PartyStory {
  return { backstory: String(campaign.party?.backstory ?? "").trim().slice(0, PARTY_BACKSTORY_MAX) };
}

// The DM's per-turn prompt: one line, right after the premise, in the part of
// the game state a turn rarely changes.
export function partyStoryPromptLines(story: PartyStory): string[] {
  return story.backstory
    ? [`Party backstory (the table's shared account of who these characters are to each other; treat it as true and let it surface in play): ${story.backstory}`]
    : [];
}

// The saga planner's block. Worded as a promise, like the party composition
// notes beside it, because a planner told only "here is some background"
// treats it as colour and plans around it.
export function partyStoryPlannerBlock(story: PartyStory): string {
  if (!story.backstory) {
    return "";
  }
  return `The party's shared story, written by the table; the plan must keep it true and pay it off (tie at least one beat, cast member, or event to it):\n- Their shared backstory: ${story.backstory}`;
}

// The one-time story-setup pass, which invents the premise and the secret
// outline: it reads the backstory so the premise it writes fits why these
// people are together. It never writes it; it is the table's to author.
export function partyStorySetupLines(story: PartyStory): string[] {
  return story.backstory ? [`Table's shared party backstory: ${story.backstory}`] : [];
}

// Who may write the shared backstory, with the latest save winning: the
// party lead, whoever holds a DM seat, and every player with a character
// seated here. It is the players' account of their own characters, so
// every one of them gets a pen, not only the lead; the lead keeps it for the
// moment nobody else has built a character yet, and a person running the
// game keeps it because the table's story is theirs to steer. A member
// with no character yet has nobody in it to speak for. Muting is checked by
// the route (requireVoice), as for every route that puts words in front of
// the table.
export function mayWritePartyBackstory(viewer: {
  isLead: boolean;
  holdsDmSeat: boolean;
  hasCharacter: boolean;
}): boolean {
  return viewer.isLead || viewer.holdsDmSeat || viewer.hasCharacter;
}

export const PARTY_BACKSTORY_REFUSAL =
  "Build a character at this table first: the party backstory is written by the players, the party lead and the DM.";

// ---- the draft button ----

export type DraftCharacter = {
  name: string;
  race: string;
  className: string;
  background: string;
  backstory: string;
};

export const PARTY_DRAFT_SYSTEM =
  "You write the shared backstory of a tabletop RPG party: how these particular characters came to travel together and what binds them. The players will edit it, so write a draft, not a verdict. Answer with the backstory itself and nothing else: no title, no preamble, no quotation marks, no options. Two short paragraphs at most, under 120 words. Name every character. Keep every fact their own backstories state, invent only what connects them, and leave each character room to keep their own secrets.";

// What the draft is asked from. Characters with no backstory still come with
// their build and background, which is something to tie together.
export function partyDraftRequest(input: {
  characters: DraftCharacter[];
  premise: string;
  setting: string;
  current: string;
}): string {
  const roster = input.characters
    .map(
      (character) =>
        `- ${character.name}: ${[character.race, character.className].filter(Boolean).join(" ")}${character.background ? `, ${character.background}` : ""}${character.backstory ? `\n  Their backstory: ${character.backstory}` : ""}`,
    )
    .join("\n");
  return [
    input.setting ? `Setting: ${input.setting}` : "",
    input.premise ? `Campaign premise: ${input.premise}` : "",
    `The characters:\n${roster}`,
    input.current ? `What the table has written so far, to build on rather than replace:\n${input.current}` : "",
    "Write the party's shared backstory.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// The model's answer, made fit for the textarea: no fences, no wrapping
// quotes, clipped to what the field holds.
export function cleanPartyDraft(raw: string): string {
  let text = raw.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  if (text.length > 1 && /^["“]/.test(text) && /["”]$/.test(text)) {
    text = text.slice(1, -1).trim();
  }
  if (text.length <= PARTY_BACKSTORY_MAX) {
    return text;
  }
  // Cut at the last sentence end that fits, so the draft never stops mid-word.
  const cut = text.slice(0, PARTY_BACKSTORY_MAX);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > PARTY_BACKSTORY_MAX / 2 ? cut.slice(0, end + 1) : cut.trimEnd();
}
