"use client";

import { useEffect, useState } from "react";
import { ui } from "@/lib/ui";
import { PageSection } from "@/components/PageShell";
import { DEFAULT_STORY_SETTINGS } from "@/lib/defaults";
import type { ComfyModelReport, ComfyStatus } from "@/lib/comfyui";
import { CHECKPOINT_PRESET, comfyModel } from "@/lib/image-models/catalog";
import { checkpointModel } from "@/lib/image-models/curate";
import { listWords, measuredLine } from "@/lib/image-models/describe";
import { honoursNegative } from "@/lib/image-models/workflow";
import { ComfyModelCatalog } from "@/app/admin/ComfyModelCatalog";
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
const PRESET_PREFIX = "preset:";
const CHECKPOINT_PREFIX = "checkpoint:";

// What the last check of this ComfyUI found (src/lib/comfyui.ts comfyStatus).
export type ComfyDiscovery = Pick<ComfyStatus, "checkpoints" | "models" | "hardware" | "device"> & { error: string | null };

type Discovery = ComfyDiscovery & { url: string; revision: number };

const fileName = (name: string) => name.split(/[\\/]/).pop() || name;

// A catalog model loaded from a checkpoint is offered as that checkpoint;
// the others as models of their own.
const loadsCheckpoint = (id: string) => {
  const model = comfyModel(id);
  return Boolean(model && "checkpoint" in model.graph.load);
};

// The picker: the default checkpoint, the catalog models this ComfyUI has
// every file for (measured ones first), then its picture checkpoints. The
// saved choice stays listed when the check no longer finds it. `discovery`
// is null until a check has answered.
// Whether a catalog model can paint on the machine this ComfyUI runs on:
// not one its hardware failed to run, and not one that peaked past what
// this GPU holds. Unmeasured models pass: unknown is not unfit.
export function paintsHere(report: Pick<ComfyModelReport, "verified" | "fits">): boolean {
  return report.verified?.verdict !== "fails" && report.fits !== false;
}

export function comfyModelOptions(saved: { checkpoint: string; preset: string }, discovery: ComfyDiscovery | null) {
  const succeeded = Boolean(discovery && !discovery.error);
  const hardware = discovery?.hardware?.label ?? null;
  const reports = discovery?.models ?? [];
  const checkpoints = discovery?.checkpoints ?? [];
  // The picker offers what runs here; the saved model stays whatever its
  // verdict, flagged, never swapped.
  const installed = reports.filter((report) => !report.missing.length && !loadsCheckpoint(report.id) && (paintsHere(report) || report.id === saved.preset));
  const savedModel = saved.preset !== CHECKPOINT_PRESET ? comfyModel(saved.preset) : undefined;
  const models = [
    ...installed.map((report) => ({ id: report.id, report })),
    ...(savedModel && !installed.some((report) => report.id === savedModel.id) ? [{ id: savedModel.id, report: null }] : []),
  ];
  const checkpointHint = (name: string) => {
    if (name === saved.checkpoint && succeeded && !checkpoints.includes(name)) return "Saved selection; not reported by this ComfyUI.";
    const known = checkpointModel(name);
    if (!known) return undefined;
    const report = reports.find((entry) => entry.id === known.id);
    return report?.verified ? `${known.label}. ${measuredLine(report, hardware)}` : `${known.label} settings.`;
  };
  return [
    // A blank checkpoint is the shipped default for new campaigns
    // (src/lib/runtime-defaults.ts), not "whatever ComfyUI lists first".
    { value: CHECKPOINT_PREFIX, label: "Default checkpoint", hint: DEFAULT_STORY_SETTINGS.comfyCheckpoint },
    ...models.map(({ id, report }) => ({
      value: `${PRESET_PREFIX}${id}`,
      label: comfyModel(id)?.label ?? id,
      group: "Models",
      ...(report ? { hint: measuredLine(report, hardware) } : succeeded ? { hint: "Its files are not all on this ComfyUI." } : {}),
    })),
    ...[saved.checkpoint, ...checkpoints]
      .filter((name, index, names) => name && names.indexOf(name) === index)
      .map((name) => {
        const hint = checkpointHint(name);
        return { value: `${CHECKPOINT_PREFIX}${name}`, label: name, group: "Checkpoints", ...(hint ? { hint } : {}) };
      }),
  ];
}

