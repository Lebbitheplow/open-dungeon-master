"use client";

import { ChevronDown, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameIcon } from "@/components/ui/GameIcon";
import { Slider } from "@/components/ui/Slider";
import { Tooltip } from "@/components/ui/Tooltip";
import { VoicePicker } from "@/components/VoicePicker";
import { VoicePreviewButton } from "@/components/VoicePreviewButton";
import { cn } from "@/lib/cn";
import type { GameSettings } from "@/lib/schemas/game-settings";
import { ui } from "@/lib/ui";
import { PanelError, SettingToggle } from "./PanelKit";

// Who reads whose lines (issue 97). The narrator reads the prose; anyone
// given a voice here reads their own quoted lines, and a passage the DM
// speaks as them outright. Whoever runs the story sees the whole table: the
// party, the cast, the monsters of the fight in progress. A player sees
// their own characters and may choose for them.

type Voice = { voiceId: string; speed: number };
type Kind = "pc" | "companion" | "npc" | "monster";
type Entry = { key: string; kind: Kind; name: string; portraitUrl: string; voice: Voice | null; mine: boolean };

const GROUPS: Array<{ kinds: Kind[]; title: string; glyph: string }> = [
  { kinds: ["pc", "companion"], title: "The party", glyph: "system-party" },
  { kinds: ["npc"], title: "The cast", glyph: "system-cast" },
  { kinds: ["monster"], title: "On the board", glyph: "system-bestiary" },
];

const KIND_NOTE: Record<Kind, string> = { pc: "", companion: "AI companion", npc: "", monster: "every one of them" };

function VoiceRow({ entry, onVoice }: { entry: Entry; onVoice: (voice: Voice | null, settle: boolean) => void }) {
  const group = GROUPS.find((candidate) => candidate.kinds.includes(entry.kind))!;
  return (
    <li className="flex flex-wrap items-center gap-1.5 py-1">
      {entry.portraitUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.portraitUrl} alt="" className="size-7 shrink-0 rounded-full border border-amber-700/60 object-cover" />
      ) : (
        <GameIcon icon={{ kind: "glyph", key: group.glyph }} size="size-7" className="shrink-0" />
      )}
      <span className="w-32 min-w-0 shrink-0 leading-tight">
        <span className="block truncate text-stone-200">{entry.name}</span>
        {KIND_NOTE[entry.kind] ? <span className="block truncate text-[10px] text-stone-500">{KIND_NOTE[entry.kind]}</span> : null}
      </span>
      <span className="min-w-0 flex-1 basis-44 sm:max-w-64">
        <VoicePicker
          size="sm"
          label={`Voice for ${entry.name}`}
          value={entry.voice?.voiceId ?? ""}
          onChange={(voiceId) => onVoice(voiceId ? { voiceId, speed: entry.voice?.speed ?? 1 } : null, true)}
          noneLabel="The narrator's voice"
          className="w-full"
        />
      </span>
      {entry.voice ? (
        <span className="reveal flex items-center gap-1.5 text-stone-400">
          <VoicePreviewButton voice={entry.voice.voiceId} />
          Pace
          <span className="w-24">
            <Slider
              label={`Pace for ${entry.name}`}
              min={0.7}
              max={1.4}
              step={0.05}
              value={entry.voice.speed}
              onChange={(speed) => onVoice({ voiceId: entry.voice!.voiceId, speed }, false)}
              bubble={(speed) => speed.toFixed(2)}
            />
          </span>
          <span className="w-8 text-stone-500">{entry.voice.speed.toFixed(2)}</span>
        </span>
      ) : null}
    </li>
  );
}

