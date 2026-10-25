"use client";

import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SectionHead } from "@/components/ui/SectionHead";
import { downloadBlob } from "@/lib/download";
import type { NarratorQualityOverview } from "@/lib/narrator-quality-server";
import type { QualityGroup } from "@/lib/narrator-quality";
import type { DmMode } from "@/lib/dm/viewer";
import { ui } from "@/lib/ui";

// Admin > Usage > Narrator quality (issue #460): how the AI's turns ended
// and what tables had to fix, one row per backend class and DM mode. Rates
// are only compared within a row: the people who send these lean towards
// those who know the rules, and a table that trusts the AI looks cleaner
// than it is. The export is what a tester attaches to a session report
// (docs/testing.md).

const th = "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-stone-500";
const td = "px-2 py-1.5 align-top text-xs text-stone-300 tabular-nums";

const BACKEND_LABELS: Record<QualityGroup["backendClass"], string> = {
  local: "Local backend",
  api: "Hosted API",
  agent: "Agent program",
  unknown: "Not known",
};

const MODE_LABELS: Record<DmMode, string> = {
  ai: "AI DM",
  steered: "Steered",
  human: "Human DM",
  assisted: "Assisted",
};

function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

function count(value: number): string {
  return value ? String(value) : "–";
}

function exportName(now = new Date()): string {
  return `odm-narrator-quality-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
}

export function AdminNarratorQualityCard() {
  const [overview, setOverview] = useState<NarratorQualityOverview | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/narrator-quality")
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as (NarratorQualityOverview & { error?: string }) | null;
        if (cancelled) return;
        if (!response.ok || !data) {
          setError(data?.error || "Could not load narrator quality.");
          return;
        }
        setOverview(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const exportRows = async () => {
    setExporting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/narrator-quality?export=1");
      if (!response.ok) {
        setError("Could not export narrator quality.");
        return;
      }
      const text = `${JSON.stringify(await response.json(), null, 2)}\n`;
      downloadBlob(exportName(), new Blob([text], { type: "application/json" }));
    } catch {
      setError("Could not reach the server.");
    } finally {
      setExporting(false);
    }
  };

  const groups = overview?.groups ?? [];

  return (
    <section className="panel texture-noise rounded-xl p-5" data-narrator-quality="">
      <SectionHead
        level="h2"
        title="Narrator quality"
        glyph="tab-context"
        aside={<span className="count-pop tabular-nums">{overview?.turns ?? 0}</span>}
      />
      <p className="mb-3 text-xs text-stone-400">
        How the AI&rsquo;s turns ended and what tables fixed, one row per kind of backend and DM mode. Compare rates
        within a row, never across: it counts only the mistakes someone noticed.
      </p>
      {error ? <p role="alert" className="mb-2 text-sm text-red-400">{error}</p> : null}
      {overview && !groups.length ? (
        <p className="text-sm text-stone-400" data-narrator-quality-empty="">
          No AI turn has ended since this server began keeping these.
        </p>
      ) : null}
      {groups.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={th}>Backend</th>
                <th className={th}>DM mode</th>
                <th className={th}>Turns</th>
                <th className={th}>Clean</th>
                <th className={th}>Failed</th>
                <th className={th}>Tool refused</th>
                <th className={th}>Hit a cap</th>
                <th className={th}>Guard acted</th>
                <th className={th}>Not checked</th>
                <th className={th}>Corrected</th>
                <th className={th}>Rewound</th>
                <th className={th}>Most corrected</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.backendClass}:${group.dmMode}`} className="border-t border-stone-800/60" data-quality-group={`${group.backendClass}:${group.dmMode}`}>
                  <td className={td}>
                    <span className="text-stone-100">{BACKEND_LABELS[group.backendClass]}</span>
                  </td>
                  <td className={td}>{MODE_LABELS[group.dmMode]}</td>
                  <td className={td}>{group.turns}</td>
                  <td className={td} data-quality-clean="">{percent(group.clean, group.turns)}</td>
                  <td className={td}>{count(group.failed)}</td>
                  <td className={td}>{count(group.refused)}</td>
                  <td className={td}>{count(group.capped)}</td>
                  <td className={td}>{count(group.guardFired)}</td>
                  <td className={td} title="The prose reader failed, or the table turned the outcome check off">{count(group.unchecked)}</td>
                  <td className={td}>{group.correctionsCounted ? percent(group.corrected, group.turns) : "not counted"}</td>
                  <td className={td}>{count(group.rolledBack)}</td>
                  <td className={td} data-quality-tools="">
                    {group.tools.length
                      ? group.tools.map((tool) => `${tool.tool.replaceAll("_", " ")} (${tool.corrections})`).join(", ")
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="mt-2 text-[11px] text-stone-500">
        {overview?.rule ?? ""} Corrected and the tools leave out fixes marked &ldquo;changed my mind&rdquo;. At a table a
        person runs, fixes are running the table and are not counted.
        {overview?.earlierCorrections ? ` ${overview.earlierCorrections} fixes belong to turns that ended before this was kept.` : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={ui.btnSmall} onClick={exportRows} disabled={exporting} data-narrator-quality-export="">
          {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export narrator quality
        </button>
        <span className="text-[11px] text-stone-500">
          One file of these rows, with every id hashed and no names, prompts or story text. Saved here, never sent.
        </span>
      </div>
    </section>
  );
}
