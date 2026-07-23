import { getCampaignById, listMembers } from "@/lib/db/campaigns";
import { listChapters } from "@/lib/db/chapters";
import { listAllMessages } from "@/lib/db/messages";
import { listSheets } from "@/lib/db/sheets";

// A serializer-independent view of a campaign's story, gathered once from the
// database and then handed to the HTML/ODT/DOCX renderers. Player-safe by
// construction: it never reads the DM outline, story arc, or private notes.

export type TranscriptLine = {
  speaker: string;
  kind: "dm" | "player";
  text: string;
};

export type StoryChapter = {
  index: number;
  // Full heading text, e.g. "Chapter 1: The Sunless Road" or the in-progress
  // label for the open chapter.
  heading: string;
  status: "open" | "closed";
  summary: string;
  highlights: string[];
  transcript: TranscriptLine[];
};

export type StoryDocument = {
  title: string;
  premise: string;
  meta: {
    theme: string;
    difficulty: string;
    startingLevel: number;
    status: string;
    exportedAt: string;
  };
  questLog: string[];
  chapters: StoryChapter[];
};

// Reads every player-safe narrative source for a campaign and folds it into a
// StoryDocument. The caller is responsible for membership authorization.
export function buildStoryDocument(campaignId: string): StoryDocument | null {
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return null;
  }

  const chapters = listChapters(campaignId);
  const messages = listAllMessages(campaignId);

  // Name resolution for transcript attribution.
  const memberNames = new Map(listMembers(campaignId).map((m) => [m.userId, m.username]));
  const sheetNames = new Map(listSheets(campaignId).map((s) => [s.id, s.name]));

  const storyChapters: StoryChapter[] = chapters.map((chapter) => {
    const seqEnd = chapter.seqEnd ?? Number.MAX_SAFE_INTEGER;
    const transcript: TranscriptLine[] = messages
      .filter(
        (message) =>
          message.seq >= chapter.seqStart &&
          message.seq <= seqEnd &&
          message.authorType !== "system" &&
          message.content.trim().length > 0,
      )
      .map((message) => ({
        kind: message.authorType === "dm" ? "dm" : "player",
        speaker:
          message.authorType === "dm"
            ? "Dungeon Master"
            : (message.characterId && sheetNames.get(message.characterId)) ||
              (message.userId && memberNames.get(message.userId)) ||
              "Adventurer",
        text: message.content.trim(),
      }));

    const title = chapter.title?.trim();
    const heading =
      chapter.status === "open"
        ? `Chapter ${chapter.index} (in progress)`
        : `Chapter ${chapter.index}: ${title || "Untitled"}`;

    return {
      index: chapter.index,
      heading,
      status: chapter.status,
      summary: chapter.summary ?? "",
      highlights: chapter.highlights ?? [],
      transcript,
    };
  });

  return {
    title: campaign.title,
    premise: campaign.description ?? "",
    meta: {
      theme: campaign.theme ?? "",
      difficulty: campaign.difficulty,
      startingLevel: campaign.startingLevel,
      status: campaign.status,
      exportedAt: new Date().toISOString(),
    },
    questLog: campaign.questLog ?? [],
    chapters: storyChapters,
  };
}

// A url/filename-safe slug of the campaign title.
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "campaign"
  );
}

export function exportFilename(doc: StoryDocument, ext: "html" | "odt" | "docx"): string {
  return `${slugify(doc.title)}-story.${ext}`;
}

// Escapes text for insertion into HTML or XML text/attribute nodes. ODF and
// OOXML are both XML, so the same five-entity escape serves all three formats.
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
