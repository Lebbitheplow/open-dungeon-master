import { z } from "zod";
import { generateComfyImage } from "@/lib/comfyui";
import { updateMessageGeneratedImage } from "@/lib/db";
import { serverEnv } from "@/lib/server-env";
import { dimensionsForImage } from "@/lib/story-prompt";
import type { GeneratedImage } from "@/lib/types";

export const runtime = "nodejs";

const MAX_IMAGE_REFERENCES = 2;

const requestSchema = z.object({
  messageId: z.string().optional(),
  prompt: z.string().min(1),
  mode: z.enum(["fast", "slow"]).default("slow"),
  backend: z.enum(["mflux-hs", "sdnq-hs", "comfyui"]).default("mflux-hs"),
  aspect: z.enum(["square", "portrait", "landscape"]).default("square"),
  comfyUrl: z.string().trim().max(500).default(""),
  comfyCheckpoint: z.string().trim().max(300).default(""),
  seed: z.number().int().optional(),
  references: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        url: z.string(),
        dataUrl: z.string().optional(),
      }),
    )
    .default([]),
});

export async function POST(request: Request) {
  const body = requestSchema.parse(await request.json());
  const references = body.references.slice(0, MAX_IMAGE_REFERENCES);

  // ComfyUI runs its own server; the app talks to it directly and saves the
  // finished PNG the same way the FLUX worker path does.
  if (body.backend === "comfyui") {
    try {
      const generatedImage = await generateComfyImage({
        url: body.comfyUrl,
        checkpoint: body.comfyCheckpoint,
        prompt: body.prompt,
        mode: body.mode,
        aspect: body.aspect,
        seed: body.seed,
        hasReferences: references.length > 0,
      });

      if (body.messageId) {
        updateMessageGeneratedImage(body.messageId, generatedImage);
      }

      return Response.json(generatedImage);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "ComfyUI generation failed." },
        { status: 502 },
      );
    }
  }

  const workerUrl = serverEnv("FLUX_WORKER_URL", "http://127.0.0.1:7869");
  const dimensions = dimensionsForImage(body.mode, body.aspect);

  try {
    const upstream = await fetch(`${workerUrl.replace(/\/$/, "")}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: body.prompt,
        mode: body.mode,
        backend: body.backend,
        aspect: body.aspect,
        width: dimensions.width,
        height: dimensions.height,
        steps: 4,
        guidance: 0.0,
        seed: body.seed,
        references: references.map((reference) => ({
          name: reference.name,
          dataUrl: reference.dataUrl,
          url: reference.url,
        })),
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return Response.json(
        { error: `Flux worker failed (${upstream.status}).`, detail: detail.slice(0, 1000) },
        { status: 502 },
      );
    }

    const generatedImage = (await upstream.json()) as GeneratedImage;

    if (body.messageId) {
      updateMessageGeneratedImage(body.messageId, generatedImage);
    }

    return Response.json(generatedImage);
  } catch (error) {
    return Response.json(
      {
        error: "Flux worker is not running.",
        detail: error instanceof Error ? error.message : String(error),
        expected: "Open Images and click Start, or run npm run image:server from the Open Dungeon folder.",
      },
      { status: 503 },
    );
  }
}
