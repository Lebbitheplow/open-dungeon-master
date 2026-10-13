"use client";

import { useState } from "react";
import { DEFAULT_STORY_SETTINGS } from "@/lib/defaults";
import { comfyModel } from "@/lib/image-models/catalog";
import { HARDWARE_PROFILES, type VerifiedRow } from "@/lib/image-models/curate";
import { seconds } from "@/lib/image-models/describe";
import { VERIFIED_ROWS } from "@/lib/image-models/verified";
import type { ComfyModelReport } from "@/lib/comfyui";
import { paintsHere, type ComfyDiscovery } from "@/app/admin/AdminImagesSection";
import type { MaskedConfig } from "@/app/admin/AdminSettingsFields";

// Every image model ODM can run on ComfyUI, curated for the machine this
// ComfyUI runs on: what its hardware made of each one (verified.json), what
// is installed, and for the rest, the files to add and where they download
// from. Under the Image model picker in Admin > Images.

type Images = MaskedConfig["images"];

const hardwareLabel = (id: string) => HARDWARE_PROFILES.find((profile) => profile.id === id)?.label ?? id;

function measured(row: VerifiedRow): string {
  return [
    `${seconds(row.seconds.square)} a portrait or creature, ${seconds(row.seconds.landscape)} a scene`,
    `${seconds(row.coldSeconds)} for the first after a switch`,
    `peaks ${row.peakGb} GB`,
    `${row.steps} steps`,
  ].join(" · ");
}

function ModelRow({
  report,
  hardware,
  inUse,
  onPick,
}: {
  report: ComfyModelReport;
  hardware: string | null;
  inUse: boolean;
  onPick: () => void;
}) {
  const model = comfyModel(report.id);
  if (!model) return null;
  const row = report.verified;
  // Unmeasured here: what other hardware saw, as a guide.
  const elsewhere = row ? null : VERIFIED_ROWS.find((entry) => entry.model === report.id && entry.verdict !== "fails") ?? null;
  const installed = report.missing.length === 0;
  return (
    <li className="rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm text-stone-200">
          {model.label}
          {row?.verdict === "recommended" ? <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300">Recommended</span> : null}
          {model.style === "anime" ? <span className="ml-2 text-[10px] uppercase tracking-wide text-stone-500">Anime</span> : null}
        </span>
        <span className="text-[11px] text-stone-500">
          {inUse ? "In use" : installed ? "Installed" : `${report.downloadGb} GB to add`}
        </span>
      </div>
      <p className="text-[11px] leading-4 text-stone-400">{model.blurb}</p>
      <p className="text-[11px] leading-4 text-stone-500">
        {row && row.verdict !== "fails"
          ? measured(row)
          : row
            ? `Did not run on ${hardware ?? "this hardware"}.`
            : elsewhere
              ? `On ${hardwareLabel(elsewhere.hardware)}: ${measured(elsewhere)}.`
              : "Not measured yet."}
        {report.fits === false ? ` Peaked at ${report.needGb} GB, more than this GPU has.` : ""}
      </p>
      {row?.notes ? <p className="text-[11px] leading-4 text-stone-500">{row.notes}</p> : null}
      <p className="text-[11px] leading-4 text-stone-600">
        {model.maker}. {model.license}.
      </p>
      {!installed ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-amber-300 hover:text-amber-200">Files to add</summary>
          <ul className="mt-1 space-y-0.5">
            {report.missing.map((file) => (
              <li key={file.name} className="text-[11px] leading-4 text-stone-400">
                <a href={file.url} target="_blank" rel="noreferrer" className="text-amber-200 underline">
                  {file.name}
                </a>{" "}
                into ComfyUI/models/{file.folder} ({file.sizeGb} GB)
              </li>
            ))}
          </ul>
        </details>
      ) : !inUse && row?.verdict !== "fails" ? (
        <button type="button" className="mt-1 text-[11px] text-amber-300 hover:text-amber-200" onClick={onPick}>
          Use this model
        </button>
      ) : null}
    </li>
  );
}

