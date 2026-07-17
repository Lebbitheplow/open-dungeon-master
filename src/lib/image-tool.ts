import { z } from "zod";

// The narrator/DM-facing image tool, shared by the solo story route and the
// campaign DM loop. The backend that fulfills it is /api/images.

export const MAX_IMAGE_REFERENCES = 2;

export const generateImageTool = {
  type: "function",
  function: {
    name: "generate_image",
    description:
      "Request one local image for a meaningful visual beat in the current scene. Use sparingly.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed visual prompt. Include subject, environment, composition, lighting, camera style, mood, and avoid text overlays. For established characters, describe visible physical features and whether each person is a man or woman; do not rely on character names inside the prompt.",
        },
        reason: {
          type: "string",
          description: "Short private reason this scene benefits from an image.",
        },
        characterIds: {
          type: "array",
          maxItems: MAX_IMAGE_REFERENCES,
          items: { type: "string" },
          description:
            "Exact saved character IDs to pass as visual references. Use at most two, and only when those characters should appear.",
        },
      },
      required: ["prompt"],
    },
  },
} as const;

export const imageToolArgsSchema = z.object({
  prompt: z.string().min(1),
  reason: z.string().optional(),
  characterIds: z.array(z.string()).max(MAX_IMAGE_REFERENCES).optional(),
});

export type ImageToolArgs = z.infer<typeof imageToolArgsSchema>;

export function parseGenerateImageToolCall(toolCalls: unknown): ImageToolArgs | null {
  if (!Array.isArray(toolCalls)) {
    return null;
  }

  for (const call of toolCalls) {
    if (!call || typeof call !== "object" || !("function" in call)) {
      continue;
    }

    const fn = call.function;
    if (!fn || typeof fn !== "object" || !("name" in fn) || fn.name !== "generate_image") {
      continue;
    }

    const rawArguments = "arguments" in fn ? fn.arguments : undefined;

    let parsed: unknown = rawArguments;
    if (typeof rawArguments === "string") {
      try {
        parsed = JSON.parse(rawArguments) as unknown;
      } catch {
        return null;
      }
    } else if (!rawArguments) {
      parsed = {};
    }

    const result = imageToolArgsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  return null;
}
