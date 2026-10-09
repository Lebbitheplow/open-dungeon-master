"use client";

import { useEffect, useState } from "react";
import { CopyLine } from "@/components/CopyLine";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";

// The one line an agent needs, for the program the person actually uses,
// then a lamp that lights when the agent's first call arrives. Shared by
// Settings > Connected agents and the guided setup (src/app/setup): both
// used to print every program's line at once and leave the person to guess
// which was theirs, and whether it had worked.

export type AgentProgram = "claude" | "codex" | "opencode" | "other";

const PROGRAMS: SegmentedOption<AgentProgram>[] = [
  { value: "claude", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "opencode", label: "opencode" },
  { value: "other", label: "Other" },
];

type Line = { text: string; block: boolean; where: string };

export function agentSetupLine(program: AgentProgram, url: string, token: string): Line {
  if (program === "claude") {
    return {
      text: `claude mcp add --transport http odm ${url} --header "Authorization: Bearer ${token}"`,
      block: false,
      where: "Run it once in a terminal on the computer where Claude Code is installed.",
    };
  }
  if (program === "codex") {
    return {
      text: `[mcp_servers.odm]\nurl = "${url}"\nhttp_headers = { Authorization = "Bearer ${token}" }`,
      block: true,
      where: "Add it to ~/.codex/config.toml (create the file if it is not there), then start Codex again.",
    };
  }
  if (program === "opencode") {
    return {
      text: `"mcp": { "odm": { "type": "remote", "url": "${url}", "headers": { "Authorization": "Bearer ${token}" }, "oauth": false } }`,
      block: false,
      where: "Add it inside opencode.json (in the project, or ~/.config/opencode/opencode.json), then start opencode again.",
    };
  }
  return {
    text: `${url}  ·  Authorization: Bearer ${token}`,
    block: false,
    where: "Any MCP client that speaks streamable HTTP: give it this address and this header.",
  };
}

type Activity = { grantId: string; tool: string; ok: boolean; createdAt: string };

// How long the lamp keeps asking before it says so and stops. Polling a
// signed-in route every few seconds is cheap, but not forever.
const WATCH_MS = 10 * 60 * 1000;
const POLL_MS = 3_000;

export function AgentConnectLines({
  grantId,
  token,
  mcpUrl,
  initialProgram = "claude",
}: {
  grantId: string;
  token: string;
  mcpUrl: string;
  initialProgram?: AgentProgram;
}) {
  const [program, setProgram] = useState<AgentProgram>(initialProgram);
  const [first, setFirst] = useState<Activity | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const line = agentSetupLine(program, mcpUrl, token);

  useEffect(() => {
    if (first) {
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const look = async () => {
      const data = await fetch("/api/profile/agents")
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null);
      if (!live) return;
      const calls = ((data?.recent ?? []) as Activity[]).filter((row) => row.grantId === grantId);
      const used = (data?.grants ?? []).find((grant: { id: string; lastUsedAt: string | null }) => grant.id === grantId)?.lastUsedAt;
      if (calls.length || used) {
        setFirst(calls.at(-1) ?? { grantId, tool: "", ok: true, createdAt: used });
        return;
      }
      if (Date.now() - started > WATCH_MS) {
        setGaveUp(true);
        return;
      }
      timer = setTimeout(look, POLL_MS);
    };
    timer = setTimeout(look, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [grantId, first]);

  return (
    <div className="space-y-3">
      <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <SegmentedControl options={PROGRAMS} value={program} onChange={setProgram} label="Your agent program" className="w-max" />
      </div>
      <ol className="su-steps space-y-2 text-sm text-stone-300">
        <li>
          <span className="su-step-n">1</span>
          <span className="min-w-0 flex-1">
            Copy this.
            <span key={program} className="reveal mt-1.5 block">
              <CopyLine text={line.text} label={`${PROGRAMS.find((entry) => entry.value === program)?.label} setup`} block={line.block} />
            </span>
          </span>
        </li>
        <li>
          <span className="su-step-n">2</span>
          <span key={program} className="reveal min-w-0 flex-1">{line.where}</span>
        </li>
        <li>
          <span className="su-step-n">3</span>
          <span className="min-w-0 flex-1">
            Ask it something about this server, for example <em className="text-amber-100">&ldquo;list my Open Dungeon Master campaigns&rdquo;</em>.
          </span>
        </li>
      </ol>
      <p
        role="status"
        aria-live="polite"
        className="su-watch flex items-center gap-2 text-sm"
        data-state={first ? "ok" : gaveUp ? "off" : "wait"}
      >
        <span className="su-lamp" data-tone={first ? "ok" : gaveUp ? "off" : "wait"} aria-hidden="true" />
        {first ? (
          <span key="ok" className="reveal-pop text-emerald-300">
            Connected. Its first call{first.tool ? <> (<code className="text-emerald-200">{first.tool}</code>)</> : null} arrived
            {first.createdAt ? ` at ${new Date(first.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}.
          </span>
        ) : gaveUp ? (
          <span key="off" className="reveal text-stone-400">
            No call yet. The connection stays ready; this page just stopped watching for it.
          </span>
        ) : (
          <span key="wait" className="text-stone-400">Waiting for its first call…</span>
        )}
      </p>
    </div>
  );
}
