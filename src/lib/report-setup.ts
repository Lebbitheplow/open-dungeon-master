import { REPOSITORY_URL } from "@/lib/build-info";
import type { ShellReportFacts } from "@/lib/shell-host";

// What a report says about how the server is set up (issue #459's
// follow-up): every version, how the server and the app were installed,
// and each AI piece by kind and model (the narrator, the helper model, the
// agent program, pictures, narration, dictation), never by address or key.
// Most reported problems turned out to be an unsupported model or a
// backend set up wrong, so the server also works out what is below the
// supported minimum (checkFirst): the Report a problem dialog shows it
// before anything is saved, and the bug form's Your setup box is filled in
// from these same lines (bugReportUrl).
//
// Pure, like src/lib/report-bundle.ts: the server gathers the facts in
// src/lib/report-setup-server.ts.

export type ReportModel = {
  // "llama.cpp on this machine", "openai (hosted API)", "none".
  backend: string;
  model: string;
  // No narrator at all: the backend says so and nothing else applies.
  off?: boolean;
  // Whether the backend answered while the report was made; null when it
  // was not asked.
  answers?: boolean | null;
  // The window the table packs the prompt against, and whether it is the
  // stand-in used when the backend never said.
  contextTokens?: number;
  windowAssumed?: boolean;
  // Billions of parameters, when the backend or the model's name says.
  paramsB?: number;
  // The admin's last Test backend for this model.
  tested?: string;
  fastTier?: boolean;
};

export type ReportAgentProgram = {
  program: string;
  version: string;
  model: string;
  effort: string;
  helperModel: string;
  // "signed in (subscription)", "signed out", "not installed".
  state: string;
};

export type ReportSetup = {
  version: string;
  build: string;
  commit: string;
  channel?: string;
  // How the server runs: "Docker", "the desktop app's own world", "a source
  // checkout, 3 commits past v0.30.1".
  install?: string;
  platform: string;
  arch: string;
  node: string;
  // A world the desktop or Android app hosts on the device.
  deviceWorld: boolean;
  // The server's machine: its graphics card and memory, and how that fits a
  // local narrator.
  machine?: string;
  // Absent from Admin, which has no table.
  dmMode?: string;
  role?: string;
  narrator: ReportModel;
  // null: no helper model, the narrator does everything.
  helper?: ReportModel | null;
  agentProgram?: ReportAgentProgram | null;
  pictures?: { on: boolean; backend: string; model: string };
  narration?: { on: boolean; backend: string; model: string; voice: string; characterVoices: boolean };
  dictation?: { backend: string; model: string };
  voiceChat?: { on: boolean; mode: string; transcribes: boolean };
  // What is below the supported minimum or not answering, in plain words.
  checkFirst?: string[];
  // The app's own facts, added in the browser (src/lib/shell-report.ts).
  app?: ShellReportFacts;
};

// The bug report form on GitHub. Only Your setup is ever filled in from a
// report, and only with these lines.
export const BUG_REPORT_URL = `${REPOSITORY_URL}/issues/new?template=bug_report.yml`;
// Kept well under the length GitHub refuses (414) once encoded.
const MAX_ENCODED_SETUP = 6000;

