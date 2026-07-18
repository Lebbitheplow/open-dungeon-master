// Pure helpers for spotting DM tool calls that leaked into narration as
// literal text, e.g. "[request_roll characterId=... kind=custom]". Kept
// dependency-free so client components can import it; the name list mirrors
// the tools registered in src/lib/dm/prompt.ts, src/lib/dm/mutations.ts
// (MUTATION_TOOL_NAMES), and src/lib/image-tool.ts.

export const DM_TOOL_NAME_PATTERN =
  "request_roll|request_player_input|move_party|update_location|record_event|recall_story|generate_image|apply_damage|heal|award_xp|modify_gold|grant_item|remove_item|set_condition|clear_condition|use_spell_slot|update_sheet";

export function toolTextRegex(): RegExp {
  return new RegExp(`\\[(${DM_TOOL_NAME_PATTERN})\\b([^\\]]*)\\]`, "g");
}

// Removes any leaked tool-call text; players should never see or hear it.
export function stripToolText(text: string): string {
  return text.replace(toolTextRegex(), "").replace(/[ \t]{2,}/g, " ");
}
