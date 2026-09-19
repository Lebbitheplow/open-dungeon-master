import { cn } from "@/lib/cn";

// One control on the table header's brass plate (.session-cluster in
// src/app/styles/session.css). Lit gold when its feature is on, quiet
// otherwise; 40 px square below sm so it stays a finger-sized target on a
// phone. Shared by SessionHeader and VoiceDock, in its own file so neither
// has to import the other.
export function headerButtonClass(lit: boolean, className?: string) {
  return cn("session-hbtn motion-press", lit && "session-hbtn-lit", className);
}
