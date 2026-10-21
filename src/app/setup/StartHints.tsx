"use client";

import { CopyLine } from "@/components/CopyLine";
import type { ScanResult } from "@/app/setup/SetupParts";
import { RECOMMENDED_WINDOW, STORY_WINDOW_NEEDS, windowFlag } from "@/lib/story-window";

const HARDWARE_GUIDE = "https://github.com/Lebbitheplow/open-dungeon-master/blob/main/docs/text-backends.md#hardware-for-a-local-model";

// What the scan found this machine can run, as the desktop app's Story AI
// screen says it (src/lib/model-registry/hardware.ts storytellerFit).
function machineLine(machine: NonNullable<ScanResult["machine"]>): string {
  switch (machine.fit) {
    case "recommended":
      return `This machine (${machine.summary}) has room for the default storyteller, the first command below.`;
    case "minimum":
      return `This machine (${machine.summary}) has room for the 16 GB minimum, the gpt-oss-20b command below.`;
    case "below":
      return `This machine (${machine.summary}) has less than the 16 GB of graphics memory a local storyteller needs. Use an API key or an agent program, or run the model on a bigger computer and give its address under Somewhere else.`;
    default:
      return "This server could not measure a graphics card on this machine. A local storyteller needs at least 16 GB of graphics memory.";
  }
}

// What to run when nothing answered. The commands match the README's.
export function StartHints({ inContainer, machine }: { inContainer: boolean; machine: ScanResult["machine"] | null }) {
  return (
    <details className="reveal rounded-lg border border-stone-800 bg-stone-950/40 px-3 py-2">
      <summary className="cursor-pointer text-sm text-stone-300">How do I start one?</summary>
      <div className="mt-3 space-y-3 text-xs text-stone-400">
        {inContainer ? (
          <p className="su-note">
            This server runs in a container, so it looks for your model server on the host as host.docker.internal. Start
            the server on the host listening on 0.0.0.0, not only 127.0.0.1.
          </p>
        ) : null}
        {machine ? <p className="text-stone-300">{machineLine(machine)}</p> : null}
        <p>
          {STORY_WINDOW_NEEDS} The commands below run the default storyteller at 64K; on a smaller machine,{" "}
          <code>-c {windowFlag(RECOMMENDED_WINDOW)}</code> still plays everything.
        </p>
        <div>
          <span className="mb-1 block">llama.cpp with the default storyteller (Qwen3.6-35B-A3B, 64K window):</span>
          <CopyLine
            text={`llama-server -m Qwen3.6-35B-A3B-Q8_0.gguf -c 65536 --jinja --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --temp 0.7 --top-p 0.95 --top-k 20 --min-p 0.0 --port 8001 --alias qwen3.6-35b${inContainer ? " --host 0.0.0.0" : ""}`}
            label="llama-server command"
          />
        </div>
        <div>
          <span className="mb-1 block">llama.cpp on a 16 GB card, the minimum (gpt-oss-20b):</span>
          <CopyLine
            text={`llama-server -m gpt-oss-20b-MXFP4.gguf -c 65536 --jinja --flash-attn on --cache-type-k q8_0 --cache-type-v q8_0 --reasoning-budget 1024 --port 8001 --alias gpt-oss-20b${inContainer ? " --host 0.0.0.0" : ""}`}
            label="llama-server command for a 16 GB card"
          />
        </div>
        <p>
          A local model needs at least 16 GB of graphics memory; below that, use an API key or an agent program.{" "}
          <a href={HARDWARE_GUIDE} target="_blank" rel="noreferrer" className="text-amber-200 underline">
            What each size of card runs
          </a>
          .
        </p>
        <p>
          Ollama, LM Studio, vLLM or any server with OpenAI-style tool calls works too: start it, then press Look again.
        </p>
      </div>
    </details>
  );
}
