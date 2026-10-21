"use client";

import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";

// Sound the browser is holding back, said where it can be seen. A browser
// plays nothing until the page has had a click or a key press, so a tab that
// is only watched (a table of AI players, say) hears none of the narration
// that arrives. useNarrationAudio keeps every such passage and plays the
// newest at the first gesture (the older ones keep their replay buttons, so
// an hour of watching does not play back as ten minutes of stale scenes);
// until then the only sign used to be a struck-through icon in the header,
// which a watcher never noticed. This
// banner sits above the composer, on screen in every layout, and stays until
// the gesture it asks for: there is nothing to dismiss, because any click on
// the page (this button included) is the fix.
export function AudioWaitingBanner({
  narrationHeld,
  ambienceWaiting,
  onListen,
}: {
  // Narrations held for this seat; 0 when muted or nothing is waiting.
  narrationHeld: number;
  // The room's sound is set and has not started for want of a gesture.
  ambienceWaiting: boolean;
  onListen: () => void;
}) {
  if (narrationHeld <= 0 && !ambienceWaiting) {
    return null;
  }
  const narration = narrationHeld > 0;
  // One click plays one passage, so the count says what arrived, not what
  // will play.
  const said =
    narrationHeld === 1
      ? "A passage arrived while your browser held sound back. Click to hear it."
      : `${narrationHeld} passages arrived while your browser held sound back. Click to hear the newest; the others have replay buttons.`;
  return (
    <SessionBanner
      glyph={narration ? "ui-speech" : "tab-ambience"}
      title={narration ? "Narration is waiting" : "Sound is waiting"}
      actions={
        <button type="button" className={bannerButtonClass(true)} onClick={onListen}>
          Click to listen
        </button>
      }
    >
      <span role="status" className="block">
        {narration
          ? said
          : "Your browser holds the table's sound back until you click this tab."}
      </span>
    </SessionBanner>
  );
}
