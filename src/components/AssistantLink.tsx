"use client";

import { CopyLine } from "@/components/CopyLine";

// The one URL a cloud assistant saves for this world: a device world's relay
// address with the new token on the end (src/lib/agents/assistant-relay.ts).
// ChatGPT, Claude, Grok and Meta Muse all take a bare URL for a custom
// connector, so this is the whole setup. Nothing renders where there is no
// relay: a server with its own address, or a world never shared online.
export function AssistantLink({ base, token }: { base: string; token: string }) {
  if (!base) {
    return null;
  }
  return (
    <div>
      <span className="mb-1 block text-xs text-stone-400">ChatGPT, Claude, Grok or Meta Muse (add as a custom connector, no sign-in)</span>
      <CopyLine text={`${base}/${token}`} label="assistant link" />
      <span className="mt-1 block text-xs text-stone-500">
        It keeps working when this world is shared again at a new address, and answers whenever it is shared.
      </span>
    </div>
  );
}
