"use client";

import { Check, Loader2, RefreshCw, ShieldCheck, ShieldHalf } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { shellHost } from "@/lib/shell-host";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Switch } from "@/components/ui/Switch";
import { CopyLine } from "@/components/CopyLine";
import { Field, SelectField, type MaskedConfig } from "@/app/admin/AdminSettingsFields";
import { HarnessTestPanel } from "@/app/admin/HarnessTestPanel";
import type { HarnessConfig, HarnessId, HarnessStatus } from "@/lib/harness/types";

type Payload = {
  statuses: HarnessStatus[];
  config: HarnessConfig;
  usage: { utilization: number; resetsAt?: number; window?: string } | null;
  activeSessions: number;
  recent: Array<{ tool: string; ok: boolean; ms: number; createdAt: string; campaignId: string | null }>;
};

const MARKS: Record<HarnessId, string> = { claude: "CC", codex: "Cx", opencode: "oc", grok: "Gk" };
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;

function statusTone(status: HarnessStatus): { tone: "ready" | "warn" | "off" | "bad"; text: string } {
  if (status.availability !== "ok") return { tone: "off", text: "Not available here" };
  if (!status.installed) return { tone: "off", text: "Not installed" };
  if (status.auth.state === "signed-out") return { tone: "warn", text: "Sign in needed" };
  if (status.auth.state === "unknown") return { tone: "warn", text: "Installed" };
  return { tone: "ready", text: "Ready" };
}

