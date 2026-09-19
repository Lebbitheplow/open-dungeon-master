"use client";

import { BookOpen, Hammer, KeyRound, Plus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { QuickTile } from "@/components/ui/QuickTile";

// The row of first thoughts under the hero. Solo adventure disappears
// rather than greying out when the server has no story model: a solo table
// is nothing without the AI storyteller, and a dead tile explains nothing.
export function QuickTiles({
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
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3",
        showSolo ? "md:grid-cols-5" : "md:grid-cols-4",
      )}
    >
      <QuickTile icon={Plus} glyph="tab-campaigns" label="New campaign" onClick={onNewCampaign} />
      {showSolo ? <QuickTile icon={BookOpen} glyph="tab-story" label="Solo adventure" onClick={onSolo} /> : null}
      <QuickTile icon={Users} glyph="tab-characters" label="Characters" href="/characters" />
      <QuickTile icon={Hammer} glyph="system-homebrew" label="Workshop" href="/workshop" />
      <QuickTile icon={KeyRound} glyph="tab-handout" label="Join with a code" onClick={onJoin} />
    </div>
  );
}
