"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { CopyLine } from "@/components/CopyLine";
import { shellHost } from "@/lib/shell-host";
import type { Draft } from "@/app/setup/draft";
import { ModelPicker } from "@/app/setup/SetupParts";
import type { HarnessId, HarnessStatus } from "@/lib/harness/types";

type Update = (change: (draft: Draft) => Draft) => void;

const MARKS: Record<HarnessId, string> = { claude: "CC", codex: "Cx", opencode: "oc", grok: "Gk" };

function statusTone(status: HarnessStatus): { tone: "ready" | "warn" | "off"; text: string } {
  if (status.availability !== "ok") return { tone: "off", text: "Not available here" };
  if (!status.installed) return { tone: "off", text: "Not installed" };
  if (status.auth.state === "signed-out") return { tone: "warn", text: "Sign in needed" };
  if (status.auth.state === "unknown") return { tone: "warn", text: "Installed" };
  return { tone: "ready", text: "Ready" };
}

// "An agent you already pay for": each program this server can run, whether
// it is installed and signed in here, and the one command that fixes it when
// it is not. Nothing is saved until the step's Continue; the live test turn
// waits on the last step, once the choice is the server's.
export function AgentPanel({ draft, update }: { draft: Draft; update: Update }) {
  const [statuses, setStatuses] = useState<HarnessStatus[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const phone = shellHost()?.platform === "android";

  const load = useCallback(
    (refresh: boolean) =>
      fetch(`/api/admin/harness?${refresh ? "refresh=1&" : ""}${phone ? "platform=android" : ""}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data?.statuses) setStatuses(data.statuses as HarnessStatus[]);
        })
        .catch(() => undefined),
    [phone],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  const setAgent = (patch: Partial<Draft["agent"]>) => update((current) => ({ ...current, agent: { ...current.agent, ...patch } }));

  if (!statuses) {
    return (
      <div className="flex items-center gap-2 text-xs text-stone-400">
        <span className="su-scan" aria-hidden="true" /> Looking for agent programs on this computer…
      </div>
    );
  }

  const chosen = statuses.find((status) => status.id === draft.agent.id) ?? null;
  const unavailable = statuses.every((status) => status.availability !== "ok");

  return (
    <div className="space-y-3">
      {unavailable && statuses[0]?.message ? <p className="su-note">{statuses[0].message}</p> : null}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-400">Choose the program</span>
        <button type="button" onClick={refresh} disabled={refreshing} aria-busy={refreshing} className={ui.btnSmall}>
          <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} /> Check again
        </button>
      </div>
      <div role="radiogroup" aria-label="Agent program" className="hx-cards stagger">
        {statuses.map((status) => {
          const pill = statusTone(status);
          const picked = draft.agent.id === status.id;
          return (
            <button
              key={status.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-unavailable={status.availability !== "ok" || !status.installed}
              className="hx-card"
              onClick={() => setAgent({ id: status.id, model: picked ? draft.agent.model : "", utilityModel: picked ? draft.agent.utilityModel : "" })}
            >
              <span className="flex items-center gap-2.5">
                <span className="hx-mark" aria-hidden="true">
                  {MARKS[status.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-stone-100">{status.label}</span>
                  <span className="block truncate text-[11px] text-stone-500">
                    {status.version ? `v${status.version}` : status.installed ? "installed" : "not on this computer"}
                    {status.auth.plan ? ` · ${status.auth.plan}` : ""}
                  </span>
                </span>
              </span>
              <span key={pill.text} className="hx-pill reveal-pop self-start" data-tone={pill.tone}>
                {pill.text}
              </span>
            </button>
          );
        })}
      </div>

      {chosen ? (
        <div key={chosen.id} className="reveal-height space-y-3">
          {chosen.availability === "ok" && !chosen.installed ? (
            <div className="su-row flex-col items-stretch">
              <span className="text-sm text-stone-200">1. Install {chosen.label} on this computer</span>
              <CopyLine text={chosen.installHint ?? ""} label="install command" />
              <span className="text-sm text-stone-200">2. Sign it in</span>
              <CopyLine text={chosen.signInHint ?? ""} label="sign-in command" />
              <span className="text-xs text-stone-500">Run both in a terminal on the server&apos;s computer, then press Check again.</span>
            </div>
          ) : chosen.installed && chosen.auth.state === "signed-out" ? (
            <div className="su-row flex-col items-stretch">
              <span className="text-sm text-stone-200">Sign {chosen.label} in on this computer</span>
              <CopyLine text={chosen.signInHint ?? ""} label="sign-in command" />
              <span className="text-xs text-stone-500">It opens a browser to sign in with your own plan. Then press Check again.</span>
            </div>
          ) : chosen.message ? (
            <p className="su-note">{chosen.message}</p>
          ) : null}
          {chosen.installed ? (
            <p className="text-xs text-stone-500">
              {chosen.path}
              {chosen.auth.account ? ` · signed in as ${chosen.auth.account}` : ""}. It runs with none of its own tools: it can only
              touch the table&apos;s rules engine, and this server never sees its password or key.
            </p>
          ) : null}
          {chosen.models.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ModelPicker
                label="Story model"
                models={[{ id: "", label: "The program's own default" }, ...chosen.models.map((model) => ({ id: model.id, label: model.label }))]}
                value={draft.agent.model}
                recommended=""
                onChange={(model) => setAgent({ model })}
              />
              <ModelPicker
                label="Bookkeeping model (summaries, Ask)"
                models={[
                  { id: "", label: "Same as the story model" },
                  ...[...chosen.models]
                    .sort((a, b) => Number(Boolean(b.cheap)) - Number(Boolean(a.cheap)))
                    .map((model) => ({ id: model.id, label: model.cheap ? `${model.label} (light)` : model.label })),
                ]}
                value={draft.agent.utilityModel}
                recommended=""
                onChange={(utilityModel) => setAgent({ utilityModel })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
