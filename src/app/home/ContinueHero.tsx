"use client";

import { Swords } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { campaignPlaceholder, miscPlaceholder } from "@/lib/placeholders";
import { agoLabel, chapterLine, seatLine, type HomeCampaign } from "@/app/home/types";

// The title screen's painting: the table you were last at fills the whole
// screen, the way a game's main menu shows the world behind its Continue.
// The newest painted scene wins, the cover art otherwise, the genre plate
// when there is neither. Crossfades when the table changes (a clone, a
// delete) and drifts slowly while it is up.
export function ScreenBackdrop({ campaign }: { campaign: HomeCampaign | null }) {
  const url = campaign
    ? campaign.glance?.sceneImage || campaign.cover?.url || campaignPlaceholder(campaign.genre, campaign.id)
    : miscPlaceholder("empty");
  // Two layers so a new painting fades in over the old one instead of
  // popping; the outgoing layer is dropped once the fade has run.
  const [layers, setLayers] = useState<string[]>([url]);
  // State from props during render (React's "adjusting state when a prop
  // changes"): a new painting joins the stack the moment the table changes.
  if (layers[layers.length - 1] !== url) {
    setLayers([...layers.slice(-1), url]);
  }
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), 1200);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return (
    <div className="ts-backdrop" aria-hidden="true">
      {layers.map((src, index) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" className={cn("ts-art", index === layers.length - 1 && "ts-art-in")} />
      ))}
      <div className="ts-scrim ts-scrim-side" />
      <div className="ts-scrim ts-scrim-floor" />
      <div className="ts-stars" />
    </div>
  );
}

// The title block: eyebrow, the table's name in extruded gold, the chapter
// line between hairlines, the party's faces and the one line saying who you
// are there, and the door in.
export function ContinueHero({ campaign, userId }: { campaign: HomeCampaign; userId: string }) {
  const ended = campaign.status === "ended";
  const lobby = campaign.status === "lobby";
  const faces = campaign.glance?.faces ?? [];
  return (
    <div className="ts-title-block">
      <span className="ts-eyebrow ts-reveal" style={{ animationDelay: "140ms" }}>
        {ended ? "A finished tale" : lobby ? "The table is set" : "Continue your tale"}
      </span>
      <h1 className="ts-title ts-reveal" style={{ animationDelay: "220ms" }}>
        <span className="ts-title-face">{campaign.title}</span>
      </h1>
      <p className="ts-chapter ts-reveal" style={{ animationDelay: "420ms" }}>
        <span className="ts-rule" />
        <span className="ts-chapter-text">{chapterLine(campaign)}</span>
        <span className="ts-rule ts-rule-end" />
      </p>
      <div className="ts-party ts-reveal" style={{ animationDelay: "520ms" }}>
        {faces.length ? (
          <span className="ts-faces" aria-hidden="true">
            {faces.slice(0, 5).map((face, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${face.name}-${index}`} src={face.url} alt="" className="ts-face" title={face.name} style={{ animationDelay: `${540 + index * 60}ms` }} />
            ))}
          </span>
        ) : null}
        <span className="ts-seat-line">{seatLine(campaign, userId)}</span>
      </div>
      <div className="ts-actions ts-reveal" style={{ animationDelay: "640ms" }}>
        <Link href={`/campaigns/${campaign.id}`} className="ts-enter motion-magnet" data-tour="tile-continue">
          <span className="ts-enter-sheen" aria-hidden="true" />
          <Swords className="size-4" aria-hidden="true" />
          {ended ? "Revisit the world" : lobby ? "Take your seat" : "Enter the world"}
        </Link>
      </div>
    </div>
  );
}

// "When last we left": the last thing the Dungeon Master said at that
// table, with the drop cap, and a mono line saying where the turn stood.
export function RecapPanel({ campaign }: { campaign: HomeCampaign }) {
  const glance = campaign.glance;
  const floor = (campaign as HomeCampaign & { floor?: { mode?: string; round?: number; currentName?: string } }).floor;
  const recap = glance?.recap?.trim() || "";
  const head = recap.charAt(0);
  const tail = recap.slice(1);
  const bits: string[] = [];
  if (floor?.mode === "initiative" && floor.round) {
    bits.push(`Round ${floor.round}`);
    if (floor.currentName) bits.push(`${floor.currentName}'s turn`);
  }
  const ago = agoLabel(glance?.recapAt ?? campaign.updatedAt);
  if (ago) bits.push(ago);
  const fallback =
    campaign.status === "lobby"
      ? "The table is set and the seats are filling. The tale begins when the party is gathered."
      : campaign.status === "ended"
        ? "This tale has been told to its end. The chronicle keeps every page."
        : "The Dungeon Master has not spoken yet. Step in and the first scene is yours.";
  return (
    <aside className="ts-recap ts-panel ts-reveal" style={{ animationDelay: "720ms" }} aria-label="When last we left">
      <span className="ts-bracket ts-bracket-tl" aria-hidden="true" />
      <span className="ts-bracket ts-bracket-br" aria-hidden="true" />
      <span className="ts-panel-eyebrow">When last we left</span>
      {recap ? (
        <p className="ts-recap-text">
          <span className="ts-dropcap">{head}</span>
          {tail}
        </p>
      ) : (
        <p className="ts-recap-text ts-recap-quiet">{fallback}</p>
      )}
      {bits.length ? <span className="ts-mono">{bits.join(" · ")}</span> : null}
    </aside>
  );
}

// The same slot when the account has no campaigns at all. Kept word for
// word from the old dashboard: it is a statement about the account, which
// is why a failed list fetch never shows it.
export function EmptyHero({ onNewCampaign }: { onNewCampaign: () => void }) {
  return (
    <div className="ts-title-block">
      <span className="ts-eyebrow ts-reveal" style={{ animationDelay: "140ms" }}>Your first tale</span>
      <h1 className="ts-title ts-title-sm ts-reveal" style={{ animationDelay: "220ms" }}>
        <span className="ts-title-face">Every campaign starts with an empty table.</span>
      </h1>
      <p className="ts-lede ts-reveal" style={{ animationDelay: "420ms" }}>
        Create one and invite your friends, or join theirs with a room code below.
      </p>
      <div className="ts-actions ts-reveal" style={{ animationDelay: "640ms" }}>
        <button type="button" onClick={onNewCampaign} className="ts-enter motion-magnet">
          <span className="ts-enter-sheen" aria-hidden="true" />
          <Swords className="size-4" aria-hidden="true" /> Forge a new world
        </button>
      </div>
    </div>
  );
}

// The list never arrived; a table full of campaigns may still exist, so the
// empty-table words would be a lie here.
export function FailedHero({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="ts-title-block">
      <span className="ts-eyebrow ts-reveal">The road is dark</span>
      <h1 className="ts-title ts-title-sm ts-reveal" style={{ animationDelay: "120ms" }}>
        <span className="ts-title-face">Could not load your campaigns.</span>
      </h1>
      <div className="ts-actions ts-reveal" style={{ animationDelay: "200ms" }}>
        <button type="button" onClick={onRetry} className="ts-ghost motion-press">
          Try again
        </button>
      </div>
    </div>
  );
}

// The title block while the list is on the wire.
export function LoadingHero() {
  return (
    <div className="ts-title-block" aria-busy="true">
      <span className="skeleton-block h-3 w-40 rounded" />
      <span className="skeleton-block mt-3 h-14 w-full max-w-md rounded" />
      <span className="skeleton-block mt-3 h-5 w-64 rounded" />
      <span className="skeleton-block mt-5 h-12 w-48 rounded-lg" />
    </div>
  );
}
