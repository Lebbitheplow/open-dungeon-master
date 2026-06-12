import { rm } from "node:fs/promises";
import path from "node:path";
import { deleteAllLocalStoryData } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localImageDirs = [
  path.join(process.cwd(), "public", "uploads"),
  path.join(process.cwd(), "public", "generated"),
];

export async function DELETE() {
  deleteAllLocalStoryData();

  const deletedImageDirs: string[] = [];
  for (const directory of localImageDirs) {
    await rm(directory, { recursive: true, force: true });
    deletedImageDirs.push(directory);
  }

  return Response.json({
    ok: true,
    database: path.join(process.cwd(), "data", "local-roleplay.sqlite"),
    deletedImageDirs,
  });
}
