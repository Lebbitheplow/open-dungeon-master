import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Full-width "continue" card: cover art fills the top on phones and the left
// from md, fading into the panel under a dark gradient; eyebrow, Cinzel
// title, a single line and the call to action sit beside it.
//
//   <HeroCard
//     eyebrow="Continue"
//     title={campaign.name}
//     line="Chapter 3, the Sunken Vault"
//     art={<img src={cover} alt="" className="size-full object-cover" />}
//     chip={<HostChip label="Kaleb's phone" status="online" />}
//     action={<Link href={url} className={ui.btnPrimary}>Rejoin</Link>}
//   />
export function HeroCard({
  eyebrow,
  title,
  line,
  art,
  chip,
  action,
  className,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  line: ReactNode;
  art: ReactNode;
  chip?: ReactNode;
  action: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "panel ornate flex w-full flex-col overflow-hidden rounded-xl md:flex-row",
        className,
      )}
    >
      <div className="relative h-44 shrink-0 md:h-auto md:w-2/5 md:min-h-56">
        <div className="absolute inset-0 bg-stone-950">{art}</div>
        {/* The gradient runs the same direction the card stacks, so the art
            always dissolves into the text side rather than the outer edge. */}
        <div
          className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/40 to-transparent md:bg-gradient-to-r"
          aria-hidden="true"
        />
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col gap-2 p-5 md:justify-center md:p-6">
        <span className="eyebrow text-[10px] text-amber-400/80">{eyebrow}</span>
        <h2 className="font-display text-2xl leading-tight tracking-wide text-amber-100">{title}</h2>
        <p className="truncate text-sm text-stone-400">{line}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {action}
          {chip}
        </div>
      </div>
    </article>
  );
}
