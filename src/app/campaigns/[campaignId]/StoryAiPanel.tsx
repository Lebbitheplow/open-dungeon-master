"use client";

import { AlignLeft, Bot, Image as ImageIcon, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { MaskedStorySettings } from "@/lib/db/settings";
import type { TextProvider } from "@/lib/text-models";
import {
  PROSE_SIZE_VALUES,
  type ImageBackend,
  type StorySettings,
} from "@/lib/types";

// A secret field never receives its stored value; SECRET_KEPT means "leave it
// as is" and the field is simply omitted from the PATCH. Same contract as the
// admin settings panel.
const SECRET_KEPT = "\u0000keep";

const PROVIDER_LABELS: Record<TextProvider, string> = {
  local: "Local (Ollama)",
  custom: "Custom backend",
  none: "No AI storyteller",
};

const BACKEND_LABELS: Record<ImageBackend, string> = {
  comfyui: "ComfyUI",
  openai: "OpenAI-compatible",
  "mflux-hs": "MFLUX (home server)",
  "sdnq-hs": "SDNQ (home server)",
};

// Per-campaign AI settings for the Setup tab. The values render from the
// campaign snapshot (kept live by campaign_updated over SSE); only the
// key-existence booleans come from the story-settings GET, because the
// snapshot is scrubbed of keys for everyone.
export function StoryAiPanel({
  campaignId,
  settings,
  steersStory,
}: {
  campaignId: string;
  settings: StorySettings;
  steersStory: boolean;
}) {
  const [busy, setBusy] = useState(false);
  // Every control renders the server's settings, so a refused PATCH changes
  // nothing on screen; without this line it changes nothing silently.
  const [error, setError] = useState("");
  const [hasCustomKey, setHasCustomKey] = useState(false);
  const [hasUtilityKey, setHasUtilityKey] = useState(false);
  // Defaults to true so the warning never flashes while the answer is in
  // flight on servers that are fine.
  const [imagesConfigured, setImagesConfigured] = useState(true);
  // Text fields commit on blur or Enter, so a half-typed URL never PATCHes.
  const [drafts, setDrafts] = useState({
    customBaseUrl: settings.customBaseUrl,
    customModel: settings.customModel,
    customApiKey: SECRET_KEPT,
    utilityBaseUrl: settings.utilityBaseUrl,
    utilityModel: settings.utilityModel,
    utilityApiKey: SECRET_KEPT,
  });

  useEffect(() => {
    if (!steersStory) {
      return;
    }
    let cancelled = false;
    void fetch(`/api/campaigns/${campaignId}/story-settings`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { settings?: MaskedStorySettings } | null) => {
        if (!cancelled && data?.settings) {
          setHasCustomKey(data.settings.hasCustomApiKey);
          setHasUtilityKey(data.settings.hasUtilityApiKey);
        }
      })
      .catch(() => undefined);
    void fetch("/api/capabilities")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { images?: { configured?: boolean } } | null) => {
        if (!cancelled && data?.images) {
          setImagesConfigured(data.images.configured !== false);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [steersStory, campaignId]);

  async function patch(update: Partial<StorySettings>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/story-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        settings?: MaskedStorySettings;
      };
      if (!response.ok) {
        setError(data.error ?? "That change was not saved.");
        return;
      }
      if (data.settings) {
        setHasCustomKey(data.settings.hasCustomApiKey);
        setHasUtilityKey(data.settings.hasUtilityApiKey);
      }
      if (update.customApiKey !== undefined) {
        setDrafts((prev) => ({ ...prev, customApiKey: SECRET_KEPT }));
      }
      if (update.utilityApiKey !== undefined) {
        setDrafts((prev) => ({ ...prev, utilityApiKey: SECRET_KEPT }));
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function commitText(field: "customBaseUrl" | "customModel" | "utilityBaseUrl" | "utilityModel") {
    const value = drafts[field].trim();
    if (value !== settings[field]) {
      void patch({ [field]: value });
    }
  }

  function commitKey(field: "customApiKey" | "utilityApiKey") {
    const value = drafts[field];
    if (value !== SECRET_KEPT) {
      void patch({ [field]: value.trim() });
    }
  }

  const storytellerSummary =
    settings.textProvider === "custom"
      ? settings.customModel || "custom backend"
      : PROVIDER_LABELS[settings.textProvider];
  const imagesSummary = settings.imageGenerationEnabled
    ? `${BACKEND_LABELS[settings.imageBackend]}${settings.autoImages ? ", automatic" : ""}`
    : "off";

  if (!steersStory) {
    return (
      <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
        <h2 className="mb-2 text-sm font-medium text-stone-300">Story AI</h2>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-stone-400">
          <span className="flex items-center gap-1.5">
            <Bot className="size-3.5 text-amber-200" />
            Storyteller: {storytellerSummary}
          </span>
          <span className="flex items-center gap-1.5">
            <Wrench className="size-3.5 text-amber-200" />
            Utility model: {settings.utilityModel || "off"}
          </span>
          <span className="flex items-center gap-1.5">
            <ImageIcon className="size-3.5 text-amber-200" />
            Images: {imagesSummary}
          </span>
          <span className="flex items-center gap-1.5">
            <AlignLeft className="size-3.5 text-amber-200" />
            Passage length: {settings.proseSize}
          </span>
        </div>
      </section>
    );
  }

  const selectClass =
    "rounded-md border border-stone-700 bg-stone-900 px-2 py-1 text-xs outline-none focus:border-amber-600";
  const inputClass = cn(selectClass, "w-64 max-w-full");
  const labelClass = "w-20 shrink-0 text-stone-500";
  const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  };

  return (
    <section className="rounded-lg border border-stone-800 bg-stone-950/60 p-4">
      <h2 className="mb-3 text-sm font-medium text-stone-300">Story AI</h2>
      {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
      <div className={cn("space-y-3 text-xs", busy && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={labelClass}>Storyteller</span>
          <select
            value={settings.textProvider}
            onChange={(event) => patch({ textProvider: event.target.value as TextProvider })}
            className={selectClass}
          >
            {(Object.keys(PROVIDER_LABELS) as TextProvider[]).map((provider) => (
              <option key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </div>
        {settings.textProvider === "custom" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>Base URL</span>
              <input
                value={drafts.customBaseUrl}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, customBaseUrl: event.target.value }))
                }
                onBlur={() => commitText("customBaseUrl")}
                onKeyDown={blurOnEnter}
                placeholder="http://127.0.0.1:8080/v1"
                className={inputClass}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>Model</span>
              <input
                value={drafts.customModel}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, customModel: event.target.value }))
                }
                onBlur={() => commitText("customModel")}
                onKeyDown={blurOnEnter}
                className={inputClass}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={labelClass}>API key</span>
              <input
                type="password"
                value={drafts.customApiKey === SECRET_KEPT ? "" : drafts.customApiKey}
                onChange={(event) =>
                  setDrafts((prev) => ({ ...prev, customApiKey: event.target.value }))
                }
                onBlur={() => commitKey("customApiKey")}
                onKeyDown={blurOnEnter}
                placeholder={hasCustomKey ? "•••••••• (set)" : "Not set"}
                className={inputClass}
              />
              {hasCustomKey ? (
                <button
                  type="button"
                  onClick={() => patch({ customApiKey: "" })}
                  className="rounded-md border border-stone-700 px-2 py-1 text-stone-400 hover:text-red-400"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <p className="text-stone-500">Blank fields fall back to the server&apos;s settings.</p>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800/60 pt-3">
          <span className={labelClass}>Utility</span>
          <select
            value={settings.utilityProvider}
            onChange={(event) =>
              patch({ utilityProvider: event.target.value as TextProvider })
            }
            className={selectClass}
          >
            <option value="local">{PROVIDER_LABELS.local}</option>
            <option value="custom">{PROVIDER_LABELS.custom}</option>
          </select>
          <input
            value={drafts.utilityModel}
            onChange={(event) =>
              setDrafts((prev) => ({ ...prev, utilityModel: event.target.value }))
            }
            onBlur={() => commitText("utilityModel")}
            onKeyDown={blurOnEnter}
            placeholder="Model (blank keeps everything on the storyteller)"
            className={inputClass}
          />
        </div>
        {settings.utilityProvider === "custom" && settings.utilityModel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={labelClass}>Utility URL</span>
            <input
              value={drafts.utilityBaseUrl}
              onChange={(event) =>
                setDrafts((prev) => ({ ...prev, utilityBaseUrl: event.target.value }))
              }
              onBlur={() => commitText("utilityBaseUrl")}
              onKeyDown={blurOnEnter}
              placeholder="http://127.0.0.1:8080/v1"
              className={inputClass}
            />
            <input
              type="password"
              value={drafts.utilityApiKey === SECRET_KEPT ? "" : drafts.utilityApiKey}
              onChange={(event) =>
                setDrafts((prev) => ({ ...prev, utilityApiKey: event.target.value }))
              }
              onBlur={() => commitKey("utilityApiKey")}
              onKeyDown={blurOnEnter}
              placeholder={hasUtilityKey ? "•••••••• (set)" : "API key (optional)"}
              className={cn(selectClass, "w-40")}
            />
            {hasUtilityKey ? (
              <button
                type="button"
                onClick={() => patch({ utilityApiKey: "" })}
                className="rounded-md border border-stone-700 px-2 py-1 text-stone-400 hover:text-red-400"
              >
                Clear
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800/60 pt-3">
          <span className={labelClass}>Images</span>
          <select
            value={settings.imageGenerationEnabled ? settings.imageBackend : "off"}
            onChange={(event) => {
              const value = event.target.value;
              // "Off" is imageGenerationEnabled, not a backend: picking a
              // backend again switches images back on in the same PATCH.
              void patch(
                value === "off"
                  ? { imageGenerationEnabled: false }
                  : { imageBackend: value as ImageBackend, imageGenerationEnabled: true },
              );
            }}
            className={selectClass}
          >
            <option value="off">Off</option>
            {(Object.keys(BACKEND_LABELS) as ImageBackend[]).map((backend) => (
              <option key={backend} value={backend}>
                {BACKEND_LABELS[backend]}
              </option>
            ))}
          </select>
          {settings.imageGenerationEnabled ? (
            <>
              <select
                value={settings.aspect}
                onChange={(event) =>
                  patch({ aspect: event.target.value as StorySettings["aspect"] })
                }
                className={selectClass}
              >
                <option value="square">Square</option>
                <option value="portrait">Portrait</option>
                <option value="landscape">Landscape</option>
              </select>
              <select
                value={settings.imageMode}
                onChange={(event) =>
                  patch({ imageMode: event.target.value as StorySettings["imageMode"] })
                }
                className={selectClass}
              >
                <option value="fast">Fast</option>
                <option value="slow">Slow (higher quality)</option>
              </select>
              <button
                type="button"
                onClick={() => patch({ autoImages: !settings.autoImages })}
                className={cn(
                  "rounded-md border px-2 py-1",
                  settings.autoImages
                    ? "border-amber-700 bg-amber-950/50 text-amber-200"
                    : "border-stone-700 text-stone-400",
                )}
              >
                Auto scenes
              </button>
            </>
          ) : null}
        </div>
        {settings.imageGenerationEnabled && !imagesConfigured ? (
          <p className="text-amber-400/90">
            The server has no image backend configured; these settings will not take effect
            until it does.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-stone-800/60 pt-3">
          <span className={labelClass}>Passages</span>
          <select
            value={settings.proseSize}
            onChange={(event) =>
              patch({ proseSize: event.target.value as StorySettings["proseSize"] })
            }
            className={selectClass}
          >
            {PROSE_SIZE_VALUES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span className="text-stone-500">How long each narrated passage runs.</span>
        </div>
      </div>
    </section>
  );
}
