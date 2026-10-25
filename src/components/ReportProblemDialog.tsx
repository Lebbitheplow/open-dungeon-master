"use client";

import { Bug, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { readPageErrors } from "@/lib/page-errors";
import { BUG_REPORT_URL, reportFileName, withPageErrors, type OfferedPart, type ReportBundle } from "@/lib/report-bundle";
import { saveReportFile, type ReportSaved } from "@/lib/shell-report";
import { ui } from "@/lib/ui";

// "Report a problem" (issue #459), for the server's admin: they pick what
// goes in the report file, save it to this device, and the bug report form
// opens in a new tab for them to drag it into. The file is never sent
// anywhere, and nothing from it goes in the form's address. The server
// decides which tick boxes are offered and checks them again when it builds
// the file (src/lib/report-bundle.ts); the page's own errors are added
// here, from this browser.
export function ReportProblemDialog({
  open,
  onOpenChange,
  endpoint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The table's /api/campaigns/<id>/report-bundle, or Admin's.
  endpoint: string;
}) {
  const [parts, setParts] = useState<OfferedPart[] | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<ReportSaved | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { parts?: OfferedPart[]; error?: string };
        if (!live) return;
        if (!response.ok || !Array.isArray(data.parts)) {
          setError(data.error || "The report options could not be loaded.");
          return;
        }
        setParts(data.parts);
        setTicked(Object.fromEntries(data.parts.map((part) => [part.id, part.defaultOn])));
      })
      .catch(() => live && setError("The report options could not be loaded."));
    return () => {
      live = false;
    };
  }, [open, endpoint]);

  // Closing clears the last attempt, so the next opening starts afresh.
  function change(next: boolean) {
    if (!next) {
      setError("");
      setSaved(null);
    }
    onOpenChange(next);
  }

  async function save() {
    if (!parts) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: Object.fromEntries(parts.filter((part) => !part.fromBrowser).map((part) => [part.id, Boolean(ticked[part.id])])),
        }),
      });
      const data = (await response.json().catch(() => null)) as (ReportBundle & { error?: string }) | null;
      if (!response.ok || !data || data.kind !== "odm-report") {
        setError(data?.error || "The report could not be made.");
        return;
      }
      const bundle = withPageErrors(data, readPageErrors(), Boolean(ticked.pageErrors));
      let result: ReportSaved;
      try {
        result = await saveReportFile(bundle, reportFileName());
      } catch {
        setError("The report could not be saved.");
        return;
      }
      // Backing out of the app's save dialog or share sheet leaves the
      // choices as they were, to save again or cancel.
      if (!result.saved) return;
      setSaved(result);
      // The form opens once the file is saved, so the app's save dialog is
      // never left under the browser: a new tab here, the system browser in
      // the apps, with nothing from the report in its address. A blocked
      // pop-up leaves the link below to do the same.
      window.open(BUG_REPORT_URL, "_blank", "noopener,noreferrer");
    } catch {
      setError("The report could not be made.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={change} title="Report a problem" icon={<Bug className="size-4 text-amber-300" />}>
      {saved ? (
        <div className="reveal space-y-4" data-report-saved>
          <p className="text-sm leading-6 text-stone-300">
            Saved <span className="font-mono text-amber-200">{saved.name}</span> to {saved.where || "this device"}. Add it
            to the last box of the form: drop it there, or click the box and pick it. Open the file first if you want to
            see what it holds.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <a href={BUG_REPORT_URL} target="_blank" rel="noopener noreferrer" className={ui.btnSmall} data-report-form-link>
              <ExternalLink className="size-3.5" /> Open the bug report form
            </a>
            <button type="button" onClick={() => change(false)} className={ui.btnPrimary}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-report-problem-dialog>
          <p className="text-sm leading-6 text-stone-400">
            This saves a report file to this device for you to attach to a bug report on GitHub. Nothing is sent anywhere.
            It never holds other players&apos; lines, whispers, passwords or keys.
          </p>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs uppercase tracking-wide text-stone-500">What goes in the file</legend>
            {parts ? (
              parts.map((part) => (
                <label key={part.id} className="flex cursor-pointer items-start gap-2 text-sm text-stone-300" data-report-part={part.id}>
                  <input
                    type="checkbox"
                    checked={Boolean(ticked[part.id])}
                    onChange={(event) => setTicked((current) => ({ ...current, [part.id]: event.target.checked }))}
                    className="mt-1 accent-amber-400"
                  />
                  <span>
                    {part.label}
                    <span className="block text-xs text-stone-500">{part.hint}</span>
                  </span>
                </label>
              ))
            ) : error ? null : (
              <Loader2 className="size-4 animate-spin text-stone-500" aria-label="Loading" />
            )}
          </fieldset>
          {error ? <p className="motion-shake text-sm text-red-400">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => change(false)} className={ui.btnSmall} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !parts}
              aria-busy={busy}
              className={ui.btnPrimary}
              data-report-save
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Bug className="size-4" />}
              Save the report
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
