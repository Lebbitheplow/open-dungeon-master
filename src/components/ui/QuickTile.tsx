import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { IconChip, ui } from "@/lib/ui";

// Square-ish quick-action tile: gold icon chip over a Cinzel label, lifts on
// hover. Renders a Link when given an href, otherwise a button.
//
//   <QuickTile icon={Plus} label="New campaign" href="/campaigns/new" />
//   <QuickTile icon={Dice5} label="Roll" onClick={roll} />
export function QuickTile({
  icon,
  label,
  href,
  onClick,
  disabled = false,
  className,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const classes = cn(
    ui.tile,
    ui.tileHover,
    "aspect-[5/4] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40",
    disabled && "pointer-events-none opacity-50",
    className,
  );
  const body = (
    <>
      <IconChip icon={icon} size="size-10" iconSize="size-5" />
      <span className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-stone-200">
        {label}
      </span>
    </>
  );
  if (href && !disabled) {
    return (
      <Link href={href} onClick={onClick} className={classes}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={classes}>
      {body}
    </button>
  );
}
