// The admin's "Paint a test picture", made to test what the tables run.
//
// It used to call the program's image runner directly with a square tavern
// prompt and count any picture as a pass. The tables never take that door:
// they paint through generateStoryImage (the shared-host policy, the usage
// ledger), wait their turn on the media queue, ask for a landscape map, and
// only paint at all when their own campaign is set to the agent. So the test
// passed on servers whose campaigns could not use the agent at all.
//
// Now each stage is the table's own: the same door, the same queue, the map
// shape, the file the table will be sent, and then the campaigns themselves,
// which of them will paint with it and which are still on a backend that
// cannot paint (and would be moved onto it, src/lib/image-backend-rescue.ts).
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { campaignPictures, strandedMoves, type CampaignPictures } from "@/lib/image-backend-rescue";
import { generateStoryImage } from "@/lib/image-generate";
import { imageSize, sniffImage } from "@/lib/image-format";
import { enqueueMediaJob } from "@/lib/media-queue";
import { configuredDefaultStorySettings } from "@/lib/runtime-defaults";
import type { GeneratedImage } from "@/lib/types";

export type PictureStageId = "painted" | "saved" | "shape";

export type PictureStage = { id: PictureStageId; ok: boolean | null; detail?: string };

export type PictureTestResult = {
  image?: GeneratedImage;
  stages: PictureStage[];
  error?: string;
  // Every campaign on the server and what it paints with now.
  campaigns: CampaignPictures[];
  // Those the agent's pictures would rescue once they are the default.
  wouldMove: number;
};

// A location map, the picture the tables ask the agent for most, in the
// words enqueueLocationMap uses.
export const TEST_MAP_PROMPT =
  "top-down illustrated game map, hand-drawn parchment cartography, labeled areas, clear pathways, no text captions, The Drowned Ford, a shallow river crossing with a ruined toll house on the east bank and reed beds to the south";

// Pure: the stages a finished run earned, so scripts/test-harness-pictures.mjs
// can check every verdict without painting.
export function pictureStages(input: {
  image: GeneratedImage | null;
  error: string;
  file: { bytes: number; kind: string | null; width: number; height: number } | null;
}): PictureStage[] {
  if (!input.image) {
    return [
      { id: "painted", ok: false, detail: input.error || "No picture came back." },
      { id: "saved", ok: null },
      { id: "shape", ok: null },
    ];
  }
  const savedOk = Boolean(input.file && input.file.bytes > 0 && input.file.kind);
  const width = input.file?.width || input.image.width;
  const height = input.file?.height || input.image.height;
  return [
    { id: "painted", ok: true, detail: `${input.image.elapsedSeconds ?? "?"} s through the tables' own picture queue` },
    {
      id: "saved",
      ok: savedOk,
      detail: savedOk ? `${input.file?.kind?.toUpperCase()}, ${Math.round((input.file?.bytes ?? 0) / 1024)} KB` : "The file the table would be sent is missing or unreadable.",
    },
    // A square picture still shows (the map panel crops it), so the shape
    // informs rather than fails.
    {
      id: "shape",
      ok: width > 0 && height > 0 ? width > height : null,
      detail: width && height ? `${width} x ${height}${width > height ? "" : ", not the landscape a map asks for; the table crops it"}` : undefined,
    },
  ];
}

export async function testHarnessPictures(): Promise<PictureTestResult> {
  const settings = { ...configuredDefaultStorySettings(), imageBackend: "harness" as const };
  let image: GeneratedImage | null = null;
  let error = "";
  // The same lane every table picture waits in, so the test also proves the
  // queue hands the job to the agent.
  await enqueueMediaJob("agent picture test", async () => {
    try {
      image = await generateStoryImage(settings, { prompt: TEST_MAP_PROMPT, mode: "fast", aspect: "landscape", verifying: true });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  });
  const painted = image as GeneratedImage | null;
  let file: { bytes: number; kind: string | null; width: number; height: number } | null = null;
  if (painted) {
    try {
      const full = path.join(/*turbopackIgnore: true*/ process.cwd(), "public", painted.url.replace(/^\/+/, ""));
      const bytes = readFileSync(full);
      const size = imageSize(bytes);
      file = { bytes: statSync(full).size, kind: sniffImage(bytes)?.ext ?? null, width: size.width, height: size.height };
    } catch {
      file = null;
    }
  }
  const campaigns = await campaignPictures();
  return {
    ...(painted ? { image: painted } : {}),
    stages: pictureStages({ image: painted, error, file }),
    ...(error ? { error } : {}),
    campaigns,
    wouldMove: strandedMoves(campaigns, "harness", Boolean(painted)).length,
  };
}
