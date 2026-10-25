import { admitSheet } from "@/lib/characters/admit";
import { buildDraft, draftOffered, draftOptionNames, type BuiltDraft } from "@/lib/characters/pregen-drafts";
import { storyConfigured, storytellerConfigured } from "@/lib/capabilities";
import type { Campaign } from "@/lib/db/campaigns";
import { createDraftedPregens, type LibraryCharacter } from "@/lib/db/characters";
import { listLocations } from "@/lib/db/locations";
import { listNpcs } from "@/lib/db/npcs";
import { listBeats } from "@/lib/db/workshop-beats";
import { requestDmMessage } from "@/lib/dm/model";
import { packClassIds } from "@/lib/dm/companion-tools";
import { draftReplyTokens, draftSystemPrompt, draftUserPrompt, parseDraftReply, type DraftAdventure } from "@/lib/dm/pregen-draft-logic";
import { withLanguage } from "@/lib/dm/table-language-logic";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { stripReasoningArtifacts } from "@/lib/story-prompt";

// "Draft pregens": the AI DM reads the workshop and proposes a party, the
// quick-build engine builds each hero (src/lib/characters/pregen-drafts.ts),
// the library's door judges each sheet as it judges any library character
// (admitSheet), and only when every one of them passes are they stored,
// together, as the workshop's pregens: unticked, so nothing reaches a
// player until the DM ticks "Offer to players", and marked as drafted until
// the DM edits them. A failed call, a reply that is not the shape asked for,
// or a hero the rules refuse stores nothing at all.
//
// The story model rather than the utility one, as for the party backstory
// draft (src/lib/dm/party-draft.ts): names and backstories are prose the
// players read.

export const NO_AI_DRAFT_REASON =
  "No AI DM is set up on this server, so it cannot draft pregens. Set up a text model in Admin, or build the pregens yourself.";

export async function draftReadiness(workshop: Campaign): Promise<{ ready: boolean; reason: string }> {
  const ready = storyConfigured(workshop.settings) || (await storytellerConfigured());
  return ready ? { ready, reason: "" } : { ready, reason: NO_AI_DRAFT_REASON };
}

// What the workshop holds, for the prompt: its premise, its setting, the
// storyboard's hooks and places, and its cast. Secrets stay out: a
// backstory the players read must not spoil one.
export function adventureOf(workshop: Campaign): DraftAdventure {
  const beats = listBeats(workshop.id);
  const setting = [workshop.theme, workshop.gameSettings.genre.replace(/_/g, " ")].map((part) => String(part ?? "").trim()).filter(Boolean);
  return {
    title: workshop.title,
    premise: workshop.description,
    setting: [...new Set(setting)].join(", "),
    hooks: beats.filter((beat) => beat.kind === "hook").map((beat) => ({ title: beat.title, body: beat.body })),
    places: [
      ...beats.filter((beat) => beat.kind === "setting").map((beat) => beat.title),
      ...listLocations(workshop.id).map((place) => place.name),
    ],
    people: listNpcs(workshop.id)
      .filter((npc) => !npc.archived)
      .map((npc) => ({ name: npc.name, role: npc.role, trait: npc.trait })),
  };
}

export type DraftOutcome =
  | { ok: true; characters: LibraryCharacter[]; changes: string[] }
  | { ok: false; error: string; status: number };

export async function draftPregens(input: {
  workshop: Campaign;
  userId: string;
  count: number;
  level: number;
  rng?: () => number;
}): Promise<DraftOutcome> {
  const { workshop, userId, count, level } = input;
  // The classes the setting takes: the world pack's own list when the
  // workshop is set in one, else the genre's (as the companion and level-up
  // pickers choose them).
  const offered = draftOffered(workshop.gameSettings.genre, packClassIds(workshop.gameSettings));
  const { message, error } = await requestDmMessage(
    workshop.settings,
    [
      { role: "system", content: withLanguage(draftSystemPrompt(count, draftOptionNames(offered)), workshop.gameSettings.tableLanguage) },
      { role: "user", content: draftUserPrompt(adventureOf(workshop)) },
    ],
    { meta: { task: "draft_pregens" }, timeoutMs: arcTextTimeoutMs(), thinking: false, maxOutputTokens: draftReplyTokens(count) },
  );
  if (error) {
    return { ok: false, status: 502, error: "The AI DM could not be reached, so nothing was drafted. Try again in a moment." };
  }
  const parsed = parseDraftReply(stripReasoningArtifacts(String(message?.content ?? "")), count);
  if (!parsed.ok) {
    return { ok: false, status: 502, error: parsed.error };
  }
  const built: BuiltDraft[] = [];
  for (const proposal of parsed.heroes) {
    const draft = buildDraft(proposal, level, offered, input.rng);
    if (!draft.ok) {
      return { ok: false, status: 422, error: `${draft.error} Nothing was drafted.` };
    }
    built.push(draft.draft);
  }
  // The library's door, as POST /api/characters asks it, for every sheet
  // before any is stored.
  const admitted = [];
  for (const draft of built) {
    const verdict = admitSheet({ door: "library", level: draft.level, sheet: draft.sheet, userId });
    if (!verdict.ok) {
      return {
        ok: false,
        status: 422,
        error: `${draft.proposal.name} did not pass the rules check (${verdict.problems[0] ?? "no reason given"}), so nothing was drafted.`,
      };
    }
    admitted.push({ level: draft.level, sheet: verdict.sheet, settle: verdict.settle });
  }
  const characters = createDraftedPregens(userId, workshop.id, admitted);
  for (const verdict of admitted) {
    verdict.settle();
  }
  return { ok: true, characters, changes: built.flatMap((draft) => draft.changes) };
}
