import { isErrorResponse, requireStoryAuthority } from "@/lib/campaign-api";
import { deleteLoreEntry, getLoreEntry, updateLoreEntry } from "@/lib/db/lore";
import {
  LORE_BODY_MAX,
  LORE_TAGS_MAX,
  LORE_TITLE_MAX,
  LORE_VISIBILITIES,
  WORLD_LORE_CATEGORIES,
  type LoreVisibility,
  type WorldLoreCategory,
} from "@/lib/dm/world-lore-logic";
import { isUploadedImagePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireEntry(campaignId: string, entryId: string) {
  const context = await requireStoryAuthority(campaignId);
  if (isErrorResponse(context)) {
    return context;
  }
  const entry = getLoreEntry(entryId);
  if (!entry || entry.campaignId !== campaignId) {
    return Response.json({ error: "Lore entry not found." }, { status: 404 });
  }
  return entry;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ campaignId: string; entryId: string }> },
) {
  const { campaignId, entryId } = await params;
  const entry = await requireEntry(campaignId, entryId);
  if (entry instanceof Response) {
    return entry;
  }
  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Parameters<typeof updateLoreEntry>[1] = {};
  if (WORLD_LORE_CATEGORIES.includes(raw.category as WorldLoreCategory)) {
    patch.category = raw.category as WorldLoreCategory;
  }
  if (typeof raw.title === "string" && raw.title.trim()) {
    patch.title = raw.title.trim().slice(0, LORE_TITLE_MAX);
  }
  if (typeof raw.body === "string" && raw.body.trim()) {
    patch.body = raw.body.trim().slice(0, LORE_BODY_MAX);
  }
  if (Array.isArray(raw.tags)) {
    patch.tags = raw.tags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, LORE_TAGS_MAX);
  }
  if (typeof raw.pinned === "boolean") {
    patch.pinned = raw.pinned;
  }
  if (LORE_VISIBILITIES.includes(raw.visibility as LoreVisibility)) {
    patch.visibility = raw.visibility as LoreVisibility;
  }
  if (raw.imagePath !== undefined) {
    if (raw.imagePath !== "" && !isUploadedImagePath(raw.imagePath)) {
      return Response.json({ error: "Not an uploaded file." }, { status: 400 });
    }
    patch.imagePath = typeof raw.imagePath === "string" ? raw.imagePath : "";
  }
  return Response.json({ entry: updateLoreEntry(entryId, patch) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; entryId: string }> },
) {
  const { campaignId, entryId } = await params;
  const entry = await requireEntry(campaignId, entryId);
  if (entry instanceof Response) {
    return entry;
  }
  deleteLoreEntry(entryId);
  return Response.json({ ok: true });
}
