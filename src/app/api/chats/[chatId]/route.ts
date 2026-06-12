import { z } from "zod";
import { deleteChat, getChat, updateChat } from "@/lib/db";
import { LOCAL_TEXT_MODEL_IDS } from "@/lib/text-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatRouteContext = {
  params: Promise<{ chatId: string }>;
};

const settingsSchema = z.object({
  world: z.string().optional(),
  style: z.string().optional(),
  textProvider: z.enum(["local", "openrouter"]).optional(),
  localTextModel: z.enum(LOCAL_TEXT_MODEL_IDS).optional(),
  imageMode: z.enum(["fast", "slow"]).optional(),
  imageBackend: z.enum(["mflux-hs", "sdnq-hs"]).optional(),
  aspect: z.enum(["square", "portrait", "landscape"]).optional(),
  autoImages: z.boolean().optional(),
});

const updateChatSchema = z.object({
  title: z.string().trim().min(1).optional(),
  settings: settingsSchema.optional(),
});

export async function GET(_request: Request, context: ChatRouteContext) {
  const { chatId } = await context.params;
  const chat = getChat(chatId);

  if (!chat) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json({ chat });
}

export async function PATCH(request: Request, context: ChatRouteContext) {
  const { chatId } = await context.params;
  const body = updateChatSchema.parse(await request.json());
  const chat = updateChat(chatId, body);

  if (!chat) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json({ chat });
}

export async function DELETE(_request: Request, context: ChatRouteContext) {
  const { chatId } = await context.params;
  const deleted = deleteChat(chatId);

  if (!deleted) {
    return Response.json({ error: "Chat not found." }, { status: 404 });
  }

  return Response.json({ ok: true });
}
