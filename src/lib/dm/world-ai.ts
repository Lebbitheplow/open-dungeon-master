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
import { copyIntoUploads, whenImagesAvailable } from "@/lib/portrait";
import { updateWorldEntity, worldView } from "@/lib/db/world-forge";
import { askMessages, draftMessages, forgeMessages, paintPrompt, readForgeReply, replyJson, worldDigest, type ForgePreview } from "@/lib/worldforge/forge";
import { mentionSegments } from "@/lib/worldforge/text";
import { fieldLines, formatYear, sortEvents } from "@/lib/worldforge/time";
import { typeFor } from "@/lib/worldforge/model";

// WorldForge's AI tools against the workshop's own models: the forge (notes
// into entries and links, previewed, nothing written), ask the world, draft
// an entry, paint an entry. Each is optional equipment: a server with no
// text model answers with the model's error and the panel never offers the
// button in the first place (src/lib/use-capabilities.ts).

type Failure = { error: string };

async function ask(campaign: Campaign, [system, ...rest]: Array<{ role: "system" | "user"; content: string }>): Promise<string | Failure> {
  const { message, error } = await requestUtilityMessage(
    campaign.settings,
    [{ ...system, content: withLanguage(system.content, campaign.gameSettings.tableLanguage) }, ...rest],
    { timeoutMs: arcTextTimeoutMs() },
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

export async function askTheWorld(campaign: Campaign, question: string): Promise<{ answer: string; refs: string[] } | Failure> {
  const { doc, entities } = worldView(campaign.id);
  const digest = worldDigest(doc, entities, question, 14_000);
  const reply = await ask(campaign, askMessages(digest, question, campaign.title));
  if (typeof reply !== "string") return reply;
  const named = entities.map((entity) => ({ ref: entity.ref, name: entity.name, aliases: entity.aliases }));
  const refs = [...new Set(mentionSegments(reply, named).filter((segment) => segment.ref).map((segment) => segment.ref!))];
  return { answer: reply, refs };
}

export async function draftEntry(campaign: Campaign, ref: string, hint: string): Promise<{ text: string } | Failure> {
  const { doc, entities } = worldView(campaign.id);
  const entity = entities.find((entry) => entry.ref === ref);
  if (!entity) return { error: "No such entry in this workshop." };
  const type = typeFor(doc, entity.shelf, entity.entry.typeId);
  const nameOf = new Map(entities.map((entry) => [entry.ref, entry.name]));
  const known = [
    entity.tagline ? `In one line: ${entity.tagline}` : "",
    entity.entry.article || entity.text ? `What is written so far: ${(entity.entry.article || entity.text).slice(0, 1_500)}` : "",
    entity.aliases.length ? `Also called: ${entity.aliases.join(", ")}` : "",
    ...fieldLines(type, entity.entry, doc.calendars, false).map(({ def, text }) => `${def.name}: ${text}`),
    ...doc.links
      .filter((link) => link.veracity !== "hidden" && (link.from === ref || (link.to === ref && !link.oneway)))
      .slice(0, 12)
      .map((link) => (link.from === ref ? `${entity.name} ${link.label} ${nameOf.get(link.to)}` : `${nameOf.get(link.from)} ${link.label} ${entity.name}`)),
    ...sortEvents(doc.events.filter((event) => event.refs.includes(ref)), doc.calendars)
      .slice(0, 8)
      .map((event) => `Event, ${formatYear(event.when, doc.calendars).primary || "undated"}: ${event.title}`),
  ].filter(Boolean);
  const reply = await ask(
    campaign,
    draftMessages({ worldName: campaign.title, name: entity.name, typeName: type.name, known, hiddenTruth: entity.entry.hiddenTruth, hint }),
  );
  return typeof reply === "string" ? { text: reply.slice(0, 12_000) } : reply;
}

// Fire and forget on the serial media queue (one GPU, shared with the DM
// model). Nothing is promised when the server has no image backend.
export function paintEntry(campaign: Campaign, ref: string): boolean {
  const { doc, entities } = worldView(campaign.id);
  const entity = entities.find((entry) => entry.ref === ref);
  if (!entity) return false;
  const type = typeFor(doc, entity.shelf, entity.entry.typeId);
  // The genre's portrait style is for faces; anything else only takes the
  // genre's name, or a relic comes out as a cloaked figure.
  const style =
    entity.shelf === "npc"
      ? presetFor({ genre: campaign.gameSettings.genre, worldPack: campaign.gameSettings.worldPack }).portraitStyle
      : `${campaign.gameSettings.genre.replace(/_/g, " ")} setting`;
  const about = [entity.tagline, entity.entry.article || entity.text].filter(Boolean).join(" ");
  void whenImagesAvailable(() =>
    enqueueMediaJob(`world picture ${ref}`, async () => {
      try {
        const english = await toEnglishForImage(campaign, { type: type.name, about });
        const prompt = paintPrompt(entity.shelf, english.type, english.about, style);
        const image = await generateStoryImage(configuredDefaultStorySettings(), { prompt, mode: "fast", aspect: entity.shelf === "location" ? "landscape" : "square" });
        updateWorldEntity(campaign.id, ref, { portrait: copyIntoUploads(image.url).url });
      } catch (error) {
        console.error(`[worldforge] picture failed for ${ref}:`, error);
      }
    }),
  );
  return true;
}
