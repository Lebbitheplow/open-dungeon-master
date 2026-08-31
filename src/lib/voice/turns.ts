import { capsFor, getCampaignById, type Floor } from "@/lib/db/campaigns";
import { publishRoster, syncProducer } from "@/lib/voice/peers";
import { getRoom } from "@/lib/voice/room";
import {
  forcedSilentUserIds,
  handsToLower,
  type VoiceFloorMode,
  type VoiceSeat,
} from "@/lib/voice/turn-logic";

// Applies the campaign's floor to the microphones on the call. The rules
// themselves are pure and live in src/lib/voice/turn-logic.ts; this is the
// side-effecting half that owns the mediasoup calls and the DB reads.

// Whoever the floor currently names. Open and hold name nobody: open because
// everyone may speak, hold because nobody may.
function floorUserIds(floor: Floor): string[] {
  return floor.mode === "spotlight" || floor.mode === "initiative" ? floor.userIds : [];
}

export async function applyVoiceFloor(campaignId: string): Promise<void> {
  const room = getRoom(campaignId);
  // No call in progress means there is nothing to silence. This is the common
  // case by far: most floor changes happen at tables with nobody on voice.
  if (!room || room.peers.size === 0) {
    return;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }

  const floor = campaign.floor;
  const mode = floor.mode as VoiceFloorMode;
  const named = floorUserIds(floor);
  const enforcement = campaign.gameSettings.voice.turnEnforcement;

  // adjudicates comes from viewerCaps, which already knows about the DM, a
  // co-DM and the AI table's lead, so nothing here compares user ids itself.
  const seats: VoiceSeat[] = [...room.peers.values()].map((peer) => ({
    userId: peer.userId,
    adjudicates: capsFor(campaign, peer.userId).adjudicates,
  }));

  const silenced = new Set(forcedSilentUserIds(mode, named, seats, enforcement));
  let changed = false;

  for (const peer of room.peers.values()) {
    const next = silenced.has(peer.userId);
    if (peer.forceMuted !== next) {
      peer.forceMuted = next;
      changed = true;
      // syncProducer honours the peer's own mute too, so releasing the floor
      // never un-mutes somebody who muted themselves.
      await syncProducer(peer);
    }
  }

  // Being handed the floor answers the request, so the hand comes down by
  // itself. Otherwise the queue fills with hands nobody remembers raising.
  const lowered = handsToLower(
    named,
    [...room.peers.values()].map((peer) => ({
      userId: peer.userId,
      raisedAt: peer.handRaisedAt,
    })),
  );
  for (const userId of lowered) {
    const peer = room.peers.get(userId);
    if (peer) {
      peer.handRaisedAt = null;
      changed = true;
    }
  }

  if (changed) {
    publishRoster(campaignId);
  }
}
