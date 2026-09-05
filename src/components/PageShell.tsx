import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PixelTile, ui } from "@/lib/ui";
import type { AccountMenuUser } from "@/components/AccountMenu";
import { AppHeader } from "@/components/AppHeader";
import { Ribbon } from "@/components/ui/Ribbon";

// The shared frame for the flat signed-in pages (settings, admin, friends,
// reference, the legal pages): AppHeader on top, one centred column, a page
// header with a pixel tile, a Cinzel title and a one-line blurb, then
// PageSection cards. Pages own their state and controls; this owns the
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
          <PixelTile src={icon} />
          <div className="min-w-0">
            <h1 className="text-balance font-display text-2xl leading-tight tracking-wide text-amber-50">
              {title}
            </h1>
            {blurb ? <p className="mt-0.5 text-pretty text-sm text-stone-500">{blurb}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-4">{children}</div>
    </Column>
  );
}

// One card in the column. The heading is an engraved eyebrow; a Ribbon can
// sit above it to mark who the section is for ("Admin only", "Irreversible").
// tone="danger" reddens the frame for destructive sections.
export function PageSection({
  heading,
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
  heading?: ReactNode;
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
      className={cn(
        ui.card,
        "texture-noise",
        padded && "p-5",
        danger && "border-red-900/50",
        className,
      )}
    >
      {hasHead ? (
        <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", !padded && "px-5 pt-5")}>
          <div className="min-w-0 space-y-1.5">
            {ribbon ? <Ribbon tone={ribbonTone}>{ribbon}</Ribbon> : null}
            {heading ? (
              <h2 className={cn(ui.sectionEyebrow, danger && "text-red-300/80")}>{heading}</h2>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
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
      <div className="flex justify-center py-10">
        <Loader2 className="size-5 animate-spin text-stone-500" aria-label="Loading" />
      </div>
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
      <p className={cn(ui.card, "p-6 text-center text-stone-400")}>{children}</p>
    </Column>
  );
}
