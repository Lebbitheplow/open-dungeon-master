"use client";

import { AlertTriangle, Info } from "lucide-react";
import { useContentCampaign } from "@/lib/content-scope";
import { ui } from "@/lib/ui";

// Why an option list is short, said where the option is missing (workshop
// import audit F06): the asker's own Homebrew this table does not offer, or
// a list the server did not send, which stands on the books' own meanwhile.
// The rule behind the first is src/lib/content/scope.ts: at a table, the
// shelves of whoever runs it count, and a player's entry counts once one of
// them keeps a copy.
export function TableScopeNote({
  noun,
  unadmitted,
  failed = false,
  onRetry,
}: {
  // What the list holds, in the plural ("subclasses", "species").
  noun: string;
  unadmitted: string[];
  failed?: boolean;
  onRetry?: () => void;
}) {
  const atTable = Boolean(useContentCampaign());
  if (!failed && !unadmitted.length) {
    return null;
  }
  return (
    <div className="mt-1 space-y-1 text-xs">
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-1.5 text-amber-300/90">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Could not load {atTable ? "this table's" : "your"} {noun} from the server, so only the books&apos; own are
            listed.
          </span>
          {onRetry ? (
            <button type="button" onClick={onRetry} className={`${ui.btnSmall} min-h-10`}>
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {unadmitted.length ? (
        <p className="flex items-start gap-1.5 text-stone-400" data-testid="table-scope-unadmitted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-sky-300/70" aria-hidden="true" />
          <span>
            Your own {unadmitted.join(", ")} {unadmitted.length === 1 ? "is" : "are"} not offered at this table. Homebrew
            counts at a table when whoever runs it (the owner, the DM or the assistant DM) keeps it: send them a Workshop
            bundle with your Homebrew ticked, and it is offered here once they bring it in. In your own library it is
            offered as it is.
          </span>
        </p>
      ) : null}
    </div>
  );
}
