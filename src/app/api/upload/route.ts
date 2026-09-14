import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";
import { isUploadMimeType, MAX_PDF_BYTES, MAX_UPLOAD_BYTES, writeUploadedImage, writeUploadedPdf } from "@/lib/uploads-store";
import { isEncryptedPdf, isPdf } from "@/lib/pdf/text";

export const runtime = "nodejs";

const requestSchema = z.object({
  dataUrl: z.string().regex(/^data:(image\/|application\/pdf)/),
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
  if (body.type === "application/pdf") {
    // A PDF for the binder (docs/vtt-parity-implementation-plan.md 5.3).
    const [, encoded] = body.dataUrl.split(",", 2);
    const buffer = Buffer.from(encoded || "", "base64");
    if (!buffer.length || buffer.length > MAX_PDF_BYTES) {
      return Response.json({ error: "PDF is empty or larger than 25MB." }, { status: 413 });
    }
    if (!isPdf(buffer)) {
      return Response.json({ error: "That is not a PDF." }, { status: 415 });
    }
    if (isEncryptedPdf(buffer)) {
      return Response.json({ error: "That PDF is password protected." }, { status: 415 });
    }
    const written = await writeUploadedPdf(buffer);
    return Response.json({ id: written.id, name: body.name, type: body.type, url: written.url });
  }
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
