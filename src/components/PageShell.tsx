
import { PageSkeleton } from "@/components/PageSkeleton";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PixelTile, ui } from "@/lib/ui";
import type { AccountMenuUser } from "@/components/AccountMenu";
import { AppHeader } from "@/components/AppHeader";
import { GameIcon } from "@/components/ui/GameIcon";
import { Ribbon } from "@/components/ui/Ribbon";
import { SectionHead } from "@/components/ui/SectionHead";

// The shared frame for the flat signed-in pages (settings, admin, friends,
// reference, the legal pages): AppHeader on top, one centred column, a page
// header with a painted glyph (or the older pixel tile), a gold title and a
// one-line blurb, then PageSection cards headed by the kit SectionHead. Pages own their state and controls; this owns the
// spacing so they all line up with each other and with the home screen.
//
//   <PageShell user={me} icon={PIXEL_ICONS.characters} title="Account settings" blurb="...">
//     <PageSection heading="Profile picture">...</PageSection>
//   </PageShell>
//
// No "use client" here: the legal pages are server components and render
// this directly; AppHeader carries its own client boundary.

export type PageWidth = "narrow" | "wide";

// narrow fits a single settings column; wide is the default for lists and
// panels. Both match what the pages used before the shell existed.
const WIDTH: Record<PageWidth, string> = {
  narrow: "max-w-2xl",
  wide: "max-w-3xl",
};

function Column({
  width,
  className,
  children,
}: {
  width: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={cn("mx-auto w-full flex-1 p-4 sm:p-6", WIDTH[width], className)}>
      {children}
    </main>
  );
}

export function PageShell({
  user,
  width = "wide",
  icon,
  glyph,
  title,
  blurb,
  actions,
  className,
  children,
}: {
  // Passed straight to AppHeader: a fetched user, null for known logged out,
  // or omitted so the header asks /api/auth/me itself.
  user?: AccountMenuUser | null;
  width?: PageWidth;
  // A PIXEL_ICONS path for the tile beside the title.
  icon: string;
  // A painted glyph (a file name under public/assets/icons/glyph) that takes
  // the tile's place when given; the pixel tile stays the fallback so pages
  // that never chose one look as they did.
  glyph?: string;
  title: ReactNode;
  blurb?: ReactNode;
  // Right-side controls on the header row (a shortcut link, a back link).
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Column width={width} className={className}>
      <AppHeader user={user} />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {glyph ? (
            <GameIcon icon={{ kind: "glyph", key: glyph }} size="size-12" className="page-glyph" />
          ) : (
            <PixelTile src={icon} />
          )}
          <div className="min-w-0">
            <h1 className="gold-title animate-fade-up text-balance font-display text-2xl leading-tight sm:text-3xl">
              {title}
            </h1>
            {blurb ? <p className="mt-0.5 text-pretty text-sm text-stone-500">{blurb}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="stagger-up space-y-4">{children}</div>
    </Column>
  );
}

// One card in the column. The heading is the kit SectionHead (painted glyph,
// small-caps gold title, wiping rule) with the section's controls at its far
// end; a Ribbon can sit above it to mark who the section is for ("Admin only", "Irreversible").
// tone="danger" reddens the frame for destructive sections.
export function PageSection({
  id,
  heading,
  glyph,
  ribbon,
  ribbonTone = "gold",
  tone = "default",
  intro,
  actions,
  padded = true,
  className,
  bodyClassName,
  children,
}: {
  // An anchor a contents rail can scroll to.
  id?: string;
  heading?: ReactNode;
  // The painted glyph that leads the heading.
  glyph?: string;
  ribbon?: ReactNode;
  ribbonTone?: "gold" | "ember";
  tone?: "default" | "danger";
  intro?: ReactNode;
  // Controls on the heading row, right aligned.
  actions?: ReactNode;
  // Lists that draw their own row dividers turn padding off and pad rows.
  padded?: boolean;
  className?: string;
  // Classes for the body wrapper, for sections that space their own prose.
  bodyClassName?: string;
  children: ReactNode;
}) {
  const danger = tone === "danger";
  const hasHead = heading || ribbon || actions;
  return (
    <section
      id={id}
      className={cn(
        ui.card,
        id && "scroll-mt-16",
        "texture-noise",
        padded && "p-5",
        danger && "danger-zone",
        className,
      )}
    >
      {hasHead ? (
        <div className={cn("space-y-2", !padded && "px-5 pt-5")}>
          {ribbon ? <Ribbon tone={ribbonTone}>{ribbon}</Ribbon> : null}
          {heading ? (
            <SectionHead
              level="h2"
              title={heading}
              glyph={glyph}
              aside={actions}
              className={cn("mb-0", danger && "section-head-danger")}
            />
          ) : actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {intro ? (
        <p className={cn("mt-2 text-sm leading-6 text-stone-400", !padded && "px-5")}>{intro}</p>
      ) : null}
      <div className={cn(hasHead || intro ? "mt-3" : undefined, bodyClassName)}>{children}</div>
    </section>
  );
}

// Centred spinner in the same column, for a page still fetching its user.
export function PageLoading({ width = "wide" }: { width?: PageWidth }) {
  return (
    <Column width={width}>
      <PageSkeleton kind="flat" className="px-0 py-2" />
    </Column>
  );
}

// A gate message in the same column ("Log in to manage your account"). The
// header still shows the account menu when the viewer is signed in but not
// allowed here (a non-admin on /admin), so pass the user through.
export function PageNotice({
  width = "wide",
  user,
  children,
}: {
  width?: PageWidth;
  user?: AccountMenuUser | null;
  children: ReactNode;
}) {
  return (
    <Column width={width}>
      <AppHeader user={user} />
      <div className={cn(ui.card, "ornate texture-noise flex flex-col items-center gap-3 px-6 py-8 text-center")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/ui/empty-notice-board.webp" alt="" className="h-24 w-32 object-contain opacity-90" />
        <p className="max-w-prose text-pretty font-serif text-sm leading-6 text-stone-300">{children}</p>
      </div>
    </Column>
  );
}
