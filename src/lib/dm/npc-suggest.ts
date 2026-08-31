import type { Campaign } from "@/lib/db/campaigns";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { cleanSuggestion, type GeneratableField } from "@/lib/npcs/forge";

// One field of one NPC, suggested by the model.
//
// This is the smallest possible unit of generation on purpose. A button that
// fills the whole form produces an NPC nobody wrote and nobody can argue
// with; a button per field means a DM can take the model's sense of what
// somebody wants and throw away its sense of who they are, which is what
// makes the forge interactive rather than automatic.
//
// It writes nothing and decides nothing. The suggestion goes back to the
// panel as text, the panel puts it in the draft, and the DM saves or does
// not. Same contract as the rest of the assist rail
// (src/lib/dm/assist.ts): every function returns something a person then
// decides about.
//
// The impure part is one model call. Everything about what the fields ARE
// lives in src/lib/npcs/forge.ts, which is pure and tested.

// One instruction per field, because "write a trait" and "write an ambition"
// want very different answers and a single prompt with a mode switch in it
// produces the average of both.
const FIELD_PROMPTS: Record<GeneratableField, string> = {
  trait:
    "Write ONE distinguishing detail a player would notice about this person in the first ten seconds: how they look, hold themselves, or speak. One sentence, under 20 words. No name, no backstory, no adjectives about their soul.",
  scene:
    "Write what this person wants RIGHT NOW, in the scene the party is about to walk into. One concrete, immediate thing, under 15 words. Not a life goal.",
  session:
    "Write what this person is working toward over the next few sessions. One concrete objective that could plausibly succeed or fail, under 20 words.",
  ambition:
    "Write this person's defining ambition: the thing they would give up everything else for. One sentence, under 25 words.",
  personality:
    "Describe this person by choosing from THIS LIST ONLY and nothing else. Pick two to four, optionally prefixed with 'very'. Answer as a bare comma-separated list with no other words.",
};

const SYSTEM =
  "You write one small piece of a non-player character for a tabletop RPG, for a Dungeon Master who will accept it or throw it away. Answer with the piece itself and nothing else: no preamble, no quotation marks, no explanation, no options to choose between. Concrete and specific beats evocative and vague every time.";

export type SuggestInput = {
  field: GeneratableField;
  name?: string;
  trait?: string;
  location?: string;
  attitude?: string;
  hint?: string;
  // The adjectives the personality axes are built from, so a personality
  // comes back in the vocabulary the forge can read.
  vocabulary: string;
};

export async function suggestNpcField(
  campaign: Campaign,
  input: SuggestInput,
): Promise<{ text: string; error?: string }> {
  // What the DM has already written. Handed over so the suggestion fits the
  // person on the screen; a field generated in a vacuum describes a stranger.
  const known = [
    input.name ? `Their name: ${input.name}` : "",
    input.trait && input.field !== "trait" ? `What stands out about them: ${input.trait}` : "",
    input.location ? `Where they are: ${input.location}` : "",
    input.attitude && input.attitude !== "indifferent"
      ? `How they feel about the party: ${input.attitude}`
      : "",
  ].filter(Boolean);

  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          `Setting: ${campaign.theme || campaign.gameSettings.genre.replace(/_/g, " ")}`,
          ...known,
          input.field === "personality" ? `The list: ${input.vocabulary}` : "",
          input.hint ? `The DM asks for: ${input.hint}` : "",
          FIELD_PROMPTS[input.field],
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    { timeoutMs: arcTextTimeoutMs() },
  );
  if (error) {
    return { text: "", error: "The model could not be reached." };
  }

  const text = cleanSuggestion(stripReasoningArtifacts(String(message?.content ?? "")));
  return text ? { text } : { text: "", error: "The model returned nothing usable." };
}