export function ComfyModelCatalog({
  discovery,
  preset,
  checkpoint,
  onPick,
}: {
  discovery: ComfyDiscovery;
  preset: string;
  checkpoint: string;
  onPick: (patch: Partial<Images>) => void;
}) {
  const hardware = discovery.hardware?.label ?? null;
  // The models that cannot paint here (did not run, or want more GPU
  // memory than this one has) and the ones that painted poorly are kept
  // off the list; one click shows them, each saying why.
  const [showUnfit, setShowUnfit] = useState(false);
  const unfit = discovery.models.filter((report) => !paintsHere(report) || report.verified?.verdict === "poor");
  const reports = showUnfit ? discovery.models : discovery.models.filter((report) => !unfit.includes(report));
  const groups = [
    {
      key: "measured",
      title: `Measured on ${hardware}`,
      items: reports.filter((report) => report.verified && report.verified.verdict !== "fails" && report.verified.verdict !== "poor" && paintsHere(report)),
    },
    { key: "unmeasured", title: hardware ? `Not measured on ${hardware} yet` : "Models", items: reports.filter((report) => !report.verified && paintsHere(report)) },
    { key: "poor", title: `Poor pictures on ${hardware}`, items: reports.filter((report) => report.verified?.verdict === "poor" && paintsHere(report)) },
    { key: "too-big", title: "More GPU memory than this one has", items: reports.filter((report) => report.verified?.verdict !== "fails" && !paintsHere(report)) },
    { key: "failed", title: `Did not run on ${hardware}`, items: reports.filter((report) => report.verified?.verdict === "fails") },
  ].filter((group) => group.items.length);
  const measuredCount = groups.find((group) => group.key === "measured")?.items.length ?? 0;
  const installedCount = reports.filter((report) => !report.missing.length).length;
  const device = discovery.device;

  const slotOf = (report: ComfyModelReport) => {
    const load = comfyModel(report.id)?.graph.load;
    return load && "checkpoint" in load ? load.checkpoint : null;
  };
  // A blank checkpoint is the shipped default (src/lib/runtime-defaults.ts).
  const effectiveCheckpoint = checkpoint || DEFAULT_STORY_SETTINGS.comfyCheckpoint;
  const inUse = (report: ComfyModelReport) => {
    const slot = slotOf(report);
    return slot
      ? preset === "checkpoint" && Boolean(report.files[slot]) && effectiveCheckpoint === report.files[slot]
      : preset === report.id;
  };
  const pick = (report: ComfyModelReport) => {
    const slot = slotOf(report);
    onPick(slot ? { comfyWorkflowPreset: "checkpoint", comfyCheckpoint: report.files[slot] } : { comfyWorkflowPreset: report.id });
  };

  return (
    <details className="rounded-lg border border-stone-800 bg-stone-950/30 px-3 py-2">
      <summary className="cursor-pointer text-sm text-stone-300">
        Image models for this machine
        <span className="ml-2 text-[11px] text-stone-500">
          {device ? `${hardware ? `${hardware}, ${device.name}` : device.name}, ${device.memoryGb} GB for the GPU. ` : ""}
          {installedCount} installed{hardware ? `, ${measuredCount} measured here` : ""}
        </span>
      </summary>
      <p className="mt-2 text-[11px] leading-4 text-stone-500">
        Every model ODM can paint with on ComfyUI. Times are per picture once the model is loaded, timed with ODM&apos;s own
        portrait, creature and scene prompts at 1024 px; the first picture after switching models also loads it from disk.
        Add a model&apos;s files to ComfyUI, then Refresh.
      </p>
      {unfit.length ? (
        <p className="mt-2 text-[11px] leading-4 text-stone-500">
          {unfit.length} {unfit.length === 1 ? "model" : "models"} {showUnfit ? "cannot paint well here" : "that cannot paint well here " + (unfit.length === 1 ? "is" : "are") + " left off the list"}.{" "}
          <button type="button" className="underline hover:text-stone-300" onClick={() => setShowUnfit((on) => !on)}>
            {showUnfit ? "Hide them" : "Show them"}
          </button>
        </p>
      ) : null}
      <div className="reveal mt-2 space-y-3">
        {groups.map((group) => (
          <section key={group.key}>
            <h4 className="mb-1 text-xs font-medium text-stone-400">{group.title}</h4>
            <ul className="space-y-1.5">
              {group.items.map((report) => (
                <ModelRow key={report.id} report={report} hardware={hardware} inUse={inUse(report)} onPick={() => pick(report)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
