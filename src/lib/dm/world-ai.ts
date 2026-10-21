import type { Campaign } from "@/lib/db/campaigns";
import { arcTextTimeoutMs } from "@/lib/model-client";
import { requestUtilityMessage } from "@/lib/dm/model";
import { withLanguage } from "@/lib/dm/table-language-logic";
import { stripReasoningArtifacts } from "@/lib/story-prompt";
import { generateStoryImage } from "@/lib/image-generate";
import { toEnglishForImage } from "@/lib/image-english";
import { enqueueMediaJob } from "@/lib/media-queue";
import { presetFor } from "@/lib/worlds/preset";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import { copyIntoUploads } from "@/lib/portrait";
import { imagesAvailable } from "@/lib/capabilities";
import { pictureFailureReason } from "@/lib/dm/images";
import { worldView } from "@/lib/db/world-forge";
import { draftKnown, draftMessages, forgeMessages, paintPrompt, readForgeReply, replyJson, type ForgePreview } from "@/lib/worldforge/forge";
import { askMessages, askPassages, citedPassages, type AskOmitted, type AskPassage } from "@/lib/worldforge/ask";
import { mentionSegments } from "@/lib/worldforge/text";
import { parseRef, typeFor } from "@/lib/worldforge/model";
import { recordsChanged } from "@/lib/workshop/record-events";
import { accountOf } from "@/lib/worldforge/account";
import { failPaintJob, finishPaintJob, openPaintJob, paintStatus, refusedPaintJob, startPaintJob, type PaintJob } from "@/lib/db/world-paint-jobs";
import { DRAFT_ASKS, draftKind } from "@/lib/worldforge/adapters";
import type { BoundRecord } from "@/lib/db/world-bindings";
import { resolveMonster } from "@/lib/bestiary/index";
import { describeMonster } from "@/lib/bestiary/monster-draft";
import { getHomebrew, tableAuthors } from "@/lib/db/homebrew";
import { describeHomebrew } from "@/lib/homebrew/gear";

// WorldForge's AI tools against the workshop's own models: the forge (notes
// into entries and links, previewed, nothing written), ask the world, draft
// an entry, paint an entry. Each is optional equipment: a server with no
// text model answers with the model's error and the panel never offers the
// button in the first place (src/lib/use-capabilities.ts).

type Failure = { error: string };

// One answer from the workshop's model; the world outline
// (src/lib/dm/world-outline.ts) asks through it too.
export async function ask(campaign: Campaign, [system, ...rest]: Array<{ role: "system" | "user"; content: string }>): Promise<string | Failure> {
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [{ ...system, content: withLanguage(system.content, campaign.gameSettings.tableLanguage) }, ...rest],
    { meta: { task: "world_ai" }, timeoutMs: arcTextTimeoutMs() },
  );
  if (error) return { error: "The model could not be reached." };
  const text = stripReasoningArtifacts(String(message?.content ?? "")).trim();
  return text || { error: "The model returned nothing usable." };
}

export async function forgeFromNotes(campaign: Campaign, text: string, hint: string): Promise<{ preview: ForgePreview } | Failure> {
  const { doc, entities } = worldView(campaign.id);
  const named = entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases }));
  const reply = await ask(campaign, forgeMessages(text, doc.types, entities.map((entity) => entity.name), hint));
  if (typeof reply !== "string") return reply;
  const preview = readForgeReply(replyJson(reply), doc, named);
  return preview.entities.length || preview.links.length ? { preview } : { error: "The model found nothing it could turn into entries." };
}

// Ask (src/lib/worldforge/ask.ts, audit WF-15): the passages that match the
// question, read the way search_lore reads in play; the answer, with the
// passages it cites as its sources, every passage it was given, and the
// matches left out for space. `refs` are the entries the answer names or
// cites. Only the DM asks (the route needs story authority), and what is
// read is the world the DM already sees.
export type AskAnswer = { answer: string; refs: string[]; sources: AskPassage[]; read: AskPassage[]; omitted: AskOmitted };

export async function askTheWorld(campaign: Campaign, question: string): Promise<AskAnswer | Failure> {
  const { doc, entities } = worldView(campaign.id);
  const retrieval = askPassages(doc, entities, question, campaign.gameSettings.tableLanguage);
  const reply = await ask(campaign, askMessages(retrieval, question, campaign.title));
  if (typeof reply !== "string") return reply;
  const sources = citedPassages(reply, retrieval.passages);
  const named = entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases }));
  const refs = [...new Set([...sources.map((source) => source.ref).filter(Boolean), ...mentionSegments(reply, named).filter((segment) => segment.ref).map((segment) => segment.ref!)])];
  return { answer: reply, refs, sources, read: retrieval.passages, omitted: retrieval.omitted };
}

