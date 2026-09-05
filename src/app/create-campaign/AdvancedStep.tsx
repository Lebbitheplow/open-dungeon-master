"use client";

import { VariantRulesFields } from "@/app/campaigns/[campaignId]/RulesPanel";
import { WorldSetupFields } from "@/app/WorldSetupFields";
import { ContentImportPicker } from "@/app/workshop/ContentImportPicker";
import { FieldLabel } from "@/app/create-campaign/fields";
import { VoiceChatFields } from "@/app/create-campaign/VoiceChatFields";
import type { StepProps } from "@/app/create-campaign/draft";

// Step 5: the decisions a first-timer can skip. Variant rules, house rules
// and starting lore, prep from a workshop, and live voice. Every one of
// them is editable again from the lobby.
export function AdvancedStep({ draft, patch, gates }: StepProps) {
  return (
    <div className="space-y-4 text-sm">
      <VariantRulesFields
        value={draft.variantRules}
        onChange={(variantRules) => patch({ variantRules })}
      />

      <WorldSetupFields
        houseRules={draft.houseRules}
        setHouseRules={(houseRules) => patch({ houseRules })}
        loreDrafts={draft.loreDrafts}
        setLoreDrafts={(loreDrafts) => patch({ loreDrafts })}
      />

      <div className="rounded-lg border border-stone-800 bg-stone-950/40 p-3">
        <FieldLabel className="mb-1.5">Bring in prep</FieldLabel>
        <ContentImportPicker
          selection={draft.contentImport}
          onChange={(contentImport) => patch({ contentImport })}
        />
      </div>

      {!gates.solo ? (
        <VoiceChatFields value={draft.voiceChat} onChange={(voiceChat) => patch({ voiceChat })} />
      ) : null}
    </div>
  );
}
