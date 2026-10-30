import { getLocation } from "@/lib/db/locations";
import { publishEphemeral, publishPersisted } from "@/lib/events";
import { parseRef } from "@/lib/worldforge/model";

// Which kinds of record changed, for the workshop's tools to refetch (audit
// finding WF-21). Every route that writes a Cast member, a lore entry, a
// place or a faction says so here, and WorldForge's own writes name the
// shelf they touched, so a second tab, or another tool in the same one,
// shows the change without a reload. The ping carries only the kinds; the
// workshop's tools read the records through their own routes as before.
// DM seats only (src/lib/event-audience.ts): the workshop's editors hold
// them, and the table's own events are left as they are.

import type { RecordKind } from "@/lib/workshop/record-events-kinds";

export function recordsChanged(campaignId: string, ...kinds: RecordKind[]) {
  publishEphemeral(campaignId, "records_changed", { kinds: [...new Set(kinds)] });
}

// What the rest of the table reads of a World tab edit. records_changed and
// world_updated reach only the seats holding the story's secrets, so a place
// renamed or removed there stayed as it was in every player's Map tab, and a
// lore entry in their Lore panel, until a reload. The table's own events
// carry it: location_updated and location_removed for a place (the snapshot
// already lists every place to every seat), lore_updated for lore.
export function worldEntryChanged(campaignId: string, ref: string, removed = false) {
  const parsed = parseRef(ref);
  if (parsed?.shelf === "location") {
    const location = removed ? null : getLocation(parsed.id);
    if (removed) {
      publishPersisted(campaignId, "location_removed", { locationId: parsed.id });
    } else if (location) {
      publishPersisted(campaignId, "location_updated", { location });
    }
  } else if (parsed?.shelf === "lore") {
    publishEphemeral(campaignId, "lore_updated", {});
  }
}
