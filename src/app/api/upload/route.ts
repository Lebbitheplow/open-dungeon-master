import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { isUploadMimeType, MAX_UPLOAD_BYTES, writeUploadedImage } from "@/lib/uploads-store";

export const runtime = "nodejs";

const requestSchema = z.object({
  dataUrl: z.string().startsWith("data:image/"),
  name: z.string().min(1),
  type: z.string().min(1),
});

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) {
    return unauthorized();
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "Invalid upload." }, { status: 400 });
  }
  const body = parsed.data;
  if (!isUploadMimeType(body.type)) {
    return Response.json({ error: "Only PNG, JPEG, and WebP images are supported." }, { status: 415 });
  }
  const [, encoded] = body.dataUrl.split(",", 2);
  const buffer = Buffer.from(encoded || "", "base64");
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    return Response.json({ error: "Image is empty or larger than 8MB." }, { status: 413 });
  }
  const written = await writeUploadedImage(buffer, body.type);
  return Response.json({
    id: written.id,
    name: body.name,
    type: body.type,
    url: written.url,
  });
}
