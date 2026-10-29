// A conversation in flight: someone in the scene spoke to the party in the
// last reply, and a player answered in words this turn. While it lasts the
// reply belongs to that exchange: the person answers what was asked, nothing
// cuts in (no fight, no arrival somewhere new, no director note), and the
// arc's open steps wait for a pause. A table asked an elder where the blight
// came from and got a monster through the door instead; that is what this
// stops. The story still moves on its own when play stalls (world-tick-logic.ts,
// the stall spark), never over somebody's question.
//
// Dependency-free so scripts/test-conversation.mjs imports it directly.

// What this module reads of a message and of its attributed lines
// (src/lib/db/messages.ts, src/lib/dm/speech.ts).
export type TalkSpeaker = { kind: string; id: string; name: string };
export type TalkMessage = {
  authorType: string;
  content: string;
  characterId?: string | null;
  speech?: ReadonlyArray<{ speaker: TalkSpeaker }>;
};

export type Conversation = {
  // Who spoke to the party last: a tracked NPC or an AI companion.
  with: string;
  // The characters whose players answered this turn, by name.
  answering: string[];
};

// Words said aloud or a question asked, in any table language: a quotation
// mark of any script, or a question mark.
const QUOTE_MARKS = /["“”„«»「」『』‹›]/u;
const QUESTION_MARKS = /[?？¿؟]/u;

export function spokenWords(text: string): boolean {
  return QUOTE_MARKS.test(text) || QUESTION_MARKS.test(text);
}

// The conversation the newest player lines continue, or null. `history` is
// oldest first; `companionIds` are the AI companions' sheet ids (a companion
// speaks as a `pc`, and is someone the party talks with); `names` maps a
// player's character id to the name the note gives them.
export function conversationInFlight(input: {
  history: readonly TalkMessage[];
  inEncounter: boolean;
  companionIds: ReadonlySet<string>;
  names: ReadonlyMap<string, string>;
}): Conversation | null {
  if (input.inEncounter) {
    return null;
  }
  let lastDm = -1;
  for (let index = input.history.length - 1; index >= 0; index -= 1) {
    if (input.history[index].authorType === "dm") {
      lastDm = index;
      break;
    }
  }
  if (lastDm < 0) {
    return null;
  }
  const lines = input.history.slice(lastDm + 1).filter((message) => message.authorType === "player");
  if (!lines.some((message) => spokenWords(message.content))) {
    return null;
  }
  const voices = (input.history[lastDm].speech ?? [])
    .map((line) => line.speaker)
    .filter((speaker) => speaker.kind === "npc" || (speaker.kind === "pc" && input.companionIds.has(speaker.id)));
  const last = voices.at(-1);
  if (!last?.name) {
    return null;
  }
  const answering = [
    ...new Set(lines.map((message) => input.names.get(message.characterId ?? "") ?? "").filter(Boolean)),
  ];
  return { with: last.name, answering };
}

// The GAME STATE line for it.
export function conversationNote(conversation: Conversation): string {
  const who = conversation.answering.length ? conversation.answering.join(" and ") : "A player";
  const verb = conversation.answering.length > 1 ? "are" : "is";
  const other = conversation.with;
  // Said plainly that telling is no check: a note asking for "something the
  // party did not know" had both local models roll History for an elder's
  // memory and Persuasion for a companion asked to come along.
  return (
    `IN CONVERSATION: ${who} ${verb} talking with ${other}, who spoke last. ` +
    `This reply is ${other}'s answer, in their own voice: what they know, think or will do, said plainly. ` +
    `What ${other} knows, thinks or will do is not a check: roll only for a player's own attempt, such as swaying someone unwilling or reading a lie. ` +
    `No fight starts and nobody arrives somewhere new in this reply unless the players' own words make it happen; if they set out, end on the way there. ` +
    `The arc's open waypoints wait for a pause in the talk.`
  );
}
