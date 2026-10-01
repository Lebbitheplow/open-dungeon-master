"use client";

import { Check, Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { ui } from "@/lib/ui";

type Status = {
  builtin: {
    model: string;
    downloadMb: number;
    installed: boolean;
    status: "idle" | "installing" | "ready" | "error";
    progress: number;
    error: string;
  };
  active: "whisper" | "builtin" | "openai" | "none";
};

const ACTIVE_LABEL: Record<Status["active"], string> = {
  whisper: "the Whisper service",
  builtin: "the built-in engine",
  openai: "OpenAI, on this server's key",
  none: "nothing yet, so the mic buttons are hidden",
};

// The engine's state, or a sentence saying why it could not be read.
async function request(method: "GET" | "POST"): Promise<Status | string> {
  try {
    const response = await fetch("/api/admin/speech", { method, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    return response.ok ? (data as Status) : data.error || "Could not read the speech engine's state.";
  } catch {
    return "Could not reach the server.";
  }
}

// The built-in speech engine in the admin panel: one button that downloads
// Whisper into this server (src/lib/stt-builtin.ts), a bar while it comes
// down, and a line saying which engine dictation uses right now.
export function BuiltinSpeechCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  const apply = useCallback((result: Status | string) => {
    if (typeof result === "string") {
      setError(result);
    } else {
      setError("");
      setStatus(result);
    }
  }, []);

  useEffect(() => {
    void request("GET").then(apply);
  }, [apply]);

  const installing = status?.builtin.status === "installing";
  useEffect(() => {
    if (!installing) {
      return;
    }
    const timer = window.setInterval(() => void request("GET").then(apply), 1000);
    return () => window.clearInterval(timer);
  }, [installing, apply]);

  const builtin = status?.builtin;
  const percent = Math.round((builtin?.progress ?? 0) * 100);

  return (
    <div className="panel rounded-xl p-3 sm:col-span-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm tracking-wide text-amber-100">Built-in speech recognition</p>
          <p className="mt-0.5 text-xs leading-5 text-stone-400">
            Runs Whisper inside this server on the CPU, so dictation and push-to-talk work without a
            separate speech service. Downloads {builtin?.downloadMb ?? 76} MB once. A Whisper service,
            when one answers, still comes first.
          </p>
        </div>
        {builtin?.installed && !installing ? (
          <span className="speech-installed reveal-pop inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/40 px-2.5 py-1 text-xs text-emerald-200">
            <Check className="tick-in size-3.5" /> Installed
          </span>
        ) : (
          <button
            type="button"
            disabled={!status || installing}
            onClick={() => void request("POST").then(apply)}
            className={cn(ui.btnSecondary, "h-9 text-[12px]")}
          >
            {installing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : builtin?.status === "error" ? (
              <RefreshCw className="size-3.5" />
            ) : (
              <Download className="size-3.5" />
            )}
            {installing ? "Installing" : builtin?.status === "error" ? "Try again" : "Install"}
          </button>
        )}
      </div>

      {installing ? (
        <div className="reveal mt-2" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-800">
            <div className="bar-ease h-full rounded-full bg-amber-400/80" style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-stone-400">
            {percent ? `Downloading ${builtin?.model}: ${percent}%` : `Starting the download of ${builtin?.model}...`}
          </p>
        </div>
      ) : null}

      {builtin?.status === "error" && builtin.error ? (
        <p role="alert" className="mt-2 text-xs text-red-400">
          The install failed: {builtin.error}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-400">
          {error}
        </p>
      ) : null}

      {status ? (
        <p className="mt-2 border-t border-stone-800 pt-2 text-[11px] text-stone-400">
          Dictation is using <span className="text-stone-200">{ACTIVE_LABEL[status.active]}</span>.
        </p>
      ) : null}
    </div>
  );
}