export function comfyModelPatch(value: string, options: ReturnType<typeof comfyModelOptions>): Partial<Images> | null {
  if (!options.some((option) => option.value === value)) return null;
  if (value.startsWith(PRESET_PREFIX)) return { comfyWorkflowPreset: value.slice(PRESET_PREFIX.length) };
  if (value.startsWith(CHECKPOINT_PREFIX)) {
    return { comfyWorkflowPreset: CHECKPOINT_PRESET, comfyCheckpoint: value.slice(CHECKPOINT_PREFIX.length) };
  }
  return null;
}

export async function fetchComfyModels(url: string, signal: AbortSignal): Promise<ComfyDiscovery> {
  const response = await fetch("/api/comfy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal,
  });
  const result = (await response.json()) as Partial<ComfyStatus>;
  if (!response.ok || !result.ok) {
    return { checkpoints: [], models: [], hardware: null, device: null, error: result.error || "Could not check ComfyUI." };
  }
  return {
    checkpoints: Array.isArray(result.checkpoints) ? result.checkpoints.filter((name): name is string => typeof name === "string") : [],
    models: Array.isArray(result.models) ? result.models.filter((entry): entry is ComfyModelReport => Boolean(entry && typeof entry.id === "string")) : [],
    hardware: result.hardware ?? null,
    device: result.device ?? null,
    error: null,
  };
}

// The line under the picker: what the check found for the model chosen.
export function comfyModelStatus(discovery: ComfyDiscovery | null, preset: string) {
  if (!discovery) return "Checking installed models…";
  if (discovery.error) return discovery.error;
  const model = preset === CHECKPOINT_PRESET ? undefined : comfyModel(preset);
  if (!model) {
    return discovery.checkpoints.length ? "Installed checkpoints from ComfyUI." : "No checkpoints reported by ComfyUI.";
  }
  const report = discovery.models.find((entry) => entry.id === model.id);
  if (!report || report.missing.length) {
    return `This ComfyUI is missing ${report ? listWords(report.missing.map((file) => file.what)) : `the ${model.label} files`}.`;
  }
  const files = listWords(Object.values(report.files).map(fileName));
  return `Paints every campaign's ComfyUI pictures with ${files}.${
    honoursNegative(model) ? "" : " It runs without a negative prompt, so a table's boundary cannot keep anything out of its pictures."
  }`;
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
          setDiscovery({ url, revision, checkpoints: [], models: [], hardware: null, device: null, error: "Could not check ComfyUI. Check the server URL." });
        }
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url, revision]);

  const current = discovery?.url === url && discovery.revision === revision ? discovery : null;
  const preset = images.comfyWorkflowPreset;
  const options = comfyModelOptions({ checkpoint: images.comfyCheckpoint, preset }, current);
  const selected = preset !== CHECKPOINT_PRESET ? `${PRESET_PREFIX}${preset}` : `${CHECKPOINT_PREFIX}${images.comfyCheckpoint}`;
  const report = current?.models.find((entry) => entry.id === preset);
  const missing = Boolean(current && !current.error && preset !== CHECKPOINT_PRESET && (!report || report.missing.length));

  // The picker sits beside the address; the catalog spans the row under both.
  return (
    <>
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
          <p role={current?.error || missing ? "alert" : "status"} className="text-[11px] leading-4 text-stone-500">
            {comfyModelStatus(current, preset)}
          </p>
          <button type="button" className="shrink-0 text-[11px] text-amber-300 hover:text-amber-200" onClick={() => setRevision((value) => value + 1)}>
            Refresh
          </button>
        </div>
      </div>
      {current && !current.error ? (
        <div className="sm:col-span-2">
          <ComfyModelCatalog discovery={current} preset={preset} checkpoint={images.comfyCheckpoint} onPick={onChange} />
        </div>
      ) : null}
    </>
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
    <PageSection id="admin-images" heading="Image generation" glyph="ui-paint">
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
