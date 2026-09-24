"use client";

import Link from "next/link";
import { GameIcon } from "@/components/ui/GameIcon";

// The title screen's menu, the way a game's main menu lists its doors:
// diamond bullets, Cinzel, the painted glyph rising beside the line you
// hover. Solo adventure disappears rather than greying out when the server
// has no story model: a solo table is nothing without the AI storyteller,
// and a dead line explains nothing. The tour anchors are the ones the
// shells' own home tiles carry, so a guide can point at either.
export function HomeMenu({
  onNewCampaign,
  onSolo,
  showSolo,
  onJoin,
}: {
  onNewCampaign: () => void;
  onSolo: () => void;
  showSolo: boolean;
  onJoin: () => void;
}) {
  const items: Array<{ id: string; label: string; glyph: string; href?: string; onClick?: () => void; tour: string }> = [
    { id: "new", label: "New campaign", glyph: "tab-campaigns", onClick: onNewCampaign, tour: "tile-new-campaign" },
    ...(showSolo ? [{ id: "solo", label: "Solo adventure", glyph: "tab-story", onClick: onSolo, tour: "tile-solo" }] : []),
    { id: "characters", label: "Characters", glyph: "tab-characters", href: "/characters", tour: "tile-characters" },
    { id: "workshop", label: "Workshop", glyph: "system-homebrew", href: "/workshop", tour: "tile-workshop" },
    { id: "join", label: "Join with a code", glyph: "tab-handout", onClick: onJoin, tour: "tile-join" },
  ];
  return (
    <nav className="ts-menu" aria-label="Main menu">
      {items.map((item, index) => {
        const body = (
          <>
            <span className="ts-menu-diamond" aria-hidden="true" />
            <span className="ts-menu-label">{item.label}</span>
            <span className="ts-menu-glyph" aria-hidden="true">
              <GameIcon icon={{ kind: "glyph", key: item.glyph }} size="size-9" />
            </span>
          </>
        );
        const style = { animationDelay: `${800 + index * 55}ms` };
        return item.href ? (
          <Link key={item.id} href={item.href} className="ts-menu-item ts-reveal" data-tour={item.tour} style={style} data-no-motion>
            {body}
          </Link>
        ) : (
          <button key={item.id} type="button" onClick={item.onClick} className="ts-menu-item ts-reveal" data-tour={item.tour} style={style} data-no-motion>
            {body}
          </button>
        );
      })}
    </nav>
  );
}
