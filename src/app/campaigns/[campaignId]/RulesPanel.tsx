"use client";

import { EmptyState } from "@/components/EmptyState";
import { Pin, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { SectionHead } from "@/components/ui/SectionHead";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Tooltip } from "@/components/ui/Tooltip";
import { KitButton, PanelLoading, panelField } from "./PanelKit";
import { CalendarSection } from "@/app/campaigns/[campaignId]/CalendarSection";
import type { GameSettings } from "@/lib/schemas/game-settings";

type RuleChunkView = {
  id: string;
  heading: string;
  text: string;
  enabled: boolean;
  pinned: boolean;
};

export const VARIANT_TOGGLES: Array<{
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
  {
    key: "powerfulCritical",
    label: "Powerful critical",
    tip: "On a critical hit the extra weapon dice are dealt as their maximum instead of being rolled.",
  },
  {
    key: "criticalDamageMods",
    label: "Crit damage mods",
    tip: "On a critical hit the flat damage modifiers double along with the dice.",
  },
  {
    key: "ammunition",
    label: "Ammunition",
    tip: "Arrows, bolts and bullets are spent when they are fired and half are recovered after the fight.",
  },
];

export const REST_LABELS: Record<GameSettings["variantRules"]["restVariant"], string> = {
  standard: "Standard rests (1h short, 8h long)",
  gritty: "Gritty realism (8h short, 7-day long)",
  heroic: "Heroic (5min short, 1h long)",
};

// The variant-rule controls on their own, so the campaign-creation dialog can
// offer the same choices this panel does without the lead having to open the
// lobby afterwards to find them.
type RestVariant = GameSettings["variantRules"]["restVariant"];
const REST_OPTIONS = (Object.keys(REST_LABELS) as RestVariant[]).map((variant) => ({
  value: variant,
  label: REST_LABELS[variant],
  icon: { kind: "glyph" as const, key: variant === "standard" ? "rest-short" : "rest-long" },
}));

// One variant rule: the kit switch, its name, and the word that says which
// way it is set (a player reads "on" or "off", not the knob's position).
function VariantSwitch({ label, tip, on, onChange }: { label: string; tip: string; on: boolean; onChange: (next: boolean) => void }) {
  return (
    <Tooltip content={tip}>
      <span className="flex min-h-9 items-center gap-2 text-xs text-stone-300">
        <Switch on={on} onChange={onChange} label={label} />
        <span className="min-w-0 flex-1">{label}</span>
        <span className={on ? "text-amber-200" : "text-stone-500"}>{on ? "on" : "off"}</span>
      </span>
    </Tooltip>
  );
}

export function VariantRulesFields({
  value,
  onChange,
}: {
  value: GameSettings["variantRules"];
  onChange: (next: GameSettings["variantRules"]) => void;
}) {
  return (
    <div>
      <SectionHead title="Variant rules" glyph="system-rules" level="h4" />
      <div className="stagger-pop grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {VARIANT_TOGGLES.map((toggle) => (
          <VariantSwitch key={toggle.key} label={toggle.label} tip={toggle.tip} on={Boolean(value[toggle.key])} onChange={(next) => onChange({ ...value, [toggle.key]: next })} />
        ))}
      </div>
      <Select<RestVariant>
        value={value.restVariant}
        onChange={(restVariant) => onChange({ ...value, restVariant })}
        options={REST_OPTIONS}
        label="Rest lengths"
        className="mt-2 w-full"
      />
    </div>
  );
}

