import { clamp, text, type Raw } from "@/lib/homebrew/coerce";

// A sentient magic item (SRD 5.1, Sentient Magic Items): Intelligence,
// Wisdom and Charisma, an alignment, how it communicates, what it senses, a
// special purpose and a personality. "Sentient magic items function as NPCs
// under the GM's control": the engine carries the block onto the sheet of
// whoever holds the item and puts it in front of the DM
// (src/lib/dm/equipment-line.ts), with the rule for a conflict, a Charisma
// contest between the item and its wielder, for the DM to call.

export const SENTIENT_COMMUNICATION = ["emotion", "speech", "telepathy"] as const;
export type SentientCommunication = (typeof SENTIENT_COMMUNICATION)[number];

export type Sentience = {
  int: number;
  wis: number;
  cha: number;
  alignment: string;
  communication: SentientCommunication;
  senses: string;
  purpose: string;
  personality: string;
};

export function normalizeSentience(raw: unknown): Sentience | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const source = raw as Raw;
  const communication = SENTIENT_COMMUNICATION.find((entry) => entry === source.communication) ?? "emotion";
  return {
    int: clamp(source.int, 1, 30, 10),
    wis: clamp(source.wis, 1, 30, 10),
    cha: clamp(source.cha, 1, 30, 10),
    alignment: text(source.alignment, 40),
    communication,
    senses: text(source.senses, 120) || "hearing and normal vision out to 30 feet",
    purpose: text(source.purpose, 200),
    personality: text(source.personality, 400),
  };
}

const modifier = (score: number) => Math.floor((score - 10) / 2);
const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

// One line for the DM: what the item is, and how a conflict with its
// wielder is settled.
export function sentienceLine(sentience: Sentience): string {
  const talks =
    sentience.communication === "telepathy"
      ? "speaks telepathically"
      : sentience.communication === "speech"
        ? "speaks aloud"
        : "shares its emotions";
  return [
    `sentient: Int ${sentience.int}, Wis ${sentience.wis}, Cha ${sentience.cha}`,
    sentience.alignment,
    talks,
    `senses ${sentience.senses}`,
    sentience.purpose ? `purpose: ${sentience.purpose}` : "",
    sentience.personality ? sentience.personality : "",
    `it is an NPC you run; when its will and its wielder's conflict, a Charisma contest (the item ${signed(modifier(sentience.cha))})`,
  ]
    .filter(Boolean)
    .join("; ");
}
