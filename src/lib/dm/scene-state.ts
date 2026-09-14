// Publishers for the scene family of events. `scene_state` is persisted so
// a late joiner replays into the same sky; a title card is persisted so it
// lands in the log; camera moves are ephemeral because "look here" is only
// true while somebody is saying it (like a map ping).
import { publishEphemeral, publishPersisted } from "@/lib/events";
import type { CameraEvent, HandoutShown, SceneState, TitleCard } from "@/lib/scene/state";

export function publishSceneState(campaignId: string, scene: SceneState) {
  publishPersisted(campaignId, "scene_state", scene);
}

let cardCounter = 0;

export function publishTitleCard(
  campaignId: string,
  card: Omit<TitleCard, "id" | "at"> & { id?: string },
): TitleCard {
  cardCounter = (cardCounter + 1) % 100_000;
  const full: TitleCard = {
    id: card.id ?? `title-${Date.now().toString(36)}-${cardCounter.toString(36)}`,
    title: card.title,
    ...(card.subtitle ? { subtitle: card.subtitle } : {}),
    tone: card.tone,
    ...(card.sting ? { sting: card.sting } : {}),
    at: Date.now(),
  };
  publishPersisted(campaignId, "title_card", full);
  return full;
}

// A handout put in front of the table (docs/vtt-parity-implementation-
// plan.md section 5.2). Persisted so a late joiner finds it in the log and
// on the stage; dismissed by a second event that names it.
export function publishHandout(
  campaignId: string,
  handout: Omit<HandoutShown, "id" | "at"> & { id?: string },
): HandoutShown {
  cardCounter = (cardCounter + 1) % 100_000;
  const full: HandoutShown = {
    ...handout,
    id: handout.id ?? `handout-${Date.now().toString(36)}-${cardCounter.toString(36)}`,
    at: Date.now(),
  };
  publishPersisted(campaignId, "handout_shown", full);
  return full;
}

export function dismissHandout(campaignId: string, id: string) {
  publishPersisted(campaignId, "handout_dismissed", { id, at: Date.now() });
}

export function publishCamera(campaignId: string, camera: Omit<CameraEvent, "at">) {
  publishEphemeral(campaignId, "camera", { ...camera, at: Date.now() });
}