export function CharacterVoices({
  campaignId,
  settings,
  steersStory,
  patch,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
  // The lead's settings write, for the narrator's pace and the casting rule.
  patch?: (update: Partial<GameSettings>) => void;
}) {
  const [roster, setRoster] = useState<Entry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [casting, setCasting] = useState(false);
  const [error, setError] = useState("");
  const [pace, setPace] = useState(settings.ttsSpeed ?? 1);
  const [paceFor, setPaceFor] = useState(settings.ttsSpeed ?? 1);
  // The slider follows the saved pace when it changes from outside.
  if (paceFor !== (settings.ttsSpeed ?? 1)) {
    setPaceFor(settings.ttsSpeed ?? 1);
    setPace(settings.ttsSpeed ?? 1);
  }
  // A dragged slider is many values; only the one it rests on is sent.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const later = useCallback((key: string, send: () => void) => {
    clearTimeout(timers.current.get(key));
    timers.current.set(key, setTimeout(send, 350));
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const url = `/api/campaigns/${campaignId}/voices`;
  // Asked when the table is shown, and again whenever it is opened: someone
  // new may have walked on since, or been cast by the passage just read.
  useEffect(() => {
    let live = true;
    void fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { roster?: Entry[] } | null) => {
        if (live && data && Array.isArray(data.roster)) {
          setRoster(data.roster);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url, open]);

  async function send(method: "PUT" | "POST", body?: unknown) {
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await response.json().catch(() => ({}))) as { roster?: Entry[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? "That voice was not saved.");
        return;
      }
      if (Array.isArray(data.roster)) {
        setRoster(data.roster);
      }
    } catch {
      setError("Could not reach the server.");
    }
  }

  function setVoice(entry: Entry, voice: Voice | null, settle: boolean) {
    setRoster((current) => current?.map((candidate) => (candidate.key === entry.key ? { ...candidate, voice } : candidate)) ?? current);
    const save = () => void send("PUT", { key: entry.key, voice });
    if (settle) {
      clearTimeout(timers.current.get(entry.key));
      save();
    } else {
      later(entry.key, save);
    }
  }

  if (!steersStory) {
    // A player's own characters, and nothing when they have none here.
    const mine = (roster ?? []).filter((entry) => entry.mine);
    if (!mine.length) {
      return null;
    }
    return (
      <div className="reveal mt-3 text-xs">
        <p className="pk-rowlabel mb-1" style={{ width: "auto" }}>Your voice</p>
        {error ? <PanelError className="mb-1">{error}</PanelError> : null}
        <ul>
          {mine.map((entry) => (
            <VoiceRow key={entry.key} entry={entry} onVoice={(voice, settle) => setVoice(entry, voice, settle)} />
          ))}
        </ul>
        <p className="text-[11px] leading-4 text-stone-500">
          When the narration quotes your character, the line is read in this voice.
        </p>
      </div>
    );
  }

  const voiced = (roster ?? []).filter((entry) => entry.voice).length;
  const unvoiced = (roster ?? []).length - voiced;
  return (
    <>
      <div className="reveal flex flex-wrap items-center gap-2">
        <span className="pk-rowlabel">Voices</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={cn(ui.btnSmall, "gap-1.5", open && "border-amber-500/70 text-amber-100")}
        >
          Character voices{roster ? ` (${voiced} of ${roster.length})` : ""}
          <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
        </button>
        <Tooltip content="On: anyone who speaks without a voice of their own is given one of this server's voices the first time they do, and keeps it. Off: only the voices chosen here are heard; everyone else is read by the narrator.">
          <SettingToggle on={Boolean(settings.ttsAutoCast)} onToggle={() => patch?.({ ttsAutoCast: !settings.ttsAutoCast })}>
            {settings.ttsAutoCast ? "New speakers are cast for you" : "Only the voices you choose"}
          </SettingToggle>
        </Tooltip>
        <span className="flex items-center gap-1.5 text-stone-400">
          Narrator pace
          <span className="w-24">
            <Slider
              label="Narrator pace"
              min={0.7}
              max={1.4}
              step={0.05}
              value={pace}
              onChange={(speed) => {
                setPace(speed);
                later("narrator", () => patch?.({ ttsSpeed: speed }));
              }}
              bubble={(speed) => speed.toFixed(2)}
            />
          </span>
          <span className="w-8 text-stone-500">{pace.toFixed(2)}</span>
        </span>
      </div>
      {open ? (
        <div className="reveal rounded-lg border border-amber-500/15 bg-stone-950/40 p-2.5">
          {error ? <PanelError className="mb-2">{error}</PanelError> : null}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 basis-56 text-[11px] leading-4 text-stone-500">
              The narrator reads the prose. Anyone with a voice here reads their own quoted lines, and whatever the
              DM speaks as them.
            </p>
            <button
              type="button"
              disabled={casting || !unvoiced}
              onClick={async () => {
                setCasting(true);
                await send("POST");
                setCasting(false);
              }}
              className={cn(ui.btnSmall, "gap-1.5")}
            >
              {casting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {unvoiced ? `Cast the other ${unvoiced}` : "Everyone has a voice"}
            </button>
          </div>
          {roster === null ? (
            <p className="flex items-center gap-1.5 text-stone-500">
              <Loader2 className="size-3.5 animate-spin" /> Gathering the table...
            </p>
          ) : roster.length === 0 ? (
            <p className="text-stone-500">No one is at this table yet. Characters, the cast and monsters appear here as they arrive.</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {GROUPS.map((group) => {
                const entries = roster.filter((entry) => group.kinds.includes(entry.kind));
                return entries.length ? (
                  <section key={group.title}>
                    <p className="eyebrow text-[10px] text-amber-300/80">{group.title}</p>
                    <ul className="stagger divide-y divide-stone-800/60">
                      {entries.map((entry) => (
                        <VoiceRow key={entry.key} entry={entry} onVoice={(voice, settle) => setVoice(entry, voice, settle)} />
                      ))}
                    </ul>
                  </section>
                ) : null;
              })}
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
