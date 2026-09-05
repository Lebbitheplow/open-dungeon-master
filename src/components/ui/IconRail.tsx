"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";
import { Tooltip } from "@/components/ui/Tooltip";

// Icon rail: a column (or a sideways-scrolling row) of icon-over-label cells.
// The active cell glows gold, or ember when the item carries the ember
// accent (the party lead). Items can show a count badge or a small dot.
//
//   <IconRail
//     items={[{ value: "chat", label: "Chat", icon: MessageSquare, badge: unread }]}
//     value={tab}
//     onChange={setTab}
//     tipSide="right"
//   />
//
// Tooltips only open for items with a tip. tipSide should point away from
// the edge the rail sits on; it defaults to right for a vertical rail and
// bottom for a horizontal one.

export type IconRailItem<T extends string = string> = {
  value: T;
  label: ReactNode;
  icon: LucideIcon;
  tip?: ReactNode;
  badge?: number;
  dot?: "red" | "amber";
  accent?: "gold" | "ember";
};

export function IconRail<T extends string>({
  items,
  value,
  onChange,
  orientation = "vertical",
  tipSide,
  className,
}: {
  items: IconRailItem<T>[];
  value: T;
  onChange: (value: T) => void;
  orientation?: "vertical" | "horizontal";
  tipSide?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  const vertical = orientation === "vertical";
  const side = tipSide ?? (vertical ? "right" : "bottom");
  return (
    <nav
      className={cn(
        "flex gap-1",
        vertical ? "flex-col" : "flex-row overflow-x-auto [scrollbar-width:none]",
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.value === value;
        const ember = item.accent === "ember";
        const cell = (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              ui.railCell,
              !vertical && "flex-1",
              // A lead who is not the active tab still reads warm, so the
              // ember cell stands out from the rest of the rail at a glance.
              ember && !active && "text-ember-400/70 hover:text-ember-300",
              active && (ember ? ui.railCellActiveEmber : ui.railCellActive),
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className="eyebrow text-[9px] leading-none">{item.label}</span>
            {item.dot ? (
              <span
                className={cn(
                  "absolute left-1.5 top-1 size-1.5 rounded-full",
                  item.dot === "red" ? "bg-red-500" : "bg-amber-400",
                )}
                aria-hidden="true"
              />
            ) : null}
            {item.badge ? (
              <span
                className={cn(
                  "absolute right-1.5 top-1 rounded-full px-1 text-[9px] font-semibold",
                  ember
                    ? "bg-gradient-to-b from-ember-300 to-ember-500 text-stone-950 shadow-glow-ember"
                    : "bg-gradient-to-b from-amber-300 to-amber-500 text-amber-950 shadow-glow-gold",
                )}
              >
                {item.badge}
              </span>
            ) : null}
            {active ? (
              <span
                className={cn(
                  "absolute from-transparent to-transparent",
                  ember ? "via-ember-400/80" : "via-amber-400/80",
                  vertical
                    ? "-right-[5px] top-2 bottom-2 w-px bg-gradient-to-b"
                    : "-bottom-[5px] h-px w-8 bg-gradient-to-r",
                )}
                aria-hidden="true"
              />
            ) : null}
          </button>
        );
        return item.tip ? (
          <Tooltip key={item.value} content={item.tip} side={side}>
            {cell}
          </Tooltip>
        ) : (
          cell
        );
      })}
    </nav>
  );
}
