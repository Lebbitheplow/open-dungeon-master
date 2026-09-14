"use client";

import { SafetyToneFields } from "@/components/SafetyToneFields";
import type { StepProps } from "@/app/create-campaign/draft";
import { normalizeGm, normalizeSafety } from "@/lib/dm/safety-logic";

// The Feel step's safety and tone block (docs/vtt-parity-implementation-
// plan.md section 9): the same fields the lobby edits later.
export function SafetyFields({ draft, patch }: StepProps) {
  return (
    <SafetyToneFields
      safety={normalizeSafety(draft.safety)}
      gm={normalizeGm(draft.gm)}
      ttsVoice={draft.ttsVoice}
      onSafety={(safety) => patch({ safety })}
      onGm={(gm) => patch({ gm })}
      onVoice={(ttsVoice) => patch({ ttsVoice })}
    />
  );
}
