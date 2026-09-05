import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

// The wizard's shared field vocabulary: the same input recipe as the rest of
// the app and the two-line toggle card the old single-page dialog used for
// every on/off decision, kept so the settings read the same as they always
// did, just paced across steps.

export const inputClass = ui.input;

export function toggleClass(active: boolean) {
  return cn(
    "flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
    active
      ? "border-amber-200/40 bg-amber-200/10 text-amber-100"
      : "border-stone-800 text-stone-400 hover:border-stone-600",
  );
}

export function ToggleCard({
  active,
  onClick,
  label,
  hint,
  disabled = false,
  className,
}: {
  active: boolean;
  onClick: () => void;
  label: ReactNode;
  hint: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(toggleClass(active), disabled && "cursor-not-allowed opacity-50", className)}
    >
      <span className="block font-medium">{label}</span>
      <span className="block text-xs opacity-80">{hint}</span>
    </button>
  );
}

// Section label above a field or a group of them.
export function FieldLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("mb-1 block text-stone-400", className)}>{children}</span>;
}
