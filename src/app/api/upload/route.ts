import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { currentUser, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 8 * 1024 * 1024;
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

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

  if (!allowedTypes.has(body.type)) {
    return Response.json({ error: "Only PNG, JPEG, and WebP images are supported." }, { status: 415 });
  }

  const [, encoded] = body.dataUrl.split(",", 2);
  const buffer = Buffer.from(encoded || "", "base64");

  if (!buffer.length || buffer.length > MAX_FILE_SIZE) {
    return Response.json({ error: "Image is empty or larger than 8MB." }, { status: 413 });
  }

  const extension = body.type === "image/png" ? "png" : body.type === "image/webp" ? "webp" : "jpg";
  const id = crypto.randomUUID();
  const filename = `${id}.${extension}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), buffer);

  return Response.json({
    id,
    name: body.name,
    type: body.type,
    url: `/uploads/${filename}`,
  });
}
