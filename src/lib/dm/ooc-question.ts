// Table talk put to the DM: an out-of-character line naming "@DM" ("@DM can
// I jump that gap?"). Table talk wakes no DM turn, so a question meant for
// the DM waited for the next move anyone made, though its answer is often
// what that move depends on. At a person's table a player says "DM, quick
// question" and gets a ruling at once; this is that.
//
// The AI answers out of character and nothing else: no tools, no time
// passing, no story moving (answerOutOfCharacter in src/lib/dm/turn.ts). The
// question and the answer stay in the transcript, so the ruling is in front
// of the DM on every later turn and is not contradicted.
//
// Pure, no "@/" imports, so a test loads it directly.

const OOC_PREFIX = "(ooc)";

// "@GM" (or "@DM", the older name players still type) as a word, anywhere in
// the line, any case.
const AT_DM = /(?:^|[\s(,;:])@[gd]m\b/i;

export function addressesDm(text: string): boolean {
  return AT_DM.test(text);
}

type Line = { authorType: string; content: string };

// The table note left when the answer could not be had. It is not a move,
// so asking again is still only a question.
export const OOC_UNANSWERED_PREFIX = "The Game Master could not answer that out of character";
// The same note as it was worded before the role was called the Game Master.
const LEGACY_OOC_UNANSWERED_PREFIX = "The Dungeon Master could not answer that out of character";

function isUnansweredNote(line: Line): boolean {
  return line.authorType === "system" && [OOC_UNANSWERED_PREFIX, LEGACY_OOC_UNANSWERED_PREFIX].some((prefix) => line.content.startsWith(prefix));
}

// Whether the turn about to run is only an answer to table talk put to the
// DM: everything since the DM last spoke is a player's out-of-character line,
// and one of them names the DM. Anything else since (a move, a table note
// from an End Turn, a roll's line) is a real turn, which answers the
// question with the rest. `heldMoves`: a spotlight still waits on other
// players, so the moves already in are held for the turn its last answer
// wakes, and a question among them is still only a question.
export function oocQuestionPending(history: readonly Line[], { heldMoves = false } = {}): boolean {
  let lastDm = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].authorType === "dm") {
      lastDm = index;
      break;
    }
  }
  const since = history
    .slice(lastDm + 1)
    .filter((line) => !isUnansweredNote(line));
  return (
    since.some((line) => line.authorType === "player" && line.content.startsWith(OOC_PREFIX) && addressesDm(line.content)) &&
    since.every((line) => line.authorType === "player" && (heldMoves || line.content.startsWith(OOC_PREFIX)))
  );
}

// A DM line that is story: anything the DM wrote but an out-of-character
// answer. "Since the DM last narrated" (the moves a turn answers, the newest
// passage a reroll may take, a join notice still unanswered) is counted from
// these, so a question answered in between changes none of it.
export function isNarration(line: Line): boolean {
  return line.authorType === "dm" && !isOocAnswer(line.content);
}

// The DM's answer is stored as table talk too, so the transcript, the prompt
// and the page all read it as an aside. A model that labels its own answer
// ("OOC: ...", seen from Codex) does not get the label twice.
export function oocAnswer(text: string): string {
  const answer = text.trim().replace(/^(?:\(ooc\)\s*)?(?:ooc\s*[:\-]\s*)?/i, "");
  return `${OOC_PREFIX} ${answer}`;
}

export function isOocAnswer(content: string): boolean {
  return content.startsWith(OOC_PREFIX);
}

export const OOC_ANSWER_INSTRUCTION =
  "[System] The newest table talk asks you, the GM, a question out of character. Answer it out of character, as a person running the table would: a ruling, a judgment call, what the characters can tell, how a rule applies here. Be brief, two or three sentences. Keep to what the players may know; never reveal a secret, a hidden motive or what lies ahead, and say so plainly if the answer is something their characters would have to find out. Do not narrate, move the story, pass time or resolve any action, and do not ask for rolls: if the answer depends on a roll, say which roll the player could ask for when they act.";
