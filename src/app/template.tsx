import { ViewTransition } from "react";

// Every route change crossfades instead of cutting: the outgoing page fades
// while the incoming one fades and rises into place (the ::view-transition
// rules in globals.css). A template, not a layout, so it wraps each page
// afresh; React starts the transition because a navigation is one. Browsers
// without the View Transitions API, and anyone who prefers reduced motion,
// get the plain swap. The desktop and Android apps have their own router and
// do the same thing there (docs/visual-overhaul-plan.md 8d).
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
