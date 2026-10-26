"use client";

import { Suspense, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { PanelLoading } from "@/app/campaigns/[campaignId]/side-panel-loaders";

// A running campaign's prep, laid over the table (issue 530). The table
// stays mounted and laid out underneath, made inert while this is open, so
// the voice call in the header, the board, the chronicle's place and the
// side panels are all as they were on the way back: nothing is torn down,
// nothing reloads. The header stays live above it (the call's controls, the
// way out, Back to the table). Placed from the header's foot, measured,
// because the header's height changes with the phone's safe area and the
// fight ribbon.
export function PrepLayer({ children, leaving = false }: { children: ReactNode; leaving?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const layer = ref.current;
    const header = layer?.parentElement?.querySelector<HTMLElement>(":scope > .session-header");
    if (!layer || !header) return;
    const measure = () => setTop(header.offsetTop + header.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    // The keyboard lands on the prep, not on the hidden table behind it.
    layer.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="session-prep"
      style={top === null ? undefined : { top }}
      role="region"
      aria-label="Campaign prep"
      tabIndex={-1}
      data-campaign-prep-screen=""
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
    >
      <Suspense fallback={<PanelLoading />}>{children}</Suspense>
    </div>
  );
}
