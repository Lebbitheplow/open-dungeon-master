import { getActiveBattleMap } from "@/lib/battlemap/view";
import { hasLineOfSight } from "@/lib/battlemap/los";
import { listTokens } from "@/lib/db/battle-maps";
import { capsFor, getCampaignById } from "@/lib/db/campaigns";
import { listSheets } from "@/lib/db/sheets";
import { publishEphemeral } from "@/lib/events";
import {
  computeAudibility,
  diffAudibility,
  type AudibilitySeat,
} from "@/lib/voice/audibility";
import { getRoom } from "@/lib/voice/room";

// The side-effecting half of the audibility engine. The rules are pure and
// live in src/lib/voice/audibility.ts; this gathers the snapshot they need,
// then turns the resulting matrix into pause/resume calls on mediasoup
// consumers.
//
// Pausing the CONSUMER is what makes "you cannot hear them" real. Turning the
// volume down in the browser would still have delivered the audio, so a
// private conversation would be sitting decoded in everyone's laptop with a
// slider between them and it. Gain is applied client-side because gain is
// only comfort; audibility is the part that has to be enforced here.

// Builds the snapshot the pure rules run on.
function seatsFor(campaignId: string): {
  seats: AudibilitySeat[];
  blocked?: (ax: number, ay: number, bx: number, by: number) => boolean;
} {
  const room = getRoom(campaignId);
  const campaign = getCampaignById(campaignId);
  if (!room || !campaign) {
    return { seats: [] };
  }

  const sheets = listSheets(campaignId);
  const map = getActiveBattleMap(campaignId);
  const tokens = map ? listTokens(map.id) : [];

  const seats: AudibilitySeat[] = [...room.peers.values()].map((peer) => {
    // A peer's position is their character's token, if they have one on the
    // active map. Outside combat there is no map and every position is null,
    // which the rules read as "no geometry to apply".
    const sheet = sheets.find((entry) => entry.userId === peer.userId && !entry.isCompanion);
    const token = sheet ? tokens.find((entry) => entry.refId === sheet.id) : undefined;
    return {
      userId: peer.userId,
      channelId: peer.channelId,
      adjudicates: capsFor(campaign, peer.userId).adjudicates,
      position: token ? { x: token.x, y: token.y } : null,
      sayRange: peer.sayRange,
      downed: Boolean(sheet && sheet.currentHp <= 0),
    };
  });

  // Wall attenuation asks the battle map's own line-of-sight, so "muffled by
  // a wall" means exactly what "cannot see through" means elsewhere.
  const blocked = map
    ? (ax: number, ay: number, bx: number, by: number) =>
        !hasLineOfSight(map.terrain, map.width, map.height, ax, ay, bx, by)
    : undefined;

  return { seats, blocked };
}

// Recomputes who hears whom and applies the difference. Cheap when nothing
// moved: an unchanged matrix issues no mediasoup calls at all.
export async function applyAudibility(campaignId: string): Promise<void> {
  const room = getRoom(campaignId);
  if (!room || room.peers.size === 0) {
    return;
  }
  const campaign = getCampaignById(campaignId);
  if (!campaign) {
    return;
  }

  const { seats, blocked } = seatsFor(campaignId);
  const next = computeAudibility(seats, campaign.gameSettings.voice.rules, { blocked });
  const diff = diffAudibility(room.audibility, next);
  room.audibility = next;

  for (const [listenerId, speakers] of diff.pause) {
    const listener = room.peers.get(listenerId);
    for (const speakerId of speakers) {
      const consumer = listener?.consumers.get(speakerId);
      if (consumer && !consumer.closed && !consumer.paused) {
        await consumer.pause();
      }
    }
  }
  for (const [listenerId, speakers] of diff.resume) {
    const listener = room.peers.get(listenerId);
    for (const speakerId of speakers) {
      const consumer = listener?.consumers.get(speakerId);
      if (consumer && !consumer.closed && consumer.paused) {
        await consumer.resume();
      }
    }
  }

  // Contentless, like facts_updated and battle_map_updated: gains are
  // per-listener, and the stream is one payload for every seat, so each client
  // pulls its own. Telling everyone how loudly everyone else hears each other
  // would leak the shape of every private conversation at the table.
  if (diff.pause.size || diff.resume.size || diff.gains.size) {
    publishEphemeral(campaignId, "voice_audibility_changed", {});
  }
}

// One listener's own view: how loudly they hear each other person. Served to
// that listener only.
export function gainsFor(campaignId: string, userId: string): Record<string, number> {
  const room = getRoom(campaignId);
  const heard = room?.audibility.get(userId);
  if (!heard) {
    return {};
  }
  return Object.fromEntries(heard);
}

// A newly created consumer starts paused (see peers.ts) and is resumed by the
// client once it has built its side. That resume must not undo an audibility
// pause, so this decides whether a given pair is allowed to be audible at all.
export function mayHear(campaignId: string, listenerId: string, speakerId: string): boolean {
  const room = getRoom(campaignId);
  if (!room) {
    return false;
  }
  // An empty matrix means audibility has never been computed for this room,
  // which is the plain "everyone hears everyone" case.
  const heard = room.audibility.get(listenerId);
  return heard ? heard.has(speakerId) : true;
}
