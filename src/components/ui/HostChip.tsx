import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

// Small pill naming a host with a live status dot: emerald pulse when online,
// amber pulse while starting, stone when offline or unknown.
//
//   <HostChip label="Kaleb's phone" status="online" icon={Smartphone} />
export type HostStatus = "online" | "offline" | "starting" | "unknown";

const DOT: Record<HostStatus, string> = {
  online: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)] animate-pulse",
  starting: "bg-amber-400 shadow-[0_0_8px_rgba(227,193,92,0.6)] animate-pulse",
  offline: "bg-stone-600",
  unknown: "bg-stone-600/60",
};

const LABEL: Record<HostStatus, string> = {
  online: "Online",
  starting: "Starting",
  offline: "Offline",
  unknown: "Status unknown",
};

export function HostChip({
  label,
  status = "unknown",
  icon: Icon,
  className,
}: {
  label: string;
  status?: HostStatus;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-stone-700/70 bg-stone-900/60 py-0.5 pl-2 pr-2.5 text-xs text-stone-300",
        className,
      )}
      title={LABEL[status]}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[status])} aria-hidden="true" />
      {Icon ? <Icon className="size-3.5 shrink-0 text-stone-400" aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
      <span className="sr-only">, {LABEL[status]}</span>
    </span>
  );
}
