"use client";

import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import {
  Field,
  SecretField,
  SelectField,
  type EnvDefaults,
  type MaskedConfig,
} from "@/app/admin/AdminSettingsFields";

// Image generation. The picker names the backend new campaigns start on; a
// campaign may still pick any backend that is set up here, so each backend
// keeps its own block of fields (address, model, key), the chosen one open
// and first, the rest folded away under it (issue 89: the fields used to sit
// in one flat grid, and nothing said which belonged to which backend).

type Images = MaskedConfig["images"];
type Group = "comfyui" | "flux" | "openai";
const Z_TURBO = "preset:z_turbo";
const CHECKPOINT_PREFIX = "checkpoint:";

type Discovery = {
  url: string;
  revision: number;
  checkpoints: string[];
  error: string | null;
};

export function comfyModelOptions(saved: string, checkpoints: string[], discoverySucceeded: boolean) {
  return [
    { value: CHECKPOINT_PREFIX, label: "Default checkpoint" },
    ...[saved, ...checkpoints]
      .filter((name, index, names) => name && names.indexOf(name) === index)
      .map((name) => ({
        value: `${CHECKPOINT_PREFIX}${name}`,
        label: name,
        ...(name === saved && discoverySucceeded && !checkpoints.includes(name)
          ? { hint: "Saved selection; not reported by this ComfyUI." }
          : {}),
      })),
    { value: Z_TURBO, label: "Z-Image Turbo" },
  ];
}

export function comfyModelPatch(value: string, options: ReturnType<typeof comfyModelOptions>): Partial<Images> | null {
  if (value === Z_TURBO) return { comfyWorkflowPreset: "z_turbo" };
  if (options.some((option) => option.value === value) && value.startsWith(CHECKPOINT_PREFIX)) {
    return { comfyWorkflowPreset: "checkpoint", comfyCheckpoint: value.slice(CHECKPOINT_PREFIX.length) };
  }
  return null;
}

export async function fetchComfyModels(url: string, signal: AbortSignal) {
  const response = await fetch("/api/comfy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  const result = await response.json() as {
    ok?: boolean;
    error?: string;
    checkpoints?: unknown;
  };
  if (!response.ok || !result.ok) {
    return { checkpoints: [], error: result.error || "Could not check ComfyUI." };
  }
  return {
    checkpoints: Array.isArray(result.checkpoints)
      ? result.checkpoints.filter((name): name is string => typeof name === "string")
      : [],
    error: null,
  };
}

function ComfyModelField({
  images,
  env,
  onChange,
}: {
  images: Images;
  env: EnvDefaults;
  onChange: (patch: Partial<Images>) => void;
}) {
  const url = images.comfyUrl || env.comfyUrl;
  const [revision, setRevision] = useState(0);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await fetchComfyModels(url, controller.signal);
        if (!controller.signal.aborted) setDiscovery({ url, revision, ...result });
      } catch {
        if (!controller.signal.aborted) {
          setDiscovery({ url, revision, checkpoints: [], error: "Could not check ComfyUI. Check the server URL." });
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, revision]);

  const current = discovery?.url === url && discovery.revision === revision ? discovery : null;
  const saved = images.comfyCheckpoint;
  const checkpoints = current?.checkpoints ?? [];
  const options = comfyModelOptions(saved, checkpoints, Boolean(current && !current.error));
  const selected = images.comfyWorkflowPreset === "z_turbo"
    ? Z_TURBO
    : `${CHECKPOINT_PREFIX}${saved}`;

  return (
    <div>
      <SelectField<string>
        label="Image model"
        value={selected}
        onChange={(value) => {
          const patch = comfyModelPatch(value, options);
          if (patch) onChange(patch);
        }}
        options={options}
      />
      <div className="mt-1 flex items-start justify-between gap-2">
        <p role={current?.error ? "alert" : "status"} className="text-[11px] leading-4 text-stone-500">
          {current?.error || (!current ? "Checking installed checkpoints…" : checkpoints.length ? "Installed checkpoints from ComfyUI." : "No checkpoints reported by ComfyUI.")}
        </p>
        <button type="button" className="shrink-0 text-[11px] text-amber-300 hover:text-amber-200" onClick={() => setRevision((value) => value + 1)}>
          Refresh
        </button>
      </div>
    </div>
  );
}

function groupOf(backend: string): Group | null {
  if (backend === "comfyui") return "comfyui";
  if (backend === "mflux-hs" || backend === "sdnq-hs") return "flux";
  if (backend === "openai") return "openai";
  return null;
}

const GROUP_TITLE: Record<Group, string> = {
  comfyui: "ComfyUI",
  flux: "FLUX worker",
  openai: "OpenAI-compatible images API",
};

