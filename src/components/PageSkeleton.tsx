import { cn } from "@/lib/cn";

// A route's shape while its data loads (docs/visual-overhaul-plan.md 8c.3 and
// 8d.2): the page's real layout with shimmering parchment blocks where the
// text will be, instead of one spinner in the middle of nothing. One file, a
// switch over kinds, so a new page picks the nearest shape.
export type SkeletonKind = "home" | "lobby" | "table" | "roster" | "sheet" | "shelf" | "hub" | "list" | "flat";

function Block({ className }: { className?: string }) {
  return <div className={cn("skeleton-block rounded-lg", className)} />;
}

function Cards({ count, className, cell }: { count: number; className: string; cell: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} className={cell} />
      ))}
    </div>
  );
}

function Lines({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} className={cn("h-3.5", i % 3 === 2 ? "w-2/3" : i % 3 === 1 ? "w-5/6" : "w-full")} />
      ))}
    </div>
  );
}

export function PageSkeleton({ kind = "flat", className }: { kind?: SkeletonKind; className?: string }) {
  const shell = cn("mx-auto w-full animate-overlay-soft px-4 py-6", className);
  if (kind === "table") {
    return (
      <div className="flex h-dvh w-full animate-overlay-soft flex-col" aria-busy="true" aria-label="Loading the table">
        <Block className="m-2 h-12 rounded-xl" />
        <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-1 flex-col gap-3 rounded-xl p-4">
            <Lines count={5} />
            <Block className="h-24 w-4/5" />
            <Lines count={3} />
            <Block className="mt-auto h-20 rounded-xl" />
          </div>
          <Block className="hidden w-[24rem] rounded-xl lg:block" />
        </div>
      </div>
    );
  }
  return (
    <div className={cn(shell, kind === "hub" || kind === "shelf" ? "max-w-5xl" : "max-w-3xl")} aria-busy="true" aria-label="Loading">
      <div className="mb-6 flex items-center gap-3">
        <Block className="size-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Block className="h-5 w-56 max-w-full" />
          <Block className="h-3 w-40 max-w-full" />
        </div>
      </div>
      {kind === "home" ? (
        <>
          <Block className="mb-6 h-56 rounded-xl" />
          <Cards count={5} className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5" cell="h-28 rounded-xl" />
          <Cards count={2} className="grid gap-4 sm:grid-cols-2" cell="h-72 rounded-xl" />
        </>
      ) : kind === "lobby" ? (
        <>
          <Block className="mb-4 h-44 rounded-xl" />
          <Block className="mb-4 h-24 rounded-xl" />
          <Cards count={3} className="space-y-3" cell="h-20 rounded-xl" />
        </>
      ) : kind === "roster" ? (
        <Cards count={4} className="grid gap-4 sm:grid-cols-2" cell="h-36 rounded-xl" />
      ) : kind === "sheet" ? (
        <>
          <Block className="mb-4 h-48 rounded-xl" />
          <Cards count={6} className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6" cell="h-20 rounded-lg" />
          <Cards count={3} className="space-y-3" cell="h-24 rounded-xl" />
        </>
      ) : kind === "shelf" ? (
        <Cards count={6} className="grid grid-cols-2 gap-4 md:grid-cols-3" cell="aspect-[5/4] rounded-xl" />
      ) : kind === "hub" ? (
        <>
          <Block className="mb-5 h-14 rounded-xl" />
          <Cards count={10} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" cell="h-40 rounded-xl" />
        </>
      ) : kind === "list" ? (
        <Cards count={6} className="space-y-2.5" cell="h-14 rounded-lg" />
      ) : (
        <>
          <Block className="mb-4 h-32 rounded-xl" />
          <Lines count={6} />
        </>
      )}
    </div>
  );
}
