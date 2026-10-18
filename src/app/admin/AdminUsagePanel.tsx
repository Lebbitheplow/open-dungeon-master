"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { PageSkeleton } from "@/components/PageSkeleton";
import { SectionHead } from "@/components/ui/SectionHead";
import type { AccountUsage, CampaignUsage, UsageTotals } from "@/lib/usage/ledger";
import type { ModelCallSummary } from "@/lib/usage/model-calls";

type Overview = { campaigns: CampaignUsage[]; accounts: AccountUsage[]; generatedAt: string; modelCalls?: ModelCallSummary[] };

function seconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(ms >= 10_000 ? 0 : 1)}s`;
}

// 1234 -> "1.2k", 1234567 -> "1.2M"; whole numbers below a thousand.
function compact(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  }
  return String(Math.round(n));
}

function bytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (n >= 1024 * 1024) {
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (n >= 1024) {
    return `${Math.round(n / 1024)} KB`;
  }
  return n ? `${n} B` : "0";
}

function when(at: string | null): string {
  return at ? new Date(at).toLocaleDateString() : "never";
}

// The five usage columns every row shares: paid tokens, local tokens,
// pictures, speech, agent turns. "in/out" reads as tokens sent and tokens
// back; a dash is a clean zero.
function tokens(input: number, output: number): string {
  return input || output ? `${compact(input)} in / ${compact(output)} out` : "–";
}

function pictures(paid: number, local: number): string {
  if (!paid && !local) {
    return "–";
  }
  return [paid ? `${compact(paid)} paid` : "", local ? `${compact(local)} local` : ""].filter(Boolean).join(", ");
}

function speech(totals: UsageTotals): string {
  const parts = [
    totals.paidSpeechChars || totals.localSpeechChars
      ? `${compact(totals.paidSpeechChars + totals.localSpeechChars)} chars${totals.paidSpeechChars ? ` (${compact(totals.paidSpeechChars)} paid)` : ""}`
      : "",
    totals.paidDictationClips || totals.localDictationClips
      ? `${compact(totals.paidDictationClips + totals.localDictationClips)} clips${totals.paidDictationClips ? ` (${compact(totals.paidDictationClips)} paid)` : ""}`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "–";
}

const th = "px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-stone-500";
const td = "px-2 py-1.5 align-top text-xs text-stone-300 tabular-nums";

function UsageCells({ totals }: { totals: UsageTotals }) {
  return (
    <>
      <td className={td} title="Tokens on this server's keyed backends and the agent program">
        {tokens(totals.paidInputTokens, totals.paidOutputTokens)}
      </td>
      <td className={td} title="Tokens on local backends">
        {tokens(totals.localInputTokens, totals.localOutputTokens)}
      </td>
      <td className={td}>{pictures(totals.paidImages, totals.localImages)}</td>
      <td className={td}>{speech(totals)}</td>
      <td className={td}>{totals.agentTurns || "–"}</td>
    </>
  );
}

// What the server's AI has been spent on, by account and by campaign
// (issue #137). Counts come from what each backend reported; nothing here
// was read out of a prompt or a transcript, and no price is guessed.
export function AdminUsagePanel() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // State moves only once the answer is in, so the first load inside the
  // effect sets nothing synchronously.
  const load = useCallback(() => {
    return fetch("/api/admin/usage")
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as (Overview & { error?: string }) | null;
        if (!response.ok || !data) {
          setError(data?.error || "Could not load usage.");
          return;
        }
        setError("");
        setOverview(data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    setLoading(true);
    void load();
  };

  if (loading && !overview) {
    return <PageSkeleton />;
  }

  const accounts = [...(overview?.accounts ?? [])].sort(
    (a, b) => b.paidInputTokens + b.paidOutputTokens - (a.paidInputTokens + a.paidOutputTokens) || b.calls - a.calls,
  );
  const campaigns = [...(overview?.campaigns ?? [])].sort(
    (a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-400">
        Tokens, pictures and speech are counted from what each backend reports. &ldquo;Paid&rdquo; is what ran on this
        server&rsquo;s key or the agent program; &ldquo;local&rdquo; ran on a backend of your own. No prompt or
        transcript is kept for this, and no cost is estimated: apply the prices of the backend you pay for.
      </p>
      {error ? <p role="alert" className="motion-shake text-sm text-red-400">{error}</p> : null}
      <div className="flex items-center gap-2 text-xs text-stone-500">
        {overview ? <span>As of {new Date(overview.generatedAt).toLocaleTimeString()}</span> : null}
        <button type="button" className={ui.btnSmall} onClick={refresh} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
        </button>
      </div>

      <section className="panel texture-noise rounded-xl p-5">
        <SectionHead
          level="h2"
          title="Accounts"
          glyph="tab-party"
          aside={<span className="count-pop tabular-nums">{accounts.length}</span>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={th}>Account</th>
                <th className={th}>Campaigns</th>
                <th className={th}>Characters</th>
                <th className={th}>Last active</th>
                <th className={th}>Storage</th>
                <th className={th}>Paid tokens</th>
                <th className={th}>Local tokens</th>
                <th className={th}>Pictures</th>
                <th className={th}>Speech</th>
                <th className={th}>Agent turns</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.userId} className="border-t border-stone-800/60">
                  <td className={td}>
                    <span className="text-stone-100">{account.username}</span>
                    {account.isAdmin ? <span className="ml-1 text-[10px] uppercase text-amber-300/80">admin</span> : null}
                  </td>
                  <td className={td} title="owned / led / joined">
                    {account.campaignsOwned} / {account.campaignsLed} / {account.campaignsJoined}
                  </td>
                  <td className={td}>{account.libraryCharacters}</td>
                  <td className={td}>{when(account.lastActivityAt)}</td>
                  <td className={td}>{bytes(account.storageBytes)}</td>
                  <UsageCells totals={account} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-stone-500">
          Campaigns: owned / led / joined. What a campaign spends is counted for its party lead, as the paid AI setting
          decides by the lead; storage is the account&rsquo;s own characters plus the campaigns it owns.
        </p>
      </section>

      <section className="panel texture-noise rounded-xl p-5">
        <SectionHead
          level="h2"
          title="Campaigns"
          glyph="tab-campaigns"
          aside={<span className="count-pop tabular-nums">{campaigns.length}</span>}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={th}>Campaign</th>
                <th className={th}>Lead</th>
                <th className={th}>Members</th>
                <th className={th}>Characters</th>
                <th className={th}>DM turns</th>
                <th className={th}>Active days</th>
                <th className={th}>Last activity</th>
                <th className={th}>Storage</th>
                <th className={th}>Paid tokens</th>
                <th className={th}>Local tokens</th>
                <th className={th}>Pictures</th>
                <th className={th}>Speech</th>
                <th className={th}>Agent turns</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.campaignId} className="border-t border-stone-800/60">
                  <td className={td}>
                    <span className="text-stone-100">{campaign.title}</span>
                    <span className="ml-1 text-[10px] uppercase text-stone-500">
                      {campaign.kind === "workshop" ? "workshop" : campaign.status}
                    </span>
                  </td>
                  <td className={td}>{campaign.leadUsername || "–"}</td>
                  <td className={td}>{campaign.members}</td>
                  <td className={td}>{campaign.characters}</td>
                  <td className={td}>{campaign.turns || "–"}</td>
                  <td className={td}>{campaign.activeDays || "–"}</td>
                  <td className={td}>{when(campaign.lastActivityAt)}</td>
                  <td className={td}>{bytes(campaign.storageBytes)}</td>
                  <UsageCells totals={campaign} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-stone-500">
          Active days are days with at least one DM turn, which is a count of play rather than hours. Storage is every
          picture and file the campaign&rsquo;s rows name, with the resized copies beside each.
        </p>
      </section>

      {overview?.modelCalls?.length ? (
        <section className="panel texture-noise rounded-xl p-5" data-testid="model-calls">
          <SectionHead
            level="h2"
            title="Model calls, last 7 days"
            glyph="tab-context"
            aside={<span className="count-pop tabular-nums">{overview.modelCalls.reduce((sum, row) => sum + row.calls, 0)}</span>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={th}>For</th>
                  <th className={th}>Calls</th>
                  <th className={th}>Failed</th>
                  <th className={th}>Fell back</th>
                  <th className={th}>Median</th>
                  <th className={th}>95th</th>
                  <th className={th}>First words</th>
                  <th className={th}>Input</th>
                  <th className={th}>Cached</th>
                  <th className={th}>Output</th>
                  <th className={th}>Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {overview.modelCalls.map((row) => (
                  <tr key={row.task} className="border-t border-stone-800/60">
                    <td className={td}>
                      <span className="text-stone-100">{row.task.replaceAll("_", " ")}</span>
                    </td>
                    <td className={td}>{row.calls}</td>
                    <td className={td}>{row.errors || "–"}</td>
                    <td className={td}>{row.fallbacks || "–"}</td>
                    <td className={td}>{seconds(row.p50Ms)}</td>
                    <td className={td}>{seconds(row.p95Ms)}</td>
                    <td className={td}>{seconds(row.p50FirstTokenMs)}</td>
                    <td className={td}>{row.avgInputTokens === null ? "–" : compact(row.avgInputTokens)}</td>
                    <td className={td}>{row.cachedShare === null ? "–" : `${Math.round(row.cachedShare * 100)}%`}</td>
                    <td className={td}>{row.avgOutputTokens === null ? "–" : compact(row.avgOutputTokens)}</td>
                    <td className={td}>{row.avgReasoningTokens === null ? "–" : compact(row.avgReasoningTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-stone-500">
            One row per kind of call: the DM&rsquo;s turns, the reader, summaries, Ask and the rest. Times are medians and
            the 95th percentile; input, output and reasoning are averages of what the backends reported; cached is the
            share of input a backend said it served from its prompt cache, where it says. A dash is a figure no backend
            reported. Kept 30 days, with no prompt or reply text.
          </p>
        </section>
      ) : null}
    </div>
  );
}
