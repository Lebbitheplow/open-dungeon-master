import { downloadBlob } from "@/lib/download";
import { finishBundle, reportFileText, type ReportBundle, type ReportSetup } from "@/lib/report-bundle";
import { shellHost, type ShellReportFacts } from "@/lib/shell-host";

// Saving Report a problem's file (issue #459) wherever the page runs. In a
// browser it is a download. Inside the desktop and Android apps the app
// saves it itself (a save dialog that starts in Downloads; the phone's
// share sheet, where the admin picks Files, Drive or another app) and
// adds what only the app knows: its version and platform, how it shows the
// pages, and whether the table is the device's own world. An app without
// that door (apps up to 0.21.0, the apps' web view) gets the browser's way,
// which both apps already take. Nothing here sends the file anywhere.

const FACT_LIMIT = 120;
// A local engine's line can carry its last error.
const ENGINE_LIMIT = 300;

export type ReportAppFacts = ShellReportFacts;

export type ReportWithApp = ReportBundle & { setup?: ReportSetup & { app?: ReportAppFacts } };

export type ReportSaved = { saved: boolean; name: string; where: string };

function fact(value: unknown, limit = FACT_LIMIT): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

// The app's answer, checked: only the known keys, each a short string.
export function cleanAppFacts(raw: unknown): ReportAppFacts | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const facts = raw as Record<string, unknown>;
  const clean: ReportAppFacts = {
    version: fact(facts.version),
    installKind: fact(facts.installKind),
    platform: fact(facts.platform),
    arch: fact(facts.arch),
    os: fact(facts.os),
    runtime: fact(facts.runtime),
    screens: fact(facts.screens),
    localWorld: facts.localWorld === true,
  };
  const story = fact(facts.localStory, ENGINE_LIMIT);
  const images = fact(facts.localImages, ENGINE_LIMIT);
  if (story) clean.localStory = story;
  if (images) clean.localImages = images;
  return clean.version || clean.platform ? clean : null;
}

// The app goes under "Version and setup", so a report with that part
// unticked carries nothing about the app either. The readable summary is
// written again with the app's lines in it (src/lib/report-bundle.ts).
export function withAppFacts(bundle: ReportBundle, raw: unknown): ReportWithApp {
  const app = cleanAppFacts(raw);
  if (!bundle.setup || !app) return bundle;
  return finishBundle({ ...bundle, setup: { ...bundle.setup, app } });
}

// Inside an app, the app's own facts added to the report; elsewhere, or
// when the app cannot say, the report as it was. Done before the file is
// saved and the form opens, so both carry the same setup.
export async function withShellFacts(bundle: ReportBundle): Promise<ReportWithApp> {
  const host = shellHost();
  if (!host || typeof host.reportFacts !== "function" || typeof host.saveReport !== "function") return bundle;
  const facts = await host.reportFacts().catch(() => null);
  return withAppFacts(bundle, facts);
}

// Saves the file and says how it went: saved is false when the person
// backed out of the app's save dialog or share sheet. Rejects when the app
// could not write it.
export async function saveReportFile(bundle: ReportBundle, name: string): Promise<ReportSaved> {
  const host = shellHost();
  const save = host?.saveReport;
  if (!host || typeof save !== "function") {
    downloadBlob(name, new Blob([reportFileText(bundle)], { type: "application/json" }));
    return { saved: true, name, where: "" };
  }
  const answer = await save.call(host, { name, text: reportFileText(bundle) });
  return {
    saved: answer?.saved === true,
    name: fact(answer?.name) || name,
    where: fact(answer?.where),
  };
}
