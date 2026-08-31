import { getDatabase, parseJson } from "@/lib/db/core";
import type { MountState } from "@/lib/srd/mounts";

// Who is riding what, keyed by character id.
//
// A campaign-level map rather than a column on the sheet, because a mount is
// a fact about a scene and not about a character: the horse is left at the
// stable between sessions, and a library character carried into a second
// campaign should not arrive on it.

export type MountMap = Record<string, MountState>;

export function getMounts(campaignId: string): MountMap {
  const row = getDatabase()
    .prepare(`SELECT mounts_json FROM campaigns WHERE id = ?`)
    .get(campaignId) as { mounts_json?: string } | undefined;
  const parsed = parseJson<MountMap>(row?.mounts_json ?? "{}", {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function setMount(campaignId: string, characterId: string, mount: MountState | null) {
  const next = getMounts(campaignId);
  if (mount) {
    next[characterId] = mount;
  } else {
    delete next[characterId];
  }
  getDatabase()
    .prepare(`UPDATE campaigns SET mounts_json = ? WHERE id = ?`)
    .run(JSON.stringify(next), campaignId);
}