// Rules manager: 5e variant toggles plus lead-authored house rules. The
// house-rules text is chunked server-side; each chunk can be silenced or
// pinned into every DM prompt, and the rest are retrieved per turn by
// relevance.
export function RulesPanel({
  campaignId,
  settings,
  steersStory,
}: {
  campaignId: string;
  settings: GameSettings;
  steersStory: boolean;
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
      <div className="panel rounded-lg p-3" data-tour="rules-variants">
        <SectionHead title="Variant rules" glyph="system-rules" />
        {steersStory ? (
          <div className={cn("reveal space-y-0.5", settingsBusy && "opacity-70")}>
            {VARIANT_TOGGLES.map((toggle) => (
              <VariantSwitch key={toggle.key} label={toggle.label} tip={toggle.tip} on={Boolean(variant[toggle.key])} onChange={(next) => patchVariant({ [toggle.key]: next })} />
            ))}
            <Tooltip content="How long short and long rests take at this table. The DM's rest tool follows it.">
              <span className="block pt-1.5">
                <Select<RestVariant>
                  size="sm"
                  value={variant.restVariant}
                  onChange={(restVariant) => patchVariant({ restVariant })}
                  options={REST_OPTIONS}
                  label="Rest lengths"
                  className="w-full"
                />
              </span>
            </Tooltip>
          </div>
        ) : (
          <p className="text-xs leading-5 text-stone-400">
            {[
              ...VARIANT_TOGGLES.filter((toggle) => variant[toggle.key]).map(
                (toggle) => toggle.label,
              ),
              ...(variant.restVariant !== "standard" ? [REST_LABELS[variant.restVariant]] : []),
            ].join(" · ") || "No variant rules in effect."}
          </p>
        )}
      </div>

      <div className="panel rounded-lg p-3" data-tour="rules-house">
        <SectionHead title="House rules" glyph="system-homebrew" />
        {loading ? (
          <PanelLoading label="Loading..." rows={2} />
        ) : steersStory ? (
          <>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              maxLength={20_000}
              placeholder={
                "Write your table's house rules. Use headings to group them, e.g.\n\nDrinking potions:\nDrinking a potion is a bonus action at this table.\n\nThe DM retrieves only the relevant rules each turn."
              }
              aria-label="House rules"
              className={cn(panelField, "leading-5")}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <KitButton tone="primary" onClick={saveText} disabled={saving || text === savedText} busy={saving}>
                {saving ? null : <Save className="size-3.5" />}
                Save rules
              </KitButton>
              {text !== savedText ? (
                <span className="live-in text-xs text-amber-300/80">Unsaved changes</span>
              ) : null}
            </div>
          </>
        ) : savedText ? (
          <p className="reveal whitespace-pre-wrap text-xs leading-5 text-stone-400">{savedText}</p>
        ) : (
          <EmptyState size="sm" art="board" title="No house rules set." />
        )}
      </div>

      {steersStory && chunks.length ? (
        <div className="panel reveal rounded-lg p-3">
          <SectionHead title="Rule sections" glyph="system-rulesets" aside={chunks.length} />
          <p className="mb-2 text-xs leading-5 text-stone-500">
            The DM sees only the sections relevant to each turn. Pin one to include it every turn;
            switch one off to silence it without deleting the text.
          </p>
          <ul className="stagger space-y-1.5">
            {chunks.map((chunk) => (
              <li
                key={chunk.id}
                className={cn("flex items-start gap-2 rounded-md border border-stone-700/50 bg-stone-950/40 p-2", !chunk.enabled && "opacity-60")}
              >
                <span className="mt-0.5 shrink-0" title={chunk.enabled ? "Switch this section off" : "Switch this section on"}>
                  <Switch on={chunk.enabled} onChange={(enabled) => patchChunk(chunk.id, { enabled })} label={chunk.enabled ? "Switch this section off" : "Switch this section on"} />
                </span>
                <KitButton
                  tone="icon"
                  always
                  onClick={() => patchChunk(chunk.id, { pinned: !chunk.pinned })}
                  aria-pressed={chunk.pinned}
                  aria-label={chunk.pinned ? "Unpin: retrieved only when relevant" : "Pin: included in every DM turn"}
                  title={chunk.pinned ? "Unpin: retrieved only when relevant" : "Pin: included in every DM turn"}
                  className={cn("shrink-0", chunk.pinned && "text-amber-300")}
                >
                  <Pin className={cn("size-3.5", chunk.pinned && "fill-current")} />
                </KitButton>
                <span className="min-w-0 text-xs leading-5 text-stone-400">
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

      {steersStory ? <CalendarSection campaignId={campaignId} /> : null}
    </div>
  );
}
