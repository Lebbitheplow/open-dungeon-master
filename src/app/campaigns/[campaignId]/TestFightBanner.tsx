"use client";

import Link from "next/link";
import { useState } from "react";
import { appConfirm } from "@/components/ui/ConfirmDialog";
import { SessionBanner, bannerButtonClass } from "@/app/campaigns/[campaignId]/SessionBanner";
import { PanelError } from "@/app/campaigns/[campaignId]/PanelKit";
import { navigateTo } from "@/lib/navigation";
import { workshopHref } from "@/lib/workshop/links";

// The test fight's way back (issue 553, src/lib/workshop/test-fight.ts): a
// test table is in no campaign list, so the table itself says what it is and
// offers the two ways out. Back keeps the test for later, from the
// workshop's Encounters; End deletes the table and everything played on it.

export function TestFightBanner({
  campaignId,
  source,
  runsIt,
}: {
  campaignId: string;
  source: { workshopId: string; title: string };
  // Who runs the enemies: the AI DM, or the author from the DM seat.
  runsIt: "ai" | "person";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const back = workshopHref(`/workshop/${source.workshopId}`, { system: "encounters" });

  async function end() {
    if (
      !(await appConfirm("End this test fight? Its table and everything played on it are deleted. The prepared fight stays in the workshop.", {
        title: "End the test",
        actionLabel: "End the test",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      const payload = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
      setError(payload?.error ?? (response ? "The test could not be ended." : "Could not reach the server, so the test is still open."));
      setBusy(false);
      return;
    }
    navigateTo(back);
  }

  return (
    <SessionBanner
      glyph="tab-battle"
      title="Test fight"
      className="test-fight-banner"
      actions={
        <>
          <Link href={back} className={bannerButtonClass()}>
            Back to the workshop
          </Link>
          <button type="button" disabled={busy} aria-busy={busy} onClick={() => void end()} className={bannerButtonClass(true)}>
            End the test
          </button>
        </>
      }
    >
      {runsIt === "ai"
        ? `From ${source.title}. Only you can see this table: the AI DM runs the enemies and you play the party, each hero on their own turn.`
        : `From ${source.title}. Only you can see this table, and you run it: the party's cards on each hero's turn, the enemies' cards on theirs.`}
      {error ? <PanelError className="mt-1 text-[11px]">{error}</PanelError> : null}
    </SessionBanner>
  );
}