function modelLine(model: ReportModel | null | undefined): string {
  if (!model) return "off (the narrator does everything)";
  if (model.off) return model.backend;
  return [
    model.backend,
    model.model ? `model ${model.model}` : "no model chosen",
    model.paramsB ? `${model.paramsB}B parameters` : "",
    model.contextTokens ? `${model.contextTokens.toLocaleString("en-US")}-token window${model.windowAssumed ? " (assumed: the backend never said)" : ""}` : "",
    model.answers === false ? "not answering" : model.answers ? "answering" : "",
    model.tested ?? "",
    model.fastTier ? "Fast tier" : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function appLines(app: ShellReportFacts): string[] {
  const where = [app.platform, app.arch].filter(Boolean).join(" ");
  const line = [
    `App: Open Game Master ${app.version || "(version unknown)"}${app.installKind ? ` (${app.installKind})` : ""}${where ? ` on ${where}` : ""}`,
    app.os,
    app.runtime,
    app.screens ? `${app.screens} screens` : "",
    app.localWorld ? "at the world this device hosts" : "at a server elsewhere",
  ]
    .filter(Boolean)
    .join(", ");
  return [
    line,
    ...(app.localStory ? [`The app's local story AI: ${app.localStory}`] : []),
    ...(app.localImages ? [`The app's local image AI: ${app.localImages}`] : []),
  ];
}

// One line per fact, the same for the file's readable summary and the form.
export function setupLines(setup: ReportSetup): string[] {
  const lines = [
    `Version ${setup.build || setup.version}${setup.commit ? ` (${setup.commit.slice(0, 12)})` : ""}${setup.channel ? `, ${setup.channel} channel` : ""}`,
  ];
  if (setup.install) lines.push(`Installed as: ${setup.install}`);
  lines.push(
    `Server: ${setup.platform} ${setup.arch}, Node ${setup.node}${setup.deviceWorld ? ", a world hosted by the app" : ""}${setup.machine ? `; ${setup.machine}` : ""}`,
  );
  if (setup.app) lines.push(...appLines(setup.app));
  if (setup.dmMode) lines.push(`DM mode: ${setup.dmMode}. Reporter's seat: ${setup.role ?? "unknown"}`);
  lines.push(`Narrator: ${modelLine(setup.narrator)}`);
  if (setup.helper !== undefined) lines.push(`Helper model: ${modelLine(setup.helper)}`);
  const agent = setup.agentProgram;
  if (agent) {
    const parts = [
      `${agent.program}${agent.version ? ` ${agent.version}` : ""}`,
      agent.model ? `model ${agent.model}` : "",
      agent.effort ? `effort ${agent.effort}` : "",
      agent.helperModel ? `helper model ${agent.helperModel}` : "",
      agent.state,
    ];
    lines.push(`Agent program: ${parts.filter(Boolean).join(", ")}`);
  }
  if (setup.pictures) {
    lines.push(`Pictures: ${setup.pictures.on ? [setup.pictures.backend, setup.pictures.model].filter(Boolean).join(", ") : "off"}`);
  }
  if (setup.narration) {
    const voice = setup.narration;
    lines.push(
      `Narration: ${voice.on ? [voice.backend, voice.model ? `model ${voice.model}` : "", voice.voice ? `voice ${voice.voice}` : "", `character voices ${voice.characterVoices ? "on" : "off"}`].filter(Boolean).join(", ") : "off"}`,
    );
  }
  if (setup.dictation) {
    lines.push(`Dictation: ${setup.dictation.backend}${setup.dictation.model ? `, model ${setup.dictation.model}` : ""}`);
  }
  if (setup.voiceChat) {
    lines.push(`Voice chat: ${setup.voiceChat.on ? `${setup.voiceChat.mode}${setup.voiceChat.transcribes ? ", transcribed" : ""}` : "off"}`);
  }
  return lines;
}

// Your setup on the bug form, a line each: the facts as a list, then what
// the server found to check first.
function setupFieldLines(setup: ReportSetup): string[] {
  const lines = setupLines(setup).map((line) => `- ${line}`);
  const checks = setup.checkFirst ?? [];
  if (checks.length) lines.push("", "Found by Report a problem, to check first:", ...checks.map((line) => `- ${line}`));
  return lines;
}

export function setupFieldText(setup: ReportSetup): string {
  return setupFieldLines(setup).join("\n");
}

// The form, with Your setup filled in when the report has its setup. Lines
// are dropped from the end, never cut mid-line, if the address would grow
// too long.
export function bugReportUrl(bundle?: { setup?: ReportSetup }): string {
  if (!bundle?.setup) return BUG_REPORT_URL;
  const lines = setupFieldLines(bundle.setup);
  while (lines.length) {
    const encoded = encodeURIComponent(lines.join("\n"));
    if (encoded.length <= MAX_ENCODED_SETUP) return `${BUG_REPORT_URL}&setup=${encoded}`;
    lines.pop();
  }
  return BUG_REPORT_URL;
}