// Draft, through the adapter for the entry's kind (src/lib/worldforge/adapters.ts):
// a person is asked for a voice and wants, a creature for habits and signs,
// an item for its making and its cost. A creature or item that links to a
// stat block or a Homebrew entry is told its rules, so the article agrees
// with what the table plays.
export async function draftEntry(campaign: Campaign, ref: string, hint: string): Promise<{ text: string } | Failure> {
  const { doc, entities } = worldView(campaign.id);
  const entity = entities.find((entry) => entry.ref === ref);
  if (!entity) return { error: "No such entry in this workshop." };
  const type = typeFor(doc, entity.shelf, entity.entry.typeId);
  const known = draftKnown(doc, entities, entity);
  const found = entity.bound.filter((record) => record.found);
  const reply = await ask(
    campaign,
    draftMessages({
      worldName: campaign.title,
      name: entity.name,
      typeName: type.name,
      known,
      hiddenTruth: entity.entry.hiddenTruth,
      hint,
      asks: DRAFT_ASKS[draftKind(entity.shelf, type, found)],
      rules: found.map((record) => boundRules(campaign, record)).filter(Boolean),
    }),
  );
  return typeof reply === "string" ? { text: reply.slice(0, 12_000) } : reply;
}

// One line on a linked stat block or item, in the words its own tool uses.
function boundRules(campaign: Campaign, record: BoundRecord): string {
  if (record.kind === "monster") {
    const monster = resolveMonster(record.ref, campaign.gameSettings, { userIds: tableAuthors(campaign.id) });
    if (!monster) return "";
    const stats = monster.stats;
    const attacks = stats.attacks.map((attack) => `${attack.name} (${attack.type})`).join(", ");
    return [
      `${record.name} is a ${stats.size ?? "Medium"} ${stats.type ?? "creature"}, ${describeMonster({ name: record.name, stats, extraDamagePerRound: 0 })}`,
      attacks ? `attacks: ${attacks}` : "",
      stats.traits.length ? `traits: ${stats.traits.slice(0, 4).join(" ")}` : "",
    ]
      .filter(Boolean)
      .join("; ")
      .slice(0, 800);
  }
  if (record.kind === "item" && record.ownId) {
    const item = tableAuthors(campaign.id).map((author) => getHomebrew(author, record.ownId)).find(Boolean);
    return item ? `${item.name}: ${describeHomebrew("item", item.data)}`.slice(0, 600) : "";
  }
  return record.kind === "item" ? `${record.name}, an item from the rulebook.` : "";
}

// Paint (audit WF-16): a job on the serial media queue (one GPU, shared with
// the DM model), kept as a row from queued to the DM's decision
// (src/lib/db/world-paint-jobs.ts). The finished picture waits beside the
// entry's own until the DM accepts it. A server with no image backend gets a
// failed job saying so, and nothing is queued. A second Paint while one is
// queued or working answers that one. Like every picture the server paints
// (portraits, covers, scenes, maps), it is not counted against the account's
// upload allowance, which is for files people send.
export const NO_IMAGE_BACKEND =
  "This server has no image backend set up, so nothing was painted. An admin can choose one in Admin > Image generation. Until then, Edit takes an uploaded picture.";

export type Painting = { job: PaintJob; already: boolean } | { error: string; status: number; job?: PaintJob };

export async function paintEntry(campaign: Campaign, ref: string, account: { id: string }): Promise<Painting> {
  const { doc, entities } = worldView(campaign.id);
  const entity = entities.find((entry) => entry.ref === ref);
  if (!entity) return { error: "No such entry.", status: 404 };
  const previous = entity.portrait;
  if (!(await imagesAvailable())) {
    return { error: NO_IMAGE_BACKEND, status: 409, job: refusedPaintJob(campaign.id, ref, account.id, previous, NO_IMAGE_BACKEND) };
  }
  const running = paintStatus(campaign.id, ref, previous).jobs.find((job) => job.state === "queued" || job.state === "working");
  if (running) return { job: running, already: true };
  const opened = openPaintJob(campaign.id, ref, account.id, previous);
  if (opened.already) return opened;
  const type = typeFor(doc, entity.shelf, entity.entry.typeId);
  // The genre's portrait style is for faces; anything else only takes the
  // genre's name, or a relic comes out as a cloaked figure.
  const style =
    entity.shelf === "npc"
      ? presetFor({ genre: campaign.gameSettings.genre, worldPack: campaign.gameSettings.worldPack }).portraitStyle
      : `${campaign.gameSettings.genre.replace(/_/g, " ")} setting`;
  const about = [entity.tagline, accountOf(entity)].filter(Boolean).join(" ");
  const id = opened.job.id;
  void enqueueMediaJob(`world picture ${ref}`, async () => {
    // Cancelled while it waited: nothing to paint.
    if (!startPaintJob(id)) return;
    try {
      const english = await toEnglishForImage(campaign, { type: type.name, about });
      const prompt = paintPrompt(entity.shelf, english.type, english.about, style);
      const image = await generateStoryImage(configuredDefaultStorySettings(), { prompt, mode: "fast", aspect: entity.shelf === "location" ? "landscape" : "square" });
      finishPaintJob(id, copyIntoUploads(image.url).url);
    } catch (error) {
      console.error(`[worldforge] picture failed for ${ref}:`, error);
      failPaintJob(id, `The image backend did not paint it: ${pictureFailureReason(error)}`);
    }
    // A picture finished (or failed) after the request that asked for it:
    // the tools showing this entry hear of it now.
    const painted = parseRef(ref);
    if (painted) recordsChanged(campaign.id, painted.shelf, "world");
  });
  return opened;
}
