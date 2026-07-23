"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FileCode, FileDown, FileText, FileType, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// Story-export menu shared by the campaign Story tab and the homepage campaign
// tile. Each item downloads the player-safe story document in a format; the
// server sets Content-Disposition, so a bare anchor click saves the file.

type ExportFormat = "html" | "odt" | "docx";

const OPTIONS: { format: ExportFormat; label: string; icon: LucideIcon }[] = [
  { format: "html", label: "HTML page", icon: FileCode },
  { format: "odt", label: "OpenDocument (.odt)", icon: FileType },
  { format: "docx", label: "Word (.docx)", icon: FileText },
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
            className="rounded-md p-1 text-stone-600 opacity-0 transition-opacity hover:text-amber-300 group-hover:opacity-100"
          >
            <FileDown className="size-4" />
          </button>
        ) : (
          <button type="button" className={cn(ui.btnSmall, "w-full justify-center")}>
            <FileDown className="size-3.5" /> Export story <ChevronDown className="size-3" />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-52 rounded-lg border border-stone-600/60 bg-stone-950 p-1 shadow-elev-2"
        >
          <DropdownMenu.Label className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-stone-500">
            Export story as
          </DropdownMenu.Label>
          {OPTIONS.map((option) => (
            <DropdownMenu.Item
              key={option.format}
              onSelect={() => triggerDownload(campaignId, option.format)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-stone-300 outline-none data-[highlighted]:bg-stone-800 data-[highlighted]:text-amber-100"
            >
              <option.icon className="size-4" /> {option.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
