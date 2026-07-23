"use client";

import { Loader2, Pin, Save, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui/Tooltip";
import type { GameSettings } from "@/lib/schemas/game-settings";

type RuleChunkView = {
  id: string;
  heading: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
};

const VARIANT_TOGGLES: Array<{
  key: keyof GameSettings["variantRules"] & string;
  label: string;
  tip: string;
}> = [
  {
    key: "flanking",
    label: "Flanking",
    tip: "Two allies on opposite sides of a creature give each other advantage on melee attacks against it.",
  },
  {
    key: "criticalFumbles",
    label: "Critical fumbles",
    tip: "A natural 1 on an attack roll causes a minor narrated mishap.",
  },
  {
    key: "encumbrance",
    label: "Encumbrance",
    tip: "Carrying more than 5 times Strength in pounds slows a character by 10 feet.",
  },
  {
    key: "lingeringInjuries",
    label: "Lingering injuries",
    tip: "A critical hit or dropping to 0 HP can leave a lasting injury the DM tracks.",
  },
];

const REST_LABELS: Record<GameSettings["variantRules"]["restVariant"], string> = {
  standard: "Standard rests (1h short, 8h long)",
  gritty: "Gritty realism (8h short, 7-day long)",
  heroic: "Heroic (5min short, 1h long)",
};

// Rules manager: 5e variant toggles plus lead-authored house rules. The
// house-rules text is chunked server-side; each chunk can be silenced or
// pinned into every DM prompt, and the rest are retrieved per turn by
// relevance.
export function RulesPanel({
  campaignId,
  settings,
  isLead,
}: {
  campaignId: string;
  settings: GameSettings;
  isLead: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [chunks, setChunks] = useState<RuleChunkView[]>([]);
  const [saving, setSaving] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${campaignId}/rules`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setText(String(data.text ?? ""));
          setSavedText(String(data.text ?? ""));
          setChunks(Array.isArray(data.chunks) ? data.chunks : []);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  async function saveText() {
    setSaving(true);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (response.ok) {
        const data = await response.json();
        setSavedText(String(data.text ?? text));
        setChunks(Array.isArray(data.chunks) ? data.chunks : []);
      }
    } finally {
      setSaving(false);
    }
  }

  async function patchChunk(chunkId: string, flags: { enabled?: boolean; pinned?: boolean }) {
    const response = await fetch(`/api/campaigns/${campaignId}/rules`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkId, ...flags }),
    });
    if (response.ok) {
      const data = await response.json();
      setChunks((current) =>
        current.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...data.chunk } : chunk)),
      );
    }
  }

  async function patchVariant(update: Partial<GameSettings["variantRules"]>) {
    setSettingsBusy(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantRules: { ...settings.variantRules, ...update } }),
      });
    } finally {
      setSettingsBusy(false);
    }
  }

  const variant = settings.variantRules;

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-stone-300">
          <Scale className="size-3.5 text-amber-600" /> Variant rules
        </p>
        {isLead ? (
          <div className={cn("flex flex-wrap items-center gap-1.5", settingsBusy && "opacity-70")}>
            {VARIANT_TOGGLES.map((toggle) => (
              <Tooltip key={toggle.key} content={toggle.tip}>
                <button
                  type="button"
                  onClick={() => patchVariant({ [toggle.key]: !variant[toggle.key] })}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px]",
                    variant[toggle.key]
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-400",
                  )}
                >
                  {toggle.label} {variant[toggle.key] ? "on" : "off"}
                </button>
              </Tooltip>
            ))}
            <Tooltip content="How long short and long rests take at this table. The DM's rest tool follows it.">
              <select
                value={variant.restVariant}
                onChange={(event) =>
                  patchVariant({
                    restVariant: event.target.value as GameSettings["variantRules"]["restVariant"],
                  })
                }
                className="rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] outline-none focus:border-amber-600"
              >
                {(Object.keys(REST_LABELS) as Array<keyof typeof REST_LABELS>).map((value) => (
                  <option key={value} value={value}>
                    {REST_LABELS[value]}
                  </option>
                ))}
              </select>
            </Tooltip>
          </div>
        ) : (
          <p className="text-[11px] leading-4 text-stone-400">
            {[
              ...VARIANT_TOGGLES.filter((toggle) => variant[toggle.key]).map(
                (toggle) => toggle.label,
              ),
              ...(variant.restVariant !== "standard" ? [REST_LABELS[variant.restVariant]] : []),
            ].join(" · ") || "No variant rules in effect."}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
        <p className="mb-2 text-xs font-medium text-stone-300">House rules</p>
        {loading ? (
          <p className="flex items-center gap-1 text-[11px] text-stone-500">
            <Loader2 className="size-3 animate-spin" /> Loading...
          </p>
        ) : isLead ? (
          <>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              maxLength={20_000}
              placeholder={
                "Write your table's house rules. Use headings to group them, e.g.\n\nDrinking potions:\nDrinking a potion is a bonus action at this table.\n\nThe DM retrieves only the relevant rules each turn."
              }
              className="w-full rounded border border-stone-700 bg-stone-900 px-2 py-1.5 text-[11px] leading-4 outline-none focus:border-amber-600"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={saveText}
                disabled={saving || text === savedText}
                className="flex items-center gap-1 rounded border border-stone-700 px-2 py-0.5 text-[11px] text-stone-300 hover:bg-stone-900 disabled:opacity-50"
              >
                {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                Save rules
              </button>
              {text !== savedText ? (
                <span className="text-[11px] text-amber-300/80">Unsaved changes</span>
              ) : null}
            </div>
          </>
        ) : savedText ? (
          <p className="whitespace-pre-wrap text-[11px] leading-4 text-stone-400">{savedText}</p>
        ) : (
          <p className="text-[11px] italic text-stone-600">No house rules set.</p>
        )}
      </div>

      {isLead && chunks.length ? (
        <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-2.5">
          <p className="mb-1 text-xs font-medium text-stone-300">Rule sections</p>
          <p className="mb-2 text-[11px] leading-4 text-stone-500">
            The DM sees only the sections relevant to each turn. Pin one to include it every turn;
            switch one off to silence it without deleting the text.
          </p>
          <ul className="space-y-1.5">
            {chunks.map((chunk) => (
              <li
                key={chunk.id}
                className="flex items-start gap-2 rounded border border-stone-800/70 bg-stone-950/40 p-1.5"
              >
                <button
                  type="button"
                  onClick={() => patchChunk(chunk.id, { enabled: !chunk.enabled })}
                  title={chunk.enabled ? "Switch this section off" : "Switch this section on"}
                  className={cn(
                    "mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px]",
                    chunk.enabled
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-500",
                  )}
                >
                  {chunk.enabled ? "on" : "off"}
                </button>
                <button
                  type="button"
                  onClick={() => patchChunk(chunk.id, { pinned: !chunk.pinned })}
                  title={
                    chunk.pinned
                      ? "Unpin: retrieved only when relevant"
                      : "Pin: included in every DM turn"
                  }
                  className={cn(
                    "mt-0.5 shrink-0 rounded border px-1 py-0.5",
                    chunk.pinned
                      ? "border-amber-700 bg-amber-950/50 text-amber-200"
                      : "border-stone-700 text-stone-500",
                  )}
                >
                  <Pin className="size-3" />
                </button>
                <span className="min-w-0 text-[11px] leading-4 text-stone-400">
                  {chunk.heading ? (
                    <span className="font-medium text-stone-300">{chunk.heading}: </span>
                  ) : null}
                  {chunk.text.length > 160 ? `${chunk.text.slice(0, 160)}...` : chunk.text}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