export function AdminImagesSection({
  images,
  env,
  harness,
  phoneWorld,
  openaiKey,
  onImages,
  onOpenaiKey,
}: {
  images: Images;
  env: EnvDefaults;
  harness: MaskedConfig["harness"];
  // A phone cannot run ComfyUI or a FLUX worker.
  phoneWorld: boolean;
  openaiKey: string;
  onImages: (images: Images) => void;
  onOpenaiKey: (value: string) => void;
}) {
  const set = (patch: Partial<Images>) => onImages({ ...images, ...patch });
  // The backend "Auto" resolves to, so its fields are the ones shown open.
  const effective = images.defaultBackend || env.imageBackend || "comfyui";
  const active = groupOf(effective);

  const blocks: Record<Group, React.ReactNode> = {
    comfyui: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Server URL" hint={`Env: ${env.comfyUrl}`}>
          <input
            className={ui.input}
            value={images.comfyUrl}
            onChange={(event) => set({ comfyUrl: event.target.value })}
            placeholder={env.comfyUrl}
          />
        </Field>
        <ComfyModelField images={images} env={env} onChange={set} />
      </div>
    ),
    flux: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Worker URL" hint={`Env: ${env.fluxWorkerUrl}. The worker loads its own FLUX model.`}>
          <input
            className={ui.input}
            value={images.fluxWorkerUrl}
            onChange={(event) => set({ fluxWorkerUrl: event.target.value })}
            placeholder={env.fluxWorkerUrl}
          />
        </Field>
      </div>
    ),
    openai: (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Server base URL"
          hint="OpenAI itself, or any server with OpenAI's /v1/images/generations. Blank = api.openai.com."
        >
          <input
            className={ui.input}
            value={images.openaiBaseUrl}
            onChange={(event) => set({ openaiBaseUrl: event.target.value })}
            placeholder="https://api.openai.com/v1"
          />
        </Field>
        <Field label="Model name" hint="Blank = gpt-image-1.">
          <input
            className={ui.input}
            value={images.openaiModel}
            onChange={(event) => set({ openaiModel: event.target.value })}
            placeholder="gpt-image-1"
          />
        </Field>
        <SecretField
          label="API key"
          isSet={images.hasOpenaiApiKey}
          value={openaiKey}
          onChange={onOpenaiKey}
          hint={
            env.hasOpenaiImageApiKey
              ? "An env-var key is also set; this one wins when filled."
              : "Billed to whoever owns the key. Used only when a campaign's backend is this API."
          }
        />
      </div>
    ),
  };

  const offered = (["comfyui", "flux", "openai"] as Group[]).filter((group) => !phoneWorld || group === "openai");
  const others = offered.filter((group) => group !== active);

  return (
    <PageSection id="admin-images" heading="Image generation" glyph="sense-truesight">
      <div className="mb-3">
        <SelectField<Images["defaultBackend"]>
          label="Default backend"
          hint={
            phoneWorld
              ? "For new campaigns. The OpenAI-compatible API renders on another machine with the key below and needs no GPU here."
              : "For new campaigns; a campaign can pick any backend that is set up below. ComfyUI and the FLUX workers run on this machine; an OpenAI-compatible API renders wherever its address points."
          }
          value={images.defaultBackend}
          onChange={(defaultBackend) => set({ defaultBackend })}
          options={[
            { value: "", label: `Auto (${env.imageBackend || "ComfyUI"})` },
            ...(phoneWorld ? [] : [{ value: "comfyui" as const, label: "ComfyUI (local)" }]),
            { value: "openai", label: "OpenAI-compatible images API" },
            ...(phoneWorld
              ? []
              : [
                  { value: "mflux-hs" as const, label: "FLUX worker: mflux (Apple Silicon)" },
                  { value: "sdnq-hs" as const, label: "FLUX worker: sdnq (CUDA/ROCm)" },
                ]),
            // Only once the agent program has painted a real test picture.
            ...(harness?.images === "native" && harness.imagesVerifiedAt
              ? [{ value: "harness" as const, label: "The agent program's own pictures" }]
              : []),
          ]}
        />
      </div>
      {active && offered.includes(active) ? (
        // Keyed, so picking another backend brings its block in.
        <div key={active} className="reveal">
          <h3 className="mb-2 text-sm font-medium text-stone-200">{GROUP_TITLE[active]}</h3>
          {blocks[active]}
        </div>
      ) : effective === "harness" ? (
        <p className="reveal text-xs text-stone-500">
          Pictures come from the agent program set up in the Agent section; it has no address or key of its own.
        </p>
      ) : null}
      {others.length ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-stone-500">Other backends a campaign can pick:</p>
          {others.map((group) => (
            <details key={group} className="rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2">
              <summary className="cursor-pointer text-sm text-stone-300">{GROUP_TITLE[group]}</summary>
              <div className="mt-3">{blocks[group]}</div>
            </details>
          ))}
        </div>
      ) : null}
    </PageSection>
  );
}
