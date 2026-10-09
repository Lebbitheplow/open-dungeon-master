"use client";

import { ui } from "@/lib/ui";
import { GameIcon } from "@/components/ui/GameIcon";
import type { Draft } from "@/app/setup/draft";
import { Lamp, ScanMark, host, type ScanResult } from "@/app/setup/SetupParts";

type Update = (change: (draft: Draft) => Draft) => void;

const STOPS = [
  { glyph: "system-lore", title: "The storyteller", line: "A model on this computer, an API key, an agent you already pay for, or a person." },
  { glyph: "sense-truesight", title: "Pictures", line: "Portraits, scene art and battle maps. Optional." },
  { glyph: "tab-ambience", title: "Voice", line: "Narration read aloud, and push-to-talk dictation. Optional." },
  { glyph: "tab-characters", title: "Players", line: "The address to share, and who may make an account." },
  { glyph: "system-share", title: "Your own agent", line: "Claude Code, Codex or opencode working here as you. Optional." },
];

// The first step: a name, what the wizard is about to ask, and what the scan
// has already found on this computer while the admin reads.
export function WelcomeStep({
  draft,
  update,
  scan,
  scanning,
}: {
  draft: Draft;
  update: Update;
  scan: ScanResult | null;
  scanning: boolean;
}) {
  const found: Array<{ key: string; text: string }> = [
    ...(scan?.text ?? []).map((entry) => ({
      key: entry.baseUrl,
      text: `${entry.label} at ${host(entry.baseUrl)}${entry.models.length ? ` (${entry.models.length} ${entry.models.length === 1 ? "model" : "models"})` : ""}`,
    })),
    ...(scan?.comfyui ? [{ key: "comfy", text: `ComfyUI at ${host(scan.comfyui.url)}` }] : []),
    ...(scan?.kokoro ? [{ key: "kokoro", text: `Kokoro voices at ${host(scan.kokoro.url)}` }] : []),
    ...(scan?.whisper ? [{ key: "whisper", text: `Whisper dictation at ${host(scan.whisper.url)}` }] : []),
  ];
  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-stone-400">Name your server</span>
        <input
          className={ui.input}
          value={draft.serverName}
          maxLength={100}
          onChange={(event) => update((current) => ({ ...current, serverName: event.target.value }))}
          placeholder="Open Dungeon Master"
        />
        <span className="mt-1 block text-[11px] text-stone-500">Shown on the sign-in page and in the apps&apos; server lists.</span>
      </label>

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-stone-200">What we will set up</h4>
        <ul className="stagger space-y-1.5">
          {STOPS.map((stop) => (
            <li key={stop.title} className="flex items-start gap-3">
              <GameIcon icon={{ kind: "glyph", key: stop.glyph }} size="size-7" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="text-stone-100">{stop.title}</span>
                <span className="block text-xs text-stone-500">{stop.line}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2" aria-live="polite">
        <h4 className="flex items-center gap-2 text-sm font-medium text-stone-200">
          <ScanMark scanning={scanning} found={found.length > 0} />
          {scanning ? "Looking around this computer…" : found.length ? "Already running on this computer" : "Nothing running on this computer yet"}
        </h4>
        {found.length ? (
          <ul className="stagger flex flex-wrap gap-2">
            {found.map((entry) => (
              <li key={entry.key} className="hx-pill reveal-pop" data-tone="ready">
                <Lamp tone="ok" /> {entry.text}
              </li>
            ))}
          </ul>
        ) : !scanning ? (
          <p className="text-xs text-stone-500">
            That is fine. The next step can use an API key or an agent program instead, or show you what to start.
          </p>
        ) : null}
      </div>
    </div>
  );
}
