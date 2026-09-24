import { getDatabase, parseJson } from "@/lib/db/core";
import { getOpenChapter } from "@/lib/db/chapters";
import { characterPlaceholder } from "@/lib/placeholders";
import { clipRecap } from "@/lib/recap";

// The clipper lives in src/lib/recap.ts so the table's chronicle can use it
// without pulling the database layer into the browser bundle.
export { clipRecap };

const FACE_LIMIT = 6;
import type { GeneratedImage } from "@/lib/types";
import type { HomeGlance, HomeGlanceFace } from "@/lib/campaign-types";

// What the title screen says about a table without opening it: the last
// thing the Dungeon Master said ("when last we left"), the chapter the tale
// is in, the newest painted scene to fill the screen with, and the faces of
// the party. One small query per table; the home lists a handful.

function latestRecap(campaignId: string): { recap: string; at: string } | null {
  const rows = getDatabase()
    .prepare(
      `SELECT content, created_at FROM campaign_messages
       WHERE campaign_id = ? AND author_type = 'dm'
       ORDER BY seq DESC LIMIT 6`,
    )
    .all(campaignId) as Array<{ content: string; created_at: string }>;
  for (const row of rows) {
    const recap = clipRecap(row.content);
    if (recap) {
      return { recap, at: row.created_at };
    }
  }
  return null;
}

function latestSceneImage(campaignId: string): string | null {
  const row = getDatabase()
    .prepare(
      `SELECT generated_image_json FROM campaign_messages
       WHERE campaign_id = ? AND generated_image_json IS NOT NULL
       ORDER BY seq DESC LIMIT 1`,
    )
    .get(campaignId) as { generated_image_json: string | null } | undefined;
  const image = parseJson<GeneratedImage | null>(row?.generated_image_json, null);
  return image?.url || null;
}

type FaceRow = {
  campaign_id: string;
  name: string;
  race: string;
  class: string;
  gender: string | null;
  portrait_json: string | null;
};

// The party's faces for every listed table in one query: own portrait first,
// the painted plate for the class and race otherwise (the same rule the
// tokens follow, docs/visual-overhaul-plan.md section 5.1).
export function partyFacesByCampaign(campaignIds: string[], genreById: Map<string, string>): Map<string, HomeGlanceFace[]> {
  const faces = new Map<string, HomeGlanceFace[]>();
  if (campaignIds.length === 0) {
    return faces;
  }
  const marks = campaignIds.map(() => "?").join(", ");
  const rows = getDatabase()
    .prepare(
      `SELECT campaign_id, name, race, class, gender, portrait_json FROM character_sheets
       WHERE campaign_id IN (${marks}) AND (is_companion IS NULL OR is_companion = 0)
       ORDER BY created_at ASC`,
    )
    .all(...campaignIds) as FaceRow[];
  for (const row of rows) {
    const list = faces.get(row.campaign_id) ?? [];
    if (list.length >= FACE_LIMIT) {
      continue;
    }
    const portrait = parseJson<{ url?: string } | null>(row.portrait_json, null);
    list.push({
      name: row.name,
      url:
        portrait?.url ||
        characterPlaceholder({
          race: row.race,
          class: row.class,
          gender: row.gender,
          genre: genreById.get(row.campaign_id) ?? null,
        }),
    });
    faces.set(row.campaign_id, list);
  }
  return faces;
}

export function homeGlanceFor(campaignId: string, faces: HomeGlanceFace[]): HomeGlance {
  const chapter = getOpenChapter(campaignId);
  const latest = latestRecap(campaignId);
  return {
    chapter: chapter ? { index: chapter.index, title: chapter.title } : null,
    recap: latest?.recap ?? "",
    recapAt: latest?.at ?? null,
    sceneImage: latestSceneImage(campaignId),
    faces,
  };
}