// The admin's agent program (docs/harness-mcp-plan.md 6): a card per program
// this server knows how to run, each saying whether it is installed, signed
// in and locked down, then the models and limits for the chosen one. Saved on
// its own, so choosing a program never rides along with an unrelated edit.
export function AdminHarnessSection({
  textProvider,
  onConfig,
}: {
  textProvider: string;
  onConfig: (config: MaskedConfig) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<HarnessConfig | null>(null);
  // null follows the saved default provider; a flip is held until saved.
  const [defaultOverride, setDefaultOverride] = useState<boolean | null>(null);
  const useAsDefault = defaultOverride ?? textProvider === "harness";
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const phone = shellHost()?.platform === "android";

  const load = useCallback(
    (refresh = false) =>
      fetch(`/api/admin/harness?${refresh ? "refresh=1&" : ""}${phone ? "platform=android" : ""}`)
        .then((response) => (response.ok ? (response.json() as Promise<Payload>) : null))
        .then((payload) => {
          if (payload) {
            setData(payload);
            setDraft((current) => current ?? payload.config);
          }
        })
        .catch(() => undefined),
    [phone],
  );

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/harness${phone ? "?platform=android" : ""}`)
      .then((response) => (response.ok ? (response.json() as Promise<Payload>) : null))
      .then((payload) => {
        if (live && payload) {
          setData(payload);
          setDraft((current) => current ?? payload.config);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [phone]);

  if (!data || !draft) {
    return (
      <PageSection id="admin-harness" heading="Agent program" glyph="system-lore">
        <div className="skeleton-block h-28 rounded-xl" aria-label="Looking for agent programs" />
      </PageSection>
    );
  }

  const chosen = data.statuses.find((status) => status.id === draft.id) ?? null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.config) || useAsDefault !== (textProvider === "harness");
  const savedChoice = Boolean(data.config.id) && data.config.id === draft.id && !dirty;
  const everywhereUnavailable = data.statuses.every((status) => status.availability !== "ok");

  async function refresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const { imagesVerifiedAt: _verified, ...harness } = draft;
      void _verified;
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          harness,
          ...(useAsDefault
            ? { text: { provider: "harness" } }
            : textProvider === "harness"
              ? { text: { provider: "" } }
              : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not save.");
        return;
      }
      onConfig(body.config);
      setData((current) => (current ? { ...current, config: body.config.harness } : current));
      setDraft(body.config.harness);
      setDefaultOverride(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void load();
    } finally {
      setSaving(false);
    }
  }

  const models = chosen?.models ?? [];
  const usage = data.usage;

  return (
    <PageSection id="admin-harness" heading="Agent program" glyph="system-lore">
      <p className="mb-3 text-xs text-stone-500">
        Let an agent you already have, Claude Code, Codex, opencode or Grok Build, narrate the
        tables on its own sign-in. It is started with none of its own tools: the only thing it can
        touch is the table&apos;s rules engine, turn by turn, under the same rules and caps as the
        built-in storyteller. ODM never asks for or stores its password or key.
      </p>
      {everywhereUnavailable ? (
        <p className="reveal mb-3 rounded-lg border border-amber-700/40 bg-amber-950/30 p-3 text-xs text-amber-200">
          {data.statuses[0]?.message}
        </p>
      ) : null}

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-400">Choose the program</span>
        <button type="button" onClick={refresh} disabled={refreshing} className={ui.btnSmall} aria-busy={refreshing}>
          <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} /> Check again
        </button>
      </div>
      <div role="radiogroup" aria-label="Agent program" className="hx-cards stagger">
        {data.statuses.map((status) => {
          const pill = statusTone(status);
          const picked = draft.id === status.id;
          return (
            <button
              key={status.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-unavailable={status.availability !== "ok" || !status.installed}
              className="hx-card"
              onClick={() => setDraft({ ...draft, id: picked ? "" : status.id, model: picked ? draft.model : "", utilityModel: picked ? draft.utilityModel : "" })}
            >
              <span className="flex items-center gap-2.5">
                <span className="hx-mark" aria-hidden="true">
                  {MARKS[status.id]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-stone-100">{status.label}</span>
                  <span className="block truncate text-[11px] text-stone-500">
                    {status.version ? `v${status.version}` : status.installed ? "installed" : "—"}
                    {status.auth.plan ? ` · ${status.auth.plan}` : ""}
                  </span>
                </span>
              </span>
              <span key={pill.text} className="hx-pill reveal-pop self-start" data-tone={pill.tone}>
                {pill.text}
              </span>
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                <span className="hx-chip">
                  {status.lockdown === "removed" ? <ShieldCheck className="size-3.5" /> : <ShieldHalf className="size-3.5" />}
                  {status.lockdown === "removed" ? "Own tools removed" : "Own tools boxed in"}
                  {status.lockdownProven ? "" : " (untested)"}
                </span>
                <span className="hx-chip">
                  {status.nativeImages === "no" ? "No pictures" : status.nativeImages === "verified" ? "Paints (checked)" : "Paints (untested)"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {chosen ? (
        <div key={chosen.id} className="reveal-height mt-4">
          <div className="space-y-3">
            {chosen.message ? <p className="text-xs text-amber-300/90">{chosen.message}</p> : null}
            {chosen.availability === "ok" && !chosen.installed ? (
              <Field label="Install it on this machine, then check again">
                <CopyLine text={chosen.installHint ?? ""} label="install command" />
              </Field>
            ) : null}
            {chosen.installed && chosen.auth.state === "signed-out" ? (
              <Field label="Sign it in on this machine, then check again">
                <CopyLine text={chosen.signInHint ?? ""} label="sign-in command" />
              </Field>
            ) : null}
            {chosen.installed ? (
              <p className="text-xs text-stone-500">
                {chosen.path}
                {chosen.auth.account ? ` · signed in as ${chosen.auth.account}` : ""}
              </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Story model"
                value={draft.model}
                onChange={(model) => setDraft({ ...draft, model })}
                options={[
                  { value: "", label: "The program's own default" },
                  ...models.map((model) => ({ value: model.id, label: model.label })),
                  ...(draft.model && !models.some((model) => model.id === draft.model)
                    ? [{ value: draft.model, label: draft.model }]
                    : []),
                ]}
              />
              <SelectField
                label="Bookkeeping model"
                hint="Summaries, compaction and Ask. A cheaper model does these well."
                value={draft.utilityModel}
                onChange={(utilityModel) => setDraft({ ...draft, utilityModel })}
                options={[
                  { value: "", label: "Same as the story model" },
                  ...[...models].sort((a, b) => Number(Boolean(b.cheap)) - Number(Boolean(a.cheap))).map((model) => ({
                    value: model.id,
                    label: model.cheap ? `${model.label} (light)` : model.label,
                  })),
                ]}
              />
              {chosen.id === "claude" || chosen.id === "codex" ? (
                <SelectField
                  label="Effort"
                  value={draft.effort}
                  onChange={(effort) => setDraft({ ...draft, effort })}
                  options={EFFORTS.map((effort) => ({ value: effort, label: effort ? effort[0].toUpperCase() + effort.slice(1) : "The program's own default" }))}
                />
              ) : null}
              <SelectField
                label="Who may use it"
                value={draft.campaigns}
                onChange={(campaigns) => setDraft({ ...draft, campaigns })}
                options={[
                  { value: "all" as const, label: "Every campaign on this server" },
                  { value: "admins" as const, label: "Only campaigns an administrator leads" },
                ]}
              />
              <Field group label="Tables at once" hint="Turns that run side by side; others wait their turn.">
                <NumberStepper
                  label="Tables at once"
                  min={1}
                  max={8}
                  step={1}
                  value={draft.maxConcurrent}
                  onChange={(next) => setDraft({ ...draft, maxConcurrent: Math.min(8, Math.max(1, Math.round(Number(next)) || 1)) })}
                />
              </Field>
              <Field group label="Longest turn (seconds)" hint="A turn that runs longer stops and can be retried.">
                <NumberStepper
                  label="Longest turn"
                  min={60}
                  max={900}
                  step={30}
                  suffix="s"
                  value={draft.turnTimeoutSec}
                  onChange={(next) =>
                    setDraft({ ...draft, turnTimeoutSec: Math.min(900, Math.max(60, Math.round(Number(next)) || 240)) })
                  }
                />
              </Field>
            </div>
            {chosen.nativeImages !== "no" ? (
              <label className="flex items-center gap-3 text-sm text-stone-300">
                <Switch
                  label="Let it paint for the tables"
                  on={draft.images === "native"}
                  disabled={chosen.nativeImages !== "verified"}
                  onChange={(on) => setDraft({ ...draft, images: on ? "native" : "off" })}
                />
                <span>
                  Let it paint for the tables
                  <span className="block text-xs text-stone-500">
                    {chosen.nativeImages === "verified"
                      ? "Tables can choose it as their image backend."
                      : "Available once a test picture below comes back."}
                  </span>
                </span>
              </label>
            ) : null}
            <Field label="Path to the program (advanced)" hint="Blank finds it on its own, even when the server was started without your shell's PATH.">
              <input
                className={ui.input}
                value={draft.binaryPath}
                onChange={(event) => setDraft({ ...draft, binaryPath: event.target.value })}
                placeholder={chosen.path ?? ""}
              />
            </Field>
            <label className="flex items-center gap-3 text-sm text-stone-300">
              <Switch label="Narrate new campaigns with it" on={useAsDefault} onChange={setDefaultOverride} />
              <span>
                Narrate new campaigns with it
                <span className="block text-xs text-stone-500">
                  Existing campaigns keep their storyteller; switch one in its Setup tab.
                </span>
              </span>
            </label>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={ui.btnPrimary} onClick={save} disabled={saving || !dirty} aria-busy={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save agent settings
        </button>
        {saved ? (
          <span role="status" className="inline-flex items-center gap-1 text-sm text-emerald-400">
            <Check className="tick-in size-4" /> Saved
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="motion-shake text-sm text-red-400">
            {error}
          </span>
        ) : null}
      </div>

      {chosen && data.config.id === chosen.id ? (
        <HarnessTestPanel
          saved={savedChoice}
          paints={chosen.nativeImages !== "no"}
          picturesVerified={Boolean(data.config.imagesVerifiedAt)}
          onVerified={() => void load(true)}
        />
      ) : null}

      {usage ? (
        <div className="mt-4 space-y-1">
          <div className="flex items-center justify-between text-xs text-stone-400">
            <span>Plan used{usage.window ? ` (${usage.window.replace(/_/g, " ")})` : ""}</span>
            <span key={Math.round(usage.utilization * 100)} className="count-pop">
              {Math.round(usage.utilization * 100)}%
            </span>
          </div>
          <div className="hx-meter" data-high={usage.utilization >= 0.85}>
            <span className="bar-ease" style={{ width: `${Math.min(100, Math.round(usage.utilization * 100))}%` }} />
          </div>
        </div>
      ) : null}
      {data.activeSessions > 0 ? (
        <p className="mt-2 text-xs text-stone-500">
          <span className="breathe">Narrating {data.activeSessions} {data.activeSessions === 1 ? "table" : "tables"} now.</span>
        </p>
      ) : null}
    </PageSection>
  );
}
