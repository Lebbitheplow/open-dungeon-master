"use client";

import { Loader2, Plug, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { EmptyState } from "@/components/EmptyState";
import { PageSection } from "@/components/PageShell";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { CopyLine } from "@/components/CopyLine";

type Grant = {
  id: string;
  name: string;
  scopes: string[];
  campaignId: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
};

type Campaign = { id: string; title: string };

const SCOPES: Array<{ id: string; label: string; hint: string }> = [
  { id: "read", label: "Read", hint: "Your campaigns, characters, quests and lore, as you see them." },
  { id: "play", label: "Play", hint: "Act, speak and roll at a table as your character." },
  { id: "characters", label: "Characters", hint: "Create, edit and delete your library characters." },
  { id: "campaigns", label: "Campaigns", hint: "Create campaigns and change the ones you lead." },
  { id: "dm", label: "Dungeon Master", hint: "Run the rules engine and narrate, only where you hold the DM seat." },
];

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function setupLines(url: string, token: string) {
  return [
    {
      name: "Claude Code",
      text: `claude mcp add --transport http odm ${url} --header "Authorization: Bearer ${token}"`,
      block: false,
    },
    {
      name: "Codex (~/.codex/config.toml)",
      text: `[mcp_servers.odm]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
      block: true,
    },
    {
      name: "opencode (opencode.json)",
      text: `"mcp": { "odm": { "type": "remote", "url": "${url}", "headers": { "Authorization": "Bearer ${token}" }, "oauth": false } }`,
      block: false,
    },
    { name: "Any other MCP client (streamable HTTP)", text: `${url}  ·  Authorization: Bearer ${token}`, block: false },
  ];
}

// Connected agents (docs/harness-mcp-plan.md 7): your own Claude Code, Codex
// or other MCP client acting as you on this server, with exactly what your
// account can do in the browser and nothing more. The token is shown once.
export function ConnectedAgentsSection() {
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [mcpUrl, setMcpUrl] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read", "play"]);
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile/agents")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        setGrants(data?.grants ?? []);
        setMcpUrl(data?.mcpUrl ?? "");
      });
    fetch("/api/campaigns")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const list = (data?.campaigns ?? []) as Array<{ id: string; title: string }>;
        setCampaigns(list.map((campaign) => ({ id: campaign.id, title: campaign.title })));
      })
      .catch(() => undefined);
  }, []);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes, campaignId: campaignId || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Could not connect an agent.");
        return;
      }
      setGrants((current) => [data.grant, ...(current ?? [])]);
      setMcpUrl(data.mcpUrl ?? mcpUrl);
      setFresh({ token: data.token, name: data.grant.name });
      setCreating(false);
      setName("");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const response = await fetch(`/api/profile/agents/${id}`, { method: "DELETE" });
    if (response.ok) {
      // The row plays its leave before it goes.
      setLeaving(id);
      setTimeout(() => {
        setGrants((current) => (current ?? []).filter((grant) => grant.id !== id));
        setLeaving(null);
      }, 180);
    }
  }

  const campaignTitle = (id: string | null) => campaigns.find((campaign) => campaign.id === id)?.title ?? "one campaign";

  return (
    <PageSection
      heading="Connected agents"
      glyph="system-share"
      intro="Let your own Claude Code, Codex or other MCP client act as you here: read your campaigns, play your character, or run a table where you are the Dungeon Master. It gets exactly the access your account has, only the parts you tick, and never your password or the server's settings."
    >
      {fresh ? (
        <div className="hx-token mb-4 space-y-2 rounded-xl border border-amber-600/40 bg-amber-950/20 p-3">
          <p className="text-sm text-amber-100">
            <strong>{fresh.name}</strong> is connected. This is the only time its token is shown; copy the line for
            your agent now.
          </p>
          {setupLines(mcpUrl, fresh.token).map((line) => (
            <div key={line.name}>
              <span className="mb-1 block text-xs text-stone-400">{line.name}</span>
              <CopyLine text={line.text} label={`${line.name} setup`} block={line.block} />
            </div>
          ))}
          <button type="button" className={ui.btnSmall} onClick={() => setFresh(null)}>
            I have copied it
          </button>
        </div>
      ) : null}

      {grants === null ? (
        <div className="skeleton-block h-12 rounded-xl" aria-label="Loading connected agents" />
      ) : grants.length === 0 && !creating ? (
        <EmptyState art="board" size="sm" title="No agents connected." />
      ) : (
        <ul className="stagger space-y-2">
          {grants.map((grant) => (
            <li key={grant.id} className={leaving === grant.id ? "plate-row reveal-leave" : "plate-row"}>
              <span className="medallion grid size-9 place-items-center">
                <Plug className="size-4 text-amber-200" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-stone-200">{grant.name}</span>
                <span className="block truncate text-[11px] text-stone-500">
                  {grant.scopes.join(", ")}
                  {grant.campaignId ? ` · ${campaignTitle(grant.campaignId)}` : ""} · last used {when(grant.lastUsedAt)} ·
                  expires {when(grant.expiresAt)}
                </span>
              </span>
              <button type="button" className={ui.btnSmall} onClick={() => revoke(grant.id)}>
                <Trash2 className="size-3.5" /> Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <div className="reveal-height mt-3">
          <div className="space-y-3 rounded-xl border border-stone-800 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-stone-400">Name</span>
              <input
                className={ui.input}
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                placeholder="Claude Code on my laptop"
              />
            </label>
            <div className="space-y-2">
              <span className="block text-xs font-medium text-stone-400">What it may do</span>
              {SCOPES.map((scope) => {
                const on = scopes.includes(scope.id);
                return (
                  <label key={scope.id} className="flex items-start gap-3 text-sm text-stone-300">
                    <Switch
                      label={scope.label}
                      on={on}
                      onChange={(next) =>
                        setScopes((current) => (next ? [...current, scope.id] : current.filter((entry) => entry !== scope.id)))
                      }
                    />
                    <span>
                      {scope.label}
                      <span className="block text-xs text-stone-500">{scope.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div role="group" aria-label="Limit to one campaign">
              <span className="mb-1 block text-xs font-medium text-stone-400">Limit to one campaign</span>
              <Select
                value={campaignId}
                onChange={setCampaignId}
                label="Limit to one campaign"
                options={[{ value: "", label: "Any campaign I belong to" }, ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.title }))]}
              />
            </div>
            {error ? (
              <p role="alert" className="motion-shake text-sm text-red-400">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={ui.btnPrimary}
                onClick={create}
                disabled={busy || !name.trim() || scopes.length === 0}
                aria-busy={busy}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />} Connect
              </button>
              <button type="button" className={ui.btnSecondary} onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className={`${ui.btnSmall} mt-3`} onClick={() => setCreating(true)}>
          <Plug className="size-3.5" /> Connect an agent
        </button>
      )}
    </PageSection>
  );
}
