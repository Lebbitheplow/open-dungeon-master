"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FileCode, FileDown, FileText, FileType, type LucideIcon } from "lucide-react";
import { GameIcon } from "@/components/ui/GameIcon";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// Story-export menu shared by the campaign Story tab and the homepage campaign
// tile. Each item downloads the player-safe story document in a format; the
// server sets Content-Disposition, so a bare anchor click saves the file.

type ExportFormat = "html" | "odt" | "docx";

const OPTIONS: { format: ExportFormat; label: string; hint: string; icon: LucideIcon }[] = [
  { format: "html", label: "HTML page", hint: "Opens in any browser", icon: FileCode },
  { format: "odt", label: "OpenDocument (.odt)", hint: "LibreOffice Writer", icon: FileType },
  { format: "docx", label: "Word (.docx)", hint: "Microsoft Word", icon: FileText },
];

function triggerDownload(campaignId: string, format: ExportFormat) {
  const anchor = document.createElement("a");
  anchor.href = `/api/campaigns/${campaignId}/export?format=${format}`;
  anchor.download = "";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function ExportMenu({
  campaignId,
  variant = "button",
}: {
  campaignId: string;
  variant?: "button" | "tile-icon";
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {variant === "tile-icon" ? (
          <button
            type="button"
            aria-label="Export this campaign's story"
            // The tile is a link; keep the click from navigating the card.
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className={cn(ui.iconAction, "hover:text-amber-300")}
          >
            <FileDown className="size-4" />
          </button>
        ) : (
          <button type="button" className={cn(ui.btnSmall, "w-full justify-center")}>
            <GameIcon icon={{ kind: "glyph", key: "tab-story" }} size="size-5" /> Export story{" "}
            <ChevronDown className="size-3" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="panel z-50 min-w-56 rounded-lg p-1.5"
        >
          <DropdownMenu.Label className="ctx-menu-label gold-title">Export story as</DropdownMenu.Label>
          {OPTIONS.map((option) => (
            <DropdownMenu.Item
              key={option.format}
              onSelect={() => triggerDownload(campaignId, option.format)}
              className="session-menu-row"
            >
              <option.icon className="size-4 shrink-0 text-amber-300/80" />
              <span className="min-w-0">
                {option.label}
                <span className="session-menu-hint">{option.hint}</span>
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
